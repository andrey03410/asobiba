import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AssetDto } from "@asobiba/api";
import type { ConfigIssue } from "@asobiba/sdk";
import type { Asset } from "../generated/prisma/client";
import type { Db } from "../db";
import type { Env } from "../env";
import { conflict, HttpError, notFound } from "../http-errors";
import { newId, randomString, sha256 } from "../ids";
import { fetchPublicUrlStream } from "./fetch";
import { rasterizeSvg, renderTrustedSvg } from "./images";
import { inspectAssetFile, MAX_CONFIG_MEDIA_BYTES, MAX_MEDIA_BYTES, MAX_USER_ASSET_BYTES } from "./media";

/** Side of the thumbnails that previews embed: a 15×15 board repeats a cell image 225 times. */
const PREVIEW_THUMB_SIDE = 160;
const PREVIEW_THUMB_CACHE = 200;

export const MAX_ASSETS_PER_USER = 300;
const UPLOAD_TTL_MS = 10 * 60 * 1000;
export type AssetBody = Buffer | AsyncIterable<Uint8Array>;

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
  private readonly saves = new Map<string, Promise<void>>();
  constructor(
    private readonly db: Db,
    private readonly env: Env,
  ) {}

  private abs(relPath: string): string {
    const full = resolve(this.env.storageDir, relPath);
    if (!full.startsWith(`${resolve(this.env.storageDir)}${sep}`)) throw new Error("asset path escapes storage");
    return full;
  }

  async save(ownerId: string, input: { name?: string; body: AssetBody; source: AssetDto["source"] }): Promise<AssetDto> {
    const id = newId("ast");
    const temp = this.abs(join("assets", ownerId, `${id}.part`));
    await mkdir(dirname(temp), { recursive: true });
    let bytes = 0;
    let finalPath: string | undefined;
    try {
      const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > MAX_MEDIA_BYTES ? new HttpError(413, "too_big", "Файл больше 1 ГиБ") : null, chunk);
      } });
      // Backpressure bounds memory independently of a file's length or declared Content-Length.
      await pipeline(Readable.from(Buffer.isBuffer(input.body) ? [input.body] : input.body), limiter, createWriteStream(temp, { flags: "wx" }));
      const info = await inspectAssetFile(temp, bytes);
      const relPath = join("assets", ownerId, `${id}.${info.ext}`);
      // Serialize quota check + persistence for this owner; simultaneous uploads cannot both spend the last bytes.
      const previous = this.saves.get(ownerId) ?? Promise.resolve();
      let release!: () => void;
      const pending = new Promise<void>((r) => { release = r; });
      this.saves.set(ownerId, pending);
      await previous;
      try {
        const usage = await this.db.asset.aggregate({ where: { ownerId }, _count: true, _sum: { bytes: true } });
        if (usage._count >= MAX_ASSETS_PER_USER) throw conflict("too_many_assets", `В пуле уже ${usage._count} файлов: удалите ненужные`);
        if ((usage._sum.bytes ?? 0) + bytes > MAX_USER_ASSET_BYTES) throw conflict("asset_quota", "Пул превышает 10 ГиБ: удалите ненужные файлы");
        finalPath = this.abs(relPath);
        await rename(temp, finalPath);
        const asset = await this.db.asset.create({ data: {
          id, ownerId, name: cleanName(input.name, `${id}.${info.ext}`), mime: info.mime,
          width: info.width, height: info.height, bytes, path: relPath, source: input.source,
        } });
        return assetDto(asset);
      } finally {
        release();
        if (this.saves.get(ownerId) === pending) this.saves.delete(ownerId);
      }
    } catch (error) {
      if (finalPath) await rm(finalPath, { force: true });
      throw error;
    } finally { await rm(temp, { force: true }); }
  }

  async createFromSvg(ownerId: string, name: string, svg: string): Promise<AssetDto> {
    return this.save(ownerId, { name, body: rasterizeSvg(svg), source: "svg" });
  }

  async importUrl(ownerId: string, url: string, name?: string): Promise<AssetDto> {
    const { body, finalUrl } = await fetchPublicUrlStream(url, { allowPrivate: this.env.allowPrivateUrls, maxBytes: MAX_MEDIA_BYTES, totalTimeoutMs: 10 * 60 * 1000 });
    const fallback = safeDecode(new URL(finalUrl).pathname.split("/").pop() ?? "") || "медиа";
    return this.save(ownerId, { name: name ?? fallback, body, source: "url" });
  }

  async beginUpload(ownerId: string, name: string): Promise<{ uploadUrl: string; expiresAt: string }> {
    const ticket = `upl_${randomString(40)}`;
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    await this.db.uploadTicket.create({ data: { id: sha256(ticket), ownerId, name: cleanName(name, "загрузка"), expiresAt } });
    return { uploadUrl: `${this.env.publicUrl}/api/uploads/${ticket}`, expiresAt: expiresAt.toISOString() };
  }

  async finishUpload(ticket: string, body: AssetBody): Promise<AssetDto> {
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

  /** Metadata only; the HTTP route applies per-user visibility before opening a bounded stream. */
  async file(id: string): Promise<{ path: string; mime: string; ownerId: string; bytes: number } | null> {
    const asset = await this.db.asset.findUnique({ where: { id } });
    return asset ? { path: this.abs(asset.path), mime: asset.mime, ownerId: asset.ownerId, bytes: asset.bytes } : null;
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
      if (!row.mime.startsWith("image/")) continue;
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

  /** Missing/foreign references and the total size of unique audio/video references in a config. */
  async ownershipIssues(ownerId: string, refs: readonly { path: string; assetId: string }[]): Promise<ConfigIssue[]> {
    if (refs.length === 0) return [];
    const owned = await this.db.asset.findMany({ where: { ownerId, id: { in: refs.map((r) => r.assetId) } }, select: { id: true, mime: true, bytes: true } });
    const ids = new Set(owned.map((a) => a.id));
    const issues: ConfigIssue[] = refs
      .filter((r) => !ids.has(r.assetId))
      .map((r) => ({
        path: r.path,
        code: "asset_not_found",
        message: `Файла ${r.assetId} нет в вашем пуле`,
        hint: "Возьмите id из asset_list или загрузите файл заново",
        severity: "error" as const,
      }));
    const mediaBytes = owned.reduce((n, a) => n + a.bytes, 0);
    if (mediaBytes > MAX_CONFIG_MEDIA_BYTES) issues.push({ path: "rules", code: "media_quota", message: "Уникальные медиа квиза занимают больше 1 ГиБ", hint: "Уменьшите файлы или уберите часть звука и видео", severity: "error" });
    return issues;
  }
}
