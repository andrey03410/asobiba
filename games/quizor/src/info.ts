import type { ConfigDocument, ConfigSummary, GameInformation, TuningDirection } from "@asobiba/sdk";
import { resolveSettings, type QuizorRules, type Settings } from "./rules";

export const QUIZOR_INFO: GameInformation = {
  overview: "Конструктор квизов: вопросы идут подряд или выбираются на табло, ответы можно давать тайно, по очереди или после нажатия кнопки.",
  audience: "Для тематической встречи, викторины с ведущим или самостоятельной тренировки.", players: { min: 1, max: 16 },
  goal: "Отвечайте на вопросы, набирайте очки и учитывайте правила финала.",
  turn: "Прочитайте или посмотрите задание, дождитесь открытия ответа и заполните доступные поля. При кнопке сначала получите право ответить.",
  example: "На табло остались знакомая тема за 100 и сложная за 300: выбрать надёжные очки или рискнуть ради лидерства?",
  highlights: ["Текст, числа, выбор, порядок, соответствия, списки, точки и устные ответы.", "Судейство и время задаются правилами; будущие вопросы и эталоны скрыты."],
};

export const QUIZOR_TUNING: TuningDirection[] = [
  { id: "topic", title: "Тема", description: "Содержание вопросов и оформление раундов готовит автор.", paths: ["rules.rounds"], options: [{ label: "Одна тема", consequence: "Можно глубже проверить знания компании." }, { label: "Смесь тем", consequence: "У каждого участника больше шансов найти знакомую область." }] },
  { id: "volume", title: "Объём", description: "Число раундов, вопросов и выборка take.", paths: ["rules.rounds", "rules.rounds[].take"], options: [{ label: "Короткий квиз", consequence: "Быстрее узнаем итог; каждая ошибка весомее." }, { label: "Несколько раундов", consequence: "Можно менять форматы и дать возможность отыграться." }] },
  { id: "answers", title: "Форматы ответа", description: "От одного текстового поля до составного задания.", paths: ["rules.rounds[].questions[].fields"], options: [{ label: "Текст или число", consequence: "Ответ нужно придумать самостоятельно." }, { label: "Выбор, порядок, соответствие", consequence: "Можно проверить узнавание и связи между предложенными элементами." }, { label: "Устный ответ", consequence: "Нужен поддержанный способ человеческого судейства." }] },
  { id: "turns", title: "Режим хода", description: "Тайно, кнопка, выбравший или по очереди.", paths: ["rules.defaults.mode", "rules.rounds[].format"], options: [{ label: "Все тайно", consequence: "Каждый отвечает независимо, чужие ответы не помогают." }, { label: "Кнопка", consequence: "Нужно первым заявить готовность; учитывается окно одновременных нажатий." }, { label: "Табло", consequence: "Игроки выбирают тему и стоимость следующего вопроса." }] },
  { id: "judge", title: "Судейство", description: "Алгоритм, ведущий, помощь, голосование, лучший ответ, самопроверка или опрос.", paths: ["rules.defaults.judge", "rules.presenter"], options: [{ label: "Алгоритм", consequence: "Эталон и допуски проверяются одинаково для всех." }, { label: "Человек", consequence: "Ведущий, голосование или самопроверка пригодны для открытых и устных заданий." }] },
  { id: "difficulty", title: "Сложность и приёмка", description: "Стоимость, частичные оценки и допустимые варианты.", paths: ["rules.defaults.strictness", "rules.defaults.value", "rules.rounds[].questions[].fields"], options: [{ label: "Мягче к опечаткам", consequence: "Небольшая ошибка ввода может не лишить очков; примеры проверяются config_probe." }, { label: "Частичные оценки", consequence: "Неполный ответ может принести часть стоимости." }] },
  { id: "tempo", title: "Таймеры и финал", description: "Время ответа, темп, ставки и правила окончания.", paths: ["rules.defaults.timers", "rules.defaults.pacing", "rules.final"], options: [{ label: "Без лимита ответа", consequence: "Есть время подумать; смена фаз всё равно следует настройкам квиза." }, { label: "Финал со ставками", consequence: "Итог может измениться последним вопросом." }, { label: "Финальная дуэль", consequence: "Победа зависит от заданного числа выигранных вопросов." }] },
];

const MODES: Record<Settings["mode"], string> = { secret: "тайные ответы всех", buzz: "честная кнопка", chooser: "отвечает выбравший", turns: "по очереди" };
const JUDGES: Record<Settings["judge"], string> = { algorithm: "алгоритм", presenter: "ведущий", assisted: "алгоритм с помощью ведущего", vote: "голосование", best: "выбор лучшего ответа", self: "самопроверка", ai: "AI (недоступен)", poll: "опрос мнений" };
const FIELD_NAMES: Record<string, string> = { text: "текст", number: "число", choice: "выбор", order: "порядок", match: "соответствие", list: "перечисление", point: "точка", oral: "устно" };
const FINALS: Record<QuizorRules["final"]["type"], string> = { none: "Без отдельного финала", "elimination-wager": "Финал с выбыванием и ставкой", wager: "Финал со ставкой", survival: "Финал на выживание", duel: "Финальная дуэль" };

/** Only fixed enums and numerical metadata leave this function. No question contents. */
export function summarizeQuizorConfig(config: ConfigDocument<QuizorRules>): ConfigSummary {
  const r = config.rules;
  const modes = new Set<string>(), judges = new Set<string>(), fields = new Set<string>(), seconds = new Set<number>();
  const observe = (settings: Settings) => { modes.add(MODES[settings.mode]); judges.add(JUDGES[settings.judge]); seconds.add(settings.timers.answerSeconds); };
  const groups = [...r.rounds.map((round) => ({ settings: round.settings, questions: round.questions })), ...(r.final.type !== "none" ? [{ settings: r.final.settings, questions: r.final.questions }] : []), { settings: undefined, questions: r.tiebreak }];
  for (const group of groups) {
    for (const question of group.questions) {
      const layers: Parameters<typeof resolveSettings> = [["quiz", r.defaults], ["round", group.settings], ["question", question.settings]];
      observe(resolveSettings(...layers).settings);
      for (const field of question.fields) { fields.add(FIELD_NAMES[field.type] ?? "составное поле"); observe(resolveSettings(...layers, ["field", field.settings]).settings); }
    }
  }
  const presenter = { none: "Без ведущего", optional: "Ведущий по желанию", required: "Для старта нужен ведущий" }[r.presenter];
  const count = r.rounds.reduce((total, round) => total + (round.take ?? round.questions.length), 0);
  const timers = [...seconds].sort((a, b) => a - b).map((n) => n === 0 ? "без лимита" : `${n} с`).join(", ");
  const final = FINALS[r.final.type];
  const victory = r.final.directWinner && r.final.type === "duel" ? `Победитель финальной дуэли побеждает напрямую; нужно ${r.final.wins} побед в вопросах.` : "Побеждает оставшийся игрок с наибольшим счётом; итог учитывает финал. При равенстве предусмотрены дополнительные вопросы, а если они не определят победителя — ничья.";
  return {
    players: { ...r.players }, objective: "Набирайте очки за ответы согласно правилам квиза.", turn: `Способы ответа в этом квизе: ${[...modes].join(", ")}. Следуйте подсказкам текущего вопроса.`, victory,
    highlights: [`Игроков: ${r.players.min}–${r.players.max}. ${presenter}.`, `Раундов: ${r.rounds.length}; основных вопросов: ${count}.`, `Режимы: ${[...modes].join(", ")}.`, `Судейство: ${[...judges].join(", ")}.`, `Время ответа: ${timers}.`, `${final}.`],
    sections: [
      { id: "rounds", title: "Структура квиза", items: r.rounds.map((round, i) => `Раунд ${i + 1}: ${round.format === "board" ? "табло" : "вопросы подряд"}, вопросов ${round.take ?? round.questions.length}.`) },
      { id: "answers", title: "Ответы и судейство", items: [`Форматы: ${[...fields].join(", ") || "по заданию ведущего"}.`, `Судейство: ${[...judges].join(", ")}.`, "Это перечень возможных способов; условия конкретного вопроса открываются в его ходе. Будущие вопросы, эталоны и заметки ведущего скрыты."] },
      { id: "timer", title: "Время и темп", items: [`Лимиты ответа, встречающиеся в квизе: ${timers}.`, "Время выбора, ставки и показа ответа задаётся отдельно. Открытие справки не останавливает часы."] },
      { id: "final", title: "Финал и итог", items: [final + ".", ...(r.final.type !== "none" ? [`Финальных вопросов: ${r.final.questions.length}. ${r.final.type === "duel" ? `Дуэль до ${r.final.wins} побед.` : "Условия допуска и ставки показываются при переходе к финалу."}`] : []), `Дополнительных вопросов при равенстве: ${r.tiebreak.length}.`] },
    ],
  };
}
