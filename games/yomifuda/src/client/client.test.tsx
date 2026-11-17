import { createCatalog, Match, validateConfig, type ConfigDocument } from '@asobiba/sdk';
import { fitTextSize } from '@douga/render/studio-frame';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { demoRules, visualSchema, yomifuda, type YomifudaView } from '../index';
import { buildArena, displayedScores } from './arena-plan';
import { yomifudaClient } from './index';
const assetUrl = (id: string) => `/assets/${id}`;
function config(): ConfigDocument {
  const result = validateConfig(createCatalog([yomifuda]), { sdk: 1, game: 'yomifuda', gameVersion: 1, rules: demoRules() });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.config;
}
function view(): YomifudaView { return Match.start({ game: yomifuda, config: config(), seats: 3, seed: 1, startedAt: 0 }).view(0).game as YomifudaView; }
const visual = visualSchema.parse({});
describe('Yomifuda client privacy and presentation', () => {
  it('compiles only backs for played seats, never hand identities or assets', () => {
    const v = view(); v.table = [{ seat: 0, hidden: true }];
    v.hand[0] = { id: 'secret', name: 'Secret identity', anime: 'Secret title', image: { asset: 'private' } };
    const result = buildArena(v, visual, assetUrl);
    expect(result.ready).toBe(true);
    const serialized = JSON.stringify(result.plan);
    expect(serialized).not.toContain('Secret'); expect(serialized).not.toContain('private');
    expect(result.plan.scenes[0].nodes.some(n => n.id.includes('back-0'))).toBe(true);
    expect(result.plan.scenes[0].nodes.some(n => n.id.includes('back-1'))).toBe(false);
  });
  it('reveals permitted portraits and active numbers in stages, with tie sums only when provided', () => {
    const v = view(); v.phase = 'reveal'; v.revealStartedAt = 1000; v.revealEndsAt = 11000;
    v.table = [0, 1, 2].map(seat => ({ seat, hidden: false, card: { id: `c${seat}`, name: `Character ${seat}`, anime: 'Anime', image: { asset: `open${seat}` } }, value: seat < 2 ? 80 : 20, points: seat === 0 ? 1 : 0, winner: seat === 0, ...(seat < 2 ? { tieTotal: seat === 0 ? 140 : 120 } : {}) }));
    v.players[0].score = 1;
    const result = buildArena(v, visual, assetUrl);
    expect(result.ready, JSON.stringify(result.diagnostics)).toBe(true);
    expect(result.plan.durationInFrames / result.plan.fps).toBeGreaterThanOrEqual(10);
    const nodes = result.plan.scenes[0].nodes;
    expect(nodes.find(n => n.id.includes('portrait-0'))?.media?.asset.src).toBe('/assets/open0');
    expect(nodes.find(n => n.id.includes('value-final-0'))?.text).toBe('80');
    expect(nodes.find(n => n.id.includes('tie-0'))?.text).toContain('140');
    expect(nodes.some(n => n.id.includes('tie-2'))).toBe(false);
    expect(nodes.find(n => n.id.includes('winner-0'))!.from).toBeGreaterThan(nodes.find(n => n.id.includes('value-final-0'))!.from);
    expect(displayedScores(v, 2000)).toEqual([0, 0, 0]);
    expect(displayedScores(v, 10000)).toEqual([1, 0, 0]);
    const reduced = buildArena(v, { ...visual, reducedMotion: true }, assetUrl);
    expect(reduced.plan.scenes[0].nodes.every(n => n.animation.length === 0)).toBe(true);
  });
  it('keeps the winning portrait visible beneath the late highlight overlay', () => {
    const v = view(); v.phase = 'reveal'; v.revealStartedAt = 0; v.revealEndsAt = 10000;
    v.table = [{ seat: 0, hidden: false, card: { id: 'winner', name: 'Winner', anime: 'Anime', image: { asset: 'portrait' } }, value: 72, points: 1, winner: true }];
    const plan = buildArena(v, visual, assetUrl).plan;
    const overlay = plan.scenes[0].nodes.find(n => n.id.includes('winner-border-0'))!;
    expect(overlay.fill).toBe('transparent');
    // The native renderer paints the wrapper as well as the SVG shape.
    expect(overlay.style.background).toBe('transparent');
    expect(overlay.style.borderWidth).toBe(0);
    expect(plan.scenes[0].nodes.find(n => n.id.includes('name-0'))?.style.background).toBe('transparent');
  });
  it.each([4, 5, 6])('keeps %i-player phone values and character names readable after native fitting', (count) => {
    const v = view(); v.phase = 'reveal'; v.revealStartedAt = 0; v.revealEndsAt = 10000;
    v.players = Array.from({ length: count }, (_, seat) => ({ seat, score: 0, handCount: 1, played: true, ready: false }));
    const names = ['Дзюн Садзанами', 'Микото Мисака', 'Сугуха Киригая', 'Ханако Хонда', 'Юри Накамура', 'Цубаса Ханэкава'];
    v.table = v.players.map(p => ({ seat: p.seat, hidden: false, card: { id: `c${p.seat}`, name: names[p.seat], anime: 'Длинное название аниме', image: { asset: `portrait${p.seat}` } }, value: 100, points: .5, winner: true, tieTotal: 246 }));
    const viewport = { width: 342, height: 206 }; // 360x640 stage, below six-player HUD and above hand.
    const result = buildArena(v, visual, assetUrl, [], true, viewport);
    expect(result.ready, JSON.stringify(result.diagnostics)).toBe(true);
    const plan = result.plan, scale = Math.min(viewport.width / plan.width, viewport.height / plan.height);
    const nodes = plan.scenes[0].nodes;
    for (let seat = 0; seat < count; seat++) {
      const effectiveFont = (prefix: string) => {
        const n = nodes.find(n => n.id.endsWith(`/${prefix}-${seat}`))!;
        const padding = Math.min(20, n.rect.width * .03);
        // The real native renderer's fitter, including its wrapper padding.
        return fitTextSize(n.text!, n.rect.width - padding * 2, n.rect.height - padding * 2, n.style.fontSize!) * scale;
      };
      expect(effectiveFont('value-final')).toBeGreaterThanOrEqual(14);
      expect(effectiveFont('name')).toBeGreaterThanOrEqual(10);
      expect(effectiveFont('tie')).toBeGreaterThanOrEqual(10);
      expect(nodes.find(n => n.id.endsWith(`/seat-${seat}`))?.text).toBe(String(seat + 1));
      const rect = nodes.find(n => n.id.endsWith(`/slot-${seat}`))!.rect;
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(plan.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(plan.height);
    }
  });
  it('previews independent complete demo games even with unreadable original rules', () => {
    const cfg = config(); Object.defineProperty(cfg, 'rules', { get() { throw new Error('Original deck read'); } });
    const match = yomifudaClient.previewMatch(cfg, 'end', 4);
    expect(match.phase).toBe('finished');
    const Board = yomifudaClient.Board;
    const html = renderToStaticMarkup(<Board config={cfg} match={match} seat={null} assetUrl={assetUrl} staticRender />);
    expect(html).toContain('<svg'); expect(html).toContain('Учебная');
    expect(html).not.toContain('NaN');
  });
});
