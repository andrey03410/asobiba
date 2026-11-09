export const RUSSKOE_POLE_CSS = `
.rp {
  --rp-bg: #1c1410;
  --rp-ink: #f6efe4;
  display: grid;
  gap: 14px;
  color: var(--rp-ink);
  background: var(--rp-bg);
  border-radius: 18px;
  padding: 14px;
  min-height: 420px;
}
.rp-top { display: grid; grid-template-columns: minmax(180px, 280px) 1fr; gap: 16px; align-items: center; }
.rp-wheel { position: relative; width: min(100%, 280px); margin: 0 auto; }
.rp-wheel svg { width: 100%; height: auto; display: block; }
.rp-arrow { position: absolute; left: 50%; top: 2px; transform: translateX(-50%); width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-top: 16px solid #fff8ea; filter: drop-shadow(0 2px 0 rgba(0,0,0,.45)); }
.rp-window { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); min-width: 92px; padding: 8px 12px; border-radius: 12px; background: #fff8ea; color: #24170f; text-align: center; font-weight: 800; letter-spacing: .04em; box-shadow: 0 10px 24px rgba(0,0,0,.28); }
.rp-question { margin: 0; font-size: 1.15rem; text-align: center; }
.rp-tiles, .rp-cross { display: flex; flex-wrap: wrap; gap: 8px 14px; justify-content: center; }
.rp-word { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
.rp-tile { width: 36px; height: 44px; border-radius: 6px; background: rgba(255,255,255,.08); display: grid; place-items: center; font-weight: 800; font-size: 1.15rem; perspective: 200px; }
.rp-tile.is-open { background: #fff8ea; color: #24170f; }
.rp-tile.is-open.rp-flip { animation: rp-flip .55s ease; }
.rp-tile button { all: unset; cursor: pointer; width: 100%; height: 100%; display: grid; place-items: center; }
.rp-cross { position: relative; margin: 0 auto; }
.rp-cell { position: absolute; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 4px; background: rgba(255,255,255,.08); font-weight: 800; }
.rp-cell.is-open { background: #fff8ea; color: #24170f; }
.rp-players { display: flex; flex-wrap: wrap; gap: 8px; }
.rp-player { flex: 1 1 140px; display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,.06); border: 2px solid transparent; }
.rp-player.is-turn { border-color: var(--rp-me, #fff); }
.rp-player.is-out { opacity: .45; }
.rp-keys { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
.rp-keys button, .rp-actions button, .rp-form button { border: 0; border-radius: 8px; padding: 6px 8px; background: rgba(255,255,255,.12); color: inherit; font: inherit; cursor: pointer; }
.rp-keys button:disabled { opacity: .35; text-decoration: line-through; cursor: default; }
.rp-actions, .rp-form { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.rp-form input, .rp-form select { border-radius: 8px; border: 0; padding: 8px; }
.rp-log { max-height: 120px; overflow: auto; margin: 0; padding-left: 18px; font-size: .92rem; opacity: .9; }
.rp-note { text-align: center; font-weight: 700; }
@keyframes rp-flip { from { transform: rotateX(90deg); } to { transform: rotateX(0); } }
@media (max-width: 720px) {
  .rp-top { grid-template-columns: 1fr; }
  .rp-tile { width: 30px; height: 38px; }
}
`;
