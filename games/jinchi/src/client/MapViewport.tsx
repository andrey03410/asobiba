import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
  /** Stretch to the parent's height (the match stage) instead of the inline map height. */
  fill?: boolean;
  /** Fullscreen owned by the page: the button and F drive it instead of the viewport's own. */
  externalFullscreen?: { active: boolean; available: boolean; toggle(): void };
  objects?: MapObject[];
  /** Game placement needs distinguishable cells; editor strokes keep their own precision. */
  minimumPickSize?: number;
  onTooSmall?: () => void;
}

export type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
export function resizeCamera(box: Box, before: { width: number; height: number }, after: { width: number; height: number }): Box {
  const scale = box.width / Math.max(1, before.width);
  const width = after.width * scale, height = after.height * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}
export function turnCueKey(round: number, turn: number, seat: number): string { return `${round}:${turn}:${seat}`; }
export function consumeTurnCue(seen: Set<string>, round: number, turn: number, seat: number, visible: boolean): boolean {
  const key = turnCueKey(round, turn, seat);
  if (!visible || seen.has(key)) return false;
  seen.add(key); return true;
}
export interface MapObject extends Point { kind: string }
export function clusterObjects(objects: MapObject[], box: Box, pixels: number): (MapObject & { count: number })[] {
  const bins = new Map<string, MapObject & { count: number }>();
  const size = Math.max(1, box.width / Math.max(1, pixels) * 20);
  for (const object of objects) {
    if (object.x + 1 < box.x || object.y + 1 < box.y || object.x > box.x + box.width || object.y > box.y + box.height) continue;
    const key = `${Math.floor(object.x / size)}:${Math.floor(object.y / size)}`;
    const previous = bins.get(key);
    if (previous) { previous.count++; if (previous.kind !== object.kind) previous.kind = 'mixed'; }
    else bins.set(key, { ...object, count: 1 });
  }
  return [...bins.values()];
}

export const OBJECT_LABELS: Record<string, string> = { flag: 'Флаг', cache: 'Тайник', trap: 'Ловушка', reroll: 'Запасной бросок', lock: 'Скованность', mystery: 'Неизвестная клетка', mixed: 'Объекты' };
export function ObjectsArtwork({ objects, box, pixels = 1000 }: { objects: MapObject[]; box: Box; pixels?: number }): ReactElement {
  const clustered = clusterObjects(objects, box, pixels);
  const radius = Math.max(.38, box.width / pixels * 8);
  const paths: Record<string, string> = { flag: 'M-.3 .5V-.5H.4L.2-.2.4.1H-.3', cache: 'M-.4 0H.4M0-.4V.4', trap: 'M-.4 0H.4', reroll: 'M-.4-.1A.42.42 0 1 1-.2.4M-.4-.5V-.1H0', lock: 'M-.35.45V-.05H.35V.45ZM-.2-.05V-.3A.2.2 0 0 1 .2-.3V-.05', mystery: 'M-.2-.2Q-.2-.5.1-.4T.1 0L0 .1M0 .35v.08', mixed: 'M0-.5L.5 0 0 .5-.5 0Z' };
  return <g className="jinchi-objects" pointerEvents="none">{clustered.map((object, i) => <g key={i} transform={`translate(${object.x + .5} ${object.y + .5})`}><title>{`${OBJECT_LABELS[object.kind]}${object.count > 1 ? `: ${object.count}` : ''}`}</title><circle r={radius} fill={object.kind === 'trap' ? '#7e302f' : '#143d43'} stroke={object.kind === 'flag' ? '#f8cc62' : '#fff9df'} strokeWidth={radius * .14} />{object.count > 1 ? <text dominantBaseline="central" textAnchor="middle" fill="#fff9df" fontSize={radius * 1.5} fontWeight="800">{object.count}</text> : <path transform={`scale(${radius * 1.25})`} d={paths[object.kind] ?? paths.mystery} fill="none" stroke="#fff9df" strokeWidth=".15" strokeLinecap="round" strokeLinejoin="round" />}</g>)}</g>;
}

const RasterSurface = memo(function RasterSurface({ source, box, size, background, grid = false }: { source: HTMLCanvasElement | null; box: Box; size: { width: number; height: number }; background: string; grid?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !source) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(size.width * ratio)); canvas.height = Math.max(1, Math.round(size.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.imageSmoothingEnabled = false;
    const scale = size.width / box.width;
    context.fillStyle = background;
    context.fillRect(-box.x * scale, -box.y * scale, source.width * scale, source.height * scale);
    context.drawImage(source, -box.x * scale, -box.y * scale, source.width * scale, source.height * scale);
    if (grid && scale >= 6) {
      context.strokeStyle = '#71847c66'; context.lineWidth = .6; context.beginPath();
      for (let x = Math.max(0, Math.ceil(box.x)); x <= Math.min(source.width, box.x + box.width); x++) { const px = (x - box.x) * scale; context.moveTo(px, Math.max(0, -box.y * scale)); context.lineTo(px, Math.min(size.height, (source.height - box.y) * scale)); }
      for (let y = Math.max(0, Math.ceil(box.y)); y <= Math.min(source.height, box.y + box.height); y++) { const py = (y - box.y) * scale; context.moveTo(Math.max(0, -box.x * scale), py); context.lineTo(Math.min(size.width, (source.width - box.x) * scale), py); }
      context.stroke();
    }
  }, [source, box, size, background, grid]);
  return <canvas className="jinchi-raster" ref={ref} aria-hidden="true" />;
});

function mapTexture(width: number, height: number, cells: number[], colors: string[], wallColor: string, background: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const palette = new Map<number, number[]>();
  for (const [value, color] of [[-2, wallColor], [-1, background], ...colors.map((c, i) => [i, c])] as [number, string][]) {
    context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); palette.set(value, [...context.getImageData(0, 0, 1, 1).data]);
  }
  const image = context.createImageData(width, height);
  for (let i = 0; i < cells.length; i++) image.data.set(palette.get(cells[i]) ?? palette.get(-1)!, i * 4);
  context.putImageData(image, 0, 0);
  return canvas;
}
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
export function MapViewport({ width, height, cells, colors, wallColor = '#293d45', background = '#f7f3e8', grid = true, children, onCellHover, onCellClick, onStrokeStart, onStrokeMove, onStrokeEnd, onStrokeCancel, drawing = false, focusCells = [], lastCells = [], toolbar, fill = false, externalFullscreen, objects = [], minimumPickSize = 0, onTooSmall }: MapViewportProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const aspectRef = useRef(1.6);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const sizeRef = useRef(size);
  const measured = useRef(false);
  const texture = useMemo(() => mapTexture(width, height, cells, colors, wallColor, background), [width, height, cells, colors, wallColor, background]);
  const navigated = useRef(false);
  const [camera, setCamera] = useState<Box>(() => fitBox(width, height, aspectRef.current));
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [fullscreen, setFullscreen] = useState(false);
  const [miniOpen, setMiniOpen] = useState(() => { try { return localStorage.getItem('jinchi.minimap') !== 'hidden'; } catch { return true; } });
  const [panning, setPanning] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const strokeCancelRef = useRef(onStrokeCancel);
  strokeCancelRef.current = onStrokeCancel;
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
      const before = sizeRef.current, after = { width: w, height: h };
      const alreadyMeasured = measured.current;
      measured.current = true;
      setCamera(old => alreadyMeasured ? resizeCamera(old, before, after) : fitBox(widthRef.current, heightRef.current, aspect));
      sizeRef.current = after; setSize(after);
      if (gesture.current?.drawing) strokeCancelRef.current?.();
      gesture.current = null; pointers.current.clear(); pinching.current = false; setPanning(false);
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
    if (externalFullscreen) {
      externalFullscreen.toggle();
      return;
    }
    if (fullscreen) {
      setFullscreen(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    setFullscreen(true);
    rootRef.current?.focus({ preventScroll: true });
    try { await rootRef.current?.requestFullscreen?.(); } catch { /* The fixed viewport is the mobile browser fallback. */ }
  }, [fullscreen, externalFullscreen]);
  const shownFullscreen = externalFullscreen ? externalFullscreen.active : fullscreen;
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
    else if (key === 'g') {
      const center = { x: cameraRef.current.x + cameraRef.current.width / 2, y: cameraRef.current.y + cameraRef.current.height / 2 };
      const flag = objects.filter(object => object.kind === 'flag').sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))[0];
      if (flag) focus([flag.y * width + flag.x]);
    }
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
      } else if (!g.moved && event.button === 0 && position) {
        if (sizeRef.current.width / cameraRef.current.width < minimumPickSize) { zoom(Math.max(.05, sizeRef.current.width / cameraRef.current.width / minimumPickSize), { x: position.x + .5, y: position.y + .5 }); onTooSmall?.(); }
        else onCellClick?.(position.x, position.y);
      }
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

  const controls = <nav className="jinchi-map-controls" aria-label="Навигация по карте">
      <div className="jinchi-control-group"><button type="button" onClick={() => zoom(1.25)} aria-label="Уменьшить масштаб" title="Уменьшить (−)">−</button><output aria-label="Масштаб">{zoomPercent}%</output><button type="button" onClick={() => zoom(.8)} aria-label="Увеличить масштаб" title="Увеличить (+)">+</button></div>
      <div className="jinchi-control-group"><button type="button" onClick={fit} title="Вся карта (0)"><SvgIcon kind="fit" /><span>Вся карта</span></button><button type="button" onClick={() => focus(focusCells)} disabled={!focusCells.length} title="К моей территории (M)" aria-label="К моей территории"><SvgIcon kind="focus" /><span>К себе</span></button><button type="button" onClick={() => focus(lastCells)} disabled={!lastCells.length} title="К последнему ходу (L)" aria-label="К последнему ходу"><SvgIcon kind="last" /><span>Последний</span></button></div>
      {objects.some(object => object.kind === 'flag') && <button type="button" title="Ближайший флаг (G)" onClick={() => { const cx = camera.x + camera.width / 2, cy = camera.y + camera.height / 2; const flag = objects.filter(o => o.kind === 'flag').sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0]; if (flag) focus([flag.y * width + flag.x]); }}>⚑<span>К флагу</span></button>}
      {(!externalFullscreen || externalFullscreen.available) && <button type="button" className="jinchi-fullscreen" onClick={() => { void toggleFullscreen(); }} title="Полный экран (F)" aria-label={shownFullscreen ? 'Выйти из полного экрана' : 'Полный экран'}><SvgIcon kind="fullscreen" /><span>{shownFullscreen ? 'Свернуть' : 'Полный экран'}</span></button>}
    </nav>;

  return <div className={`jinchi-viewport${fullscreen && !externalFullscreen ? ' is-fullscreen' : ''}${fill ? ' is-fill' : ''}${panning ? ' is-panning' : ''}${drawing ? ' is-drawing' : ''}${externalFullscreen ? ' has-external-fullscreen' : ''}`} ref={rootRef} tabIndex={0} onKeyDown={keyDown} onKeyUp={event => { if (event.key === ' ') spaceDown.current = false; }} onBlur={() => { spaceDown.current = false; }} aria-label="Карта Jinchi. Стрелки — перемещение, плюс и минус — масштаб, F — полный экран">
    {toolbar && <div className="jinchi-viewport-toolbar">{toolbar}</div>}
    <div className="jinchi-map-stage">
      <RasterSurface source={texture} box={camera} size={size} background={background} grid={grid} />
      <svg ref={svgRef} className="jinchi-map" viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`} role="img" aria-label={`Карта ${width}×${height}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelPointer}>
        <ObjectsArtwork objects={objects} box={camera} pixels={size.width} />{children}
      </svg>
      {showMini && <aside className={`jinchi-minimap${miniOpen ? '' : ' is-collapsed'}`}>
        <button type="button" className="jinchi-minimap-toggle" onClick={() => setMiniOpen(old => { try { localStorage.setItem('jinchi.minimap', old ? 'hidden' : 'visible'); } catch { /* Storage can be disabled. */ } return !old; })} aria-expanded={miniOpen}><SvgIcon kind="map" /><span>Обзор</span><span aria-hidden="true">{miniOpen ? '−' : '+'}</span></button>
        {miniOpen && <div className="jinchi-mini-surface" style={{ aspectRatio: `${width}/${height}` }}><RasterSurface source={texture} box={{ x: 0, y: 0, width, height }} size={{ width: 160, height: 160 * height / width }} background={background} /><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Миникарта" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); miniDragging.current = true; miniNavigate(event); }} onPointerMove={event => { if (miniDragging.current) miniNavigate(event); }} onPointerUp={() => { miniDragging.current = false; }} onPointerCancel={() => { miniDragging.current = false; }}>
          <ObjectsArtwork objects={objects} box={{ x: 0, y: 0, width, height }} pixels={160} />
          <rect x={visibleX} y={visibleY} width={visibleW} height={visibleH} fill="#fff" fillOpacity=".12" stroke="#fff" strokeWidth={Math.max(width, height) / 90} />
          <rect x={visibleX} y={visibleY} width={visibleW} height={visibleH} fill="none" stroke="#152d32" strokeWidth={Math.max(width, height) / 190} />
        </svg></div>}
      </aside>}
      <details className="jinchi-mobile-navigation"><summary aria-label="Навигация по карте"><SvgIcon kind="map" /><span>Карта</span></summary>{controls}</details>
      <div className="jinchi-map-caption"><span>{width} × {height}</span><span>陣地 · JINCHI</span></div>
    </div>
    <div className="jinchi-desktop-navigation">{controls}</div>
  </div>;
}
