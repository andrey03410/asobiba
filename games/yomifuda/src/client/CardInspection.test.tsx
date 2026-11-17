import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CardInspection } from './CardInspection';

it('renders the complete selected identity and portrait in a named dialog without reading values', () => {
  const card = { id: 'c', name: 'Длинное имя '.repeat(14), anime: 'Длинное название аниме '.repeat(10),
    version: 'Первый сезон, физическая сила без телекинеза. '.repeat(3), image: { asset: 'portrait' },
    get values() { throw new Error('Inspection read hidden values'); } };
  const html = renderToStaticMarkup(<CardInspection card={card} assetUrl={id => `/assets/${id}`} canConfirm onClose={() => {}} onConfirm={() => {}} />);
  expect(html).toContain('<dialog');
  expect(html).toContain('aria-labelledby=');
  expect(html).toContain(card.name);
  expect(html).toContain(card.anime);
  expect(html).toContain(card.version);
  expect(html).toContain('src="/assets/portrait"');
  expect(html).toContain('Вернуться к руке');
  expect(html).toContain('Подтвердить выбор');
});

it('keeps inspection closable while preventing confirmation when the transport is unavailable', () => {
  const html = renderToStaticMarkup(<CardInspection card={{ id: 'c', name: 'N', anime: 'A' }} assetUrl={id => id} canConfirm={false} onClose={() => {}} onConfirm={() => {}} />);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Подтвердить выбор<\/button>/);
  expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Вернуться к руке<\/button>/);
});
