import type { ConfigDocument, ConfigSummary, GameInformation, TuningDirection } from "@asobiba/sdk";
import type { YomifudaRules } from "./rules";

export const YOMIFUDA_INFO: GameInformation = {
  overview: "Скрытые карты аниме-персонажей: выбирайте по знанию сюжета и вместе смотрите раскрытие.",
  audience: "Для друзей, которые смотрят аниме и любят обсуждать неожиданные сравнения.", players: { min: 2, max: 6 },
  goal: "Набрать больше очков, разыграв всю колоду.",
  turn: "Выберите свою карту для объявленного показателя. Когда сыграют все, откроются карты и результат; после раскрытия все подтверждают продолжение.",
  example: "Объявлена музыка: оставить сильного бойца на будущее или сыграть знакомого музыканта? Числа до раскрытия неизвестны.",
  highlights: ["Случайные равные руки без балансировки силы.", "Только активная оценка открывается в бою, все значения доступны в финальном разборе."],
};
export const YOMIFUDA_TUNING: TuningDirection[] = [
  { id: "pool", title: "Аниме и компания", description: "Профили и порог знакомства определяют пул подготовки.", paths: ["rules.pool"], options: [{ label: "Двое из трёх", consequence: "Третий может встретить незнакомый тайтл." }, { label: "Все знакомы", consequence: "Пул станет меньше, зато персонажей узнают все." }] },
  { id: "volume", title: "Размер партии", description: "Колода кратна числу игроков, каждый получает равную руку.", paths: ["rules.players", "rules.deckSize", "rules.handSize", "rules.cards"], options: [{ label: "Короткая", consequence: "Меньше карт — меньше боёв." }, { label: "60 карт", consequence: "На троих получится 20 боёв." }] },
  { id: "attributes", title: "Показатели", description: "Общий набор с ясными определениями.", paths: ["rules.attributes"], options: [{ label: "До шести", consequence: "Проще запомнить определения." }, { label: "Больше шести", consequence: "Разнообразнее сравнения; схема допускает до 32." }] },
  { id: "scale", title: "Честные оценки", description: "Единая целочисленная шкала без нормализации.", paths: ["rules.scale", "rules.cards[].values"], options: [{ label: "0–100", consequence: "Привычный диапазон; сильные во всём допустимы." }, { label: "Своя шкала", consequence: "Все карты должны целиком укладываться в границы." }] },
  { id: "random", title: "Выбор показателя", description: "Случайность не зависит от рук и счёта.", paths: ["rules.attributeMode"], options: [{ label: "Без повтора", consequence: "Следующий показатель отличается от предыдущего, если их несколько." }, { label: "Независимый", consequence: "Повторы возможны сразу." }, { label: "Мешок", consequence: "Все показатели выпадут перед новым перемешиванием." }] },
  { id: "tempo", title: "Темп и очки", description: "Раскрытие, напоминание и награда.", paths: ["rules.revealSeconds", "rules.choiceSeconds", "rules.winPoints", "rules.tiePoints"], options: [{ label: "Спокойно", consequence: "10 секунд на раскрытие, затем готовность всех." }, { label: "Напоминание", consequence: "Таймер выбора отображается, но не ходит за людей." }] },
  { id: "visual", title: "Арена и портреты", description: "Тема douga и необязательные портреты из пула.", paths: ["visual", "rules.cards[].image"], options: [{ label: "Без картинок", consequence: "Нейтральная замена сохраняет тайну силы." }, { label: "Портреты", consequence: "Карты легче узнавать по персонажам." }] },
];

/** Public rules facts only: never inspect names, assets, values or strongest cards. */
export function summarizeYomifudaConfig({ rules: r }: ConfigDocument<YomifudaRules>): ConfigSummary {
  return {
    players: { min: r.players, max: r.players }, objective: "Набрать больше очков за всю колоду.",
    turn: "Все тайно выбирают свою карту; раскрытие начинается после подтверждения всех.",
    victory: `Максимум активного показателя, затем сумма только разделивших максимум. Победителю ${r.winPoints}, при равенстве сумм каждому победителю ${r.tiePoints}.`,
    highlights: [`${r.deckSize} карт, ${r.deckSize / r.players} боёв, рука ${r.handSize}.`, "Оценки скрыты, без равного бюджета и балансировки рук."],
    sections: [
      { id: "attributes", title: "Показатели", items: r.attributes.map((a) => `${a.label}${a.description ? `: ${a.description}` : ""}`) },
      { id: "pool", title: "Подготовка пула", items: [`Профили: ${r.pool.profiles.join(", ")}; порог просмотра ${r.pool.minViewers}.`, "Только выбранные аниме и сезоны; состав и значения заморожены до конца партии."] },
      { id: "tempo", title: "Время и случайность", items: [`Раскрытие ${r.revealSeconds} с, затем готовность всех.`, r.choiceSeconds ? `Напоминание выбора через ${r.choiceSeconds} с; автоматических ходов нет.` : "Без ограничения выбора; автоматических ходов нет.", `Режим показателя: ${r.attributeMode}.`] },
    ],
  };
}
