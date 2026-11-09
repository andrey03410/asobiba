import type { LobbyDto } from "@asobiba/api";
import { type ConfigDocument, INTERMISSION_MS, type MatchView, type RoundResult, type Seat, type StageFullscreen } from "@asobiba/sdk";
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl } from "../api";
import type { WebGameClient } from "../games";
import { useNow } from "../util";
import { ErrorBoundary } from "./ErrorBoundary";

interface Props {
  lobby: LobbyDto;
  match: MatchView;
  config: ConfigDocument;
  client: WebGameClient;
  mySeat: Seat | null;
  seatName: (seat: Seat) => string;
  clockOffset: number;
  online: boolean;
  onAction?: (action: unknown) => void;
  /** Host only: start the next match from the result card. */
  onPlayAgain?: () => void;
  /** Leave the stage for the lobby page; offered once the match is over. */
  onLeave: () => void;
  busy: boolean;
  /** Lobby panel content: players, link, host actions, rules. */
  drawer: ReactNode;
}

interface HudSnapshot {
  phase: MatchView["phase"];
  currentSeats: readonly Seat[];
}

function names(seats: readonly Seat[], seatName: (seat: Seat) => string): string {
  const list = seats.map(seatName);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} и ${list.at(-1)}`;
}

function roundText(rr: RoundResult, seatName: (seat: Seat) => string): string {
  const reason = rr.summary ? ` — ${rr.summary}` : "";
  if (rr.draw) return `ничья${reason}`;
  if (rr.winners.length === 0) return `без победителя${reason}`;
  return `${names(rr.winners, seatName)}${reason}`;
}

function secondsLeft(deadline: number, now: number, max = Infinity): number {
  return Math.min(max, Math.max(0, Math.ceil((deadline - now) / 1000)));
}

/** Browser fullscreen of one element, with the state kept in sync with Esc and the browser UI. */
function useFullscreen(ref: RefObject<HTMLElement | null>): StageFullscreen {
  // A host may report fullscreen as enabled and still refuse it (an embedded
  // browser): after a refusal the button goes away instead of doing nothing.
  const [refused, setRefused] = useState(false);
  const available = typeof document !== "undefined" && Boolean(document.fullscreenEnabled) && !refused;
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement && document.fullscreenElement === ref.current) void document.exitFullscreen().catch(() => {});
    };
  }, [ref]);
  const toggle = useCallback(() => {
    if (!available) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void ref.current?.requestFullscreen?.().catch(() => setRefused(true));
  }, [available, ref]);
  return useMemo(() => ({ active, available, toggle }), [active, available, toggle]);
}

/** The ticking parts live in their own components: the board does not redraw on every tick. */
function StageTimer({ deadline, clockOffset, max }: { deadline: number; clockOffset: number; max: number }) {
  const left = secondsLeft(deadline, useNow(250, true) + clockOffset, max);
  return <span className={`stage-timer${left <= 5 ? " is-low" : ""}`}>{left} с</span>;
}

function IntermissionLeft({ until, clockOffset }: { until: number; clockOffset: number }) {
  return <span>Следующий через {secondsLeft(until, useNow(250, true) + clockOffset, INTERMISSION_MS / 1000)} с</span>;
}

function FullscreenIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {active ? <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /> : <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />}
    </svg>
  );
}

/**
 * The match stage: once a match is on, the lobby steps aside and the board takes
 * the whole window. A slim bar keeps the turn, the clock and the way back.
 */
export function MatchStage({ lobby, match, config, client, mySeat, seatName, clockOffset, online, onAction, onPlayAgain, onLeave, busy, drawer }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(rootRef);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resultHidden, setResultHidden] = useState(false);
  // While the board holds (a wheel still spinning), the HUD shows the match as it
  // was before the update that started the animation. The board reports the hold
  // from an effect, after this component already rendered that update, so the
  // snapshot before it is kept here.
  const snapshot: HudSnapshot = { phase: match.phase, currentSeats: match.currentSeats };
  const hud = useRef({ match, before: snapshot, now: snapshot });
  if (hud.current.match !== match) hud.current = { match, before: hud.current.now, now: snapshot };
  const [heldHud, setHeldHud] = useState<HudSnapshot | null>(null);
  const onHold = useCallback((hold: boolean) => {
    // Read the snapshot now: by the time an updater runs, a newer match may have arrived.
    const before = hud.current.before;
    setHeldHud((current) => (hold ? (current ?? before) : null));
  }, []);
  const held = heldHud !== null;
  const shown = heldHud ?? snapshot;
  const myTurn = shown.phase === "playing" && mySeat !== null && shown.currentSeats.includes(mySeat);
  const others = shown.currentSeats.filter((seat) => seat !== mySeat);
  const result = match.phase === "finished" && !held ? match.result : null;
  const series = match.rounds > 1;

  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.documentElement.classList.add("has-stage");
    return () => {
      document.body.style.overflow = overflow;
      document.documentElement.classList.remove("has-stage");
    };
  }, []);

  useEffect(() => {
    if (match.phase !== "finished") setResultHidden(false);
  }, [match.phase]);

  // A board that forgets to release must not freeze the HUD for good.
  useEffect(() => {
    if (!held) return;
    const timer = window.setTimeout(() => setHeldHud(null), 15_000);
    return () => window.clearTimeout(timer);
  }, [held]);

  useEffect(() => {
    if (!drawerOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [drawerOpen]);

  const playerNames = Array.from({ length: match.seats }, (_, seat) => seatName(seat));
  const { SeatIcon } = client;

  return (
    <div className={`stage${fullscreen.active ? " is-fullscreen" : ""}`} ref={rootRef} data-game={lobby.gameId}>
      <header className="stage-bar">
        <button type="button" className="stage-btn stage-lobby" onClick={() => (shown.phase === "finished" ? onLeave() : setDrawerOpen(true))} title={shown.phase === "finished" ? "Вернуться в лобби" : "Игроки, ссылка и правила"}>
          <span aria-hidden="true">{shown.phase === "finished" ? "←" : "☰"}</span>
          <span className="stage-btn-text">Лобби</span>
        </button>
        <div className="stage-title">
          <b>{lobby.name}</b>
          <span>{lobby.gameTitle}</span>
        </div>
        <div className="stage-status" aria-live="polite">
          {series && (
            <span className="stage-chip">
              Раунд {match.round} из {match.rounds}
            </span>
          )}
          {shown.phase === "playing" && <span className={`stage-turn${myTurn ? " is-mine" : ""}`}>{myTurn ? "Ваш ход" : others.length > 0 ? `Ходит ${names(others, seatName)}` : "Игра идёт"}</span>}
          {shown.phase === "intermission" && <span className="stage-chip">Перерыв</span>}
          {shown.phase === "finished" && <span className="stage-chip">Партия окончена</span>}
          {shown.phase === "playing" && !held && match.turnDeadline !== null && <StageTimer deadline={match.turnDeadline} clockOffset={clockOffset} max={config.timer.turnSeconds || Infinity} />}
        </div>
        {series && (
          <ol className="stage-score" aria-label="Счёт серии">
            {match.scores.map((score, seat) => (
              <li key={seat} className={seat === mySeat ? "is-me" : undefined} title={seatName(seat)}>
                <SeatIcon config={config} seat={seat} assetUrl={assetUrl} size={20} />
                <b>{score}</b>
              </li>
            ))}
          </ol>
        )}
        <div className="stage-tools">
          {!online && <span className="stage-chip is-warn">нет связи…</span>}
          {mySeat === null && <span className="stage-chip">зритель</span>}
          {fullscreen.available && (
            <button type="button" className="stage-btn" onClick={fullscreen.toggle} title={fullscreen.active ? "Выйти из полного экрана (Esc)" : "Во весь экран"} aria-label={fullscreen.active ? "Выйти из полного экрана" : "Во весь экран"}>
              <FullscreenIcon active={fullscreen.active} />
            </button>
          )}
        </div>
      </header>

      <main className="stage-body">
        <ErrorBoundary resetKey={match}>
          <div className={`stage-board${mySeat === null ? " is-spectator" : ""}`}>
            <client.Board match={match} config={config} seat={mySeat} assetUrl={assetUrl} onAction={onAction} playerNames={playerNames} clockOffset={clockOffset} stage fullscreen={fullscreen} onHold={onHold} />
          </div>
        </ErrorBoundary>

        {shown.phase === "intermission" && match.lastRound && (
          <div className="stage-toast" role="status">
            <b>
              Раунд {match.round} окончен: {roundText(match.lastRound, seatName)}
            </b>
            {match.intermissionUntil !== null && <IntermissionLeft until={match.intermissionUntil} clockOffset={clockOffset} />}
          </div>
        )}

        {result && !resultHidden && (
          <div className="stage-result" role="dialog" aria-label="Итог партии">
            <div className={`stage-result-card${mySeat !== null && result.winners.length === 1 && result.winners[0] === mySeat ? " is-win" : ""}`}>
              <p className="stage-result-kicker">Итог партии</p>
              <h2>
                {result.winners.length === 0
                  ? result.scores.every((score) => score === 0) && match.lastRound && !match.lastRound.draw
                    ? "Победителя нет"
                    : "Ничья"
                  : result.winners.length === 1
                    ? result.winners[0] === mySeat
                      ? "Вы победили!"
                      : `Победа: ${seatName(result.winners[0] as Seat)}`
                    : `Победу делят ${names(result.winners, seatName)}`}
              </h2>
              {match.lastRound?.summary && <p className="stage-result-why">{match.lastRound.summary}</p>}
              {series && <p className="stage-result-why">Счёт серии {result.scores.join(" : ")}</p>}
              <div className="stage-result-actions">
                {onPlayAgain && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={onPlayAgain}>
                    Сыграть ещё
                  </button>
                )}
                <button type="button" className="btn" onClick={onLeave}>
                  В лобби
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setResultHidden(true)}>
                  Посмотреть доску
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {drawerOpen && (
        <div className="stage-drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <aside className="stage-drawer" onClick={(event) => event.stopPropagation()} aria-label="Лобби">
            <div className="stage-drawer-head">
              <b>Лобби</b>
              <button type="button" className="stage-btn" onClick={() => setDrawerOpen(false)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            {drawer}
          </aside>
        </div>
      )}
    </div>
  );
}
