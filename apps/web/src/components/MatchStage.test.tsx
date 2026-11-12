import type { LobbyDto } from "@asobiba/api";
import type { BoardProps, ConfigDocument, MatchView } from "@asobiba/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WebGameClient } from "../games";
import { MatchStage } from "./MatchStage";

const client = {
  Board: (props: BoardProps) => (
    <div
      className="test-board"
      data-stage={String(props.stage)}
      data-fullscreen={String(Boolean(props.fullscreen))}
      data-hold={String(typeof props.onHold)}
      data-control={String(typeof props.onControl)}
      data-control-role={props.controlRole}
      data-connected={String(props.connected)}
    />
  ),
  SeatIcon: () => null,
  css: "",
} as unknown as WebGameClient;

const lobby = {
  id: "lob_test",
  name: "Проверка сцены",
  gameId: "test",
  gameTitle: "Тестовая игра",
} as unknown as LobbyDto;
const config = {
  sdk: 1,
  game: "test",
  gameVersion: 1,
  title: "Проверка",
  rules: {},
  visual: {},
  series: { rounds: 1 },
  timer: { turnSeconds: 0, onTimeout: "skip" },
} as unknown as ConfigDocument;

function view(patch: Partial<MatchView>): MatchView {
  return {
    phase: "playing",
    round: 1,
    rounds: 1,
    scores: [0, 0],
    seats: 2,
    currentSeats: [0],
    turnDeadline: null,
    intermissionUntil: null,
    lastRound: null,
    roundResults: [],
    result: null,
    game: {},
    ...patch,
  } as MatchView;
}

function render(match: MatchView) {
  return renderToStaticMarkup(
    <MatchStage
      lobby={lobby}
      match={match}
      config={config}
      client={client}
      mySeat={0}
      seatName={(seat) => ["Аня", "Боря"][seat] ?? "?"}
      clockOffset={0}
      online
      onLeave={() => {}}
      busy={false}
      drawer={null}
    />,
  );
}

describe("MatchStage", () => {
  it("tells the board when transport is disconnected so drafts can be resynchronized", () => {
    const html = renderToStaticMarkup(
      <MatchStage
        lobby={lobby}
        match={view({})}
        config={config}
        client={client}
        mySeat={0}
        seatName={() => "Аня"}
        clockOffset={0}
        online={false}
        onLeave={() => {}}
        busy={false}
        drawer={null}
      />,
    );
    expect(html).toContain('data-connected="false"');
  });
  it("passes the trusted control channel to a presenter without giving them a player seat", () => {
    const html = renderToStaticMarkup(
      <MatchStage
        lobby={lobby}
        match={view({})}
        config={config}
        client={client}
        mySeat={null}
        seatName={() => "Аня"}
        clockOffset={0}
        online
        onControl={() => {}}
        controlRole="presenter"
        onLeave={() => {}}
        busy={false}
        drawer={null}
      />,
    );
    expect(html).toContain('data-control="function"');
    expect(html).toContain('data-control-role="presenter"');
    expect(html).toContain("ведущий");
  });
  it("gives the whole stage to the board and names the turn", () => {
    const html = render(view({}));
    expect(html).toContain("Ваш ход");
    expect(html).toContain('data-stage="true"');
    expect(html).toContain('data-fullscreen="true"');
    expect(html).toContain('data-hold="function"');
    expect(html).toContain("Лобби");
    expect(html).not.toContain("Итог партии");
  });

  it("tells a match without a winner from a draw", () => {
    const nobody = render(
      view({
        phase: "finished",
        currentSeats: [],
        lastRound: {
          winners: [],
          losers: [0, 1],
          draw: false,
          reason: "out",
          summary: "выбыли все",
        },
        result: { winners: [], draw: true, scores: [0, 0] },
      }),
    );
    expect(nobody).toContain("Победителя нет");
    expect(nobody).toContain("выбыли все");
    const draw = render(
      view({
        phase: "finished",
        currentSeats: [],
        lastRound: {
          winners: [],
          losers: [],
          draw: true,
          reason: "board-full",
        },
        result: { winners: [], draw: true, scores: [0, 0] },
      }),
    );
    expect(draw).toContain("Ничья");
    const won = render(
      view({
        phase: "finished",
        currentSeats: [],
        lastRound: { winners: [1], losers: [0], draw: false, reason: "line" },
        result: { winners: [1], draw: false, scores: [0, 1] },
      }),
    );
    expect(won).toContain("Победа: Боря");
  });
});
