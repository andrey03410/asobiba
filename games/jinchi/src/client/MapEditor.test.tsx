import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { rulesSchema } from '../rules';
import { MapEditor } from './MapEditor';

describe('extended map editor', () => {
  it('offers public object brushes and an explicit generator slot for full rules', () => {
    const rules = rulesSchema.parse({ map: { width: 5, height: 3, rows: ['1....', '.....', '....2'] }, flags: { mode: 'bonus', positions: [{ x: 2, y: 1 }] }, effects: { cells: [{ x: 3, y: 1, kind: 'mystery' }] } });
    const html = renderToStaticMarkup(<MapEditor value={rules.map} rules={rules} onChange={() => {}} onRulesChange={() => {}} generator={<button>Сгенерировать</button>} />);
    expect(html).toContain('Рисовать флаг');
    expect(html).toContain('Неизвестная клетка');
    expect(html).toContain('Сгенерировать');
    expect(html).toContain('max="1000"');
  });
  it('keeps the legacy map-only editor available', () => {
    const html = renderToStaticMarkup(<MapEditor value={{ width: 3, height: 3, rows: ['1..', '...', '..2'] }} onChange={() => {}} />);
    expect(html).toContain('Кисть');
    expect(html).not.toContain('Рисовать флаг');
  });
});
