import { assetRef, color, type ConfigIssue } from "@asobiba/sdk";
import { z } from "zod";
import type { PoleRules } from "./rules";

export const THEME_IDS = ["studio", "neon", "paper"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const THEMES = {
  studio: "Тёплая студия: дерево, латунь и лампы",
  neon: "Неон: тёмный зал и цветные сектора",
  paper: "Бумага: газетный кроссворд",
} as const;

const PALETTES: Record<ThemeId, string[]> = {
  studio: ["#c4554a", "#d4a017", "#3f7cac", "#2f6f4e", "#8a4b2f", "#a33b6b", "#4d6b8a", "#b86b3a"],
  neon: ["#ff2d95", "#7c5cff", "#19e6c1", "#ffe14a", "#ff5a36", "#3d8bff", "#c6ff4a", "#ff8ad4"],
  paper: ["#8c3b2a", "#2d5a3d", "#1f4e79", "#a15c07", "#6b3f69", "#3e4c3a", "#7a2e2e", "#3f4f6b"],
};

const BACKGROUNDS: Record<ThemeId, string> = { studio: "#1c1410", neon: "#0d1020", paper: "#f3ead7" };
const INKS: Record<ThemeId, string> = { studio: "#f6efe4", neon: "#f4f7ff", paper: "#241911" };
const PLAYERS: Record<ThemeId, string[]> = {
  studio: ["#e25b45", "#3f8f6b", "#3d7ec4", "#e0a106", "#a45bd0"],
  neon: ["#ff4d8d", "#3dffc8", "#7aa2ff", "#ffe14a", "#d07bff"],
  paper: ["#9c3b2e", "#2d6a4f", "#1d4e89", "#a15c07", "#6b3f69"],
};

export const visualSchema = z
  .strictObject({
    theme: z.enum(THEME_IDS).default("studio").meta({ description: "Тема: studio, neon или paper. Свои цвета заменяют её точечно" }),
    background: color("Фон").optional(),
    ink: color("Цвет текста").optional(),
    players: z.array(color("Цвет игрока")).max(5).optional().meta({ description: "Цвета мест по порядку, до пяти" }),
    center: assetRef().optional().meta({ description: "Картинка в центре барабана, ast_…" }),
    tile: z.enum(["flip", "ink", "glow"]).default("flip").meta({ description: "Плитка: flip — переворот, ink — печать, glow — неон" }),
  })
  .prefault({})
  .meta({ description: "Как выглядит партия" });

export type PoleVisual = z.output<typeof visualSchema>;

export interface ResolvedVisual {
  theme: ThemeId;
  background: string;
  ink: string;
  palette: string[];
  players: string[];
  center?: string;
  tile: "flip" | "ink" | "glow";
}

export function resolveVisual(visual: PoleVisual): ResolvedVisual {
  const theme = visual.theme;
  const players = [...PLAYERS[theme]];
  visual.players?.forEach((item, index) => {
    if (index < players.length) players[index] = item;
  });
  return {
    theme,
    background: visual.background ?? BACKGROUNDS[theme],
    ink: visual.ink ?? INKS[theme],
    palette: PALETTES[theme],
    players,
    center: visual.center,
    tile: visual.tile,
  };
}

export function checkVisual(visual: PoleVisual, _rules: PoleRules): ConfigIssue[] {
  if (visual.players && new Set(visual.players).size !== visual.players.length) {
    return [{ path: "players", code: "same_color", message: "Цвета игроков повторяются", hint: "Дайте каждому месту свой цвет", severity: "warning" }];
  }
  return [];
}

export const VISUAL_CATALOG = {
  themes: THEMES,
  tiles: { flip: "Плитка переворачивается", ink: "Буква проявляется чернилами", glow: "Буква загорается" },
};
