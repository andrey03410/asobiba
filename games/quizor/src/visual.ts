import { z } from "zod";
import { assetRef, type ConfigIssue } from "@asobiba/sdk";
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const THEMES = [
  {
    id: "midnight",
    title: "Полночь",
    description: "Тёмная сцена с золотыми акцентами",
  },
  {
    id: "paper",
    title: "Бумага",
    description: "Светлая тетрадь с синими акцентами",
  },
  {
    id: "neon",
    title: "Неон",
    description: "Контрастный фиолетовый и бирюзовый",
  },
  {
    id: "party",
    title: "Вечеринка",
    description: "Тёплая сцена с коралловыми акцентами",
  },
];
export const visualSchema = z
  .strictObject({
    theme: z.enum(["midnight", "paper", "neon", "party"]).default("midnight"),
    palette: z
      .strictObject({
        background: color.optional(),
        surface: color.optional(),
        text: color.optional(),
        muted: color.optional(),
        accent: color.optional(),
        correct: color.optional(),
        wrong: color.optional(),
      })
      .prefault({}),
    background: z.strictObject({ asset: assetRef() }).optional(),
    seats: z.array(color).max(16).default([]),
    animations: z
      .strictObject({
        enabled: z.boolean().default(true),
        durationMs: z.int().min(0).max(5000).default(500),
        intensity: z.number().min(0).max(2).default(1),
      })
      .prefault({}),
  })
  .prefault({});
export type QuizorVisual = z.output<typeof visualSchema>;
const PALETTES = {
  midnight: {
    background: "#0c1227",
    surface: "#19233d",
    text: "#f5f7ff",
    muted: "#a9b5cf",
    accent: "#f9c85a",
    correct: "#63d9a5",
    wrong: "#ff7891",
  },
  paper: {
    background: "#f1efe7",
    surface: "#ffffff",
    text: "#1a2f4c",
    muted: "#5d6c7f",
    accent: "#2764d5",
    correct: "#218258",
    wrong: "#bf3753",
  },
  neon: {
    background: "#130c2c",
    surface: "#261a47",
    text: "#f2edff",
    muted: "#b2a4ce",
    accent: "#47efcf",
    correct: "#6bec96",
    wrong: "#ff6bc3",
  },
  party: {
    background: "#2f1827",
    surface: "#4e2534",
    text: "#fff3e9",
    muted: "#dbb6bd",
    accent: "#ffad66",
    correct: "#9de1a7",
    wrong: "#ff718b",
  },
};
export function resolveVisual(input: QuizorVisual) {
  const visual = visualSchema.parse(input);
  const palette = { ...PALETTES[visual.theme], ...visual.palette };
  const seats = Array.from(
    { length: 16 },
    (_, i) =>
      visual.seats[i] ??
      [
        "#63c8ff",
        "#ffb86b",
        "#c29dff",
        "#80d8a2",
        "#ff85b1",
        "#e7dc77",
        "#67dcd0",
        "#9eb4ff",
      ][i % 8],
  );
  return {
    ...visual,
    palette,
    seats,
    background: palette.background,
    surface: palette.surface,
    foreground: palette.text,
    muted: palette.muted,
    accent: palette.accent,
    positive: palette.correct,
    negative: palette.wrong,
    seatColors: seats,
    backgroundAsset: visual.background?.asset,
  };
}
export function checkVisual(_visual: QuizorVisual): ConfigIssue[] {
  return [];
}
export const VISUAL_CATALOG = {
  themes: Object.fromEntries(THEMES.map((t) => [t.id, t.description])),
  effects: {
    blur: "Проявление из размытия",
    pixelate: "Проявление из пикселей",
    tiles: "Открытие плитками",
    zoom: "От детали к общему",
    spotlight: "Луч фонарика",
    words: "Печать по словам",
    "hidden-words": "Последовательное открытие слов",
  },
};
