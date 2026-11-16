import type { ConfigDocument, ConfigSummary, GameInformation, TuningDirection } from "@asobiba/sdk";
import type { PoleRules, Sector } from "./rules";

export const POLE_INFO: GameInformation = {
  overview: "Словесная игра с барабаном: открывайте буквы, угадывайте слова и набирайте очки.",
  audience: "Для компании за одним виртуальным столом и для соло с ограничением промахов.", players: { min: 1, max: 5 },
  goal: "Наберите больше очков, отгадывая слова; в конце может ждать суперигра.",
  turn: "Крутите барабан, выполните действие сектора и назовите букву или слово. Удачная буква часто сохраняет ход.",
  example: "Назвать частую букву ради очков или рискнуть и произнести целое слово? Банкрот может изменить планы.",
  highlights: ["Повторяющиеся секторы встречаются чаще.", "Суперигра бывает соло или общей гонкой за словами — Схваткой."],
};

export const POLE_TUNING: TuningDirection[] = [
  { id: "topics", title: "Темы", description: "Банк тем или собственные задания.", paths: ["rules.words.source", "rules.words.themes", "rules.words.custom"], options: [{ label: "Природа, кухня, дом", consequence: "Слова берутся из серверного банка без повторов в партии." }, { label: "Свои слова", consequence: "Можно устроить тематическую встречу; каждому ответу нужен вопрос." }] },
  { id: "volume", title: "Количество слов", description: "От 1 до 12 до суперигры.", paths: ["rules.words.rounds"], options: [{ label: "Мало слов", consequence: "Быстрее переходим к финалу." }, { label: "Больше слов", consequence: "Больше возможностей отыграться по очкам." }] },
  { id: "players", title: "Состав", description: "От одного до пяти игроков.", paths: ["rules.players"], options: [{ label: "Соло", consequence: "Можно сделать задачей выживание с ограничением промахов." }, { label: "Компания", consequence: "Ходы переходят между соперниками, а Схватка может собрать нескольких финалистов." }] },
  { id: "wheel", title: "Барабан", description: "От 4 до 40 секторов; вероятность задаётся повторением.", paths: ["rules.wheel"], options: [{ label: "Больше очковых секторов", consequence: "Результат чаще зависит от угаданных букв." }, { label: "Банкроты и интерактивные секторы", consequence: "Больше риска, обменов, шансов и выбора после вращения." }] },
  { id: "penalties", title: "Штрафы и жизни", description: "Цена промахов, неверных слов и повторных букв.", paths: ["rules.scoring", "rules.chests"], options: [{ label: "Без жизней", consequence: "Промах обычно передаёт ход; компания дольше остаётся за столом." }, { label: "Жизни и штрафы", consequence: "Риск ошибки выше; нулевой счёт может означать выбывание только с положительным стартовым счётом." }] },
  { id: "final", title: "Суперигра", description: "Соло, Схватка или партия без финального задания.", paths: ["rules.super"], options: [{ label: "Соло", consequence: "Один финалист выбирает буквы и пытается разгадать кроссворд." }, { label: "Схватка", consequence: "Финалисты тайно выбирают буквы, затем соревнуются в общей гонке." }, { label: "Без суперигры", consequence: "Заканчиваем после обычных слов и сравниваем очки." }] },
  { id: "tempo", title: "Темп и оформление", description: "Собственные часы игры и тема студии.", paths: ["rules.timers", "rules.super.answerSeconds", "rules.super.raceSeconds", "visual.theme"], options: [{ label: "Без часов на обычный ход", consequence: "Можно спокойно обсудить буквы; потолок вращений всё равно действует." }, { label: "Короткие часы", consequence: "Партия динамичнее; таймаут пропускает ход и не угадывает за человека." }] },
];

const TOPICS = { priroda: "Природа", kuhnya: "Кухня", dom: "Дом" };
function sectorDescription(s: Sector): string {
  switch (s.type) {
    case "points": return `Очки: ${s.value} за букву`;
    case "bankrupt": return `Банкрот: ${s.loss === "all" ? "сгорают все очки" : s.loss === "share" ? `сгорает ${Math.round(s.share * 100)} % очков` : "сгорают очки слова"}`;
    case "zero": return `Ноль: переход хода${s.penalty ? ` и штраф ${s.penalty}` : ""}`;
    case "multiplier": return `Множитель ×${s.k}`;
    case "plus": return "Плюс: открыть букву";
    case "prize": return "Приз: деньги или чёрный ящик";
    case "chance": return `Шанс: ${s.amount} очков`;
    case "roulette": return "Рулетка: риск и очки";
    case "math": return "Счёт: решить пример";
    case "steal": return `Кража: ${Math.round(s.share * 100)} %`;
    case "swap": return "Обмен очками";
    case "hint": return "Подсказка";
  }
}

export function summarizePoleConfig(config: ConfigDocument<PoleRules>): ConfigSummary {
  const r = config.rules;
  const source = r.words.source === "custom" ? "Авторские задания" : `${r.words.source === "mix" ? "Свои задания и банк" : "Банк"}: ${r.words.themes.map((id) => TOPICS[id]).join(", ")}`;
  const sectors = new Map<string, number>();
  for (const sector of r.wheel) { const label = sectorDescription(sector); sectors.set(label, (sectors.get(label) ?? 0) + 1); }
  const mode = r.super.mode === "auto" ? "соло при одном игроке, Схватка при двух и больше" : r.super.mode === "solo" ? "соло" : "Схватка";
  const final = r.super.enabled ? `Суперигра: ${mode}.` : "Без суперигры.";
  const wrong = { eliminate: "выбывание из текущего слова", pass: "переход хода", penalty: `штраф ${r.scoring.wrongWordPenalty}`, "lose-match": "выбывание из партии" }[r.scoring.wrongWord];
  return {
    players: { ...r.players }, objective: "Угадывайте буквы и слова, набирайте очки.", turn: "Крутите барабан, выполните действие сектора, затем назовите букву или слово, если сектор это разрешает.",
    victory: "Среди оставшихся игроков побеждает набравший больше очков; равный лучший счёт — ничья. Если выбыли все, победителя нет.",
    highlights: [`Игроков: ${r.players.min}–${r.players.max}; слов до суперигры: ${r.words.rounds}.`, `${source}.`, `Барабан: ${r.wheel.length} секторов.`, r.scoring.lives ? `Жизней на слово: ${r.scoring.lives}.` : "Без ограничения жизней.", `Неверное слово — ${wrong}.`, final],
    sections: [
      { id: "wheel", title: "Сектора и вероятности", items: [...sectors].map(([label, count]) => `${label}: ${Number((100 * count / r.wheel.length).toFixed(2))} % (${count}/${r.wheel.length}).`) },
      { id: "scoring", title: "Очки и промахи", items: [`Бонус за слово: ${r.scoring.wordBonus}. Промах буквой — ${r.scoring.miss === "pass" ? "переход хода" : "штраф по номиналу сектора"}; повтор — ${r.scoring.repeat === "pass" ? "переход хода" : "потеря половины очков"}.`, "Очки слова переходят в общий счёт после его окончания; банкрот сжигает очки согласно своему сектору.", ...(r.scoring.loseAtZero ? [`Стартовый счёт: ${r.scoring.startingScore}; при нуле игрок выбывает.`] : []), ...(r.scoring.eliminateLast ? ["После слова выбывает последний по очкам."] : []), r.chests.enabled ? `Шкатулки после ${r.chests.streak} своих букв подряд; приз ${r.chests.prize}, штраф за пустую ${r.chests.penalty}.` : "Шкатулки выключены."] },
      { id: "final", title: "Финал", items: [final, ...(r.super.enabled ? [`В соло: попыток ${r.super.attempts}, ${r.super.answerSeconds} с на ответ. В Схватке: ${r.super.raceSeconds} с на гонку; первое верное слово забирает его.`, `Порог входа: ${r.super.minScore} очков. ${r.super.canDecline ? "В соло можно отказаться и закончить по очкам." : "Отказ от соло выключен."}`] : [])] },
      { id: "timer", title: "Время", items: [r.timers.turnSeconds ? `На обычный ход ${r.timers.turnSeconds} с; время вращения добавляется. Таймаут пропускает ход.` : "Обычные ходы без таймера.", `После ${r.timers.maxSpins} вращений слово открывается без победителя.`] },
    ],
  };
}
