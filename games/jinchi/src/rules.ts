import type { ConfigIssue } from "@asobiba/sdk";
import { z } from "zod";

export const MAX_SIDE = 200;
export const EMPTY = -1;
export const WALL = -2;

const defaultRows = Array.from({ length: 16 }, (_, y) => y < 2 ? "11.............." : y >= 14 ? "..............22" : ".".repeat(16));

export const rulesSchema = z.strictObject({
  map: z.strictObject({
    width: z.int().min(3).max(MAX_SIDE).default(16).meta({ description: "Ширина карты в клетках (3–200)" }),
    height: z.int().min(3).max(MAX_SIDE).default(16).meta({ description: "Высота карты в клетках (3–200)" }),
    rows: z.array(z.string().max(MAX_SIDE)).max(MAX_SIDE).default(defaultRows).meta({ description: "Ровно height строк длины width. . — пусто, # — стена, 1…8 — стартовые зоны. В координатах x — столбец, y — строка, с нуля" }),
  }).prefault({}).meta({ description: "Карта: размеры и строки клеток" }),
  dice: z.strictObject({
    sides: z.int().min(2).max(20).default(6).meta({ description: "Граней у обоих кубиков (2–20). Выпало a:b — прямоугольник a×b" }),
    roll: z.enum(["auto", "manual"]).default("auto").meta({ description: "auto — бросок в начале хода, manual — по кнопке «Бросить»" }),
  }).prefault({}).meta({ description: "Два одинаковых кубика" }),
  placement: z.strictObject({
    adjacency: z.enum(["side", "corner"]).default("side").meta({ description: "side — фигура касается своей территории стороной; corner — также углом" }),
    overlapOwn: z.boolean().default(false).meta({ description: "Разрешить накрывать свои клетки, если хотя бы одна клетка фигуры свободна. Чужие клетки и стены накрывать нельзя" }),
  }).prefault({}).meta({ description: "Постановка прямоугольника" }),
  capture: z.strictObject({
    walls: z.boolean().default(true).meta({ description: "Края и стены помогают замкнуть кольцо. Из касающихся игрока областей открыты все самые большие, меньшие захватываются" }),
    diagonal: z.boolean().default(true).meta({ description: "Касание своих клеток углом замыкает кольцо (заливка по 4 соседям, иначе по 8)" }),
    opponents: z.enum(["all", "except-starts", "none"]).default("all").meta({ description: "Чужие клетки внутри кольца: все забираются, кроме исходных баз или не забираются" }),
  }).prefault({}).meta({ description: "Окружение проверяется после постановки только для походившего игрока" }),
  starts: z.strictObject({
    assignment: z.enum(["random", "ordered"]).default("random").meta({ description: "random — случайная раздача стартовых позиций по зерну, ordered — по номерам" }),
    unused: z.enum(["empty", "wall"]).default("empty").meta({ description: "Лишние стартовые зоны при неполном составе становятся пустыми клетками или стенами" }),
  }).prefault({}).meta({ description: "Стартовые позиции и состав 2–8 игроков" }),
  end: z.strictObject({
    skipRounds: z.int().min(0).max(100).default(2).meta({ description: "Кругов подряд без постановок до конца партии (0 — выключено, по умолчанию 2)" }),
    maxRounds: z.int().min(0).max(10000).default(0).meta({ description: "Лимит кругов (0 — выключено). Круг — каждый оставшийся игрок сходил или пропустил" }),
    targetPercent: z.number().min(0).max(100).refine((n) => n === 0 || n >= 10, { error: "Доля победы — 10–100 %, либо 0 для отключения" }).default(0).meta({ description: "Немедленная победа при доле карты 10–100 % (0 — выключено). Стены в площадь не входят" }),
  }).prefault({}).meta({ description: "Всегда конец, если остался один игрок или ни у кого нет постановки 1×1" }),
}).prefault({}).meta({ description: "Правила Jinchi v1" });

export type JinchiRules = z.output<typeof rulesSchema>;

export function startPositions(rules: JinchiRules): number[] {
  return [...new Set(rules.map.rows.join("").split("").filter((c) => /^[1-8]$/.test(c)).map(Number))].sort((a, b) => a - b);
}

/** Cross-field validation also accepts unfinished editor maps without indexing missing rows. */
export function checkRules(rules: JinchiRules): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const { width, height, rows } = rules.map;
  for (const [key, value] of [["width", width], ["height", height]] as const) {
    if (!Number.isInteger(value) || value < 3 || value > MAX_SIDE) issues.push({ path: `map.${key}`, code: "map-size", message: "Каждая сторона карты должна быть от 3 до 200 клеток", hint: "Задайте целый размер 3–200", severity: "error" });
  }
  if (rows.length !== height) issues.push({ path: "map.rows", code: "map-height", message: `Нужно ${height} строк карты, получено ${rows.length}`, hint: "Добавьте или уберите строки до map.height" });
  rows.forEach((row, y) => {
    if (row.length !== width) issues.push({ path: `map.rows[${y}]`, code: "map-width", message: `В строке ${y + 1} нужно ${width} клеток, получено ${row.length}`, hint: "Каждый символ — одна клетка" });
    if (/[^.#1-8]/.test(row)) issues.push({ path: `map.rows[${y}]`, code: "map-character", message: `В строке ${y + 1} неизвестный символ`, hint: "Используйте только ., # и цифры 1…8" });
  });
  const positions = startPositions(rules);
  if (positions.length < 2) issues.push({ path: "map.rows", code: "too-few-starts", message: "Нужны хотя бы две стартовые позиции", hint: "Нарисуйте зоны разными цифрами 1…8" });
  if (issues.length > 0) return issues;
  const sizes = new Map(positions.map((p) => [p, 0]));
  const open = new Set<number>();
  const touching = new Set<string>();
  const cornersAllowed = rules.placement.adjacency === "corner";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = rows[y]![x]!;
      if (!/^[1-8]$/.test(cell)) continue;
      const position = Number(cell);
      sizes.set(position, sizes.get(position)! + 1);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const other = rows[y + dy]?.[x + dx];
          if (!other) continue;
          if (/^[1-8]$/.test(other) && other !== cell) touching.add([cell, other].sort().join(":"));
          if ((cornersAllowed || dx === 0 || dy === 0) && other === ".") open.add(position);
        }
      }
    }
  }
  for (const position of positions) {
    if (!open.has(position)) issues.push({ path: "map.rows", code: "start-blocked", message: `У стартовой позиции ${position} нет свободного соседа`, hint: "Оставьте рядом свободную клетку или разрешите соседство углом", severity: "warning" });
  }
  if (touching.size > 0) issues.push({ path: "map.rows", code: "starts-touch", message: "Стартовые зоны касаются друг друга", hint: "Разделите зоны свободными клетками или стенами", severity: "warning" });
  if (new Set(sizes.values()).size > 1) issues.push({ path: "map.rows", code: "unequal-starts", message: "Стартовые зоны разного размера", hint: "Одинаковая площадь баз делает старт честнее", severity: "warning" });
  if (width < rules.dice.sides || height < rules.dice.sides) issues.push({ path: "dice.sides", code: "large-dice", message: "Сторона карты меньше числа граней кубика: крупные броски не поместятся", hint: "Уменьшите кубики или увеличьте карту", severity: "warning" });
  return issues;
}

export function rulesText(rules: JinchiRules): string[] {
  const { dice, placement, capture, starts, end } = rules;
  return [
    `Два кубика d${dice.sides}: выпало a:b — ставьте прямоугольник a×b или b×a. Бросок ${dice.roll === "auto" ? "автоматический" : "по кнопке «Бросить»"}.`,
    `Фигура целиком на карте, без стен и чужих клеток. Касается своей территории ${placement.adjacency === "side" ? "стороной" : "стороной или углом"}. ${placement.overlapOwn ? "Можно накрывать свои клетки, если хотя бы одна клетка свободна." : "Ставится только на свободные клетки."}`,
    capture.walls ? "Кольцо замыкают свои клетки, края карты и стены. Среди касающихся вас областей все самые большие остаются открытыми, меньшие захватываются." : "Кольцо замыкают только свои клетки. Стены и края карты не помогают окружению; стены внутри кольца остаются стенами.",
    `Касание углом ${capture.diagonal ? "замыкает" : "не замыкает"} кольцо. ${capture.opponents === "all" ? "Все чужие клетки внутри кольца становятся вашими. Игрок без клеток выбывает." : capture.opponents === "except-starts" ? "Чужие клетки захватываются, кроме исходных стартовых зон." : "Чужие клетки внутри кольца сохраняют владельца."}`,
    `Стартовые позиции ${starts.assignment === "random" ? "раздаются случайно по зерну партии" : "раздаются по порядку номеров"}; лишние зоны становятся ${starts.unused === "empty" ? "свободными клетками" : "стенами"}.`,
    "Если прямоугольнику некуда встать ни в одном повороте, ход пропускается автоматически. Добровольного пропуска нет. Круг — каждый оставшийся игрок сходил или пропустил.",
    `Партия кончается, когда карта поделена (ни у кого нет места даже для 1×1) или остался один игрок.${end.skipRounds > 0 ? ` Также после ${end.skipRounds} кругов подряд без постановок.` : " Лимит пропусков выключен."}${end.maxRounds > 0 ? ` Лимит: ${end.maxRounds} кругов.` : ""}${end.targetPercent > 0 ? ` Для немедленной победы нужно ${end.targetPercent} % площади карты.` : ""}`,
    "Побеждает игрок с наибольшим числом клеток. Равный лучший счёт — ничья между лидерами. Стены в площадь и счёт не входят.",
  ];
}
