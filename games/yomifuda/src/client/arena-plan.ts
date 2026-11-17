import { compileVideo, createVideoDocument, type AssetManifest, type VideoNode, type Rect } from '@douga/video';
import type { YomifudaView, YomifudaVisual } from '../index';

export function palette(theme: YomifudaVisual['theme']) {
  return theme === 'paper' ? { bg: '#eee9dd', card: '#fffcf2', ink: '#302d40', muted: '#665d71', line: '#cec3b3' }
    : theme === 'sakura' ? { bg: '#251625', card: '#3a2339', ink: '#fff0f6', muted: '#d3afc5', line: '#63405d' }
    : { bg: '#101322', card: '#1d233a', ink: '#f4f1ff', muted: '#b1b6d2', line: '#363e5d' };
}
export function revealProgress(view: YomifudaView, now: number) {
  if (view.phase !== 'reveal') return 1;
  return Math.max(0, Math.min(1, (now - (view.revealStartedAt ?? now)) / Math.max(1, (view.revealEndsAt ?? now + 10000) - (view.revealStartedAt ?? now))));
}
export function displayedScores(view: YomifudaView, now: number) {
  const hide = view.phase === 'reveal' && revealProgress(view, now) < .66;
  return view.players.map(p => p.score - (hide ? view.table.reduce((sum, t) => sum + (t.seat === p.seat && !t.hidden ? t.points : 0), 0) : 0));
}
/** Only the authorized view crosses this boundary. No config, rules or raw deck. */
export function buildArena(view: YomifudaView, visual: YomifudaVisual, assetUrl: (id: string) => string, names: string[] = [], wide = false, viewport?: { width: number; height: number }) {
  const colors = palette(visual.theme);
  const doc = createVideoDocument({ kind: 'top', id: 'yomifuda-arena', title: 'Ёмифуда', participants: [], format: wide ? 'wide' : 'square', fps: 30 });
  const duration = Math.max(1, ((view.revealEndsAt ?? 10000) - (view.revealStartedAt ?? 0)) / 1000);
  const open = view.phase !== 'choose';
  const animate = open && !visual.reducedMotion;
  const portraitAt = animate ? duration * .08 : 0;
  const countAt = animate ? duration * .22 : 0;
  const valueAt = duration * .44;
  const winnerAt = duration * .66;
  const manifest: AssetManifest = {};
  const nodes: VideoNode[] = [];
  const unit = wide ? 1920 : 1080;
  const text = (id: string, value: string, rect: Rect, size: number, color = colors.ink, at = 0, until = duration) => {
    nodes.push({ id, type: 'text', text: value, rect, style: { color, fontSize: size * unit / 1080 }, timing: { at: { sec: at }, duration: { sec: Math.max(1 / 30, until - at) } } });
  };
  const shape = (id: string, rect: Rect, fill: string, stroke?: string, at = 0, until = duration, ellipse = false) => {
    nodes.push({ id, type: 'shape', shape: ellipse ? 'ellipse' : 'rect', rect, fill, stroke, strokeWidth: stroke ? 2 : 0, style: { borderRadius: 22 }, timing: { at: { sec: at }, duration: { sec: Math.max(1 / 30, until - at) } } });
  };
  for (let i = 0; i < 5; i++) {
    nodes.push({ id: `moon-${i}`, type: 'shape', shape: 'ellipse', rect: { x: .5 - i * .1, y: .4 - i * .08, width: .2 + i * .2, height: .2 + i * .16 }, fill: 'transparent', stroke: colors.line, strokeWidth: 1, opacity: .45 });
  }
  const compact = view.players.length > 3 && (viewport?.width ?? 342) <= 600;
  const renderScale = Math.min((viewport?.width ?? 342) / unit, (viewport?.height ?? 342) / 1080);
  const renderWidth = unit * renderScale, renderHeight = 1080 * renderScale;
  const pxRect = (x: number, y: number, width: number, height: number): Rect => ({ x: x / renderWidth, y: y / renderHeight, width: width / renderWidth, height: height / renderHeight });
  const pxText = (id: string, value: string, rect: Rect, size: number, color = colors.ink, at = 0, until = duration) => text(id, value, rect, size * 1080 / renderWidth, color, at, until);
  const cols = Math.min(3, view.players.length);
  const rows = Math.ceil(view.players.length / cols);
  const availableH = .84 / rows;
  // Keep configured scaling within the slot so six cards never overlap.
  const scale = .78 + (visual.cardScale - .7) / .6 * .22;
  const w = .88 / cols * scale;
  const h = Math.min(availableH * .88, wide ? .76 : .68) * scale;
  view.players.forEach((player, i) => {
    if (compact) {
      // Two columns of horizontal cards use the whole native viewport. Sizes are
      // chosen in displayed CSS pixels, then converted to the fixed Douga frame.
      const rows = Math.ceil(view.players.length / 2), gap = 6, margin = 4;
      const cw = (renderWidth - margin * 2 - gap) / 2;
      const ch = (renderHeight - margin * 2 - gap * (rows - 1)) / rows;
      const cx = margin + (i % 2) * (cw + gap), cy = margin + Math.floor(i / 2) * (ch + gap);
      const rect = pxRect(cx, cy, cw, ch);
      const photoWidth = Math.min(52, Math.max(40, 44 * visual.cardScale));
      const face = pxRect(cx + 4, cy + 4, photoWidth, ch - 8);
      const tx = cx + photoWidth + 9, tw = cw - photoWidth - 13;
      const table = view.table.find(t => t.seat === player.seat);
      const card = open && table && !table.hidden ? table : null;
      shape(`slot-${i}`, rect, colors.card, colors.line);
      if (!card) {
        if (table) shape(`back-${i}`, rect, colors.card, visual.accent, 0, duration);
        pxText(`back-sign-${i}`, table ? '遊' : '·', face, 30, visual.accent);
        pxText(`waiting-${i}`, table ? 'На столе' : 'Выбирает', pxRect(tx, cy + ch / 2 - 13, tw, 26), 12, colors.muted);
      } else {
        const backUntil = Math.max(1 / 30, portraitAt);
        shape(`back-${i}`, rect, colors.card, visual.accent, 0, backUntil);
        pxText(`back-sign-${i}`, '遊', face, 30, visual.accent, 0, backUntil);
        if (card.card.image) {
          const id = `portrait-${i}`;
          manifest[id] = { id, kind: 'image', src: assetUrl(card.card.image.asset) };
          nodes.push({ id, type: 'image', asset: id, rect: face, style: { fit: 'cover', borderRadius: 18 }, timing: { at: { sec: portraitAt }, duration: { sec: duration - portraitAt } },
            ...(animate ? { animation: [{ property: 'opacity', keyframes: [{ at: { sec: 0 }, value: 0 }, { at: { sec: .65 }, value: 1 }] }] } : {}) });
        } else {
          shape(`portrait-fallback-${i}`, face, colors.line, undefined, portraitAt);
          pxText(`portrait-monogram-${i}`, card.card.name.slice(0, 1), face, 26, visual.accent, portraitAt);
        }
        const nameHeight = Math.min(36, ch - 25);
        pxText(`name-${i}`, card.card.name, pxRect(tx, cy, tw, nameHeight), 11.5, colors.ink, portraitAt);
        const valueRect = pxRect(tx, cy + nameHeight, tw * .57, ch - nameHeight - 2);
        if (animate) for (let step = 0; step < 12; step++) {
          const at = countAt + (valueAt - countAt) * step / 12;
          pxText(`count-${i}-${step}`, String(Math.round(card.value * step / 12)), valueRect, 19, visual.accent, at, countAt + (valueAt - countAt) * (step + 1) / 12);
        }
        pxText(`value-final-${i}`, String(card.value), valueRect, 19, visual.accent, animate ? valueAt : 0);
        if (card.tieTotal !== undefined) {
          const tieRect = pxRect(cx + 4, cy + ch - 20, photoWidth, 16);
          shape(`tie-plate-${i}`, tieRect, colors.bg, undefined, duration * .52);
          pxText(`tie-${i}`, `Σ ${card.tieTotal}`, tieRect, 10.5, '#ffe3a0', duration * .52);
        }
        if (card.winner) {
          shape(`winner-border-${i}`, rect, 'transparent', '#f6cc79', winnerAt);
          pxText(`winner-${i}`, `+${card.points} ✦`, pxRect(tx + tw * .57, cy + nameHeight, tw * .43, ch - nameHeight - 2), 12, '#f6cc79', winnerAt);
        }
      }
      // The same number appears in the HUD, so truncated account names are unambiguous.
      const seatRect = pxRect(cx + 5, cy + 5, 16, 16);
      shape(`seat-plate-${i}`, seatRect, colors.bg);
      pxText(`seat-${i}`, String(player.seat + 1), seatRect, 11, colors.ink);
      return;
    }
    const col = i % cols, row = Math.floor(i / cols);
    const x = .06 + col * .88 / cols + (.88 / cols - w) / 2;
    const y = .06 + row * availableH + (availableH * .88 - h) / 2;
    const r = { x, y, width: w, height: h };
    const table = view.table.find(t => t.seat === player.seat);
    const card = open && table && !table.hidden ? table : null;
    shape(`slot-${i}`, r, colors.card, colors.line);
    text(`seat-${i}`, names[player.seat] || `Игрок ${player.seat + 1}`, { x, y: y + h + .012, width: w, height: .045 }, rows > 1 ? 26 : 32, colors.muted);
    if (!table) {
      text(`waiting-${i}`, 'Выбирает', { x, y: y + h * .45, width: w, height: .07 }, 31, colors.muted);
      return;
    }
    const backUntil = card ? Math.max(1 / 30, portraitAt) : duration;
    shape(`back-${i}`, { x: x + .012, y: y + .014, width: w - .024, height: h - .028 }, colors.card, visual.accent, 0, backUntil);
    for (let j = 0; j < 4; j++) {
      shape(`back-ring-${i}-${j}`, { x: x + w * (.2 + j * .05), y: y + h * (.25 + j * .05), width: w * (.6 - j * .1), height: h * (.5 - j * .1) }, 'transparent', visual.accent, 0, backUntil, true);
    }
    text(`back-sign-${i}`, '遊', { x, y: y + h * .37, width: w, height: h * .23 }, 85, visual.accent, 0, backUntil);
    if (!card) return;
    const face = { x: x + .012, y: y + .014, width: w - .024, height: h * .59 };
    if (card.card.image) {
      const id = `portrait-${i}`;
      manifest[id] = { id, kind: 'image', src: assetUrl(card.card.image.asset) };
      nodes.push({ id, type: 'image', asset: id, rect: face, style: { fit: 'cover', borderRadius: 18 }, timing: { at: { sec: portraitAt }, duration: { sec: duration - portraitAt } },
        ...(animate ? { animation: [{ property: 'opacity', keyframes: [{ at: { sec: 0 }, value: 0 }, { at: { sec: .65 }, value: 1 }] }, { property: 'scale', easing: 'easeOut', keyframes: [{ at: { sec: 0 }, value: .88 }, { at: { sec: .9 }, value: 1 }] }] } : {}) });
    } else {
      shape(`portrait-fallback-${i}`, face, colors.line, undefined, portraitAt);
      text(`portrait-monogram-${i}`, card.card.name.slice(0, 1), { x, y: y + h * .15, width: w, height: h * .3 }, 112, visual.accent, portraitAt);
    }
    const nameSize = rows > 1 ? 27 : 32;
    text(`name-${i}`, card.card.name, { x: x + .012, y: y + h * .6, width: w - .024, height: h * .14 }, nameSize, colors.ink, portraitAt);
    text(`anime-${i}`, card.card.anime, { x: x + .012, y: y + h * .74, width: w - .024, height: h * .09 }, rows > 1 ? 20 : 23, colors.muted, portraitAt);
    const valueRect = { x: x + .02, y: y + h * .83, width: w - .04, height: h * .14 };
    if (animate) for (let step = 0; step < 12; step++) {
      const at = countAt + (valueAt - countAt) * step / 12;
      text(`count-${i}-${step}`, String(Math.round(card.value * step / 12)), valueRect, rows > 1 ? 40 : 58, visual.accent, at, countAt + (valueAt - countAt) * (step + 1) / 12);
    }
    text(`value-final-${i}`, String(card.value), valueRect, rows > 1 ? 40 : 58, visual.accent, animate ? valueAt : 0);
    if (card.tieTotal !== undefined) text(`tie-${i}`, `Σ ${card.tieTotal}`, { x, y: y + .015, width: w, height: .045 }, 27, '#ffe3a0', duration * .52);
    if (card.winner) {
      shape(`winner-border-${i}`, r, 'transparent', '#f6cc79', winnerAt);
      text(`winner-${i}`, `+${card.points}  ✦`, { x, y: Math.max(0, y - .047), width: w, height: .045 }, 34, '#f6cc79', winnerAt);
    }
  });
  // Native custom nodes inherit card paint, including their HTML wrapper.
  // Keep wrappers transparent: late outline layers must never hide portraits.
  doc.formatSettings = undefined;
  doc.settings = { background: colors.bg, card: { color: colors.ink, background: 'transparent', borderWidth: 0, borderColor: 'transparent', gradient: null, shadow: null }, labels: { mode: 'never' } };
  doc.scenes = [{ id: `battle-${view.round}`, block: 'custom', duration: { sec: duration }, nodes }];
  return compileVideo(doc, manifest);
}
