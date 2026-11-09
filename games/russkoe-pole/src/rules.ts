import { color, type ConfigIssue } from "@asobiba/sdk";
import { z } from "zod";
import { alphabetSet, canonChar, isForeignLetter } from "./alphabet";
import { BANK_THEME_IDS } from "./bank-slot";
import { distinctLetters, layoutCrossword } from "./crossword";

const wordSchema = z
  .strictObject({
    question: z.string().trim().min(1).max(200).meta({ description: "Вопрос или тема, которые видят все" }),
    answer: z.string().trim().min(1).max(60).meta({ description: "Ответ. Его видит только сервер, пока буквы не открыты" }),
  })
  .meta({ description: "Задание: вопрос и ответ" });

const paint = {
  label: z.string().trim().max(24).optional().meta({ description: "Подпись на секторе. Пусто — подпись по типу" }),
  color: color("Цвет сектора").optional(),
  then: z
    .enum(["guess", "pass", "again"])
    .optional()
    .meta({ description: "Что дальше: guess — назвать букву или слово, pass — ход переходит, again — крутить снова. Пусто — обычное для этого типа" }),
};

const events = ["tax", "note", "luck", "anchor", "detector"] as const;

export const sectorSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("points"), value: z.int().min(50).max(20000).meta({ description: "Очки за каждую такую букву" }), ...paint }),
  z.strictObject({
    type: z.literal("bankrupt"),
    loss: z.enum(["round", "all", "share"]).default("round").meta({ description: "Что сгорает: round — очки раунда, all — все, share — доля" }),
    share: z.number().min(0.01).max(1).default(0.99).meta({ description: "Какая доля сгорает, если loss = share. 0.99 — почти всё, как деление на 100" }),
    ...paint,
  }),
  z.strictObject({
    type: z.literal("zero"),
    penalty: z.int().min(0).max(100000).default(0).meta({ description: "Штраф с очков раунда. 0 — ход просто переходит" }),
    ...paint,
  }),
  z.strictObject({
    type: z.literal("multiplier"),
    k: z.int().min(2).max(10).default(2).meta({ description: "Множитель K. Одна буква — ×K, две — ×(2K−1)" }),
    base: z.enum(["round", "all"]).default("round").meta({ description: "Что умножать: очки раунда или все очки" }),
    miss: z.enum(["rules", "none", "half"]).default("rules").meta({ description: "Промах: rules — как в общих правилах, none — без штрафа, half — минус половина базы" }),
    ...paint,
  }),
  z.strictObject({ type: z.literal("plus"), ...paint }),
  z.strictObject({
    type: z.literal("prize"),
    min: z.int().min(0).max(100000).default(100),
    max: z.int().min(0).max(100000).default(2000),
    events: z.array(z.enum(events)).min(1).max(5).default([...events]).meta({ description: "События чёрного ящика: tax, note, luck, anchor, detector" }),
    anchorScore: z.int().min(0).max(100000).default(3000).meta({ description: "Сколько очков ставит событие «незыблемость»" }),
    detectorCost: z.int().min(0).max(100000).default(500).meta({ description: "Цена детектора знаков" }),
    ...paint,
  }),
  z.strictObject({ type: z.literal("chance"), amount: z.int().min(0).max(100000).default(500), ...paint }),
  z.strictObject({
    type: z.literal("roulette"),
    bulletValue: z.int().min(0).max(20000).default(500).meta({ description: "Очки за каждый заряженный патрон" }),
    capacity: z.int().min(2).max(8).default(6).meta({ description: "Сколько гнёзд в барабане" }),
    consequence: z.enum(["eliminate-round", "lose-match", "zero-round", "zero-all"]).default("eliminate-round"),
    hostChance: z.number().min(0).max(1).default(0.13).meta({ description: "Шанс, что после удачи ведущий стреляет сам" }),
    ...paint,
  }),
  z.strictObject({
    type: z.literal("math"),
    ops: z.array(z.enum(["add", "sub", "mul"])).min(1).max(3).default(["add"]),
    min: z.int().min(0).max(500).default(1),
    max: z.int().min(1).max(500).default(30),
    seconds: z.int().min(3).max(120).default(12),
    maxMultiplier: z.number().min(1).max(10).default(3),
    penalty: z.int().min(0).max(100000).default(300),
    ...paint,
  }),
  z.strictObject({ type: z.literal("steal"), share: z.number().min(0.05).max(1).default(0.25), ...paint }),
  z.strictObject({ type: z.literal("swap"), ...paint }),
  z.strictObject({ type: z.literal("hint"), ...paint }),
]);

export type Sector = z.output<typeof sectorSchema>;
export type SectorInput = z.input<typeof sectorSchema>;

const DEFAULT_WHEEL = [
  { type: "points" as const, value: 500 },
  { type: "points" as const, value: 800 },
  { type: "bankrupt" as const, loss: "round" as const, share: 0.99 },
  { type: "plus" as const },
];

export const rulesSchema = z
  .strictObject({
    players: z
      .strictObject({
        min: z.int().min(1).max(5).default(1).meta({ description: "Минимум игроков в лобби" }),
        max: z.int().min(1).max(5).default(4).meta({ description: "Максимум игроков, не больше 5" }),
      })
      .prefault({})
      .meta({ description: "Сколько мест за столом" }),
    alphabet: z
      .strictObject({
        sets: z.array(z.enum(["ru", "en", "digits"])).min(1).max(3).default(["ru"]).meta({ description: "Наборы букв: ru, en, digits. Их можно сочетать" }),
        yoAsYe: z.boolean().default(true).meta({ description: "Ё считается той же буквой, что Е" }),
        extra: z.string().max(40).default("").meta({ description: "Свои символы подряд, без разделителей" }),
        revealNonAlphabet: z.boolean().default(true).meta({ description: "Пробелы и знаки открыты сразу. Иначе их берёт Плюс или детектор" }),
      })
      .prefault({})
      .meta({ description: "Какие символы можно называть" }),
    words: z
      .strictObject({
        source: z.enum(["custom", "bank", "mix"]).default("bank").meta({ description: "custom — только свои, bank — банк тем, mix — сначала свои, потом банк" }),
        themes: z.array(z.enum(BANK_THEME_IDS)).min(1).max(3).default([...BANK_THEME_IDS]).meta({ description: "Темы банка: priroda, kuhnya, dom" }),
        custom: z.array(wordSchema).max(12).default([]).meta({ description: "Свои задания. Вопрос обязателен у каждого" }),
        rounds: z.int().min(1).max(12).default(3).meta({ description: "Сколько слов до суперигры" }),
      })
      .prefault({})
      .meta({ description: "Откуда берутся слова раундов" }),
    wheel: z.array(sectorSchema).min(4).max(40).default(DEFAULT_WHEEL).meta({ description: "Сектора по кругу. Частота — повтором сектора. От 4 до 40" }),
    showCalled: z.boolean().default(true).meta({ description: "Показывать уже названные буквы на клавиатуре" }),
    scoring: z
      .strictObject({
        wordBonus: z.int().min(0).max(100000).default(500).meta({ description: "Бонус тому, кто назвал слово" }),
        miss: z.enum(["pass", "penalty"]).default("pass").meta({ description: "Промах буквой: pass — ход переходит, penalty — минус номинал сектора" }),
        repeat: z.enum(["pass", "half"]).default("pass").meta({ description: "Повтор буквы: pass — ход переходит, half — минус половина очков" }),
        wrongWord: z.enum(["eliminate", "pass", "penalty", "lose-match"]).default("eliminate").meta({ description: "Неверное слово: выбыл из раунда, ход перешёл, штраф или проигрыш партии" }),
        wrongWordPenalty: z.int().min(0).max(100000).default(500),
        threeGuesses: z.boolean().default(false).meta({ description: "Последний в раунде после трёх своих букв обязан назвать слово" }),
        lives: z.int().min(0).max(20).default(5).meta({ description: "Промахов на раунд. 0 — жизни выключены" }),
        startingScore: z.int().min(0).max(100000).default(0),
        loseAtZero: z.boolean().default(false).meta({ description: "Очки упали до нуля — игрок выбывает из партии" }),
        eliminateLast: z.boolean().default(false).meta({ description: "После раунда выбывает последний по очкам" }),
      })
      .prefault({})
      .meta({ description: "Очки, промахи и выбывание" }),
    chests: z
      .strictObject({
        enabled: z.boolean().default(true),
        streak: z.int().min(2).max(10).default(3).meta({ description: "Сколько своих букв подряд открывают шкатулки" }),
        count: z.int().min(2).max(6).default(2),
        prize: z.int().min(0).max(100000).default(1000),
        penalty: z.int().min(0).max(100000).default(0).meta({ description: "Штраф за пустую шкатулку. 0 — как в передаче" }),
      })
      .prefault({})
      .meta({ description: "Шкатулки за серию угаданных букв. enabled: false выключает" }),
    timers: z
      .strictObject({
        turnSeconds: z.int().min(0).max(600).default(30).meta({ description: "Секунд на обычный ход. 0 — без таймера. В документе timer.turnSeconds оставьте 0: часы ставит игра" }),
        maxSpins: z.int().min(5).max(200).default(40).meta({ description: "После стольких вращений слово открывается и раунд никто не забирает" }),
      })
      .prefault({})
      .meta({ description: "Таймер хода и потолок вращений" }),
    super: z
      .strictObject({
        enabled: z.boolean().default(true),
        mode: z.enum(["auto", "solo", "skhvatka"]).default("auto").meta({ description: "auto — соло при одном игроке и Схватка при двух и больше. solo и skhvatka задают режим прямо" }),
        who: z.enum(["leader", "last-round", "most-words"]).default("leader").meta({ description: "Кто играет соло-суперигру" }),
        finalists: z.int().min(0).max(5).default(2).meta({ description: "Сколько лучших идут в Схватку. 0 — все, кто ещё в игре" }),
        minScore: z.int().min(0).max(1000000).default(0).meta({ description: "Порог очков для входа. Ниже — суперигры нет" }),
        canDecline: z.boolean().default(true).meta({ description: "В соло можно отказаться и закончить по очкам" }),
        source: z.enum(["bank", "custom"]).default("bank"),
        puzzles: z
          .array(z.strictObject({ words: z.array(wordSchema).min(1).max(6) }).meta({ description: "Кроссворд: первое слово главное" }))
          .max(8)
          .default([]),
        letters: z
          .strictObject({
            base: z.int().min(0).max(20).default(2).meta({ description: "Сколько букв даже при нуле очков" }),
            firstThreshold: z.int().min(1).max(1000000).default(1000),
            factor: z.number().min(1.1).max(3).default(1.5).meta({ description: "Каждый следующий порог умножается на это число" }),
            capRatio: z.number().min(0.05).max(1).default(0.4).meta({ description: "Потолок: доля разных букв кроссворда" }),
            oneByOne: z.boolean().default(false).meta({ description: "Называть и открывать по одной букве, а не все сразу" }),
          })
          .prefault({})
          .meta({ description: "Сколько букв можно открыть перед ответом" }),
        stake: z
          .strictObject({
            winMultiplier: z.number().min(1).max(10).default(2),
            loseShare: z.number().min(0).max(1).default(0.5).meta({ description: "Какую долю очков забирает проигрыш. 1 — все" }),
          })
          .prefault({}),
        prices: z
          .strictObject({
            main: z.int().min(0).max(100000).default(1000),
            other: z.int().min(0).max(100000).default(500),
          })
          .prefault({})
          .meta({ description: "Цены слов в Схватке. Барабан суперприза умножает их" }),
        answerSeconds: z.int().min(5).max(600).default(60),
        lettersSeconds: z.int().min(5).max(300).default(45),
        raceSeconds: z.int().min(10).max(600).default(90),
        wrongPauseSeconds: z.int().min(0).max(60).default(10),
        modifiers: z
          .strictObject({
            prizeWheel: z.boolean().default(false),
            wheel: z.array(z.number().min(1).max(10)).min(2).max(8).default([1, 2, 2, 3]),
            buyLetter: z.boolean().default(false),
            buyLetterCost: z.int().min(0).max(100000).default(300),
            vowelLimit: z.int().min(0).max(20).default(0).meta({ description: "Не больше стольких гласных среди названных. 0 — без лимита" }),
            hints: z.enum(["none", "first", "random"]).default("none"),
            hintCount: z.int().min(1).max(8).default(1),
            hardcore: z.boolean().default(false).meta({ description: "Суперигра без вопросов" }),
          })
          .prefault({})
          .meta({ description: "Модификаторы суперигры" }),
        sabotage: z
          .strictObject({
            enabled: z.boolean().default(true),
            cost: z.int().min(0).max(100000).default(200),
            freezeSeconds: z.int().min(0).max(60).default(15),
          })
          .prefault({})
          .meta({ description: "Пакости Схватки. В соло не используются" }),
      })
      .prefault({})
      .meta({ description: "Суперигра" }),
  })
  .prefault({})
  .meta({ description: "Правила Русского поля" });

export type PoleRules = z.output<typeof rulesSchema>;

function sampleDistinct(rules: PoleRules): number {
  const puzzle = rules.super.puzzles[0];
  if (puzzle) {
    const laid = layoutCrossword(puzzle.words);
    if (laid) return distinctLetters(laid, (char) => canonChar(char, rules.alphabet.yoAsYe));
  }
  return 8;
}

/** Letters granted at `score`, capped by the crossword. */
export function letterAllowance(score: number, rules: PoleRules, distinct: number): number {
  const ladder = rules.super.letters;
  let count = ladder.base;
  let threshold = ladder.firstThreshold;
  for (let guard = 0; guard < 40 && score >= threshold; guard++) {
    count += 1;
    threshold = Math.round(threshold * ladder.factor);
  }
  const cap = Math.max(1, Math.floor(distinct * ladder.capRatio));
  return Math.max(0, Math.min(count, cap, distinct));
}

function unguessable(answer: string, rules: PoleRules): string | null {
  const letters = alphabetSet(rules.alphabet);
  let named = 0;
  for (const char of answer.trim()) {
    const key = canonChar(char, rules.alphabet.yoAsYe);
    if (letters.has(key)) {
      named += 1;
      continue;
    }
    if (isForeignLetter(char, letters, rules.alphabet.yoAsYe)) return char;
    if (!rules.alphabet.revealNonAlphabet) return char;
  }
  return named === 0 ? "" : null;
}

export function checkRules(rules: PoleRules): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (rules.players.min > rules.players.max) {
    issues.push({ path: "players", code: "bad_range", message: "Минимум игроков больше максимума", hint: "Поставьте min не больше max" });
  }
  const letters = alphabetSet(rules.alphabet);
  if (letters.size < 2) {
    issues.push({ path: "alphabet", code: "tiny_alphabet", message: "В алфавите меньше двух символов", hint: "Оставьте набор ru или en" });
  }
  const need = rules.words.source === "bank" ? 0 : rules.words.source === "custom" ? rules.words.rounds : 0;
  if (rules.words.source === "custom" && rules.words.custom.length < need) {
    issues.push({
      path: "words.custom",
      code: "not_enough_words",
      message: `Своих слов ${rules.words.custom.length}, а раундов ${rules.words.rounds}`,
      hint: "Добавьте задания или уменьшите words.rounds",
    });
  }
  if (rules.words.source !== "bank" && rules.words.custom.length === 0 && rules.words.source === "custom") {
    issues.push({ path: "words.custom", code: "empty", message: "Нет своих слов", hint: "Добавьте хотя бы одно задание с вопросом и ответом" });
  }
  rules.words.custom.forEach((word, index) => {
    const bad = unguessable(word.answer, rules);
    if (bad !== null) {
      issues.push({
        path: `words.custom[${index}].answer`,
        code: "unguessable",
        message: bad === "" ? "В ответе нет ни одной буквы алфавита" : `Символ «${bad}» нельзя отгадать`,
        hint: "Оставьте буквы выбранного алфавита. Пробел, дефис и знаки можно, если они открыты сразу",
      });
    }
  });
  rules.wheel.forEach((sector, index) => {
    if (sector.type === "prize" && sector.min > sector.max) {
      issues.push({ path: `wheel[${index}]`, code: "bad_range", message: "Минимум приза больше максимума", hint: "Поменяйте min и max местами" });
    }
    if (sector.type === "math" && sector.min > sector.max) {
      issues.push({ path: `wheel[${index}]`, code: "bad_range", message: "Диапазон примера перепутан", hint: "min должен быть не больше max" });
    }
  });
  if (rules.super.enabled && rules.super.source === "custom") {
    if (rules.super.puzzles.length === 0) {
      issues.push({ path: "super.puzzles", code: "empty", message: "Нет кроссворда суперигры", hint: "Добавьте загадку или поставьте super.source = bank" });
    }
    rules.super.puzzles.forEach((puzzle, index) => {
      puzzle.words.forEach((word, wordIndex) => {
        const bad = unguessable(word.answer, rules);
        if (bad !== null) {
          issues.push({
            path: `super.puzzles[${index}].words[${wordIndex}].answer`,
            code: "unguessable",
            message: bad === "" ? "В ответе нет букв алфавита" : `Символ «${bad}» нельзя отгадать`,
            hint: "Все слова кроссворда должны складываться из алфавита",
          });
        }
      });
      if (puzzle.words.length > 1 && layoutCrossword(puzzle.words) === null) {
        issues.push({
          path: `super.puzzles[${index}].words`,
          code: "no_cross",
          message: "Слова не складываются в кроссворд",
          hint: "У каждого следующего слова должна быть общая буква с уже положенными",
        });
      }
    });
    const distinct = sampleDistinct(rules);
    const low = letterAllowance(0, rules, distinct);
    const high = letterAllowance(rules.super.letters.firstThreshold * 3, rules, distinct);
    if (low < 2) {
      issues.push({
        path: "super.letters",
        code: "too_hard",
        message: "При нуле очков открывается меньше двух букв",
        hint: "Поднимите letters.base хотя бы до 2",
        severity: "warning",
      });
    }
    if (distinct > 0 && high > distinct * 0.5) {
      issues.push({
        path: "super.letters",
        code: "too_easy",
        message: "При обычных очках открывается больше половины разных букв",
        hint: "Уменьшите base или capRatio, либо поднимите первый порог",
        severity: "warning",
      });
    }
  }
  return issues;
}

export function sectorLabel(sector: Sector): string {
  if (sector.label) return sector.label;
  switch (sector.type) {
    case "points":
      return String(sector.value);
    case "bankrupt":
      return "Банкрот";
    case "zero":
      return sector.penalty > 0 ? `0/−${sector.penalty}` : "Ноль";
    case "multiplier":
      return `×${sector.k}`;
    case "plus":
      return "Плюс";
    case "prize":
      return "Приз";
    case "chance":
      return "Шанс";
    case "roulette":
      return "Рулетка";
    case "math":
      return "Счёт";
    case "steal":
      return "Кража";
    case "swap":
      return "Обмен";
    case "hint":
      return "Подсказка";
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function rulesText(rules: PoleRules): string[] {
  const mode = rules.super.mode === "auto" ? "Схватка, если игроков двое и больше" : rules.super.mode === "solo" ? "соло-суперигра" : "Схватка";
  return [
    `Игроков ${rules.players.min}–${rules.players.max}. Раундов до суперигры: ${rules.words.rounds}.`,
    `Барабан: ${rules.wheel.length} ${plural(rules.wheel.length, "сектор", "сектора", "секторов")}.`,
    rules.scoring.lives > 0 ? `Жизней на раунд: ${rules.scoring.lives}.` : "Жизни выключены: промах отдаёт ход.",
    rules.super.enabled ? `Суперигра: ${mode}.` : "Суперигра выключена.",
  ];
}
