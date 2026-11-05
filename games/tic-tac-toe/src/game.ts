import { actionError, defineGame, type RoundResult, type Seat } from "@asobiba/sdk";
import { z } from "zod";
import { TIC_TAC_TOE_GUIDE } from "./guide";
import { PRESETS } from "./presets";
import {
  allLines,
  BLOCKED,
  checkRules,
  EMPTY,
  indexOf,
  landingRow,
  MAX_SIDE,
  rulesSchema,
  runThrough,
  type TttRules,
} from "./rules";
import {
  BOARD_STYLES,
  BOARD_TEXTURES,
  checkVisual,
  IDLE_ANIMATIONS,
  PIECE_PRESETS,
  PLACE_ANIMATIONS,
  THEMES,
  visualSchema,
  WIN_ANIMATIONS,
} from "./visual";

export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("place"), row: z.int().min(0).max(MAX_SIDE - 1), col: z.int().min(0).max(MAX_SIDE - 1) }),
  z.strictObject({ type: z.literal("drop"), col: z.int().min(0).max(MAX_SIDE - 1) }),
]);
export type TttAction = z.output<typeof actionSchema>;

export interface TttMove {
  index: number;
  seat: Seat;
}

export interface TttState {
  placement: TttRules["placement"];
  width: number;
  height: number;
  /** -1 empty, -2 blocked, otherwise the seat that owns the cell. */
  cells: number[];
  seats: number;
  turnSeat: Seat;
  movesLeft: number;
  turnNumber: number;
  moveCount: number;
  /** Moves of the current turn, or of the previous one until the next move. */
  lastMoves: TttMove[];
  lastMovesTurn: number;
  /** Lines per seat (shown live in most-lines mode). */
  lineCounts: number[];
  /** Cells of winning lines when the round is over. */
  winLines: number[][];
  result: RoundResult | null;
}

export interface TttView extends TttState {
  you: Seat | null;
  /** Cells the viewer may play now (landing cells in gravity mode). */
  legal: number[];
}

function legalCells(state: TttState): number[] {
  if (state.result) return [];
  if (state.placement === "gravity") {
    const out: number[] = [];
    for (let col = 0; col < state.width; col++) {
      const row = landingRow(state.cells, state.width, state.height, col);
      if (row >= 0) out.push(indexOf(state.width, row, col));
    }
    return out;
  }
  return state.cells.flatMap((v, i) => (v === EMPTY ? [i] : []));
}

function others(seats: number, seat: Seat): Seat[] {
  return Array.from({ length: seats }, (_, i) => i).filter((s) => s !== seat);
}

function finishByCount(state: TttState, rules: TttRules): RoundResult {
  const counts = state.lineCounts;
  const target = rules.win.misere ? Math.min(...counts) : Math.max(...counts);
  const best = counts.flatMap((c, i) => (c === target ? [i] : []));
  if (best.length === state.seats || (target === 0 && !rules.win.misere)) {
    return { winners: [], losers: [], draw: true, reason: "most-lines", summary: "поровну линий" };
  }
  return {
    winners: best,
    losers: Array.from({ length: state.seats }, (_, i) => i).filter((s) => !best.includes(s)),
    draw: false,
    reason: "most-lines",
    summary: rules.win.misere ? "меньше всех линий" : "больше всех линий",
  };
}

export const ticTacToe = defineGame({
  id: "tic-tac-toe",
  version: 1,
  title: "Крестики-нолики",
  summary: "Линии на поле до 15×15: 2–4 игрока, гравитация, мизер, несколько ходов за ход, свой визуал",
  kind: "turn",
  rulesSchema,
  visualSchema,
  actionSchema,
  seats: (rules) => ({ min: rules.players, max: rules.players }),
  checkRules,
  checkVisual,

  setup: ({ rules, seats, firstSeat }): TttState => {
    const { width, height, blocked } = rules.board;
    const cells = Array.from({ length: width * height }, () => EMPTY);
    for (const [r, c] of blocked) if (r < height && c < width) cells[indexOf(width, r, c)] = BLOCKED;
    return {
      placement: rules.placement,
      width,
      height,
      cells,
      seats,
      turnSeat: firstSeat,
      movesLeft: rules.turns.firstTurnMoves ?? rules.turns.movesPerTurn,
      turnNumber: 0,
      moveCount: 0,
      lastMoves: [],
      lastMovesTurn: -1,
      lineCounts: Array.from({ length: seats }, () => 0),
      winLines: [],
      result: null,
    };
  },

  currentSeats: (s: TttState) => (s.result ? [] : [s.turnSeat]),
  turnId: (s: TttState) => s.turnNumber,

  legalActions: (s: TttState, _seat, ctx): TttAction[] => {
    const rules = ctx.rules as TttRules;
    return legalCells(s).map((i) =>
      rules.placement === "gravity" ? { type: "drop", col: i % s.width } : { type: "place", row: Math.floor(i / s.width), col: i % s.width },
    );
  },

  applyAction: (s: TttState, seat, action: TttAction, ctx) => {
    const rules = ctx.rules as TttRules;
    if (s.result) return actionError("round_over", "Раунд окончен");
    if (action.col >= s.width) return actionError("out_of_board", "Столбец за пределами поля");
    let row: number;
    if (rules.placement === "gravity") {
      row = landingRow(s.cells, s.width, s.height, action.col);
      if (row < 0) return actionError("column_full", "Столбец заполнен");
    } else {
      if (action.type !== "place") return actionError("wrong_action", 'Здесь фигура ставится в клетку: { type: "place", row, col }');
      row = action.row;
      if (row >= s.height) return actionError("out_of_board", "Строка за пределами поля");
      const v = s.cells[indexOf(s.width, row, action.col)];
      if (v === BLOCKED) return actionError("blocked", "Клетка заблокирована");
      if (v !== EMPTY) return actionError("occupied", "Клетка занята");
    }
    const index = indexOf(s.width, row, action.col);
    const cells = [...s.cells];
    cells[index] = seat;
    const lastMoves = s.lastMovesTurn === s.turnNumber ? [...s.lastMoves, { index, seat }] : [{ index, seat }];
    let next: TttState = { ...s, cells, moveCount: s.moveCount + 1, lastMoves, lastMovesTurn: s.turnNumber };

    const lines = allLines(cells, s.width, s.height, rules.win.line, rules.win.directions);
    next.lineCounts = Array.from({ length: s.seats }, (_, i) => lines.filter((l) => l.seat === i).length);

    if (rules.win.mode === "first-line") {
      const run = rules.win.directions
        .map((d) => runThrough(cells, s.width, s.height, row, action.col, d))
        .find((r) => r.length >= rules.win.line);
      if (run) {
        const result: RoundResult = rules.win.misere
          ? { winners: others(s.seats, seat), losers: [seat], draw: false, reason: "line", summary: "линия в мизере — проигрыш" }
          : { winners: [seat], losers: others(s.seats, seat), draw: false, reason: "line", summary: "собрана линия" };
        return { ...next, winLines: [run], result };
      }
    }

    if (legalCells(next).length === 0) {
      if (rules.win.mode === "most-lines") {
        const result = finishByCount(next, rules);
        const winLines = result.draw ? [] : lines.filter((l) => result.winners.includes(l.seat)).map((l) => l.cells);
        return { ...next, winLines, result };
      }
      return { ...next, result: { winners: [], losers: [], draw: true, reason: "board-full", summary: "ходов не осталось" } };
    }

    if (next.movesLeft - 1 <= 0) {
      next = { ...next, turnSeat: (s.turnSeat + 1) % s.seats, movesLeft: rules.turns.movesPerTurn, turnNumber: s.turnNumber + 1 };
    } else {
      next = { ...next, movesLeft: next.movesLeft - 1 };
    }
    return next;
  },

  passTurn: (s: TttState, _seat, ctx) => ({
    ...s,
    turnSeat: (s.turnSeat + 1) % s.seats,
    movesLeft: (ctx.rules as TttRules).turns.movesPerTurn,
    turnNumber: s.turnNumber + 1,
  }),

  roundResult: (s: TttState) => s.result,

  view: (s: TttState, seat): TttView => ({
    ...s,
    you: seat,
    legal: seat !== null && !s.result && s.turnSeat === seat ? legalCells(s) : [],
  }),

  guide: TIC_TAC_TOE_GUIDE,
  presets: PRESETS,
  slots: [
    { path: "visual.pieces[i]", title: "Фигура игрока i (с нуля)", accepts: ["preset", "asset"], presets: Object.keys(PIECE_PRESETS), advice: "Квадрат с прозрачным фоном, от 256 px. Фигура вписывается в клетку с полями" },
    { path: "visual.board.background", title: "Картинка под всем полем", accepts: ["asset"], advice: "Пропорции поля (ширина:высота), от 768 px по длинной стороне. Лучше спокойная, чтобы фигуры читались" },
    { path: "visual.board.cell", title: "Картинка в каждой клетке", accepts: ["asset"], advice: "Квадрат 128–256 px, бесшовная текстура" },
  ],
  themes: Object.entries(THEMES).map(([id, t]) => ({ id, title: t.title, description: t.description })),
  visualCatalog: {
    pieces: PIECE_PRESETS,
    boardStyles: BOARD_STYLES,
    boardTextures: BOARD_TEXTURES,
    placeAnimations: PLACE_ANIMATIONS,
    winAnimations: WIN_ANIMATIONS,
    idleAnimations: IDLE_ANIMATIONS,
  },
});
