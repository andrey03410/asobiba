import { renderToStaticMarkup } from "react-dom/server";
import type { BoardProps } from "@asobiba/sdk";
import type { QuizorView } from "../game";
import { expect, it } from "vitest";
import { QuizorBoard } from "./Board";
import { visualSchema } from "../visual";

const view = {
  phase: "answer",
  round: 1,
  title: "Первый раунд",
  prompt: "Кто мурлычет?",
  questionId: "q",
  questionNumber: 1,
  questionCount: 3,
  blocks: [],
  blockIndex: 0,
  fields: [{ id: "a", type: "text", label: "Животное" }],
  players: [
    {
      seat: 0,
      score: 100,
      status: "thinking",
      online: true,
      out: false,
      delta: null,
    },
  ],
  canAnswer: true,
  ownAnswer: null,
  answers: [],
  submitted: [],
  board: [],
  themes: [],
  special: null,
  deadline: null,
  roundDeadline: null,
  serverNow: 0,
  paused: false,
  resumeAt: null,
  appeal: null,
  legal: ["answer"],
  controls: [],
  events: [],
  history: [],
  grades: [],
  judging: [],
  ready: [],
  eligible: [0],
  reference: "",
  reveal: [],
} as unknown as QuizorView;
const props = {
  match: { game: view, seats: 1 },
  config: { title: "Коты", visual: visualSchema.parse({}) },
  seat: 0,
  assetUrl: (id: string) => `/files/${id}`,
  onAction: () => {},
  playerNames: ["Аня"],
  stage: true,
} as unknown as BoardProps;

it("renders the live stage, player scores, question and answer controls", () => {
  const html = renderToStaticMarkup(<QuizorBoard {...props} />);
  for (const text of ["Кто мурлычет?", "Аня", "100", "Животное", "Ответить"])
    expect(html).toContain(text);
  expect(html).toContain("qz-stage");
  expect(html).not.toContain("Тайный ответ");
});
it("renders a single SVG preview with the question and no input form", () => {
  const html = renderToStaticMarkup(<QuizorBoard {...props} staticRender />);
  expect(html.startsWith("<svg")).toBe(true);
  expect(html.endsWith("</svg>")).toBe(true);
  expect(html).toContain("Кто мурлычет?");
  expect(html).not.toContain("<input");
});
it("conceals question contents on pause and preserves the score panel", () => {
  const html = renderToStaticMarkup(
    <QuizorBoard
      {...props}
      match={{ ...props.match, game: { ...view, paused: true } }}
    />,
  );
  expect(html).toContain("Пауза");
  expect(html).not.toContain("Кто мурлычет?");
  expect(html).toContain("Аня");
});
it("buffers only the selected question media before the synchronized start", () => {
  const html = renderToStaticMarkup(
    <QuizorBoard
      {...props}
      match={{
        ...props.match,
        game: {
          ...view,
          phase: "preload",
          prompt: "",
          fields: [],
          preload: [{ type: "audio", asset: "ast_selected00" }],
        },
      }}
    />,
  );
  expect(html).toContain("ast_selected00");
  expect(html).toContain('preload="auto"');
  expect(html).not.toContain("Кто мурлычет?");
});
