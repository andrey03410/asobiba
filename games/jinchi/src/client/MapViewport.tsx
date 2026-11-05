import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from 'react';

export interface MapViewportProps {
  width: number;
  height: number;
  cells: number[];
  colors: string[];
  wallColor?: string;
  background?: string;
  grid?: boolean;
  children?: ReactNode;
  onCellHover?: (x: number, y: number) => void;
  onCellClick?: (x: number, y: number) => void;
  onStrokeStart?: (x: number, y: number) => void;
  onStrokeMove?: (x: number, y: number) => void;
  onStrokeEnd?: (x: number, y: number) => void;
  /** Restore the gesture's snapshot when a second finger starts a pinch. */
  onStrokeCancel?: () => void;
  drawing?: boolean;
  focusCells?: number[];
  lastCells?: number[];
  toolbar?: ReactNode;
}

type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type Gesture = { start: Point; previous: Point; moved: boolean; drawing: boolean; lastCell: Point | null };

/** Horizontal runs keep a 40,000 cell map to at most nine painted SVG nodes. */
function territoryPaths(width: number, height: number, cells: number[]): [number, string][] {
  const paths = new Map<number, string[]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width;) {
      const value = cells[y * width + x] ?? -1;
      const start = x++;
      while (x < width && cells[y * width + x] === value) x++;
      if (value === -1) continue;
      const commands = paths.get(value) ?? [];
      commands.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
      paths.set(value, commands);
    }
  }
  return [...paths].map(([value, paths]) => [value, paths.join('')]);
}

/** Shared map artwork; this has no HTML and is also safe for resvg previews. */
export function MapArtwork({ width, height, cells, colors, wallColor = '#293d45', background = '#f7f3e8', grid = true, children }: Pick<MapViewportProps, 'width' | 'height' | 'cells' | 'colors' | 'wallColor' | 'background' | 'grid' | 'children'>): ReactElement {
  const uid = useId().replace(/:/g, '');
  const hex = background.slice(1);
  const rgb = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex.slice(0, 6);
  const channels = [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16));
  const brightness = channels[0] * .299 + channels[1] * .587 + channels[2] * .114;
  const gridColor = brightness < 128 ? '#d8e9e4' : '#233e42';
  const paths = useMemo(() => territoryPaths(width, height, cells), [width, height, cells]);
  return <>
    <defs><pattern id={`jinchi-grid-${uid}`} width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke={gridColor} strokeOpacity=".22" strokeWidth=".025" /></pattern></defs>
    <rect width={width} height={height} fill={background} />
    <g shapeRendering="crispEdges">{paths.map(([value, path]) => <path key={value} d={path} fill={value === -2 ? wallColor : colors[value] ?? '#87989a'} />)}</g>
    {grid && <rect width={width} height={height} fill={`url(#jinchi-grid-${uid})`} pointerEvents="none" />}
    {children}
  </>;
}

function fitBox(width: number, height: number, aspect: number): Box {
  const paddedW = width + 1.4;
  const paddedH = height + 1.4;
  const boxW = Math.max(paddedW, paddedH * aspect);
  const boxH = boxW / aspect;
  return { x: (width - boxW) / 2, y: (height - boxH) / 2, width: boxW, height: boxH };
}

function bounded(box: Box, width: number, height: number): Box {
  const marginX = Math.min(box.width * .7, width);
  const marginY = Math.min(box.height * .7, height);
  return { ...box, x: Math.max(-box.width + marginX, Math.min(width - marginX, box.x)), y: Math.max(-box.height + marginY, Math.min(height - marginY, box.y)) };
}

function SvgIcon({ kind }: { kind: 'fit' | 'focus' | 'last' | 'fullscreen' | 'map' }): ReactElement {
  const paths = {
    fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z',
    focus: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    last: 'M4 12a8 8 0 1 0 3-6M4 3v6h6m2-2v5l3 2',
    fullscreen: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
    map: 'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5zm6-2v16m6-14v16',
  };
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

/** The editor and game use the same camera. Incoming cells never move it. */
export function MapViewport({ width, height, cells, colors, wallColor, background, grid = true, children, onCellHover, onCellClick, onStrokeStart, onStrokeMove, onStrokeEnd, onStrokeCancel, drawing = false, focusCells = [], lastCells = [], toolbar }: MapViewportProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const aspectRef = useRef(1.6);
  const navigated = useRef(false);
  const [camera, setCamera] = useState<Box>(() => fitBox(width, height, aspectRef.current));
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [fullscreen, setFullscreen] = useState(false);
  const [miniOpen, setMiniOpen] = useState(true);
  const [panning, setPanning] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const pinching = useRef(false);
  const pinchDistance = useRef(0);
  const spaceDown = useRef(false);
  const miniDragging = useRef(false);
  const widthRef = useRef(width);
  const heightRef = useRef(height);
  widthRef.current = width;
  heightRef.current = height;

  const updateCamera = useCallback((next: Box | ((old: Box) => Box)) => {
    navigated.current = true;
    setCamera(old => bounded(typeof next === 'function' ? next(old) : next, widthRef.current, heightRef.current));
  }, []);
  const fit = useCallback(() => {
    navigated.current = false;
    setCamera(fitBox(widthRef.current, heightRef.current, aspectRef.current));
  }, []);

  useEffect(() => { fit(); }, [width, height, fit]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      if (!w || !h) return;
      const aspect = w / h;
      aspectRef.current = aspect;
      setCamera(old => navigated.current ? { ...old, y: old.y + (old.height - old.width / aspect) / 2, height: old.width / aspect } : fitBox(widthRef.current, heightRef.current, aspect));
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const local = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (svg && matrix) {
      const point = svg.createSVGPoint();
      point.x = clientX; point.y = clientY;
      return point.matrixTransform(matrix.inverse());
    }
    const rect = svg?.getBoundingClientRect();
    const box = cameraRef.current;
    return { x: box.x + (clientX - (rect?.left ?? 0)) / (rect?.width || 1) * box.width, y: box.y + (clientY - (rect?.top ?? 0)) / (rect?.height || 1) * box.height };
  }, []);
  const cell = useCallback((clientX: number, clientY: number): Point | null => {
    const point = local(clientX, clientY);
    const x = Math.floor(point.x), y = Math.floor(point.y);
    return x >= 0 && y >= 0 && x < widthRef.current && y < heightRef.current ? { x, y } : null;
  }, [local]);
  const zoom = useCallback((factor: number, anchor?: Point) => {
    updateCamera(old => {
      const min = Math.max(2.5, Math.min(widthRef.current, heightRef.current) / 100);
      const max = fitBox(widthRef.current, heightRef.current, aspectRef.current).width * 1.8;
      const newWidth = Math.max(min, Math.min(max, old.width * factor));
      const ratio = newWidth / old.width;
      const point = anchor ?? { x: old.x + old.width / 2, y: old.y + old.height / 2 };
      return { x: point.x - (point.x - old.x) * ratio, y: point.y - (point.y - old.y) * ratio, width: newWidth, height: old.height * ratio };
    });
  }, [updateCamera]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.ctrlKey && event.deltaMode === 0 && (event.deltaX !== 0 || Math.abs(event.deltaY) < 45)) {
        const rect = svg.getBoundingClientRect();
        updateCamera(old => ({ ...old, x: old.x + event.deltaX * old.width / rect.width, y: old.y + event.deltaY * old.height / rect.height }));
      } else {
        zoom(Math.exp(Math.max(-1, Math.min(1, event.deltaY * (event.ctrlKey ? .012 : .0025)))), local(event.clientX, event.clientY));
      }
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, [local, updateCamera, zoom]);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreen) {
      setFullscreen(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    setFullscreen(true);
    rootRef.current?.focus({ preventScroll: true });
    try { await rootRef.current?.requestFullscreen?.(); } catch { /* The fixed viewport is the mobile browser fallback. */ }
  }, [fullscreen]);
  useEffect(() => {
    const change = () => { if (!document.fullscreenElement) setFullscreen(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { setFullscreen(false); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); } };
    document.addEventListener('fullscreenchange', change);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('fullscreenchange', change); document.removeEventListener('keydown', escape); };
  }, []);

  const focus = useCallback((indices: number[]) => {
    if (!indices.length) return;
    let minX = widthRef.current, minY = heightRef.current, maxX = 0, maxY = 0;
    for (const index of indices) {
      if (index < 0 || index >= widthRef.current * heightRef.current) continue;
      const x = index % widthRef.current, y = Math.floor(index / widthRef.current);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y + 1);
    }
    const aspect = aspectRef.current;
    const boxW = Math.max(maxX - minX + 6, (maxY - minY + 6) * aspect, Math.min(18, widthRef.current + 1.4));
    const boxH = boxW / aspect;
    updateCamera({ x: (minX + maxX - boxW) / 2, y: (minY + maxY - boxH) / 2, width: boxW, height: boxH });
  }, [updateCamera]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === ' ') { if ((event.target as HTMLElement).closest('button,summary')) return; spaceDown.current = true; event.preventDefault(); return; }
    const directions: Record<string, [number, number]> = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1] };
    if (directions[key]) {
      const [dx, dy] = directions[key];
      updateCamera(old => ({ ...old, x: old.x + dx * old.width * .12, y: old.y + dy * old.height * .12 }));
    } else if (key === '+' || key === '=') zoom(.8);
    else if (key === '-') zoom(1.25);
    else if (key === '0') fit();
    else if (key === 'm') focus(focusCells);
    else if (key === 'l') focus(lastCells);
    else if (key === 'f') void toggleFullscreen();
    else return;
    event.preventDefault();
  };

  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    rootRef.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1) {
      pinching.current = true;
      if (gesture.current?.drawing) {
        if (onStrokeCancel) onStrokeCancel();
        else if (gesture.current.lastCell) onStrokeEnd?.(gesture.current.lastCell.x, gesture.current.lastCell.y);
      }
      gesture.current = null;
      const [a, b] = [...pointers.current.values()];
      pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
      setPanning(true);
      return;
    }
    const position = cell(event.clientX, event.clientY);
    const draw = drawing && event.button === 0 && !spaceDown.current && position !== null;
    gesture.current = { start: point, previous: point, moved: false, drawing: draw, lastCell: position };
    if (draw && position) onStrokeStart?.(position.x, position.y);
  };
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const position = cell(event.clientX, event.clientY);
    if (position) onCellHover?.(position.x, position.y);
    if (!pointers.current.has(event.pointerId)) return;
    const previous = pointers.current.get(event.pointerId)!;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size > 1) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDistance.current > 0 && distance > 0) zoom(pinchDistance.current / distance, local(center.x, center.y));
      pinchDistance.current = distance;
      const rect = svgRef.current!.getBoundingClientRect();
      updateCamera(old => ({ ...old, x: old.x - (point.x - previous.x) / 2 * old.width / rect.width, y: old.y - (point.y - previous.y) / 2 * old.height / rect.height }));
      return;
    }
    const g = gesture.current;
    if (!g || pinching.current) return;
    if (g.drawing) {
      if (position && (position.x !== g.lastCell?.x || position.y !== g.lastCell?.y)) {
        onStrokeMove?.(position.x, position.y);
        g.lastCell = position;
      }
      return;
    }
    if (Math.hypot(point.x - g.start.x, point.y - g.start.y) > 6) g.moved = true;
    if (g.moved) {
      setPanning(true);
      const rect = svgRef.current!.getBoundingClientRect();
      const origin = g.previous;
      updateCamera(old => ({ ...old, x: old.x - (point.x - origin.x) * old.width / rect.width, y: old.y - (point.y - origin.y) * old.height / rect.height }));
    }
    g.previous = point;
  };
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    const position = cell(event.clientX, event.clientY);
    if (!pinching.current && g) {
      if (g.drawing && (position ?? g.lastCell)) {
        const end = position ?? g.lastCell!;
        onStrokeEnd?.(end.x, end.y);
      } else if (!g.moved && event.button === 0 && position) onCellClick?.(position.x, position.y);
    }
    gesture.current = null;
    if (pointers.current.size === 0) { pinching.current = false; setPanning(false); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const cancelPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current?.drawing) onStrokeCancel?.();
    gesture.current = null;
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) { pinching.current = false; setPanning(false); }
  };

  const miniNavigate = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * width;
    const y = (event.clientY - rect.top) / rect.height * height;
    updateCamera(old => ({ ...old, x: x - old.width / 2, y: y - old.height / 2 }));
  };
  const fitWidth = fitBox(width, height, aspectRef.current).width;
  const zoomPercent = Math.round(fitWidth / camera.width * 100);
  const showMini = width > 32 || height > 32 || zoomPercent > 105;
  const visibleX = Math.max(0, Math.min(width, camera.x));
  const visibleY = Math.max(0, Math.min(height, camera.y));
  const visibleW = Math.max(0, Math.min(width, camera.x + camera.width) - visibleX);
  const visibleH = Math.max(0, Math.min(height, camera.y + camera.height) - visibleY);
  const pixelPerCell = (svgRef.current?.clientWidth ?? 800) / camera.width;

  return <div className={`jinchi-viewport${fullscreen ? ' is-fullscreen' : ''}${panning ? ' is-panning' : ''}${drawing ? ' is-drawing' : ''}`} ref={rootRef} tabIndex={0} onKeyDown={keyDown} onKeyUp={event => { if (event.key === ' ') spaceDown.current = false; }} onBlur={() => { spaceDown.current = false; }} aria-label="Карта Jinchi. Стрелки — перемещение, плюс и минус — масштаб, F — полный экран">
    {toolbar && <div className="jinchi-viewport-toolbar">{toolbar}</div>}
    <div className="jinchi-map-stage">
      <svg ref={svgRef} className="jinchi-map" viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`} role="img" aria-label={`Карта ${width}×${height}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelPointer}>
        <MapArtwork width={width} height={height} cells={cells} colors={colors} wallColor={wallColor} background={background} grid={grid && pixelPerCell >= 6}>{children}</MapArtwork>
      </svg>
      {showMini && <aside className={`jinchi-minimap${miniOpen ? '' : ' is-collapsed'}`}>
        <button type="button" className="jinchi-minimap-toggle" onClick={() => setMiniOpen(old => !old)} aria-expanded={miniOpen}><SvgIcon kind="map" /><span>Обзор</span><span aria-hidden="true">{miniOpen ? '−' : '+'}</span></button>
        {miniOpen && <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Миникарта" style={{ aspectRatio: `${width}/${height}` }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); miniDragging.current = true; miniNavigate(event); }} onPointerMove={event => { if (miniDragging.current) miniNavigate(event); }} onPointerUp={() => { miniDragging.current = false; }} onPointerCancel={() => { miniDragging.current = false; }}>
          <MapArtwork width={width} height={height} cells={cells} colors={colors} wallColor={wallColor} background={background} grid={false}>{children}</MapArtwork>
          <rect x={visibleX} y={visibleY} width={visibleW} height={visibleH} fill="#fff" fillOpacity=".12" stroke="#fff" strokeWidth={Math.max(width, height) / 90} />
          <rect x={visibleX} y={visibleY} width={visibleW} height={visibleH} fill="none" stroke="#152d32" strokeWidth={Math.max(width, height) / 190} />
        </svg>}
      </aside>}
      <div className="jinchi-map-caption"><span>{width} × {height}</span><span>陣地 · JINCHI</span></div>
    </div>
    <nav className="jinchi-map-controls" aria-label="Навигация по карте">
      <div className="jinchi-control-group"><button type="button" onClick={() => zoom(1.25)} aria-label="Уменьшить масштаб" title="Уменьшить (−)">−</button><output aria-label="Масштаб">{zoomPercent}%</output><button type="button" onClick={() => zoom(.8)} aria-label="Увеличить масштаб" title="Увеличить (+)">+</button></div>
      <div className="jinchi-control-group"><button type="button" onClick={fit} title="Вся карта (0)"><SvgIcon kind="fit" /><span>Вся карта</span></button><button type="button" onClick={() => focus(focusCells)} disabled={!focusCells.length} title="К моей территории (M)" aria-label="К моей территории"><SvgIcon kind="focus" /><span>К себе</span></button><button type="button" onClick={() => focus(lastCells)} disabled={!lastCells.length} title="К последнему ходу (L)" aria-label="К последнему ходу"><SvgIcon kind="last" /><span>Последний</span></button></div>
      <button type="button" className="jinchi-fullscreen" onClick={() => { void toggleFullscreen(); }} title="Полный экран (F)" aria-label={fullscreen ? 'Выйти из полного экрана' : 'Полный экран'}><SvgIcon kind="fullscreen" /><span>{fullscreen ? 'Свернуть' : 'Полный экран'}</span></button>
    </nav>
  </div>;
}
