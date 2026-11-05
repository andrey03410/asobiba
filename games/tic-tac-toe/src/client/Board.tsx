import type { BoardProps, SeatIconProps } from "@asobiba/sdk";
import type { CSSProperties, ReactElement } from "react";
import type { TttAction, TttView } from "../game";
import { BLOCKED } from "../rules";
import { type ResolvedPiece, type ResolvedVisual, resolveVisual, type TttVisual } from "../visual";
import { PieceShape, shade } from "./pieces";

const CELL = 100;
const PAD = 20;

type Vars = CSSProperties & Record<`--${string}`, string | number>;

function animVars(durationMs: number, intensity: number): Vars {
  return { "--d": `${durationMs}ms`, "--k": intensity };
}

function Piece({ piece, scale, assetUrl }: { piece: ResolvedPiece; scale: number; assetUrl: (id: string) => string }): ReactElement {
  if (piece.kind === "asset" && piece.asset) {
    const size = 92 * scale;
    return <image href={assetUrl(piece.asset)} x={-size / 2} y={-size / 2} width={size} height={size} preserveAspectRatio="xMidYMid meet" />;
  }
  return (
    <g transform={`scale(${scale * 1.15})`}>
      <PieceShape preset={piece.preset ?? "cross"} color={piece.color} />
    </g>
  );
}

function Texture({ id, kind, color }: { id: string; kind: ResolvedVisual["board"]["texture"]; color: string }): ReactElement | null {
  const ink = color;
  switch (kind) {
    case "paper":
      return (
        <pattern id={id} width={60} height={60} patternUnits="userSpaceOnUse">
          {[
            [7, 9], [31, 4], [48, 22], [18, 37], [41, 49], [55, 41], [4, 52], [26, 24],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={1.2 + (i % 3) * 0.5} fill={ink} fillOpacity={0.12} />
          ))}
        </pattern>
      );
    case "wood":
      return (
        <pattern id={id} width={200} height={34} patternUnits="userSpaceOnUse">
          <path d="M0 8 Q50 2 100 9 T200 7 M0 24 Q60 30 120 22 T200 25" stroke={ink} strokeOpacity={0.1} strokeWidth={3} fill="none" />
        </pattern>
      );
    case "stars":
      return (
        <pattern id={id} width={70} height={70} patternUnits="userSpaceOnUse">
          <path d="M18 10 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1z" fill={ink} fillOpacity={0.14} />
          <path d="M52 44 l2 5 5 1 -4 3 1 5 -4 -2 -4 2 1 -5 -4 -3 5 -1z" fill={ink} fillOpacity={0.1} />
        </pattern>
      );
    case "checker":
      return (
        <pattern id={id} width={40} height={40} patternUnits="userSpaceOnUse">
          <rect width={20} height={20} fill={ink} fillOpacity={0.07} />
          <rect x={20} y={20} width={20} height={20} fill={ink} fillOpacity={0.07} />
        </pattern>
      );
    case "dots":
      return (
        <pattern id={id} width={28} height={28} patternUnits="userSpaceOnUse">
          <circle cx={7} cy={7} r={3} fill={ink} fillOpacity={0.13} />
          <circle cx={21} cy={21} r={3} fill={ink} fillOpacity={0.13} />
        </pattern>
      );
    default:
      return null;
  }
}

/** Board of tic-tac-toe as SVG. The same component renders the site and server previews. */
export function TicTacToeBoard({ match, config, seat, assetUrl, onAction, staticRender }: BoardProps): ReactElement {
  const view = match.game as TttView;
  const visual = resolveVisual(config.visual as TttVisual, match.seats);
  const { palette, board } = visual;
  const { width: W, height: H } = view;
  const style = board.style;
  const gap = style === "grid" ? 0 : (board.gap / 100) * CELL;
  const boardW = W * CELL + (W + 1) * gap;
  const boardH = H * CELL + (H + 1) * gap;
  const vbW = boardW + PAD * 2;
  const vbH = boardH + PAD * 2;
  const animate = !staticRender;
  const uid = `ttt${W}x${H}`;
  const legal = new Set(view.legal);
  const myTurn = !staticRender && match.phase === "playing" && seat !== null && match.currentSeats.includes(seat) && legal.size > 0;
  const lastMoves = new Set(view.lastMoves.map((m) => m.index));
  const winCells = new Set(view.winLines.flat());
  const winners = new Set(view.result && !view.result.draw ? view.result.winners : []);
  const cellX = (c: number) => PAD + gap + c * (CELL + gap);
  const cellY = (r: number) => PAD + gap + r * (CELL + gap);
  const radius = style === "bubbles" ? CELL / 2 : (board.radius / 100) * CELL;
  const { place, idle, win } = visual.animations;

  const click = (index: number) => {
    if (!myTurn || !legal.has(index) || !onAction) return;
    const row = Math.floor(index / W);
    const col = index % W;
    const action: TttAction = view.placement === "gravity" ? { type: "drop", col } : { type: "place", row, col };
    onAction(action);
  };

  const imgAspect = (fit: "cover" | "contain" | "tile") => (fit === "contain" ? "xMidYMid meet" : "xMidYMid slice");
  const svgVars: Vars = { "--ttt-highlight": palette.highlight, "--ttt-winline": palette.winLine };

  return (
    <svg
      className="ttt-svg"
      viewBox={`0 0 ${vbW} ${vbH}`}
      width={vbW}
      height={vbH}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Поле ${W}×${H}`}
      style={svgVars}
    >
      <defs>
        <Texture id={`${uid}-tex`} kind={board.texture} color={palette.grid} />
        {board.background?.fit === "tile" && (
          <pattern id={`${uid}-bgtile`} width={160} height={160} patternUnits="userSpaceOnUse">
            <image href={assetUrl(board.background.asset)} width={160} height={160} preserveAspectRatio="xMidYMid slice" />
          </pattern>
        )}
        {board.cell &&
          style !== "grid" &&
          view.cells.map((v, i) =>
            v === BLOCKED ? null : (
              <clipPath key={i} id={`${uid}-clip-${i}`}>
                <rect x={cellX(i % W)} y={cellY(Math.floor(i / W))} width={CELL} height={CELL} rx={radius} />
              </clipPath>
            ),
          )}
      </defs>

      <rect width={vbW} height={vbH} fill={palette.background} />
      <rect x={PAD} y={PAD} width={boardW} height={boardH} rx={style === "grid" ? 8 : 22} fill={palette.board} />
      {board.texture !== "none" && <rect x={PAD} y={PAD} width={boardW} height={boardH} rx={style === "grid" ? 8 : 22} fill={`url(#${uid}-tex)`} />}
      {board.background &&
        (board.background.fit === "tile" ? (
          <rect x={PAD} y={PAD} width={boardW} height={boardH} fill={`url(#${uid}-bgtile)`} opacity={board.background.opacity} />
        ) : (
          <image
            href={assetUrl(board.background.asset)}
            x={PAD}
            y={PAD}
            width={boardW}
            height={boardH}
            preserveAspectRatio={imgAspect(board.background.fit)}
            opacity={board.background.opacity}
          />
        ))}

      {view.cells.map((v, i) => {
        const r = Math.floor(i / W);
        const c = i % W;
        const x = cellX(c);
        const y = cellY(r);
        if (v === BLOCKED) {
          return (
            <g key={`c${i}`}>
              <rect x={x} y={y} width={CELL} height={CELL} rx={radius} fill={palette.blocked} />
              <path
                d={`M${x + 22} ${y + 22} L${x + CELL - 22} ${y + CELL - 22} M${x + CELL - 22} ${y + 22} L${x + 22} ${y + CELL - 22}`}
                stroke={shade(palette.blocked, -0.25)}
                strokeWidth={6}
                strokeLinecap="round"
              />
            </g>
          );
        }
        const fill = (r + c) % 2 === 0 ? palette.cell : palette.cellAlt;
        const showCellFill = style !== "grid" || palette.cell !== palette.board || palette.cellAlt !== palette.board;
        return (
          <g key={`c${i}`}>
            {showCellFill && <rect x={x} y={y} width={CELL} height={CELL} rx={radius} fill={fill} />}
            {board.cell && (
              <image
                href={assetUrl(board.cell.asset)}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                preserveAspectRatio={imgAspect(board.cell.fit)}
                opacity={board.cell.opacity}
                clipPath={style !== "grid" ? `url(#${uid}-clip-${i})` : undefined}
              />
            )}
          </g>
        );
      })}

      {style === "grid" && (
        <g stroke={palette.grid} strokeWidth={4} strokeLinecap="round">
          {Array.from({ length: W - 1 }, (_, k) => (
            <line key={`v${k}`} x1={PAD + (k + 1) * CELL} y1={PAD + 8} x2={PAD + (k + 1) * CELL} y2={PAD + boardH - 8} />
          ))}
          {Array.from({ length: H - 1 }, (_, k) => (
            <line key={`h${k}`} x1={PAD + 8} y1={PAD + (k + 1) * CELL} x2={PAD + boardW - 8} y2={PAD + (k + 1) * CELL} />
          ))}
        </g>
      )}

      {view.cells.map((v, i) =>
        lastMoves.has(i) && v >= 0 ? (
          <rect
            key={`l${i}`}
            x={cellX(i % W) + 4}
            y={cellY(Math.floor(i / W)) + 4}
            width={CELL - 8}
            height={CELL - 8}
            rx={Math.max(0, radius - 4)}
            fill="none"
            stroke={palette.highlight}
            strokeWidth={5}
          />
        ) : null,
      )}

      {view.cells.map((v, i) => {
        if (v < 0) return null;
        const piece = visual.pieces[v];
        if (!piece) return null;
        const cx = cellX(i % W) + CELL / 2;
        const cy = cellY(Math.floor(i / W)) + CELL / 2;
        const isWin = winCells.has(i) && winners.has(v);
        return (
          <g key={`p${i}`} transform={`translate(${cx} ${cy})`}>
            <g className={animate && place.preset !== "none" ? `ttt-anim place-${place.preset}` : undefined} style={animate ? animVars(place.durationMs, place.intensity) : undefined}>
              <g
                className={animate && idle.preset !== "none" ? `ttt-anim idle-${idle.preset}` : undefined}
                style={animate ? { ...animVars(idle.durationMs, idle.intensity), animationDelay: `${(i * 137) % 900}ms` } : undefined}
              >
                <g className={animate && isWin && win.preset !== "none" ? `ttt-anim win-${win.preset}` : undefined} style={animate ? animVars(win.durationMs, win.intensity) : undefined}>
                  <Piece piece={piece} scale={visual.pieceScale} assetUrl={assetUrl} />
                </g>
              </g>
            </g>
          </g>
        );
      })}

      {view.result &&
        !view.result.draw &&
        view.winLines.map((line, k) => {
          const first = line[0];
          const last = line[line.length - 1];
          if (first === undefined || last === undefined) return null;
          const p = (i: number) => [cellX(i % W) + CELL / 2, cellY(Math.floor(i / W)) + CELL / 2];
          const [x1, y1] = p(first);
          const [x2, y2] = p(last);
          return (
            <line
              key={`w${k}`}
              className={animate ? "ttt-winline is-animated" : "ttt-winline"}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={palette.winLine}
              strokeWidth={12}
              strokeLinecap="round"
              strokeOpacity={0.85}
            />
          );
        })}

      {animate && view.result && !view.result.draw && win.preset === "confetti" && (
        <g>
          {Array.from({ length: 36 }, (_, k) => {
            const x = PAD + ((k * 97) % 100) * (boardW / 100);
            const colors = [palette.winLine, palette.highlight, palette.grid, ...visual.pieces.map((p) => p.color)];
            const vars: Vars = {
              ...animVars(win.durationMs + (k % 5) * 180, win.intensity),
              "--fall": `${vbH * (0.7 + (k % 4) * 0.1)}px`,
              animationDelay: `${(k % 9) * 70}ms`,
            };
            return <rect key={k} className="ttt-confetti-bit" x={x} y={4} width={10} height={16} rx={3} fill={colors[k % colors.length]} style={vars} />;
          })}
        </g>
      )}

      {!staticRender &&
        view.cells.map((v, i) => {
          if (v === BLOCKED) return null;
          const isLegal = myTurn && legal.has(i);
          return (
            <rect
              key={`h${i}`}
              className={`ttt-hit${isLegal ? " is-legal" : ""}`}
              x={cellX(i % W)}
              y={cellY(Math.floor(i / W))}
              width={CELL}
              height={CELL}
              rx={radius}
              onClick={() => click(i)}
              data-cell={i}
            />
          );
        })}
    </svg>
  );
}

/** Small picture of a seat's piece for player lists and scoreboards. */
export function TicTacToeSeatIcon({ config, seat, assetUrl, size = 28 }: SeatIconProps): ReactElement {
  const rules = config.rules as { players: number };
  const piece = resolveVisual(config.visual as TttVisual, rules.players).pieces[seat];
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      {piece ? <Piece piece={piece} scale={0.95} assetUrl={assetUrl} /> : null}
    </svg>
  );
}
