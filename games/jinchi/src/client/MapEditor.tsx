import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { jinchi, DEFAULT_COLORS } from '../index';
import type { JinchiRules } from '../rules';
import { MapViewport } from './MapViewport';
import { floodMap, historyStep, paintMap, paintObject, resizeLosses, resizeMap, strokePoints, type EditorEffect, type EditorHistory, type MapData, type Symmetry } from './editor-model';

type Tool = 'brush' | 'rectangle' | 'fill' | 'pan';
interface Props { value: MapData; onChange: (map: MapData) => void; rules?: JinchiRules; onRulesChange?: (rules: JinchiRules) => void; generator?: ReactNode }

export function MapEditor({ value, onChange, rules, onRulesChange, generator }: Props) {
  const map = useMemo(() => ({ ...resizeMap({ ...value, rows: Array.isArray(value.rows) ? value.rows : [] }, value.width, value.height), ...(rules ? { objects: { flags: rules.flags?.positions ?? [], effects: rules.effects?.cells ?? [] } } : {}) }), [value, rules]);
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
  const [resizePending, setResizePending] = useState<{ map: MapData; text: string } | null>(null);
  const [message, setMessage] = useState('');
  const [effectValue, setEffectValue] = useState(25);
  const [checkedMap, setCheckedMap] = useState(map);
  const root = useRef<HTMLDivElement>(null);
  live.current = map;
  historyRef.current = history;

  useEffect(() => {
    if (value !== emitted.current) {
      setHistory({ past: [], present: map, future: [] });
      setCheckedMap(map);
      gesture.current = null;
      setRectangle(null);
    }
    if (!gesture.current) setCheckedMap(map);
    setSize({ width: map.width, height: map.height });
  }, [value, map]);

  const emit = useCallback((next: MapData) => {
    live.current = next;
    const clean = { width: next.width, height: next.height, rows: next.rows };
    emitted.current = clean;
    if (rules && onRulesChange) {
      onRulesChange({ ...rules, map: clean, flags: { ...rules.flags, positions: next.objects?.flags ?? [] }, effects: { ...rules.effects, cells: next.objects?.effects ?? [] } });
    } else onChange(clean);
  }, [onChange, rules, onRulesChange]);
  const commit = useCallback((next: MapData, before = live.current) => {
    const h = historyStep({ ...historyRef.current, present: before }, { type: 'commit', map: next });
    historyRef.current = h;
    setHistory(h);
    setCheckedMap(next);
    emit(next);
  }, [emit]);
  const navigateHistory = useCallback((type: 'undo' | 'redo') => {
    gesture.current = null;
    setRectangle(null);
    const h = historyStep(historyRef.current, { type });
    historyRef.current = h;
    setHistory(h);
    setCheckedMap(h.present);
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

  const objectBrush = /^(flag|cache|trap|reroll|lock|mystery|erase-object)$/.test(material);
  const paint = (source: MapData, points: [number, number][]) => {
    if (objectBrush) {
      let next = source;
      for (const [x, y] of points) next = paintObject(next, x, y, material === 'erase-object' ? 'erase' : material as 'flag' | EditorEffect['kind'], effectValue);
      return next;
    }
    let next = paintMap(source, points, material, symmetry);
    if (material === '.' && source.objects) for (const [x, y] of points) next = paintObject(next, x, y, 'erase');
    return next;
  };
  const start = (x: number, y: number) => {
    if (tool === 'pan') return;
    gesture.current = { start: [x, y], last: [x, y], before: live.current };
    if (tool === 'brush' || objectBrush) emit(paint(live.current, [[x, y]]));
    else if (tool === 'rectangle') setRectangle([x, y, x, y]);
  };
  const move = (x: number, y: number) => {
    const g = gesture.current;
    if (!g) return;
    if (tool === 'brush' || objectBrush) emit(paint(live.current, strokePoints(...g.last, x, y)));
    else if (tool === 'rectangle') setRectangle([...g.start, x, y]);
    g.last = [x, y];
  };
  const end = (x: number, y: number) => {
    const g = gesture.current;
    if (!g) return;
    let next = live.current;
    if (tool === 'fill' && !objectBrush) next = floodMap(g.before, ...g.start, material, symmetry);
    if (tool === 'rectangle' && !objectBrush) {
      next = g.before;
      for (let ry = Math.min(y, g.start[1]); ry <= Math.max(y, g.start[1]); ry++) {
        const points: [number, number][] = [];
        for (let rx = Math.min(x, g.start[0]); rx <= Math.max(x, g.start[0]); rx++) points.push([rx, ry]);
        next = paint(next, points);
      }
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
    for (const row of checkedMap.rows) for (const c of row) {
      if (c === '#') walls++;
      if (/^[1-8]$/.test(c)) counts[Number(c) - 1]++;
    }
    return { walls, counts, area: checkedMap.width * checkedMap.height - walls };
  }, [checkedMap]);
  const issues = useMemo(() => {
    const { objects, ...geometry } = checkedMap;
    const parsed = jinchi.rulesSchema.safeParse({ ...(rules ?? {}), map: geometry, ...(rules ? { flags: { ...rules.flags, positions: objects?.flags ?? [] }, effects: { ...rules.effects, cells: objects?.effects ?? [] } } : {}) });
    return parsed.success ? jinchi.checkRules?.(parsed.data) ?? [] : [{ code: 'map', message: 'Проверьте размеры и строки карты', severity: 'error' }];
  }, [checkedMap]);
  const cells = useMemo(() => {
    const out = new Array<number>(map.width * map.height);
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) { const c = map.rows[y]?.[x] ?? '.'; out[y * map.width + x] = c === '#' ? -2 : c === '.' ? -1 : Number(c) - 1; }
    return out;
  }, [map]);
  const zoneCells = useMemo(() => cells.flatMap((c, i) => c === Number(material) - 1 ? [i] : []), [cells, material]);
  const drawing = tool !== 'pan';
  const requestResize = () => {
    if (![size.width, size.height].every(side => Number.isInteger(side) && side >= 3 && side <= 1000)) { setMessage('Размеры карты — целые числа от 3 до 1000.'); return; }
    if (size.width === map.width && size.height === map.height) return;
    const losses = resizeLosses(live.current, size.width, size.height);
    const next = resizeMap(live.current, size.width, size.height);
    if (losses.bases || losses.flags || losses.effects) setResizePending({ map: next, text: `Будут удалены: ${losses.bases} клеток баз, ${losses.flags} флагов, ${losses.effects} спецклеток.` });
    else { commit(next); setMessage('Размер карты изменён. Баланс нужно проверить заново.'); }
  };

  const tools = <div className="jn-editor-tools" role="group" aria-label="Инструмент рисования">
    {([['brush', '✎', 'Кисть'], ['rectangle', '▧', 'Прямоугольник'], ['fill', '▨', 'Заливка'], ['pan', '✥', 'Навигация']] as const).map(([id, icon, text]) =>
      <button key={id} type="button" aria-pressed={tool === id} className={tool === id ? 'is-selected' : ''} onClick={() => setTool(id)}><span aria-hidden="true">{icon}</span> {text}</button>)}
    <span className="jn-tool-divider" />
    <button type="button" aria-label="Отменить рисование" title="Отменить · Ctrl+Z" disabled={!history.past.length} onClick={() => navigateHistory('undo')}>↶</button>
    <button type="button" aria-label="Повторить рисование" title="Повторить · Ctrl+Shift+Z" disabled={!history.future.length} onClick={() => navigateHistory('redo')}>↷</button>
  </div>;

  const settings = <>
<div className="jn-editor-settings">
      <label>Ширина<input type="number" min={3} max={1000} value={size.width} onChange={e => setSize({ ...size, width: Number(e.target.value) })} /></label>
      <span aria-hidden="true">×</span>
      <label>Высота<input type="number" min={3} max={1000} value={size.height} onChange={e => setSize({ ...size, height: Number(e.target.value) })} /></label>
      <button type="button" onClick={requestResize}>Изменить размер</button>
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
    {rules && <div className="jn-palette jn-object-palette" role="group" aria-label="Объекты карты">{([['flag', '⚑', 'Флаг'], ['cache', '+', 'Тайник'], ['trap', '−', 'Ловушка'], ['reroll', '↻', 'Запасной бросок'], ['lock', '⊥', 'Скованность'], ['mystery', '?', 'Неизвестная клетка'], ['erase-object', '×', 'Убрать объект']] as const).map(([kind, icon, label]) => <button key={kind} type="button" aria-label={kind === 'flag' ? 'Рисовать флаг' : label} aria-pressed={material === kind} className={material === kind ? 'is-selected' : ''} onClick={() => { setMaterial(kind); setTool('brush'); }}><i>{icon}</i>{label}</button>)}{(material === 'cache' || material === 'trap') && <label>Очки <input type="number" min={1} max={100000} value={effectValue} onChange={event => setEffectValue(Math.max(1, Math.min(100000, Math.round(Number(event.target.value) || 1))))} /></label>}<span>Объекты рисуются только на свободных клетках, до 1000 каждого вида слоя.</span></div>}
  </>;

  return <div className="jn-editor" ref={root}>
    <div className="jn-editor-heading"><div><span className="jn-eyebrow">КАРТОГРАФИЯ</span><h3>Ваша территория начинается здесь</h3></div><span className="jn-map-size">{map.width} × {map.height}</span></div>
    <p className="jn-editor-intro">Нарисуйте стены и базы. Карта будет одинаковой для всех игроков.</p>
    {generator}
    {resizePending && <div className="jn-resize-warning" role="alert"><p>{resizePending.text} Действие можно отменить.</p><button type="button" onClick={() => { commit(resizePending.map); setResizePending(null); }}>Обрезать карту</button><button type="button" onClick={() => { setResizePending(null); setSize({ width: map.width, height: map.height }); }}>Сохранить размер</button></div>}
    {message && <p role="status">{message}</p>}
    <MapViewport width={map.width} height={map.height} cells={cells} colors={DEFAULT_COLORS} drawing={drawing} focusCells={zoneCells} objects={[...(map.objects?.flags ?? []).map(p => ({ ...p, kind: 'flag' })), ...(map.objects?.effects ?? [])]} toolbar={<div className="jn-editor-toolbar">{settings}{tools}</div>} onStrokeStart={start} onStrokeMove={move} onStrokeEnd={end} onStrokeCancel={cancel}>
      {rectangle && <rect x={Math.min(rectangle[0], rectangle[2])} y={Math.min(rectangle[1], rectangle[3])} width={Math.abs(rectangle[0] - rectangle[2]) + 1} height={Math.abs(rectangle[1] - rectangle[3]) + 1} fill={material === '#' ? '#424853' : DEFAULT_COLORS[Number(material) - 1] ?? '#ffffff'} opacity={0.5} stroke="#ffffff" strokeWidth={0.1} />}
    </MapViewport>
    <div className="jn-editor-footer"><span><b>{stats.area.toLocaleString('ru-RU')}</b> игровых клеток · {stats.walls} стен · {stats.counts.filter(Boolean).length} базы{rules ? ` · ${map.objects?.flags.length ?? 0} флагов · ${map.objects?.effects.length ?? 0} спецклеток` : ''}</span><button type="button" onClick={() => { if (window.confirm('Очистить карту? Все стены, базы и объекты будут удалены. Действие можно отменить.')) commit({ ...map, rows: Array(map.height).fill('.'.repeat(map.width)), ...(rules ? { objects: { flags: [], effects: [] } } : {}) }); }}>Очистить</button></div>
    <div className="jn-zone-legend">{stats.counts.map((count, i) => count ? <span key={i}><i style={{ background: DEFAULT_COLORS[i] }} />База {i + 1}<b>{count}</b></span> : null)}</div>
    <p className="jn-editor-help">{tool === 'pan' ? 'Тяните карту для перемещения. Колесо или щипок — масштаб.' : 'Рисуйте протягиванием. Для перемещения выберите «Навигация». Два пальца — масштаб.'} <span>F — полный экран · 0 — вся карта</span></p>
    {issues.length > 0 ? <ul className="jn-map-issues" aria-live="polite">{issues.map((issue, i) => <li key={`${issue.code}-${i}`} className={issue.severity === 'warning' ? 'is-warning' : 'is-error'}>{issue.message}</li>)}</ul> : <p className="jn-map-valid">✓ Карта готова к игре</p>}
  </div>;
}
