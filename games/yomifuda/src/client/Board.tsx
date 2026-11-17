import type { BoardProps, SeatIconProps } from '@asobiba/sdk';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { visualSchema, type YomifudaView } from '../index';
import { displayedScores, palette, revealProgress } from './arena-plan';
import { DougaArena } from './DougaArena';
import { CardInspection } from './CardInspection';
import { StaticBoard } from './StaticBoard';
const number = (value: number) => value.toLocaleString('ru-RU');
export function YomifudaSeatIcon({ size = 28, seat }: SeatIconProps) { return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: '#36324d', color: '#e8dbff', display: 'inline-grid', placeItems: 'center', fontSize: size * .5 }}>{seat + 1}</span>; }
export function YomifudaBoard(props: BoardProps) { return props.staticRender ? <StaticBoard {...props} /> : <LiveBoard {...props} />; }
function LiveBoard({ match, config, seat, assetUrl, onAction, playerNames, clockOffset = 0, stage, fullscreen, connected = true, onHold }: BoardProps) {
  const view = match.game as YomifudaView;
  const attributes = (config.rules as { attributes?: { id: string; label: string }[] }).attributes ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [cardInspection, setCardInspection] = useState(false);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  const [reduced, setReduced] = useState(false);
  const [inspect, setInspect] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  const visual = useMemo(() => { const parsed = visualSchema.parse(config.visual ?? {}); return { ...parsed, reducedMotion: parsed.reducedMotion || reduced }; }, [config.visual, reduced]);
  const colors = palette(visual.theme);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now() + clockOffset), 100); return () => window.clearInterval(timer); }, [clockOffset]);
  useEffect(() => { setSelected(null); setPending(false); setInspect(false); setCardInspection(false); }, [view.round, seat]);
  useEffect(() => { setPending(false); if (!view.canPlay) { setSelected(null); setCardInspection(false); } }, [view.canPlay, view.canReady, connected]);
  useEffect(() => { if (!pending) return; const timer = window.setTimeout(() => setPending(false), 2500); return () => window.clearTimeout(timer); }, [pending]);
  const progress = revealProgress(view, now);
  const hold = view.phase === 'reveal' && progress < .66;
  useEffect(() => { onHold?.(hold); return () => onHold?.(false); }, [hold, onHold]);
  const scores = displayedScores(view, now);
  const chosen = view.hand.find(card => card.id === selected);
  const own = view.players.find(player => player.seat === seat);
  const ready = view.phase === 'review' && view.canReady && now >= (view.revealEndsAt ?? 0);
  const actionable = connected && Boolean(onAction) && !pending;
  const send = (action: unknown) => { setPending(true); onAction?.(action); };
  const remaining = view.phase === 'reveal' ? Math.max(0, Math.ceil(((view.revealEndsAt ?? now) - now) / 1000)) : null;
  const hint = !connected ? 'Связь прервана — переподключаемся…' : view.phase === 'finished' ? 'Колода разыграна' : view.phase === 'reveal' ? `Раскрываем карты · ${remaining} с` : view.phase === 'review' ? own?.ready ? 'Вы готовы. Ждём остальных' : seat === null ? 'Игроки обсуждают бой' : 'Обсудите бой и продолжайте' : seat === null ? 'Игроки выбирают карты' : own?.played ? 'Карта на столе. Ждём остальных' : 'Выберите персонажа по этому показателю';
  return <section className={`yf-board${stage ? ' yf-stage' : ''}${view.players.length > 3 ? ' yf-many' : ''}`} style={{ '--yf-bg': colors.bg, '--yf-card': colors.card, '--yf-ink': colors.ink, '--yf-muted': colors.muted, '--yf-line': colors.line, '--yf-accent': visual.accent } as CSSProperties} aria-label="Стол Ёмифуды">
    <header className="yf-heading"><div><span className="yf-eyebrow">ЁМИФУДА <span>Бой {view.round} / {view.totalRounds}</span></span><h2 title={view.attribute.description}>{view.attribute.label}</h2></div>{!stage && fullscreen?.available && <button className="yf-fullscreen" onClick={fullscreen.toggle} aria-label={fullscreen.active ? 'Выйти из полноэкранного режима' : 'На весь экран'}>⛶</button>}</header>
    <div className="yf-players" aria-label="Игроки и счёт">{view.players.map((p, i) => <div key={p.seat} className={`yf-player${p.seat === seat ? ' yf-self' : ''}`}><span className="yf-seat">{p.seat + 1}</span><div><span className="yf-player-name" title={playerNames?.[p.seat]}>{playerNames?.[p.seat] || `Игрок ${p.seat + 1}`}{p.seat === seat ? ' · вы' : ''}</span><span className="yf-player-status">{view.phase === 'choose' ? p.played ? 'На столе' : 'Выбирает' : p.ready ? 'Готов' : `${p.handCount} в руке`}</span></div><strong>{number(scores[i])}</strong></div>)}</div>
    <div className="yf-table"><DougaArena view={view} visual={visual} assetUrl={assetUrl} names={playerNames} clockOffset={clockOffset} />
      <div className="yf-sr" aria-live="polite">{view.phase === 'choose' ? `${view.players.filter(p => p.played).length} из ${view.players.length} карт на столе` : progress >= .66 ? view.table.map(t => t.hidden ? '' : `${playerNames?.[t.seat] || `Игрок ${t.seat + 1}`}: ${t.card.name}, ${t.value}${t.tieTotal !== undefined ? `, сумма ${t.tieTotal}` : ''}${t.winner ? `, +${t.points}` : ''}`).join('. ') : 'Карты раскрываются'}</div>
    </div>
    <div className="yf-status"><span role="status">{hint}</span><span className="yf-stock">В колоде {view.stockCount}</span></div>
    {view.phase === 'reveal' && <div className="yf-progress" role="progressbar" aria-label="Раскрытие карт" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div>}
    <footer className="yf-hand-zone">
      {view.phase === 'finished' ? <>
        <div className="yf-finish"><strong>{view.result?.draw ? 'Победа поровну' : 'Победа!'} {view.result?.winners.map(s => playerNames?.[s] || `Игрок ${s + 1}`).join(', ')}</strong><button onClick={() => setInspect(!inspect)} aria-expanded={inspect}>{inspect ? 'Закрыть колоду' : 'Разбор колоды'}</button></div>
        {inspect && <div className="yf-deck-review" tabIndex={0}>{view.finalDeck?.map(card => <div key={card.id}><strong>{card.name}</strong><span>{card.anime}</span><span>{Object.entries(card.values).map(([id, v]) => `${attributes.find(a => a.id === id)?.label ?? id}: ${v}`).join(' · ')}</span></div>)}</div>}
      </> : <>
        {seat !== null && view.hand.length > 0 && <div className="yf-hand" aria-label="Ваши карты">{view.hand.map(card => <button key={card.id} className={`yf-hand-card${selected === card.id ? ' yf-selected' : ''}`} aria-pressed={selected === card.id} aria-haspopup="dialog" onClick={() => { setSelected(card.id); setCardInspection(true); }} aria-label={`${card.name}. ${card.anime}${card.version ? `. ${card.version}` : ''}`}>
          <span className="yf-hand-art">{card.image ? <img src={assetUrl(card.image.asset)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : null}<span aria-hidden="true">{card.name.slice(0, 1)}</span></span><span className="yf-hand-name">{card.name}</span><span className="yf-hand-anime">{card.anime}</span>
        </button>)}</div>}
        {chosen && <p className="yf-selection" title={`${chosen.name} · ${chosen.anime}${chosen.version ? ` · ${chosen.version}` : ''}`}>{chosen.name}{chosen.version ? ` · ${chosen.version}` : ''}</p>}
        {seat !== null && <button className="yf-confirm" disabled={!actionable || (view.phase === 'choose' ? !view.canPlay || !chosen : !ready)} onClick={() => { if (view.phase === 'choose' && chosen) send({ type: 'play', round: view.round, cardId: chosen.id }); else if (ready) send({ type: 'ready', round: view.round }); }}>
          {pending ? 'Отправляем…' : view.phase === 'choose' ? own?.played ? 'Карта поставлена' : chosen ? 'Подтвердить выбор' : 'Выберите карту' : view.phase === 'reveal' ? `Смотрим раскрытие · ${remaining} с` : own?.ready ? 'Вы готовы' : view.round === view.totalRounds ? 'К итогам партии' : 'Готов к следующему бою'}
        </button>}
        {view.phase === 'choose' && view.choiceEndsAt !== null && now >= view.choiceEndsAt && !own?.played && seat !== null && <span className="yf-reminder">Вас ждут — выберите карту, когда будете готовы.</span>}
      </>}
    </footer>
    {cardInspection && chosen && <CardInspection card={chosen} assetUrl={assetUrl} canConfirm={actionable && view.canPlay}
      onClose={() => setCardInspection(false)} onConfirm={() => {
        if (actionable && view.canPlay) { setCardInspection(false); send({ type: 'play', round: view.round, cardId: chosen.id }); }
      }} />}
  </section>;
}
