import { z } from "zod";
import { type ConfigDocument, documentSchema, type GameCatalog, presetDocument } from "./config";
import type { AnyGame, SlotDescriptor, ThemeDescriptor } from "./game";

/** Explains the parts of a config document that are the same for every game. */
export const SDK_GUIDE = `Конфиг — JSON-документ { sdk, game, gameVersion, title, rules, series, timer, visual }.
- rules — правила конкретной игры, детали описаны в configSchema и guide игры.
- series — серия раундов: rounds, firstPlayer, stopWhenDecided. Общая для всех игр.
- timer — таймер хода (только пошаговые игры): turnSeconds (0 — без таймера), onTimeout.
  Игра может задать свои часы и свою политику таймаута: тогда guide игры говорит, что из timer действует.
- visual — тема и переопределения. Незаданные поля берутся из темы. Картинки можно класть
  только в слоты из slots: { preset: "<id>" } или { asset: "ast_…" } из своего пула.
- Конфиг — только данные: выбирайте из того, что описано в схеме. Код не исполняется.
Порядок: возьмите пресет → поправьте под просьбу → config_validate → config_simulate →
config_preview → config_save → lobby_create.`;

export interface GameSummary {
  id: string;
  version: number;
  title: string;
  summary: string;
  kind: "turn" | "realtime";
  presets: { id: string; title: string; description: string }[];
}

export interface GameCapabilities extends GameSummary {
  sdkGuide: string;
  guide: string;
  configSchema: unknown;
  slots: SlotDescriptor[];
  themes: ThemeDescriptor[];
  visualCatalog: Record<string, Record<string, string>>;
  presetConfigs: { id: string; config: ConfigDocument }[];
  /** Games with a video layer: where Douga scenes go and which recipes fit. */
  video?: { contract: number; guide: string; recipes: string[] };
}

export function summarizeGame(game: AnyGame): GameSummary {
  return {
    id: game.id,
    version: game.version,
    title: game.title,
    summary: game.summary,
    kind: game.kind,
    presets: game.presets.map((p) => ({ id: p.id, title: p.title, description: p.description })),
  };
}

export function listGames(catalog: GameCatalog): GameSummary[] {
  return catalog.list().map(summarizeGame);
}

/** JSON Schema of the config document as an agent should write it (input side, defaults optional). */
export function configJsonSchema(game: AnyGame): unknown {
  return z.toJSONSchema(documentSchema(game), { io: "input", unrepresentable: "any" });
}

/** Everything an agent needs to build a config for one game. */
export function describeGame(game: AnyGame): GameCapabilities {
  return {
    ...summarizeGame(game),
    sdkGuide: SDK_GUIDE,
    guide: game.guide,
    configSchema: configJsonSchema(game),
    slots: game.slots,
    themes: game.themes,
    visualCatalog: game.visualCatalog,
    presetConfigs: game.presets.map((p) => ({ id: p.id, config: presetDocument(game, p) })),
    ...(game.video ? { video: { contract: game.video.contract, guide: game.video.guide, recipes: game.video.recipes } } : {}),
  };
}
