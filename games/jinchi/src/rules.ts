import type { ConfigIssue } from "@asobiba/sdk";
import { z } from "zod";
import { analyzeMap } from './balance';

export const MAX_SIDE = 1000;
export const EMPTY = -1;
export const WALL = -2;

const positionShape = { x: z.int().min(0).max(MAX_SIDE - 1), y: z.int().min(0).max(MAX_SIDE - 1) };
const effectKind = z.enum(["cache", "trap", "reroll", "lock"]);
const effectValue = z.int().min(1).max(100_000).optional();
export const cellPositionSchema = z.strictObject(positionShape);
export const effectCellSchema = z.strictObject({ ...positionShape, kind: z.enum(["cache", "trap", "reroll", "lock", "mystery"]), value: effectValue });
export const weightedEffectSchema = z.strictObject({ kind: effectKind, value: effectValue, weight: z.int().min(0).max(1000) });
export type CellPosition = z.output<typeof cellPositionSchema>;
export type EffectKind = z.output<typeof effectKind>;
export type EffectCell = z.output<typeof effectCellSchema>;
export type WeightedEffect = z.output<typeof weightedEffectSchema>;

export const DEFAULT_MYSTERY_POOL: WeightedEffect[] = [
  { kind: "cache", value: 25, weight: 35 }, { kind: "trap", value: 15, weight: 20 },
  { kind: "reroll", weight: 30 }, { kind: "lock", weight: 15 },
];

const defaultRows = Array.from({ length: 16 }, (_, y) => y < 2 ? "11.............." : y >= 14 ? "..............22" : ".".repeat(16));

export const rulesSchema = z.strictObject({
  map: z.strictObject({
    width: z.int().min(3).max(MAX_SIDE).default(16).meta({ description: "Ширина карты в клетках (3–1000)" }),
    height: z.int().min(3).max(MAX_SIDE).default(16).meta({ description: "Высота карты в клетках (3–1000)" }),
    rows: z.array(z.string().max(MAX_SIDE)).max(MAX_SIDE).default(defaultRows).meta({ description: "Ровно height строк длины width. . — пусто, # — стена, 1…8 — стартовые зоны. В координатах x — столбец, y — строка, с нуля" }),
    expectedPlayers: z.int().min(2).max(8).optional().meta({ description: "Проверенный состав сбалансированной карты" }),
    generation: z.strictObject({ version: z.literal(1), seed: z.int(), balanced: z.boolean(), players: z.int().min(2).max(8), shape: z.enum(["rectangle", "circle"]), wallDensity: z.number().min(0).max(45) }).optional().meta({ description: "Происхождение геометрии; баланс заново проверяется сервером" }),
  }).prefault({}).meta({ description: "Карта: размеры и строки клеток" }),
  dice: z.strictObject({
    sides: z.union([z.int().min(2).max(100), z.tuple([z.int().min(2).max(100), z.int().min(2).max(100)])]).default(6).meta({ title: "Грани кубиков", description: "Общее число граней 2–100 или [первый, второй], например [6,20]. Выпало a:b — прямоугольник a×b" }),
    roll: z.enum(["auto", "manual"]).default("auto").meta({ title: "Бросок кубиков", enumNames: ["Автоматически", "По кнопке"], description: "auto — бросок в начале хода, manual — по кнопке «Бросить»" }),
  }).prefault({}).meta({ description: "Два кубика с независимо настраиваемыми гранями" }),
  flags: z.strictObject({
    mode: z.enum(["off", "primary", "bonus"]).default("off"),
    value: z.int().min(1).max(100_000).default(25),
    target: z.int().min(0).max(1000).default(0),
    positions: z.array(cellPositionSchema).max(1000).default([]),
  }).prefault({}).meta({ description: "Одноразовые флаги: выключены, главный критерий или очковый бонус. target — немедленная цель только primary (0 отключает)" }),
  effects: z.strictObject({
    cells: z.array(effectCellSchema).max(1000).default([]),
    mysteryPool: z.array(weightedEffectSchema).max(100).default(() => DEFAULT_MYSTERY_POOL.map(effect => ({ ...effect }))),
  }).prefault({}).meta({ description: "Одноразовые спецклетки и общий взвешенный пул неизвестных исходов. cache/trap меняют очки, reroll даёт заряд до 3, lock запрещает поворот следующего собственного хода" }),
  placement: z.strictObject({
    adjacency: z.enum(["side", "corner"]).default("side").meta({ title: "Соседство", enumNames: ["Стороной", "Стороной или углом"], description: "side — фигура касается своей территории стороной; corner — также углом" }),
    overlapOwn: z.boolean().default(false).meta({ title: "Разрешить накрывать свою территорию", description: "Разрешить накрывать свои клетки, если хотя бы одна клетка фигуры свободна. Чужие клетки и стены накрывать нельзя" }),
  }).prefault({}).meta({ description: "Постановка прямоугольника" }),
  capture: z.strictObject({
    walls: z.boolean().default(true).meta({ title: "Края и стены замыкают кольцо", description: "Края и стены помогают замкнуть кольцо. Из касающихся игрока областей открыты все самые большие, меньшие захватываются" }),
    diagonal: z.boolean().default(true).meta({ title: "Касание углом замыкает кольцо", description: "Касание своих клеток углом замыкает кольцо (заливка по 4 соседям, иначе по 8)" }),
    opponents: z.enum(["all", "except-starts", "none"]).default("all").meta({ title: "Чужие клетки внутри кольца", enumNames: ["Забирать все", "Кроме стартовых зон", "Не забирать"], description: "Чужие клетки внутри кольца: все забираются, кроме исходных баз или не забираются" }),
  }).prefault({}).meta({ title: "Окружение", description: "Окружение проверяется после постановки только для походившего игрока" }),
  starts: z.strictObject({
    assignment: z.enum(["random", "ordered"]).default("random").meta({ title: "Раздача стартовых позиций", enumNames: ["Случайно", "По порядку"], description: "random — случайная раздача стартовых позиций по зерну, ordered — по номерам" }),
    unused: z.enum(["empty", "wall"]).default("empty").meta({ title: "Лишние стартовые зоны", enumNames: ["Свободные клетки", "Стены"], description: "Лишние стартовые зоны при неполном составе становятся пустыми клетками или стенами" }),
  }).prefault({}).meta({ description: "Стартовые позиции и состав 2–8 игроков" }),
  end: z.strictObject({
    skipRounds: z.int().min(0).max(100).default(2).meta({ title: "Кругов подряд без постановок", description: "Кругов подряд без постановок до конца партии (0 — выключено, по умолчанию 2)" }),
    maxRounds: z.int().min(0).max(10000).default(0).meta({ title: "Лимит кругов", description: "Лимит кругов (0 — выключено). Круг — каждый оставшийся игрок сходил или пропустил" }),
    targetPercent: z.number().min(0).max(100).refine((n) => n === 0 || n >= 10, { error: "Доля победы — 10–100 %, либо 0 для отключения" }).default(0).meta({ title: "Доля карты для победы, %", description: "Немедленная победа при доле карты 10–100 % (0 — выключено). Стены в площадь не входят" }),
  }).prefault({}).meta({ title: "Конец партии", description: "Всегда конец, если остался один игрок или ни у кого нет постановки 1×1" }),
}).prefault({}).meta({ description: "Правила Jinchi v1" });

export type JinchiRules = z.output<typeof rulesSchema>;

export function diceSides(rules: Pick<JinchiRules, "dice">): [number, number] {
  return typeof rules.dice.sides === "number" ? [rules.dice.sides, rules.dice.sides] : rules.dice.sides;
}

export function startPositions(rules: JinchiRules): number[] {
  const positions = new Set<number>();
  for (const row of rules.map.rows) for (let x = 0; x < row.length; x++) {
    const value = row.charCodeAt(x) - 48;
    if (value >= 1 && value <= 8) positions.add(value);
  }
  return [...positions].sort((a, b) => a - b);
}

/** Cross-field validation also accepts unfinished editor maps without indexing missing rows. */
export function checkRules(rules: JinchiRules): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const { width, height, rows } = rules.map;
  for (const [key, value] of [["width", width], ["height", height]] as const) {
    if (!Number.isInteger(value) || value < 3 || value > MAX_SIDE) issues.push({ path: `map.${key}`, code: "map-size", message: "Каждая сторона карты должна быть от 3 до 1000 клеток", hint: "Задайте целый размер 3–1000", severity: "error" });
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
  const [firstSides, secondSides] = diceSides(rules);
  if (!((width >= firstSides && height >= secondSides) || (height >= firstSides && width >= secondSides))) issues.push({ path: "dice.sides", code: "large-dice", message: "Крупные броски не помещаются на карте", hint: "Уменьшите кубики или увеличьте карту", severity: "warning" });
  const occupied = new Set<number>();
  const validateObject = (object: CellPosition, path: string) => {
    const index = object.y * width + object.x;
    if (!Number.isInteger(object.x) || !Number.isInteger(object.y) || object.x < 0 || object.y < 0 || object.x >= width || object.y >= height || rows[object.y]?.[object.x] !== ".") issues.push({ path, code: "object-position", message: "Объект должен находиться на свободной клетке внутри карты", hint: "Выберите клетку без стены или базы", severity: "error" });
    if (occupied.has(index)) issues.push({ path, code: "object-overlap", message: "Два объекта занимают одну клетку", hint: "Разместите объекты на разных клетках", severity: "error" });
    occupied.add(index);
  };
  rules.flags.positions.forEach((object, i) => validateObject(object, `flags.positions[${i}]`));
  rules.effects.cells.forEach((object, i) => validateObject(object, `effects.cells[${i}]`));
  if (rules.flags.mode === "off" && rules.flags.positions.length > 0) issues.push({ path: "flags.mode", code: "flags-disabled", message: "Для размещённых флагов нужен главный или бонусный режим", hint: "Включите флаги или уберите их координаты", severity: "error" });
  if (rules.flags.mode !== "off" && rules.flags.positions.length === 0) issues.push({ path: "flags.positions", code: "flags-empty", message: "Режиму флагов нужен хотя бы один флаг", hint: "Добавьте координаты флагов", severity: "error" });
  if (rules.flags.target > rules.flags.positions.length || (rules.flags.target > 0 && rules.flags.mode !== "primary")) issues.push({ path: "flags.target", code: "flag-target", message: "Цель должна быть достижима и доступна только главному режиму флагов", hint: "Задайте 0 либо не больше числа флагов в primary", severity: "error" });
  if (rules.flags.mode !== "off" && rules.end.targetPercent > 0) issues.push({ path: "end.targetPercent", code: "flag-area-conflict", message: "Доля территории несовместима с режимом флагов", hint: "Поставьте targetPercent: 0", severity: "error" });
  if (rules.effects.cells.some(cell => cell.kind === "mystery") && !rules.effects.mysteryPool.some(effect => effect.weight > 0)) issues.push({ path: "effects.mysteryPool", code: "mystery-empty", message: "Неизвестной клетке нужен хотя бы один исход с положительным весом", hint: "Добавьте исход или увеличьте вес", severity: "error" });
  let area = 0;
  for (const row of rows) for (let x = 0; x < width; x++) if (row[x] !== "#") area++;
  const activeEffects = [...rules.effects.cells, ...(rules.effects.cells.some(cell => cell.kind === 'mystery') ? rules.effects.mysteryPool : [])];
  const strong = activeEffects.some(effect => (effect.kind === "cache" || effect.kind === "trap") && (effect.value ?? (effect.kind === "cache" ? 25 : 15)) > area * 0.1);
  if (strong) issues.push({ path: "effects", code: "strong-effect", message: "Один эффект меняет больше 10 % игровой площади в очках", hint: "Уменьшите начисление/штраф либо подтвердите намеренно сильный эффект", severity: "warning" });
  if (rules.map.generation?.balanced && (rules.map.expectedPlayers !== positions.length || rules.map.generation.players !== positions.length)) issues.push({ path: "map.expectedPlayers", code: "balanced-players", message: "Состав сбалансированной карты не совпадает с числом баз", hint: "Пересоберите карту под нужное число игроков", severity: "error" });
  if (rules.map.generation?.balanced && !issues.some(issue => issue.severity !== 'warning')) issues.push(...analyzeMap(rules).issues);
  return issues;
}

export function rulesText(rules: JinchiRules): string[] {
  const { dice, placement, capture, starts, end } = rules;
  const [firstSides, secondSides] = diceSides(rules);
  return [
    `Кубики d${firstSides} + d${secondSides}: выпало a:b — ставьте прямоугольник a×b или b×a. Бросок ${dice.roll === "auto" ? "автоматический" : "по кнопке «Бросить»"}.`,
    `Фигура целиком на карте, без стен и чужих клеток. Касается своей территории ${placement.adjacency === "side" ? "стороной" : "стороной или углом"}. ${placement.overlapOwn ? "Можно накрывать свои клетки, если хотя бы одна клетка свободна." : "Ставится только на свободные клетки."}`,
    capture.walls ? "Кольцо замыкают свои клетки, края карты и стены. Среди касающихся вас областей все самые большие остаются открытыми, меньшие захватываются." : "Кольцо замыкают только свои клетки. Стены и края карты не помогают окружению; стены внутри кольца остаются стенами.",
    `Касание углом ${capture.diagonal ? "замыкает" : "не замыкает"} кольцо. ${capture.opponents === "all" ? "Все чужие клетки внутри кольца становятся вашими. Игрок без клеток выбывает." : capture.opponents === "except-starts" ? "Чужие клетки захватываются, кроме исходных стартовых зон." : "Чужие клетки внутри кольца сохраняют владельца."}`,
    `Стартовые позиции ${starts.assignment === "random" ? "раздаются случайно по зерну партии" : "раздаются по порядку номеров"}; лишние зоны становятся ${starts.unused === "empty" ? "свободными клетками" : "стенами"}.`,
    "Если прямоугольнику некуда встать ни в одном повороте, ход пропускается автоматически. Добровольного пропуска нет. Круг — каждый оставшийся игрок сходил или пропустил.",
    `Партия кончается, когда карта поделена (ни у кого нет места даже для 1×1) или остался один игрок.${end.skipRounds > 0 ? ` Также после ${end.skipRounds} кругов подряд без постановок.` : " Лимит пропусков выключен."}${end.maxRounds > 0 ? ` Лимит: ${end.maxRounds} кругов.` : ""}${end.targetPercent > 0 ? ` Для немедленной победы нужно ${end.targetPercent} % площади карты.` : ""}`,
    rules.flags.mode === "primary" ? `Сначала сравниваются захваченные флаги, при равенстве — клетки и баланс эффектов.${rules.flags.target > 0 ? ` Немедленная цель — ${rules.flags.target} флагов.` : ""} Сбор всех флагов завершает раунд.` : rules.flags.mode === "bonus" ? `Очки = клетки + захваченные флаги × ${rules.flags.value} + баланс эффектов. Сбор всех флагов сам по себе не завершает раунд.` : "Побеждает игрок с наибольшими очками: клетки + баланс эффектов.",
    "Равный лучший результат — ничья между оставшимися лидерами. Последний игрок с территорией побеждает в любом режиме. Стены в площадь и счёт не входят.",
    ...(rules.effects.cells.length > 0 ? ["Спецклетки срабатывают один раз при постановке или окружении: тайник и ловушка меняют очки, запасной бросок даёт заряд (не более 3), скованность запрещает поворот следующего собственного хода. Заряд перебрасывает оба кубика один раз за ход без продления таймера."] : []),
  ];
}
