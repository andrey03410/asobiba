import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { VideoSnapshotDto } from "@asobiba/api";
import type { VideoSnapshotSummary } from "@asobiba/sdk";
import {
  interactiveSnapshotHash,
  interactiveSnapshotSchema,
  type InteractiveSnapshot,
} from "@douga/video";
import type { Db } from "../db";
import type { Env } from "../env";
import type { VideoSnapshot } from "../generated/prisma/client";
import { conflict, HttpError, notFound } from "../http-errors";
import { newId } from "../ids";
import { MAX_MEDIA_BYTES, MAX_USER_ASSET_BYTES } from "../assets/media";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const FILE = /^[a-f0-9]{64}\.[a-z0-9]{1,8}$/;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MANIFEST_TIMEOUT_MS = 30_000;
const IDLE_MS = 10_000;
const FILE_TIMEOUT_MS = 10 * 60 * 1000;
const MANIFEST_CACHE = 8;

/** Remotion the site bundles: a snapshot must be made by the same version. */
export const LOCAL_REMOTION_VERSION: string = (
  createRequire(import.meta.url)("remotion/package.json") as { version: string }
).version;

export const snapshotNotReady = () =>
  new HttpError(409, "snapshot_not_ready", "Douga ещё готовит кадры сцен: повторите импорт через минуту");
export const dougaUnavailable = (why: string) =>
  new HttpError(502, "douga_unavailable", `Douga недоступна: ${why}`);

export function snapshotDto(row: VideoSnapshot): VideoSnapshotDto {
  return {
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    revision: row.revision,
    bytes: Number(row.bytes),
    scenes: row.scenes,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Summary of a snapshot for config checks and agents: no document, no files. */
export function snapshotSummary(id: string, snapshot: InteractiveSnapshot): VideoSnapshotSummary {
  return {
    id,
    title: snapshot.project.title,
    fps: snapshot.fps,
    durationInFrames: snapshot.durationInFrames,
    segments: snapshot.segments,
    scenes: snapshot.scenes.map(({ still: _still, title: _title, ...scene }) => scene),
  };
}

/**
 * Douga snapshots: import by token from DOUGA_URL, a content-addressed file store and
 * deletion with reference checks. A snapshot never changes after import, so games keep
 * playing when Douga is stopped.
 */
export class VideoService {
  /**
   * Files are shared between owners by hash, so imports and removals of every owner take
   * turns: a removal never deletes a file an import is linking, and an import never skips
   * a download for a file a removal is deleting. Small load (owner and friends) keeps it cheap.
   */
  private files: Promise<unknown> = Promise.resolve();
  private readonly manifests = new Map<string, InteractiveSnapshot>();

  constructor(
    private readonly db: Db,
    private readonly env: Env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private abs(relPath: string): string {
    const root = resolve(this.env.storageDir);
    const full = resolve(root, relPath);
    if (!full.startsWith(`${root}${sep}`)) throw new Error("video path escapes storage");
    return full;
  }

  /** Absolute path of a stored file by its public name `<hash><ext>`, or null. */
  filePath(name: string): string | null {
    return FILE.test(name) ? this.abs(join("video", "files", name)) : null;
  }

  async manifest(id: string): Promise<InteractiveSnapshot> {
    const cached = this.manifests.get(id);
    if (cached) return cached;
    const row = await this.db.videoSnapshot.findUnique({ where: { id }, select: { path: true } });
    if (!row) throw notFound("Снимок не найден");
    const snapshot = JSON.parse(await readFile(this.abs(row.path), "utf8")) as InteractiveSnapshot;
    if (this.manifests.size >= MANIFEST_CACHE) this.manifests.delete(this.manifests.keys().next().value!);
    this.manifests.set(id, snapshot);
    return snapshot;
  }

  async list(ownerId: string): Promise<VideoSnapshotDto[]> {
    const rows = await this.db.videoSnapshot.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } });
    return rows.map(snapshotDto);
  }

  async owned(ownerId: string, id: string): Promise<VideoSnapshot> {
    const row = await this.db.videoSnapshot.findUnique({ where: { id } });
    if (!row || row.ownerId !== ownerId) throw notFound("Снимок не найден");
    return row;
  }

  async get(ownerId: string, id: string) {
    const row = await this.owned(ownerId, id);
    const snapshot = await this.manifest(id);
    return { ...snapshotDto(row), ...snapshotSummary(id, snapshot), sample: snapshot.sample };
  }

  /** Summaries of the snapshots a config uses; ids that are not the owner's are left out. */
  async summaries(ownerId: string, ids: string[]): Promise<Record<string, VideoSnapshotSummary>> {
    const out: Record<string, VideoSnapshotSummary> = {};
    for (const id of new Set(ids)) {
      const row = await this.db.videoSnapshot.findUnique({ where: { id }, select: { ownerId: true } });
      if (row?.ownerId === ownerId) out[id] = snapshotSummary(id, await this.manifest(id));
    }
    return out;
  }

  /** Bytes of unique snapshot files of an owner: part of the 10 GiB pool. */
  async poolBytes(ownerId: string): Promise<number> {
    const rows = await this.db.videoFile.findMany({
      where: { snapshots: { some: { snapshot: { ownerId } } } },
      select: { bytes: true },
    });
    return rows.reduce((sum, row) => sum + Number(row.bytes), 0);
  }

  /** Bytes of the unique files of one snapshot (config media quota). */
  async snapshotBytes(id: string): Promise<number> {
    const row = await this.db.videoSnapshot.findUnique({ where: { id }, select: { bytes: true } });
    return Number(row?.bytes ?? 0);
  }

  async importSnapshot(ownerId: string, token: string): Promise<VideoSnapshotDto & { reused: boolean }> {
    if (!TOKEN.test(token)) throw new HttpError(400, "bad_token", "Токен douga — строка base64url из video_interactive_publish");
    return this.withFiles(() => this.importNow(ownerId, token));
  }

  private withFiles<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.files.catch(() => undefined).then(fn);
    this.files = run.catch(() => undefined);
    return run;
  }

  private async fetchDouga(path: string, timeoutMs: number): Promise<Response> {
    if (!this.env.dougaUrl) throw dougaUnavailable("DOUGA_URL не задан в .env");
    try {
      return await this.fetchImpl(`${this.env.dougaUrl}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (error) {
      throw dougaUnavailable((error as Error).name === "TimeoutError" ? "нет ответа" : "нет соединения");
    }
  }

  private async importNow(ownerId: string, token: string) {
    const base = `/api/interactive/${encodeURIComponent(token)}`;
    const response = await this.fetchDouga(`${base}/manifest`, MANIFEST_TIMEOUT_MS);
    if (response.status === 409) throw snapshotNotReady();
    if (response.status === 404) throw notFound("Douga не знает такой токен: опубликуйте ролик заново");
    if (!response.ok || !response.body) throw dougaUnavailable(`ответ ${response.status}`);
    const text = await readLimited(response.body, MAX_MANIFEST_BYTES);
    let parsed: InteractiveSnapshot;
    try {
      const result = interactiveSnapshotSchema.safeParse(JSON.parse(text));
      if (!result.success) throw new Error(result.error.issues[0]?.message ?? "invalid");
      parsed = result.data as unknown as InteractiveSnapshot;
    } catch {
      throw new HttpError(422, "bad_snapshot", "Douga вернула снимок не того формата");
    }
    if (parsed.contract !== 1) throw new HttpError(422, "douga_version", "Снимок другого контракта: обновите asobiba или douga");
    if (parsed.engine.remotion !== LOCAL_REMOTION_VERSION)
      throw new HttpError(
        422,
        "douga_version",
        `Снимок сделан Remotion ${parsed.engine.remotion}, а сайт собран с ${LOCAL_REMOTION_VERSION}: обновите douga или asobiba`,
      );
    if ((await interactiveSnapshotHash(parsed)) !== parsed.hash)
      throw new HttpError(422, "bad_snapshot", "Хэш снимка не сходится");

    const existing = await this.db.videoSnapshot.findUnique({
      where: { ownerId_manifestHash: { ownerId, manifestHash: parsed.hash } },
    });
    if (existing) return { ...snapshotDto(existing), reused: true };

    const files = new Map(parsed.files.map((file) => [`${file.hash}${file.ext}`, file]));
    // Sources become /files/video/<src> in the browser: only files of this snapshot.
    for (const asset of Object.values(parsed.manifest))
      for (const src of [asset.src, asset.posterSrc])
        if (src !== undefined && !files.has(src)) throw new HttpError(422, "bad_snapshot", "Источник медиа снимка не из его файлов");
    for (const file of files.values())
      if (file.bytes > MAX_MEDIA_BYTES) throw new HttpError(413, "too_big", "Файл снимка больше 1 ГиБ");
    const total = [...files.values()].reduce((sum, file) => sum + file.bytes, 0);
    const known = new Set(
      (
        await this.db.videoFile.findMany({
          where: { hash: { in: [...files.values()].map((f) => f.hash) }, snapshots: { some: { snapshot: { ownerId } } } },
          select: { hash: true },
        })
      ).map((row) => row.hash),
    );
    const added = [...files.values()].filter((f) => !known.has(f.hash)).reduce((sum, f) => sum + f.bytes, 0);
    const assets = await this.db.asset.aggregate({ where: { ownerId }, _sum: { bytes: true } });
    if ((assets._sum.bytes ?? 0) + (await this.poolBytes(ownerId)) + added > MAX_USER_ASSET_BYTES)
      throw conflict("asset_quota", "Пул превышает 10 ГиБ: удалите ненужные файлы или снимки");

    // Files this import brought: a failed import takes them away again.
    const fresh: string[] = [];
    const id = newId("vsn");
    const path = join("video", "snapshots", `${id}.json`);
    try {
      for (const [name, file] of files) {
        const target = this.abs(join("video", "files", name));
        const present = await stat(target).then((s) => s.size === file.bytes, () => false);
        if (present) continue;
        await this.download(`${base}/files/${name}`, target, file.hash, file.bytes);
        fresh.push(target);
      }
      await mkdir(dirname(this.abs(path)), { recursive: true });
      await writeFile(this.abs(path), JSON.stringify(parsed));
      const row = await this.db.$transaction(async (tx) => {
        for (const file of files.values())
          await tx.videoFile.upsert({
            where: { hash: file.hash },
            create: { hash: file.hash, ext: file.ext, bytes: BigInt(file.bytes), kind: file.kind },
            update: {},
          });
        return tx.videoSnapshot.create({
          data: {
            id,
            ownerId,
            title: parsed.project.title.slice(0, 200),
            projectId: parsed.project.id,
            revision: parsed.project.revision,
            manifestHash: parsed.hash,
            contract: parsed.contract,
            engine: parsed.engine,
            bytes: BigInt(total),
            scenes: parsed.scenes.length,
            path,
            files: { create: [...new Set([...files.values()].map((f) => f.hash))].map((hash) => ({ hash })) },
          },
        });
      });
      return { ...snapshotDto(row), reused: false };
    } catch (error) {
      await rm(this.abs(path), { force: true });
      for (const target of fresh) await rm(target, { force: true });
      throw error;
    }
  }

  private async download(path: string, target: string, hash: string, bytes: number) {
    const response = await this.fetchDouga(path, FILE_TIMEOUT_MS);
    if (!response.ok || !response.body) throw dougaUnavailable(`файл ${response.status}`);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.part`;
    const digest = createHash("sha256");
    let size = 0;
    let idle: NodeJS.Timeout | undefined;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        clearTimeout(idle);
        idle = setTimeout(() => meter.destroy(dougaUnavailable("файл перестал приходить")), IDLE_MS);
        size += chunk.length;
        if (size > bytes) return callback(new HttpError(422, "bad_snapshot", "Файл снимка больше заявленного"));
        digest.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(temp, { flags: "wx" }));
      if (size !== bytes || digest.digest("hex") !== hash)
        throw new HttpError(422, "bad_snapshot", "Файл снимка не совпал с хэшем");
      await rename(temp, target);
    } finally {
      clearTimeout(idle);
      await rm(temp, { force: true });
    }
  }

  /** Snapshots in a saved config or an open lobby cannot go. */
  remove(ownerId: string, id: string): Promise<{ removed: true }> {
    return this.withFiles(() => this.removeNow(ownerId, id));
  }

  private async removeNow(ownerId: string, id: string): Promise<{ removed: true }> {
    const row = await this.owned(ownerId, id);
    const needle = `"${id}"`;
    const configs = await this.db.gameConfig.findMany({ where: { ownerId }, select: { document: true } });
    const lobbies = await this.db.lobby.findMany({
      where: { status: { in: ["waiting", "playing"] } },
      select: { config: true },
    });
    if ([...configs.map((c) => c.document), ...lobbies.map((l) => l.config)].some((doc) => JSON.stringify(doc).includes(needle)))
      throw conflict("video_in_use", "Ролик используется в конфиге или открытом лобби");
    const hashes = (await this.db.videoSnapshotFile.findMany({ where: { snapshotId: id }, select: { hash: true } })).map(
      (f) => f.hash,
    );
    await this.db.videoSnapshot.delete({ where: { id } });
    this.manifests.delete(id);
    await rm(this.abs(row.path), { force: true });
    const orphans = await this.db.videoFile.findMany({
      where: { hash: { in: hashes }, snapshots: { none: {} } },
      select: { hash: true, ext: true },
    });
    for (const file of orphans) {
      await this.db.videoFile.delete({ where: { hash: file.hash } });
      await rm(this.abs(join("video", "files", `${file.hash}${file.ext}`)), { force: true });
    }
    return { removed: true };
  }

  /** Stream helper for routes. */
  open(name: string) {
    const path = this.filePath(name);
    return path ? createReadStream(path) : null;
  }
}

async function readLimited(body: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(422, "bad_snapshot", "Манифест снимка больше 16 МиБ");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
