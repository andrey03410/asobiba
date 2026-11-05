import { z } from "zod";
import type { AnyGame, ConfigPreset } from "./game";
import { type ConfigIssue, hasErrors, issuesFromZod, prefixIssues } from "./issues";
import { ASSET_ID, type SeriesSettings, seriesSchema, type TimerSettings, timerSchema } from "./schema";

export const SDK_VERSION = 1;

export interface ConfigDocument<R = unknown, V = unknown> {
  sdk: typeof SDK_VERSION;
  game: string;
  gameVersion: number;
  title: string;
  rules: R;
  series: SeriesSettings;
  timer: TimerSettings;
  visual: V;
}

export interface GameCatalog {
  get(id: string): AnyGame | undefined;
  list(): AnyGame[];
}

export function createCatalog(games: readonly AnyGame[]): GameCatalog {
  const map = new Map(games.map((g) => [g.id, g]));
  if (map.size !== games.length) throw new Error("createCatalog: duplicate game id");
  return { get: (id) => map.get(id), list: () => [...map.values()] };
}

/** Zod schema of a whole config document for one game. */
export function documentSchema(game: AnyGame) {
  return z
    .strictObject({
      sdk: z.literal(SDK_VERSION).meta({ description: "Версия формата конфига SDK" }),
      game: z.literal(game.id).meta({ description: "id игры" }),
      gameVersion: z.literal(game.version).meta({ description: "Версия схемы игры" }),
      title: z.string().trim().min(1).max(80).default(game.title).meta({ description: "Название конфига, видно в лобби" }),
      rules: game.rulesSchema,
      series: seriesSchema,
      timer: timerSchema,
      visual: game.visualSchema,
    })
    .meta({ description: `Конфиг игры «${game.title}»` });
}

export type ValidationResult =
  | { ok: true; config: ConfigDocument; issues: ConfigIssue[] }
  | { ok: false; issues: ConfigIssue[] };

function issue(path: string, code: string, message: string, hint?: string): ConfigIssue {
  return { path, code, message, hint, severity: "error" };
}

/**
 * Validates a config document: game and versions, then each section with
 * defaults, then the game's cross-field checks. Returns the normalized document
 * or issues with paths and hints.
 */
export function validateConfig(catalog: GameCatalog, input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [issue("", "invalid_type", "Конфиг должен быть JSON-объектом", "Начните с пресета из game_capabilities")] };
  }
  const raw = input as Record<string, unknown>;
  const gameId = raw.game;
  const game = typeof gameId === "string" ? catalog.get(gameId) : undefined;
  if (!game) {
    const ids = catalog.list().map((g) => g.id).join(", ");
    return { ok: false, issues: [issue("game", "unknown_game", `Неизвестная игра: ${JSON.stringify(gameId)}`, `Доступные игры: ${ids}`)] };
  }
  if (raw.sdk !== SDK_VERSION) {
    return { ok: false, issues: [issue("sdk", "sdk_version", `Нужен sdk: ${SDK_VERSION}`, "Возьмите свежий пресет из game_capabilities")] };
  }
  if (raw.gameVersion !== game.version) {
    return {
      ok: false,
      issues: [
        issue(
          "gameVersion",
          "game_version",
          `Схема игры «${game.title}» сейчас версии ${game.version}, а в конфиге ${JSON.stringify(raw.gameVersion)}`,
          "Перечитайте game_capabilities и пересоберите конфиг по актуальной схеме",
        ),
      ],
    };
  }
  const parsed = documentSchema(game).safeParse(input);
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) };
  const config = parsed.data as ConfigDocument;

  const issues: ConfigIssue[] = [];
  if (game.checkRules) issues.push(...prefixIssues(game.checkRules(config.rules), "rules"));
  if (game.checkVisual) issues.push(...prefixIssues(game.checkVisual(config.visual, config.rules), "visual"));
  if (game.kind === "realtime" && config.timer.turnSeconds > 0) {
    issues.push(issue("timer.turnSeconds", "timer_realtime", "Таймер хода есть только у пошаговых игр", "Поставьте 0"));
  }
  if (hasErrors(issues)) return { ok: false, issues };
  return { ok: true, config, issues };
}

/** Full normalized document for a preset (or schema defaults when no preset is given). */
export function presetDocument(game: AnyGame, preset?: ConfigPreset): ConfigDocument {
  const input = {
    sdk: SDK_VERSION,
    game: game.id,
    gameVersion: game.version,
    title: preset?.config.title ?? preset?.title ?? game.title,
    rules: preset?.config.rules ?? {},
    series: preset?.config.series ?? {},
    timer: preset?.config.timer ?? {},
    visual: preset?.config.visual ?? {},
  };
  return documentSchema(game).parse(input) as ConfigDocument;
}

export interface AssetRef {
  path: string;
  assetId: string;
}

/** Every `{ asset: "ast_…" }` inside the visual section. The server checks ownership. */
export function collectAssetRefs(config: Pick<ConfigDocument, "visual">): AssetRef[] {
  const out: AssetRef[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (typeof value === "object" && value !== null) {
      for (const [key, v] of Object.entries(value)) {
        const next = `${path}.${key}`;
        if (key === "asset" && typeof v === "string" && ASSET_ID.test(v)) out.push({ path: next, assetId: v });
        else walk(v, next);
      }
    }
  };
  walk(config.visual, "visual");
  return out;
}
