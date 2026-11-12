import {
  actionError,
  defineGame,
  type GameContext,
  type RoundResult,
  type SetupContext,
} from "@asobiba/sdk";
import { z } from "zod";
import {
  answersSchema,
  allQuestions,
  blockDuration,
  checkRules,
  resolveQuestion,
  resolveSettings,
  rulesSchema,
  type Answers,
  type AnswerValue,
  type Block,
  type Field,
  type Question,
  type QuizorRules,
  type ResolvedQuestion,
  type Settings,
  type Round,
} from "./rules";
import {
  gradePoints,
  judgeQuestion,
  type FieldGrade,
  type QuestionGrade,
} from "./judge";
import {
  visualSchema,
  checkVisual,
  THEMES,
  VISUAL_CATALOG,
  type QuizorVisual,
} from "./visual";
import { PRESETS } from "./presets";
import { QUIZOR_GUIDE } from "./guide";

const seatSchema = z.int().min(0).max(15);
export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ready"),
    questionId: z.string().max(100).nullable().optional(),
    phase: z.enum(["intro", "preload", "reveal", "round-reveal"]).optional(),
  }),
  z.strictObject({
    type: z.literal("select"),
    questionId: z.string().max(100),
  }),
  z.strictObject({ type: z.literal("answer"), answers: answersSchema }),
  z.strictObject({ type: z.literal("draft"), answers: answersSchema }),
  z.strictObject({
    type: z.literal("buzz"),
    reactionMs: z.number().min(0).max(86400000),
  }),
  z.strictObject({ type: z.literal("pass") }),
  z.strictObject({
    type: z.literal("transfer"),
    seat: seatSchema,
    value: z.number().min(0).max(1e9).optional(),
  }),
  z.strictObject({
    type: z.literal("bid"),
    amount: z.number().min(0).max(1e9),
    allIn: z.boolean().optional(),
  }),
  z.strictObject({ type: z.literal("ban"), questionId: z.string().max(100) }),
  z.strictObject({
    type: z.literal("vote"),
    seat: seatSchema,
    accept: z.boolean().optional(),
    fieldId: z.string().max(100).optional(),
  }),
  z.strictObject({
    type: z.literal("self-grade"),
    grade: z.string().max(100),
    fieldId: z.string().max(100).optional(),
  }),
  z.strictObject({
    type: z.literal("appeal"),
    questionId: z.string().max(100),
    seat: seatSchema,
    points: z.number().min(-1e9).max(1e9),
    comment: z.string().max(500).default(""),
  }),
  z.strictObject({ type: z.literal("appeal-vote"), accept: z.boolean() }),
  z.strictObject({ type: z.literal("hurry") }),
  z.strictObject({ type: z.literal("next-block") }),
]);
export type QuizorAction = z.output<typeof actionSchema>;
export const controlSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("pause") }),
  z.strictObject({ type: z.literal("resume") }),
  z.strictObject({ type: z.literal("close") }),
  z.strictObject({ type: z.literal("next") }),
  z.strictObject({ type: z.literal("next-block") }),
  z.strictObject({ type: z.literal("open") }),
  z.strictObject({
    type: z.literal("grade"),
    seat: seatSchema,
    grade: z.string().max(100),
    fieldId: z.string().max(100).optional(),
    points: z.number().min(-1e9).max(1e9).optional(),
  }),
  z.strictObject({
    type: z.literal("adjust-score"),
    seat: seatSchema,
    delta: z.number().min(-1e9).max(1e9),
    reason: z.string().max(500).optional(),
  }),
  z.strictObject({
    type: z.literal("extend-timer"),
    seconds: z.number().min(-86400).max(86400),
  }),
  z.strictObject({ type: z.literal("skip") }),
  z.strictObject({
    type: z.literal("award-all"),
    grade: z.string().max(100).default("correct"),
  }),
  z.strictObject({ type: z.literal("finish-round") }),
  z.strictObject({
    type: z.literal("select"),
    questionId: z.string().max(100),
  }),
  z.strictObject({ type: z.literal("assign"), seat: seatSchema }),
  z.strictObject({
    type: z.literal("presence"),
    seat: seatSchema,
    online: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("presenter-presence"),
    online: z.boolean(),
  }),
]);
export type QuizorControl = z.output<typeof controlSchema>;
export type Phase =
  | "intro"
  | "board"
  | "special"
  | "preload"
  | "show"
  | "answer"
  | "judging"
  | "reveal"
  | "round-reveal"
  | "final-ban"
  | "done";
export type PublicField = {
  id: string;
  label: string;
  type: Field["type"];
  required: boolean;
  multiline?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  precision?: number;
  step?: number;
  unit?: string;
  input?: "input" | "slider";
  options?: {
    id: string;
    text: string;
    asset?: string;
    media?: "image" | "audio";
  }[];
  items?: {
    id: string;
    text: string;
    asset?: string;
    media?: "image" | "audio";
  }[];
  left?: {
    id: string;
    text: string;
    asset?: string;
    media?: "image" | "audio";
  }[];
  right?: {
    id: string;
    text: string;
    asset?: string;
    media?: "image" | "audio";
  }[];
  maxSelected?: number;
  maxItems?: number;
  asset?: string;
};
export interface Player {
  score: number;
  out: boolean;
  online: boolean;
  streak: number;
  correct: number;
  partial: number;
  fastest: number;
  duelWins: number;
  appeals: number;
}
export interface PublicPlayer {
  seat: number;
  score: number | null;
  out: boolean;
  online: boolean;
  status:
    | "thinking"
    | "answered"
    | "buzzed"
    | "choosing"
    | "bidding"
    | "out"
    | "offline"
    | "ready";
  delta: number | null;
}
export interface Submission {
  answers: Answers;
  submittedAt: number;
  value: number;
  grade: QuestionGrade | null;
}
export interface PublicAnswer {
  seat: number;
  answers: Answers;
  grade: string;
  label: string;
  points: number;
  correct: boolean;
  explanation: string;
  fields: FieldGrade[];
}
export interface HistoryEntry {
  blocks: Block[];
  fields: PublicField[];
  questionId: string;
  roundId: string;
  prompt: string;
  reference: string;
  reveal: Block[];
  answers: PublicAnswer[];
  corrections: string[];
  disclosed: boolean;
}
export interface QuizorEvent {
  id: number;
  text: string;
  seat: number | null;
  at: number;
}
export interface Appeal {
  questionId: string;
  seat: number;
  points: number;
  previous: number;
  author: number;
  comment: string;
  votes: Record<string, boolean>;
  deadline: number;
}
export interface BoardCell {
  questionId: string;
  theme: string;
  value: number;
  played: boolean;
  special?: string;
}
export interface QuizorView {
  revealStartedAt?: number | null;
  revealBlockStartedAt?: number | null;
  revealIndex?: number;
  roundVisual?: QuizorVisual;
  preload?: { asset: string; type: "image" | "audio" | "video" }[];
  answerOpenedAt?: number | null;
  presenterNotes?: string[];
  phase: Phase;
  round: number;
  roundId: string;
  title: string;
  questionId: string | null;
  questionNumber: number;
  questionCount: number;
  prompt: string;
  blocks: Block[];
  blockIndex: number;
  blockStartedAt: number | null;
  fields: PublicField[];
  players: PublicPlayer[];
  seat: number | null;
  canAnswer: boolean;
  eligible: number[];
  owner: number;
  chooser: number;
  answering: number | null;
  ownAnswer: Answers | null;
  submitted: number[];
  answers: PublicAnswer[];
  reference: string;
  reveal: Block[];
  board: BoardCell[];
  themes: { questionId: string; theme: string }[];
  special: {
    type: string;
    topic: string;
    values: number[];
    minimum: number;
    auction: "open" | "sealed";
    allowSelf: boolean;
  } | null;
  bids: Record<string, number>;
  ownBid: number | null;
  bidTurn: number | null;
  deadline: number | null;
  roundDeadline: number | null;
  serverNow: number;
  paused: boolean;
  resumeAt: number | null;
  presenterOnline: boolean;
  appeal: Appeal | null;
  legal: string[];
  controls: string[];
  events: QuizorEvent[];
  history: HistoryEntry[];
  result: RoundResult | null;
  grades: { id: string; label: string }[];
  judging: {
    seat: number;
    fieldId: string;
    judge: string;
    grades?: { id: string; label: string }[];
  }[];
  ready: number[];
  selfReference?: string;
}
export interface QuizorState {
  firstSeat: number;
  recipientTurn: number;
  personalOpenedAt: Record<string, number>;
  personalDeadlines: Record<string, number>;
  personalBlockStartedAt: Record<string, number>;
  revealStartedAt: number | null;
  revealBlockStartedAt: number | null;
  revealIndex: number;
  roundOut: number[];
  roundCorrect: number[];
  optionOrders: Record<string, string[]>;
  themeOrder: string[];
  questionDeadline: number | null;
  attemptCounts: number[];
  retryPenalty: number[];
  attemptAnswers: Record<string, Answers[]>;
  rules: QuizorRules;
  seats: number;
  phase: Phase;
  round: number;
  roundId: string;
  title: string;
  queue: string[];
  remaining: string[];
  played: string[];
  active: ResolvedQuestion | null;
  owner: number;
  chooser: number;
  eligible: number[];
  answering: number | null;
  players: Player[];
  submissions: Record<string, Submission>;
  drafts: Record<string, Answers>;
  ready: number[];
  blockIndex: number;
  personalBlocks: Record<string, number>;
  blockStartedAt: number | null;
  startedAt: number;
  answerOpenedAt: number | null;
  deadline: number | null;
  blockDeadline: number | null;
  roundDeadline: number | null;
  buzzDeadline: number | null;
  buzzes: { seat: number; reactionMs: number }[];
  locks: Record<string, number>;
  bids: Record<string, number>;
  passed: number[];
  bidTurn: number | null;
  highBidder: number | null;
  allIn: boolean;
  transferTarget: number | null;
  paused: boolean;
  pausedAt: number | null;
  resumeAt: number | null;
  now: number;
  presenterOnline: boolean;
  appeal: Appeal | null;
  appealAttempts: string[];
  history: HistoryEntry[];
  events: QuizorEvent[];
  result: RoundResult | null;
  pending: { seat: number; fieldId: string; judge: string }[];
  votes: Record<string, Record<string, boolean>>;
  bestVotes: Record<string, number>;
  finalStarted: boolean;
  finalSeats: number[];
  finalRemaining: string[];
  banVotes: Record<string, string>;
  finalOrder: number[];
  finalRevealIndex: number;
  forcedWinner: number | null;
  tieIndex: number;
}
type Ctx = GameContext<QuizorRules>;
function mediaRefs(
  blocks: Block[],
): { asset: string; type: "image" | "audio" | "video" }[] {
  return blocks.flatMap((b) =>
    b.type === "group"
      ? mediaRefs(b.blocks ?? [])
      : (b.type === "image" || b.type === "audio" || b.type === "video") &&
          b.asset
        ? [{ asset: b.asset, type: b.type }]
        : [],
  );
}
const themeOf = (s: QuizorState, id: string) =>
  s.rules.final.questions.find((q) => q.id === id)?.theme ?? id;
const finalThemes = (s: QuizorState) =>
  s.finalRemaining.filter(
    (id, i, ids) =>
      ids.findIndex((other) => themeOf(s, other) === themeOf(s, id)) === i,
  );
function prepareOptions(s: QuizorState, ctx: Ctx) {
  if (!s.active || settings(s).shuffleOptions === "none") return;
  for (const { field } of s.active.fields) {
    const ids =
      field.type === "choice" || field.type === "multi"
        ? field.options.map((o) => o.id)
        : field.type === "order"
          ? field.items.map((o) => o.id)
          : field.type === "match"
            ? field.right.map((o) => o.id)
            : [];
    if (!ids.length) continue;
    if (settings(s).shuffleOptions === "shared")
      s.optionOrders[`${field.id}:shared`] = ctx.rng.shuffle(ids);
    else
      for (let i = 0; i < s.seats; i++)
        s.optionOrders[`${field.id}:${i}`] = ctx.rng.shuffle(ids);
  }
}
function orderedField(
  s: QuizorState,
  field: Field,
  seat: number | null,
): PublicField {
  const out = publicField(field);
  const ids =
    s.optionOrders[`${field.id}:${seat ?? 0}`] ??
    s.optionOrders[`${field.id}:shared`];
  if (ids) {
    const order = (items: { id: string }[]) =>
      items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    if (out.options) order(out.options);
    if (out.items) order(out.items);
    if (out.right) order(out.right);
  }
  return out;
}
function cfgThemes(s: QuizorState, r: Round, ctx: Ctx): string[] {
  const themes = [
    ...new Set(
      r.questions
        .map((q) => q.theme)
        .filter((v): v is string => v !== undefined)
        .concat(r.themes),
    ),
  ];
  return resolveSettings(["quiz", s.rules.defaults], ["round", r.settings])
    .settings.shuffleThemes
    ? ctx.rng.shuffle(themes)
    : themes;
}
function advanceIntro(s: QuizorState, ctx: Ctx) {
  const blocks = s.rules.rounds[s.round]?.intro ?? [];
  if (s.blockIndex + 1 < blocks.length) {
    s.blockIndex++;
    s.blockStartedAt = s.now;
    setDeadline(s, blockDuration(blocks[s.blockIndex]) / 1000);
  } else afterIntro(s, ctx);
}
function advanceRevealBlock(s: QuizorState) {
  const blocks = s.active?.question.reveal ?? [];
  if (s.revealIndex + 1 < blocks.length) {
    s.revealIndex++;
    s.revealBlockStartedAt = s.now;
    s.blockDeadline = s.now + blockDuration(blocks[s.revealIndex]);
  } else s.blockDeadline = null;
}
const copy = (s: QuizorState): QuizorState => structuredClone(s);
const alive = (s: QuizorState) =>
  s.players.flatMap((p, i) => (p.out || s.roundOut.includes(i) ? [] : [i]));
const connected = (s: QuizorState, seats: number[]) =>
  seats.filter((i) => s.players[i]?.online && !s.players[i]?.out);
const hasPresenter = (s: QuizorState) =>
  s.rules.presenter !== "none" && s.presenterOnline;
const settings = (s: QuizorState): Settings =>
  s.active?.settings ??
  resolveSettings(
    ["quiz", s.rules.defaults],
    ["round", s.rules.rounds[s.round]?.settings],
  ).settings;
function event(s: QuizorState, text: string, seat: number | null = null) {
  s.events.push({ id: (s.events.at(-1)?.id ?? 0) + 1, text, seat, at: s.now });
  if (s.events.length > 200) s.events.shift();
}
function setDeadline(s: QuizorState, seconds: number) {
  s.deadline = seconds > 0 ? s.now + seconds * 1000 : null;
}
function reference(q: ResolvedQuestion): string {
  return (
    q.question.answer ??
    q.fields
      .map(({ field }) =>
        field.type === "text"
          ? field.answers.map((a) => a.text).join(" / ")
          : field.type === "number"
            ? typeof field.target === "number"
              ? String(field.target)
              : `${field.target.min}–${field.target.max}`
            : field.type === "oral"
              ? field.reference
              : field.type === "choice"
                ? field.options
                    .filter(
                      (o) =>
                        q.settings.grades.find((g) => g.id === o.grade)
                          ?.correct,
                    )
                    .map((o) => o.text)
                    .join(", ")
                : field.type === "multi"
                  ? field.options
                      .filter((o) => o.correct)
                      .map((o) => o.text)
                      .join(", ")
                  : field.type === "order"
                    ? field.correct
                        .map((id) => field.items.find((i) => i.id === id)?.text)
                        .join(" → ")
                    : field.type === "match"
                      ? field.left
                          .map(
                            (l) =>
                              `${l.text}: ${field.right.find((r) => r.id === field.correct[l.id])?.text ?? ""}`,
                          )
                          .join("; ")
                      : field.type === "list"
                        ? field.items.map((i) => i.answers[0].text).join(", ")
                        : `(${field.target.x}, ${field.target.y})`,
      )
      .join("; ")
  );
}
function publicAnswer(seat: number, submission: Submission): PublicAnswer {
  const grade = submission.grade!;
  return {
    seat,
    answers: structuredClone(submission.answers),
    grade: grade.grade,
    label: grade.label,
    points: grade.points,
    correct: grade.correct,
    explanation: grade.explanation,
    fields: structuredClone(grade.fields),
  };
}
function cost(s: QuizorState, seat?: number): number {
  const values = settings(s).blockValues;
  return (
    values[
      Math.min(
        seat !== undefined
          ? (s.personalBlocks[seat] ?? s.blockIndex)
          : s.blockIndex,
        values.length - 1,
      )
    ] ?? settings(s).value
  );
}
function boardCells(s: QuizorState): BoardCell[] {
  const r = s.rules.rounds[s.round];
  if (!r || r.format !== "board" || s.finalStarted) return [];
  const columns = Math.max(1, r.values.length);
  return r.questions
    .map((q, i) => ({
      questionId: q.id,
      theme: q.theme ?? r.themes[Math.floor(i / columns)] ?? "Вопросы",
      value:
        q.value ??
        r.values[i % columns] ??
        resolveQuestion(s.rules, q.id).settings.value,
      played: !s.remaining.includes(q.id),
      ...(q.special?.announced ? { special: q.special.type } : {}),
    }))
    .sort(
      (a, b) => s.themeOrder.indexOf(a.theme) - s.themeOrder.indexOf(b.theme),
    );
}
function chooseByScore(
  s: QuizorState,
  seats: number[],
  descending = false,
): number {
  const sorted = [...seats].sort(
    (a, b) =>
      (s.players[a].score - s.players[b].score) * (descending ? -1 : 1) ||
      a - b,
  );
  return sorted[0] ?? 0;
}
function cycle(seats: number[], seat: number): number {
  return seats[(seats.indexOf(seat) + 1) % seats.length] ?? seats[0] ?? 0;
}
function openAnswers(s: QuizorState) {
  if (s.answerOpenedAt !== null) return;
  s.answerOpenedAt = s.now;
  if (s.phase !== "show") s.phase = "answer";
  setDeadline(s, settings(s).timers.answerSeconds);
  s.questionDeadline = s.deadline;
}
function openPersonal(s: QuizorState, seat: number) {
  if (s.personalOpenedAt[seat] !== undefined) return;
  s.personalOpenedAt[seat] = s.now;
  if (settings(s).timers.answerSeconds)
    s.personalDeadlines[seat] = s.now + settings(s).timers.answerSeconds * 1000;
}
function presenterFallback(s: QuizorState, ctx: Ctx) {
  if (s.paused || s.rules.presenter !== "optional" || hasPresenter(s)) return;
  if (s.phase === "judging") {
    s.pending = s.pending.flatMap((p) => {
      if (p.judge !== "presenter") return [p];
      const field = s.active?.fields.find(
        (f) => f.field.id === p.fieldId,
      )?.field;
      return field?.type === "oral"
        ? [{ ...p, judge: s.seats === 1 ? "self" : "vote" }]
        : [];
    });
    if (!s.pending.length) finishScores(s, ctx);
    else if (s.deadline === null)
      setDeadline(s, settings(s).timers.buzzSeconds || 30);
  } else if (
    s.phase === "show" &&
    settings(s).pacing === "presenter" &&
    s.blockDeadline === null &&
    s.active
  )
    s.blockDeadline =
      s.now + blockDuration(s.active.question.blocks[s.blockIndex]);
  else if (
    s.phase === "answer" &&
    s.answerOpenedAt === null &&
    settings(s).answerOpen === "presenter"
  )
    openAnswers(s);
  else if (
    (s.phase === "reveal" || s.phase === "round-reveal") &&
    s.deadline === null
  )
    setDeadline(s, settings(s).timers.revealSeconds || 0.001);
}
function resolvePendingVotes(s: QuizorState) {
  for (const p of [...s.pending])
    if (p.judge === "vote") {
      const votes = Object.values(s.votes[`${p.seat}:${p.fieldId}`] ?? {});
      replaceGrade(
        s,
        p.seat,
        votes.filter(Boolean).length > votes.length / 2 ? "correct" : "miss",
        p.fieldId,
      );
    } else if (p.judge === "best") {
      const count = Object.entries(s.bestVotes).filter(
        ([key, seat]) => key.startsWith(`${p.fieldId}:`) && seat === p.seat,
      ).length;
      const value =
        s.active?.fields.find((f) => f.field.id === p.fieldId)?.settings
          .value ?? settings(s).value;
      replaceGrade(
        s,
        p.seat,
        count ? "correct" : "miss",
        p.fieldId,
        count * value,
      );
    }
}
function beginContent(s: QuizorState) {
  s.questionDeadline = null;
  s.phase = "preload";
  s.ready = [];
  s.blockIndex = -1;
  s.blockStartedAt = null;
  s.answerOpenedAt = null;
  setDeadline(s, settings(s).timers.preloadSeconds);
  if (!settings(s).timers.preloadSeconds) showNext(s);
}
function showNext(s: QuizorState) {
  if (!s.active) return;
  s.deadline = s.answerOpenedAt === null ? null : s.questionDeadline;
  s.ready = [];
  s.blockIndex++;
  s.blockStartedAt = s.now;
  if (s.blockIndex >= s.active.question.blocks.length) {
    s.phase = "answer";
    s.blockDeadline = null;
    if (settings(s).answerOpen !== "presenter" || !hasPresenter(s)) {
      if (settings(s).pacing === "self")
        for (const seat of s.eligible) {
          s.personalBlocks[seat] = s.blockIndex;
          openPersonal(s, seat);
        }
      else openAnswers(s);
    }
    return;
  }
  s.phase = "show";
  const pacing = settings(s).pacing;
  if (pacing === "self") {
    for (const seat of s.eligible) {
      s.personalBlocks[seat] = s.blockIndex;
      s.personalBlockStartedAt[seat] = s.now;
      if (
        settings(s).answerOpen === "first" ||
        (settings(s).answerOpen === "block" &&
          s.blockIndex >= settings(s).openBlock)
      )
        openPersonal(s, seat);
    }
    return;
  }
  s.blockDeadline =
    pacing === "auto" || (pacing === "presenter" && !hasPresenter(s))
      ? s.now + blockDuration(s.active.question.blocks[s.blockIndex])
      : null;
  if (
    settings(s).answerOpen === "first" ||
    (settings(s).answerOpen === "block" &&
      s.blockIndex >= settings(s).openBlock)
  )
    openAnswers(s);
}
function beginQuestion(s: QuizorState, id: string, ctx: Ctx) {
  s.active = resolveQuestion(s.rules, id);
  if (hasPresenter(s)) {
    if (s.active.provenance.advance === "game")
      s.active.settings.advance = "presenter";
    if (s.active.provenance.judge === "game")
      s.active.settings.judge = "assisted";
    for (const field of s.active.fields)
      if (field.provenance.judge === "game") field.settings.judge = "assisted";
  }
  const cell = boardCells(s).find((c) => c.questionId === id);
  if (cell) {
    const explicit =
      s.active.question.value !== undefined ||
      s.active.question.settings?.value !== undefined;
    if (!explicit) {
      s.active.settings.value = cell.value;
      for (const f of s.active.fields)
        if (f.field.settings?.value === undefined)
          f.settings.value = cell.value;
    }
  }
  s.played.push(id);
  s.remaining = s.remaining.filter((x) => x !== id);
  s.submissions = {};
  s.drafts = {};
  s.attemptCounts = Array(s.seats).fill(0);
  s.retryPenalty = Array(s.seats).fill(0);
  s.attemptAnswers = {};
  s.optionOrders = {};
  s.votes = {};
  s.bestVotes = {};
  s.pending = [];
  s.bids = {};
  s.passed = [];
  s.bidTurn = null;
  s.highBidder = null;
  s.allIn = false;
  s.transferTarget = null;
  s.answering = null;
  s.buzzes = [];
  s.buzzDeadline = null;
  s.locks = {};
  s.ready = [];
  s.personalBlocks = {};
  s.personalOpenedAt = {};
  s.personalDeadlines = {};
  s.personalBlockStartedAt = {};
  s.blockDeadline = null;
  s.finalRevealIndex = 0;
  if (s.finalStarted && s.roundId === "final") {
    if (!s.rules.final.settings?.mode && !s.active.question.settings?.mode)
      s.active.settings.mode = "secret";
    if (
      !s.rules.final.settings?.recipient &&
      !s.active.question.settings?.recipient
    )
      s.active.settings.recipient = "all";
  }
  if (s.active.question.special) s.active.settings.mode = "secret";
  const actors = s.finalStarted ? s.finalSeats : alive(s);
  const recipient = settings(s).recipient;
  s.eligible =
    recipient === "all"
      ? [...actors]
      : [
          recipient === "random"
            ? ctx.rng.pick(actors)
            : recipient === "leader"
              ? chooseByScore(s, actors, true)
              : recipient === "trailing"
                ? chooseByScore(s, actors)
                : recipient === "chooser"
                  ? s.chooser
                  : recipient === "turn"
                    ? s.recipientTurn
                    : s.owner,
        ];
  if (settings(s).mode === "chooser") s.eligible = [s.chooser];
  if (settings(s).mode === "turns") s.eligible = [s.recipientTurn];
  prepareOptions(s, ctx);
  const special = s.active.question.special;
  if (
    s.finalStarted &&
    (s.rules.final.type === "wager" ||
      s.rules.final.type === "elimination-wager")
  ) {
    s.phase = "special";
    s.eligible = [...s.finalSeats];
    setDeadline(s, settings(s).timers.wagerSeconds);
    return;
  }
  if (special) {
    s.phase = "special";
    if (special.type === "gift") {
      s.eligible = [s.owner];
      s.submissions[s.owner] = {
        answers: {},
        submittedAt: s.now,
        value: cost(s),
        grade: {
          ...gradePoints(settings(s), "correct"),
          doubtful: false,
          fields: [],
          explanation: "Подарок",
        },
      };
      finishScores(s, ctx);
      return;
    }
    if (special.type === "risk-free") {
      s.eligible = [s.owner];
      s.active.settings.value *= 2;
      for (const f of s.active.fields) f.settings.value *= 2;
      beginContent(s);
      return;
    }
    if (special.type === "auction") {
      s.eligible = [...actors];
      s.bidTurn = special.auction === "open" ? s.owner : null;
    } else if (special.type !== "wager-all") s.eligible = [s.owner];
    setDeadline(s, settings(s).timers.wagerSeconds);
    return;
  }
  if (s.finalStarted && s.rules.final.type === "duel") {
    s.active.settings.mode = "buzz";
    s.eligible = [...s.finalSeats];
  }
  if (s.roundId === "tiebreak") {
    s.active.settings.mode =
      s.tieIndex === 1 && s.active.fields.some((f) => f.field.type === "number")
        ? "secret"
        : "buzz";
    if (s.active.settings.mode === "secret")
      for (const f of s.active.fields)
        if (f.field.type === "number")
          f.field.steps = [
            {
              condition: { type: "nearest", rank: 1, side: "any" },
              grade: gradePoints(f.settings, "correct").grade,
            },
          ];
    s.eligible = [...s.finalSeats];
  }
  beginContent(s);
}
function startRound(s: QuizorState, index: number, ctx: Ctx) {
  s.roundOut = [];
  s.roundCorrect = Array(s.seats).fill(0);
  s.round = index;
  const r = s.rules.rounds[index];
  s.roundId = r.id;
  s.title = r.title;
  s.active = null;
  s.eligible = alive(s);
  s.recipientTurn = s.eligible.includes(s.firstSeat)
    ? s.firstSeat
    : (s.eligible[0] ?? 0);
  s.themeOrder = cfgThemes(s, r, ctx);
  s.ready = [];
  s.phase = "intro";
  s.played = [];
  s.blockIndex = r.intro.length ? 0 : -1;
  s.blockStartedAt = s.now;
  s.blockDeadline = null;
  s.answerOpenedAt = null;
  const cfg = resolveSettings(
    ["quiz", s.rules.defaults],
    [`round:${r.id}`, r.settings],
  ).settings;
  let questions = r.questions.map((q) => q.id);
  if (cfg.shuffleQuestions || r.take) questions = ctx.rng.shuffle(questions);
  s.queue = questions.slice(0, r.take ?? questions.length);
  s.remaining = [...s.queue];
  s.chooser =
    r.firstChooser === "random"
      ? ctx.rng.pick(s.eligible)
      : r.firstChooser === "trailing"
        ? chooseByScore(s, s.eligible)
        : (s.eligible[0] ?? 0);
  s.owner = s.chooser;
  s.roundDeadline = cfg.timers.roundSeconds
    ? s.now + cfg.timers.roundSeconds * 1000
    : null;
  setDeadline(
    s,
    r.intro[0] ? Math.max(0.001, blockDuration(r.intro[0]) / 1000) : 0.001,
  );
}
function afterIntro(s: QuizorState, ctx: Ctx) {
  const r = s.rules.rounds[s.round];
  if (r?.format === "board" && !s.finalStarted) {
    s.phase = "board";
    s.active = null;
    s.ready = [];
    setDeadline(s, settings(s).timers.selectionSeconds);
  } else if (s.remaining[0]) beginQuestion(s, s.remaining[0], ctx);
  else endRound(s, ctx);
}
function finalCandidates(s: QuizorState): number[] {
  const f = s.rules.final;
  let seats = alive(s);
  if (f.eligibility === "positive")
    seats = seats.filter((i) => s.players[i].score > 0);
  if (f.eligibility === "threshold")
    seats = seats.filter((i) => s.players[i].score >= f.threshold);
  if (f.eligibility === "top")
    seats = seats
      .sort((a, b) => s.players[b].score - s.players[a].score || a - b)
      .slice(0, f.top);
  if (
    (f.type === "wager" || f.type === "elimination-wager") &&
    f.minimumWager === 0
  )
    seats = seats.filter((i) => s.players[i].score > 0);
  return seats;
}
function startFinal(s: QuizorState, ctx: Ctx) {
  s.roundOut = [];
  if (s.rules.final.type === "none") {
    finish(s, ctx);
    return;
  }
  s.finalStarted = true;
  s.finalSeats = finalCandidates(s);
  if (!s.finalSeats.length) {
    event(s, "Финал пропущен: никто не прошёл");
    finish(s, ctx);
    return;
  }
  s.roundId = "final";
  s.title = "Финал";
  s.active = null;
  s.eligible = [...s.finalSeats];
  s.finalRemaining = s.rules.final.questions.map((q) => q.id);
  s.queue = [...s.finalRemaining];
  s.played = [];
  s.remaining = [...s.finalRemaining];
  s.finalOrder =
    s.rules.final.banOrder === "turn"
      ? [...s.finalSeats]
      : [...s.finalSeats].sort(
          (a, b) => s.players[a].score - s.players[b].score || a - b,
        );
  if (s.rules.final.type === "duel")
    s.finalSeats = [...s.finalSeats]
      .sort((a, b) => s.players[b].score - s.players[a].score || a - b)
      .slice(0, 2);
  s.owner = s.finalOrder[0];
  s.roundDeadline = null;
  if (
    s.rules.final.type === "elimination-wager" &&
    finalThemes(s).length > s.rules.final.keepThemes
  ) {
    s.phase = "final-ban";
    s.banVotes = {};
    setDeadline(s, settings(s).timers.selectionSeconds);
  } else if (s.remaining[0]) beginQuestion(s, s.remaining[0], ctx);
  else finish(s, ctx);
}
function endRound(s: QuizorState, ctx: Ctx) {
  const hidden = s.history.filter(
    (h) => h.roundId === s.roundId && !h.disclosed,
  );
  if (hidden.length) {
    for (const h of hidden) h.disclosed = true;
    s.phase = "round-reveal";
    s.active = null;
    s.ready = [];
    setDeadline(s, settings(s).timers.revealSeconds);
    return;
  }
  if (s.finalStarted) {
    finish(s, ctx);
    return;
  }
  const r = s.rules.rounds[s.round];
  if (r.eliminateLast && alive(s).length > 1) {
    const seat = chooseByScore(s, alive(s));
    s.players[seat].out = true;
    event(s, "Выбыл по итогам раунда", seat);
  }
  if (s.round + 1 < s.rules.rounds.length) startRound(s, s.round + 1, ctx);
  else startFinal(s, ctx);
}
function finish(s: QuizorState, ctx: Ctx) {
  let contenders = s.forcedWinner === null ? alive(s) : [s.forcedWinner];
  if (!contenders.length) contenders = s.players.map((_, i) => i);
  const best = Math.max(...contenders.map((i) => s.players[i].score));
  const winners =
    s.forcedWinner === null
      ? contenders.filter((i) => s.players[i].score === best)
      : [s.forcedWinner];
  if (winners.length > 1 && s.tieIndex < s.rules.tiebreak.length) {
    s.finalStarted = true;
    s.finalSeats = winners;
    s.roundId = "tiebreak";
    s.title = "Тай-брейк";
    s.roundDeadline = null;
    s.owner = winners[0];
    const q = s.rules.tiebreak[s.tieIndex++];
    beginQuestion(s, q.id, ctx);
    return;
  }
  s.phase = "done";
  s.result = {
    winners,
    losers: s.players.flatMap((_, i) => (winners.includes(i) ? [] : [i])),
    draw: winners.length > 1,
    reason: winners.length > 1 ? "shared-victory" : "quiz-complete",
    summary:
      winners.length > 1 ? "равный итоговый счёт" : "набрано больше очков",
  };
  s.deadline = null;
  s.blockDeadline = null;
  s.roundDeadline = null;
  s.buzzDeadline = null;
  s.appeal = null;
  for (const h of s.history) h.disclosed = true;
  event(s, "Квиз завершён");
}
function afterReveal(s: QuizorState, ctx: Ctx) {
  if (s.phase === "round-reveal") {
    if (s.finalStarted) finish(s, ctx);
    else {
      const r = s.rules.rounds[s.round];
      if (r.eliminateLast && alive(s).length > 1)
        s.players[chooseByScore(s, alive(s))].out = true;
      if (s.round + 1 < s.rules.rounds.length) startRound(s, s.round + 1, ctx);
      else startFinal(s, ctx);
    }
    return;
  }
  const last = s.history.at(-1);
  const correct =
    last?.answers
      .filter((a) => a.correct)
      .sort(
        (a, b) =>
          (s.submissions[a.seat]?.submittedAt ?? 0) -
          (s.submissions[b.seat]?.submittedAt ?? 0),
      ) ?? [];
  s.recipientTurn = cycle(
    s.finalStarted ? s.finalSeats : alive(s),
    s.recipientTurn,
  );
  if (s.roundId === "tiebreak") {
    if (correct.length === 1) {
      s.forcedWinner = correct[0].seat;
      finish(s, ctx);
      return;
    }
    if (correct.length) s.finalSeats = correct.map((c) => c.seat);
    finish(s, ctx);
    return;
  }
  if (s.finalStarted) {
    const f = s.rules.final;
    if (f.type === "survival") {
      if (correct.length) {
        s.finalSeats = correct.map((a) => a.seat);
        for (const i of alive(s))
          if (!s.finalSeats.includes(i)) s.players[i].out = true;
      }
      if (s.finalSeats.length === 1) {
        s.players[s.finalSeats[0]].score += f.bonus;
        finish(s, ctx);
        return;
      }
    }
    if (f.type === "duel") {
      for (const a of correct) s.players[a.seat].duelWins++;
      let win = s.finalSeats.find((i) => s.players[i].duelWins >= f.wins);
      if (win === undefined && !s.remaining.length) {
        const most = Math.max(
          ...s.finalSeats.map((i) => s.players[i].duelWins),
        );
        const leaders = s.finalSeats.filter(
          (i) => s.players[i].duelWins === most,
        );
        if (leaders.length === 1) win = leaders[0];
      }
      if (win !== undefined) {
        s.players[win].score += f.bonus;
        if (f.directWinner) s.forcedWinner = win;
        finish(s, ctx);
        return;
      }
    }
    if (s.remaining[0]) {
      beginQuestion(s, s.remaining[0], ctx);
      return;
    }
    finish(s, ctx);
    return;
  }
  const r = s.rules.rounds[s.round];
  const seats = alive(s);
  if (r.nextChooser === "trailing") s.chooser = chooseByScore(s, seats);
  else if (r.nextChooser === "turn") s.chooser = cycle(seats, s.chooser);
  else if (correct[0]) s.chooser = correct[0].seat;
  s.owner =
    r.owner === "trailing"
      ? chooseByScore(s, seats)
      : r.owner === "fastest"
        ? (correct[0]?.seat ?? s.owner)
        : cycle(seats, s.owner);
  if (!s.remaining.length) {
    endRound(s, ctx);
    return;
  }
  if (r.format === "board") {
    s.active = null;
    s.phase = "board";
    s.ready = [];
    setDeadline(s, settings(s).timers.selectionSeconds);
  } else beginQuestion(s, s.remaining[0], ctx);
}
function reaggregate(s: QuizorState, seat: number) {
  const sub = s.submissions[seat];
  if (!sub?.grade || !s.active) return;
  const fields = sub.grade.fields;
  const required = fields.filter(
    (f) =>
      s.active!.fields.find((x) => x.field.id === f.fieldId)?.field.required,
  );
  const correct = required.every((f) => f.correct);
  const count = fields.filter((f) => f.correct).length;
  const cfg = settings(s);
  const combined =
    cfg.combine === "sum"
      ? null
      : gradePoints(
          cfg,
          cfg.combine === "all"
            ? correct
              ? "correct"
              : "miss"
            : (cfg.countGrades[String(count)] ??
                (correct ? "correct" : count ? "partial" : "miss")),
        );
  const points = combined?.points ?? fields.reduce((n, f) => n + f.points, 0);
  const grade =
    combined?.grade ??
    (correct
      ? "correct"
      : fields.some((f) => f.grade === "fail")
        ? "fail"
        : points > 0
          ? "partial"
          : fields.every((f) => f.grade === "silence")
            ? "silence"
            : "miss");
  sub.grade = {
    grade,
    label: combined?.label ?? gradePoints(cfg, grade).label,
    points,
    correct: combined?.correct ?? correct,
    doubtful: fields.some((f) => f.doubtful),
    fields,
    explanation: fields.map((f) => f.explanation).join("; "),
  };
}
function replaceGrade(
  s: QuizorState,
  seat: number,
  gradeId: string,
  fieldId?: string,
  points?: number,
) {
  const sub = s.submissions[seat];
  if (!sub?.grade || !s.active) return false;
  const cfg = fieldId
    ? s.active.fields.find((f) => f.field.id === fieldId)?.settings
    : settings(s);
  if (!cfg || !cfg.grades.some((g) => g.id === gradePoints(cfg, gradeId).grade))
    return false;
  if (fieldId) {
    const f = sub.grade.fields.find((f) => f.fieldId === fieldId);
    if (!f) return false;
    Object.assign(f, gradePoints(cfg, gradeId, sub.value), {
      doubtful: false,
      explanation: "Решение судьи",
    });
    if (points !== undefined) f.points = points;
    reaggregate(s, seat);
  } else {
    Object.assign(sub.grade, gradePoints(cfg, gradeId, sub.value), {
      doubtful: false,
      explanation: "Решение судьи",
    });
    if (points !== undefined) sub.grade.points = points;
  }
  s.pending = s.pending.filter(
    (p) => p.seat !== seat || (fieldId !== undefined && p.fieldId !== fieldId),
  );
  return true;
}
function closeQuestion(s: QuizorState, ctx: Ctx) {
  if (!s.active) return;
  s.phase = "judging";
  s.personalDeadlines = {};
  s.questionDeadline = null;
  s.deadline = null;
  s.blockDeadline = null;
  s.buzzDeadline = null;
  s.answering = null;
  const cfg = settings(s);
  const peers = Object.values(s.submissions).map((a) => a.answers);
  for (const seat of s.eligible) {
    if (!s.submissions[seat]) {
      const draft = cfg.autoSubmit ? s.drafts[seat] : undefined;
      s.submissions[seat] = {
        answers: draft ?? {},
        submittedAt: s.now,
        value: cost(s),
        grade: null,
      };
    }
    const sub = s.submissions[seat];
    const q = structuredClone(s.active);
    q.settings.value = sub.value;
    for (const f of q.fields)
      if (f.field.settings?.value === undefined) f.settings.value = sub.value;
    sub.grade = judgeQuestion(q, sub.answers, peers);
    for (const f of q.fields) {
      const judge = f.settings.judge;
      const g = sub.grade.fields.find((g) => g.fieldId === f.field.id)!;
      let human: string | null = null;
      if (judge === "self") human = "self";
      else if (judge === "best") human = "best";
      else if (judge === "vote") human = "vote";
      else if (
        (judge === "presenter" || judge === "assisted") &&
        hasPresenter(s)
      )
        human = "presenter";
      else if (
        (judge === "presenter" || judge === "assisted") &&
        f.field.type === "oral"
      )
        human = s.seats === 1 ? "self" : "vote";
      else if (g.doubtful && f.settings.doubtful === "vote") human = "vote";
      else if (
        g.doubtful &&
        f.settings.doubtful === "presenter" &&
        hasPresenter(s)
      )
        human = "presenter";
      if (human && Object.keys(sub.answers).length)
        s.pending.push({ seat, fieldId: f.field.id, judge: human });
    }
  }
  if (s.pending.length) {
    if (s.pending.some((p) => p.judge === "presenter")) s.deadline = null;
    else setDeadline(s, cfg.timers.buzzSeconds || 30);
  } else finishScores(s, ctx);
}
function finishScores(s: QuizorState, ctx: Ctx) {
  if (
    !s.active ||
    s.history.some((h) => h.questionId === s.active!.question.id)
  )
    return;
  const cfg = settings(s);
  const answers = Object.entries(s.submissions)
    .filter(([, sub]) => sub.grade)
    .map(([seat, sub]) => publicAnswer(Number(seat), sub));
  const correct = answers
    .filter((a) => a.correct)
    .sort(
      (a, b) =>
        s.submissions[a.seat].submittedAt - s.submissions[b.seat].submittedAt ||
        a.seat - b.seat,
    );
  for (const answer of answers) {
    const p = s.players[answer.seat];
    const sub = s.submissions[answer.seat];
    let points = answer.points;
    const special = s.active.question.special?.type;
    const wager = s.bids[answer.seat];
    if (
      wager !== undefined &&
      (special === "auction" ||
        special === "wager" ||
        special === "wager-all" ||
        (s.finalStarted &&
          (s.rules.final.type === "wager" ||
            s.rules.final.type === "elimination-wager")))
    )
      points = answer.correct ? wager : -wager;
    else if (special === "risk-free" && !answer.correct)
      points = Math.max(0, points);
    else if (
      cfg.mode === "buzz" &&
      !answer.correct &&
      answer.grade !== "silence" &&
      points === 0
    )
      points = -sub.value;
    if (answer.correct) {
      p.streak++;
      p.correct++;
      s.roundCorrect[answer.seat]++;
      if (cfg.bonuses.speed === "rank")
        points +=
          cfg.bonuses.rankPoints[
            correct.findIndex((a) => a.seat === answer.seat)
          ] ?? 0;
      if (cfg.bonuses.speed === "linear") {
        const duration = cfg.timers.answerSeconds * 1000 || 30000;
        points += Math.round(
          sub.value *
            cfg.bonuses.speedFraction *
            Math.max(
              0,
              1 -
                (sub.submittedAt - (s.answerOpenedAt ?? sub.submittedAt)) /
                  duration,
            ),
        );
      }
      if (cfg.bonuses.streakEvery && p.streak % cfg.bonuses.streakEvery === 0)
        points =
          Math.round(points * cfg.bonuses.streakMultiplier) +
          cfg.bonuses.streakBonus;
      if (correct.length === 1) points += cfg.bonuses.uniqueBonus;
    } else {
      p.streak = 0;
      if (answer.grade === "partial") p.partial++;
    }
    points += s.retryPenalty[answer.seat];
    const before = p.score;
    p.score = cfg.allowNegative
      ? before + points
      : Math.max(0, before + points);
    answer.points = p.score - before;
    if (sub.grade) sub.grade.points = answer.points;
  }
  if (correct[0]) s.players[correct[0].seat].fastest++;
  if (!s.finalStarted) {
    const round = s.rules.rounds[s.round];
    if (round.eliminateOnError && correct.length) {
      for (const a of answers)
        if (!a.correct && !s.roundOut.includes(a.seat)) s.roundOut.push(a.seat);
      if (alive(s).length <= round.survivors) s.remaining = [];
    }
    const winner = s.roundCorrect.findIndex(
      (n) => round.winsToEnd > 0 && n >= round.winsToEnd,
    );
    if (winner >= 0) {
      s.players[winner].score += round.winnerBonus;
      s.remaining = [];
    }
  }
  s.history.push({
    blocks: structuredClone(
      s.active.question.blocks.slice(
        0,
        Math.max(
          0,
          s.blockIndex + 1,
          ...Object.values(s.personalBlocks).map((i) => i + 1),
        ),
      ),
    ),
    fields:
      s.answerOpenedAt === null
        ? []
        : s.active.fields.map((f) => publicField(f.field)),
    questionId: s.active.question.id,
    roundId: s.roundId,
    prompt: s.active.question.prompt,
    reference: reference(s.active),
    reveal: structuredClone(s.active.question.reveal),
    answers,
    corrections: [],
    disclosed: cfg.reveal === "question",
  });
  s.phase = "reveal";
  s.revealStartedAt = s.now;
  s.revealBlockStartedAt = s.now;
  s.revealIndex = 0;
  s.blockDeadline = s.active.question.reveal[0]
    ? s.now + blockDuration(s.active.question.reveal[0])
    : null;
  s.ready = [];
  s.pending = [];
  s.finalRevealIndex = s.finalStarted ? 0 : answers.length;
  setDeadline(
    s,
    cfg.reveal !== "question"
      ? 0.001
      : Math.max(
          cfg.timers.revealSeconds,
          s.active.question.reveal.reduce(
            (n, b) => n + blockDuration(b) / 1000,
            0,
          ),
        ),
  );
  if (cfg.advance === "presenter" && hasPresenter(s)) s.deadline = null;
  event(s, "Вопрос завершён");
}
function canAnswer(s: QuizorState, seat: number): boolean {
  if (
    s.paused ||
    (s.phase !== "answer" && s.phase !== "show") ||
    (settings(s).pacing === "self"
      ? s.personalOpenedAt[seat] === undefined
      : s.answerOpenedAt === null) ||
    !s.eligible.includes(seat) ||
    s.players[seat].out ||
    s.roundOut.includes(seat) ||
    !s.players[seat].online
  )
    return false;
  if (settings(s).mode === "buzz") return s.answering === seat;
  return !s.submissions[seat] || settings(s).editable;
}
function allAnswered(s: QuizorState): boolean {
  const actors = connected(s, s.eligible);
  return actors.length > 0 && actors.every((i) => !!s.submissions[i]);
}
function resolveAppeal(s: QuizorState) {
  const a = s.appeal;
  if (!a) return;
  const votes = Object.values(a.votes);
  const yes = votes.filter(Boolean).length;
  const approved = s.seats === 1 || yes > votes.length / 2;
  if (approved) {
    const h = s.history.find((h) => h.questionId === a.questionId);
    const answer = h?.answers.find((x) => x.seat === a.seat);
    if (answer) {
      s.players[a.seat].score += a.points - answer.points;
      answer.points = a.points;
      h!.corrections.push(
        `Апелляция: ${a.points} вместо ${a.previous}, принято ${yes} из ${votes.length}`,
      );
    }
  }
  event(
    s,
    approved
      ? `Апелляция принята: ${a.points} вместо ${a.previous}`
      : "Апелляция отклонена",
    a.seat,
  );
  s.appeal = null;
}
function settleAuction(s: QuizorState, ctx: Ctx) {
  const candidates = Object.keys(s.bids).map(Number);
  const winner = candidates.sort(
    (a, b) => s.bids[b] - s.bids[a] || s.players[a].score - s.players[b].score,
  )[0];
  let seat = winner ?? s.owner;
  if (winner !== undefined) {
    const tied = candidates.filter(
      (i) =>
        s.bids[i] === s.bids[winner] &&
        s.players[i].score === s.players[winner].score,
    );
    if (tied.length > 1) seat = ctx.rng.pick(tied);
  } else s.bids[seat] = minimumBid(s);
  s.eligible = [seat];
  s.owner = seat;
  s.bidTurn = null;
  beginContent(s);
}
function minimumBid(s: QuizorState) {
  return s.finalStarted
    ? s.rules.final.minimumWager
    : (s.active?.question.special?.minimum ?? cost(s));
}
function maxBid(s: QuizorState, seat: number) {
  const min = minimumBid(s);
  if (s.finalStarted) return Math.max(min, s.players[seat].score);
  const prices = s.rules.rounds[s.round]?.values ?? [];
  return s.active?.question.special?.type === "wager"
    ? Math.max(min, s.players[seat].score, ...prices)
    : Math.max(min, s.players[seat].score);
}
function setup(ctx: SetupContext<QuizorRules>): QuizorState {
  const s: QuizorState = {
    firstSeat: ctx.firstSeat,
    recipientTurn: ctx.firstSeat,
    personalOpenedAt: {},
    personalDeadlines: {},
    personalBlockStartedAt: {},
    revealStartedAt: null,
    revealBlockStartedAt: null,
    revealIndex: 0,
    roundOut: [],
    roundCorrect: Array(ctx.seats).fill(0),
    optionOrders: {},
    themeOrder: [],
    questionDeadline: null,
    attemptCounts: Array(ctx.seats).fill(0),
    retryPenalty: Array(ctx.seats).fill(0),
    attemptAnswers: {},
    rules: ctx.rules,
    seats: ctx.seats,
    phase: "intro",
    round: 0,
    roundId: "",
    title: "",
    queue: [],
    remaining: [],
    played: [],
    active: null,
    owner: ctx.firstSeat,
    chooser: ctx.firstSeat,
    eligible: [],
    answering: null,
    players: Array.from({ length: ctx.seats }, () => ({
      score: 0,
      out: false,
      online: true,
      streak: 0,
      correct: 0,
      partial: 0,
      fastest: 0,
      duelWins: 0,
      appeals: 0,
    })),
    submissions: {},
    drafts: {},
    ready: [],
    blockIndex: -1,
    personalBlocks: {},
    blockStartedAt: null,
    startedAt: ctx.now,
    answerOpenedAt: null,
    deadline: null,
    blockDeadline: null,
    roundDeadline: null,
    buzzDeadline: null,
    buzzes: [],
    locks: {},
    bids: {},
    passed: [],
    bidTurn: null,
    highBidder: null,
    allIn: false,
    transferTarget: null,
    paused: false,
    pausedAt: null,
    resumeAt: null,
    now: ctx.now,
    presenterOnline: false,
    appeal: null,
    appealAttempts: [],
    history: [],
    events: [],
    result: null,
    pending: [],
    votes: {},
    bestVotes: {},
    finalStarted: false,
    finalSeats: [],
    finalRemaining: [],
    banVotes: {},
    finalOrder: [],
    finalRevealIndex: 0,
    forcedWinner: null,
    tieIndex: 0,
  };
  startRound(s, 0, ctx);
  return s;
}
function nextWakeAt(s: QuizorState): number | null {
  if (s.paused) return s.resumeAt;
  const values = [
    s.deadline,
    s.questionDeadline,
    s.blockDeadline,
    s.roundDeadline,
    s.buzzDeadline,
    s.appeal?.deadline ?? null,
    ...Object.values(s.personalDeadlines),
    ...Object.values(s.locks).filter((at) => at > s.now),
  ].filter((n): n is number => n !== null);
  return values.length ? Math.min(...values) : null;
}
function shiftDeadlines(s: QuizorState, delta: number) {
  for (const key of [
    "deadline",
    "questionDeadline",
    "blockDeadline",
    "roundDeadline",
    "buzzDeadline",
    "blockStartedAt",
    "answerOpenedAt",
    "revealStartedAt",
    "revealBlockStartedAt",
  ] as const)
    if (s[key] !== null) s[key]! += delta;
  if (s.appeal) s.appeal.deadline += delta;
  for (const map of [
    s.locks,
    s.personalDeadlines,
    s.personalOpenedAt,
    s.personalBlockStartedAt,
  ])
    for (const seat of Object.keys(map)) map[seat] += delta;
  for (const sub of Object.values(s.submissions)) sub.submittedAt += delta;
}
function wake(state: QuizorState, ctx: Ctx): QuizorState {
  const s = copy(state);
  s.now = ctx.now;
  if (s.phase === "done") return s;
  if (s.paused) {
    if (s.resumeAt !== null && s.now >= s.resumeAt) {
      shiftDeadlines(s, s.resumeAt - (s.pausedAt ?? s.resumeAt));
      s.paused = false;
      s.pausedAt = null;
      s.resumeAt = null;
      event(s, "Партия продолжается");
    } else return s;
  }
  if (
    (s.phase === "answer" || s.phase === "show") &&
    settings(s).pacing === "self"
  ) {
    for (const [seat, deadline] of Object.entries(s.personalDeadlines))
      if (s.now >= deadline) {
        if (!s.submissions[seat])
          s.submissions[seat] = {
            answers: settings(s).autoSubmit ? (s.drafts[seat] ?? {}) : {},
            submittedAt: s.now,
            value: cost(s, Number(seat)),
            grade: null,
          };
        delete s.personalDeadlines[seat];
      }
  }
  if (
    (s.phase === "answer" || s.phase === "show") &&
    allAnswered(s) &&
    !settings(s).editable
  ) {
    closeQuestion(s, ctx);
    return s;
  }
  if (
    s.questionDeadline !== null &&
    s.now >= s.questionDeadline &&
    (s.phase === "answer" || s.phase === "show")
  ) {
    s.questionDeadline = null;
    closeQuestion(s, ctx);
    return s;
  }
  presenterFallback(s, ctx);
  if (s.appeal && s.now >= s.appeal.deadline) resolveAppeal(s);
  if (s.roundDeadline !== null && s.now >= s.roundDeadline) {
    s.roundDeadline = null;
    s.remaining = [];
    event(s, "Время раунда вышло");
    if (s.phase === "answer" || s.phase === "show" || s.phase === "preload")
      closeQuestion(s, ctx);
    else if (s.phase !== "reveal" && s.phase !== "judging") endRound(s, ctx);
    return s;
  }
  if (s.buzzDeadline !== null && s.now >= s.buzzDeadline) {
    s.buzzDeadline = null;
    const candidates = s.buzzes
      .filter((b) => s.eligible.includes(b.seat) && !s.submissions[b.seat])
      .sort((a, b) => a.reactionMs - b.reactionMs || a.seat - b.seat);
    if (candidates[0]) {
      s.answering = candidates[0].seat;
      setDeadline(s, settings(s).timers.buzzSeconds);
      event(s, "Кнопка получена", s.answering);
    }
    return s;
  }
  if (s.blockDeadline !== null && s.now >= s.blockDeadline) {
    s.blockDeadline = null;
    if (s.phase === "reveal") advanceRevealBlock(s);
    else showNext(s);
  }
  if (s.deadline === null || s.now < s.deadline) return s;
  s.deadline = null;
  if (s.phase === "intro") advanceIntro(s, ctx);
  else if (s.phase === "preload") showNext(s);
  else if (s.phase === "board") {
    if (s.remaining.length) beginQuestion(s, ctx.rng.pick(s.remaining), ctx);
    else endRound(s, ctx);
  } else if (s.phase === "answer" || s.phase === "show") {
    if (settings(s).mode === "buzz" && s.answering !== null) {
      const seat = s.answering;
      s.submissions[seat] = {
        answers: settings(s).autoSubmit ? (s.drafts[seat] ?? {}) : {},
        submittedAt: s.now,
        value: cost(s),
        grade: null,
      };
      s.answering = null;
      if (
        settings(s).interception &&
        s.eligible.some((i) => !s.submissions[i])
      ) {
        s.deadline = null;
        s.buzzes = [];
        return s;
      }
    }
    closeQuestion(s, ctx);
  } else if (s.phase === "special") {
    const special = s.active?.question.special;
    if (special?.type === "transfer") {
      const target =
        s.transferTarget ??
        (special.allowSelf ? s.owner : cycle(alive(s), s.owner));
      s.eligible = [target];
      if (special.values.length) {
        s.active!.settings.value = special.values[0];
        for (const f of s.active!.fields) f.settings.value = special.values[0];
      }
      beginContent(s);
    } else if (special?.type === "auction") {
      if (special.auction === "open") {
        const seat = s.bidTurn ?? s.owner;
        if (s.highBidder === null) {
          s.bids[seat] = minimumBid(s);
          s.highBidder = seat;
        } else s.passed.push(seat);
        const bidders = s.eligible.filter((i) => !s.passed.includes(i));
        if (bidders.length <= 1 || bidders.every((i) => i === s.highBidder))
          settleAuction(s, ctx);
        else {
          s.bidTurn = cycle(bidders, seat);
          if (s.bidTurn === s.highBidder) s.bidTurn = cycle(bidders, s.bidTurn);
          setDeadline(s, settings(s).timers.wagerSeconds);
        }
      } else settleAuction(s, ctx);
    } else {
      for (const seat of s.eligible)
        if (s.bids[seat] === undefined)
          s.bids[seat] =
            special?.type === "wager"
              ? minimumBid(s)
              : s.finalStarted
                ? s.rules.final.minimumWager
                : 0;
      beginContent(s);
    }
  } else if (s.phase === "judging") {
    resolvePendingVotes(s);
    s.pending = [];
    finishScores(s, ctx);
  } else if (s.phase === "reveal" || s.phase === "round-reveal") {
    if (
      s.phase === "reveal" &&
      s.finalStarted &&
      s.finalRevealIndex < (s.history.at(-1)?.answers.length ?? 0)
    ) {
      s.finalRevealIndex++;
      setDeadline(s, Math.min(3, settings(s).timers.revealSeconds || 3));
    } else afterReveal(s, ctx);
  } else if (s.phase === "final-ban") {
    const available = s.finalRemaining;
    const removed = available[0];
    s.finalRemaining = available.filter(
      (id) => themeOf(s, id) !== themeOf(s, removed),
    );
    s.remaining = [...s.finalRemaining];
    s.banVotes = {};
    s.owner = cycle(s.finalOrder, s.owner);
    if (finalThemes(s).length <= s.rules.final.keepThemes)
      beginQuestion(s, s.remaining[0], ctx);
    else setDeadline(s, settings(s).timers.selectionSeconds);
  }
  return s;
}
function validateAnswers(s: QuizorState, answers: Answers): boolean {
  if (!s.active) return false;
  return Object.keys(answers).every((id) =>
    s.active!.fields.some((f) => f.field.id === id),
  );
}
function applyAction(
  state: QuizorState,
  seat: number,
  raw: QuizorAction,
  ctx: Ctx,
) {
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success)
    return actionError("invalid_action", "Неизвестное действие Quizor");
  const action = parsed.data;
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats)
    return actionError("seat", "Место не участвует в партии");
  if (
    action.type === "ready" &&
    ((action.phase !== undefined && action.phase !== state.phase) ||
      (action.questionId !== undefined &&
        action.questionId !== (state.active?.question.id ?? null)))
  )
    return copy(state);
  if (state.phase === "done")
    return actionError("finished", "Партия завершена");
  if (state.paused && action.type !== "appeal-vote")
    return actionError("paused", "Партия на паузе");
  const s = copy(state);
  s.now = ctx.now;
  const fail = (message = "Сейчас это действие недоступно") =>
    actionError("not_allowed", message);
  const cfg = settings(s);
  if (action.type === "appeal-vote") {
    if (
      !s.appeal ||
      seat === s.appeal.seat ||
      s.appeal.votes[seat] !== undefined
    )
      return fail();
    s.appeal.votes[seat] = action.accept;
    if (
      s.players.every(
        (_, i) => i === s.appeal!.seat || s.appeal!.votes[i] !== undefined,
      )
    )
      resolveAppeal(s);
    return s;
  }
  if (
    s.players[seat].out ||
    s.roundOut.includes(seat) ||
    !s.players[seat].online
  )
    return fail("Выбывший или отключённый игрок не может действовать");
  if (action.type === "appeal") {
    if (
      hasPresenter(s) ||
      !cfg.appeals ||
      s.appeal ||
      s.appealAttempts.includes(`${action.questionId}:${action.seat}`) ||
      (cfg.appealLimit > 0 && s.players[seat].appeals >= cfg.appealLimit)
    )
      return fail("Апелляция недоступна");
    const h = s.history.find(
      (h) => h.questionId === action.questionId && h.disclosed,
    );
    const answer = h?.answers.find((a) => a.seat === action.seat);
    if (!answer) return fail("Этот ответ ещё не раскрыт");
    s.appeal = {
      questionId: action.questionId,
      seat: action.seat,
      points: action.points,
      previous: answer.points,
      author: seat,
      comment: action.comment,
      votes: {},
      deadline: s.now + 30000,
    };
    s.appealAttempts.push(`${action.questionId}:${action.seat}`);
    s.players[seat].appeals++;
    event(s, "Подана апелляция", seat);
    if (s.seats === 1) resolveAppeal(s);
    return s;
  }
  if (action.type === "ready") {
    if (!["intro", "preload", "reveal", "round-reveal"].includes(s.phase))
      return fail();
    if (!s.ready.includes(seat)) s.ready.push(seat);
    if (connected(s, alive(s)).every((i) => s.ready.includes(i))) {
      if (s.phase === "intro") advanceIntro(s, ctx);
      else if (s.phase === "preload") showNext(s);
      else if (cfg.advance !== "presenter" || !hasPresenter(s)) {
        s.finalRevealIndex = s.history.at(-1)?.answers.length ?? 0;
        afterReveal(s, ctx);
      }
    }
    return s;
  }
  if (action.type === "select") {
    if (
      s.phase !== "board" ||
      seat !== s.chooser ||
      !s.remaining.includes(action.questionId)
    )
      return fail();
    s.owner = seat;
    beginQuestion(s, action.questionId, ctx);
    return s;
  }
  if (action.type === "next-block") {
    const total = s.active?.question.blocks.length ?? 0;
    if (
      (s.phase !== "show" && s.phase !== "answer") ||
      cfg.pacing !== "self" ||
      !s.eligible.includes(seat) ||
      (s.personalBlocks[seat] ?? s.blockIndex) >= total ||
      s.submissions[seat]
    )
      return fail();
    s.personalBlocks[seat] = (s.personalBlocks[seat] ?? s.blockIndex) + 1;
    s.personalBlockStartedAt[seat] = s.now;
    if (
      s.personalBlocks[seat] >= total ||
      cfg.answerOpen === "first" ||
      (cfg.answerOpen === "block" && s.personalBlocks[seat] >= cfg.openBlock)
    )
      openPersonal(s, seat);
    const indices = connected(s, s.eligible).map(
      (i) => s.personalBlocks[i] ?? s.blockIndex,
    );
    s.blockIndex = indices.length
      ? Math.min(...indices)
      : s.personalBlocks[seat];
    if (s.blockIndex >= total) s.phase = "answer";
    return s;
  }
  if (action.type === "hurry") {
    const remaining = connected(s, s.eligible).filter((i) => !s.submissions[i]);
    if (
      !s.submissions[seat] ||
      remaining.length < 1 ||
      remaining.length > 2 ||
      (cfg.pacing === "self"
        ? s.personalOpenedAt[seat] === undefined
        : s.answerOpenedAt === null)
    )
      return fail();
    const at = s.now + cfg.timers.hurrySeconds * 1000;
    if (cfg.pacing === "self")
      for (const target of remaining)
        s.personalDeadlines[target] = Math.min(
          s.personalDeadlines[target] ?? at,
          at,
        );
    else {
      s.deadline = s.deadline === null ? at : Math.min(at, s.deadline);
      s.questionDeadline = s.deadline;
    }
    event(s, "Запущен отсчёт для оставшихся", seat);
    return s;
  }
  if (action.type === "buzz") {
    if (
      cfg.mode !== "buzz" ||
      (s.phase !== "answer" && s.phase !== "show") ||
      !s.eligible.includes(seat) ||
      s.submissions[seat] ||
      s.answering !== null ||
      s.buzzes.some((b) => b.seat === seat)
    )
      return fail();
    if (s.answerOpenedAt === null) {
      s.locks[seat] = s.now + cfg.falseStartSeconds * 1000;
      return s;
    }
    if (
      (s.locks[seat] ?? 0) > s.now ||
      action.reactionMs > s.now - s.answerOpenedAt + 250
    )
      return fail("Невозможное время реакции");
    s.buzzes.push({ seat, reactionMs: action.reactionMs });
    s.buzzDeadline ??= s.now + cfg.buzzWindowMs;
    return s;
  }
  if (action.type === "answer" || action.type === "draft") {
    if (!canAnswer(s, seat) || !validateAnswers(s, action.answers))
      return fail();
    if (action.type === "draft") {
      s.drafts[seat] = action.answers;
      return s;
    }
    s.submissions[seat] = {
      answers: action.answers,
      submittedAt: s.now,
      value: cost(s, seat),
      grade: null,
    };
    delete s.personalDeadlines[seat];
    s.drafts[seat] = action.answers;
    if (cfg.mode === "buzz") {
      const q = structuredClone(s.active!);
      q.settings.value = cost(s);
      const grade = judgeQuestion(
        q,
        action.answers,
        Object.values(s.submissions).map((x) => x.answers),
      );
      const human = q.fields.some((f) => f.settings.judge !== "algorithm");
      if (
        grade.correct ||
        human ||
        !cfg.interception ||
        s.active?.question.special?.type === "transfer"
      ) {
        closeQuestion(s, ctx);
      } else {
        s.submissions[seat].grade = grade;
        s.attemptCounts[seat]++;
        s.attemptAnswers[seat] ??= [];
        s.attemptAnswers[seat].push(structuredClone(action.answers));
        if (s.attemptCounts[seat] < cfg.attempts) {
          s.retryPenalty[seat] +=
            grade.points === 0 ? -s.submissions[seat].value : grade.points;
          delete s.submissions[seat];
        }
        s.answering = null;
        s.buzzes = [];
        s.buzzDeadline = null;
        s.deadline = s.questionDeadline;
        if (s.eligible.every((i) => !!s.submissions[i])) closeQuestion(s, ctx);
      }
    } else if (allAnswered(s) && !cfg.editable) {
      const q = s.active!;
      const candidate = judgeQuestion(
        q,
        action.answers,
        Object.values(s.submissions).map((x) => x.answers),
      );
      const canIntercept =
        s.eligible.length === 1 &&
        cfg.interception &&
        !candidate.correct &&
        q.fields.every((f) => f.settings.judge === "algorithm") &&
        !q.question.special &&
        alive(s).some((i) => !s.eligible.includes(i));
      if (canIntercept) {
        s.eligible = alive(s);
        s.active!.settings.mode = cfg.interceptionMode;
        s.answering = null;
        s.buzzes = [];
        s.deadline = null;
        event(s, "Вопрос открыт для перехвата");
      } else closeQuestion(s, ctx);
    }
    return s;
  }
  if (action.type === "pass") {
    if (
      s.phase === "special" &&
      s.active?.question.special?.type === "auction"
    ) {
      if (
        (s.bidTurn !== null && s.bidTurn !== seat) ||
        s.passed.includes(seat) ||
        (s.highBidder === null && seat === s.owner)
      )
        return fail();
      s.passed.push(seat);
      const bidders = s.eligible.filter((i) => !s.passed.includes(i));
      if (bidders.length <= 1 || bidders.every((i) => i === s.highBidder))
        settleAuction(s, ctx);
      else {
        s.bidTurn = cycle(bidders, seat);
        if (s.bidTurn === s.highBidder) s.bidTurn = cycle(bidders, s.bidTurn);
        setDeadline(s, cfg.timers.wagerSeconds);
      }
      return s;
    }
    if (canAnswer(s, seat)) {
      s.submissions[seat] = {
        answers: {},
        submittedAt: s.now,
        value: cost(s),
        grade: null,
      };
      if (allAnswered(s) || cfg.mode !== "secret") closeQuestion(s, ctx);
      return s;
    }
    return fail();
  }
  if (action.type === "transfer") {
    const spec = s.active?.question.special;
    if (
      s.phase !== "special" ||
      spec?.type !== "transfer" ||
      seat !== s.owner ||
      s.transferTarget !== null ||
      !alive(s).includes(action.seat) ||
      (!spec.allowSelf && action.seat === seat)
    )
      return fail();
    s.transferTarget = action.seat;
    s.eligible = [action.seat];
    if (spec.values.length) {
      setDeadline(s, cfg.timers.wagerSeconds);
    } else beginContent(s);
    return s;
  }
  if (action.type === "bid") {
    if (s.phase !== "special" || !s.eligible.includes(seat)) return fail();
    const spec = s.active?.question.special;
    if (spec?.type === "transfer") {
      if (seat !== s.transferTarget || !spec.values.includes(action.amount))
        return fail();
      s.active!.settings.value = action.amount;
      for (const f of s.active!.fields) f.settings.value = action.amount;
      beginContent(s);
      return s;
    }
    if (spec?.type === "auction") {
      if (s.passed.includes(seat) || (s.bidTurn !== null && s.bidTurn !== seat))
        return fail();
      const min = minimumBid(s),
        max = maxBid(s, seat),
        high = s.highBidder === null ? 0 : s.bids[s.highBidder];
      if (
        action.amount < min ||
        action.amount > max ||
        (action.allIn && action.amount !== max) ||
        (spec.auction === "open" &&
          s.highBidder !== null &&
          (s.allIn
            ? !action.allIn || action.amount <= high
            : !action.allIn && action.amount <= high))
      )
        return fail("Нужно повысить ставку или пасовать");
      s.bids[seat] = action.amount;
      s.highBidder = seat;
      s.allIn = action.allIn ?? false;
      const bidders = s.eligible.filter((i) => !s.passed.includes(i));
      if (spec.auction === "sealed") {
        if (connected(s, bidders).every((i) => s.bids[i] !== undefined))
          settleAuction(s, ctx);
      } else if (bidders.length === 1) settleAuction(s, ctx);
      else {
        s.bidTurn = cycle(bidders, seat);
        setDeadline(s, cfg.timers.wagerSeconds);
      }
      return s;
    }
    const min =
      spec?.type === "wager"
        ? minimumBid(s)
        : s.finalStarted
          ? s.rules.final.minimumWager
          : 0;
    if (
      action.amount < min ||
      action.amount > maxBid(s, seat) ||
      s.bids[seat] !== undefined
    )
      return fail("Ставка вне допустимого диапазона");
    s.bids[seat] = action.amount;
    if (connected(s, s.eligible).every((i) => s.bids[i] !== undefined))
      beginContent(s);
    return s;
  }
  if (action.type === "ban") {
    if (
      s.phase !== "final-ban" ||
      !s.finalSeats.includes(seat) ||
      !s.finalRemaining.includes(action.questionId)
    )
      return fail();
    if (s.rules.final.banOrder === "secret") {
      if (s.banVotes[seat]) return fail();
      s.banVotes[seat] = action.questionId;
      if (!connected(s, s.finalSeats).every((i) => s.banVotes[i])) return s;
      const counts = new Map<string, number>();
      for (const id of Object.values(s.banVotes))
        counts.set(id, (counts.get(id) ?? 0) + 1);
      const max = Math.max(...counts.values());
      const tied = [...counts].filter(([, n]) => n === max).map(([id]) => id);
      action.questionId = ctx.rng.pick(tied);
    } else if (seat !== s.owner) return fail();
    s.finalRemaining = s.finalRemaining.filter(
      (id) => themeOf(s, id) !== themeOf(s, action.questionId),
    );
    s.remaining = [...s.finalRemaining];
    s.banVotes = {};
    s.owner = cycle(s.finalOrder, s.owner);
    if (finalThemes(s).length <= s.rules.final.keepThemes)
      beginQuestion(s, s.remaining[0], ctx);
    else setDeadline(s, cfg.timers.selectionSeconds);
    return s;
  }
  if (action.type === "self-grade") {
    if (
      s.phase !== "judging" ||
      !s.pending.some(
        (p) =>
          p.seat === seat &&
          p.judge === "self" &&
          (!action.fieldId || p.fieldId === action.fieldId),
      )
    )
      return fail();
    const pending = s.pending.filter(
      (p) =>
        p.seat === seat &&
        p.judge === "self" &&
        (!action.fieldId || p.fieldId === action.fieldId),
    );
    for (const p of pending)
      if (!replaceGrade(s, seat, action.grade, p.fieldId))
        return fail("Неизвестная оценка");
    if (!s.pending.length) finishScores(s, ctx);
    return s;
  }
  if (action.type === "vote") {
    if (s.phase !== "judging" || action.seat === seat) return fail();
    const best = s.pending.filter(
      (p) =>
        p.judge === "best" && (!action.fieldId || p.fieldId === action.fieldId),
    );
    if (best.length) {
      const fieldId = action.fieldId ?? best[0].fieldId;
      const key = `${fieldId}:${seat}`;
      if (
        s.bestVotes[key] !== undefined ||
        !best.some((p) => p.seat === action.seat)
      )
        return fail();
      s.bestVotes[key] = action.seat;
      if (
        connected(s, alive(s)).every(
          (i) => s.bestVotes[`${fieldId}:${i}`] !== undefined,
        )
      ) {
        for (const p of [...best].filter((p) => p.fieldId === fieldId)) {
          const count = Object.entries(s.bestVotes).filter(
            ([k, x]) => k.startsWith(`${fieldId}:`) && x === p.seat,
          ).length;
          const value =
            s.active?.fields.find((f) => f.field.id === fieldId)?.settings
              .value ?? cfg.value;
          replaceGrade(
            s,
            p.seat,
            count ? "correct" : "miss",
            p.fieldId,
            count * value,
          );
        }
        if (!s.pending.length) finishScores(s, ctx);
      }
      return s;
    }
    const target = s.pending.find(
      (p) =>
        p.seat === action.seat &&
        p.judge === "vote" &&
        (!action.fieldId || p.fieldId === action.fieldId),
    );
    if (!target) return fail();
    const key = `${target.seat}:${target.fieldId}`;
    s.votes[key] ??= {};
    if (s.votes[key][seat] !== undefined) return fail();
    s.votes[key][seat] = action.accept ?? true;
    const voters = connected(s, alive(s)).filter((i) => i !== action.seat);
    if (voters.every((i) => s.votes[key][i] !== undefined)) {
      const votes = Object.values(s.votes[key]);
      replaceGrade(
        s,
        target.seat,
        votes.filter(Boolean).length > votes.length / 2 ? "correct" : "miss",
        target.fieldId,
      );
      if (!s.pending.length) finishScores(s, ctx);
    }
    return s;
  }
  return fail();
}
function applyControl(
  state: QuizorState,
  raw: unknown,
  ctx: Ctx & { role: "host" | "presenter" | "system" },
) {
  const parsed = controlSchema.safeParse(raw);
  if (!parsed.success)
    return actionError("invalid_control", "Неизвестное управление Quizor");
  const action = parsed.data;
  const s = copy(state);
  s.now = ctx.now;
  const fail = () =>
    actionError("control_forbidden", "Это управление недоступно роли");
  if (action.type === "presence" || action.type === "presenter-presence") {
    if (ctx.role !== "system") return fail();
    if (action.type === "presence") {
      if (!s.players[action.seat]) return fail();
      s.players[action.seat].online = action.online;
      if (
        !s.paused &&
        (s.phase === "answer" || s.phase === "show") &&
        allAnswered(s)
      )
        closeQuestion(s, ctx);
    } else {
      s.presenterOnline = action.online;
      presenterFallback(s, ctx);
    }
    return s;
  }
  if (ctx.role === "system" || s.phase === "done") return fail();
  if (action.type === "pause") {
    if (!s.paused) {
      s.paused = true;
      s.pausedAt = s.now;
      s.resumeAt = null;
      event(s, `Пауза: ${ctx.role === "host" ? "хозяин" : "ведущий"}`);
    }
    return s;
  }
  if (action.type === "resume") {
    if (s.paused && s.resumeAt === null) {
      s.resumeAt = s.now + 3000;
      event(s, "Возобновление через 3 секунды");
    }
    return s;
  }
  if (s.paused) return actionError("paused", "Партия на паузе");
  if (ctx.role === "host" && action.type !== "close") return fail();
  if (action.type === "close") {
    if (!["answer", "show", "preload"].includes(s.phase)) return fail();
    closeQuestion(s, ctx);
    return s;
  }
  if (action.type === "next") {
    if (s.phase === "judging") {
      const pending = s.pending.filter(
        (p) =>
          p.judge === "presenter" &&
          s.active?.fields.find((f) => f.field.id === p.fieldId)?.settings
            .judge === "assisted",
      );
      if (!pending.length) return fail();
      s.pending = s.pending.filter((p) => !pending.includes(p));
      if (!s.pending.length) finishScores(s, ctx);
      return s;
    }
    if (s.phase === "reveal" || s.phase === "round-reveal") {
      if (
        s.finalStarted &&
        s.finalRevealIndex < (s.history.at(-1)?.answers.length ?? 0)
      )
        s.finalRevealIndex++;
      else afterReveal(s, ctx);
    } else if (s.phase === "intro") afterIntro(s, ctx);
    else if (s.phase === "preload" || s.phase === "show") showNext(s);
    else return fail();
    return s;
  }
  if (action.type === "next-block") {
    if (s.phase === "intro") {
      advanceIntro(s, ctx);
      return s;
    }
    if (s.phase === "reveal") {
      advanceRevealBlock(s);
      return s;
    }
    if (s.phase !== "show" && s.phase !== "preload") return fail();
    showNext(s);
    return s;
  }
  if (action.type === "open") {
    if (s.phase !== "answer" && s.phase !== "show") return fail();
    openAnswers(s);
    return s;
  }
  if (action.type === "grade") {
    if (
      !["judging", "reveal"].includes(s.phase) ||
      !replaceGrade(s, action.seat, action.grade, action.fieldId, action.points)
    )
      return fail();
    if (s.phase === "judging" && !s.pending.length) finishScores(s, ctx);
    else if (s.phase === "reveal") {
      const h = s.history.at(-1);
      const a = h?.answers.find((a) => a.seat === action.seat);
      if (a) {
        const replacement = publicAnswer(
          action.seat,
          s.submissions[action.seat],
        );
        s.players[action.seat].score += replacement.points - a.points;
        Object.assign(a, replacement);
      }
    }
    return s;
  }
  if (action.type === "adjust-score") {
    if (!s.players[action.seat]) return fail();
    s.players[action.seat].score += action.delta;
    event(
      s,
      `Правка счёта: ${action.delta >= 0 ? "+" : ""}${action.delta}${action.reason ? ` (${action.reason})` : ""}`,
      action.seat,
    );
    return s;
  }
  if (action.type === "extend-timer") {
    if (
      settings(s).pacing === "self" &&
      (s.phase === "answer" || s.phase === "show")
    ) {
      if (action.seconds === 0) s.personalDeadlines = {};
      else
        for (const target of s.eligible)
          if (
            !s.submissions[target] &&
            (s.personalOpenedAt[target] !== undefined ||
              s.personalDeadlines[target] !== undefined)
          )
            s.personalDeadlines[target] = Math.max(
              s.now,
              (s.personalDeadlines[target] ?? s.now) + action.seconds * 1000,
            );
      s.deadline = null;
      s.questionDeadline = null;
      return s;
    }
    s.deadline =
      action.seconds === 0
        ? null
        : Math.max(s.now, (s.deadline ?? s.now) + action.seconds * 1000);
    if (s.phase === "answer" || s.phase === "show")
      s.questionDeadline = s.deadline;
    return s;
  }
  if (action.type === "skip") {
    if (
      !s.active ||
      s.history.some((h) => h.questionId === s.active!.question.id)
    )
      return fail();
    s.submissions = {};
    s.drafts = {};
    closeQuestion(s, ctx);
    s.pending = [];
    if (s.phase === "judging") finishScores(s, ctx);
    event(s, "Вопрос пропущен");
    return s;
  }
  if (action.type === "award-all") {
    if (
      !s.active ||
      s.history.some((h) => h.questionId === s.active!.question.id)
    )
      return fail();
    if (s.phase !== "judging") closeQuestion(s, ctx);
    for (const seat of s.eligible) replaceGrade(s, seat, action.grade);
    s.pending = [];
    finishScores(s, ctx);
    return s;
  }
  if (action.type === "finish-round") {
    s.remaining = [];
    s.roundDeadline = null;
    if (
      s.active &&
      ["answer", "show", "preload", "judging", "special"].includes(s.phase)
    )
      closeQuestion(s, ctx);
    else endRound(s, ctx);
    return s;
  }
  if (action.type === "select") {
    if (s.phase !== "board" || !s.remaining.includes(action.questionId))
      return fail();
    beginQuestion(s, action.questionId, ctx);
    return s;
  }
  if (action.type === "assign") {
    if (!s.players[action.seat] || s.players[action.seat].out) return fail();
    s.owner = action.seat;
    s.chooser = action.seat;
    if (s.active?.settings.recipient === "presenter")
      s.eligible = [action.seat];
    return s;
  }
  return fail();
}
function publicField(field: Field): PublicField {
  const out: PublicField = {
    id: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
  };
  if (field.type === "text")
    Object.assign(out, {
      multiline: field.multiline,
      maxLength: field.maxLength,
    });
  if (field.type === "number")
    Object.assign(out, {
      min: field.min,
      max: field.max,
      precision: field.precision,
      step: field.step ?? 10 ** -field.precision,
      input: field.input,
      unit: field.unit,
    });
  if (field.type === "choice" || field.type === "multi")
    out.options = field.options.map(({ id, text, asset, media }) => ({
      id,
      text,
      ...(asset ? { asset } : {}),
      ...(media ? { media } : {}),
    }));
  if (field.type === "multi") out.maxSelected = field.maxSelected;
  if (field.type === "order") out.items = field.items.map((i) => ({ ...i }));
  if (field.type === "match") {
    out.left = field.left.map((i) => ({ ...i }));
    out.right = field.right.map((i) => ({ ...i }));
  }
  if (field.type === "list") out.maxItems = field.maxItems;
  if (field.type === "point") out.asset = field.asset;
  return out;
}
function legalHints(s: QuizorState, seat: number | null): string[] {
  if (seat === null || s.phase === "done") return [];
  const legal: string[] = [];
  if (s.appeal && seat !== s.appeal.seat && s.appeal.votes[seat] === undefined)
    legal.push("appeal-vote");
  if (
    s.paused ||
    s.players[seat]?.out ||
    s.roundOut.includes(seat) ||
    !s.players[seat]?.online
  )
    return legal;
  if (
    ["intro", "preload", "reveal", "round-reveal"].includes(s.phase) &&
    !s.ready.includes(seat)
  )
    legal.push("ready");
  if (s.phase === "board" && seat === s.chooser) legal.push("select");
  if (
    (s.phase === "show" || s.phase === "answer") &&
    settings(s).pacing === "self" &&
    s.eligible.includes(seat) &&
    !s.submissions[seat] &&
    (s.personalBlocks[seat] ?? s.blockIndex) <
      (s.active?.question.blocks.length ?? 0)
  )
    legal.push("next-block");
  if (canAnswer(s, seat)) legal.push("answer", "draft", "pass");
  if (
    (s.phase === "show" || s.phase === "answer") &&
    settings(s).mode === "buzz" &&
    s.eligible.includes(seat) &&
    !s.submissions[seat] &&
    s.answering === null &&
    !s.buzzes.some((b) => b.seat === seat)
  )
    legal.push("buzz");
  if (
    s.submissions[seat] &&
    ["show", "answer"].includes(s.phase) &&
    connected(s, s.eligible).filter((i) => !s.submissions[i]).length <= 2
  )
    legal.push("hurry");
  if (s.phase === "special") {
    const spec = s.active?.question.special;
    if (
      spec?.type === "transfer" &&
      s.transferTarget === null &&
      seat === s.owner
    )
      legal.push("transfer");
    else if (
      s.eligible.includes(seat) &&
      !s.passed.includes(seat) &&
      s.bids[seat] === undefined &&
      (s.bidTurn === null || s.bidTurn === seat)
    )
      legal.push("bid");
    else if (
      spec?.type === "auction" &&
      s.bidTurn === seat &&
      !s.passed.includes(seat)
    )
      legal.push("bid");
    if (
      spec?.type === "auction" &&
      s.highBidder !== null &&
      (s.bidTurn === null || s.bidTurn === seat) &&
      !s.passed.includes(seat)
    )
      legal.push("pass");
  }
  if (
    s.phase === "final-ban" &&
    s.finalSeats.includes(seat) &&
    (s.rules.final.banOrder === "secret" ? !s.banVotes[seat] : s.owner === seat)
  )
    legal.push("ban");
  if (s.phase === "judging") {
    if (s.pending.some((p) => p.seat === seat && p.judge === "self"))
      legal.push("self-grade");
    if (
      s.pending.some(
        (p) =>
          p.seat !== seat &&
          ((p.judge === "vote" &&
            s.votes[`${p.seat}:${p.fieldId}`]?.[seat] === undefined) ||
            (p.judge === "best" &&
              s.bestVotes[`${p.fieldId}:${seat}`] === undefined)),
      )
    )
      legal.push("vote");
  }
  if (
    !hasPresenter(s) &&
    settings(s).appeals &&
    !s.appeal &&
    s.history.some((h) => h.disclosed)
  )
    legal.push("appeal");
  return legal;
}
function view(s: QuizorState, seat: number | null): QuizorView {
  const cfg = settings(s);
  const personal =
    seat !== null &&
    cfg.pacing === "self" &&
    (s.phase === "show" || s.phase === "answer");
  const blockIndex = personal
    ? (s.personalBlocks[seat] ?? s.blockIndex)
    : s.blockIndex;
  const answerOpen = personal
    ? s.personalOpenedAt[seat] !== undefined
    : s.answerOpenedAt !== null;
  const history = s.history
    .filter((h) => h.disclosed)
    .map((h) => ({
      ...structuredClone(h),
      answers: cfg.showAnswers
        ? h.answers
        : seat === null
          ? []
          : h.answers.filter((a) => a.seat === seat),
    }));
  const current = s.history.find(
    (h) => h.questionId === s.active?.question.id && h.disclosed,
  );
  let shown = current?.answers ?? [];
  if (s.finalStarted && s.phase === "reveal")
    shown = [...shown]
      .sort(
        (a, b) => s.finalOrder.indexOf(a.seat) - s.finalOrder.indexOf(b.seat),
      )
      .slice(0, s.finalRevealIndex);
  if (!cfg.showAnswers) shown = shown.filter((a) => a.seat === seat);
  const revealing =
    (s.phase === "reveal" && current !== undefined) || s.phase === "done";
  const open =
    s.phase === "show" ||
    s.phase === "answer" ||
    s.phase === "judging" ||
    revealing;
  let blocks: Block[] = [];
  if (s.phase === "intro")
    blocks = s.rules.rounds[s.round]?.intro.slice(0, s.blockIndex + 1) ?? [];
  else if (open && s.active)
    blocks = s.active.question.blocks.slice(0, Math.max(0, blockIndex + 1));
  const fields =
    open && s.active && answerOpen
      ? s.active.fields.map(({ field }) => orderedField(s, field, seat))
      : [];
  const players = s.players.map((p, i): PublicPlayer => {
    let score: number | null = p.score;
    const undisclosed = s.history
      .filter((h) => !h.disclosed)
      .reduce(
        (sum, h) => sum + (h.answers.find((a) => a.seat === i)?.points ?? 0),
        0,
      );
    score -= undisclosed;
    if (
      s.finalStarted &&
      s.phase === "reveal" &&
      current &&
      !shown.some((a) => a.seat === i)
    )
      score -= current.answers.find((a) => a.seat === i)?.points ?? 0;
    if (
      s.phase !== "done" &&
      ((cfg.scoreVisibility === "own" && i !== seat) ||
        (cfg.scoreVisibility === "final" && !s.finalStarted) ||
        (cfg.scoreVisibility === "round" && s.phase !== "round-reveal"))
    )
      score = null;
    const status: PublicPlayer["status"] =
      p.out || s.roundOut.includes(i)
        ? "out"
        : !p.online
          ? "offline"
          : s.ready.includes(i)
            ? "ready"
            : s.answering === i
              ? "buzzed"
              : s.phase === "board" && s.chooser === i
                ? "choosing"
                : s.phase === "special" && s.eligible.includes(i)
                  ? "bidding"
                  : s.submissions[i]
                    ? "answered"
                    : "thinking";
    return {
      seat: i,
      score,
      out: p.out || s.roundOut.includes(i),
      online: p.online,
      status,
      delta: shown.find((a) => a.seat === i)?.points ?? null,
    };
  });
  const spec = s.active?.question.special;
  const special =
    s.phase === "special" && spec
      ? {
          type: spec.type,
          topic: spec.topic,
          values: spec.values,
          minimum: minimumBid(s),
          auction: spec.auction,
          allowSelf: spec.allowSelf,
        }
      : s.phase === "special" && s.finalStarted
        ? {
            type: "wager-all",
            topic: "Финальная ставка",
            values: [],
            minimum: minimumBid(s),
            auction: "sealed" as const,
            allowSelf: true,
          }
        : null;
  const answerMap =
    seat === null
      ? null
      : (s.drafts[seat] ?? s.submissions[seat]?.answers ?? null);
  const publicHistory = history
    .map((h) => {
      if (h.questionId === current?.questionId && s.phase === "reveal")
        h.reveal = h.reveal.slice(0, s.revealIndex + 1);
      return h;
    })
    .map((h) =>
      s.finalStarted &&
      s.phase === "reveal" &&
      h.questionId === current?.questionId
        ? { ...h, answers: shown }
        : h,
    );
  const judging =
    s.phase === "judging"
      ? s.pending.map((p) => ({
          ...p,
          grades: s.active?.fields
            .find((f) => f.field.id === p.fieldId)
            ?.settings.grades.map((g) => ({ id: g.id, label: g.label })),
        }))
      : [];
  let answerViews = shown;
  if (s.phase === "judging")
    answerViews = Object.entries(s.submissions)
      .filter(
        ([target]) =>
          seat === Number(target) ||
          s.pending.some(
            (p) =>
              p.seat === Number(target) &&
              (p.judge === "vote" || p.judge === "best"),
          ),
      )
      .map(([i, sub]) => ({
        seat: Number(i),
        answers: structuredClone(sub.answers),
        grade: "",
        label: "Ожидает проверки",
        points: 0,
        correct: false,
        explanation: "",
        fields: [],
      }));
  const out: QuizorView = {
    phase: s.phase,
    round: s.round + 1,
    roundId: s.roundId,
    title: s.title,
    questionId: s.active?.question.id ?? null,
    questionNumber: s.played.length,
    questionCount: s.queue.length,
    prompt:
      open &&
      s.active &&
      (s.phase !== "show" || blockIndex >= s.active.question.blocks.length)
        ? s.active.question.prompt
        : "",
    blocks: structuredClone(blocks),
    blockIndex,
    blockStartedAt: personal
      ? (s.personalBlockStartedAt[seat] ?? s.blockStartedAt)
      : s.blockStartedAt,
    fields,
    players,
    seat,
    canAnswer: seat !== null && canAnswer(s, seat),
    eligible: [...s.eligible],
    owner: s.owner,
    chooser: s.phase === "final-ban" ? s.owner : s.chooser,
    answering: s.answering,
    ownAnswer: structuredClone(answerMap),
    submitted: Object.keys(s.submissions).map(Number),
    answers: answerViews,
    reference: revealing && current ? current.reference : "",
    reveal:
      revealing && current
        ? structuredClone(current.reveal.slice(0, s.revealIndex + 1))
        : [],
    board: boardCells(s),
    themes:
      s.phase === "final-ban"
        ? finalThemes(s).map((id) => ({
            questionId: id,
            theme:
              allQuestions(s.rules).find((q) => q.id === id)?.theme ?? "Тема",
          }))
        : [],
    special,
    bids:
      spec?.type === "auction" && spec.auction === "open"
        ? { ...s.bids }
        : revealing
          ? { ...s.bids }
          : {},
    ownBid: seat === null ? null : (s.bids[seat] ?? null),
    bidTurn: s.bidTurn,
    deadline: personal
      ? (s.personalDeadlines[seat] ?? null)
      : seat === null &&
          cfg.pacing === "self" &&
          (s.phase === "answer" || s.phase === "show")
        ? Object.values(s.personalDeadlines).length
          ? Math.min(...Object.values(s.personalDeadlines))
          : null
        : s.deadline,
    roundDeadline: s.roundDeadline,
    serverNow: s.now,
    paused: s.paused,
    resumeAt: s.resumeAt,
    presenterOnline: s.presenterOnline,
    appeal: s.appeal ? structuredClone(s.appeal) : null,
    legal: legalHints(s, seat),
    controls:
      s.phase === "done"
        ? []
        : s.paused
          ? ["resume"]
          : [
              "pause",
              ...(["answer", "show", "preload"].includes(s.phase)
                ? ["close"]
                : []),
            ],
    events: structuredClone(s.events),
    history: publicHistory,
    result: s.result,
    grades: cfg.grades.map((g) => ({ id: g.id, label: g.label })),
    judging,
    ready: [...s.ready],
  };
  if (
    s.phase === "judging" &&
    seat !== null &&
    s.pending.some((p) => p.seat === seat && p.judge === "self") &&
    s.active
  )
    out.selfReference = reference(s.active);
  out.revealStartedAt = s.revealStartedAt;
  out.revealBlockStartedAt = s.revealBlockStartedAt;
  out.revealIndex = s.revealIndex;
  out.roundVisual = s.finalStarted
    ? undefined
    : s.rules.rounds[s.round]?.visual;
  out.answerOpenedAt = personal
    ? (s.personalOpenedAt[seat] ?? null)
    : s.answerOpenedAt;
  out.preload =
    s.phase === "preload" && s.active
      ? mediaRefs(s.active.question.blocks)
      : [];
  if (s.paused) {
    out.preload = [];
    out.prompt = "";
    out.blocks = [];
    out.fields = [];
    out.answers = [];
    out.reference = "";
    out.reveal = [];
    out.history = [];
    out.canAnswer = false;
    delete out.selfReference;
  }
  return out;
}
function presenterView(s: QuizorState): QuizorView {
  const out = view(s, null);
  out.presenterNotes =
    s.active?.fields.flatMap((f) => (f.field.notes ? [f.field.notes] : [])) ??
    [];
  if (s.active) {
    out.prompt = s.active.question.prompt;
    out.fields = s.active.fields.map((f) => publicField(f.field));
    out.reference = reference(s.active);
    out.answers = Object.entries(s.submissions).map(([i, sub]) =>
      sub.grade
        ? publicAnswer(Number(i), sub)
        : {
            seat: Number(i),
            answers: sub.answers,
            grade: "",
            label: "Черновик",
            points: 0,
            correct: false,
            explanation: "",
            fields: [],
          },
    );
    for (const [i, answer] of Object.entries(s.drafts))
      if (!s.submissions[i])
        out.answers.push({
          seat: Number(i),
          answers: answer,
          grade: "",
          label: "Черновик",
          points: 0,
          correct: false,
          explanation: "",
          fields: [],
        });
  }
  out.controls =
    s.phase === "done"
      ? []
      : s.paused
        ? ["resume"]
        : [
            "pause",
            "close",
            "next",
            "next-block",
            "open",
            "grade",
            "adjust-score",
            "extend-timer",
            "skip",
            "award-all",
            "finish-round",
            "select",
            "assign",
          ];
  return out;
}
function exampleAnswer(field: Field): AnswerValue {
  if (field.type === "text") return field.answers[0]?.text ?? "Ответ";
  if (field.type === "number")
    return typeof field.target === "number" ? field.target : field.target.min;
  if (field.type === "choice")
    return (
      field.options.find((o) => o.grade === "correct")?.id ??
      field.options[0].id
    );
  if (field.type === "multi")
    return field.options.filter((o) => o.correct).map((o) => o.id);
  if (field.type === "order") return [...field.correct];
  if (field.type === "match") return { ...field.correct };
  if (field.type === "list")
    return field.items.slice(0, field.maxItems).map((i) => i.answers[0].text);
  if (field.type === "point") return { ...field.target };
  return true;
}
function legalActions(s: QuizorState, seat: number, _ctx: Ctx): QuizorAction[] {
  const hints = legalHints(s, seat);
  const actions: QuizorAction[] = [];
  if (hints.includes("appeal-vote"))
    return [{ type: "appeal-vote", accept: true }];
  if (hints.includes("ready")) actions.push({ type: "ready" });
  if (hints.includes("select"))
    actions.push(
      ...s.remaining.map((questionId) => ({
        type: "select" as const,
        questionId,
      })),
    );
  if (hints.includes("next-block")) actions.push({ type: "next-block" });
  if (hints.includes("answer") && s.active)
    actions.push({
      type: "answer",
      answers: Object.fromEntries(
        s.active.fields.map((f) => [f.field.id, exampleAnswer(f.field)]),
      ),
    });
  if (
    hints.includes("buzz") &&
    s.answerOpenedAt !== null &&
    (s.locks[seat] ?? 0) <= s.now
  )
    actions.push({
      type: "buzz",
      reactionMs: Math.max(0, s.now - (s.answerOpenedAt ?? s.now)),
    });
  if (hints.includes("transfer"))
    actions.push(
      ...alive(s)
        .filter((i) => s.active?.question.special?.allowSelf || i !== seat)
        .map((target) => ({ type: "transfer" as const, seat: target })),
    );
  if (hints.includes("bid")) {
    if (s.active?.question.special?.type === "transfer")
      actions.push({
        type: "bid",
        amount: s.active.question.special.values[0],
      });
    else {
      const amount =
        s.active?.question.special?.type === "auction" &&
        s.active.question.special.auction === "open"
          ? Math.max(
              minimumBid(s),
              (s.highBidder === null ? -1 : s.bids[s.highBidder]) + 1,
            )
          : s.active?.question.special?.type === "wager" ||
              s.active?.question.special?.type === "auction"
            ? minimumBid(s)
            : 0;
      if (amount <= maxBid(s, seat)) actions.push({ type: "bid", amount });
    }
  }
  if (hints.includes("pass") && s.phase === "special")
    actions.push({ type: "pass" });
  if (hints.includes("ban"))
    actions.push(
      ...s.finalRemaining.map((questionId) => ({
        type: "ban" as const,
        questionId,
      })),
    );
  if (hints.includes("self-grade")) {
    const p = s.pending.find((p) => p.seat === seat && p.judge === "self")!;
    actions.push({ type: "self-grade", fieldId: p.fieldId, grade: "correct" });
  }
  if (hints.includes("vote")) {
    const p = s.pending.find(
      (p) =>
        p.seat !== seat &&
        ((p.judge === "best" &&
          s.bestVotes[`${p.fieldId}:${seat}`] === undefined) ||
          (p.judge === "vote" &&
            s.votes[`${p.seat}:${p.fieldId}`]?.[seat] === undefined)),
    );
    if (p)
      actions.push({
        type: "vote",
        seat: p.seat,
        fieldId: p.fieldId,
        accept: true,
      });
  }
  return actions;
}
export const quizor = defineGame<
  QuizorRules,
  QuizorVisual,
  QuizorState,
  QuizorAction,
  QuizorView
>({
  id: "quizor",
  version: 1,
  title: "Quizor",
  summary: "Гибкий квиз: тайные ответы, табло, медиа, ставки и финалы",
  kind: "turn",
  rulesSchema,
  visualSchema,
  actionSchema,
  seats: (rules) => rules.players,
  checkRules,
  checkVisual,
  setup,
  currentSeats: (s) =>
    alive(s).filter(
      (i) =>
        legalActions(s, i, {
          rules: s.rules,
          seats: s.seats,
          rng: null as never,
          now: s.now,
        }).length > 0,
    ),
  turnId: (s) =>
    `${s.phase}:${s.active?.question.id ?? s.roundId}:${s.blockIndex}:${s.answering ?? ""}`,
  turnBudgetSeconds: () => 0,
  timeoutPolicy: "skip",
  legalActions,
  applyAction,
  applyControl,
  presenterView,
  nextWakeAt,
  wake,
  roundResult: (s) => s.result,
  view,
  presentRules: (rules) =>
    ({
      players: rules.players,
      presenter: rules.presenter,
      defaults: {},
      rounds: rules.rounds.map((r) => ({
        id: r.id,
        title: r.title,
        format: r.format,
        questions: [],
        questionCount: r.take ?? r.questions.length,
        themes: r.themes,
        values: r.values,
      })),
      final: { type: rules.final.type },
      tiebreak: [],
    }) as unknown as QuizorRules,
  simulationBudget: () => ({ maxTotalActions: 100000, maxDurationMs: 3600000 }),
  guide: QUIZOR_GUIDE,
  presets: PRESETS,
  slots: [
    {
      path: "visual.background",
      title: "Фон сцены",
      accepts: ["asset"],
      advice: "Широкое изображение, 16:9",
    },
    {
      path: "rules.rounds[].questions[].blocks[].asset",
      title: "Медиа вопроса",
      accepts: ["asset"],
      advice: "Картинка, звук или видео из своего пула",
    },
  ],
  themes: THEMES,
  visualCatalog: VISUAL_CATALOG,
});
