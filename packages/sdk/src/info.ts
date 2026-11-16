import type { ConfigDocument } from "./config";
import type { AnyGame } from "./game";

/** Developer-written introduction, available before a configuration exists. */
export interface GameInformation {
  overview: string;
  audience: string;
  players: { min: number; max: number };
  goal: string;
  turn: string;
  example: string;
  highlights: string[];
}

/** Suggestions describe supported choices and their consequences, never executable patches. */
export interface TuningDirection {
  id: string;
  title: string;
  description: string;
  paths: string[];
  options: { label: string; consequence: string }[];
}

export interface AuthorInformation {
  title?: string;
  text?: string;
}

export interface InformationSection {
  id: string;
  title: string;
  items: string[];
}

/** Public facts selected explicitly by the game. No rules, answers or media references. */
export interface ConfigSummary {
  players: { min: number; max: number };
  objective: string;
  turn: string;
  victory: string;
  highlights: string[];
  sections: InformationSection[];
}

export interface ConfigInformation {
  game: GameInformation;
  summary: ConfigSummary;
  author?: AuthorInformation;
}

export function gameInformation(game: AnyGame): GameInformation {
  return game.info ?? {
    overview: game.summary, audience: "Для игроков и наблюдателей", players: { min: 1, max: 1 },
    goal: game.summary, turn: "Следуйте подсказкам на доске.", example: "Правила этой партии приведены ниже.", highlights: [],
  };
}

/** Receives the checked original document, not `presentRules` or a public lobby config. */
export function describeConfig(game: AnyGame, config: ConfigDocument): ConfigInformation {
  const base: ConfigSummary = game.summarizeConfig?.(config) ?? {
    players: game.seats(config.rules), objective: game.summary, turn: "Следуйте подсказкам на доске.",
    victory: "Итог определяют правила игры.", highlights: [], sections: [],
  };
  const sections = [...base.sections];
  if (!game.turnBudgetSeconds && game.kind === "turn") {
    const policy = game.timeoutPolicy ?? config.timer.onTimeout;
    const consequence = { skip: "ход пропускается", random: "сервер делает случайный допустимый ход", lose: "поражение в раунде" }[policy];
    sections.push({ id: "timer", title: "Время на ход", items: [config.timer.turnSeconds > 0 ? `${config.timer.turnSeconds} с; по истечении времени ${consequence}.` : "Без таймера хода."] });
  }
  const first = { rotate: "Первый игрок меняется по кругу.", loser: "Следующий раунд начинает проигравший.", winner: "Следующий раунд начинает победитель.", same: "Первым остаётся тот же игрок." }[config.series.firstPlayer];
  sections.push({ id: "series", title: "Серия", items: [config.series.rounds === 1 ? "Один раунд SDK." : `Раундов: ${config.series.rounds}. ${first} ${config.series.stopWhenDecided ? "Серия заканчивается, когда лидера уже не догнать." : "Играем все раунды."} Побеждает игрок с наибольшим числом побед в раундах.`] });
  const author = config.info?.title?.trim() || config.info?.text?.trim() ? { ...config.info } : undefined;
  return { game: gameInformation(game), summary: { ...base, players: game.seats(config.rules), sections }, ...(author ? { author } : {}) };
}
