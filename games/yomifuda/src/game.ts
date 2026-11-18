import { actionError, defineGame, seriesSchema, type GameContext, type RoundResult } from "@asobiba/sdk";
import { z } from "zod";
import { YOMIFUDA_GUIDE } from "./guide";
import { YOMIFUDA_INFO, YOMIFUDA_PROMPT_EXAMPLES, YOMIFUDA_TUNING, summarizeYomifudaConfig } from "./information";
import { PRESETS } from "./presets";
import { rulesSchema, visualSchema, type YomifudaAttribute, type YomifudaCard, type YomifudaRules, type YomifudaVisual } from "./rules";

export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("play"), round: z.int().positive(), cardId: z.string().min(1).max(80) }),
  z.strictObject({ type: z.literal("ready"), round: z.int().positive() }),
]);
export type YomifudaAction = z.output<typeof actionSchema>;
/** Whitelist identity. Never attach values or strength hints here. */
export interface PublicCard {
  id: string;
  name: string;
  anime: string;
  version?: string;
  image?: { asset: string };
  shikimoriId?: number;
}
export type YomifudaTableCard = { seat: number; hidden: true } | {
  seat: number;
  hidden: false;
  card: PublicCard;
  value: number;
  points: number;
  winner: boolean;
  /** Only present for cards tied for the highest active value. */
  tieTotal?: number;
};
export interface YomifudaView {
  phase: "choose" | "reveal" | "review" | "finished";
  round: number;
  totalRounds: number;
  seat: number | null;
  attribute: YomifudaAttribute;
  hand: PublicCard[];
  players: { seat: number; score: number; handCount: number; played: boolean; ready: boolean }[];
  table: YomifudaTableCard[];
  stockCount: number;
  choiceStartedAt: number;
  choiceEndsAt: number | null;
  revealStartedAt: number | null;
  revealEndsAt: number | null;
  canPlay: boolean;
  canReady: boolean;
  result: RoundResult | null;
  /** The final explicit review may show all values. Absent until finished. */
  finalDeck?: YomifudaCard[];
}
interface Outcome { seat: number; value: number; points: number; winner: boolean; tieTotal?: number }
export interface YomifudaState {
  phase: YomifudaView["phase"];
  round: number;
  rules: YomifudaRules;
  cards: YomifudaCard[];
  drawPile: string[];
  hands: string[][];
  chosen: (string | null)[];
  ready: boolean[];
  scores: number[];
  attributeId: string;
  attributeBag: string[];
  outcome: Outcome[];
  choiceStartedAt: number;
  revealStartedAt: number | null;
  revealEndsAt: number | null;
  result: RoundResult | null;
}
type Ctx = GameContext<YomifudaRules>;
function validSeat(s: YomifudaState, seat: number | null): seat is number {
  return seat !== null && Number.isInteger(seat) && seat >= 0 && seat < s.hands.length;
}
function publicCard(card: YomifudaCard): PublicCard {
  return { id: card.id, name: card.name, anime: card.anime,
    ...(card.version !== undefined ? { version: card.version } : {}),
    ...(card.image ? { image: { asset: card.image.asset } } : {}),
    ...(card.shikimoriId !== undefined ? { shikimoriId: card.shikimoriId } : {}) };
}
function nextAttribute(s: YomifudaState, ctx: Ctx): Pick<YomifudaState, "attributeId" | "attributeBag"> {
  const ids = s.rules.attributes.map((a) => a.id);
  if (s.rules.attributeMode === "bag") {
    const bag = s.attributeBag.length ? [...s.attributeBag] : ctx.rng.shuffle(ids);
    return { attributeId: bag[0], attributeBag: bag.slice(1) };
  }
  const allowed = s.rules.attributeMode === "no-repeat" && ids.length > 1 ? ids.filter((id) => id !== s.attributeId) : ids;
  return { attributeId: ctx.rng.pick(allowed), attributeBag: [] };
}
function resolveBattle(s: YomifudaState): Outcome[] {
  const chosen = s.chosen.map((id) => s.cards.find((c) => c.id === id)!);
  const values = chosen.map((card) => card.values[s.attributeId]);
  const maximum = Math.max(...values);
  const leaders = values.flatMap((value, seat) => value === maximum ? [seat] : []);
  const totals = chosen.map((card) => Object.values(card.values).reduce((sum, value) => sum + value, 0));
  const maxTotal = Math.max(...leaders.map((seat) => totals[seat]));
  const winners = leaders.length === 1 ? leaders : leaders.filter((seat) => totals[seat] === maxTotal);
  return values.map((value, seat) => ({ seat, value, winner: winners.includes(seat),
    points: winners.includes(seat) ? (winners.length === 1 ? s.rules.winPoints : s.rules.tiePoints) : 0,
    ...(leaders.length > 1 && leaders.includes(seat) ? { tieTotal: totals[seat] } : {}) }));
}
function finish(s: YomifudaState): RoundResult {
  const maximum = Math.max(...s.scores);
  const winners = s.scores.flatMap((score, seat) => score === maximum ? [seat] : []);
  return { winners, losers: s.scores.flatMap((_, seat) => winners.includes(seat) ? [] : [seat]), draw: winners.length > 1,
    reason: "deck-finished", summary: winners.length > 1 ? "поровну очков после всей колоды" : "больше всех очков после всей колоды" };
}
function canPlay(s: YomifudaState, seat: number): boolean {
  return validSeat(s, seat) && s.phase === "choose" && s.chosen[seat] === null && s.hands[seat].length > 0;
}
function canReady(s: YomifudaState, seat: number): boolean {
  return validSeat(s, seat) && s.phase === "review" && !s.ready[seat];
}
function applyAction(s: YomifudaState, seat: number, action: YomifudaAction, ctx: Ctx) {
  if (!validSeat(s, seat)) return actionError("bad_seat", "Нет такого игрового места");
  if (action.round !== s.round) return actionError("stale_round", "Этот бой уже сменился");
  if (action.type === "play") {
    if (!canPlay(s, seat)) return actionError("cannot_play", "Сейчас нельзя поставить карту");
    if (!s.hands[seat].includes(action.cardId)) return actionError("not_your_card", "Карты нет в вашей руке");
    const hands = s.hands.map((hand, i) => i === seat ? hand.filter((id) => id !== action.cardId) : [...hand]);
    const chosen = [...s.chosen]; chosen[seat] = action.cardId;
    const next: YomifudaState = { ...s, hands, chosen };
    if (chosen.every((id) => id !== null)) {
      next.outcome = resolveBattle(next);
      next.scores = next.scores.map((score, i) => score + next.outcome[i].points);
      next.phase = "reveal";
      next.revealStartedAt = ctx.now;
      next.revealEndsAt = ctx.now + s.rules.revealSeconds * 1000;
    }
    return next;
  }
  if (!canReady(s, seat) || s.revealEndsAt === null || ctx.now < s.revealEndsAt) return actionError("cannot_ready", "Дождитесь завершения раскрытия");
  const ready = [...s.ready]; ready[seat] = true;
  if (!ready.every(Boolean)) return { ...s, ready };
  if (s.drawPile.length === 0 && s.hands.every((hand) => hand.length === 0)) {
    const next = { ...s, ready, phase: "finished" as const };
    return { ...next, result: finish(next) };
  }
  const drawPile = [...s.drawPile];
  const hands = s.hands.map((hand) => [...hand]);
  if (drawPile.length > 0) for (const hand of hands) hand.push(drawPile.shift()!);
  return { ...s, ...nextAttribute(s, ctx), phase: "choose" as const, round: s.round + 1, drawPile, hands,
    chosen: s.chosen.map(() => null), ready: ready.map(() => false), outcome: [],
    choiceStartedAt: ctx.now, revealStartedAt: null, revealEndsAt: null };
}
function view(s: YomifudaState, seat: number | null): YomifudaView {
  const own = validSeat(s, seat) ? seat : null;
  const open = s.phase !== "choose";
  const table = s.chosen.flatMap((id, seat): YomifudaTableCard[] => {
    if (id === null) return [];
    if (!open) return [{ seat, hidden: true }];
    const result = s.outcome.find((o) => o.seat === seat)!;
    return [{ seat, hidden: false, card: publicCard(s.cards.find((c) => c.id === id)!), value: result.value,
      points: result.points, winner: result.winner, ...(result.tieTotal !== undefined ? { tieTotal: result.tieTotal } : {}) }];
  });
  return {
    phase: s.phase, round: s.round, totalRounds: s.cards.length / s.hands.length, seat: own,
    attribute: { ...s.rules.attributes.find((a) => a.id === s.attributeId)! },
    hand: own === null ? [] : s.hands[own].map((id) => publicCard(s.cards.find((c) => c.id === id)!)),
    players: s.hands.map((hand, seat) => ({ seat, score: s.scores[seat], handCount: hand.length, played: s.chosen[seat] !== null, ready: s.ready[seat] })),
    table, stockCount: s.drawPile.length, choiceStartedAt: s.choiceStartedAt,
    choiceEndsAt: s.rules.choiceSeconds > 0 ? s.choiceStartedAt + s.rules.choiceSeconds * 1000 : null,
    revealStartedAt: s.revealStartedAt, revealEndsAt: s.revealEndsAt,
    canPlay: own !== null && canPlay(s, own), canReady: own !== null && canReady(s, own),
    result: s.result ? structuredClone(s.result) : null,
    ...(s.phase === "finished" ? { finalDeck: structuredClone(s.cards) } : {}),
  };
}

export const yomifuda = defineGame<YomifudaRules, YomifudaVisual, YomifudaState, YomifudaAction, YomifudaView>({
  id: "yomifuda", version: 1, title: "Ёмифуда", summary: "Тайные карты аниме-персонажей: выберите по сюжету и сравните скрытый показатель", kind: "turn",
  seriesSchema: seriesSchema.unwrap().extend({
    rounds: z.literal(1, { error: "В Ёмифуде одна колода на матч: series.rounds должно быть 1" }).default(1)
      .meta({ description: "Только одна колода на матч: после финала раскрываются все оценки" }),
  }).prefault({}),
  rulesSchema, visualSchema, actionSchema, info: YOMIFUDA_INFO, tuning: YOMIFUDA_TUNING,
  promptExamples: YOMIFUDA_PROMPT_EXAMPLES, examplePresetId: "educational",
  summarizeConfig: summarizeYomifudaConfig,
  seats: (rules) => ({ min: rules.players, max: rules.players }),
  setup: (ctx) => {
    const rules = structuredClone(ctx.rules);
    const drawPile = ctx.rng.shuffle(rules.cards.map((card) => card.id));
    const hands = Array.from({ length: ctx.seats }, () => [] as string[]);
    for (let i = 0; i < rules.handSize; i++) for (const hand of hands) hand.push(drawPile.shift()!);
    const state: YomifudaState = { rules, cards: rules.cards, phase: "choose", round: 1, hands, drawPile,
      chosen: hands.map(() => null), ready: hands.map(() => false), scores: hands.map(() => 0),
      attributeId: "", attributeBag: [], outcome: [], choiceStartedAt: ctx.now, revealStartedAt: null, revealEndsAt: null, result: null };
    return { ...state, ...nextAttribute(state, ctx) };
  },
  currentSeats: (s) => s.hands.flatMap((_, seat) => canPlay(s, seat) || canReady(s, seat) ? [seat] : []),
  turnId: (s) => `${s.round}:${s.phase}`,
  turnBudgetSeconds: () => 0,
  timeoutPolicy: "skip",
  legalActions: (s, seat) => canPlay(s, seat) ? s.hands[seat].map((cardId) => ({ type: "play", round: s.round, cardId })) : canReady(s, seat) ? [{ type: "ready", round: s.round }] : [],
  applyAction,
  nextWakeAt: (s) => s.phase === "reveal" ? s.revealEndsAt : null,
  wake: (s, ctx) => s.phase === "reveal" && s.revealEndsAt !== null && ctx.now >= s.revealEndsAt ? { ...s, phase: "review" } : s,
  // The game view uses draw for shared victory. SDK rounds use draw for no award:
  // all explicit deck winners must receive a series win, even at full parity.
  // Match then derives its final shared-victory flag from the awarded winners.
  roundResult: (s) => s.result ? { ...s.result, draw: false } : null,
  view,
  presentRules: (r) => ({ players: r.players, handSize: r.handSize, deckSize: r.deckSize,
    attributes: r.attributes.map((a) => ({ ...a })), cards: [], scale: { ...r.scale },
    revealSeconds: r.revealSeconds, choiceSeconds: r.choiceSeconds, winPoints: r.winPoints, tiePoints: r.tiePoints,
    attributeMode: r.attributeMode, pool: { profiles: [...r.pool.profiles], minViewers: r.pool.minViewers } }),
  guide: YOMIFUDA_GUIDE, presets: PRESETS,
  slots: [{ path: "rules.cards[].image", title: "Портрет персонажа", accepts: ["asset"], advice: "Необязательный портрет из своего пула; без картинки будет нейтральная замена" }],
  themes: [ { id: "night", title: "Ночь", description: "Тёмная арена" }, { id: "paper", title: "Бумага", description: "Светлая арена" }, { id: "sakura", title: "Сакура", description: "Розовая арена" } ],
  visualCatalog: {},
});
