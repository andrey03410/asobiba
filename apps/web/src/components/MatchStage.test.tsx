import { yomifuda, type YomifudaView } from '@asobiba/game-yomifuda';
import { Match, presetDocument } from '@asobiba/sdk';
import type { LobbyDto } from "@asobiba/api";
import type { BoardProps, ConfigDocument, MatchView } from "@asobiba/sdk";
import type { ComponentProps } from "react";
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
      data-action={String(typeof props.onAction)}
      data-control-role={props.controlRole}
      data-connected={String(props.connected)}
      data-clock-offset={props.clockOffset}
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

function render(match: MatchView, props: Partial<ComponentProps<typeof MatchStage>> = {}) {
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
      {...props}
    />,
  );
}

describe("MatchStage", () => {
  it("lets the host pause any active game", () => {
    const html = render(view({}), { onPauseChange: () => {} });
    expect(html).toContain("Поставить на паузу");
    expect(render(view({}))).not.toContain("Поставить на паузу");
  });

  it("hides turn clocks and disables both board channels during a manual pause", () => {
    const html = render(view({ turnDeadline: 50_000, pause: { reason: "manual", since: 40_000 } }), {
      onAction: () => {},
      onControl: () => {},
      onPauseChange: () => {},
    });
    expect(html).toContain("Партия на паузе");
    expect(html).toContain("Возобновить партию");
    expect(html).toContain('inert=""');
    expect(html).not.toContain("stage-timer");
    expect(html).not.toContain("Ваш ход");
    expect(html).toContain('data-action="undefined"');
    expect(html).toContain('data-control="undefined"');
  });

  it("passes logical time to the board after resuming", () => {
    const html = render(view({ clockShiftMs: 6_000 }), { clockOffset: 500 });
    expect(html).toContain('data-clock-offset="-5500"');
  });

  it("offers the host recovery with only compatible options and unseated spectators", () => {
    const unavailablePresenter: LobbyDto = {
      ...lobby,
      status: "playing",
      agent: { role: "presenter", status: "disconnected", canUseAlgorithm: false },
      members: [
        { userId: "p", login: "Игрок", role: "player", seat: 0, joinedAt: "" },
        { userId: "h", login: "Бывший игрок", role: "spectator", seat: null, joinedAt: "", eligiblePresenter: false },
        { userId: "s", login: "Зритель", role: "spectator", seat: null, joinedAt: "", eligiblePresenter: true },
      ],
      url: "https://asobiba.example/lobby/lob_test",
    };
    const paused = view({ pause: { reason: "presenter-disconnected", since: 40_000 } });
    const host = render(paused, { lobby: unavailablePresenter, onAgentAction: () => {}, onPauseChange: () => {} });
    expect(host).toContain("ИИ отключился");
    expect(host).toContain("Переподключить ИИ");
    expect(host).toContain("тот же чат");
    expect(host).toContain(unavailablePresenter.url);
    expect(host).toContain("Назначить человека");
    expect(host).toContain('<option value="s">Зритель</option>');
    expect(host).not.toContain('<option value="h">');
    expect(host).not.toContain('<option value="p">');
    expect(host).not.toContain("Включить алгоритмического ведущего");
    expect(host).toContain("Завершить партию");

    const compatible = { ...unavailablePresenter, agent: { ...unavailablePresenter.agent!, canUseAlgorithm: true } };
    expect(render(paused, { lobby: compatible, onAgentAction: () => {} })).toContain("Включить алгоритмического ведущего");

    const guest = render(paused, { lobby: compatible });
    expect(guest).toContain("ИИ отключился");
    expect(guest).not.toContain("Переподключить ИИ");
    expect(guest).not.toContain("Возобновить партию");
  });

  it("shows public commentary and a departure notice without pausing the match", () => {
    const html = render(view({}), {
      lobby: {
        ...lobby,
        agent: { role: "commentator", status: "disconnected", canUseAlgorithm: false },
        agentNotice: "ИИ отключился. Партия продолжается.",
        agentComments: [{ id: "round-1", text: "Итог боя — ничья." }],
      },
      onAction: () => {},
    });
    expect(html).toContain("Комментатор · ИИ");
    expect(html).toContain("ИИ отключился. Партия продолжается.");
    expect(html).toContain("Итог боя — ничья.");
    expect(html).toContain('data-action="function"');
  });

  it("lets a board own its turn HUD without duplicating the turn", () => {
    const html = renderToStaticMarkup(<MatchStage lobby={lobby} match={view({})} config={config} client={{ ...client, stageHud: 'board' } as WebGameClient} mySeat={0} seatName={() => 'Аня'} clockOffset={0} online onLeave={() => {}} busy={false} drawer={null} information={<p>Правила этой партии</p>} />);
    expect(html).not.toContain('stage-turn');
    expect(html).toContain('Об игре');
  });
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


it('names the actual shared Yomifuda winners in the common final dialog', () => {
  const config = presetDocument(yomifuda, { id: 'test', title: 'Test', description: '', config: { rules: {
    players: 3, handSize: 1, revealSeconds: 0, attributes: [{ id: 'power', label: 'Сила' }],
    cards: [90, 90, 40].map((power, i) => ({ id: `c${i}`, name: `N${i}`, anime: 'A', values: { power } })),
  } } });
  const match = Match.start({ game: yomifuda, config, seats: 3, seed: 17, startedAt: 0 });
  const winners: number[] = [];
  for (let seat = 0; seat < 3; seat++) {
    const cardId = (match.view(seat).game as YomifudaView).hand[0].id;
    if (cardId !== 'c2') winners.push(seat);
    match.dispatch(seat, { type: 'play', round: 1, cardId }, 0);
  }
  for (let seat = 0; seat < 3; seat++) match.dispatch(seat, { type: 'ready', round: 1 }, 1);
  const html = renderToStaticMarkup(<MatchStage lobby={lobby} match={match.view(0)} config={config} client={client} mySeat={0} seatName={seat => `Person${seat}`} clockOffset={0} online onLeave={() => {}} busy={false} drawer={null} />);
  const heading = html.match(/<h2>(.*?)<\/h2>/)?.[1];
  expect(heading).toContain('Победу делят');
  for (const seat of winners) expect(heading).toContain(`Person${seat}`);
  expect(heading).not.toContain(`Person${[0, 1, 2].find(s => !winners.includes(s))}`);
});
