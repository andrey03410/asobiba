export const RUSSKOE_POLE_CSS = `
.rp {
  --rp-bg: #1c1410;
  --rp-ink: #f6efe4;
  --rp-muted: #cdbb9f;
  --rp-accent: #e2b54d;
  --rp-panel: rgba(255, 236, 200, 0.07);
  --rp-line: rgba(255, 226, 170, 0.18);
  --rp-board: linear-gradient(180deg, #123a66, #0a2240);
  --rp-board-edge: #e2b54d;
  --rp-tile: linear-gradient(160deg, #2c70b8 0%, #174679 55%, #0e2d55 100%);
  --rp-tile-open: linear-gradient(180deg, #fffdf6, #efe4c8);
  --rp-tile-ink: #1b1209;
  --rp-key: rgba(255, 236, 200, 0.1);
  --rp-btn: linear-gradient(180deg, #f6d987, #cf9a33);
  --rp-btn-ink: #2a1a08;
  --rp-btn-edge: #7a5214;
  --rp-plate: linear-gradient(180deg, #3b2716, #1f140b);
  --rp-glow: rgba(255, 205, 120, 0.22);
  container-type: inline-size;
  position: relative;
  color: var(--rp-ink);
  background:
    radial-gradient(110% 80% at 25% 0%, var(--rp-glow), transparent 55%),
    radial-gradient(90% 70% at 100% 100%, rgba(0, 0, 0, 0.35), transparent 60%),
    var(--rp-bg);
  border-radius: 18px;
  padding: clamp(10px, 2cqi, 22px);
  font-family: "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
  line-height: 1.35;
  -webkit-tap-highlight-color: transparent;
}
.rp.theme-neon {
  --rp-bg: #0b0d1d;
  --rp-ink: #f4f7ff;
  --rp-muted: #a9b0d8;
  --rp-accent: #c37cff;
  --rp-panel: rgba(160, 140, 255, 0.08);
  --rp-line: rgba(180, 160, 255, 0.22);
  --rp-board: linear-gradient(180deg, #150c34, #090718);
  --rp-board-edge: #c37cff;
  --rp-tile: linear-gradient(160deg, #4a2aa0 0%, #241460 60%, #160c3d 100%);
  --rp-tile-open: linear-gradient(180deg, #ffffff, #dff8ff);
  --rp-tile-ink: #120c26;
  --rp-key: rgba(160, 140, 255, 0.12);
  --rp-btn: linear-gradient(180deg, #7ef9ff, #3cc6e8);
  --rp-btn-ink: #071624;
  --rp-btn-edge: #1d6f8a;
  --rp-plate: linear-gradient(180deg, #1f1645, #0f0b24);
  --rp-glow: rgba(195, 124, 255, 0.22);
}
.rp.theme-paper {
  --rp-bg: #f3ead7;
  --rp-ink: #241911;
  --rp-muted: #6e5c46;
  --rp-accent: #8c3b2a;
  --rp-panel: rgba(90, 60, 25, 0.06);
  --rp-line: rgba(90, 60, 25, 0.2);
  --rp-board: linear-gradient(180deg, #fbf6ea, #efe5cf);
  --rp-board-edge: #3a2a17;
  --rp-tile: linear-gradient(160deg, #e2d3b0 0%, #cdb98d 100%);
  --rp-tile-open: linear-gradient(180deg, #ffffff, #fbf6ea);
  --rp-tile-ink: #241911;
  --rp-key: #fffaf0;
  --rp-btn: linear-gradient(180deg, #b0503a, #8c3b2a);
  --rp-btn-ink: #fffaf0;
  --rp-btn-edge: #5a2216;
  --rp-plate: linear-gradient(180deg, #fffaf0, #efe5cf);
  --rp-glow: rgba(255, 255, 255, 0.6);
}
.rp *, .rp *::before, .rp *::after { box-sizing: border-box; }
.rp.is-stage {
  height: 100%;
  border-radius: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

/* ---------- layout ---------- */
.rp-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: "wheel" "main" "players";
  gap: clamp(10px, 2cqi, 20px);
}
.rp-wheelcol { grid-area: wheel; display: flex; flex-direction: column; align-items: center; gap: 10px; min-width: 0; min-height: 0; }
.rp-main { grid-area: main; container-type: inline-size; display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; }
.rp-wheel { position: relative; width: 100%; display: flex; justify-content: center; }
.rp-wheel svg { display: block; width: 100%; height: auto; max-height: 46vh; overflow: visible; }
@container (min-width: 820px) {
  .rp-grid {
    grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr);
    grid-template-areas: "wheel main" "players players";
    align-items: start;
  }
  .rp-wheel svg { max-height: 70vh; }
  .rp.is-stage .rp-grid { height: 100%; grid-template-rows: minmax(0, 1fr) auto; align-items: stretch; }
  .rp.is-stage .rp-wheelcol { justify-content: center; }
  .rp.is-stage .rp-wheel { flex: 1; min-height: 0; align-items: center; }
  .rp.is-stage .rp-wheel svg { height: 100%; max-height: none; }
  .rp.is-stage .rp-main { overflow: auto; padding-right: 4px; justify-content: safe center; }
  /* The super game is about the crossword: the wheel steps back. */
  .rp.is-super .rp-grid { grid-template-columns: minmax(0, 0.62fr) minmax(0, 1.38fr); }
  .rp.is-super .rp-wheel svg { max-height: 52vh; }
}
@container (max-width: 819px) {
  /* On a phone the super game has no use for the wheel: the head chip names the mode. */
  .rp.is-super .rp-wheelcol { display: none; }
}

/* ---------- wheel ---------- */
.rp-wheelcol { background: radial-gradient(closest-side, var(--rp-glow), transparent 75%); }
.rp-lamp { animation: rp-lamp 1.8s ease-in-out infinite; }
.rp-lamp.is-odd { animation-delay: -0.9s; }
.rp-wheel.is-spinning .rp-lamp { animation-duration: 0.5s; animation-delay: calc(var(--i) * -0.035s); }
.rp-sector-text { font-family: "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif; letter-spacing: 0.02em; }
.rp-hub-text { font-family: Georgia, "Times New Roman", serif; letter-spacing: 0.04em; }
@keyframes rp-lamp { 0%, 100% { opacity: 1; } 50% { opacity: 0.28; } }
.rp-plate {
  display: inline-grid;
  justify-items: center;
  min-width: min(260px, 90%);
  padding: 8px 22px 10px;
  border-radius: 14px;
  background: var(--rp-plate);
  border: 2px solid var(--rp-accent);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  text-align: center;
}
.rp-plate-kicker { font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--rp-muted); }
.rp-plate b { font-size: clamp(1.05rem, 3.4cqi, 1.6rem); letter-spacing: 0.04em; text-transform: uppercase; }
.rp.is-spinning .rp-plate b { animation: rp-blink 0.9s ease-in-out infinite; }
@keyframes rp-blink { 50% { opacity: 0.55; } }

/* ---------- board ---------- */
.rp-head { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.rp-chip { display: inline-flex; align-items: center; min-height: 28px; padding: 0 12px; border-radius: 999px; background: var(--rp-panel); border: 1px solid var(--rp-line); font-size: 0.85rem; font-weight: 700; }
.rp-chip.is-gold { background: var(--rp-btn); color: var(--rp-btn-ink); border-color: transparent; }
.rp-chip.is-quiet { color: var(--rp-muted); font-weight: 600; }
.rp-question { margin: 0; text-align: center; font-size: clamp(1.1rem, 4.2cqi, 1.75rem); font-weight: 800; line-height: 1.25; text-wrap: balance; }
.rp-tablo {
  --tile: clamp(24px, min(calc((100cqi - 44px - (var(--longest) - 1) * 6px) / var(--longest)), 8.2vh), 62px);
  padding: clamp(10px, 2.4cqi, 18px);
  border-radius: 18px;
  background: var(--rp-board);
  border: 3px solid var(--rp-board-edge);
  box-shadow: inset 0 0 0 3px rgba(0, 0, 0, 0.35), inset 0 0 40px rgba(0, 0, 0, 0.45), 0 14px 30px rgba(0, 0, 0, 0.35);
}
.rp-tablo-inner { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(var(--tile) * 0.3) calc(var(--tile) * 0.55); }
.rp-word { display: flex; gap: 6px; }
.rp-tile {
  width: var(--tile);
  height: calc(var(--tile) * 1.22);
  display: grid;
  place-items: center;
  border-radius: calc(var(--tile) * 0.12);
  background: var(--rp-tile);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 -3px 0 rgba(0, 0, 0, 0.35), 0 3px 6px rgba(0, 0, 0, 0.35);
  font-weight: 900;
  font-size: calc(var(--tile) * 0.64);
  text-transform: uppercase;
  color: var(--rp-tile-ink);
  transform-style: preserve-3d;
}
.rp-tile.is-open { background: var(--rp-tile-open); box-shadow: 0 0 0 2px rgba(255, 214, 120, 0.45), inset 0 -3px 0 rgba(0, 0, 0, 0.12), 0 3px 10px rgba(0, 0, 0, 0.3); }
.rp-tile.is-new { animation: rp-flip 0.8s ease both; }
.rp-tile.is-pick button { all: unset; width: 100%; height: 100%; display: grid; place-items: center; cursor: pointer; color: rgba(255, 255, 255, 0.75); font-size: calc(var(--tile) * 0.36); border-radius: inherit; }
.rp-tile.is-pick { animation: rp-pulse 1.4s ease-in-out infinite; }
.rp-tile.is-pick button:hover, .rp-tile.is-pick button:focus-visible { background: rgba(255, 220, 140, 0.3); color: #fff; }
@keyframes rp-flip {
  0% { transform: rotateY(0); background: var(--rp-tile); color: transparent; }
  48% { transform: rotateY(90deg); background: var(--rp-tile); color: transparent; }
  52% { transform: rotateY(90deg); background: var(--rp-tile-open); }
  80% { transform: rotateY(-8deg); box-shadow: 0 0 22px 6px rgba(255, 214, 120, 0.75); }
  100% { transform: rotateY(0); }
}
@keyframes rp-pulse { 50% { box-shadow: 0 0 0 3px var(--rp-accent), 0 0 18px var(--rp-accent); } }
.rp-note { margin: 0; text-align: center; font-weight: 700; color: var(--rp-accent); }

/* ---------- controls ---------- */
.rp-controls { display: grid; }
.rp-panel { display: grid; gap: 10px; justify-items: center; text-align: center; padding: clamp(10px, 2.4cqi, 16px); border-radius: 16px; background: var(--rp-panel); border: 1px solid var(--rp-line); }
.rp-panel p { margin: 0; }
.rp-panel-title { font-weight: 800; font-size: clamp(0.98rem, 2.8cqi, 1.15rem); }
.rp-wait p { font-size: 1.05rem; display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.rp-cta p:first-child { font-size: 0.8rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--rp-muted); }
.rp-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.rp-hint { font-size: 0.85rem; color: var(--rp-muted); }
.rp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 42px; padding: 0 18px; border: 0; border-radius: 12px;
  background: var(--rp-btn); color: var(--rp-btn-ink);
  font: inherit; font-weight: 800; cursor: pointer;
  box-shadow: 0 4px 0 var(--rp-btn-edge), 0 10px 18px rgba(0, 0, 0, 0.25);
  transition: transform 0.08s ease, box-shadow 0.08s ease, filter 0.15s ease;
}
.rp-btn:hover { filter: brightness(1.06); }
.rp-btn:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--rp-btn-edge), 0 4px 10px rgba(0, 0, 0, 0.25); }
.rp-btn:disabled { opacity: 0.45; cursor: default; transform: none; }
.rp-btn:focus-visible, .rp-key:focus-visible, .rp-choice:focus-visible, .rp-chest:focus-visible, .rp-chamber:focus-visible { outline: 3px solid var(--rp-accent); outline-offset: 2px; }
.rp-btn.is-big { min-height: 54px; padding: 0 30px; font-size: 1.15rem; animation: rp-call 2.2s ease-in-out infinite; }
.rp-btn.is-ghost { background: transparent; color: inherit; border: 1px solid var(--rp-line); box-shadow: none; animation: none; }
.rp-btn.is-ghost.is-on { border-color: var(--rp-accent); background: var(--rp-panel); }
@keyframes rp-call { 50% { box-shadow: 0 4px 0 var(--rp-btn-edge), 0 0 0 6px color-mix(in srgb, var(--rp-accent) 30%, transparent), 0 10px 18px rgba(0, 0, 0, 0.25); } }
.rp-keys { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 760px; }
.rp-key {
  min-width: clamp(34px, 7.2cqi, 46px); height: clamp(38px, 8cqi, 48px);
  border-radius: 10px; border: 1px solid var(--rp-line);
  background: var(--rp-key); color: inherit;
  font: inherit; font-weight: 900; font-size: clamp(0.95rem, 3cqi, 1.2rem); text-transform: uppercase;
  cursor: pointer; box-shadow: 0 3px 0 rgba(0, 0, 0, 0.35);
  transition: transform 0.06s ease, background 0.15s ease;
}
.rp-key:hover:not(:disabled) { background: color-mix(in srgb, var(--rp-accent) 35%, transparent); }
.rp-key:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 rgba(0, 0, 0, 0.35); }
.rp-key:disabled { cursor: default; box-shadow: none; }
.rp-key.is-hit { background: #2f7d4f; color: #fff; opacity: 0.85; }
.rp-key.is-miss { opacity: 0.38; text-decoration: line-through; }
.rp-key.is-picked { background: var(--rp-btn); color: var(--rp-btn-ink); }
.rp-solve { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; width: 100%; }
.rp-solve input, .rp-answers input {
  flex: 1 1 200px; max-width: 420px; min-height: 44px; padding: 0 14px;
  border-radius: 12px; border: 2px solid var(--rp-line); background: rgba(0, 0, 0, 0.25); color: inherit;
  font: inherit; font-size: 1.1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
}
.rp.theme-paper .rp-solve input, .rp.theme-paper .rp-answers input { background: #fffdf6; }
.rp-solve input:focus, .rp-answers input:focus { outline: none; border-color: var(--rp-accent); }
.rp-choices { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.rp-choice {
  display: grid; justify-items: center; gap: 2px; min-width: 150px; padding: 14px 18px;
  border-radius: 16px; border: 1px solid var(--rp-line); background: var(--rp-key); color: inherit; font: inherit; cursor: pointer;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25); transition: transform 0.12s ease;
}
.rp-choice:hover { transform: translateY(-3px); border-color: var(--rp-accent); }
.rp-choice small { color: var(--rp-muted); }
.rp-choice.is-dark { background: #0b0a0f; color: #f6efe4; }
.rp-choice.is-small { min-width: 0; width: 100%; padding: 8px 10px; box-shadow: none; }
.rp-choice-icon { font-size: 1.9rem; font-weight: 900; color: var(--rp-accent); }
.rp-math { font-size: clamp(1.8rem, 9cqi, 3.2rem); font-weight: 900; letter-spacing: 0.04em; }
.rp-countdown { position: relative; width: min(420px, 100%); height: 14px; border-radius: 999px; background: rgba(0, 0, 0, 0.3); overflow: hidden; }
.rp-countdown i { position: absolute; inset: 0; background: linear-gradient(90deg, #d9432f, #e8b13a, #4fae6b); transform-origin: left; }
.rp-countdown span { position: absolute; right: 8px; top: -2px; font-size: 0.72rem; font-weight: 800; color: #fff; text-shadow: 0 1px 2px #000; }
.rp-drum {
  position: relative; width: 236px; height: 236px; border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #8d8d93, #3c3c42 70%, #26262b);
  border: 6px solid #b9b9c0; box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.6), 0 12px 26px rgba(0, 0, 0, 0.4);
}
.rp-chamber {
  position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px;
  border-radius: 50%; border: 3px solid #1a1a1e; background: radial-gradient(circle at 40% 35%, #2a2a30, #0d0d10);
  color: #f6efe4; font: inherit; cursor: pointer; display: grid; place-content: center; line-height: 1.05;
  transform: rotate(calc(var(--k) * 360deg / var(--n))) translateY(-74px) rotate(calc(var(--k) * -360deg / var(--n)));
  transition: background 0.15s ease;
}
.rp-chamber b { font-size: 1.3rem; }
.rp-chamber small { font-size: 0.62rem; color: #d8c9a8; }
.rp-chamber:hover { background: radial-gradient(circle at 40% 35%, #a33b2b, #4a120b); }
.rp-chests { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
.rp-chest { display: grid; justify-items: center; gap: 4px; border: 0; background: none; color: inherit; font: inherit; font-weight: 800; cursor: pointer; transition: transform 0.15s ease; }
.rp-chest svg { width: 92px; height: auto; filter: drop-shadow(0 8px 10px rgba(0, 0, 0, 0.4)); }
.rp-chest:hover { transform: translateY(-6px) rotate(-3deg); }
.rp-sabotage { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; width: 100%; }
.rp-sabotage-col { display: grid; gap: 6px; flex: 1 1 160px; max-width: 220px; }
.rp-answers { display: grid; gap: 8px; width: min(460px, 100%); }
.rp-answers label { display: grid; gap: 4px; text-align: left; font-size: 0.85rem; color: var(--rp-muted); }
.rp-answers label.is-main span { color: var(--rp-accent); font-weight: 800; }
.rp-answers input { max-width: none; }
.rp-race-words .rp-btn { min-height: 34px; padding: 0 12px; font-size: 0.85rem; }

/* ---------- feed ---------- */
.rp-feed { list-style: none; margin: 0; padding: 10px 14px; border-radius: 14px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--rp-line); display: grid; gap: 3px; font-size: 0.9rem; }
.rp.theme-paper .rp-feed { background: rgba(255, 255, 255, 0.5); }
.rp-feed::before { content: "Ведущий"; font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--rp-muted); }
.rp-feed li { display: flex; align-items: baseline; gap: 6px; opacity: 0.62; }
.rp-feed li.is-last { opacity: 1; font-weight: 700; animation: rp-in 0.35s ease both; }
.rp-feed b { font-weight: 800; }
.rp-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25); }
@keyframes rp-in { from { opacity: 0; transform: translateY(-4px); } }

/* ---------- players ---------- */
.rp-players { grid-area: players; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: 10px; }
.rp-player {
  position: relative; overflow: hidden;
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px;
  padding: 10px 12px 10px 16px; border-radius: 16px;
  background: var(--rp-panel); border: 2px solid var(--rp-line);
  transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
}
.rp-player::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 6px; background: var(--pc); }
.rp-player.is-turn { border-color: var(--pc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pc) 35%, transparent), 0 0 28px color-mix(in srgb, var(--pc) 45%, transparent); transform: translateY(-2px); }
.rp-player.is-out { opacity: 0.45; filter: grayscale(0.6); }
.rp-avatar { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--pc); color: #fff; font-weight: 900; font-size: 1.15rem; box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.25), 0 0 0 2px var(--rp-accent); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
.rp-player-name { display: grid; min-width: 0; }
.rp-player-name b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-player-name small { color: var(--rp-muted); font-size: 0.78rem; min-height: 1em; }
.rp-player.is-turn .rp-player-name small { color: var(--pc); font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
.rp-player-score { display: grid; justify-items: end; }
.rp-player-score b { font-size: clamp(1.15rem, 2.6cqi, 1.5rem); font-variant-numeric: tabular-nums; }
.rp-player-score b.is-rolling { color: var(--rp-accent); }
.rp-player-score small { font-size: 0.72rem; color: var(--rp-muted); }
.rp-lives { position: absolute; right: 10px; top: 4px; font-size: 0.66rem; letter-spacing: 1px; color: #e25b45; }

/* ---------- crossword ---------- */
.rp-cross-wrap { display: grid; gap: 12px; }
@container (min-width: 620px) {
  .rp-cross-wrap { grid-template-columns: auto minmax(0, 1fr); align-items: start; }
  .rp-cross-wrap .rp-cross { --cell: clamp(18px, min(calc((58cqi - 31px - var(--cols) * 3px) / var(--cols)), calc(44vh / var(--rows))), 54px); }
}
.rp-cross {
  /* Width left for cells: the board's padding and border (2 × 17px) and the gaps (3px). */
  --cell: clamp(18px, min(calc((100cqi - 31px - var(--cols) * 3px) / var(--cols)), calc(44vh / var(--rows))), 54px);
  display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); grid-template-rows: repeat(var(--rows), var(--cell));
  gap: 3px; justify-content: center; padding: 14px; border-radius: 18px;
  background: var(--rp-board); border: 3px solid var(--rp-board-edge);
  box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.45), 0 14px 30px rgba(0, 0, 0, 0.35);
}
.rp-cell { position: relative; display: grid; place-items: center; border-radius: 6px; background: var(--rp-tile); color: var(--rp-tile-ink); font-weight: 900; font-size: calc(var(--cell) * 0.56); text-transform: uppercase; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -2px 0 rgba(0, 0, 0, 0.3); }
.rp-cell.is-open { background: var(--rp-tile-open); animation: rp-pop 0.45s ease both; }
.rp-cell.is-main { box-shadow: 0 0 0 2px var(--rp-accent), inset 0 -2px 0 rgba(0, 0, 0, 0.3); }
.rp-cell.is-owned { background: color-mix(in srgb, var(--oc) 55%, #fff); }
.rp-cell.is-secret { box-shadow: 0 0 0 2px var(--rp-me), 0 0 10px var(--rp-me); }
.rp-cell i { position: absolute; left: 3px; top: 1px; font-size: max(8px, calc(var(--cell) * 0.24)); font-style: normal; font-weight: 800; color: var(--rp-accent); }
.rp-cell.is-open i { color: #8c6a1f; }
@keyframes rp-pop { 0% { transform: scale(0.6); } 70% { transform: scale(1.08); } }
.rp-clues { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.rp-clues li { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 8px 12px; border-radius: 12px; background: var(--rp-panel); border: 1px solid var(--rp-line); }
.rp-clues li > b { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--rp-tile); color: #fff; font-size: 0.85rem; }
.rp-clues li.is-main > b { background: var(--rp-btn); color: var(--rp-btn-ink); }
.rp-clues li span { display: grid; }
.rp-clues small { color: var(--rp-muted); font-size: 0.76rem; }
.rp-clues li.is-taken { opacity: 0.7; }
.rp-clues em { font-style: normal; font-weight: 800; font-size: 0.78rem; padding: 2px 10px; border-radius: 999px; color: #fff; }

/* ---------- word reveal, finalists ---------- */
.rp-main { position: relative; }
.rp-reveal {
  all: unset;
  box-sizing: border-box;
  position: absolute;
  z-index: 6;
  inset: 0 0 auto 0;
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: clamp(14px, 3cqi, 24px);
  border-radius: 20px;
  background: var(--rp-board);
  border: 3px solid var(--rp-board-edge);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--rp-accent) 22%, transparent), 0 24px 60px rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  text-align: center;
  animation: rp-reveal-in 0.45s cubic-bezier(.2,.9,.3,1.2) both;
}
.rp-reveal-kicker { font-size: 0.78rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--rp-accent); font-weight: 800; }
.rp-reveal-word { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.rp-reveal-word i {
  --t: clamp(26px, 7cqi, 52px);
  width: var(--t);
  height: calc(var(--t) * 1.2);
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--rp-tile-open);
  color: var(--rp-tile-ink);
  font-style: normal;
  font-weight: 900;
  font-size: calc(var(--t) * 0.62);
  text-transform: uppercase;
  box-shadow: 0 0 0 2px rgba(255, 214, 120, 0.55), 0 4px 12px rgba(0, 0, 0, 0.35);
  animation: rp-flip 0.7s ease both;
}
.rp-reveal-word i.is-gap { width: calc(var(--t) * 0.4); background: none; box-shadow: none; }
.rp-reveal-meta { font-size: 0.95rem; color: rgba(255, 255, 255, 0.82); }
.rp-reveal-meta b { font-weight: 900; }
@keyframes rp-reveal-in { from { opacity: 0; transform: translateY(-12px) scale(0.96); } }
.rp-ready { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.rp-ready li { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: var(--rp-panel); border: 1px solid var(--rp-line); font-weight: 700; font-size: 0.9rem; }
.rp-ready small { color: var(--rp-muted); font-weight: 600; }
.rp-ready li.is-ready { border-color: color-mix(in srgb, var(--rp-accent) 60%, transparent); }
.rp-ready li.is-thinking small { animation: rp-blink 1.2s ease-in-out infinite; }
.rp-attempts { color: var(--rp-accent); }

@media (prefers-reduced-motion: reduce) {
  .rp-lamp, .rp-btn.is-big, .rp-tile.is-pick, .rp-reveal, .rp-reveal-word i, .rp-ready small { animation: none !important; }
}
`;
