import { describe, expect, it } from "vitest";
import { createRng, isActionError, createCatalog, validateConfig, presetDocument, describeGame, documentSchema, Match } from "@asobiba/sdk";
import { yomifuda, rulesSchema, visualSchema, demoRules, type YomifudaRules, type YomifudaAction } from "./index";

function fixture(extra: Record<string, unknown> = {}): YomifudaRules {
  return rulesSchema.parse({ players: 3, handSize: 2, attributes: [{ id: "power", label: "Сила" }, { id: "music", label: "Музыка" }],
    cards: Array.from({ length: 12 }, (_, i) => ({ id: `card${i}`, name: `Персонаж ${i}`, anime: "Учебное аниме", image: { asset: `ast_portrait${String(i).padStart(8, "0")}` }, values: { power: i * 7, music: 100 - i * 3 } })), ...extra });
}
function harness(rules = fixture(), seed = 42) {
  const rng = createRng(seed);
  let now = 1000;
  let state = yomifuda.setup({ rules, seats: rules.players, rng, now, round: 0, firstSeat: 0 });
  const ctx = () => ({ rules, seats: rules.players, rng, now });
  const tryAct = (seat: number, action: YomifudaAction) => yomifuda.applyAction(state, seat, action, ctx());
  const act = (seat: number, action: YomifudaAction) => {
    const result = tryAct(seat, action);
    if (isActionError(result)) throw new Error(result.error.code);
    state = result;
  };
  const playAll = () => { for (let seat = 0; seat < rules.players; seat++) act(seat, { type: "play", round: state.round, cardId: yomifuda.view(state, seat).hand[0].id }); };
  const wake = (at: number) => { now = at; state = yomifuda.wake!(state, ctx()); };
  const readyAll = () => { for (let seat = 0; seat < rules.players; seat++) act(seat, { type: "ready", round: state.round }); };
  return { get state() { return state; }, ctx, tryAct, act, playAll, wake, readyAll };
}

describe("Yomifuda rules", () => {
  it("defaults a derived deck size, scale, reveal timer and no-repeat mode", () => {
    const r = fixture();
    expect([r.deckSize, r.scale.min, r.scale.max, r.revealSeconds, r.choiceSeconds, r.attributeMode, r.winPoints, r.tiePoints]).toEqual([12, 0, 100, 10, 0, "no-repeat", 1, 0.5]);
    expect(r.pool).toEqual({ profiles: ["andrey03410", "dimma0148", "kostyankomaranime"], minViewers: 2 });
  });
  it("accepts seven attributes and both scale endpoints", () => {
    const attributes = Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, label: `Показатель${i}` }));
    const r = fixture({ attributes, scale: { min: -10, max: 200 }, cards: [0, 1, 2].map((i) => ({ id: `c${i}`, name: `N${i}`, anime: "A", values: Object.fromEntries(attributes.map((a, j) => [a.id, j % 2 ? -10 : 200])) })) , handSize: 1 });
    expect(r.attributes).toHaveLength(7);
  });
  it.each([
    [2, 4503599627370495],
    [3, 3002399751580330],
    [32, 281474976710655],
  ])("bounds both scale endpoints to preserve exact sums of %i attributes", (count, limit) => {
    const attributes = Array.from({ length: count }, (_, i) => ({ id: `a${i}`, label: `Показатель ${i}` }));
    const cards = [0, 1, 2].map((i) => ({ id: `c${i}`, name: `N${i}`, anime: "A", values: Object.fromEntries(attributes.map((a) => [a.id, 0])) }));
    const rules = { players: 3, handSize: 1, attributes, cards };
    expect(rulesSchema.safeParse({ ...rules, scale: { min: -limit, max: limit } }).success).toBe(true);
    expect(rulesSchema.safeParse({ ...rules, scale: { min: 0, max: limit + 1 } }).success).toBe(false);
    expect(rulesSchema.safeParse({ ...rules, scale: { min: -limit - 1, max: 0 } }).success).toBe(false);
  });
  it.each([
    ["duplicate card id", (r: YomifudaRules) => { r.cards[1].id = r.cards[0].id; }],
    ["duplicate character", (r: YomifudaRules) => { r.cards[1].name = r.cards[0].name; r.cards[1].anime = r.cards[0].anime; }],
    ["duplicate shikimori character", (r: YomifudaRules) => { r.cards[0].shikimoriId = 42; r.cards[1].shikimoriId = 42; }],
    ["duplicate attribute", (r: YomifudaRules) => { r.attributes[1].id = r.attributes[0].id; }],
    ["missing value", (r: YomifudaRules) => { delete r.cards[0].values.music; }],
    ["extra value", (r: YomifudaRules) => { r.cards[0].values.secret = 50; }],
    ["fraction", (r: YomifudaRules) => { r.cards[0].values.power = 1.5; }],
    ["out of scale", (r: YomifudaRules) => { r.cards[0].values.power = 101; }],
    ["invalid scale", (r: YomifudaRules) => { r.scale.min = 101; }],
    ["wrong deck size", (r: YomifudaRules) => { r.deckSize = 15; }],
    ["not divisible", (r: YomifudaRules) => { r.cards.pop(); r.deckSize--; }],
    ["oversized hand", (r: YomifudaRules) => { r.handSize = 5; }],
    ["impossible pool threshold", (r: YomifudaRules) => { r.pool.minViewers = 4; }],
  ])("rejects %s", (_label, mutate) => {
    const r = fixture(); mutate(r);
    expect(rulesSchema.safeParse(r).success).toBe(false);
  });
  it("requires an own value even for an attribute named constructor", () => {
    expect(rulesSchema.safeParse({ ...fixture(), attributes: [{ id: "constructor", label: "Конструктор" }], cards: fixture().cards.map((c) => ({ ...c, values: {} })) }).success).toBe(false);
  });
  it("requires round numbers and forbids payload fields granting other seats", () => {
    expect(yomifuda.actionSchema.safeParse({ type: "ready" }).success).toBe(false);
    expect(yomifuda.actionSchema.safeParse({ type: "play", round: 1, cardId: "c", seat: 1 }).success).toBe(false);
  });
  it("rejects unknown fields and remote image URLs", () => {
    expect(rulesSchema.safeParse({ ...fixture(), code: "alert(1)" }).success).toBe(false);
    const r = fixture();
    expect(rulesSchema.safeParse({ ...r, cards: r.cards.map((c) => ({ ...c, image: { asset: "https://example.com/a.png" } })) }).success).toBe(false);
    expect(visualSchema.safeParse({ arbitrary: true }).success).toBe(false);
  });
  it("publishes valid educational presets without user deck secrets", () => {
    const doc = presetDocument(yomifuda, yomifuda.presets[0]);
    expect(validateConfig(createCatalog([yomifuda]), doc).ok).toBe(true);
    expect(demoRules().cards).toHaveLength(12);
    expect(describeGame(yomifuda)).toBeTruthy();
  });
});

describe("Yomifuda engine", () => {
  it("deals equal unique hands randomly and keeps the remainder secret", () => {
    const h = harness();
    const hands = [0, 1, 2].map((seat) => yomifuda.view(h.state, seat).hand.map((c) => c.id));
    expect(hands.map((hand) => hand.length)).toEqual([2, 2, 2]);
    expect(new Set(hands.flat()).size).toBe(6);
    expect(yomifuda.view(h.state, null).stockCount).toBe(6);
    expect(hands).not.toEqual([0, 1, 2].map((seat) => yomifuda.view(harness(fixture(), 99).state, seat).hand.map((c) => c.id)));
  });
  it("whitelists only a player's own unvalued hand, never a spectator's", () => {
    const h = harness();
    const own = yomifuda.view(h.state, 0);
    const spectator = yomifuda.view(h.state, null);
    expect(own.hand).toHaveLength(2);
    expect(JSON.stringify(own)).not.toContain('"values"');
    expect(JSON.stringify(spectator)).not.toContain('ast_portrait');
    expect(spectator.hand).toEqual([]);
    expect(yomifuda.view(h.state, 99).hand).toEqual([]);
    expect(yomifuda.view(h.state, -1).canPlay).toBe(false);
    expect(own).not.toHaveProperty("rules");
    expect(own).not.toHaveProperty("hands");
    expect(own).not.toHaveProperty("drawPile");
    expect(own).not.toHaveProperty("finalDeck");
    own.hand[0].name = "CHANGED";
    expect(yomifuda.view(h.state, 0).hand[0].name).not.toBe("CHANGED");
  });
  it("rejects foreign cards, invalid seats, stale rounds and repeated plays without mutation or RNG", () => {
    const h = harness();
    const foreign = yomifuda.view(h.state, 1).hand[0].id;
    const own = yomifuda.view(h.state, 0).hand[0].id;
    const before = structuredClone(h.state), rng = h.ctx().rng.state();
    for (const [seat, action] of [[0, { type: "play", round: 1, cardId: foreign }], [99, { type: "play", round: 1, cardId: own }], [0, { type: "play", round: 0, cardId: own }]] as [number, YomifudaAction][]) {
      expect(isActionError(h.tryAct(seat, action))).toBe(true);
      expect(h.state).toEqual(before);
      expect(h.ctx().rng.state()).toBe(rng);
    }
    h.act(0, { type: "play", round: 1, cardId: own });
    const committed = structuredClone(h.state);
    expect(isActionError(h.tryAct(0, { type: "play", round: 1, cardId: yomifuda.view(h.state, 0).hand[0].id }))).toBe(true);
    expect(h.state).toEqual(committed);
    expect(yomifuda.view(h.state, null).table).toEqual([{ seat: 0, hidden: true }]);
    expect(JSON.stringify(yomifuda.view(h.state, null))).not.toContain(own);
  });
  it("reveals active values only after all cards are committed and waits ten seconds for ready", () => {
    const h = harness(); h.playAll();
    const v = yomifuda.view(h.state, null);
    expect(v.phase).toBe("reveal");
    expect(v.table).toHaveLength(3);
    expect(v.table.every((c) => !c.hidden && typeof c.value === "number")).toBe(true);
    expect(JSON.stringify(v)).not.toContain('"values"');
    expect([v.revealStartedAt, v.revealEndsAt]).toEqual([1000, 11000]);
    expect(isActionError(h.tryAct(0, { type: "ready", round: 1 }))).toBe(true);
    h.wake(10999);
    expect(h.state.phase).toBe("reveal");
    h.wake(11000);
    expect(h.state.phase).toBe("review");
    expect(yomifuda.nextWakeAt!(h.state)).toBe(null);
    expect(yomifuda.view(h.state, 0).canReady).toBe(true);
  });
  it.each([
    ["active beats total", [[90, 0], [80, 100], [30, 100]], [1, 0, 0], []],
    ["total resolves tied active leaders", [[90, 1], [90, 2], [40, 100]], [0, 1, 0], [91, 92, undefined]],
    ["tied totals share half each", [[90, 5], [90, 5], [40, 100]], [0.5, 0.5, 0], [95, 95, undefined]],
    ["three winners each get half", [[90, 5], [90, 5], [90, 5]], [0.5, 0.5, 0.5], [95, 95, 95]],
  ])("scores %s", (_label, values, wantPoints, wantTotals) => {
    const r = fixture({ handSize: 1, attributes: [{ id: "power", label: "Сила" }, { id: "music", label: "Музыка" }] });
    const h = harness(r);
    // The fixture gives every seat the independently specified values of its chosen card.
    h.state.attributeId = "power";
    for (let seat = 0; seat < 3; seat++) {
      const card = h.state.cards.find((c) => c.id === yomifuda.view(h.state, seat).hand[0].id)!;
      card.values = { power: values[seat][0], music: values[seat][1] };
    }
    h.playAll();
    const table = yomifuda.view(h.state, null).table.filter((c) => !c.hidden);
    expect(table.map((c) => c.points)).toEqual(wantPoints);
    expect(table.map((c) => c.tieTotal)).toEqual(wantTotals.length ? wantTotals : [undefined, undefined, undefined]);
  });
  it("draws after every completed battle, then exhausts every card once with no partial battle", () => {
    for (const [deckSize, handSize] of [[12, 2], [6, 2], [3, 1]]) {
      const base = fixture(); const h = harness(fixture({ cards: base.cards.slice(0, deckSize), handSize }));
      const played: string[] = [];
      for (let round = 1; round <= deckSize / 3; round++) {
        expect(h.state.round).toBe(round);
        h.playAll();
        played.push(...yomifuda.view(h.state, null).table.flatMap((t) => t.hidden ? [] : [t.card.id]));
        h.wake(h.state.revealEndsAt!);
        h.readyAll();
      }
      expect(h.state.phase).toBe("finished");
      expect(new Set(played).size).toBe(deckSize);
      expect(played).toHaveLength(deckSize);
      expect(yomifuda.view(h.state, null).finalDeck).toHaveLength(deckSize);
      expect(yomifuda.roundResult(h.state)).not.toBe(null);
    }
  });
  it("rejects late ready/play packets in the next battle", () => {
    const h = harness(); h.playAll(); h.wake(11000); h.readyAll();
    const before = structuredClone(h.state);
    expect(isActionError(h.tryAct(0, { type: "ready", round: 1 }))).toBe(true);
    expect(isActionError(h.tryAct(0, { type: "play", round: 1, cardId: yomifuda.view(h.state, 0).hand[0].id }))).toBe(true);
    expect(h.state).toEqual(before);
    expect(yomifuda.view(h.state, 0).players.map((p) => p.handCount)).toEqual([2, 2, 2]);
  });
  it("rejects duplicate ready without accidentally starting the next battle", () => {
    const h = harness(); h.playAll(); h.wake(11000);
    h.act(0, { type: "ready", round: 1 });
    const before = structuredClone(h.state), rng = h.ctx().rng.state();
    expect(isActionError(h.tryAct(0, { type: "ready", round: 1 }))).toBe(true);
    expect(h.state).toEqual(before);
    expect(h.ctx().rng.state()).toBe(rng);
    expect(h.state.phase).toBe("review");
  });
  it("keeps a reminder deadline without ever playing for a silent player", () => {
    const h = harness(fixture({ choiceSeconds: 1 }));
    const before = structuredClone(h.state);
    h.wake(100000);
    expect(h.state).toEqual(before);
    expect(yomifuda.turnBudgetSeconds!(h.state)).toBe(0);
    expect(yomifuda.timeoutPolicy).toBe("skip");
    expect(yomifuda.nextWakeAt!(h.state)).toBe(null);
    expect(yomifuda.view(h.state, 0).choiceEndsAt).toBe(2000);
  });
  it("uses no-repeat, independent and complete shuffled bags independently of hands", () => {
    const attributes = ["a", "b", "c"].map((id) => ({ id, label: id }));
    const cards = fixture().cards.map((c) => ({ ...c, values: { a: 1, b: 2, c: 3 } }));
    for (const attributeMode of ["no-repeat", "independent", "bag"] as const) {
      const h = harness(fixture({ attributes, cards, attributeMode }));
      const seen: string[] = [];
      for (let i = 0; i < 4; i++) { seen.push(h.state.attributeId); h.playAll(); h.wake(h.state.revealEndsAt!); h.readyAll(); }
      if (attributeMode === "no-repeat") expect(seen.slice(1).every((id, i) => id !== seen[i])).toBe(true);
      if (attributeMode === "bag") expect(new Set(seen.slice(0, 3)).size).toBe(3);
      expect(seen.every((id) => ["a", "b", "c"].includes(id))).toBe(true);
    }
    const h = harness(fixture({ attributes: [{ id: "power", label: "Сила" }], cards: fixture().cards.map((c) => ({ ...c, values: { power: 1 } })) }));
    h.playAll(); h.wake(11000); h.readyAll();
    expect(h.state.attributeId).toBe("power");
  });
  it("does not mutate accepted input state or its original rules", () => {
    const r = fixture(), original = structuredClone(r), h = harness(r);
    const originalState = h.state, before = structuredClone(h.state);
    h.act(0, { type: "play", round: 1, cardId: yomifuda.view(h.state, 0).hand[0].id });
    expect(originalState).toEqual(before);
    expect(r).toEqual(original);
  });
  it("replays an SDK match with identical private state and RNG after wake and draw", () => {
    const config = presetDocument(yomifuda, { id: "t", title: "T", description: "T", config: { rules: fixture() } });
    const match = Match.start({ game: yomifuda, config, seed: 15, seats: 3, startedAt: 1000 });
    for (let seat = 0; seat < 3; seat++) {
      const view = match.view(seat).game as ReturnType<typeof yomifuda.view>;
      expect(match.dispatch(seat, { type: "play", round: view.round, cardId: view.hand[0].id }, 1000)).toEqual({ ok: true });
    }
    match.advance(11000);
    for (let seat = 0; seat < 3; seat++) expect(match.dispatch(seat, { type: "ready", round: 1 }, 11000)).toEqual({ ok: true });
    expect((match.view(0).game as ReturnType<typeof yomifuda.view>).round).toBe(2);
    const restored = Match.restore({ game: yomifuda, config, record: match.record(), now: 11000 });
    expect(restored.view(0)).toEqual(match.view(0));
    expect(restored.record()).toEqual(match.record());
  });
  it("redacts card identities, assets and all values from public rules and summary", () => {
    const r = fixture();
    const shown = yomifuda.presentRules!(r);
    expect(shown.cards).toEqual([]);
    expect(shown.deckSize).toBe(12);
    expect(JSON.stringify(shown)).not.toContain("ast_portrait");
    const summary = yomifuda.summarizeConfig!({ ...presetDocument(yomifuda, yomifuda.presets[0]), rules: r, visual: visualSchema.parse({}) });
    expect(JSON.stringify(summary)).not.toContain("Персонаж");
    expect(JSON.stringify(summary)).not.toContain("ast_portrait");
  });
});


describe("Yomifuda match contract", () => {
  it.each([[90, 40, 20], [90, 90, 40], [90, 90, 90]])("preserves all winning seats for values %j", (...values) => {
    const rules = fixture({ handSize: 1, revealSeconds: 0, attributes: [{ id: 'power', label: 'Сила' }],
      cards: values.map((power, i) => ({ id: `c${i}`, name: `N${i}`, anime: 'A', values: { power } })) });
    const config = presetDocument(yomifuda, { id: 'test', title: 'Test', description: '', config: { rules } });
    const match = Match.start({ game: yomifuda, config, seats: 3, seed: 17, startedAt: 0 });
    const winners: number[] = [];
    for (let seat = 0; seat < 3; seat++) {
      const cardId = (match.view(seat).game as ReturnType<typeof yomifuda.view>).hand[0].id;
      if (rules.cards.find(c => c.id === cardId)!.values.power === 90) winners.push(seat);
      expect(match.dispatch(seat, { type: 'play', round: 1, cardId }, 0)).toEqual({ ok: true });
    }
    for (let seat = 0; seat < 3; seat++) expect(match.dispatch(seat, { type: 'ready', round: 1 }, 1)).toEqual({ ok: true });
    const view = match.view(null), game = view.game as ReturnType<typeof yomifuda.view>;
    const result = { winners, draw: winners.length > 1, scores: [0, 1, 2].map(s => winners.includes(s) ? 1 : 0) };
    expect(view.phase).toBe('finished');
    expect(game.result).toMatchObject({ winners, draw: winners.length > 1 });
    expect(view.result).toEqual(result);
    expect(match.finalResult).toEqual(result);
    expect(Match.restore({ game: yomifuda, config, record: match.record(), now: 10000 }).view(null)).toEqual(view);
  });

  it('rejects repeated decks in both document schema and validation and publishes the limit', () => {
    const config = presetDocument(yomifuda, yomifuda.presets[0]);
    expect(documentSchema(yomifuda).safeParse({ ...config, series: { rounds: 2 } }).success).toBe(false);
    const result = validateConfig(createCatalog([yomifuda]), { ...config, series: { rounds: 2 } });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ path: 'series.rounds' }));
    expect(describeGame(yomifuda).configSchema).toMatchObject({ properties: { series: { properties: { rounds: { const: 1 } } } } });
    expect(documentSchema(yomifuda).parse({ ...config, series: {} }).series.rounds).toBe(1);
  });
});

it("offers only cards from this seat, including simultaneous personal choices", () => {
  const rules = fixture();
  const state = yomifuda.setup({rules, seats: rules.players, firstSeat: 0, round: 0, rng: createRng(42), now: 0});
  for (const seat of [0, 1]) {
    const view = yomifuda.view(state, seat);
    expect(yomifuda.playerActions(view, seat)).toEqual(view.hand.map(card => ({type:"play", fields:{round:view.round, cardId:card.id}})));
    expect(yomifuda.playerActions(view, 2)).toEqual([]);
  }
});

it("keeps author-supplied card and attribute IDs private and plays by the handed-out handle", () => {
  const config = presetDocument(yomifuda, yomifuda.presets[0]);
  const match = Match.start({game: yomifuda, config, seats: yomifuda.seats(config.rules as YomifudaRules).min, seed: 42, startedAt: 100});
  const raw = match.view(0);
  const original = raw.game as ReturnType<typeof yomifuda.view>;
  const ai = match.projectPlayerView(0, raw, 100) as typeof original;
  expect(ai.attribute.id).not.toBe(original.attribute.id);
  expect(ai.hand[0].id).not.toBe(original.hand[0].id);
  expect(match.dispatchPlayer(0, { type: "play", round: ai.round, cardId: original.hand[0].id }, 100).ok).toBe(false);
  expect(match.dispatchPlayer(0, { type: "play", round: ai.round, cardId: ai.hand[0].id }, 100).ok).toBe(true);
});
