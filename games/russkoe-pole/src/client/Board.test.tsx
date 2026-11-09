import type { ConfigDocument, MatchView } from "@asobiba/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PoleView } from "../game";
import { RusskoePoleBoard } from "./Board";

const rules = {
  players: { min: 1, max: 1 },
  alphabet: { sets: ["ru"], yoAsYe: true, extra: "", revealNonAlphabet: true },
  words: { source: "custom", themes: ["priroda"], custom: [{ question: "Кто мурлычет", answer: "секрет" }], rounds: 1 },
  wheel: [
    { type: "points", value: 500 },
    { type: "points", value: 800 },
    { type: "bankrupt", loss: "round", share: 0.99 },
    { type: "plus" },
  ],
  showCalled: true,
  super: { enabled: false, modifiers: { buyLetter: false } },
};
const view: PoleView = {
  phase: "guess",
  you: 0,
  turn: 0,
  wordIndex: 0,
  wordCount: 1,
  question: "Кто мурлычет",
  tiles: [
    { ch: "", open: false },
    { ch: "", open: false },
    { ch: "", open: false },
  ],
  called: ["а"],
  alphabet: ["а", "б"],
  showCalled: true,
  players: [{ total: 0, round: 0, lives: 0, out: false, outRound: false, words: 0, pausedUntil: 0, note: "" }],
  spin: { sector: 0, durationMs: 4000, startedAt: 0, skipped: true },
  sector: 0,
  math: null,
  chests: null,
  finalists: [],
  lettersLeft: 0,
  yours: [],
  peeked: [],
  words: [],
  cells: [],
  raceEndsAt: 0,
  events: [{ id: 1, text: "Сектор: 500", seat: 0 }],
  result: null,
};
const match = {
  phase: "playing",
  round: 1,
  rounds: 1,
  scores: [0],
  seats: 1,
  currentSeats: [0],
  turnDeadline: null,
  intermissionUntil: null,
  lastRound: null,
  roundResults: [],
  result: null,
  game: view,
} as MatchView;

const config = { sdk: 1, game: "russkoe-pole", gameVersion: 1, title: "Проверка", rules, visual: { theme: "studio" }, series: {}, timer: {} } as ConfigDocument;

describe("Russkoe Pole board", () => {
  it("draws one svg for the preview and keeps the answer out of it", () => {
    const html = renderToStaticMarkup(<RusskoePoleBoard match={match} config={config} seat={null} assetUrl={() => ""} staticRender />);
    expect(html.startsWith("<svg")).toBe(true);
    expect(html.endsWith("</svg>")).toBe(true);
    expect(html).not.toContain("КОТ");
  });

  it("offers a spin result and the question on the live board", () => {
    const html = renderToStaticMarkup(<RusskoePoleBoard match={match} config={config} seat={0} assetUrl={() => ""} playerNames={["Аня"]} />);
    expect(html).toContain("Кто мурлычет");
    expect(html).toContain("Назвать");
    expect(html).toContain("Аня");
    expect(html).toContain(">500<");
    expect(html).not.toContain("КОТ");
  });
});
