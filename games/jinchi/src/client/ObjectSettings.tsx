import type { JinchiRules, WeightedEffect } from '../rules';

type Flags = JinchiRules['flags'];
type Effects = JinchiRules['effects'];
const EFFECT_NAMES: Record<WeightedEffect['kind'], string> = {
  cache: 'Тайник', trap: 'Ловушка', reroll: 'Запасной бросок', lock: 'Скованность',
};

function integer(value: string, min: number, max: number): number {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.round(number) : min));
}

export function FlagSettings({ value, onChange }: { value: Flags; onChange: (value: Flags) => void }) {
  return <div className="jn-object-settings">
    <label>Как учитывать флаги<select aria-label="Как учитывать флаги" value={value.mode} onChange={event => {
      const mode = event.target.value as Flags['mode'];
      onChange({ ...value, mode, target: mode === 'primary' ? value.target : 0, positions: mode === 'off' ? [] : value.positions });
    }}><option value="off">Выключены</option><option value="primary">Главный критерий</option><option value="bonus">Очки к территории</option></select></label>
    {value.mode === 'bonus' && <label>Цена одного флага<input aria-label="Цена одного флага" type="number" min={1} max={100000} value={value.value} onChange={event => onChange({ ...value, value: integer(event.target.value, 1, 100000) })} /><small>Столько очков добавляется к территории за каждый захваченный флаг.</small></label>}
    {value.mode === 'primary' && <label>Захватов для победы<input aria-label="Захватов для победы" type="number" min={0} max={value.positions.length} value={value.target} onChange={event => onChange({ ...value, target: integer(event.target.value, 0, value.positions.length) })} /><small>0 — без немедленной цели: собирайте все флаги или играйте до общего лимита. При равенстве флагов сравниваются очки.</small></label>}
    <p>Флагов на карте: <b>{value.positions.length}</b>. Добавляйте и убирайте их кистью в редакторе карты.</p>
    {value.positions.length > 0 && value.mode !== 'off' && <small>Выключение уберёт размещённые флаги. Цена флага сохранится.</small>}
    <small>Флаг забирают один раз — постановкой или окружением. Повторный захват клетки не начисляет его снова.</small>
  </div>;
}

export function EffectSettings({ value, onChange }: { value: Effects; onChange: (value: Effects) => void }) {
  const pool = value.mysteryPool;
  const total = pool.reduce((sum, effect) => sum + effect.weight, 0);
  const update = (index: number, patch: Partial<WeightedEffect>) => onChange({ ...value, mysteryPool: pool.map((effect, i) => i === index ? { ...effect, ...patch } : effect) });
  return <div className="jn-object-settings">
    <p>Спецклеток на карте: <b>{value.cells.length}</b>. Добавляйте и убирайте их кистью в редакторе карты. Без спецклеток сюрпризов не будет; настройки исходов сохранятся.</p>
    <details className="jn-effect-legend"><summary>Что делают спецклетки</summary><dl>
      <div><dt>Тайник</dt><dd>Добавляет заданное число очков.</dd></div>
      <div><dt>Ловушка</dt><dd>Вычитает заданное число очков. Территория остаётся на месте.</dd></div>
      <div><dt>Запасной бросок</dt><dd>Даёт один заряд, всего можно накопить до трёх. Заряд перебрасывает оба кубика один раз за ход; таймер не сбрасывается.</dd></div>
      <div><dt>Скованность</dt><dd>Запрещает поворот фигуры в следующем собственном ходу. Повторные помехи не складываются.</dd></div>
      <div><dt>Неизвестная клетка</dt><dd>Выбирает один из исходов ниже. Результат раскрывается при захвате клетки.</dd></div>
    </dl><p>Все спецклетки срабатывают один раз — при постановке или окружении.</p></details>
    <div className="jn-pool-heading"><b>Возможные исходы неизвестной клетки</b><small>Вес задаёт относительную вероятность: чем он больше, тем чаще исход. Вес 0 выключает строку. Одинаковые типы с разными величинами можно настраивать отдельно.</small></div>
    {pool.map((effect, index) => <fieldset className="jn-effect-pool-row" key={index}><legend>Исход {index + 1}</legend>
      <label>Эффект<select aria-label={`Тип исхода ${index + 1}`} value={effect.kind} onChange={event => {
        const kind = event.target.value as WeightedEffect['kind'];
        update(index, { kind, ...((kind === 'cache' || kind === 'trap') && effect.value === undefined ? { value: kind === 'cache' ? 25 : 15 } : {}) });
      }}>{Object.entries(EFFECT_NAMES).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      <label>Вес<input aria-label={`Вес исхода ${index + 1}`} type="number" min={0} max={1000} value={effect.weight} onChange={event => update(index, { weight: integer(event.target.value, 0, 1000) })} /></label>
      {(effect.kind === 'cache' || effect.kind === 'trap') && <label>{effect.kind === 'cache' ? 'Бонус, очков' : 'Штраф, очков'}<input aria-label={`Очки исхода ${index + 1}`} type="number" min={1} max={100000} value={effect.value ?? (effect.kind === 'cache' ? 25 : 15)} onChange={event => update(index, { value: integer(event.target.value, 1, 100000) })} /></label>}
      <output className="jn-pool-chance" aria-label={`Вероятность исхода ${index + 1}`}>{`${(total > 0 ? effect.weight / total * 100 : 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %`}</output>
      <button type="button" className="jn-pool-remove" aria-label={`Удалить исход ${index + 1}`} onClick={() => onChange({ ...value, mysteryPool: pool.filter((_, i) => i !== index) })}>Удалить</button>
    </fieldset>)}
    {total === 0 && <p className="jn-pool-warning" role="alert">Хотя бы у одного исхода вес должен быть больше нуля, чтобы неизвестная клетка могла сработать.</p>}
    <div><button type="button" aria-label="Добавить исход" disabled={pool.length >= 100} onClick={() => { if (pool.length < 100) onChange({ ...value, mysteryPool: [...pool, { kind: 'cache', value: 25, weight: 1 }] }); }}>Добавить исход</button> <small>{pool.length} из 100 исходов</small></div>
  </div>;
}
