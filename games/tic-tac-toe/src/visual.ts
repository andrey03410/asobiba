import { animation, assetRef, type ConfigIssue, color } from "@asobiba/sdk";
import { z } from "zod";
import type { TttRules } from "./rules";

export const PIECE_PRESETS = {
  cross: "Крестик",
  ring: "Нолик",
  triangle: "Треугольник",
  square: "Квадрат",
  diamond: "Ромб",
  star: "Звезда",
  heart: "Сердечко",
  smile: "Смайлик",
  ghost: "Привидение",
  cat: "Котик",
  blob: "Клякса с глазами",
  bolt: "Молния",
} as const;
export type PieceId = keyof typeof PIECE_PRESETS;
const PIECE_IDS = Object.keys(PIECE_PRESETS) as [PieceId, ...PieceId[]];

export const BOARD_STYLES = {
  grid: "Классическая сетка из линий",
  tiles: "Отдельные плитки с зазором",
  bubbles: "Круглые лунки",
} as const;
export type BoardStyle = keyof typeof BOARD_STYLES;

export const BOARD_TEXTURES = {
  none: "Без узора",
  paper: "Бумажная крапинка",
  wood: "Деревянные полосы",
  stars: "Звёздочки",
  checker: "Шахматка",
  dots: "Горошек",
} as const;
export type BoardTexture = keyof typeof BOARD_TEXTURES;

export const PLACE_ANIMATIONS = {
  none: "Без анимации",
  pop: "Выпрыгивает из точки",
  drop: "Падает сверху",
  spin: "Вкручивается",
  bounce: "Приземляется с отскоком",
  wobble: "Покачивается, как желе",
  zoom: "Влетает из глубины",
} as const;
export const WIN_ANIMATIONS = {
  none: "Без анимации",
  pulse: "Фигуры линии пульсируют",
  glow: "Линия светится",
  shake: "Победные фигуры трясутся от радости",
  confetti: "Конфетти",
  rainbow: "Радужный перелив",
} as const;
export const IDLE_ANIMATIONS = {
  none: "Фигуры стоят спокойно",
  breathe: "Дышат",
  float: "Парят вверх-вниз",
  jiggle: "Подрагивают",
  sway: "Качаются из стороны в сторону",
} as const;

type Keys<T> = [keyof T & string, ...(keyof T & string)[]];
const keys = <T extends object>(o: T) => Object.keys(o) as Keys<T>;

export const pieceSlotSchema = z.union(
  [
    z.strictObject({
      preset: z.enum(PIECE_IDS).meta({ description: "Фигура разработчика" }),
      color: color("Цвет фигуры").optional(),
    }),
    z.strictObject({
      asset: assetRef(),
    }),
  ],
  { error: 'Фигура: { preset: "<id>", color?: "#rrggbb" } или { asset: "ast_…" }' },
);
export type PieceSlot = z.output<typeof pieceSlotSchema>;

const imageSlot = (description: string) =>
  z
    .strictObject({
      asset: assetRef(),
      opacity: z.number().min(0).max(1).optional().meta({ description: "Непрозрачность 0–1" }),
      fit: z.enum(["cover", "contain", "tile"]).optional().meta({ description: "cover — заполнить, contain — вписать, tile — замостить" }),
    })
    .optional()
    .meta({ description });

export const visualSchema = z
  .strictObject({
    theme: z.enum(["classic", "neon", "candy", "paper", "party"]).default("classic").meta({ description: "Тема: задаёт палитру, поле, фигуры и анимации по умолчанию" }),
    palette: z
      .strictObject({
        background: color("Фон вокруг поля").optional(),
        board: color("Подложка поля").optional(),
        grid: color("Линии сетки и рамки").optional(),
        cell: color("Клетка").optional(),
        cellAlt: color("Вторая клетка шахматки").optional(),
        highlight: color("Подсветка доступных ходов и последнего хода").optional(),
        winLine: color("Линия победы").optional(),
        blocked: color("Заблокированная клетка").optional(),
      })
      .optional()
      .meta({ description: "Переопределение цветов темы" }),
    board: z
      .strictObject({
        style: z.enum(keys(BOARD_STYLES)).optional().meta({ description: "Стиль клеток" }),
        radius: z.int().min(0).max(50).optional().meta({ description: "Скругление клеток, % от размера клетки" }),
        gap: z.int().min(0).max(30).optional().meta({ description: "Зазор между клетками, % (для tiles и bubbles)" }),
        texture: z.enum(keys(BOARD_TEXTURES)).optional().meta({ description: "Узор подложки" }),
        background: imageSlot("Своя картинка под всем полем"),
        cell: imageSlot("Своя картинка в каждой клетке"),
      })
      .optional()
      .meta({ description: "Поле" }),
    pieces: z.array(pieceSlotSchema).max(4).optional().meta({ description: "Фигуры по местам игроков: [0] — первый игрок, [1] — второй… Незаданные берутся из темы" }),
    pieceScale: z.number().min(0.4).max(1.2).optional().meta({ description: "Размер фигуры относительно клетки (0.4–1.2)" }),
    animations: z
      .strictObject({
        place: animation(keys(PLACE_ANIMATIONS), "Анимация постановки фигуры"),
        win: animation(keys(WIN_ANIMATIONS), "Анимация победной линии"),
        idle: animation(keys(IDLE_ANIMATIONS), "Анимация фигур в покое"),
      })
      .optional()
      .meta({ description: "Анимации: пресет, длительность, сила" }),
  })
  .prefault({})
  .meta({ description: "Визуал. Всё, кроме темы, необязательно: незаданное берётся из темы" });

export type TttVisual = z.output<typeof visualSchema>;
export type ThemeId = TttVisual["theme"];

export interface ResolvedAnimation {
  preset: string;
  durationMs: number;
  intensity: number;
}

export interface ResolvedPiece {
  kind: "preset" | "asset";
  preset?: PieceId;
  asset?: string;
  color: string;
}

export interface ResolvedVisual {
  theme: ThemeId;
  palette: Required<NonNullable<TttVisual["palette"]>> & { text: string };
  board: {
    style: BoardStyle;
    radius: number;
    gap: number;
    texture: BoardTexture;
    background?: { asset: string; opacity: number; fit: "cover" | "contain" | "tile" };
    cell?: { asset: string; opacity: number; fit: "cover" | "contain" | "tile" };
  };
  pieces: ResolvedPiece[];
  pieceScale: number;
  animations: { place: ResolvedAnimation; win: ResolvedAnimation; idle: ResolvedAnimation };
}

interface ThemeDefaults {
  title: string;
  description: string;
  palette: ResolvedVisual["palette"];
  board: Omit<ResolvedVisual["board"], "background" | "cell">;
  pieces: { preset: PieceId; color: string }[];
  pieceScale: number;
  animations: ResolvedVisual["animations"];
}

export const THEMES: Record<ThemeId, ThemeDefaults> = {
  classic: {
    title: "Классика",
    description: "Светлая бумага, чёрная сетка, красный крестик и синий нолик",
    palette: { background: "#f4f1ea", board: "#ffffff", grid: "#2b2b2b", cell: "#ffffff", cellAlt: "#ffffff", highlight: "#ffd54f", winLine: "#e53935", blocked: "#9e9e9e", text: "#222222" },
    board: { style: "grid", radius: 0, gap: 0, texture: "none" },
    pieces: [
      { preset: "cross", color: "#d32f2f" },
      { preset: "ring", color: "#1976d2" },
      { preset: "triangle", color: "#388e3c" },
      { preset: "square", color: "#f57c00" },
    ],
    pieceScale: 0.8,
    animations: { place: { preset: "pop", durationMs: 220, intensity: 1 }, win: { preset: "pulse", durationMs: 900, intensity: 1 }, idle: { preset: "none", durationMs: 2000, intensity: 1 } },
  },
  neon: {
    title: "Неон",
    description: "Тёмный фон, светящиеся плитки и фигуры",
    palette: { background: "#0b0f1a", board: "#121a2b", grid: "#3df2ff", cell: "#101827", cellAlt: "#141f33", highlight: "#ff3df2", winLine: "#b6ff3d", blocked: "#2a3550", text: "#e8f7ff" },
    board: { style: "tiles", radius: 14, gap: 8, texture: "none" },
    pieces: [
      { preset: "cross", color: "#3df2ff" },
      { preset: "ring", color: "#ff3df2" },
      { preset: "triangle", color: "#b6ff3d" },
      { preset: "diamond", color: "#ffd23d" },
    ],
    pieceScale: 0.75,
    animations: { place: { preset: "zoom", durationMs: 260, intensity: 1 }, win: { preset: "glow", durationMs: 1200, intensity: 1.2 }, idle: { preset: "breathe", durationMs: 2400, intensity: 0.6 } },
  },
  candy: {
    title: "Конфетки",
    description: "Розово-кремовые плитки, сердечки и звёздочки",
    palette: { background: "#ffe4f1", board: "#fff6fb", grid: "#ff8fc7", cell: "#ffffff", cellAlt: "#ffeef7", highlight: "#ffd1e8", winLine: "#ff4f9a", blocked: "#f3c4da", text: "#5b2141" },
    board: { style: "tiles", radius: 30, gap: 10, texture: "dots" },
    pieces: [
      { preset: "heart", color: "#ff4f9a" },
      { preset: "star", color: "#ffb000" },
      { preset: "smile", color: "#7bd389" },
      { preset: "diamond", color: "#8f7bff" },
    ],
    pieceScale: 0.78,
    animations: { place: { preset: "bounce", durationMs: 500, intensity: 1 }, win: { preset: "confetti", durationMs: 1600, intensity: 1 }, idle: { preset: "float", durationMs: 2600, intensity: 0.7 } },
  },
  paper: {
    title: "Тетрадь",
    description: "Крафтовая бумага, карандашные фигуры",
    palette: { background: "#efe7d6", board: "#f8f1e1", grid: "#5a4a3a", cell: "#f8f1e1", cellAlt: "#f3ead6", highlight: "#e9c46a", winLine: "#8b2f2f", blocked: "#bfae94", text: "#3a2f25" },
    board: { style: "grid", radius: 0, gap: 0, texture: "paper" },
    pieces: [
      { preset: "cross", color: "#3a2f25" },
      { preset: "ring", color: "#8b2f2f" },
      { preset: "triangle", color: "#2f5d8b" },
      { preset: "square", color: "#4f7a3a" },
    ],
    pieceScale: 0.78,
    animations: { place: { preset: "drop", durationMs: 300, intensity: 1 }, win: { preset: "shake", durationMs: 700, intensity: 1 }, idle: { preset: "none", durationMs: 2000, intensity: 1 } },
  },
  party: {
    title: "Вечеринка",
    description: "Смешные персонажи в лунках, всё прыгает и трясётся",
    palette: { background: "#fff3b0", board: "#ffffff", grid: "#6c5ce7", cell: "#f1edff", cellAlt: "#e6f9f3", highlight: "#ffeaa7", winLine: "#e84393", blocked: "#d6d0ff", text: "#2d3436" },
    board: { style: "bubbles", radius: 50, gap: 10, texture: "stars" },
    pieces: [
      { preset: "ghost", color: "#6c5ce7" },
      { preset: "cat", color: "#ff7675" },
      { preset: "blob", color: "#00b894" },
      { preset: "bolt", color: "#fdcb6e" },
    ],
    pieceScale: 0.85,
    animations: { place: { preset: "wobble", durationMs: 650, intensity: 1.5 }, win: { preset: "confetti", durationMs: 1600, intensity: 1.5 }, idle: { preset: "jiggle", durationMs: 1300, intensity: 1 } },
  },
};

/** Theme defaults merged with the config's overrides. Used by the renderer and the preview. */
export function resolveVisual(visual: TttVisual, seats: number): ResolvedVisual {
  const theme = THEMES[visual.theme];
  const anims = visual.animations ?? {};
  const merge = (base: ResolvedAnimation, over?: Partial<ResolvedAnimation>): ResolvedAnimation => ({
    preset: over?.preset ?? base.preset,
    durationMs: over?.durationMs ?? base.durationMs,
    intensity: over?.intensity ?? base.intensity,
  });
  const image = (slot?: { asset: string; opacity?: number; fit?: "cover" | "contain" | "tile" }, fit: "cover" | "contain" | "tile" = "cover") =>
    slot ? { asset: slot.asset, opacity: slot.opacity ?? 1, fit: slot.fit ?? fit } : undefined;
  const pieces: ResolvedPiece[] = Array.from({ length: seats }, (_, seat) => {
    const fallback = theme.pieces[seat % theme.pieces.length] as { preset: PieceId; color: string };
    const slot = visual.pieces?.[seat];
    if (slot && "asset" in slot) return { kind: "asset", asset: slot.asset, color: fallback.color };
    if (slot) return { kind: "preset", preset: slot.preset, color: slot.color ?? fallback.color };
    return { kind: "preset", preset: fallback.preset, color: fallback.color };
  });
  return {
    theme: visual.theme,
    palette: { ...theme.palette, ...stripUndefined(visual.palette ?? {}) },
    board: {
      style: visual.board?.style ?? theme.board.style,
      radius: visual.board?.radius ?? theme.board.radius,
      gap: visual.board?.gap ?? theme.board.gap,
      texture: visual.board?.texture ?? theme.board.texture,
      background: image(visual.board?.background, "cover"),
      cell: image(visual.board?.cell, "cover"),
    },
    pieces,
    pieceScale: visual.pieceScale ?? theme.pieceScale,
    animations: {
      place: merge(theme.animations.place, anims.place),
      win: merge(theme.animations.win, anims.win),
      idle: merge(theme.animations.idle, anims.idle),
    },
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function checkVisual(visual: TttVisual, rules: TttRules): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const pieces = visual.pieces ?? [];
  if (pieces.length > rules.players) {
    issues.push({
      path: "pieces",
      code: "extra_pieces",
      message: `Фигур ${pieces.length}, а игроков ${rules.players}: лишние не используются`,
      severity: "warning",
    });
  }
  const resolved = resolveVisual(visual, rules.players).pieces;
  const seen = new Map<string, number>();
  resolved.forEach((p, seat) => {
    const key = p.kind === "asset" ? `asset:${p.asset}` : `preset:${p.preset}:${p.color.toLowerCase()}`;
    const other = seen.get(key);
    if (other !== undefined) {
      issues.push({
        path: `pieces[${seat}]`,
        code: "same_piece",
        message: `У мест ${other + 1} и ${seat + 1} одинаковые фигуры — игроки их не различат`,
        hint: "Поменяйте фигуру или цвет",
      });
    }
    seen.set(key, seat);
  });
  return issues;
}
