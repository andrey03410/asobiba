import { Resvg } from '@resvg/resvg-js';
import type { BoardProps, ConfigDocument, MatchView } from '@asobiba/sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { JinchiBoard, JinchiSeatIcon } from './Board';
import { MapArtwork, MapViewport } from './MapViewport';

const rules = {
  map: { width: 4, height: 3, rows: ['1#..', '....', '...2'] },
  dice: { sides: 6, roll: 'manual' },
  placement: { adjacency: 'side', overlapOwn: false },
  capture: { walls: true, diagonal: true, opponents: 'all' },
  starts: { assignment: 'ordered', unused: 'empty' },
  end: { skipRounds: 2, maxRounds: 0, targetPercent: 0 },
};
const colors = ['#0c9b86', '#eb7654', '#689bd2', '#cda553', '#a278c8', '#cf6993', '#7b9449', '#7174bd'];
const visual = { colors, wallColor: '#253642', background: '#fff8e9', grid: true, animations: { place: 'pop', capture: 'wave', durationMs: 400 } };
const config = { sdk: 1, game: 'jinchi', gameVersion: 1, rules, visual } as unknown as ConfigDocument;
const game = {
  width: 4, height: 3, cells: [0, -2, -1, -1, 0, -1, -1, -1, -1, -1, -1, 1],
  bases: [0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1],
  currentSeat: 0, turn: 3, cycle: 2, dice: [2, 3], scores: [2, 1], eliminated: [false, false],
  events: [{ id: 1, seat: 1, type: 'capture', text: 'окружил 3 клетки' }],
  lastMove: { seat: 1, indices: [11], captured: [], turn: 2 }, result: null, rules, area: 11, canAct: true,
};
const match = {
  phase: 'playing', round: 1, rounds: 1, scores: [0, 0], seats: 2, currentSeats: [0],
  turnDeadline: null, intermissionUntil: null, lastRound: null, roundResults: [], result: null, game,
} as MatchView;
function board(patch: Partial<BoardProps> & { playerNames?: string[]; turnRemainingMs?: number | null } = {}) {
  return renderToStaticMarkup(<JinchiBoard match={match} config={config} seat={0} assetUrl={() => ''} {...patch} />);
}

describe('Jinchi board', () => {
  it('returns one pure SVG for server previews, with territory colors and walls', () => {
    const html = board({ staticRender: true });
    expect(html.startsWith('<svg')).toBe(true);
    expect(html.endsWith('</svg>')).toBe(true);
    expect(html).toContain('fill="#0c9b86"');
    expect(html).toContain('fill="#253642"');
    expect(html).not.toMatch(/<button|<foreignObject|jinchi-hud|animation/);
  });

  it('shows readable base numbers in resvg when the preview server loads no system fonts', () => {
    const rendered = new Resvg(board({ staticRender: true }), { fitTo: { mode: 'width', value: 400 }, font: { loadSystemFonts: false } }).render();
    const pixels = rendered.pixels;
    let whitePixels = 0;
    // Base 1 is centered at (89, 89), inside its dark circular marker.
    for (let y = 75; y < 104; y++) for (let x = 78; x < 101; x++) {
      const i = (y * rendered.width + x) * 4;
      if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240) whitePixels++;
    }
    expect(whitePixels).toBeGreaterThan(5);
  });

  it('keeps a 200×200 static map compact by grouping territories instead of making a node per cell', () => {
    const cells = Array.from({ length: 40_000 }, (_, i) => i % 3 === 0 ? -2 : i % 2);
    const large = { ...match, game: { ...game, width: 200, height: 200, cells, bases: Array(40_000).fill(-1) } };
    const html = board({ staticRender: true, match: large });
    expect(html).toContain('200');
    expect((html.match(/<path/g) ?? []).length).toBeLessThan(12);
    expect((html.match(/<rect/g) ?? []).length).toBeLessThan(12);
  });

  it('shows named scores, current turn, dice, server timer and configuration rules in the HUD', () => {
    const html = board({ playerNames: ['Аня', 'Боря'], turnRemainingMs: 12_400 });
    expect(html).toContain('Аня');
    expect(html).toContain('Боря');
    expect(html).toContain('18,2');
    expect(html).toContain('13 с');
    expect(html).toContain('2 × 3');
    expect(html).toContain('Правила');
    expect(html).toContain('d6');
    expect(html).toContain('окружил 3 клетки');
    expect(html).toContain('Повернуть');
    expect(html).toContain('Поставить');
  });

  it('keeps square previews square instead of stretching or letterboxing the map', () => {
    const square = { ...match, game: { ...game, width: 3, height: 3, cells: Array(9).fill(-1), bases: Array(9).fill(-1) } };
    const html = board({ staticRender: true, match: square });
    const size = html.match(/width="([\d.]+)" height="([\d.]+)"/);
    expect(size?.[1]).toBe(size?.[2]);
  });

  it('derives its own countdown from the server clock offset when no countdown was supplied', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    try {
      const html = board({ match: { ...match, turnDeadline: 20_000 }, clockOffset: 3_000 });
      expect(html).toContain('7 с');
    } finally { vi.useRealTimers(); }
  });

  it('does not offer a placement or roll to spectators', () => {
    const html = board({ seat: null });
    expect(html).toContain('Наблюдение');
    expect(html).not.toContain('data-action="place"');
    expect(html).not.toContain('data-action="roll"');
  });

  it('renders the seat icon in its configured color', () => {
    const html = renderToStaticMarkup(<JinchiSeatIcon seat={1} config={config} assetUrl={() => ''} />);
    expect(html).toContain('fill="#eb7654"');
  });
});

describe('MapViewport shared surface', () => {
  it('renders SVG overlays, editor toolbar and minimap using grouped paths', () => {
    const html = renderToStaticMarkup(<MapViewport width={200} height={200} cells={Array(40_000).fill(0)} colors={colors} toolbar={<button>Кисть</button>}><rect data-ghost="true" width={2} height={3} /></MapViewport>);
    expect(html).toContain('Кисть');
    expect(html).toContain('data-ghost="true"');
    expect(html).toContain('aria-label="Миникарта"');
    expect((html.match(/<path/g) ?? []).length).toBeLessThan(10);
    expect(html).toContain('Полный экран');
  });
});

it.each(['#101a2b', '#fff8e9'])('keeps cell boundaries visible on %s maps', (background) => {
  const svg = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={200} height={200} viewBox="0 0 4 4"><MapArtwork width={4} height={4} cells={Array(16).fill(-1)} colors={colors} background={background} grid /></svg>);
  const image = new Resvg(svg).render();
  const pixel = (x: number, y: number) => [...image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
  const edge = pixel(50, 25), center = pixel(25, 25);
  expect(Math.max(...edge.map((c, i) => Math.abs(c - center[i])))).toBeGreaterThan(15);
});
