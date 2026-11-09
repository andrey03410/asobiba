import type { PoleView } from "../game";
import type { PoleRules } from "../rules";
import type { ResolvedVisual } from "../visual";
import { StaticWheel, WHEEL } from "./Wheel";

const W = 960;
const H = 540;

const SURFACE: Record<ResolvedVisual["theme"], { board: string; frame: string; closed: string; open: string; panel: string }> = {
  studio: { board: "#0f2747", frame: "#e2b54d", closed: "#1d4f86", open: "#fdf8ec", panel: "#2a1d14" },
  neon: { board: "#0c0f24", frame: "#c37cff", closed: "#2b1d5c", open: "#f4f7ff", panel: "#151a33" },
  paper: { board: "#efe4cc", frame: "#8c7650", closed: "#d9c9a6", open: "#fffdf6", panel: "#fffaf0" },
};

/**
 * One SVG for server previews (resvg has no fonts here): the wheel at rest on the
 * last sector, the board as plates and the players as coloured cards. No text.
 */
export function StaticBoard({ view, rules, look, centerUrl }: { view: PoleView; rules: PoleRules; look: ResolvedVisual; centerUrl?: string }) {
  const s = SURFACE[look.theme];
  const scale = 0.98;
  const wheelX = 8;
  const wheelY = (H - 90 - WHEEL.height * scale) / 2 + 4;
  const tiles = view.words.length > 0 ? [] : view.tiles;
  const cols = 12;
  const tile = 34;
  const gap = 6;
  const boardX = 560;
  const boardY = 120;
  const rowsUsed = Math.max(1, Math.ceil(tiles.length / cols));
  const crossRows = Math.max(1, ...view.cells.map((cell) => cell.row + 1));
  const crossCols = Math.max(1, ...view.cells.map((cell) => cell.col + 1));
  const cell = Math.min(30, 360 / crossCols, 260 / crossRows);
  const players = view.players.length;
  const cardW = Math.min(180, (W - 40 - (players - 1) * 12) / Math.max(1, players));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="rp-static-bg" cx="0.3" cy="0.2" r="1">
          <stop offset="0" stopColor={look.background} stopOpacity="0.85" />
          <stop offset="1" stopColor={look.background} />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={look.background} />
      <rect width={W} height={H} fill="url(#rp-static-bg)" />
      <g transform={`translate(${wheelX} ${wheelY}) scale(${scale})`}>
        <StaticWheel wheel={rules.wheel} look={look} sector={view.spin?.sector ?? null} startedAt={view.spin?.startedAt ?? 0} centerUrl={centerUrl} />
      </g>
      <rect x={boardX - 18} y={boardY - 60} width={W - boardX - 6} height={view.words.length > 0 ? 330 : rowsUsed * (tile + 10) + 110} rx="14" fill={s.board} stroke={s.frame} strokeWidth="4" />
      <rect x={boardX} y={boardY - 40} width={W - boardX - 42} height="18" rx="9" fill={s.frame} fillOpacity="0.35" />
      {tiles.map((item, index) => {
        if (item.open && item.ch === " ") return null;
        const x = boardX + (index % cols) * (tile + gap);
        const y = boardY + Math.floor(index / cols) * (tile + 12);
        return <rect key={index} x={x} y={y} width={tile} height={tile + 6} rx="5" fill={item.open ? s.open : s.closed} stroke={s.frame} strokeOpacity="0.6" />;
      })}
      {view.cells.map((item) => (
        <rect key={item.key} x={boardX + item.col * (cell + 3)} y={boardY + item.row * (cell + 3)} width={cell} height={cell} rx="4" fill={item.open ? s.open : s.closed} stroke={s.frame} strokeOpacity="0.7" />
      ))}
      {view.players.map((player, index) => {
        const x = 20 + index * (cardW + 12);
        const active = index === view.turn && view.phase !== "done";
        return (
          <g key={index}>
            <rect x={x} y={H - 78} width={cardW} height="58" rx="12" fill={s.panel} stroke={active ? look.players[index] : "rgba(255,255,255,.15)"} strokeWidth={active ? 3 : 1} opacity={player.out ? 0.45 : 1} />
            <circle cx={x + 30} cy={H - 49} r="16" fill={look.players[index] ?? look.ink} />
            <rect x={x + 56} y={H - 60} width={cardW - 72} height="8" rx="4" fill={look.ink} fillOpacity="0.5" />
            <rect x={x + 56} y={H - 44} width={Math.max(12, Math.min(cardW - 72, ((player.total + player.round) / 5000) * (cardW - 72)))} height="10" rx="5" fill={look.players[index] ?? look.ink} />
          </g>
        );
      })}
    </svg>
  );
}
