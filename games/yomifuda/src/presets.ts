import type { ConfigPreset } from "@asobiba/sdk";
import { rulesSchema, type YomifudaRules } from "./rules";

/** Small educational deck, publicly visible in capabilities. It is not a personal 2-of-3 pool.
 * Numbers are fixed illustrative judgements of shown anime abilities, with no equal budget.
 * Images are optional; integration tests should attach owned asset references separately.
 * Returns a fresh parsed copy, safe for test-specific overrides and authoring.
 */
export function demoRules(): YomifudaRules {
  return rulesSchema.parse({
    players: 3, handSize: 3,
    attributes: [
      { id: "strength", label: "Физическая сила", description: "Наибольшая показанная физическая мощь в указанной версии аниме, без способностей манги" },
      { id: "intellect", label: "Интеллект", description: "Показанные знания, рассуждение и решение сложных задач" },
      { id: "music", label: "Музыка", description: "Показанное владение музыкальным инструментом или пением" },
    ],
    cards: [
      { id: "saitama", name: "Сайтама", anime: "Ванпанчмен", version: "1 сезон", shikimoriId: 73935, values: { strength: 100, intellect: 35, music: 5 } },
      { id: "mob", name: "Сигэо Кагэяма", anime: "Моб Психо 100", version: "1 сезон, физическая сила без телекинеза", values: { strength: 15, intellect: 40, music: 5 } },
      { id: "edward", name: "Эдвард Элрик", anime: "Стальной алхимик: Братство", values: { strength: 45, intellect: 90, music: 5 } },
      { id: "senku", name: "Сэнку Исигами", anime: "Доктор Стоун", version: "1 сезон", values: { strength: 10, intellect: 100, music: 10 } },
      { id: "light", name: "Лайт Ягами", anime: "Тетрадь смерти", values: { strength: 25, intellect: 95, music: 5 } },
      { id: "lelouch", name: "Лелуш Ламперуж", anime: "Код Гиас", version: "1 сезон", values: { strength: 10, intellect: 95, music: 5 } },
      { id: "kousei", name: "Косэй Арима", anime: "Твоя апрельская ложь", values: { strength: 10, intellect: 55, music: 95 } },
      { id: "kaori", name: "Каори Миядзоно", anime: "Твоя апрельская ложь", values: { strength: 10, intellect: 55, music: 90 } },
      { id: "yui", name: "Юи Хирасава", anime: "Кэйон!", version: "1 сезон", values: { strength: 10, intellect: 25, music: 65 } },
      { id: "bocchi", name: "Хитори Гото", anime: "Одинокий рокер!", values: { strength: 10, intellect: 40, music: 85 } },
      { id: "levi", name: "Леви Аккерман", anime: "Атака титанов", version: "1 сезон", values: { strength: 70, intellect: 70, music: 5 } },
      { id: "shinji", name: "Синдзи Икари", anime: "Евангелион", version: "сериал 1995 года, без Евы", values: { strength: 10, intellect: 45, music: 65 } },
    ],
  });
}
export const PRESETS: ConfigPreset[] = [{
  id: "educational", title: "Учебная Ёмифуда", description: "12 открытых учебных карт, трое игроков, по три карты. Не персональная колода по профилям.",
  config: { title: "Учебная Ёмифуда", rules: demoRules(), series: { rounds: 1 }, timer: { turnSeconds: 0 }, visual: { theme: "night" } },
}];
