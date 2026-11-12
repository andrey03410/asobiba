import { z } from "zod";
import { assetRef, type ConfigIssue } from "@asobiba/sdk";
import { matchesText } from "./judge";
import { visualSchema } from "./visual";

const text = z.string().max(20000);
const id = z.string().min(1).max(100);
const seconds = z.number().min(0).max(86400);
export const gradeSchema = z.strictObject({
  id,
  label: z.string().min(1).max(100),
  fraction: z.number().min(-100).max(100).optional(),
  points: z.number().min(-1e9).max(1e9).optional(),
  correct: z.boolean().default(false),
});
export const GRADES = [
  { id: "correct", label: "Точно", fraction: 1, correct: true },
  { id: "partial", label: "Частично", fraction: 0.5, correct: false },
  { id: "miss", label: "Мимо", fraction: 0, correct: false },
  { id: "fail", label: "Провал", fraction: -0.5, correct: false },
  { id: "silence", label: "Молчание", fraction: 0, correct: false },
];
const timerShape = {
  answerSeconds: seconds,
  buzzSeconds: seconds,
  roundSeconds: seconds,
  selectionSeconds: seconds,
  wagerSeconds: seconds,
  revealSeconds: seconds,
  preloadSeconds: seconds,
  hurrySeconds: seconds,
};
const bonusesShape = {
  speed: z.enum(["none", "linear", "rank"]),
  speedFraction: z.number().min(0).max(10),
  rankPoints: z.array(z.number().min(0).max(1e6)).max(16),
  streakEvery: z.int().min(0).max(1000),
  streakMultiplier: z.number().min(1).max(100),
  streakBonus: z.number().min(0).max(1e6),
  uniqueBonus: z.number().min(0).max(1e6),
};
const settingsShape = {
  mode: z.enum(["secret", "buzz", "chooser", "turns"]),
  recipient: z.enum([
    "all",
    "chooser",
    "turn",
    "owner",
    "random",
    "leader",
    "trailing",
    "presenter",
  ]),
  judge: z.enum([
    "algorithm",
    "presenter",
    "assisted",
    "vote",
    "best",
    "self",
    "ai",
  ]),
  strictness: z.enum(["literal", "exact", "strict", "normal", "soft"]),
  text: z.strictObject({ wordOrder: z.boolean(), numbers: z.boolean() }),
  value: z.number().min(0).max(1e9),
  grades: z.array(gradeSchema).min(1).max(30),
  timers: z.strictObject(timerShape),
  bonuses: z.strictObject(bonusesShape),
  combine: z.enum(["sum", "all", "count"]),
  countGrades: z.record(z.string(), id),
  answerOpen: z.enum(["after", "first", "block", "presenter"]),
  openBlock: z.int().min(0).max(100),
  blockValues: z.array(z.number().min(0).max(1e9)).max(100),
  pacing: z.enum(["auto", "presenter", "self"]),
  editable: z.boolean(),
  autoSubmit: z.boolean(),
  reveal: z.enum(["question", "round", "never"]),
  showAnswers: z.boolean(),
  advance: z.enum(["auto", "presenter"]),
  interception: z.boolean(),
  interceptionMode: z.enum(["buzz", "secret"]),
  attempts: z.int().min(1).max(100),
  falseStartSeconds: seconds,
  buzzWindowMs: z.int().min(0).max(2000),
  appeals: z.boolean(),
  appealLimit: z.int().min(0).max(100),
  doubtful: z.enum(["algorithm", "vote", "presenter"]),
  allowNegative: z.boolean(),
  scoreVisibility: z.enum(["always", "round", "final", "own"]),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.enum(["none", "shared", "individual"]),
  shuffleThemes: z.boolean(),
};
export const settingsSchema = z.strictObject(settingsShape);
export const settingsOverrideSchema = z
  .strictObject({
    ...settingsShape,
    text: settingsShape.text.partial().optional(),
    timers: settingsShape.timers.partial().optional(),
    bonuses: settingsShape.bonuses.partial().optional(),
  })
  .partial();
export type Settings = z.output<typeof settingsSchema>;
export type SettingsOverride = z.output<typeof settingsOverrideSchema>;
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({
  mode: "secret",
  recipient: "all",
  judge: "algorithm",
  strictness: "normal",
  text: { wordOrder: true, numbers: false },
  value: 100,
  grades: GRADES,
  timers: {
    answerSeconds: 0,
    buzzSeconds: 30,
    roundSeconds: 0,
    selectionSeconds: 30,
    wagerSeconds: 30,
    revealSeconds: 10,
    preloadSeconds: 10,
    hurrySeconds: 30,
  },
  bonuses: {
    speed: "none",
    speedFraction: 0.5,
    rankPoints: [30, 20, 10],
    streakEvery: 0,
    streakMultiplier: 1,
    streakBonus: 0,
    uniqueBonus: 0,
  },
  combine: "sum",
  countGrades: {},
  answerOpen: "after",
  openBlock: 0,
  blockValues: [],
  pacing: "auto",
  editable: false,
  autoSubmit: true,
  reveal: "question",
  showAnswers: true,
  advance: "auto",
  interception: true,
  interceptionMode: "buzz",
  attempts: 1,
  falseStartSeconds: 1,
  buzzWindowMs: 300,
  appeals: true,
  appealLimit: 0,
  doubtful: "algorithm",
  allowNegative: true,
  scoreVisibility: "always",
  shuffleQuestions: false,
  shuffleOptions: "none",
  shuffleThemes: false,
});

export interface Block {
  type: "text" | "image" | "audio" | "video" | "pause" | "group";
  text?: string;
  asset?: string;
  caption?: string;
  durationSeconds?: number;
  align?: "left" | "center" | "right";
  size?: "small" | "normal" | "large";
  effect?:
    | "none"
    | "words"
    | "hidden-words"
    | "blur"
    | "pixelate"
    | "tiles"
    | "zoom"
    | "spotlight";
  effectSeconds?: number;
  from?: number;
  to?: number;
  speed?: number;
  repeat?: number;
  volume?: number;
  replays?: number;
  muted?: boolean;
  audioOnly?: boolean;
  freeze?: boolean;
  fullscreen?: boolean;
  layout?: "row" | "grid" | "stack";
  blocks?: Block[];
}
const blockBase = { durationSeconds: seconds.optional() };
const media = {
  asset: assetRef(),
  caption: text.optional(),
  from: seconds.optional(),
  to: seconds.optional(),
  speed: z.number().min(0.25).max(4).default(1),
  repeat: z.int().min(1).max(100).default(1),
  volume: z.number().min(0).max(1).default(1),
  replays: z.int().min(0).max(100).default(1),
};
export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("text"),
      ...blockBase,
      text,
      align: z.enum(["left", "center", "right"]).default("center"),
      size: z.enum(["small", "normal", "large"]).default("normal"),
      effect: z.enum(["none", "words", "hidden-words"]).default("none"),
      effectSeconds: seconds.optional(),
    }),
    z.strictObject({
      type: z.literal("image"),
      ...blockBase,
      asset: assetRef(),
      caption: text.optional(),
      fullscreen: z.boolean().default(false),
      effect: z
        .enum(["none", "blur", "pixelate", "tiles", "zoom", "spotlight"])
        .default("none"),
      effectSeconds: seconds.optional(),
    }),
    z.strictObject({ type: z.literal("audio"), ...blockBase, ...media }),
    z.strictObject({
      type: z.literal("video"),
      ...blockBase,
      ...media,
      muted: z.boolean().default(false),
      audioOnly: z.boolean().default(false),
      freeze: z.boolean().default(true),
    }),
    z.strictObject({
      type: z.literal("pause"),
      durationSeconds: seconds,
      text: text.optional(),
    }),
    z.strictObject({
      type: z.literal("group"),
      ...blockBase,
      layout: z.enum(["row", "grid", "stack"]).default("grid"),
      blocks: z.array(blockSchema).min(1).max(20),
    }),
  ]),
);
export type Condition =
  | { type: "exact"; value: number }
  | { type: "range"; min: number; max: number }
  | {
      type: "distance";
      op: "lte" | "lt" | "gte" | "gt";
      value: number;
      unit?: "absolute" | "percent";
    }
  | { type: "nearest"; rank?: number; side?: "any" | "under" | "over" }
  | { type: "and" | "or"; conditions: Condition[] };
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("exact"), value: z.number() }),
    z.strictObject({
      type: z.literal("range"),
      min: z.number(),
      max: z.number(),
    }),
    z.strictObject({
      type: z.literal("distance"),
      op: z.enum(["lte", "lt", "gte", "gt"]),
      value: z.number().min(0),
      unit: z.enum(["absolute", "percent"]).default("absolute"),
    }),
    z.strictObject({
      type: z.literal("nearest"),
      rank: z.int().min(1).max(16).default(1),
      side: z.enum(["any", "under", "over"]).default("any"),
    }),
    z.strictObject({
      type: z.enum(["and", "or"]),
      conditions: z.array(conditionSchema).min(1).max(20),
    }),
  ]),
);
const variantSchema = z.strictObject({
  text: z.string().min(1).max(2000),
  grade: id.default("correct"),
  keywords: z.boolean().default(false),
  strictness: settingsShape.strictness.optional(),
  comment: text.optional(),
});
const itemSchema = z.strictObject({
  id,
  text: text.default(""),
  asset: assetRef().optional(),
  media: z.enum(["image", "audio"]).optional(),
});
const fieldBase = {
  id,
  label: z.string().max(200).default("Ответ"),
  required: z.boolean().default(true),
  settings: settingsOverrideSchema.optional(),
  notes: text.optional(),
};
const steps = z
  .array(z.strictObject({ condition: conditionSchema, grade: id }))
  .max(100)
  .default([]);
export const fieldSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...fieldBase,
    type: z.literal("text"),
    answers: z.array(variantSchema).max(100).default([]),
    wrong: z
      .array(variantSchema.extend({ grade: id.default("fail") }))
      .max(100)
      .default([]),
    multiline: z.boolean().default(false),
    maxLength: z.int().min(1).max(20000).default(2000),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("number"),
    target: z.union([
      z.number(),
      z.strictObject({ min: z.number(), max: z.number() }),
    ]),
    steps,
    precision: z.int().min(0).max(12).default(6),
    input: z.enum(["input", "slider"]).default("input"),
    unit: z.string().max(100).optional(),
    step: z.number().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("choice"),
    options: z
      .array(itemSchema.extend({ grade: id.default("miss") }))
      .min(2)
      .max(100),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("multi"),
    options: z
      .array(itemSchema.extend({ correct: z.boolean() }))
      .min(2)
      .max(100),
    scoring: z.enum(["all", "per-item", "threshold"]).default("all"),
    threshold: z.int().min(0).max(100).default(1),
    maxSelected: z.int().min(1).max(100).optional(),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("order"),
    items: z.array(itemSchema).min(2).max(100),
    correct: z.array(id).min(2).max(100),
    scoring: z.enum(["all", "position", "pairs"]).default("all"),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("match"),
    left: z.array(itemSchema).min(1).max(100),
    right: z.array(itemSchema).min(1).max(100),
    correct: z.record(id, id),
    scoring: z.enum(["all", "per-item", "threshold"]).default("all"),
    threshold: z.int().min(1).max(100).default(1),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("list"),
    items: z
      .array(
        z.strictObject({ answers: z.array(variantSchema).min(1).max(100) }),
      )
      .min(1)
      .max(200),
    maxItems: z.int().min(1).max(200).default(20),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("point"),
    asset: assetRef(),
    target: z.strictObject({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    }),
    steps,
    zones: z
      .array(
        z.discriminatedUnion("type", [
          z.strictObject({
            type: z.literal("circle"),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            radius: z.number().min(0).max(2),
            grade: id,
          }),
          z.strictObject({
            type: z.literal("rect"),
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            width: z.number().min(0).max(1),
            height: z.number().min(0).max(1),
            grade: id,
          }),
        ]),
      )
      .max(100)
      .default([]),
  }),
  z.strictObject({
    ...fieldBase,
    type: z.literal("oral"),
    reference: text.default(""),
  }),
]);
export type Field = z.output<typeof fieldSchema>;
export type TextVariant = z.output<typeof variantSchema>;
export type AnswerValue =
  | string
  | number
  | string[]
  | Record<string, string>
  | { x: number; y: number }
  | boolean
  | null;
export type Answers = Record<string, AnswerValue>;
export const answerValueSchema = z.union([
  z.string().max(20000),
  z.number().finite(),
  z.array(z.string().max(2000)).max(200),
  z.record(z.string().max(100), z.string().max(2000)),
  z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  z.boolean(),
  z.null(),
]);
export const answersSchema = z.record(z.string().max(100), answerValueSchema);
export const specialSchema = z.strictObject({
  type: z.enum([
    "transfer",
    "auction",
    "wager-all",
    "wager",
    "risk-free",
    "gift",
  ]),
  announced: z.boolean().default(false),
  topic: text.default("Особый вопрос"),
  allowSelf: z.boolean().default(true),
  values: z.array(z.number().min(0).max(1e9)).max(30).default([]),
  auction: z.enum(["open", "sealed"]).default("open"),
  minimum: z.number().min(0).max(1e9).optional(),
});
export const questionSchema = z.strictObject({
  id,
  prompt: text.default(""),
  blocks: z.array(blockSchema).max(100).default([]),
  reveal: z.array(blockSchema).max(100).default([]),
  fields: z.array(fieldSchema).max(30).default([]),
  settings: settingsOverrideSchema.optional(),
  special: specialSchema.optional(),
  theme: text.optional(),
  value: z.number().min(0).max(1e9).optional(),
  answer: text.optional(),
});
export type Question = z.output<typeof questionSchema>;
export const roundSchema = z.strictObject({
  id,
  title: text.default("Раунд"),
  format: z.enum(["sequence", "board"]).default("sequence"),
  questions: z.array(questionSchema).min(1).max(500),
  settings: settingsOverrideSchema.optional(),
  intro: z.array(blockSchema).max(100).default([]),
  take: z.int().min(1).max(500).optional(),
  themes: z.array(text).max(100).default([]),
  values: z.array(z.number().min(0).max(1e9)).max(100).default([]),
  firstChooser: z
    .enum(["random", "trailing", "order", "presenter"])
    .default("random"),
  nextChooser: z.enum(["fastest", "turn", "trailing"]).default("fastest"),
  owner: z.enum(["turn", "fastest", "trailing"]).default("turn"),
  eliminateLast: z.boolean().default(false),
  eliminateOnError: z.boolean().default(false),
  survivors: z.int().min(1).max(16).default(1),
  winsToEnd: z.int().min(0).max(1000).default(0),
  winnerBonus: z.number().min(0).max(1e9).default(0),
  visual: visualSchema.optional(),
});
export type Round = z.output<typeof roundSchema>;
export const finalSchema = z.strictObject({
  type: z
    .enum(["none", "elimination-wager", "wager", "survival", "duel"])
    .default("none"),
  questions: z.array(questionSchema).max(100).default([]),
  eligibility: z
    .enum(["all", "positive", "top", "threshold"])
    .default("positive"),
  top: z.int().min(1).max(16).default(2),
  threshold: z.number().default(0),
  minimumWager: z.number().min(0).max(1e9).default(0),
  keepThemes: z.int().min(1).max(100).default(1),
  banOrder: z.enum(["score", "turn", "secret"]).default("score"),
  wins: z.int().min(1).max(100).default(3),
  bonus: z.number().min(0).max(1e9).default(100),
  directWinner: z.boolean().default(false),
  settings: settingsOverrideSchema.optional(),
});
export const rulesSchema = z.strictObject({
  players: z
    .strictObject({
      min: z.int().min(1).max(16).default(1),
      max: z.int().min(1).max(16).default(16),
    })
    .prefault({}),
  presenter: z.enum(["none", "optional", "required"]).default("none"),
  defaults: settingsOverrideSchema.prefault({}),
  rounds: z
    .array(roundSchema)
    .min(1)
    .max(100)
    .prefault([
      {
        id: "demo",
        title: "Разминка",
        questions: [
          {
            id: "demo-q",
            prompt: "Как называется наша планета?",
            fields: [
              { id: "answer", type: "text", answers: [{ text: "Земля" }] },
            ],
          },
        ],
      },
    ]),
  final: finalSchema.prefault({}),
  tiebreak: z.array(questionSchema).max(100).default([]),
});
export type QuizorRules = z.output<typeof rulesSchema>;
export interface ResolvedField {
  field: Field;
  settings: Settings;
  provenance: Record<string, string>;
}
export interface ResolvedQuestion {
  question: Question;
  roundId: string;
  settings: Settings;
  provenance: Record<string, string>;
  fields: ResolvedField[];
}
function merge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
  source: string,
  provenance: Record<string, string>,
  prefix = "",
): void {
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (
        !base[key] ||
        typeof base[key] !== "object" ||
        Array.isArray(base[key])
      )
        base[key] = {};
      merge(
        base[key] as Record<string, unknown>,
        value as Record<string, unknown>,
        source,
        provenance,
        path,
      );
    } else {
      base[key] = structuredClone(value);
      provenance[path] = source;
    }
  }
}
export function resolveSettings(
  ...layers: [string, SettingsOverride | undefined][]
): { settings: Settings; provenance: Record<string, string> } {
  const settings: Record<string, unknown> = {};
  const provenance: Record<string, string> = {};
  merge(settings, DEFAULT_SETTINGS, "game", provenance);
  for (const [source, layer] of layers)
    if (layer) merge(settings, layer, source, provenance);
  return { settings: settings as Settings, provenance };
}
export function allQuestions(rules: QuizorRules): Question[] {
  return [
    ...rules.rounds.flatMap((r) => r.questions),
    ...rules.final.questions,
    ...rules.tiebreak,
  ];
}
export function resolveQuestion(
  rules: QuizorRules,
  questionId: string,
): ResolvedQuestion {
  const round = rules.rounds.find((r) =>
    r.questions.some((q) => q.id === questionId),
  );
  const question = allQuestions(rules).find((q) => q.id === questionId);
  if (!question) throw new Error(`Вопрос ${questionId} не найден`);
  const layers: [string, SettingsOverride | undefined][] = [
    ["quiz", rules.defaults],
    [
      round ? `round:${round.id}` : "final",
      round?.settings ?? rules.final.settings,
    ],
    [
      `question:${question.id}`,
      {
        ...question.settings,
        ...(question.value === undefined ? {} : { value: question.value }),
      },
    ],
  ];
  const resolved = resolveSettings(...layers);
  return {
    question,
    roundId:
      round?.id ??
      (rules.final.questions.includes(question) ? "final" : "tiebreak"),
    ...resolved,
    fields: question.fields.map((field) => ({
      field,
      ...resolveSettings(...layers, [`field:${field.id}`, field.settings]),
    })),
  };
}
export function blockDuration(block: Block): number {
  if (block.durationSeconds !== undefined) return block.durationSeconds * 1000;
  if (block.type === "group")
    return Math.max(0, ...(block.blocks ?? []).map(blockDuration));
  if (block.type === "text")
    return Math.max(2000, (block.text?.length ?? 0) * 50);
  if (block.type === "audio" || block.type === "video")
    return Math.max(
      1000,
      ((((block.to ?? (block.from ?? 0) + 10) - (block.from ?? 0)) * 1000) /
        (block.speed ?? 1)) *
        (block.repeat ?? 1),
    );
  return 5000;
}
export function checkRules(rules: QuizorRules): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const issue = (
    path: string,
    code: string,
    message: string,
    warning = false,
  ) =>
    issues.push({
      path,
      code,
      message,
      severity: warning ? "warning" : "error",
    });
  if (rules.players.min > rules.players.max)
    issue("players", "players_range", "Минимум игроков больше максимума");
  const questions = allQuestions(rules);
  if (questions.length > 500)
    issue(
      "rounds",
      "question_limit",
      "В квизе может быть не больше 500 вопросов",
    );
  if (
    new TextEncoder().encode(JSON.stringify(rules)).byteLength >
    2 * 1024 * 1024
  )
    issue("", "config_limit", "Конфиг больше 2 МиБ");
  if (new Set(questions.map((q) => q.id)).size !== questions.length)
    issue(
      "rounds",
      "duplicate_question",
      "Идентификаторы вопросов должны быть уникальны",
    );
  if (new Set(rules.rounds.map((r) => r.id)).size !== rules.rounds.length)
    issue(
      "rounds",
      "duplicate_round",
      "Идентификаторы раундов должны быть уникальны",
    );
  if (!rules.tiebreak.length)
    issue(
      "tiebreak",
      "no_tiebreak",
      "Без запаса тай-брейка возможна общая победа",
      true,
    );
  for (const round of rules.rounds) {
    if (round.winsToEnd > (round.take ?? round.questions.length))
      issue(
        `rounds.${round.id}.winsToEnd`,
        "target_exceeds_pool",
        "Цель верных ответов больше запаса вопросов; после исчерпания раунд завершится по общим очкам",
        true,
      );
    if (round.take && round.take > round.questions.length)
      issue(
        `rounds.${round.id}.take`,
        "take_limit",
        "В пуле меньше вопросов, чем нужно взять",
      );
  }
  const inspectBlocks = (blocks: Block[], path: string, depth = 0) => {
    if (depth > 8) {
      issue(path, "block_depth", "Группы блоков вложены слишком глубоко");
      return;
    }
    for (const block of blocks) {
      if (
        (block.type === "audio" || block.type === "video") &&
        block.to !== undefined &&
        block.to <= (block.from ?? 0)
      )
        issue(
          path,
          "media_fragment",
          "Конец фрагмента должен быть позже начала",
        );
      if (block.blocks) inspectBlocks(block.blocks, path, depth + 1);
    }
  };
  for (const r of rules.rounds) inspectBlocks(r.intro, `rounds.${r.id}.intro`);
  for (const question of questions) {
    const resolved = resolveQuestion(rules, question.id);
    const p = `questions.${question.id}`;
    if (question.special?.type !== "gift" && !question.fields.length)
      issue(`${p}.fields`, "no_fields", "Для вопроса нужна форма ответа");
    inspectBlocks(question.blocks, `${p}.blocks`);
    inspectBlocks(question.reveal, `${p}.reveal`);
    if (
      new Set(question.fields.map((f) => f.id)).size !== question.fields.length
    )
      issue(
        `${p}.fields`,
        "duplicate_field",
        "Идентификаторы полей должны быть уникальны",
      );
    if (
      resolved.settings.pacing === "self" &&
      resolved.settings.mode !== "secret"
    )
      issue(p, "self_pacing", "Свой темп доступен только для тайных ответов");
    if (
      resolved.settings.mode === "buzz" &&
      resolved.settings.timers.buzzSeconds === 0
    )
      issue(p, "buzz_timer", "Для кнопки нужен таймер ответа после нажатия");
    for (const { field, settings } of resolved.fields) {
      if (settings.judge === "ai")
        issue(
          `${p}.${field.id}`,
          "ai_unavailable",
          "ИИ-проверка пока недоступна: выберите алгоритм, ведущего или голосование",
        );
      if (field.type === "oral" && settings.judge === "algorithm")
        issue(
          `${p}.${field.id}`,
          "oral_judge",
          "Устный ответ требует ведущего, голосования или самопроверки",
        );
      if (
        new Set(settings.grades.map((g) => g.id)).size !==
        settings.grades.length
      )
        issue(
          p,
          "duplicate_grade",
          "Идентификаторы оценок должны быть уникальны",
        );
      const gradeIds = new Set(settings.grades.map((g) => g.id));
      const referenced: string[] = [];
      if (field.type === "text")
        referenced.push(
          ...field.answers.map((a) => a.grade),
          ...field.wrong.map((a) => a.grade),
        );
      if (field.type === "choice") {
        referenced.push(...field.options.map((o) => o.grade));
        if (
          !field.options.some(
            (o) => settings.grades.find((g) => g.id === o.grade)?.correct,
          )
        )
          issue(
            `${p}.${field.id}`,
            "no_correct_choice",
            "У выбора нет верного варианта",
          );
      }
      if (field.type === "number" || field.type === "point") {
        referenced.push(...field.steps.map((s) => s.grade));
        if (
          rules.players.max === 1 &&
          JSON.stringify(field.steps).includes('"nearest"')
        )
          issue(
            `${p}.${field.id}`,
            "solo_nearest",
            "Ближайший ответ в соло всегда первый",
            true,
          );
      }
      if (
        field.type === "number" &&
        typeof field.target !== "number" &&
        field.target.min > field.target.max
      )
        issue(
          `${p}.${field.id}`,
          "range_order",
          "Начало диапазона больше конца",
        );
      if (
        field.type === "order" &&
        (new Set(field.correct).size !== field.items.length ||
          field.correct.some((x) => !field.items.some((i) => i.id === x)))
      )
        issue(
          `${p}.${field.id}`,
          "order_items",
          "Эталон порядка должен содержать каждый элемент ровно один раз",
        );
      if (
        field.type === "match" &&
        (Object.keys(field.correct).length !== field.left.length ||
          field.left.some(
            (x) => !field.right.some((y) => y.id === field.correct[x.id]),
          ))
      )
        issue(
          `${p}.${field.id}`,
          "match_items",
          "Для каждого левого элемента нужен существующий правый",
        );
      for (const grade of referenced)
        if (!gradeIds.has(grade))
          issue(
            `${p}.${field.id}`,
            "unknown_grade",
            `Неизвестная оценка ${grade}`,
          );
      if (
        field.type === "text" &&
        field.answers.some((a) =>
          field.wrong.some(
            (w) =>
              matchesText(a.text, w, settings).matches ||
              matchesText(w.text, a, settings).matches,
          ),
        )
      )
        issue(
          `${p}.${field.id}`,
          "ambiguous_text",
          "Верный и неверный ответы неотличимы",
          true,
        );
    }
  }
  if (rules.final.type !== "none" && !rules.final.questions.length)
    issue("final.questions", "empty_final", "Для финала нужны вопросы");
  if (
    rules.final.type === "duel" &&
    rules.final.wins > rules.final.questions.length
  )
    issue(
      "final.wins",
      "target_exceeds_pool",
      "Цель дуэли больше запаса вопросов; победит лидер по числу верных ответов, при равенстве — обычный итоговый счёт и тай-брейк",
      true,
    );
  return issues;
}
