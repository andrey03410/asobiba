import type { ConfigIssue } from "@asobiba/sdk";
import { z } from "zod";

export const MAX_SIDE = 15;
export const DIRECTIONS = ["horizontal", "vertical", "diagonal", "antiDiagonal"] as const;
export type Direction = (typeof DIRECTIONS)[number];

const DIRECTION_STEPS: Record<Direction, [number, number]> = {
  horizontal: [0, 1],
  vertical: [1, 0],
  diagonal: [1, 1],
  antiDiagonal: [1, -1],
};

export const rulesSchema = z
  .strictObject({
    board: z
      .strictObject({
        width: z.int().min(3).max(MAX_SIDE).default(3).meta({ description: "Ширина поля в клетках (3–15)" }),
        height: z.int().min(3).max(MAX_SIDE).default(3).meta({ description: "Высота поля в клетках (3–15)" }),
        blocked: z
          .array(z.tuple([z.int().min(0).max(MAX_SIDE - 1), z.int().min(0).max(MAX_SIDE - 1)]))
          .max(80)
          .default([])
          .meta({ description: "Заблокированные клетки [строка, столбец], счёт с нуля сверху слева. В них нельзя ходить, линии через них не проходят" }),
      })
      .prefault({})
      .meta({ description: "Поле" }),
    players: z.int().min(2).max(4).default(2).meta({ description: "Число игроков (2–4). У каждого своя фигура" }),
    win: z
      .strictObject({
        line: z.int().min(3).max(10).default(3).meta({ description: "Сколько фигур подряд нужно для линии (3–10)" }),
        directions: z
          .array(z.enum(DIRECTIONS))
          .min(1)
          .max(4)
          .default([...DIRECTIONS])
          .meta({ description: "Какие направления считаются линией: horizontal, vertical, diagonal (↘), antiDiagonal (↙)" }),
        mode: z
          .enum(["first-line", "most-lines"])
          .default("first-line")
          .meta({ description: "first-line — раунд заканчивается на первой линии; most-lines — играем до заполнения поля, побеждает тот, у кого больше линий" }),
        misere: z.boolean().default(false).meta({ description: "Мизер: собрал линию — проиграл (в most-lines побеждает тот, у кого линий меньше)" }),
      })
      .prefault({})
      .meta({ description: "Условие победы" }),
    placement: z
      .enum(["free", "gravity"])
      .default("free")
      .meta({ description: "free — фигура ставится в любую свободную клетку; gravity — выбирается столбец, фигура падает вниз до препятствия" }),
    turns: z
      .strictObject({
        movesPerTurn: z.int().min(1).max(3).default(1).meta({ description: "Сколько фигур игрок ставит за ход (1–3)" }),
        firstTurnMoves: z.int().min(1).max(3).optional().meta({ description: "Сколько фигур на самом первом ходу раунда. По умолчанию как movesPerTurn. Connect6: 1, а дальше по 2" }),
      })
      .prefault({})
      .meta({ description: "Ходы" }),
  })
  .prefault({})
  .meta({ description: "Правила крестиков-ноликов" });

export type TttRules = z.output<typeof rulesSchema>;

export function maxRunFor(rules: TttRules): number {
  const { width, height } = rules.board;
  let best = 0;
  for (const d of new Set(rules.win.directions)) {
    if (d === "horizontal") best = Math.max(best, width);
    if (d === "vertical") best = Math.max(best, height);
    if (d === "diagonal" || d === "antiDiagonal") best = Math.max(best, Math.min(width, height));
  }
  return best;
}

export function checkRules(rules: TttRules): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const { width, height, blocked } = rules.board;
  const dirs = rules.win.directions;
  if (new Set(dirs).size !== dirs.length) {
    issues.push({ path: "win.directions", code: "duplicate", message: "Направления повторяются", hint: "Оставьте каждое направление один раз" });
  }
  const maxRun = maxRunFor(rules);
  if (rules.win.line > maxRun) {
    issues.push({
      path: "win.line",
      code: "line_too_long",
      message: `Линию из ${rules.win.line} не уложить: самая длинная линия по выбранным направлениям — ${maxRun}`,
      hint: "Уменьшите win.line, увеличьте поле или добавьте направления",
    });
  }
  const seen = new Set<string>();
  blocked.forEach(([r, c], i) => {
    if (r >= height || c >= width) {
      issues.push({ path: `board.blocked[${i}]`, code: "out_of_board", message: `Клетка [${r}, ${c}] вне поля ${width}×${height}`, hint: `Строка 0–${height - 1}, столбец 0–${width - 1}` });
    }
    const key = `${r}:${c}`;
    if (seen.has(key)) issues.push({ path: `board.blocked[${i}]`, code: "duplicate", message: `Клетка [${r}, ${c}] указана дважды` });
    seen.add(key);
  });
  const free = width * height - seen.size;
  if (free < rules.win.line) {
    issues.push({ path: "board.blocked", code: "too_many_blocked", message: `Свободных клеток ${free} — меньше длины линии`, hint: "Уберите часть заблокированных клеток" });
  }
  const first = rules.turns.firstTurnMoves ?? rules.turns.movesPerTurn;
  if (first >= rules.win.line) {
    issues.push({
      path: "turns.firstTurnMoves",
      code: "instant_win",
      message: `За первый ход ставится ${first} фигур — первый игрок соберёт линию сразу`,
      hint: "Сделайте firstTurnMoves меньше win.line",
      severity: "warning",
    });
  }
  if (rules.placement === "gravity" && blocked.length > 0) {
    issues.push({
      path: "board.blocked",
      code: "gravity_shadow",
      message: "При гравитации клетки под заблокированными недостижимы",
      severity: "warning",
    });
  }
  return issues;
}

export const EMPTY = -1;
export const BLOCKED = -2;

export function indexOf(width: number, row: number, col: number): number {
  return row * width + col;
}

/** Run of `seat` through (row, col) along one direction, as cell indexes. */
export function runThrough(cells: readonly number[], width: number, height: number, row: number, col: number, dir: Direction): number[] {
  const seat = cells[indexOf(width, row, col)];
  const [dr, dc] = DIRECTION_STEPS[dir];
  const run = [indexOf(width, row, col)];
  for (const sign of [1, -1]) {
    let r = row + dr * sign;
    let c = col + dc * sign;
    while (r >= 0 && r < height && c >= 0 && c < width && cells[indexOf(width, r, c)] === seat) {
      if (sign === 1) run.push(indexOf(width, r, c));
      else run.unshift(indexOf(width, r, c));
      r += dr * sign;
      c += dc * sign;
    }
  }
  return run;
}

/** All maximal runs of at least `line` per seat along the given directions. */
export function allLines(cells: readonly number[], width: number, height: number, line: number, directions: readonly Direction[]): { seat: number; cells: number[] }[] {
  const out: { seat: number; cells: number[] }[] = [];
  for (const dir of new Set(directions)) {
    const [dr, dc] = DIRECTION_STEPS[dir];
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const seat = cells[indexOf(width, row, col)] ?? EMPTY;
        if (seat < 0) continue;
        const pr = row - dr;
        const pc = col - dc;
        // start of a maximal run only
        if (pr >= 0 && pr < height && pc >= 0 && pc < width && cells[indexOf(width, pr, pc)] === seat) continue;
        const run: number[] = [];
        let r = row;
        let c = col;
        while (r >= 0 && r < height && c >= 0 && c < width && cells[indexOf(width, r, c)] === seat) {
          run.push(indexOf(width, r, c));
          r += dr;
          c += dc;
        }
        if (run.length >= line) out.push({ seat, cells: run });
      }
    }
  }
  return out;
}

/** Row where a piece dropped into `col` lands, or -1 if the column is full. */
export function landingRow(cells: readonly number[], width: number, height: number, col: number): number {
  if (cells[indexOf(width, 0, col)] !== EMPTY) return -1;
  let row = 0;
  while (row + 1 < height && cells[indexOf(width, row + 1, col)] === EMPTY) row++;
  return row;
}
