import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SchemaForm } from './SchemaForm';

it('replaces only the requested nested field with its custom editor', () => {
  const html = renderToStaticMarkup(<SchemaForm
    schema={{ type: 'object', properties: { rules: { type: 'object', properties: { map: { type: 'object', properties: { rows: { type: 'array', items: { type: 'string' } } } }, sides: { type: 'integer', description: 'Грани кубика' } } } } }}
    value={{ rules: { map: { rows: ['1.2'] }, sides: 6 } }} onChange={() => {}}
    overrides={{ 'rules.map': ({ value }) => <div data-map-editor="true">{(value as { rows: string[] }).rows.join('')}</div> }}
  />);
  expect(html).toContain('data-map-editor="true"');
  expect(html).toContain('1.2');
  expect(html).toContain('Грани кубика');
  expect(html).not.toContain('sf-json');
});

it('shows human-readable enum labels while retaining machine values', () => {
  const html = renderToStaticMarkup(<SchemaForm schema={{ type: 'object', properties: { roll: { type: 'string', enum: ['auto', 'manual'], enumNames: ['Автоматически', 'По кнопке'] } } }} value={{ roll: 'manual' }} onChange={() => {}} />);
  expect(html).toContain('Автоматически');
  expect(html).toContain('По кнопке');
  expect(html).toContain('&quot;manual&quot;');
});
