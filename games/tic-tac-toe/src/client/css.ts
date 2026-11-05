/** Animations of the tic-tac-toe board. Parameters come from --d (duration) and --k (intensity). */
export const TIC_TAC_TOE_CSS = `
.ttt-svg { display: block; width: 100%; height: auto; user-select: none; -webkit-tap-highlight-color: transparent; }
.ttt-anim { transform-box: fill-box; transform-origin: center; }
.ttt-hit { fill: transparent; }
.ttt-hit.is-legal { cursor: pointer; }
.ttt-hit.is-legal:hover { fill: var(--ttt-highlight); fill-opacity: 0.45; }
.ttt-hit.is-hint { fill: var(--ttt-highlight); fill-opacity: 0.18; }

.place-pop { animation: ttt-pop var(--d) cubic-bezier(.2,.9,.3,1.4) both; }
.place-drop { animation: ttt-drop var(--d) cubic-bezier(.4,0,.7,1) both; }
.place-spin { animation: ttt-spin var(--d) ease-out both; }
.place-bounce { animation: ttt-bounce var(--d) ease-out both; }
.place-wobble { animation: ttt-wobble var(--d) ease-out both; }
.place-zoom { animation: ttt-zoom var(--d) ease-out both; }
@keyframes ttt-pop { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes ttt-drop { from { transform: translateY(calc(-140px * var(--k))); opacity: 0; } 40% { opacity: 1; } to { transform: translateY(0); } }
@keyframes ttt-spin { from { transform: rotate(calc(-360deg * var(--k))) scale(.2); opacity: 0; } to { transform: rotate(0deg) scale(1); opacity: 1; } }
@keyframes ttt-bounce {
  0% { transform: translateY(calc(-70px * var(--k))) scale(.6); opacity: 0; }
  45% { transform: translateY(0) scale(calc(1 + .18 * var(--k)), calc(1 - .18 * var(--k))); opacity: 1; }
  65% { transform: translateY(calc(-16px * var(--k))) scale(1); }
  82% { transform: translateY(0) scale(calc(1 + .06 * var(--k)), calc(1 - .06 * var(--k))); }
  100% { transform: none; }
}
@keyframes ttt-wobble {
  0% { transform: scale(0); }
  30% { transform: scale(calc(1 + .3 * var(--k)), calc(1 - .22 * var(--k))); }
  50% { transform: scale(calc(1 - .16 * var(--k)), calc(1 + .16 * var(--k))); }
  70% { transform: scale(calc(1 + .08 * var(--k)), calc(1 - .06 * var(--k))); }
  100% { transform: scale(1); }
}
@keyframes ttt-zoom { from { transform: scale(calc(1 + 1.6 * var(--k))); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.idle-breathe { animation: ttt-breathe var(--d) ease-in-out infinite; }
.idle-float { animation: ttt-float var(--d) ease-in-out infinite; }
.idle-jiggle { animation: ttt-jiggle var(--d) ease-in-out infinite; }
.idle-sway { animation: ttt-sway var(--d) ease-in-out infinite; }
@keyframes ttt-breathe { 50% { transform: scale(calc(1 + .07 * var(--k))); } }
@keyframes ttt-float { 50% { transform: translateY(calc(-7px * var(--k))); } }
@keyframes ttt-jiggle { 25% { transform: rotate(calc(-7deg * var(--k))); } 75% { transform: rotate(calc(7deg * var(--k))); } }
@keyframes ttt-sway { 25% { transform: translateX(calc(-5px * var(--k))); } 75% { transform: translateX(calc(5px * var(--k))); } }

.win-pulse { animation: ttt-pulse var(--d) ease-in-out infinite; }
.win-glow { animation: ttt-glow var(--d) ease-in-out infinite; }
.win-shake { animation: ttt-shake var(--d) linear infinite; }
.win-rainbow { animation: ttt-rainbow var(--d) linear infinite; }
.win-confetti { animation: ttt-pulse var(--d) ease-in-out infinite; }
@keyframes ttt-pulse { 50% { transform: scale(calc(1 + .22 * var(--k))); } }
@keyframes ttt-glow { 50% { filter: drop-shadow(0 0 calc(10px * var(--k)) var(--ttt-winline)); } }
@keyframes ttt-shake {
  10%, 30%, 50%, 70%, 90% { transform: translateX(calc(-5px * var(--k))) rotate(calc(-5deg * var(--k))); }
  20%, 40%, 60%, 80% { transform: translateX(calc(5px * var(--k))) rotate(calc(5deg * var(--k))); }
}
@keyframes ttt-rainbow { to { filter: hue-rotate(360deg); } }

.ttt-winline.is-animated { stroke-dasharray: 3000; stroke-dashoffset: 3000; animation: ttt-draw .7s ease-out forwards; }
@keyframes ttt-draw { to { stroke-dashoffset: 0; } }

.ttt-confetti-bit { animation: ttt-fall var(--d) cubic-bezier(.3,.1,.7,1) both; transform-box: fill-box; transform-origin: center; }
@keyframes ttt-fall {
  from { transform: translateY(0) rotate(0deg); opacity: 1; }
  to { transform: translateY(var(--fall)) rotate(calc(540deg * var(--k))); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ttt-svg *, .ttt-svg *::before { animation: none !important; }
}
`;
