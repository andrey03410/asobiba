import { type ConfigDocument, INTERMISSION_MS, type MatchView, type RoundResult, type Seat } from "@asobiba/sdk";
import { assetUrl } from "../api";
import type { WebGameClient } from "../games";
import { useNow } from "../util";

interface Props {
  match: MatchView;
  config: ConfigDocument;
  client: WebGameClient;
  mySeat: Seat | null;
  seatName: (seat: Seat) => string;
  /** serverTime − Date.now(). */
  clockOffset: number;
}

function names(seats: readonly Seat[], seatName: (seat: Seat) => string): string {
  const list = seats.map(seatName);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} и ${list.at(-1)}`;
}

function roundText(rr: RoundResult, seatName: (seat: Seat) => string): string {
  const reason = rr.summary ? ` (${rr.summary})` : "";
  if (rr.draw || rr.winners.length === 0) return `ничья${reason}`;
  return `${rr.winners.length > 1 ? "победили" : "победа —"} ${names(rr.winners, seatName)}${reason}`;
}

/** Whole seconds left, never above `max`: the clock offset is an estimate. */
function secondsLeft(deadline: number, now: number, max = Infinity): number {
  return Math.min(max, Math.max(0, Math.ceil((deadline - now) / 1000)));
}

/** Round, scores, whose turn, the turn countdown and the round/match banners. */
export function MatchHud({ match, config, client, mySeat, seatName, clockOffset }: Props) {
  const ticking = match.phase !== "finished" && (match.turnDeadline !== null || match.intermissionUntil !== null);
  const now = useNow(250, ticking) + clockOffset;
  const { SeatIcon } = client;
  const myTurn = match.phase === "playing" && mySeat !== null && match.currentSeats.includes(mySeat);
  const others = match.currentSeats.filter((s) => s !== mySeat);
  const turnLeft = match.turnDeadline !== null ? secondsLeft(match.turnDeadline, now, config.timer.turnSeconds || Infinity) : null;
  const result = match.result;

  return (
    <div className="hud">
      <div className="hud-top">
        <span className="hud-round">
          Раунд {match.round} из {match.rounds}
        </span>
        {match.phase === "playing" && (
          <span className={`hud-turn${myTurn ? " is-mine" : ""}`}>
            {myTurn ? "Ваш ход" : others.length > 0 ? `Ходит ${names(others, seatName)}` : "Игра идёт"}
          </span>
        )}
        {match.phase === "playing" && turnLeft !== null && (
          <span className={`hud-timer${turnLeft <= 5 ? " is-low" : ""}`} title="Осталось времени на ход" aria-live="off">
            {turnLeft} с
          </span>
        )}
      </div>

      <ol className="scoreboard">
        {match.scores.map((score, seat) => (
          <li key={seat} className={`score${match.currentSeats.includes(seat) && match.phase === "playing" ? " is-turn" : ""}${seat === mySeat ? " is-me" : ""}`}>
            <SeatIcon config={config} seat={seat} assetUrl={assetUrl} size={26} />
            <span className="score-name">
              {seatName(seat)}
              {seat === mySeat && <span className="me-mark">вы</span>}
            </span>
            <span className="score-value">{score}</span>
          </li>
        ))}
      </ol>

      {match.phase === "intermission" && match.lastRound && (
        <div className="banner banner-round" role="status">
          <b>
            Раунд {match.round} окончен: {roundText(match.lastRound, seatName)}
          </b>
          {match.intermissionUntil !== null && <span>Следующий раунд через {secondsLeft(match.intermissionUntil, now, INTERMISSION_MS / 1000)} с</span>}
        </div>
      )}

      {match.phase === "finished" && result && (
        <div className={`banner banner-final${mySeat !== null && result.winners.length === 1 && result.winners[0] === mySeat ? " is-win" : ""}`} role="status">
          <b>
            {result.winners.length === 0
              ? "Ничья: никто не выиграл ни одного раунда"
              : result.winners.length === 1
                ? result.winners[0] === mySeat
                  ? "Вы победили!"
                  : `Победа: ${seatName(result.winners[0] as Seat)}`
                : `Ничья: победу делят ${names(result.winners, seatName)}`}
          </b>
          <span>
            Счёт {result.scores.join(" : ")}
            {match.lastRound && match.rounds > 1 ? ` · последний раунд: ${roundText(match.lastRound, seatName)}` : match.lastRound ? ` · ${roundText(match.lastRound, seatName)}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
