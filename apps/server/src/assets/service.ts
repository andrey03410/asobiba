import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AssetDto } from "@asobiba/api";
import type { ConfigIssue } from "@asobiba/sdk";
import type { Asset } from "../generated/prisma/client";
import type { Db } from "../db";
import type { Env } from "../env";
import { conflict, HttpError, notFound } from "../http-errors";
import { newId, randomString, sha256 } from "../ids";
import { fetchPublicUrl } from "./fetch";
import { inspectImage, MAX_IMAGE_BYTES, rasterizeSvg, renderTrustedSvg } from "./images";

/** Side of the thumbnails that previews embed: a 15×15 board repeats a cell image 225 times. */
const PREVIEW_THUMB_SIDE = 160;
const PREVIEW_THUMB_CACHE = 200;

export const MAX_ASSETS_PER_USER = 300;
const UPLOAD_TTL_MS = 10 * 60 * 1000;

export function assetDto(asset: Asset): AssetDto {
  return {
    id: asset.id,
    name: asset.name,
    mime: asset.mime,
    width: asset.width,
    height: asset.height,
    bytes: asset.bytes,
    source: asset.source as AssetDto["source"],
    url: `/files/assets/${asset.id}`,
    createdAt: asset.createdAt.toISOString(),
  };
}

function cleanName(name: string | undefined, fallback: string): string {
  const n = (name ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80);
  return n || fallback;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export class AssetService {
  private readonly thumbs = new Map<string, string>();
  constructor(
    private readonly db: Db,
    private readonly env: Env,
  ) {}

  private abs(relPath: string): string {
    const full = resolve(this.env.storageDir, relPath);
    if (!full.startsWith(resolve(this.env.storageDir))) throw new Error("asset path escapes storage");
    return full;
  }

  async save(ownerId: string, input: { name?: string; body: Buffer; source: AssetDto["source"] }): Promise<AssetDto> {
    const info = inspectImage(input.body);
    const count = await this.db.asset.count({ where: { ownerId } });
    if (count >= MAX_ASSETS_PER_USER) throw conflict("too_many_assets", `В пуле уже ${count} картинок: удалите ненужные`);
    const id = newId("ast");
    const relPath = join("assets", ownerId, `${id}.${info.ext}`);
    await mkdir(dirname(this.abs(relPath)), { recursive: true });
    await writeFile(this.abs(relPath), input.body);
    const asset = await this.db.asset.create({
      data: {
        id,
        ownerId,
        name: cleanName(input.name, `${id}.${info.ext}`),
        mime: info.mime,
        width: info.width,
        height: info.height,
        bytes: input.body.length,
        path: relPath,
        source: input.source,
      },
    });
    return assetDto(asset);
  }

  async createFromSvg(ownerId: string, name: string, svg: string): Promise<AssetDto> {
    return this.save(ownerId, { name, body: rasterizeSvg(svg), source: "svg" });
  }

  async importUrl(ownerId: string, url: string, name?: string): Promise<AssetDto> {
    const { body, finalUrl } = await fetchPublicUrl(url, { allowPrivate: this.env.allowPrivateUrls, maxBytes: MAX_IMAGE_BYTES });
    const fallback = safeDecode(new URL(finalUrl).pathname.split("/").pop() ?? "") || "картинка";
    return this.save(ownerId, { name: name ?? fallback, body, source: "url" });
  }

  async beginUpload(ownerId: string, name: string): Promise<{ uploadUrl: string; expiresAt: string }> {
    const ticket = `upl_${randomString(40)}`;
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    await this.db.uploadTicket.create({ data: { id: sha256(ticket), ownerId, name: cleanName(name, "загрузка"), expiresAt } });
    return { uploadUrl: `${this.env.publicUrl}/api/uploads/${ticket}`, expiresAt: expiresAt.toISOString() };
  }

  async finishUpload(ticket: string, body: Buffer): Promise<AssetDto> {
    const id = sha256(ticket);
    const row = await this.db.uploadTicket.findUnique({ where: { id } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, "upload_expired", "Ссылка для загрузки недействительна или уже использована");
    }
    const claimed = await this.db.uploadTicket.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new HttpError(410, "upload_expired", "Ссылка для загрузки уже использована");
    const asset = await this.save(row.ownerId, { name: row.name, body, source: "upload" });
    await this.db.uploadTicket.update({ where: { id }, data: { assetId: asset.id } });
    return asset;
  }

  async list(ownerId: string): Promise<AssetDto[]> {
    const rows = await this.db.asset.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } });
    return rows.map(assetDto);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const asset = await this.db.asset.findFirst({ where: { id, ownerId } });
    if (!asset) throw notFound("Картинка не найдена");
    await this.db.asset.delete({ where: { id } });
    await rm(this.abs(asset.path), { force: true });
  }

  /** File for /files/assets/:id. Any logged-in user may read: ids are random, configs share them with lobby players. */
  async file(id: string): Promise<{ path: string; mime: string } | null> {
    const asset = await this.db.asset.findUnique({ where: { id } });
    return asset ? { path: this.abs(asset.path), mime: asset.mime } : null;
  }

  /**
   * Small PNG thumbnails as data URIs for server-side previews. Full images would be
   * inlined once per cell and piece and could grow the preview SVG to hundreds of MB.
   * An asset id never changes its file, so thumbnails are cached by id.
   */
  async previewDataUris(ids: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const missing = [...new Set(ids)].filter((id) => {
      const hit = this.thumbs.get(id);
      if (hit) out.set(id, hit);
      return !hit;
    });
    if (missing.length === 0) return out;
    const rows = await this.db.asset.findMany({ where: { id: { in: missing } } });
    for (const row of rows) {
      const buf = await readFile(this.abs(row.path));
      const scale = Math.min(1, PREVIEW_THUMB_SIDE / Math.max(row.width, row.height));
      const w = Math.max(1, Math.round(row.width * scale));
      const h = Math.max(1, Math.round(row.height * scale));
      const wrapper = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${row.width} ${row.height}"><image href="data:${row.mime};base64,${buf.toString("base64")}" width="${row.width}" height="${row.height}"/></svg>`;
      const uri = `data:image/png;base64,${renderTrustedSvg(wrapper, w).toString("base64")}`;
      this.thumbs.set(row.id, uri);
      if (this.thumbs.size > PREVIEW_THUMB_CACHE) this.thumbs.delete(this.thumbs.keys().next().value as string);
      out.set(row.id, uri);
    }
    return out;
  }

  /** Issues for references to images that are missing or belong to someone else. */
  async ownershipIssues(ownerId: string, refs: readonly { path: string; assetId: string }[]): Promise<ConfigIssue[]> {
    if (refs.length === 0) return [];
    const owned = await this.db.asset.findMany({ where: { ownerId, id: { in: refs.map((r) => r.assetId) } }, select: { id: true } });
    const ids = new Set(owned.map((a) => a.id));
    return refs
      .filter((r) => !ids.has(r.assetId))
      .map((r) => ({
        path: r.path,
        code: "asset_not_found",
        message: `Картинки ${r.assetId} нет в вашем пуле`,
        hint: "Возьмите id из asset_list или загрузите картинку заново",
        severity: "error" as const,
      }));
  }
}
