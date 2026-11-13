import type { ConfigDto } from "@asobiba/api";
import { collectAssetRefs, type ConfigDocument, type ConfigIssue, type GameCatalog, validateConfig, type VideoPlay, type VideoSnapshotSummary } from "@asobiba/sdk";
import type { GameConfig, Prisma } from "../generated/prisma/client";
import type { AssetService } from "../assets/service";
import { MAX_CONFIG_MEDIA_BYTES } from "../assets/media";
import type { VideoService } from "../video/service";
import { sceneTiming } from "../video/timing";
import type { Db } from "../db";
import { conflict, invalidConfig, notFound } from "../http-errors";
import { newId } from "../ids";

export const MAX_CONFIGS_PER_USER = 200;
export const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

export type UserValidation = { ok: true; config: ConfigDocument; issues: ConfigIssue[] } | { ok: false; config: null; issues: ConfigIssue[] };

export function configDto(row: GameConfig): ConfigDto {
  return {
    id: row.id,
    gameId: row.gameId,
    title: row.title,
    document: row.document as unknown as ConfigDocument,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function documentSizeIssues(input: unknown): ConfigIssue[] {
  try {
    const json = JSON.stringify(input);
    if (json !== undefined && Buffer.byteLength(json, "utf8") > MAX_CONFIG_BYTES) return [{
      path: "", code: "config_limit", message: "Полный JSON конфига больше 2 МиБ",
      hint: "Уменьшите тексты и число вопросов; файлы передавайте ссылками на пул", severity: "error",
    }];
    return [];
  } catch {
    return [{ path: "", code: "invalid_json", message: "Конфиг должен быть сериализуемым JSON", severity: "error" }];
  }
}

export class ConfigService {
  constructor(
    private readonly db: Db,
    private readonly catalog: GameCatalog,
    private readonly assets: AssetService,
    private readonly video?: VideoService,
  ) {}

  /** Bound complete JSON, then check schemas, asset ownership/quotas and Quizor slot MIME. */
  async validate(userId: string, input: unknown): Promise<UserValidation> {
    const size = documentSizeIssues(input);
    if (size.length > 0) return { ok: false, config: null, issues: size };
    let res = validateConfig(this.catalog, input);
    if (!res.ok) return { ok: false, config: null, issues: res.issues };
    const game = this.catalog.get(res.config.game);
    const snapshotIds = game?.video?.configSnapshots(res.config) ?? [];
    let videoSnapshots: Record<string, VideoSnapshotSummary> = {};
    if (snapshotIds.length) {
      if (!this.video) return { ok: false, config: null, issues: [{ path: "rules.video", code: "video_unavailable", message: "Видео недоступно на этом сервере", severity: "error" }] };
      videoSnapshots = await this.video.summaries(userId, snapshotIds);
      res = validateConfig(this.catalog, input, { videoSnapshots });
      if (!res.ok) return { ok: false, config: null, issues: res.issues };
      const timing = this.normalizeSceneTimings(res.config.rules, videoSnapshots, snapshotIds[0]);
      const quota: ConfigIssue[] = [];
      for (const id of snapshotIds)
        if ((await this.video.snapshotBytes(id)) > MAX_CONFIG_MEDIA_BYTES)
          quota.push({ path: "rules.video.snapshot", code: "media_quota", message: "Ролик douga занимает больше 1 ГиБ", hint: "Уменьшите медиа проекта в douga", severity: "error" });
      if (timing.length || quota.length) return { ok: false, config: null, issues: [...res.issues, ...timing, ...quota] };
    }
    const normalizedSize = documentSizeIssues(res.config);
    if (normalizedSize.length > 0) return { ok: false, config: null, issues: normalizedSize };
    const refs = collectAssetRefs(res.config);
    const ownership = await this.assets.ownershipIssues(userId, refs);
    const mime = res.config.game === "quizor" ? await this.quizorMimeIssues(userId, res.config, refs) : [];
    if (ownership.length > 0 || mime.length > 0) return { ok: false, config: null, issues: [...res.issues, ...ownership, ...mime] };
    if (res.config.game === "quizor") {
      const duration = await this.normalizeMediaDurations(userId, res.config.rules);
      if (duration.length > 0) return { ok: false, config: null, issues: [...res.issues, ...duration] };
      // Enrichment is part of the frozen document and also spends its JSON budget.
      const enrichedSize = documentSizeIssues(res.config);
      if (enrichedSize.length > 0) return { ok: false, config: null, issues: enrichedSize };
    }
    return { ok: true, config: res.config, issues: res.issues };
  }

  /** `scene` blocks get their start and length from the snapshot frames. */
  private normalizeSceneTimings(rules: unknown, snapshots: Record<string, VideoSnapshotSummary>, snapshotId: string): ConfigIssue[] {
    const summary = snapshots[snapshotId];
    const issues: ConfigIssue[] = [];
    if (!summary) return issues;
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (node.type === "scene" && node.play && typeof node.play === "object") {
        const timing = sceneTiming(summary, { play: node.play as VideoPlay, from: node.start as string | undefined, hold: node.hold as string | undefined }, path);
        if ("code" in timing) issues.push(timing);
        else {
          node.startSeconds = timing.startSeconds;
          node.durationSeconds = timing.durationSeconds;
        }
      }
      for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`);
    };
    walk(rules, "rules");
    return issues;
  }

  private async normalizeMediaDurations(userId: string, rules: unknown): Promise<ConfigIssue[]> {
    const issues: ConfigIssue[] = [];
    const walk = async (value: unknown, path: string): Promise<void> => {
      if (Array.isArray(value)) { for (const [index, item] of value.entries()) await walk(item, `${path}[${index}]`); return; }
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if ((node.type === "audio" || node.type === "video") && typeof node.asset === "string" && node.durationSeconds === undefined && node.to === undefined) {
        const duration = await this.assets.durationSeconds(userId, node.asset);
        const from = typeof node.from === "number" ? node.from : 0;
        const speed = typeof node.speed === "number" ? node.speed : 1;
        const repeat = typeof node.repeat === "number" ? node.repeat : 1;
        const total = duration === null ? NaN : ((duration - from) / speed) * repeat;
        if (!Number.isFinite(total) || total <= 0 || total > 86400) issues.push({
          path: `${path}.durationSeconds`, code: "media_duration",
          message: duration === null ? "Не удалось достоверно прочитать длительность медиа" : "Фрагмент медиа пуст или его показ превышает 24 часа",
          hint: "Задайте durationSeconds или корректную границу to явно; при необходимости уменьшите from/repeat или увеличьте speed", severity: "error",
        });
        else node.durationSeconds = total;
      }
      for (const [key, child] of Object.entries(node)) await walk(child, `${path}.${key}`);
    };
    await walk(rules, "rules");
    return issues;
  }

  private async quizorMimeIssues(userId: string, config: ConfigDocument, refs: readonly { assetId: string }[]): Promise<ConfigIssue[]> {
    if (refs.length === 0) return [];
    const rows = await this.db.asset.findMany({ where: { ownerId: userId, id: { in: [...new Set(refs.map(r => r.assetId))] } }, select: { id: true, mime: true } });
    const mimes = new Map(rows.map(row => [row.id, row.mime]));
    const issues: ConfigIssue[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (typeof node.asset === "string") {
        const mime = mimes.get(node.asset);
        // All visual slots, point fields and option/item assets default to images.
        const expected = path.startsWith("visual") ? "image/" : node.type === "video" ? "video/" : node.type === "audio" || node.media === "audio" ? "audio/" : "image/";
        if (mime && !mime.startsWith(expected)) issues.push({ path: `${path}.asset`, code: "asset_mime",
          message: `Слот ожидает ${expected}*, а файл имеет тип ${mime}`,
          hint: "Выберите файл нужного типа из asset_list; для звукового варианта укажите media: audio", severity: "error" });
      }
      for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`);
    };
    walk(config.rules, "rules");
    walk(config.visual, "visual");
    return issues;
  }

  async requireValid(userId: string, input: unknown): Promise<ConfigDocument> {
    const res = await this.validate(userId, input);
    if (!res.ok) throw invalidConfig(res.issues);
    return res.config;
  }

  async save(userId: string, input: unknown, configId?: string): Promise<ConfigDto> {
    const config = await this.requireValid(userId, input);
    const document = config as unknown as Prisma.InputJsonValue;
    if (configId) {
      const existing = await this.db.gameConfig.findFirst({ where: { id: configId, ownerId: userId } });
      if (!existing) throw notFound("Конфиг не найден");
      const row = await this.db.gameConfig.update({ where: { id: configId }, data: { title: config.title, gameId: config.game, document } });
      return configDto(row);
    }
    const count = await this.db.gameConfig.count({ where: { ownerId: userId } });
    if (count >= MAX_CONFIGS_PER_USER) throw conflict("too_many_configs", "Слишком много конфигов: удалите ненужные");
    const row = await this.db.gameConfig.create({ data: { id: newId("cfg"), ownerId: userId, gameId: config.game, title: config.title, document } });
    return configDto(row);
  }

  async list(userId: string, gameId?: string): Promise<ConfigDto[]> {
    const rows = await this.db.gameConfig.findMany({ where: { ownerId: userId, ...(gameId ? { gameId } : {}) }, orderBy: { updatedAt: "desc" } });
    return rows.map(configDto);
  }

  async get(userId: string, id: string): Promise<ConfigDto> {
    const row = await this.db.gameConfig.findFirst({ where: { id, ownerId: userId } });
    if (!row) throw notFound("Конфиг не найден");
    return configDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.db.gameConfig.deleteMany({ where: { id, ownerId: userId } });
    if (res.count === 0) throw notFound("Конфиг не найден");
  }
}
