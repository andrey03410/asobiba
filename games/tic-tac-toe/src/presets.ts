import type { ConfigPreset } from "@asobiba/sdk";

export const PRESETS: ConfigPreset[] = [
  {
    id: "classic",
    title: "Классика",
    description: "Поле 3×3, три в ряд, двое игроков",
    config: { title: "Классические крестики-нолики", visual: { theme: "classic" } },
  },
  {
    id: "gomoku",
    title: "Гомоку",
    description: "Поле 15×15, пять в ряд",
    config: { title: "Гомоку", rules: { board: { width: 15, height: 15 }, win: { line: 5 } }, visual: { theme: "paper" } },
  },
  {
    id: "connect-four",
    title: "Четыре в ряд",
    description: "Поле 7×6 с гравитацией: выбираешь столбец, фишка падает вниз",
    config: {
      title: "Четыре в ряд",
      rules: { board: { width: 7, height: 6 }, win: { line: 4 }, placement: "gravity" },
      visual: { theme: "neon", pieces: [{ preset: "ring", color: "#ff3d6e" }, { preset: "ring", color: "#ffd23d" }], animations: { place: { preset: "drop" } } },
    },
  },
  {
    id: "connect6",
    title: "Connect6",
    description: "Поле 15×15, шесть в ряд, по две фигуры за ход, первый ход — одна",
    config: {
      title: "Connect6",
      rules: { board: { width: 15, height: 15 }, win: { line: 6 }, turns: { movesPerTurn: 2, firstTurnMoves: 1 } },
      visual: { theme: "paper" },
    },
  },
  {
    id: "misere",
    title: "Мизер",
    description: "Поле 4×4: собрал три в ряд — проиграл",
    config: { title: "Мизер", rules: { board: { width: 4, height: 4 }, win: { line: 3, misere: true } }, visual: { theme: "candy" } },
  },
  {
    id: "most-lines",
    title: "Больше линий",
    description: "Поле 5×5 заполняется до конца, побеждает тот, у кого больше троек",
    config: { title: "Больше линий", rules: { board: { width: 5, height: 5 }, win: { line: 3, mode: "most-lines" } }, visual: { theme: "candy" } },
  },
  {
    id: "trio",
    title: "Трое",
    description: "Три игрока на поле 7×7, четыре в ряд",
    config: { title: "Крестики-нолики на троих", rules: { board: { width: 7, height: 7 }, players: 3, win: { line: 4 } }, visual: { theme: "neon" } },
  },
  {
    id: "party",
    title: "Вечеринка",
    description: "Поле 5×5 с дыркой в центре, четыре в ряд, серия из трёх раундов, 20 секунд на ход, смешные фигуры",
    config: {
      title: "Вечеринка",
      rules: { board: { width: 5, height: 5, blocked: [[2, 2]] }, win: { line: 4 } },
      series: { rounds: 3 },
      timer: { turnSeconds: 20, onTimeout: "random" },
      visual: { theme: "party" },
    },
  },
];
