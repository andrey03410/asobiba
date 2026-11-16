import { useState } from 'react';
import { generateMap, GenerationError, type GeneratedMap, type GenerationRequest } from '../generator';
import { diceSides, type JinchiRules } from '../rules';

export function DiceSettings({ value, onChange }: { value: unknown; onChange: (value: number | [number, number]) => void }) {
  const pair: [number, number] = Array.isArray(value) ? [Number(value[0]) || 6, Number(value[1]) || 6] : [Number(value) || 6, Number(value) || 6];
  const linked = !Array.isArray(value);
  return <div className="jn-dice-settings">
    <label><input type="checkbox" checked={linked} onChange={event => onChange(event.target.checked ? pair[0] : pair)} /> Одинаковые кубики</label>
    <div className="jn-generator-grid">
      <label>{linked ? 'Граней у каждого кубика' : 'Первый кубик'}<input type="number" min={2} max={100} value={pair[0]} onChange={event => onChange(linked ? Number(event.target.value) : [Number(event.target.value), pair[1]])} /></label>
      {!linked && <label>Второй кубик<input type="number" min={2} max={100} value={pair[1]} onChange={event => onChange([pair[0], Number(event.target.value)])} /></label>}
    </div>
    <small>По умолчанию два d6. Выпавшие числа задают стороны фигуры; можно настроить до двух d100.</small>
  </div>;
}

interface Props {
  rules: JinchiRules;
  onChange: (rules: JinchiRules) => void;
  generate?: (request: GenerationRequest) => Promise<GeneratedMap>;
}

export function MapGenerator({ rules, onChange, generate }: Props) {
  const currentPlayers = rules.map.expectedPlayers ?? new Set(rules.map.rows.join('').match(/[1-8]/g) ?? []).size;
  const [players, setPlayers] = useState(Math.max(2, currentPlayers));
  const [shape, setShape] = useState<'rectangle' | 'circle'>(rules.map.generation?.shape ?? 'rectangle');
  const [width, setWidth] = useState(rules.map.width);
  const [height, setHeight] = useState(rules.map.height);
  const [seed, setSeed] = useState(rules.map.generation?.seed ?? 1);
  const [density, setDensity] = useState(rules.map.generation?.wallDensity ?? 20);
  const [dice, setDice] = useState<[number, number]>(() => diceSides(rules));
  const [structures, setStructures] = useState<('lakes' | 'ridges' | 'fortresses' | 'narrows')[]>(['lakes', 'ridges']);
  const [balanced, setBalanced] = useState(true);
  const [flagMode, setFlagMode] = useState(rules.flags.mode);
  const [flagCount, setFlagCount] = useState(rules.flags.positions.length || players * 3);
  const [flagValue, setFlagValue] = useState(rules.flags.value);
  const [flagTarget, setFlagTarget] = useState(rules.flags.target);
  const [effectCount, setEffectCount] = useState(rules.effects.cells.length);
  const [rounds, setRounds] = useState(rules.end.maxRounds || 80);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<GeneratedMap['diagnostics'] | null>(null);

  const preset = (kind: 'ordinary' | 'trio' | 'expedition') => {
    const count = kind === 'trio' ? 3 : players;
    setPlayers(count); setBalanced(true); setDensity(20); setStructures(['lakes', 'ridges']);
    setEffectCount(count * 3); setFlagCount(count * 3); setFlagValue(25);
    if (kind === 'expedition') {
      setShape('rectangle'); setWidth(1000); setHeight(1000); setDice([100, 100]);
      setFlagMode('primary'); setFlagTarget(count + 1); setRounds(100);
    } else {
      const side = kind === 'trio' ? 61 : Math.max(12, count * 6) * 2 + 1;
      setShape('circle'); setWidth(side); setHeight(side); setDice([6, 6]);
      setFlagMode(kind === 'trio' ? 'bonus' : 'off'); setFlagTarget(0); setRounds(80);
    }
    setError(''); setDiagnostics(null);
  };

  const build = async () => {
    setBusy(true); setError('');
    const request: GenerationRequest = { width, height: shape === 'circle' ? width : height, shape, players, seed, wallDensity: density, dice, structures, balanced, flags: { mode: flagMode, ...(flagMode !== 'off' ? { count: flagCount } : {}), value: flagValue, target: flagMode === 'primary' ? flagTarget : 0 }, effects: { count: effectCount } };
    try {
      // Let loading paint before local standalone use. The website supplies its
      // authenticated endpoint, sharing this same generator and validation.
      await new Promise(resolve => window.setTimeout(resolve, 0));
      const result = generate ? await generate(request) : generateMap(request);
      onChange({ ...rules, map: result.map, dice: { ...rules.dice, sides: dice[0] === dice[1] ? dice[0] : dice }, flags: result.flags, effects: { ...result.effects, mysteryPool: rules.effects.mysteryPool }, end: { ...rules.end, maxRounds: rounds, targetPercent: flagMode === 'off' ? rules.end.targetPercent : 0 } });
      setDiagnostics(result.diagnostics);
    } catch (cause) {
      if (cause instanceof GenerationError) setError([cause.message, ...cause.issues.map(issue => issue.message), ...cause.suggestions].join(' '));
      else setError(cause instanceof Error ? cause.message : 'Не удалось сгенерировать карту');
    } finally { setBusy(false); }
  };

  return <details className="jn-generator"><summary>Сгенерировать карту</summary>
    <p>Выберите условия и явно замените текущую карту. Ручные правки будут заменены.</p>
    <div className="jn-generator-presets"><button type="button" onClick={() => preset('ordinary')}>Обычная</button><button type="button" onClick={() => preset('trio')}>На троих</button><button type="button" onClick={() => preset('expedition')}>Большая экспедиция</button></div>
    <div className="jn-generator-grid">
      <label>Игроков<input type="number" min={2} max={8} value={players} onChange={event => setPlayers(Number(event.target.value))} /></label>
      <label>Форма<select value={shape} onChange={event => setShape(event.target.value as typeof shape)}><option value="rectangle">Прямоугольник</option><option value="circle">Круг</option></select></label>
      <label>{shape === 'circle' ? 'Диаметр сетки' : 'Ширина'}<input type="number" min={3} max={1000} value={width} onChange={event => setWidth(Number(event.target.value))} /></label>
      {shape === 'rectangle' && <label>Высота<input type="number" min={3} max={1000} value={height} onChange={event => setHeight(Number(event.target.value))} /></label>}
      <label>Зерно карты<input type="number" min={0} max={2147483647} value={seed} onChange={event => setSeed(Number(event.target.value))} /></label>
      <label>Стены, %<input type="number" min={0} max={45} value={density} onChange={event => setDensity(Number(event.target.value))} /></label>
      <label>Первый кубик<input type="number" min={2} max={100} value={dice[0]} onChange={event => setDice([Number(event.target.value), dice[1]])} /></label>
      <label>Второй кубик<input type="number" min={2} max={100} value={dice[1]} onChange={event => setDice([dice[0], Number(event.target.value)])} /></label>
      <label>Флаги<select value={flagMode} onChange={event => setFlagMode(event.target.value as typeof flagMode)}><option value="off">Выключены</option><option value="primary">Главный критерий</option><option value="bonus">Очки к территории</option></select></label>
      {flagMode !== 'off' && <label>Число флагов<input type="number" min={1} max={1000} value={flagCount} onChange={event => setFlagCount(Number(event.target.value))} /></label>}
      {flagMode === 'bonus' && <label>Цена флага<input type="number" min={1} max={100000} value={flagValue} onChange={event => setFlagValue(Number(event.target.value))} /></label>}
      {flagMode === 'primary' && <label>Захватов для победы (0 — все флаги)<input type="number" min={0} max={flagCount} value={flagTarget} onChange={event => setFlagTarget(Number(event.target.value))} /></label>}
      <label>Спецклеток (0 — без сюрпризов)<input type="number" min={0} max={1000} value={effectCount} onChange={event => setEffectCount(Number(event.target.value))} /></label>
      <label>Предел кругов (0 — без предела)<input type="number" min={0} max={10000} value={rounds} onChange={event => setRounds(Number(event.target.value))} /></label>
    </div>
    {shape === 'circle' && <p>{width}×{width}; {width % 2 === 1 ? `радиус ${(width - 1) / 2} клеток` : 'центр между клетками'}. Радиус 50 соответствует сетке 101×101.</p>}
    <div className="jn-generator-structures" role="group" aria-label="Препятствия">{([['lakes', 'Озёра'], ['ridges', 'Гряды'], ['fortresses', 'Крепости'], ['narrows', 'Перешейки']] as const).map(([value, label]) => <label key={value}><input type="checkbox" checked={structures.includes(value)} onChange={event => setStructures(old => event.target.checked ? [...old, value] : old.filter(item => item !== value))} /> {label}</label>)}</div>
    <label><input type="checkbox" checked={balanced} onChange={event => setBalanced(event.target.checked)} /> Проверить равные стартовые возможности и точный состав</label>
    <p>Неизвестные клетки используют текущий пул эффектов. Их результаты откроются при захвате.</p>
    <button type="button" className="jinchi-primary" disabled={busy} onClick={() => void build()}>{busy ? 'Строим и проверяем…' : 'Сгенерировать и заменить карту'}</button>
    {error && <p role="alert">{error}</p>}
    {diagnostics && <div role="status"><b>{diagnostics.balanced ? 'Стартовые условия проверены' : 'Карта без гарантии баланса'}</b><p>Игровая площадь: {diagnostics.playableArea.toLocaleString('ru-RU')}; стены: {diagnostics.wallPercent.toFixed(1)} %.</p><details><summary>Метрики по базам</summary><ul>{diagnostics.bases.map(base => <li key={base.id}>База {base.id}: {base.area} клетки, выходов {base.exits}, стартовые броски {base.allRollsFit ? 'все помещаются' : 'не все помещаются'}, область роста {base.localArea}, путь в центр {base.centerDistance}</li>)}</ul></details></div>}
  </details>;
}
