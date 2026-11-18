import type { ConfigDto, ConfigListItem, ConfigValidationStatus } from "@asobiba/api";
import { collectAssetRefs, describeConfig, type ConfigDocument, type ConfigIssue, type ConfigSummary, type GameCatalog, validateConfig, type VideoPlay, type VideoSnapshotSummary } from "@asobiba/sdk";
import { z } from "zod";
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
/** Room for the request envelope and its small metadata fields. */
export const CONFIG_REQUEST_BODY_BYTES = MAX_CONFIG_BYTES + 8 * 1024;
export const configNameSchema = z.string().trim().min(1).max(80);

export type UserValidation = { ok: true; secretsHidden?: boolean; config: ConfigDocument; issues: ConfigIssue[]; summary: ConfigSummary } | { ok: false; config: null; issues: ConfigIssue[] };

type LibraryValidation = { status: ConfigValidationStatus; issues: ConfigIssue[]; normalized?: ConfigDocument };

function listItem(row: GameConfig, validationStatus: ConfigValidationStatus): ConfigListItem {
  return {
    id: row.id,
    gameId: row.gameId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    validationStatus,
  };
}

const isDocument = (input: unknown): input is Record<string, unknown> =>
  input !== null && typeof input === "object" && !Array.isArray(input);

const documentGameId = (document: Record<string, unknown>): string =>
  typeof document.game === "string" && document.game.length <= 80 ? document.game : "";

function hideRuleDiagnostics(issues: ConfigIssue[]): ConfigIssue[] {
  return issues.map(({ path, code, severity }) => ({
    path: path.match(/^(sdk|game|gameVersion|title|info|rules|series|timer|visual)(?=$|\.|\[)/)?.[0] ?? "",
    code, severity, message: "Подробности доступны при открытии исходного документа",
  }));
}

const sizeIssue: ConfigIssue = {
  path: "", code: "config_limit", message: "Полный JSON конфига больше 2 МиБ",
  hint: "Уменьшите тексты и число вопросов; файлы передавайте ссылками на пул", severity: "error",
};
const jsonIssue: ConfigIssue = { path: "", code: "invalid_json", message: "Конфиг должен быть сериализуемым JSON", severity: "error" };

function documentSizeIssues(input: unknown): ConfigIssue[] {
  try {
    const json = JSON.stringify(input);
    return json !== undefined && Buffer.byteLength(json, "utf8") > MAX_CONFIG_BYTES ? [sizeIssue] : [];
  } catch {
    return [jsonIssue];
  }
}

function documentForStorage(input: unknown): Prisma.InputJsonObject {
  if (!isDocument(input)) throw invalidConfig([{ path: "", code: "invalid_type", message: "Конфиг должен быть JSON-объектом", severity: "error" }]);
  let json: string;
  try {
    json = JSON.stringify(input);
  } catch {
    throw invalidConfig([jsonIssue]);
  }
  if (json === undefined) throw invalidConfig([jsonIssue]);
  if (Buffer.byteLength(json, "utf8") > MAX_CONFIG_BYTES) throw invalidConfig([sizeIssue]);
  const document = JSON.parse(json);
  if (!isDocument(document)) throw invalidConfig([jsonIssue]);
  return document as Prisma.InputJsonObject;
}

export class ConfigService {
  constructor(
    private readonly db: Db,
    private readonly catalog: GameCatalog,
    private readonly assets: AssetService,
    private readonly video?: VideoService,
  ) {}

  /** Public validation never discloses a Yomifuda deck, even to its author. */
  async validate(userId: string, input: unknown): Promise<UserValidation> {
    const res = await this.validateOriginal(userId, input);
    if (!res.ok || res.config.game !== "yomifuda") return res;
    const rules = this.catalog.get(res.config.game)?.presentRules?.(res.config.rules) ?? null;
    return { ...res, config: { ...res.config, rules }, secretsHidden: true };
  }

  /** Internal execution/authoring only. Never serialize this result in ordinary responses. */
  async validateOriginal(userId: string, input: unknown): Promise<UserValidation> {
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
    const mime = (res.config.game === "quizor" || res.config.game === "yomifuda") ? await this.slotMimeIssues(userId, res.config, refs) : [];
    if (ownership.length > 0 || mime.length > 0) return { ok: false, config: null, issues: [...res.issues, ...ownership, ...mime] };
    if (res.config.game === "quizor") {
      const duration = await this.normalizeMediaDurations(userId, res.config.rules);
      if (duration.length > 0) return { ok: false, config: null, issues: [...res.issues, ...duration] };
      // Enrichment is part of the frozen document and also spends its JSON budget.
      const enrichedSize = documentSizeIssues(res.config);
      if (enrichedSize.length > 0) return { ok: false, config: null, issues: enrichedSize };
    }
    return { ok: true, config: res.config, issues: res.issues, summary: describeConfig(game!, res.config).summary };
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
        const timing = sceneTiming(summary, { play: node.play as VideoPlay, start: node.start as string | undefined, hold: node.hold as string | undefined }, path);
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

  private async slotMimeIssues(userId: string, config: ConfigDocument, refs: readonly { assetId: string }[]): Promise<ConfigIssue[]> {
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

  async requireValid(userId: string, source: { config: unknown } | { configId: string }): Promise<ConfigDocument> {
    const res = await ("configId" in source
      ? this.validateSavedOriginal(userId, source.configId)
      : this.validateOriginal(userId, source.config));
    if (!res.ok) throw invalidConfig(res.issues);
    return res.config;
  }

  /** By-id execution gets the original; emitted diagnostics must describe it safely. */
  async validateSavedOriginal(userId: string, id: string): Promise<UserValidation> {
    const document = await this.getOriginal(userId, id);
    const result = await this.validateOriginal(userId, document);
    if (!isDocument(document) || !this.hasPrivateRules(documentGameId(document), document)) return result;
    const issues = hideRuleDiagnostics(result.issues);
    return result.ok ? { ...result, issues, secretsHidden: true } : { ...result, issues };
  }

  async save(userId: string, input: unknown, { configId, name }: { configId?: string; name?: string } = {}): Promise<ConfigDto> {
    const document = documentForStorage(input);
    const gameId = documentGameId(document);
    if (configId !== undefined) {
      return this.update(userId, configId, { gameId, document, title: name });
    }
    const documentTitle = typeof document.title === "string" ? document.title.trim().slice(0, 80) : "";
    const title = name ?? (documentTitle || this.catalog.get(gameId)?.title || "Без названия");
    const row = await this.db.$transaction(async (tx) => {
      const count = await tx.gameConfig.count({ where: { ownerId: userId } });
      if (count >= MAX_CONFIGS_PER_USER) throw conflict("too_many_configs", "Слишком много конфигов: удалите ненужные");
      return tx.gameConfig.create({ data: { id: newId("cfg"), ownerId: userId, gameId, title, document } });
    });
    return this.detail(row);
  }

  rename(userId: string, id: string, name: string): Promise<ConfigDto> {
    return this.update(userId, id, { title: name });
  }

  private async update(userId: string, id: string, data: Prisma.GameConfigUpdateManyMutationInput): Promise<ConfigDto> {
    const [row] = await this.db.gameConfig.updateManyAndReturn({ where: { id, ownerId: userId }, data });
    if (!row) throw notFound("Конфиг не найден");
    return this.detail(row);
  }

  /** A failure of the validator must not make the library or its drafts inaccessible. */
  private async libraryValidation(row: GameConfig): Promise<LibraryValidation> {
    try {
      const result = await this.validateOriginal(row.ownerId, row.document);
      return result.ok
        ? { status: "valid", issues: result.issues, normalized: result.config }
        : { status: "invalid", issues: result.issues };
    } catch {
      return {
        status: "unavailable",
        issues: [{ path: "", code: "validation_unavailable", message: "Проверка конфига временно недоступна", severity: "error" }],
      };
    }
  }

  async list(userId: string, gameId?: string): Promise<ConfigListItem[]> {
    const entries = await this.db.gameConfig.findMany({
      where: { ownerId: userId, ...(gameId !== undefined ? { gameId } : {}) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const result: ConfigListItem[] = [];
    // Keep the number of raw documents held at once small even at the storage limit.
    const batchSize = 8;
    for (let index = 0; index < entries.length; index += batchSize) {
      const ids = entries.slice(index, index + batchSize).map(({ id }) => id);
      const rows = await this.db.gameConfig.findMany({
        where: { ownerId: userId, id: { in: ids }, ...(gameId !== undefined ? { gameId } : {}) },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const id of ids) {
        const row = byId.get(id);
        if (row) result.push(listItem(row, (await this.libraryValidation(row)).status));
      }
    }
    return result;
  }

  private hasPrivateRules(gameId: string, document: Record<string, unknown>): boolean {
    const game = this.catalog.get(gameId);
    // Unknown games may include older private formats.
    return game ? game.presentRules !== undefined : Object.hasOwn(document, "rules");
  }

  private async detail(row: GameConfig, revealSecrets = false): Promise<ConfigDto> {
    const validation = await this.libraryValidation(row);
    const document = isDocument(row.document) ? row.document : {};
    const dto = { ...listItem(row, validation.status), document, issues: validation.issues };
    if (revealSecrets || !this.hasPrivateRules(row.gameId, document)) return dto;

    const game = this.catalog.get(row.gameId);
    let projected: Record<string, unknown> = { game: row.gameId, rules: null };
    if (game?.presentRules && validation.status !== "unavailable") {
      try {
        let config = validation.normalized;
        if (!config) {
          const local = validateConfig(this.catalog, document);
          if (local.ok) config = local.config;
        }
        if (config?.game === game.id) projected = { ...config, rules: game.presentRules(config.rules) };
      } catch { /* Keep rules hidden if even the local projection fails. */ }
    }
    // Diagnostics may quote keys, IDs or values supplied in private rules.
    const issues = validation.status === "unavailable" ? dto.issues : hideRuleDiagnostics(dto.issues);
    return { ...dto, document: projected, issues, secretsHidden: true };
  }

  async get(userId: string, id: string, options: { revealSecrets?: boolean } = {}): Promise<ConfigDto> {
    return this.detail(await this.getRow(userId, id), options.revealSecrets === true);
  }

  /** Internal original for execution, scoped to its owner. */
  async getOriginal(userId: string, id: string): Promise<unknown> {
    return (await this.getRow(userId, id)).document;
  }

  private async getRow(userId: string, id: string): Promise<GameConfig> {
    const row = await this.db.gameConfig.findFirst({ where: { id, ownerId: userId } });
    if (!row) throw notFound("Конфиг не найден");
    return row;
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.db.gameConfig.deleteMany({ where: { id, ownerId: userId } });
    if (res.count === 0) throw notFound("Конфиг не найден");
  }
}
