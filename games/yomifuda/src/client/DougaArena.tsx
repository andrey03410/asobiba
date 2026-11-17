import { lazy, Suspense, Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { YomifudaView, YomifudaVisual } from '../index';
import { buildArena } from './arena-plan';
class ArenaBoundary extends Component<{ children: ReactNode; retry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="yf-arena-error" role="alert">Не удалось показать стол.<button onClick={this.props.retry}>Повторить</button></div> : this.props.children; }
}
interface Props { view: YomifudaView; visual: YomifudaVisual; assetUrl: (id: string) => string; names?: string[]; clockOffset?: number }
function Player({ view, visual, assetUrl, names, clockOffset = 0 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const InteractivePlayer = useMemo(() => lazy(() => import('@douga/player/InteractivePlayer').then(m => ({ default: m.InteractivePlayer }))), [attempt]);
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width / Math.max(1, entry.contentRect.height) > 1.5));
    observer.observe(box.current); return () => observer.disconnect();
  }, []);
  const compiled = useMemo(() => buildArena(view, visual, assetUrl, names, wide), [view, visual, assetUrl, names, wide]);
  const now = useCallback(() => Date.now() + clockOffset, [clockOffset]);
  useEffect(() => setError(false), [view.round, view.phase]);
  return <div ref={box} className="yf-arena-player" aria-hidden={!error && compiled.ready}>
    {error || !compiled.ready ? <div role="alert" className="yf-arena-error">Не удалось показать стол.<button onClick={() => { setError(false); setAttempt(n => n + 1); }}>Повторить</button></div>
      : <Suspense fallback={<div className="yf-arena-error">Загружаем стол…</div>}><InteractivePlayer key={`${view.round}:${view.phase}:${attempt}`} plan={compiled.plan} startedAt={view.revealStartedAt ?? view.choiceStartedAt} now={now} muted
        holdFrame={view.phase === 'choose' ? 0 : null} onEvent={event => { if (event.type === 'error') setError(true); }} /></Suspense>}
  </div>;
}
export function DougaArena(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <ArenaBoundary key={`${props.view.round}:${attempt}`} retry={() => setAttempt(n => n + 1)}><Player {...props} /></ArenaBoundary>;
}
