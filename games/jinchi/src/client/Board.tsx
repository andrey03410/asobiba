import type { BoardProps, SeatIconProps } from '@asobiba/sdk';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { findPlacements, placementError } from '../game';
import type { JinchiView } from '../game';
import { rulesText } from '../rules';
import { DEFAULT_COLORS } from '../visual';
import type { JinchiVisual } from '../visual';
import { MapArtwork, MapViewport } from './MapViewport';

type Props = BoardProps;
type Cell = { x: number; y: number };
type Vars = CSSProperties & Record<`--${string}`, string | number>;

function indicesPath(indices: number[], width: number): string {
  return indices.map(index => `M${index % width} ${Math.floor(index / width)}h1v1h-1z`).join('');
}

function Die({ value, sides, color }: { value: number | null; sides: number; color: string }): ReactElement {
  const points: Record<number, [number, number][]> = {
    1: [[16, 16]], 2: [[9, 9], [23, 23]], 3: [[9, 9], [16, 16], [23, 23]],
    4: [[9, 9], [23, 9], [9, 23], [23, 23]], 5: [[9, 9], [23, 9], [16, 16], [9, 23], [23, 23]],
    6: [[9, 8], [23, 8], [9, 16], [23, 16], [9, 24], [23, 24]],
  };
  return <span className={`jinchi-die${value === null ? ' is-waiting' : ''}`} style={{ '--seat-color': color } as Vars}>
    <svg viewBox="0 0 32 32" role="img" aria-label={value === null ? `Кубик d${sides} ещё не брошен` : `Кубик d${sides}: ${value}`}>
      {value !== null && sides <= 6 && points[value] ? points[value].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.4" fill="currentColor" />) : <text x="16" y="17" dominantBaseline="middle" textAnchor="middle" fill="currentColor" fontSize="19" fontWeight="800">{value ?? '?'}</text>}
    </svg>
  </span>;
}

// Numbers are paths so resvg previews need no installed fonts.
const BASE_DIGITS = [
  'M-.08-.12L.02-.21V.2M-.09.2H.12',
  'M-.13-.13Q-.13-.23 0-.23T.13-.1Q.13-.03.02.05L-.13.2H.14',
  'M-.13-.19Q.15-.29.13-.07Q.12 0 0 0Q.16 0 .13.13Q.1.29-.14.19',
  'M.09.22V-.22M.08.08H-.15L.02-.22',
  'M.12-.21H-.12V-.02Q.15-.12.13.12Q.1.29-.13.19',
  'M.12-.18Q-.18-.34-.13.13Q-.1.29.1.17Q.24-.05-.13-.02',
  'M-.14-.21H.15L-.06.21',
  'M0 0Q-.23-.06-.1-.2Q.04-.3.13-.16Q.19-.06 0 0Q-.23.06-.1.2Q.04.3.13.16Q.19.06 0 0',
];

const BaseLabels = memo(function BaseLabels({ bases, width, colors }: { bases: number[]; width: number; colors: string[] }): ReactElement {
  const first = new Map<number, number>();
  for (let i = 0; i < bases.length; i++) if (bases[i] >= 0 && !first.has(bases[i])) first.set(bases[i], i);
  return <g className="jinchi-bases" pointerEvents="none">{[...first].map(([seat, index]) => <g key={seat} transform={`translate(${index % width + .5} ${Math.floor(index / width) + .5})`}>
    <circle r=".32" fill="#112b32" fillOpacity=".78" stroke={colors[seat]} strokeWidth=".055" />
    <path d={BASE_DIGITS[seat]} fill="none" stroke="#fff" strokeWidth=".055" strokeLinecap="round" strokeLinejoin="round" />
  </g>)}</g>;
});

const LastMove = memo(function LastMove({ view, visual, round }: { view: JinchiView; visual: JinchiVisual; round: number }): ReactElement | null {
  const move = view.lastMove;
  if (!move) return null;
  const duration = visual.animations.durationMs;
  const centerIndex = move.indices[Math.floor(move.indices.length / 2)] ?? move.captured[0] ?? 0;
  const centerX = centerIndex % view.width, centerY = Math.floor(centerIndex / view.width);
  const buckets = Array.from({ length: 8 }, () => [] as number[]);
  let maxDistance = 1;
  for (const index of move.captured) maxDistance = Math.max(maxDistance, Math.hypot(index % view.width - centerX, Math.floor(index / view.width) - centerY));
  for (const index of move.captured) {
    const distance = Math.hypot(index % view.width - centerX, Math.floor(index / view.width) - centerY);
    buckets[Math.min(7, Math.floor(distance / maxDistance * 7))].push(index);
  }
  return <g key={`${round}-${move.turn}`} pointerEvents="none" style={{ '--jinchi-duration': `${duration}ms` } as Vars}>
    <path className={visual.animations.place === 'pop' ? 'jinchi-last-place has-pop' : 'jinchi-last-place'} d={indicesPath(move.indices, view.width)} fill="none" stroke="#fff6c8" strokeWidth=".09" strokeLinejoin="round" />
    {buckets.map((indices, i) => indices.length ? <path key={i} className={visual.animations.capture === 'wave' ? 'jinchi-capture has-wave' : 'jinchi-capture'} d={indicesPath(indices, view.width)} fill="#fff6c8" fillOpacity=".18" style={{ animationDelay: `${i * duration / 12}ms` }} /> : null)}
  </g>;
});

/** The interactive renderer is separate so static previews never mount camera hooks. */
export function JinchiBoard(props: Props): ReactElement {
  const view = props.match.game as JinchiView;
  const visual = props.config.visual as JinchiVisual;
  const colors = visual.colors ?? DEFAULT_COLORS;
  const previewScale = Math.max(400, Math.min(1400, Math.max(view.width, view.height) * 14)) / (Math.max(view.width, view.height) + 1.4);
  if (props.staticRender) return <svg xmlns="http://www.w3.org/2000/svg" viewBox={`-0.7 -0.7 ${view.width + 1.4} ${view.height + 1.4}`} width={(view.width + 1.4) * previewScale} height={(view.height + 1.4) * previewScale} role="img" aria-label={`Jinchi — карта ${view.width}×${view.height}`}>
    <rect x="-.7" y="-.7" width={view.width + 1.4} height={view.height + 1.4} fill={visual.background} />
    <MapArtwork width={view.width} height={view.height} cells={view.cells} colors={colors} wallColor={visual.wallColor} background={visual.background} grid={visual.grid}>
      <BaseLabels bases={view.bases} width={view.width} colors={colors} />
    </MapArtwork>
  </svg>;
  return <InteractiveBoard {...props} />;
}

function InteractiveBoard({ match, config, seat, onAction, playerNames, turnRemainingMs, clockOffset = 0 }: Props): ReactElement {
  const view = match.game as JinchiView;
  const visual = config.visual as JinchiVisual;
  const colors = visual.colors ?? DEFAULT_COLORS;
  const name = (index: number) => playerNames?.[index] || `Игрок ${index + 1}`;
  const [ghost, setGhost] = useState<Cell | null>(null);
  const [rotated, setRotated] = useState(false);
  const [hints, setHints] = useState(true);
  const [error, setError] = useState('');
  const [touch, setTouch] = useState(false);
  const touchRef = useRef(false);
  const [pending, setPending] = useState(false);
  const pendingTurn = useRef<string | null>(null);
  const turnKey = `${match.round}:${view.turn}:${view.currentSeat}:${view.dice?.join(':') ?? 'roll'}`;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (turnRemainingMs !== undefined || match.turnDeadline === null || match.phase !== 'playing') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [turnRemainingMs, match.turnDeadline, match.phase]);
  const remaining = turnRemainingMs !== undefined ? turnRemainingMs : match.turnDeadline === null ? null : Math.max(0, Math.min((config.timer?.turnSeconds ?? Infinity) * 1000, match.turnDeadline - now - clockOffset));
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => { pendingTurn.current = null; setPending(false); }, 3500);
    return () => window.clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    pendingTurn.current = null;
    setPending(false);
    setError('');
    setGhost(null);
  }, [turnKey]);
  const canAct = match.phase === 'playing' && seat !== null && view.canAct && view.currentSeat === seat;
  const ready = canAct && view.dice !== null;
  const ownCells = useMemo(() => seat === null ? [] : view.cells.flatMap((value, index) => value === seat ? [index] : []), [seat, view.cells]);
  const hintPath = useMemo(() => {
    if (!ready || !hints || seat === null) return '';
    const placements = findPlacements(view, seat, rotated);
    return placements.filter(action => action.type === 'place').map(action => `M${action.x + .5} ${action.y + .5}h.001`).join('');
  }, [view, seat, ready, hints, rotated]);
  const ghostError = ghost && ready && seat !== null ? placementError(view, seat, ghost.x, ghost.y, rotated) : null;
  const diceW = view.dice ? view.dice[rotated ? 1 : 0] : 0;
  const diceH = view.dice ? view.dice[rotated ? 0 : 1] : 0;
  const place = (position: Cell | null) => {
    if (!ready || seat === null || !position || pendingTurn.current === turnKey) return;
    const reason = placementError(view, seat, position.x, position.y, rotated);
    if (reason) { setError(reason); return; }
    if (!onAction) return;
    pendingTurn.current = turnKey;
    setPending(true);
    setError('');
    onAction({ type: 'place', x: position.x, y: position.y, rotated });
  };
  const rotate = () => { if (ready) { setRotated(old => !old); setError(''); } };
  const roll = () => {
    if (!canAct || view.dice || pendingTurn.current === turnKey || !onAction) return;
    pendingTurn.current = turnKey; setPending(true); onAction({ type: 'roll' });
  };
  const status = match.phase === 'finished' || view.result ? 'Территории поделены' : canAct ? 'Ваш ход' : seat === null ? 'Наблюдение' : `Ходит ${name(view.currentSeat)}`;
  const currentColor = colors[view.currentSeat] ?? colors[0];
  const eventIcon = { roll: '⚄', place: '▰', skip: '↷', capture: '◎', eliminate: '×' };
  const rules = rulesText(view.rules);
  const hud = <div className="jinchi-hud">
    <div className="jinchi-hud-top"><div className="jinchi-game-title"><span className="jinchi-monogram" aria-hidden="true">陣</span><div><strong>Jinchi</strong><span>Занимайте. Окружайте. Побеждайте.</span></div></div><div className="jinchi-round"><span>КРУГ</span><b>{view.cycle}</b></div></div>
    <div className="jinchi-scoreboard" aria-label="Территории игроков">{view.scores.map((score, index) => <div key={index} className={`jinchi-player${view.currentSeat === index && match.phase === 'playing' ? ' is-current' : ''}${view.eliminated[index] ? ' is-eliminated' : ''}`} style={{ '--seat-color': colors[index] } as Vars}>
      <span className="jinchi-player-marker">{index + 1}</span><div className="jinchi-player-info"><strong>{name(index)}{seat === index && <span className="jinchi-you">вы</span>}</strong><span>{view.eliminated[index] ? 'Выбыл' : `${(view.area ? score / view.area * 100 : 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% карты`}</span></div><b className="jinchi-player-score">{score.toLocaleString('ru-RU')}<small>клеток</small></b>
    </div>)}</div>
    <div className="jinchi-turnbar" style={{ '--seat-color': currentColor } as Vars}>
      <div className="jinchi-turn-status" aria-live="polite"><i /><div><strong>{status}</strong><span>{pending ? 'Ход отправлен…' : ready ? touch ? 'Выберите место и подтвердите' : 'Поставьте прямоугольник рядом со своей территорией' : canAct ? 'Бросьте кубики, чтобы узнать размер фигуры' : match.phase === 'playing' ? 'Продумайте следующий ход' : 'Можно осмотреть карту'}</span></div></div>
      {remaining !== null && match.phase === 'playing' && <output className={`jinchi-timer${remaining <= 10_000 ? ' is-urgent' : ''}`} aria-label="Осталось времени на ход">{Math.ceil(Math.max(0, remaining) / 1000)} с</output>}
      <div className="jinchi-dice-pair"><Die value={view.dice?.[rotated ? 1 : 0] ?? null} sides={view.rules.dice.sides} color={currentColor} /><span aria-hidden="true">×</span><Die value={view.dice?.[rotated ? 0 : 1] ?? null} sides={view.rules.dice.sides} color={currentColor} /><span className="jinchi-dice-size">{view.dice ? `${diceW} × ${diceH}` : `d${view.rules.dice.sides}`}</span></div>
      {canAct && !view.dice && <button type="button" className="jinchi-primary" data-action="roll" onClick={roll} disabled={pending}>Бросить кубики</button>}
      {ready && <div className="jinchi-placement-actions"><button type="button" onClick={rotate} disabled={pending} title="Повернуть (R или правая кнопка)"><span aria-hidden="true">↻</span> Повернуть</button><button type="button" className="jinchi-primary" data-action="place" disabled={!ghost || ghostError !== null || pending} onClick={() => place(ghost)}>Поставить</button></div>}
    </div>
    <div className="jinchi-utilitybar"><div className="jinchi-utility-start"><button type="button" className={hints ? 'is-active' : ''} aria-pressed={hints} onClick={() => setHints(old => !old)} title="Подсказки (H)"><span aria-hidden="true">✦</span> Подсказки <kbd>H</kbd></button><span className="jinchi-placement-message" role="status">{error || (ready && ghost ? ghostError || `${diceW} × ${diceH} · можно поставить` : `${view.area.toLocaleString('ru-RU')} игровых клеток`)}</span></div>
      <div className="jinchi-details"><details className="jinchi-rules"><summary>Правила</summary><div className="jinchi-details-panel"><h4>Правила этой карты</h4><ul>{rules.map((text, i) => <li key={i}>{text}</li>)}</ul><p className="jinchi-key-help">R — поворот · H — подсказки · F — полный экран<br />M — к себе · L — последний ход · 0 — вся карта<br />Стрелки / WASD — перемещение · + / − — масштаб</p></div></details><details className="jinchi-events"><summary>События <span>{view.events.length}</span></summary><div className="jinchi-details-panel"><h4>Последние события</h4>{view.events.length ? <ol>{[...view.events].reverse().slice(0, 24).map(event => <li key={event.id}><i style={{ color: colors[event.seat] }} aria-hidden="true">{eventIcon[event.type]}</i><span><b>{name(event.seat)}</b>: {event.text.replace(/Игрок \d+\s*/g, '')}</span></li>)}</ol> : <p>История партии появится здесь.</p>}</div></details></div>
    </div>
  </div>;

  return <section className="jinchi-board" onPointerDownCapture={event => { const isTouch = event.pointerType === 'touch'; touchRef.current = isTouch; setTouch(isTouch); }} onContextMenu={event => { if ((event.target as Element).closest('.jinchi-map') && ready) { event.preventDefault(); rotate(); } }} onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === 'r' && ready) { event.preventDefault(); rotate(); }
    if (event.key.toLowerCase() === 'h') { event.preventDefault(); setHints(old => !old); }
  }}>
    <MapViewport width={view.width} height={view.height} cells={view.cells} colors={colors} wallColor={visual.wallColor} background={visual.background} grid={visual.grid} focusCells={ownCells} lastCells={view.lastMove ? [...view.lastMove.indices, ...view.lastMove.captured] : []} toolbar={hud} onCellHover={(x, y) => { if (ready && !touchRef.current) setGhost({ x, y }); }} onCellClick={(x, y) => { if (!ready) return; setGhost({ x, y }); setError(''); if (!touchRef.current) place({ x, y }); }}>
      <BaseLabels bases={view.bases} width={view.width} colors={colors} />
      {hintPath && <path className="jinchi-hints" d={hintPath} fill="none" stroke="#b4fbd2" strokeWidth=".19" strokeLinecap="round" pointerEvents="none" />}
      <LastMove view={view} visual={visual} round={match.round} />
      {ghost && ready && <g className={`jinchi-ghost${ghostError ? ' is-invalid' : ''}`} pointerEvents="none"><rect x={ghost.x + .04} y={ghost.y + .04} width={Math.max(0, diceW - .08)} height={Math.max(0, diceH - .08)} rx=".1" fill={ghostError ? '#f27474' : '#89f2b6'} fillOpacity=".48" stroke={ghostError ? '#f74949' : '#effff1'} strokeWidth=".1" strokeDasharray={ghostError ? '.22 .1' : undefined} /><text x={ghost.x + diceW / 2} y={ghost.y + diceH / 2} dominantBaseline="central" textAnchor="middle" fontSize={Math.min(.8, diceW / 2)} fontWeight="800" fill="#143a31">{diceW}×{diceH}</text></g>}
    </MapViewport>
    <p className="jinchi-board-help">Тяните карту для перемещения. Колесо или щипок — масштаб. <span>R — поворот · H — подсказки · F — полный экран</span></p>
  </section>;
}

export function JinchiSeatIcon({ config, seat, size = 28 }: SeatIconProps): ReactElement {
  const visual = config.visual as JinchiVisual;
  const color = visual.colors?.[seat] ?? DEFAULT_COLORS[seat];
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={color} /><path d="M9 22V10m0 1h13l-3 4 3 4H9" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
