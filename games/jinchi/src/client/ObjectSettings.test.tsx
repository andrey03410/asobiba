import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { JinchiRules } from '../rules';
import { FlagSettings, EffectSettings } from './ObjectSettings';

type Flags = JinchiRules['flags'];
type Effects = JinchiRules['effects'];
type Control = { children?: ReactNode; 'aria-label'?: string; onChange?: (event: { target: { value: string } }) => void; onClick?: () => void; disabled?: boolean };
function findControl(node: ReactNode, label: string): ReactElement<Control> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Control>(child)) continue;
    if (child.props['aria-label'] === label) return child;
    const nested = findControl(child.props.children, label);
    if (nested) return nested;
  }
}
function flagsForm(value: Flags, onChange = (_next: Flags) => {}): ReactElement {
  return FlagSettings({ value, onChange });
}
function effectsForm(value: Effects, onChange = (_next: Effects) => {}): ReactElement {
  return EffectSettings({ value, onChange });
}
const positions = [{ x: 987, y: 654 }];

describe('flag settings', () => {
  it('shows only the price or target relevant to the selected criterion', () => {
    const value: Flags = { mode: 'bonus', value: 75, target: 0, positions };
    const bonus = renderToStaticMarkup(flagsForm(value));
    expect(bonus).toContain('Как учитывать флаги');
    expect(bonus).toContain('Цена одного флага');
    expect(bonus).not.toContain('Захватов для победы');
    const primary = renderToStaticMarkup(flagsForm({ ...value, mode: 'primary', target: 1 }));
    expect(primary).toContain('Захватов для победы');
    expect(primary).not.toContain('Цена одного флага');
    expect(primary).toContain('кистью');
    expect(primary).not.toMatch(/987|654|positions|textarea/);
  });
  it('preserves map positions and flag price when switching from primary to bonus', () => {
    let value: Flags = { mode: 'primary', value: 75, target: 1, positions };
    findControl(flagsForm(value, next => { value = next; }), 'Как учитывать флаги')?.props.onChange?.({ target: { value: 'bonus' } });
    expect(value).toEqual({ mode: 'bonus', value: 75, target: 0, positions: [{ x: 987, y: 654 }] });
    expect(value.positions).toBe(positions);
  });
  it('clears placed flags only when the player explicitly switches them off', () => {
    let value: Flags = { mode: 'primary', value: 75, target: 1, positions };
    expect(renderToStaticMarkup(flagsForm(value))).toContain('Выключение уберёт размещённые флаги');
    findControl(flagsForm(value, next => { value = next; }), 'Как учитывать флаги')?.props.onChange?.({ target: { value: 'off' } });
    expect(value).toEqual({ mode: 'off', value: 75, target: 0, positions: [] });
    expect(positions).toEqual([{ x: 987, y: 654 }]);
  });
});

describe('effect settings', () => {
  const value: Effects = { cells: [{ x: 987, y: 654, kind: 'mystery' }], mysteryPool: [
    { kind: 'cache', value: 17, weight: 2 }, { kind: 'cache', value: 99, weight: 1 }, { kind: 'trap', value: 8, weight: 1 }, { kind: 'lock', weight: 0 },
  ] };
  it('normalizes arbitrary duplicate pool rows individually and hides cell coordinates', () => {
    const form = effectsForm(value);
    expect(renderToStaticMarkup(form)).toContain('Неизвестная клетка');
    expect(findControl(form, 'Вероятность исхода 1')?.props.children).toBe('50 %');
    expect(findControl(form, 'Вероятность исхода 2')?.props.children).toBe('25 %');
    expect(findControl(form, 'Вероятность исхода 4')?.props.children).toBe('0 %');
    expect(renderToStaticMarkup(form)).not.toMatch(/987|654|mysteryPool|textarea/);
  });
  it('changes exactly one duplicate row without losing cells or other outcomes', () => {
    let next = value;
    findControl(effectsForm(value, updated => { next = updated; }), 'Вес исхода 2')?.props.onChange?.({ target: { value: '9' } });
    expect(next.mysteryPool).toEqual([{ kind: 'cache', value: 17, weight: 2 }, { kind: 'cache', value: 99, weight: 9 }, { kind: 'trap', value: 8, weight: 1 }, { kind: 'lock', weight: 0 }]);
    expect(next.cells).toBe(value.cells);
    expect(next.mysteryPool[0]).toBe(value.mysteryPool[0]);
    expect(value.mysteryPool[1].weight).toBe(1);
  });
  it('retains a configured amount across kind changes and uses defaults only for a new amount', () => {
    let next = value;
    findControl(effectsForm(next, updated => { next = updated; }), 'Тип исхода 2')?.props.onChange?.({ target: { value: 'trap' } });
    expect(next.mysteryPool[1]).toEqual({ kind: 'trap', value: 99, weight: 1 });
    findControl(effectsForm(next, updated => { next = updated; }), 'Тип исхода 4')?.props.onChange?.({ target: { value: 'cache' } });
    expect(next.mysteryPool[3]).toEqual({ kind: 'cache', value: 25, weight: 0 });
    expect(next.cells).toBe(value.cells);
  });
  it('keeps typed weights and amounts within the supported limits', () => {
    let next = value;
    findControl(effectsForm(next, updated => { next = updated; }), 'Вес исхода 2')?.props.onChange?.({ target: { value: '1001' } });
    expect(next.mysteryPool[1].weight).toBe(1000);
    findControl(effectsForm(next, updated => { next = updated; }), 'Очки исхода 2')?.props.onChange?.({ target: { value: '0' } });
    expect(next.mysteryPool[1].value).toBe(1);
    findControl(effectsForm(next, updated => { next = updated; }), 'Очки исхода 2')?.props.onChange?.({ target: { value: '100001' } });
    expect(next.mysteryPool[1].value).toBe(100000);
  });
  it('removes only the selected outcome and appends without replacing the existing pool', () => {
    let next = value;
    findControl(effectsForm(next, updated => { next = updated; }), 'Удалить исход 2')?.props.onClick?.();
    expect(next.mysteryPool).toEqual([{ kind: 'cache', value: 17, weight: 2 }, { kind: 'trap', value: 8, weight: 1 }, { kind: 'lock', weight: 0 }]);
    findControl(effectsForm(next, updated => { next = updated; }), 'Добавить исход')?.props.onClick?.();
    expect(next.mysteryPool).toEqual([{ kind: 'cache', value: 17, weight: 2 }, { kind: 'trap', value: 8, weight: 1 }, { kind: 'lock', weight: 0 }, { kind: 'cache', value: 25, weight: 1 }]);
    expect(next.cells).toBe(value.cells);
  });
  it('explains zero total weight and prevents adding beyond one hundred outcomes', () => {
    const empty = renderToStaticMarkup(effectsForm({ cells: value.cells, mysteryPool: [{ kind: 'lock', weight: 0 }] }));
    expect(empty).toContain('Хотя бы у одного исхода вес должен быть больше нуля');
    expect(empty).not.toMatch(/NaN|Infinity/);
    const full = effectsForm({ cells: value.cells, mysteryPool: Array.from({ length: 100 }, () => ({ kind: 'reroll', weight: 1 })) });
    expect(findControl(full, 'Добавить исход')?.props.disabled).toBe(true);
  });
});
