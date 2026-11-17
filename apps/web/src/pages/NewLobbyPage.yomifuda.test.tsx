import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoRules } from '@asobiba/game-yomifuda';
import { checkLobbyDocument, YomifudaSummary } from './NewLobbyPage';
describe('saved Yomifuda authoring', () => {
  const original = () => ({ sdk: 1, game: 'yomifuda', gameVersion: 1, rules: demoRules() });
  it('accepts a saved read-only projection without validating its intentionally empty cards', () => {
    const document = original(); document.rules.cards = [];
    expect(checkLobbyDocument(document, 'yomifuda', true)).toMatchObject({ ok: true, result: null });
    expect(checkLobbyDocument(document, 'yomifuda', false).ok).toBe(false);
    expect(checkLobbyDocument(original(), 'yomifuda', false).ok).toBe(true);
    expect(checkLobbyDocument(null, 'yomifuda', true).ok).toBe(false);
  });
  it('renders a summary without reading or exposing card identities and values', () => {
    const document = original(); document.rules.deckSize = 12;
    Object.defineProperty(document.rules, 'cards', { get() { throw new Error('Hidden cards read'); } });
    const html = renderToStaticMarkup(<YomifudaSummary document={document} saved />);
    expect(html).toContain('12 карт'); expect(html).toContain('Физическая сила');
    expect(html).not.toContain('Сайтама'); expect(html).not.toContain('textarea');
  });
});
