import type { BoardProps, SeatIconProps } from '@asobiba/sdk';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { findPlacements, placementError } from '../game';
import type { JinchiView } from '../game';
import { diceSides, rulesText } from '../rules';
import { DEFAULT_COLORS } from '../visual';
import type { JinchiVisual } from '../visual';
import { MapArtwork, MapViewport, ObjectsArtwork, OBJECT_LABELS, consumeTurnCue } from './MapViewport';

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
  const drawn = move.indices.slice(0, 1000);
  const captured = move.captured.slice(0, 1500);
  const centerIndex = drawn[Math.floor(drawn.length / 2)] ?? captured[0] ?? 0;
  const centerX = centerIndex % view.width, centerY = Math.floor(centerIndex / view.width);
  const buckets = Array.from({ length: 8 }, () => [] as number[]);
  let maxDistance = 1;
  for (const index of captured) maxDistance = Math.max(maxDistance, Math.hypot(index % view.width - centerX, Math.floor(index / view.width) - centerY));
  for (const index of captured) {
    const distance = Math.hypot(index % view.width - centerX, Math.floor(index / view.width) - centerY);
    buckets[Math.min(7, Math.floor(distance / maxDistance * 7))].push(index);
  }
  return <g key={`${round}-${move.turn}`} pointerEvents="none" style={{ '--jinchi-duration': `${duration}ms` } as Vars}>
    <path className={visual.animations.place === 'pop' ? 'jinchi-last-place has-pop' : 'jinchi-last-place'} d={indicesPath(drawn, view.width)} fill="none" stroke="#fff6c8" strokeWidth=".09" strokeLinejoin="round" />
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
      <ObjectsArtwork objects={[...(view.flags ?? []).map(p => ({ ...p, kind: "flag" })), ...(view.effects ?? [])]} box={{ x: 0, y: 0, width: view.width, height: view.height }} pixels={1400} />
    </MapArtwork>
  </svg>;
  return <InteractiveBoard {...props} />;
}

type ScoreMode = 'compact' | 'hidden';
export function readScoreMode(storage?: Pick<Storage, 'getItem'>): ScoreMode {
  try { return (storage ?? localStorage).getItem('jinchi.score') === 'hidden' ? 'hidden' : 'compact'; } catch { return 'compact'; }
}
export function writeScoreMode(mode: ScoreMode, storage?: Pick<Storage, 'setItem'>): void {
  try { (storage ?? localStorage).setItem('jinchi.score', mode); } catch { /* Local state still applies when storage is disabled. */ }
}
function remember(key: string, value: string): void { try { localStorage.setItem(`jinchi.${key}`, value); } catch { /* Preferences also work without storage. */ } }

function Countdown({ match, config, clockOffset, supplied }: { match: Props['match']; config: Props['config']; clockOffset: number; supplied?: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (supplied !== undefined || match.turnDeadline === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [supplied, match.turnDeadline]);
  const remaining = supplied !== undefined ? supplied : match.turnDeadline === null ? null : Math.max(0, Math.min((config.timer?.turnSeconds || Infinity) * 1000, match.turnDeadline - now - clockOffset));
  if (remaining === null || match.phase !== 'playing') return null;
  return <output className={`jinchi-timer${remaining <= 10_000 ? ' is-urgent' : ''}`} aria-label={remaining <= 10_000 ? 'Осталось менее десяти секунд' : 'Осталось времени на ход'}>{Math.ceil(remaining / 1000)} с</output>;
}

function Panel({ title, close, children }: { title: string; close(): void; children: ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const buttons = [...ref.current!.querySelectorAll<HTMLElement>('button,a,input,select,textarea,[tabindex="0"]')];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus({ preventScroll: true }); };
  }, [close]);
  return <div className="jinchi-panel-backdrop" onPointerDown={event => event.stopPropagation()} onClick={close}><div ref={ref} className="jinchi-panel" role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><header><h3>{title}</h3><button type="button" onClick={close} aria-label="Закрыть">✕</button></header>{children}</div></div>;
}

function InteractiveBoard({ match, config, seat, onAction, playerNames, turnRemainingMs, clockOffset = 0, stage, fullscreen, connected = true }: Props): ReactElement {
  const view = match.game as JinchiView;
  const visual = config.visual as JinchiVisual;
  const colors = visual.colors ?? DEFAULT_COLORS;
  const name = (index: number) => playerNames?.[index] || `Игрок ${index + 1}`;
  const [ghost, setGhost] = useState<Cell | null>(null);
  const [rotated, setRotated] = useState(false);
  const [hints, setHints] = useState(true);
  const [error, setError] = useState('');
  const [scoreMode, setScoreMode] = useState<ScoreMode>(() => readScoreMode());
  const [panel, setPanel] = useState<'scores' | 'rules' | 'events' | null>(null);
  const closePanel = useMemo(() => () => setPanel(null), []);
  const [sound, setSound] = useState(() => { try { return localStorage.getItem('jinchi.sound') === 'on'; } catch { return false; } });
  const audioRef = useRef<AudioContext | null>(null);
  const enableAudio = () => { if (sound) { try { audioRef.current ??= new AudioContext(); void audioRef.current.resume().catch(() => {}); } catch { /* The visual cue is always available. */ } } };
  useEffect(() => () => { void audioRef.current?.close().catch(() => {}); }, []);
  const [cue, setCue] = useState(false);
  const seenTurns = useRef(new Set<string>());
  const touchRef = useRef(false);
  const [pending, setPending] = useState(false);
  const pendingTurn = useRef<string | null>(null);
  const turnKey = `${match.round}:${view.turn}:${view.currentSeat}:${view.dice?.join(':') ?? 'roll'}:${view.rerolled ?? false}`;
  const canAct = connected && match.phase === 'playing' && seat !== null && view.canAct && view.currentSeat === seat;
  const ready = canAct && view.dice !== null;
  const canRotate = ready && view.canRotate !== false && !view.turnRotationLocked;
  const actualRotated = canRotate && rotated;
  const dice = diceSides(view.rules);
  const diceW = view.dice?.[actualRotated ? 1 : 0] ?? 0;
  const diceH = view.dice?.[actualRotated ? 0 : 1] ?? 0;
  useEffect(() => {
    pendingTurn.current = null; setPending(false); setError(''); setGhost(null);
  }, [turnKey]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => { pendingTurn.current = null; setPending(false); }, 3500);
    return () => window.clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (!canAct || seat === null) { setCue(false); return; }
    let timer: number | undefined;
    const signal = () => {
      if (!consumeTurnCue(seenTurns.current, match.round, view.turn, seat, document.visibilityState !== 'hidden')) return;
      setCue(true);
      timer = window.setTimeout(() => setCue(false), 2500);
      if (sound && audioRef.current?.state === 'running') {
        const context = audioRef.current, oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.frequency.value = 660; gain.gain.setValueAtTime(.08, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .17);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .18);
      }
    };
    signal(); document.addEventListener('visibilitychange', signal);
    return () => { document.removeEventListener('visibilitychange', signal); if (timer) window.clearTimeout(timer); setCue(false); };
  }, [canAct, match.round, view.turn, seat, sound]);
  const ownCells = useMemo(() => {
    if (seat === null) return [];
    let min = -1, max = -1, left = -1, right = -1;
    for (let i = 0; i < view.cells.length; i++) if (view.cells[i] === seat) {
      if (min < 0) min = i; max = i;
      if (left < 0 || i % view.width < left % view.width) left = i;
      if (right < 0 || i % view.width > right % view.width) right = i;
    }
    return min < 0 ? [] : [min, max, left, right];
  }, [seat, view.cells, view.width]);
  const hintPath = useMemo(() => {
    if (!ready || !hints || seat === null || view.impossibleRoll) return '';
    return findPlacements(view, seat, actualRotated, 700).filter(action => action.type === 'place').map(action => `M${action.x + .5} ${action.y + .5}h.001`).join('');
  }, [view, seat, ready, hints, actualRotated]);
  const objects = useMemo(() => [...(view.flags ?? []).map(position => ({ ...position, kind: 'flag' })), ...(view.effects ?? [])], [view.flags, view.effects]);
  const lastCells = useMemo(() => view.lastMove ? [...view.lastMove.indices.slice(0, 1000), ...view.lastMove.captured.slice(0, 1500)] : [], [view.lastMove]);
  const ghostError = ghost && ready && seat !== null ? placementError(view, seat, ghost.x, ghost.y, actualRotated) : null;
  const dispatch = (action: unknown) => {
    if (!canAct || pendingTurn.current === turnKey || !onAction) return;
    pendingTurn.current = turnKey; setPending(true); setError(''); onAction(action);
  };
  const place = (position: Cell | null) => {
    if (!ready || seat === null || !position) return;
    const reason = placementError(view, seat, position.x, position.y, actualRotated);
    if (reason) { setError(reason); return; }
    dispatch({ type: 'place', ...position, rotated: actualRotated });
  };
  const rotate = () => { if (canRotate && !pending) { setRotated(old => !old); setError(''); } };
  const status = match.phase === 'finished' || view.result ? 'Территории поделены' : canAct ? 'Ваш ход' : `Ходит ${name(view.currentSeat)}`;
  const currentColor = colors[view.currentSeat] ?? colors[0];
  const finished = match.phase === 'finished';
  const [resultHidden, setResultHidden] = useState(false);
  useEffect(() => { if (!finished) setResultHidden(false); }, [finished]);
  const points = view.points ?? view.scores;
  const primary = view.rules.flags?.mode === 'primary';
  const scoreTable = <div className="jinchi-score-table-wrap"><table className="jinchi-score-table"><thead><tr><th>Игрок</th><th>Клетки</th><th>Флаги</th><th>Эффекты</th><th>Перебросы</th><th>Поворот</th><th>Очки</th></tr></thead><tbody>{view.scores.map((score, i) => <tr key={i}><th><i style={{ background: colors[i] }} />{name(i)}{view.eliminated[i] ? ' · выбыл' : ''}</th><td>{score.toLocaleString('ru-RU')}</td><td>{view.flagCounts?.[i] ?? 0}{view.rules.flags?.mode === 'bonus' ? ` × ${view.rules.flags.value}` : ''}</td><td>{view.effectPoints?.[i] ?? 0}</td><td>{view.rerollCharges?.[i] ?? 0} / 3</td><td>{i === view.currentSeat && view.turnRotationLocked ? 'Запрещён до конца хода' : view.rotationLocked?.[i] ? 'Запрещён в следующем ходу' : 'Доступен'}</td><td><b>{points[i].toLocaleString('ru-RU')}</b></td></tr>)}</tbody></table><p>{primary ? 'Победитель: сначала флаги, при равенстве — очки.' : 'Очки = клетки + бонусы флагов + эффекты.'}</p></div>;
  const toolButtons = <><button type="button" aria-pressed={hints} onClick={() => setHints(old => !old)} title="Подсказки (H)" aria-label="Подсказки">✦</button><button type="button" onClick={() => setPanel('rules')} title="Правила и легенда" aria-label="Правила и легенда">?</button><button type="button" onClick={() => setPanel('events')} title="События" aria-label="События">☷</button></>;
  const hud = <div className={`jinchi-hud${scoreMode === 'hidden' ? ' is-score-hidden' : ''}`}>
    <div className="jinchi-score-toolbar"><button type="button" className="jinchi-score-open" onClick={() => setPanel('scores')} title="Подробный счёт">Счёт</button>{scoreMode === 'compact' && <><div className="jinchi-score-strip" aria-label="Счёт игроков">{view.scores.map((score, index) => <button key={index} type="button" title={`${name(index)}: ${points[index]} очков, ${score} клеток, ${(view.area ? score / view.area * 100 : 0).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}% карты`} className={`jinchi-score-chip${view.currentSeat === index ? ' is-current' : ''}${view.eliminated[index] ? ' is-eliminated' : ''}`} style={{ '--seat-color': colors[index] } as Vars} onClick={() => setPanel('scores')}><i>{index + 1}</i><span>{name(index)}</span><b>{primary ? `⚑ ${view.flagCounts?.[index] ?? 0}` : points[index].toLocaleString('ru-RU')}</b>{primary && <small>{points[index]}</small>}</button>)}</div><button type="button" onClick={() => { setScoreMode('hidden'); writeScoreMode('hidden'); }} aria-label="Скрыть счёт" title="Скрыть счёт">−</button></>}</div>
    <div className={`jinchi-turnbar${cue ? ' has-cue' : ''}`} style={{ '--seat-color': currentColor } as Vars}>
      <div className="jinchi-turn-status"><i aria-hidden="true">{canAct ? '▶' : '◷'}</i><strong>{status}</strong>{seat === null && <small>Наблюдение</small>}<small>Круг {view.cycle}</small><Countdown match={match} config={config} clockOffset={clockOffset} supplied={turnRemainingMs} /></div>
      <div className="jinchi-turn-actions"><div className="jinchi-dice-pair"><Die value={view.dice?.[0] ?? null} sides={dice[0]} color={currentColor} /><span aria-hidden="true">×</span><Die value={view.dice?.[1] ?? null} sides={dice[1]} color={currentColor} /><span className="jinchi-dice-size">{view.dice ? `${diceW} × ${diceH}` : `d${dice[0]} + d${dice[1]}`}</span></div>
      {canAct && !view.dice && <button type="button" className="jinchi-primary" data-action="roll" onClick={() => dispatch({ type: 'roll' })} disabled={pending}>Бросить кубики</button>}
      {ready && <div className="jinchi-placement-actions"><button type="button" onClick={rotate} disabled={pending || !canRotate} title={canRotate ? 'Повернуть (R или правая кнопка)' : 'Поворот недоступен до конца этого хода'} aria-label={canRotate ? 'Повернуть' : 'Поворот недоступен'}>↻<span>Повернуть</span></button><button type="button" className="jinchi-primary" data-action="place" disabled={!ghost || ghostError !== null || pending || view.impossibleRoll} onClick={() => place(ghost)}>Поставить</button></div>}
      {canAct && view.canReroll && <button type="button" disabled={pending} onClick={() => dispatch({ type: 'reroll' })}>Перебросить ({view.rerollCharges?.[seat!] ?? 0})</button>}
      {canAct && view.canSkip && <button type="button" disabled={pending} onClick={() => dispatch({ type: 'skip-impossible' })}>Пропустить невозможный бросок</button>}
      <div className="jinchi-tools">{toolButtons}</div><details className="jinchi-more-tools"><summary aria-label="Ещё">⋯</summary><div>{toolButtons}</div></details></div>
      <div className="jinchi-placement-message" role="status">{pending ? 'Ход отправлен…' : !connected ? 'Нет связи…' : error || (view.impossibleRoll ? 'Фигура не помещается. Перебросьте или пропустите.' : view.turnRotationLocked ? 'Поворот недоступен до конца хода' : ready && ghost ? ghostError || '' : '')}</div>
    </div>
  </div>;
  return <section className={`jinchi-board${stage ? ' is-stage' : ''}`} onPointerDownCapture={event => { touchRef.current = event.pointerType === 'touch'; enableAudio(); }} onContextMenu={event => { if ((event.target as Element).closest('.jinchi-map') && ready) { event.preventDefault(); rotate(); } }} onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey || panel) return;
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); rotate(); }
    if (event.key.toLowerCase() === 'h') { event.preventDefault(); setHints(old => !old); }
  }}>
    <MapViewport width={view.width} height={view.height} cells={view.cells} colors={colors} wallColor={visual.wallColor} background={visual.background} grid={visual.grid} focusCells={ownCells} lastCells={lastCells} toolbar={hud} fill={Boolean(stage)} externalFullscreen={fullscreen} objects={objects} minimumPickSize={12} onTooSmall={() => setError('Область приближена. Выберите клетку ещё раз.')} onCellHover={(x, y) => { if (ready && !touchRef.current) setGhost({ x, y }); }} onCellClick={(x, y) => { if (!ready) return; setGhost({ x, y }); setError(''); if (!touchRef.current) place({ x, y }); }}>
      <BaseLabels bases={view.bases} width={view.width} colors={colors} />
      {hintPath && <path className="jinchi-hints" d={hintPath} fill="none" stroke="#b4fbd2" strokeWidth=".19" strokeLinecap="round" pointerEvents="none" />}
      <LastMove view={view} visual={visual} round={match.round} />
      {ghost && ready && <g className={`jinchi-ghost${ghostError ? ' is-invalid' : ''}`} pointerEvents="none"><rect x={ghost.x + .04} y={ghost.y + .04} width={Math.max(0, diceW - .08)} height={Math.max(0, diceH - .08)} rx=".1" fill={ghostError ? '#f27474' : '#89f2b6'} fillOpacity=".48" stroke={ghostError ? '#f74949' : '#effff1'} strokeWidth=".1" /><text x={ghost.x + diceW / 2} y={ghost.y + diceH / 2} dominantBaseline="central" textAnchor="middle" fontSize={Math.min(.8, diceW / 2)} fontWeight="800" fill="#143a31">{diceW}×{diceH}</text></g>}
    </MapViewport>
    {cue && <div className="jinchi-turn-cue" role="status">▶ Ваш ход</div>}
    {(panel || (finished && !stage && !resultHidden)) && <Panel title={panel === 'rules' ? 'Правила и легенда' : panel === 'events' ? 'События' : finished ? 'Итоговый счёт' : 'Подробный счёт'} close={() => { closePanel(); if (finished) setResultHidden(true); }}>
      {panel === 'rules' ? <div><ul>{rulesText(view.rules).map((text, i) => <li key={i}>{text}</li>)}</ul><ul>{Object.entries(OBJECT_LABELS).filter(([key]) => key !== 'mixed').map(([key, text]) => <li key={key}>{text}</li>)}</ul><p>R — поворот · H — подсказки · F — полный экран · M — к себе · G — к флагу · L — последний ход · 0 — вся карта.</p></div> : panel === 'events' ? <ol className="jinchi-event-list">{[...view.events].reverse().slice(0, 100).map(event => <li key={event.id}><b>{name(event.seat)}</b>: {event.text}</li>)}</ol> : <div>{scoreTable}{!finished && <div className="jinchi-score-preferences"><button type="button" onClick={() => { setScoreMode(scoreMode === 'hidden' ? 'compact' : 'hidden'); writeScoreMode(scoreMode === 'hidden' ? 'compact' : 'hidden'); }}>{scoreMode === 'hidden' ? 'Показать компактный счёт' : 'Скрыть компактный счёт'}</button><button type="button" aria-pressed={sound} onClick={() => { const enabled = !sound; setSound(enabled); remember('sound', enabled ? 'on' : 'off'); if (enabled) { try { audioRef.current ??= new AudioContext(); void audioRef.current.resume().catch(() => {}); } catch { /* Visual cue remains sufficient. */ } } }}>Звук: {sound ? 'включён' : 'выключен'}</button></div>}{finished && <button type="button" onClick={() => { setResultHidden(true); closePanel(); }}>Посмотреть карту</button>}</div>}
    </Panel>}
  </section>;
}

export function JinchiSeatIcon({ config, seat, size = 28 }: SeatIconProps): ReactElement {
  const visual = config.visual as JinchiVisual;
  const color = visual.colors?.[seat] ?? DEFAULT_COLORS[seat];
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="8" fill={color} /><path d="M9 22V10m0 1h13l-3 4 3 4H9" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
