import type { ConfigDocument, ConfigSummary, GameInformation, TuningDirection } from "@asobiba/sdk";
import type { TttRules } from "./rules";

export const TIC_TAC_TOE_INFO: GameInformation = {
  overview: "Знакомые крестики-нолики, у которых можно менять поле, линии и способ постановки фигур.",
  audience: "Для короткой дуэли и компании, которой нравятся понятные тактические игры.",
  players: { min: 2, max: 4 },
  goal: "Соберите линию своих фигур. Варианты позволяют считать все линии или побеждать, избегая их.",
  turn: "В свой ход поставьте фигуру в свободную клетку; при гравитации выберите столбец, и фигура упадёт вниз.",
  example: "У соперника уже две фигуры в ряд: закрыть третью клетку или продолжить собственную линию?",
  highlights: ["Блокируйте соперников и создавайте сразу несколько угроз.", "Размер поля, число игроков и длина линии меняют характер партии."],
};

export const TIC_TAC_TOE_PROMPT_EXAMPLES = [
  "Собери крестики-нолики на троих: поле 7×7, четыре в ряд, центр заблокирован, 20 секунд на ход.",
  "Хочу дуэль с падающими фишками: поле семь столбцов на шесть строк, четыре в ряд и три раунда со сменой первого игрока.",
];

export const TIC_TAC_TOE_TUNING: TuningDirection[] = [
  { id: "board", title: "Размер поля", description: "Ширина и высота от 3 до 15 клеток.", paths: ["rules.board.width", "rules.board.height"], options: [{ label: "Маленькое поле", consequence: "Каждая клетка важна, партия заканчивается быстрее." }, { label: "Большое поле", consequence: "Больше пространства для нескольких угроз. Можно удлинить линию для победы." }] },
  { id: "line", title: "Линия", description: "От 3 до 10 фигур подряд. Линия должна помещаться на поле хотя бы в одном выбранном направлении.", paths: ["rules.win.line", "rules.win.directions"], options: [{ label: "Короткая линия", consequence: "Угрозы возникают раньше." }, { label: "Только горизонтали и вертикали", consequence: "Диагонали вне зачёта." }] },
  { id: "players", title: "Состав", description: "От двух до четырёх игроков.", paths: ["rules.players"], options: [{ label: "Дуэль", consequence: "Можно планировать ответ одного соперника." }, { label: "Трое или четверо", consequence: "За один круг поле меняется сильнее; полезно увеличить его." }] },
  { id: "placement", title: "Постановка", description: "Свободная клетка или падение в столбце, от 1 до 3 фигур за ход.", paths: ["rules.placement", "rules.turns.movesPerTurn", "rules.turns.firstTurnMoves"], options: [{ label: "Гравитация", consequence: "Игрок выбирает столбец, фигура падает на нижнюю доступную клетку." }, { label: "Несколько фигур за ход", consequence: "Появляются комбинации. Если первый ход короче победной линии, его нельзя выиграть сразу." }] },
  { id: "obstacles", title: "Препятствия", description: "До 80 заблокированных клеток.", paths: ["rules.board.blocked"], options: [{ label: "Вырезать центр или углы", consequence: "Линии через препятствия не проходят; при гравитации клетки ниже них недостижимы." }] },
  { id: "victory", title: "Победа", description: "Первая линия, все линии или мизер.", paths: ["rules.win.mode", "rules.win.misere"], options: [{ label: "Первая линия", consequence: "Раунд завершается сразу при линии." }, { label: "Больше линий", consequence: "Игра идёт до заполнения поля." }, { label: "Мизер", consequence: "В первой линии её автор проигрывает; при подсчёте линий лучше иметь меньше." }] },
  { id: "style", title: "Оформление и серия", description: "Тема, фигуры, таймер и несколько раундов.", paths: ["visual.theme", "visual.pieces", "series.rounds", "timer.turnSeconds"], options: [{ label: "Свои фигуры", consequence: "Каждое место узнаётся по собственной картинке." }, { label: "Серия с таймером", consequence: "Первый игрок может меняться; времени на размышление меньше." }] },
];

export function summarizeTicTacToeConfig(config: ConfigDocument<TttRules>): ConfigSummary {
  const r = config.rules;
  const names = { horizontal: "горизонталь", vertical: "вертикаль", diagonal: "диагональ ↘", antiDiagonal: "диагональ ↙" };
  const directions = r.win.directions.map((d) => names[d]).join(", ");
  const victory = r.win.mode === "most-lines"
    ? `Играем до заполнения: побеждает тот, у кого ${r.win.misere ? "меньше" : "больше"} линий. Равный лучший результат — ничья. Сплошная линия длиннее нужной считается одной.`
    : r.win.misere ? "Первая собранная линия приносит поражение её автору. Без линии и свободных клеток — ничья." : "Первая собранная линия приносит победу. Если свободных клеток больше нет и линии нет — ничья.";
  const placement = r.placement === "gravity" ? "Выберите столбец: фигура падает до нижней занятой клетки или препятствия." : "Поставьте фигуру в любую свободную клетку.";
  return {
    players: { min: r.players, max: r.players }, objective: r.win.misere ? "Избегайте линий своих фигур." : "Собирайте линии своих фигур.",
    turn: `${placement} За ход по ${r.turns.movesPerTurn} фигуры; в первый ход ${r.turns.firstTurnMoves ?? r.turns.movesPerTurn}.`, victory,
    highlights: [`Поле ${r.board.width}×${r.board.height}; игроков: ${r.players}.`, `Линия из ${r.win.line}; направления: ${directions}${r.win.directions.some((d) => d === "diagonal" || d === "antiDiagonal") ? "." : "; диагонали выключены."}`, placement, `${r.win.mode === "most-lines" ? "Считаем все линии" : "До первой линии"}${r.win.misere ? ", мизер" : ""}.`, `Препятствий: ${r.board.blocked.length}.`],
    sections: [{ id: "moves", title: "Постановка и линии", items: [`За ход по ${r.turns.movesPerTurn} фигуры; первый ход — ${r.turns.firstTurnMoves ?? r.turns.movesPerTurn}.`, `Направления: ${directions}.`, "Нельзя ставить в занятую или заблокированную клетку; линия не проходит сквозь препятствие.", ...(r.placement === "gravity" ? ["Клетки под препятствиями недостижимы."] : [])] }],
  };
}
