import { color, type ConfigIssue } from "@asobiba/sdk";
import { z } from "zod";

export const DEFAULT_COLORS = ["#32b8a1", "#ed6b6b", "#e9b949", "#7188e8", "#bc7bd6", "#e78f4b", "#62bce5", "#b2c65a"];

export const visualSchema = z.strictObject({
  colors: z.array(color("Цвет территории места, счёт с нуля")).length(8).default(DEFAULT_COLORS).meta({ description: "Восемь разных цветов мест игроков" }),
  wallColor: color("Цвет стен").default("#253247"),
  background: color("Цвет свободных клеток").default("#101a2b"),
  grid: z.boolean().default(true).meta({ description: "Показывать сетку, когда масштаб позволяет различать клетки" }),
  animations: z.strictObject({
    place: z.enum(["pop", "none"]).default("pop").meta({ title: "Постановка", enumNames: ["Появление", "Без анимации"], description: "Постановка: pop — появление, none — без анимации" }),
    capture: z.enum(["wave", "none"]).default("wave").meta({ title: "Захват", enumNames: ["Волна", "Без анимации"], description: "Захват: wave — волна, none — без анимации" }),
    durationMs: z.int().min(50).max(5000).default(450).meta({ description: "Длительность анимаций в миллисекундах (50–5000)" }),
  }).prefault({}).meta({ title: "Анимации" }),
}).prefault({}).meta({ description: "Визуал Jinchi: цвета мест, стены, сетка и анимации" });

export type JinchiVisual = z.output<typeof visualSchema>;

function normalizedColor(value: string): string {
  const hex = value.slice(1).toLowerCase();
  return hex.length === 3 ? hex.split("").map((c) => c + c).join("") + "ff" : hex.length === 6 ? hex + "ff" : hex;
}

export function checkVisual(visual: JinchiVisual): ConfigIssue[] {
  const seen = new Set<string>();
  const issues: ConfigIssue[] = [];
  visual.colors.forEach((value, i) => {
    const key = normalizedColor(value);
    if (seen.has(key)) issues.push({ path: `colors[${i}]`, code: "same-color", message: "Два места имеют одинаковый цвет", hint: "Выберите восемь разных цветов" });
    seen.add(key);
  });
  return issues;
}
