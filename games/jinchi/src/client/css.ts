/** Scoped to the game surface; the editor shares only the viewport controls. */
export const JINCHI_CSS = `
.jinchi-board,.jinchi-viewport{--jn-ink:#173c40;--jn-muted:#6d817f;--jn-paper:#fffdf5;--jn-line:#dce5dc;--jn-teal:#138b79;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--jn-ink);box-sizing:border-box}
.jinchi-board *,.jinchi-viewport *{box-sizing:border-box}
.jinchi-board{width:100%;min-width:0}
.jinchi-viewport{position:relative;isolation:isolate;overflow:hidden;width:100%;border:1px solid #cbd9ce;border-radius:22px;background:var(--jn-paper);box-shadow:0 12px 45px #103a3520;outline:none}
.jinchi-viewport:focus-visible{outline:3px solid #55bba6;outline-offset:4px}
.jinchi-viewport button,.jinchi-board button{font:inherit;border:1px solid var(--jn-line);background:#fffef8;color:var(--jn-ink);border-radius:9px;padding:9px 12px;min-height:36px;display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;font-size:12px;font-weight:650;line-height:1.2;transition:background .15s,border-color .15s,box-shadow .15s;white-space:nowrap;margin:0;box-shadow:none}
.jinchi-viewport button:hover:not(:disabled){background:#edf5eb;border-color:#adc6b5}
.jinchi-viewport button:focus-visible,.jinchi-board summary:focus-visible{outline:3px solid #47aa95;outline-offset:2px}
.jinchi-viewport button:disabled{opacity:.38;cursor:default}
.jinchi-viewport .jinchi-primary{color:#fff;background:#177d6f;border-color:#177d6f;box-shadow:0 3px 0 #0e5c51}
.jinchi-viewport .jinchi-primary:hover:not(:disabled){background:#126b5f;border-color:#126b5f}
.jinchi-viewport-toolbar{position:relative;z-index:5;flex-shrink:0}
.jinchi-hud{background:var(--jn-paper)}
.jinchi-hud-top{display:flex;align-items:center;justify-content:space-between;padding:18px 22px 13px;gap:16px}
.jinchi-game-title{display:flex;align-items:center;gap:10px}
.jinchi-monogram{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:#173c40;color:#f5d799;font-size:25px;box-shadow:inset 0 0 0 1px #ffffff25;line-height:1}
.jinchi-game-title strong{display:block;font-size:23px;letter-spacing:-.8px;font-weight:800;line-height:1.05}
.jinchi-game-title div>span{display:block;color:var(--jn-muted);font-size:10px;margin-top:5px;letter-spacing:.15px}
.jinchi-round{display:flex;align-items:center;gap:10px;border:1px solid #dfe6d9;padding:6px 11px;border-radius:9px;background:#f8f8ee}
.jinchi-round span{font-size:9px;font-weight:750;letter-spacing:1.5px;color:var(--jn-muted)}
.jinchi-round b{font-size:19px;font-variant-numeric:tabular-nums;font-weight:750}
.jinchi-scoreboard{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:7px;padding:0 20px 15px}
.jinchi-player{display:flex;align-items:center;gap:8px;position:relative;background:#f3f4eb;border:1px solid transparent;padding:9px 10px;border-radius:11px;min-width:0}
.jinchi-player.is-current{background:color-mix(in srgb,var(--seat-color) 11%,#fffdf5);border-color:var(--seat-color);box-shadow:inset 0 -2px 0 color-mix(in srgb,var(--seat-color) 45%,transparent)}
.jinchi-player-marker{flex-shrink:0;display:grid;place-items:center;width:25px;height:29px;border-radius:7px;background:var(--seat-color);color:#102c30;font-size:11px;font-weight:850;box-shadow:inset 0 0 0 1px #ffffff35}
.jinchi-player-info{min-width:0;flex:1}
.jinchi-player-info>strong{display:flex;align-items:center;gap:4px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.jinchi-player-info>span{display:block;font-size:10px;color:var(--jn-muted);margin-top:3px;font-variant-numeric:tabular-nums}
.jinchi-you{font-size:8px;background:#173c4010;color:var(--jn-muted);border-radius:3px;padding:1px 3px;font-weight:500}
.jinchi-player-score{font-size:18px;line-height:1;text-align:right;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.jinchi-player-score small{display:block;font-size:8px;font-weight:500;color:var(--jn-muted);letter-spacing:0;margin-top:4px}
.jinchi-player.is-eliminated{opacity:.45}
.jinchi-player.is-eliminated .jinchi-player-info>strong{text-decoration:line-through}
.jinchi-turnbar{display:flex;align-items:center;gap:14px;min-height:75px;background:#f1f4e9;border-top:1px solid #e3e8db;border-bottom:1px solid #dce5d7;padding:11px 20px}
.jinchi-turn-status{display:flex;align-items:center;gap:9px;flex:1;min-width:100px}
.jinchi-turn-status>i{width:9px;height:9px;flex-shrink:0;border-radius:50%;background:var(--seat-color);box-shadow:0 0 0 4px color-mix(in srgb,var(--seat-color) 15%,transparent)}
.jinchi-turn-status strong{display:block;font-size:14px;font-weight:750;line-height:1.2}
.jinchi-turn-status div>span{display:block;font-size:10px;color:var(--jn-muted);margin-top:5px;line-height:1.35}
.jinchi-timer{font-weight:750;font-size:15px;font-variant-numeric:tabular-nums;white-space:nowrap;padding:6px 9px;border-radius:8px;background:#e3eada;line-height:1.2}
.jinchi-timer.is-urgent{color:#ad4539;background:#f8dfd3}
.jinchi-dice-pair{display:flex;align-items:center;gap:7px;flex-shrink:0}
.jinchi-dice-pair>span:not(.jinchi-die){color:#8c9b8e;font-size:12px}
.jinchi-die{display:block;width:39px;height:39px;background:#fffdf5;border:1px solid #d0dbcb;border-bottom-width:3px;border-radius:10px;transform:rotate(-5deg);color:var(--seat-color);box-shadow:0 3px 5px #193d3010}
.jinchi-die:nth-of-type(3){transform:rotate(7deg)}
.jinchi-die svg{width:100%;height:100%;display:block}
.jinchi-die.is-waiting{border-style:dashed;color:#a1afa1}
.jinchi-dice-pair .jinchi-dice-size{font-weight:650;font-size:10px;color:var(--jn-muted);margin-left:3px;white-space:nowrap}
.jinchi-placement-actions{display:flex;gap:6px}
.jinchi-placement-actions button{min-height:37px}
.jinchi-placement-actions button>span{font-size:19px;line-height:.6}
.jinchi-utilitybar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 19px;min-height:41px}
.jinchi-utility-start{display:flex;gap:12px;align-items:center;min-width:0}
.jinchi-utility-start button{background:transparent;border-color:transparent;font-size:10px;padding:5px;min-height:27px;border-radius:6px;color:var(--jn-muted)}
.jinchi-utility-start button.is-active{color:#187f68}
.jinchi-utility-start button>span{font-size:16px}
.jinchi-utility-start kbd{background:#e6ece1;border:1px solid #d5dfd0;border-radius:3px;min-width:15px;line-height:15px;font-size:8px;font-family:inherit;font-weight:500;color:#72836c;box-shadow:0 1px 0 #c8d5c3}
.jinchi-placement-message{font-size:10px;color:var(--jn-muted);line-height:1.2;overflow:hidden;text-overflow:ellipsis}
.jinchi-details{display:flex;gap:13px;flex-shrink:0}
.jinchi-details details{position:static;font-size:10px}
.jinchi-details summary{cursor:pointer;list-style:none;color:var(--jn-muted);font-weight:650;padding:6px 0;white-space:nowrap}
.jinchi-details summary::-webkit-details-marker{display:none}
.jinchi-details summary:after{content:'⌄';margin-left:5px}
.jinchi-details details[open] summary{color:#137563}
.jinchi-details summary>span{font-size:8px;display:inline-grid;place-items:center;min-width:15px;height:15px;background:#eaf0e3;border-radius:5px;margin-left:3px}
.jinchi-details-panel{position:absolute;top:100%;right:12px;width:min(440px,calc(100% - 24px));max-height:min(340px,50vh);overflow:auto;background:#fffdf5;color:var(--jn-ink);border:1px solid #c9d8c9;box-shadow:0 14px 35px #112d3250;border-radius:0 0 13px 13px;padding:17px 18px;z-index:15;font-size:12px;line-height:1.6}
.jinchi-details-panel h4{font-size:14px;font-weight:750;margin:0 0 12px}
.jinchi-details-panel ul{margin:0;padding-left:17px;display:block}
.jinchi-details-panel ul li{margin:0 0 10px}
.jinchi-details-panel ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px}
.jinchi-details-panel ol li{display:flex;gap:10px;font-size:11px}
.jinchi-details-panel ol i{font-style:normal;font-size:18px;line-height:1.4;flex-shrink:0;width:20px;text-align:center}
.jinchi-key-help{border-top:1px solid var(--jn-line);padding-top:12px;color:var(--jn-muted);font-size:10px;line-height:1.9;margin-bottom:0}
.jinchi-map-stage{position:relative;height:clamp(340px,54vh,660px);min-height:200px;overflow:hidden;background:radial-gradient(ellipse at 30% 20%,#24434a,#142a30 80%);flex:1}
.jinchi-map{display:block;width:100%;height:100%;touch-action:none;user-select:none;cursor:grab;outline:none}
.jinchi-viewport.is-drawing .jinchi-map{cursor:crosshair}
.jinchi-viewport.is-panning .jinchi-map{cursor:grabbing}
.jinchi-map-caption{pointer-events:none;position:absolute;bottom:12px;left:15px;right:15px;display:flex;justify-content:space-between;color:#a7c0bc;font-size:9px;letter-spacing:1.6px;font-weight:650;opacity:.6}
.jinchi-map-caption span:first-child{font-variant-numeric:tabular-nums;letter-spacing:.5px}
.jinchi-minimap{position:absolute;top:14px;right:14px;width:clamp(95px,15%,160px);border:1px solid #d9e5d645;border-radius:9px;overflow:hidden;background:#173037eb;box-shadow:0 4px 12px #0003;color:#dcebe1}
.jinchi-minimap button.jinchi-minimap-toggle{width:100%;display:flex;justify-content:space-between;padding:6px 8px;min-height:26px;font-size:9px;font-weight:500;border:0;border-radius:0;background:transparent;color:#d2e4dc;gap:5px}
.jinchi-minimap button.jinchi-minimap-toggle:hover{background:#27494b}
.jinchi-minimap-toggle svg{width:11px;height:11px}
.jinchi-minimap-toggle span:nth-child(2){flex:1;text-align:left}
.jinchi-minimap>svg{display:block;width:100%;max-height:150px;cursor:crosshair;touch-action:none;border-top:1px solid #ffffff20}
.jinchi-minimap.is-collapsed{width:95px}
.jinchi-map-controls{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:55px;padding:9px 15px;background:#fffdf5;border-top:1px solid #d8e3d4;flex-shrink:0;overflow-x:auto;scrollbar-width:thin}
.jinchi-control-group{display:flex;align-items:center;gap:3px;flex-shrink:0}
.jinchi-control-group button,.jinchi-map-controls>button{min-height:31px;min-width:31px;border:0;padding:6px 9px;background:transparent;font-size:10px;gap:6px;color:#49645b;border-radius:7px}
.jinchi-control-group:first-child{border:1px solid #dbe3d5;border-radius:9px;background:#f5f6ed;gap:0}
.jinchi-control-group:first-child button{font-size:18px;font-weight:500;padding:2px 8px;min-width:29px}
.jinchi-control-group output{font-size:10px;min-width:38px;text-align:center;color:#6a7d6e;font-variant-numeric:tabular-nums}
.jinchi-map-controls svg{flex-shrink:0}
.jinchi-board-help{font-size:10px;line-height:1.6;text-align:center;color:#859287;margin:12px 5px 0}
.jinchi-board-help span{margin-left:8px;color:#a4ada2}
.jinchi-last-place.has-pop{animation:jinchi-place var(--jinchi-duration,450ms) ease-out;transform-box:fill-box;transform-origin:center}
.jinchi-capture.has-wave{animation:jinchi-wave var(--jinchi-duration,450ms) ease-out both}
.jinchi-hints{opacity:.6}
.jinchi-viewport.is-fullscreen,.jinchi-viewport:fullscreen{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;border:0;border-radius:0;z-index:10000;display:flex;flex-direction:column;overscroll-behavior:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
.jinchi-viewport.is-fullscreen .jinchi-map-stage{height:auto;min-height:0;flex:1}
@keyframes jinchi-place{0%{opacity:0;transform:scale(.85)}70%{opacity:1;transform:scale(1.025)}100%{transform:scale(1)}}
@keyframes jinchi-wave{0%{opacity:0}35%{opacity:1;fill-opacity:.7}100%{opacity:1;fill-opacity:.18}}
@media(max-width:760px){
.jinchi-hud-top{padding:13px 15px 11px}.jinchi-game-title strong{font-size:21px}.jinchi-game-title div>span{font-size:9px}.jinchi-scoreboard{padding:0 13px 12px;gap:5px;grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}.jinchi-player{padding:7px 8px;gap:6px}.jinchi-player-score{font-size:17px}.jinchi-turnbar{padding:11px 14px;gap:10px;flex-wrap:wrap}.jinchi-turn-status{flex-basis:calc(100% - 125px);min-width:110px}.jinchi-turn-status div>span{font-size:9px}.jinchi-dice-pair{margin-left:auto}.jinchi-dice-pair .jinchi-dice-size{display:none}.jinchi-placement-actions{margin-left:auto}.jinchi-utilitybar{padding:6px 13px}.jinchi-utility-start{gap:7px}.jinchi-details{gap:10px}.jinchi-placement-message{font-size:9px;max-width:210px}.jinchi-map-controls{padding:8px 10px;gap:7px}.jinchi-map-controls button span{display:none}.jinchi-map-controls button{padding:7px 9px}.jinchi-map-controls .jinchi-fullscreen span{display:inline}.jinchi-map-stage{height:clamp(320px,50vh,550px)}.jinchi-board-help span{display:none}
}
@media(max-width:430px){
.jinchi-viewport{border-radius:16px}.jinchi-monogram{width:34px;height:34px;font-size:22px;border-radius:10px}.jinchi-game-title div>span{max-width:200px;font-size:8px}.jinchi-round{padding:5px 8px;gap:6px}.jinchi-round span{font-size:8px;letter-spacing:1px}.jinchi-round b{font-size:17px}.jinchi-scoreboard{grid-template-columns:repeat(2,minmax(0,1fr))}.jinchi-player-info>strong{font-size:11px}.jinchi-player-info>span{font-size:9px}.jinchi-player-marker{width:21px;height:25px}.jinchi-turnbar{gap:9px}.jinchi-turn-status{flex:1;min-width:165px}.jinchi-turn-status strong{font-size:13px}.jinchi-turn-status div>span{max-width:180px}.jinchi-die{width:32px;height:32px;border-radius:8px}.jinchi-dice-pair{gap:4px;order:2;margin-left:0}.jinchi-placement-actions{order:3}.jinchi-placement-actions button{font-size:11px;min-height:36px;padding:8px 10px}.jinchi-turnbar>.jinchi-primary{order:3;margin-left:auto;font-size:11px}.jinchi-timer{font-size:13px}.jinchi-utilitybar{gap:7px}.jinchi-placement-message{max-width:125px;font-size:8px}.jinchi-utility-start button{font-size:9px;gap:4px}.jinchi-utility-start kbd{display:none}.jinchi-details{gap:9px}.jinchi-details summary{font-size:9px}.jinchi-map-controls{gap:4px;padding:7px 9px}.jinchi-map-controls .jinchi-fullscreen span{display:none}.jinchi-map-controls button{padding:7px;min-width:29px}.jinchi-control-group{gap:1px}.jinchi-control-group:first-child output{min-width:34px}.jinchi-minimap{top:10px;right:10px;width:90px}.jinchi-minimap>svg{max-height:105px}.jinchi-map-caption span:last-child{font-size:8px}.jinchi-map-stage{height:355px}.jinchi-viewport.is-fullscreen .jinchi-hud-top{padding:8px 12px}.jinchi-viewport.is-fullscreen .jinchi-game-title div>span{display:none}.jinchi-viewport.is-fullscreen .jinchi-scoreboard{padding-bottom:8px}.jinchi-viewport.is-fullscreen .jinchi-player{padding:5px 7px}.jinchi-viewport.is-fullscreen .jinchi-player-score small{display:none}.jinchi-viewport.is-fullscreen .jinchi-turnbar{padding:8px 12px}
}
@media(prefers-reduced-motion:reduce){.jinchi-board *,.jinchi-viewport *{animation:none!important;transition:none!important}}
`;
