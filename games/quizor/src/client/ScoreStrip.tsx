import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PublicPlayer } from "../game";

export const SEAT_COLORS = [
  "#ae94ff",
  "#65d6cc",
  "#ffbb70",
  "#f48dac",
  "#79b7ff",
  "#d0dc78",
  "#db9bf3",
  "#79d29a",
  "#e2aa84",
  "#94a8ef",
  "#ef99d0",
  "#7ac4d1",
  "#d4c99a",
  "#b7a2cf",
  "#a7d0b9",
  "#e8a5a1",
];
function Score({
  value,
  durationMs,
}: {
  value: number | null;
  durationMs: number;
}) {
  const [shown, setShown] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    const previous = last.current;
    last.current = value;
    if (
      value === null ||
      previous === null ||
      durationMs <= 0 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const t = Math.min(1, (time - start) / durationMs);
      setShown(Math.round(previous + (value - previous) * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return (
    <strong>{shown === null ? "—" : shown.toLocaleString("ru-RU")}</strong>
  );
}
const STATUS: Record<PublicPlayer["status"], string> = {
  thinking: "думает",
  answered: "ответил",
  buzzed: "нажал кнопку",
  choosing: "выбирает",
  bidding: "ставит",
  out: "выбыл",
  offline: "не в сети",
  ready: "готов",
};
export function ScoreStrip({
  players,
  names,
  me,
  colors = SEAT_COLORS,
  durationMs = 500,
}: {
  players: PublicPlayer[];
  names: string[];
  me: number | null;
  colors?: string[];
  durationMs?: number;
}) {
  const nodes = useRef(new Map<number, HTMLLIElement>());
  const positions = useRef(new Map<number, DOMRect>());
  const ordered = [...players].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.seat - b.seat,
  );
  const signature = ordered.map((p) => `${p.seat}:${p.score}`).join("|");
  useLayoutEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    for (const [seat, node] of nodes.current) {
      const rect = node.getBoundingClientRect();
      const old = positions.current.get(seat);
      if (old && !reduce && durationMs > 0 && node.animate)
        node.animate(
          [
            {
              transform: `translate(${old.left - rect.left}px, ${old.top - rect.top}px)`,
            },
            { transform: "translate(0, 0)" },
          ],
          { duration: durationMs, easing: "ease-out" },
        );
      positions.current.set(seat, rect);
    }
  }, [signature, durationMs]);
  return (
    <ol className="qz-scores" aria-label="Участники и счёт">
      {ordered.map((p, rank) => (
        <li
          key={p.seat}
          ref={(node) => {
            if (node) nodes.current.set(p.seat, node);
            else nodes.current.delete(p.seat);
          }}
          className={`qz-player${me === p.seat ? " is-me" : ""}${rank === 0 && p.score !== null ? " is-leader" : ""}${p.out ? " is-out" : ""}`}
          style={{ "--seat": colors[p.seat % colors.length] } as CSSProperties}
        >
          <span className="qz-avatar" aria-hidden="true">
            {p.seat + 1}
          </span>
          <div>
            <span className="qz-player-name">
              {names[p.seat] ?? `Игрок ${p.seat + 1}`}
              {me === p.seat && <small> · вы</small>}
            </span>
            <span className={`qz-player-status is-${p.status}`}>
              {STATUS[p.status]}
            </span>
          </div>
          <Score value={p.score} durationMs={durationMs} />
          {p.delta !== null && p.delta !== 0 && (
            <span
              key={p.delta}
              className={`qz-score-delta${p.delta < 0 ? " is-negative" : ""}`}
            >
              {p.delta > 0 ? "+" : ""}
              {p.delta}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
