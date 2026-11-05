import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jinchi, DEFAULT_COLORS } from '../index';
import { MapViewport } from './MapViewport';
import { floodMap, historyStep, paintMap, resizeMap, strokePoints, type EditorHistory, type MapData, type Symmetry } from './editor-model';

type Tool = 'brush' | 'rectangle' | 'fill' | 'pan';
interface Props { value: MapData; onChange: (map: MapData) => void }

export function MapEditor({ value, onChange }: Props) {
  const map = useMemo(() => resizeMap({ ...value, rows: Array.isArray(value.rows) ? value.rows : [] }, value.width, value.height), [value]);
  const [tool, setTool] = useState<Tool>('brush');
  const [material, setMaterial] = useState('#');
  const [symmetry, setSymmetry] = useState<Symmetry>('off');
  const [history, setHistory] = useState<EditorHistory>({ past: [], present: map, future: [] });
  const historyRef = useRef(history);
  const live = useRef(map);
  const gesture = useRef<{ start: [number, number]; last: [number, number]; before: MapData } | null>(null);
  const emitted = useRef(value);
  const [rectangle, setRectangle] = useState<[number, number, number, number] | null>(null);
  const [size, setSize] = useState({ width: map.width, height: map.height });
  const root = useRef<HTMLDivElement>(null);
  live.current = map;
  historyRef.current = history;

  useEffect(() => {
    if (value !== emitted.current) {
      setHistory({ past: [], present: map, future: [] });
      gesture.current = null;
      setRectangle(null);
    }
    setSize({ width: map.width, height: map.height });
  }, [value, map]);

  const emit = useCallback((next: MapData) => {
    live.current = next;
    emitted.current = next;
    onChange(next);
  }, [onChange]);
  const commit = useCallback((next: MapData, before = live.current) => {
    const h = historyStep({ ...historyRef.current, present: before }, { type: 'commit', map: next });
    historyRef.current = h;
    setHistory(h);
    emit(next);
  }, [emit]);
  const navigateHistory = useCallback((type: 'undo' | 'redo') => {
    gesture.current = null;
    setRectangle(null);
    const h = historyStep(historyRef.current, { type });
    historyRef.current = h;
    setHistory(h);
    emit(h.present);
  }, [emit]);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input,textarea,select')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        navigateHistory(event.shiftKey ? 'redo' : 'undo');
      }
    };
    node.addEventListener('keydown', keyboard);
    return () => node.removeEventListener('keydown', keyboard);
  }, [navigateHistory]);

  const start = (x: number, y: number) => {
    if (tool === 'fill') { commit(floodMap(live.current, x, y, material, symmetry)); return; }
    if (tool === 'pan') return;
    gesture.current = { start: [x, y], last: [x, y], before: live.current };
    if (tool === 'brush') emit(paintMap(live.current, [[x, y]], material, symmetry));
    else setRectangle([x, y, x, y]);
  };
  const move = (x: number, y: number) => {
    const g = gesture.current;
    if (!g) return;
    if (tool === 'brush') emit(paintMap(live.current, strokePoints(...g.last, x, y), material, symmetry));
    else setRectangle([...g.start, x, y]);
    g.last = [x, y];
  };
  const end = (x: number, y: number) => {
    const g = gesture.current;
    if (!g) return;
    let next = live.current;
    if (tool === 'rectangle') {
      const points: [number, number][] = [];
      for (let ry = Math.min(y, g.start[1]); ry <= Math.max(y, g.start[1]); ry++) {
        for (let rx = Math.min(x, g.start[0]); rx <= Math.max(x, g.start[0]); rx++) points.push([rx, ry]);
      }
      next = paintMap(g.before, points, material, symmetry);
    }
    commit(next, g.before);
    gesture.current = null;
    setRectangle(null);
  };
  const cancel = () => {
    if (gesture.current) emit(gesture.current.before);
    gesture.current = null;
    setRectangle(null);
  };

  const stats = useMemo(() => {
    const counts = Array(8).fill(0) as number[];
    let walls = 0;
    for (const row of map.rows) for (const c of row) {
      if (c === '#') walls++;
      if (/^[1-8]$/.test(c)) counts[Number(c) - 1]++;
    }
    return { walls, counts, area: map.width * map.height - walls };
  }, [map]);
  const issues = useMemo(() => {
    const parsed = jinchi.rulesSchema.safeParse({ map });
    return parsed.success ? jinchi.checkRules?.(parsed.data) ?? [] : [{ code: 'map', message: 'Проверьте размеры и строки карты', severity: 'error' }];
  }, [map]);
  const cells = useMemo(() => map.rows.flatMap(row => [...row].map(c => c === '#' ? -2 : c === '.' ? -1 : Number(c) - 1)), [map]);
  const zoneCells = useMemo(() => cells.flatMap((c, i) => c === Number(material) - 1 ? [i] : []), [cells, material]);
  const drawing = tool !== 'pan';

  const tools = <div className="jn-editor-tools" role="group" aria-label="Инструмент рисования">
    {([['brush', '✎', 'Кисть'], ['rectangle', '▧', 'Прямоугольник'], ['fill', '▨', 'Заливка'], ['pan', '✥', 'Навигация']] as const).map(([id, icon, text]) =>
      <button key={id} type="button" aria-pressed={tool === id} className={tool === id ? 'is-selected' : ''} onClick={() => setTool(id)}><span aria-hidden="true">{icon}</span> {text}</button>)}
    <span className="jn-tool-divider" />
    <button type="button" aria-label="Отменить рисование" title="Отменить · Ctrl+Z" disabled={!history.past.length} onClick={() => navigateHistory('undo')}>↶</button>
    <button type="button" aria-label="Повторить рисование" title="Повторить · Ctrl+Shift+Z" disabled={!history.future.length} onClick={() => navigateHistory('redo')}>↷</button>
  </div>;

  return <div className="jn-editor" ref={root}>
    <div className="jn-editor-heading"><div><span className="jn-eyebrow">КАРТОГРАФИЯ</span><h3>Ваша территория начинается здесь</h3></div><span className="jn-map-size">{map.width} × {map.height}</span></div>
    <p className="jn-editor-intro">Нарисуйте стены и базы. Карта будет одинаковой для всех игроков.</p>
    <div className="jn-editor-settings">
      <label>Ширина<input type="number" min={3} max={200} value={size.width} onChange={e => setSize({ ...size, width: Number(e.target.value) })} onBlur={() => commit(resizeMap(live.current, size.width, size.height))} /></label>
      <span aria-hidden="true">×</span>
      <label>Высота<input type="number" min={3} max={200} value={size.height} onChange={e => setSize({ ...size, height: Number(e.target.value) })} onBlur={() => commit(resizeMap(live.current, size.width, size.height))} /></label>
      <label className="jn-symmetry">Симметрия<select aria-label="Симметрия" value={symmetry} onChange={e => setSymmetry(e.target.value as Symmetry)}>
        <option value="off">Без отражения</option><option value="horizontal">Слева направо · 2 базы</option><option value="vertical">Сверху вниз · 2 базы</option><option value="quarters">Четыре четверти · 4 базы</option><option value="rotate">Поворот 180° · 2 базы</option>
      </select></label>
    </div>
    <div className="jn-palette" role="group" aria-label="Материал рисования">
      <button type="button" aria-pressed={material === '#'} className={material === '#' ? 'is-selected' : ''} onClick={() => setMaterial('#')}><i style={{ background: '#424853' }} />Стена</button>
      <button type="button" aria-pressed={material === '.'} className={material === '.' ? 'is-selected' : ''} onClick={() => setMaterial('.')}><i className="jn-eraser" />Ластик</button>
      <span className="jn-palette-label">Базы</span>
      {DEFAULT_COLORS.map((color, i) => <button key={color} type="button" aria-label={`Рисовать базу ${i + 1}`} title={`Стартовая зона ${i + 1}`} aria-pressed={material === String(i + 1)} className={`jn-base-button${material === String(i + 1) ? ' is-selected' : ''}`} onClick={() => setMaterial(String(i + 1))}><i style={{ background: color }}>{i + 1}</i></button>)}
    </div>
    <MapViewport width={map.width} height={map.height} cells={cells} colors={DEFAULT_COLORS} drawing={drawing} focusCells={zoneCells} toolbar={tools} onStrokeStart={start} onStrokeMove={move} onStrokeEnd={end} onStrokeCancel={cancel}>
      {rectangle && <rect x={Math.min(rectangle[0], rectangle[2])} y={Math.min(rectangle[1], rectangle[3])} width={Math.abs(rectangle[0] - rectangle[2]) + 1} height={Math.abs(rectangle[1] - rectangle[3]) + 1} fill={material === '#' ? '#424853' : DEFAULT_COLORS[Number(material) - 1] ?? '#ffffff'} opacity={0.5} stroke="#ffffff" strokeWidth={0.1} />}
    </MapViewport>
    <div className="jn-editor-footer"><span><b>{stats.area.toLocaleString('ru-RU')}</b> игровых клеток · {stats.walls} стен · {stats.counts.filter(Boolean).length} базы</span><button type="button" onClick={() => { if (window.confirm('Очистить карту? Все стены и базы будут удалены. Действие можно отменить.')) commit({ ...map, rows: Array(map.height).fill('.'.repeat(map.width)) }); }}>Очистить</button></div>
    <div className="jn-zone-legend">{stats.counts.map((count, i) => count ? <span key={i}><i style={{ background: DEFAULT_COLORS[i] }} />База {i + 1}<b>{count}</b></span> : null)}</div>
    <p className="jn-editor-help">{tool === 'pan' ? 'Тяните карту для перемещения. Колесо или щипок — масштаб.' : 'Рисуйте протягиванием. Для перемещения выберите «Навигация». Два пальца — масштаб.'} <span>F — полный экран · 0 — вся карта</span></p>
    {issues.length > 0 ? <ul className="jn-map-issues" aria-live="polite">{issues.map((issue, i) => <li key={`${issue.code}-${i}`} className={issue.severity === 'warning' ? 'is-warning' : 'is-error'}>{issue.message}</li>)}</ul> : <p className="jn-map-valid">✓ Карта готова к игре</p>}
  </div>;
}
