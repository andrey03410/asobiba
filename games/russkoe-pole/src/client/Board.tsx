import type { BoardProps, ConfigDocument, SeatIconProps } from "@asobiba/sdk";
import { useEffect, useState } from "react";
import { sectorColor, type PoleAction, type PoleView } from "../game";
import { sectorLabel, type PoleRules, type Sector } from "../rules";
import { resolveVisual, type PoleVisual } from "../visual";

function rulesOf(config: ConfigDocument): PoleRules {
  return config.rules as PoleRules;
}

function visualOf(config: ConfigDocument): PoleVisual {
  return config.visual as PoleVisual;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 80);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function ease(t: number): number {
  return 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
}

function Wheel({ view, rules, visual, now, offset, staticRender }: { view: PoleView; rules: PoleRules; visual: PoleVisual; now: number; offset: number; staticRender?: boolean }) {
  const n = Math.max(1, rules.wheel.length);
  const sweep = (Math.PI * 2) / n;
  const spin = view.spin;
  const elapsed = spin ? now + offset - spin.startedAt : 0;
  const t = !spin || staticRender || spin.skipped ? 1 : elapsed / spin.durationMs;
  const stop = spin ? -((spin.sector + 0.5) * 360) / n : 0;
  const angle = ease(t) * (360 * 5 + stop);
  const show = Boolean(spin) && (staticRender || spin?.skipped || elapsed >= (spin?.durationMs ?? 0) - 1500);
  const sector = spin ? rules.wheel[spin.sector] : undefined;
  const paths = rules.wheel.map((item, index) => {
    const a0 = index * sweep - Math.PI / 2;
    const a1 = a0 + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = 100 + Math.cos(a0) * 86;
    const y0 = 100 + Math.sin(a0) * 86;
    const x1 = 100 + Math.cos(a1) * 86;
    const y1 = 100 + Math.sin(a1) * 86;
    return { d: `M 100 100 L ${x0} ${y0} A 86 86 0 ${large} 1 ${x1} ${y1} Z`, fill: sectorColor(visual, index, item.color) };
  });
  return (
    <div className="rp-wheel">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <g transform={`rotate(${angle} 100 100)`}>
          {paths.map((path) => (
            <path key={path.d} d={path.d} fill={path.fill} stroke="rgba(0,0,0,.35)" strokeWidth="0.6" />
          ))}
          <circle cx="100" cy="100" r="28" fill={resolveVisual(visual).background} stroke="rgba(255,255,255,.4)" />
        </g>
      </svg>
      <div className="rp-arrow" />
      {show && sector && <div className="rp-window">{sectorLabel(sector as Sector)}</div>}
    </div>
  );
}

function send(onAction: BoardProps["onAction"], action: PoleAction) {
  onAction?.(action);
}

export function RusskoePoleBoard({ match, config, seat, onAction, staticRender, playerNames, clockOffset }: BoardProps) {
  const view = match.game as PoleView;
  const rules = rulesOf(config);
  const visual = resolveVisual(visualOf(config));
  const now = useNow(!staticRender && Boolean(view.spin && !view.spin.skipped));
  const mine = seat !== null && match.currentSeats.includes(seat);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [claim, setClaim] = useState(0);
  if (staticRender) return <StaticBoard view={view} rules={rules} visual={visualOf(config)} />;

  const words: { ch: string; open: boolean; index: number }[][] = [];
  let row: { ch: string; open: boolean; index: number }[] = [];
  view.tiles.forEach((tile, index) => {
    if (tile.open && tile.ch === " ") {
      words.push(row);
      row = [];
    } else row.push({ ...tile, index });
  });
  if (row.length > 0) words.push(row);
  const superOn = view.words.length > 0 && ["offer", "wheel", "letters", "answer", "sk-letters", "sk-sabotage", "race", "done"].includes(view.phase);
  const note = view.players[seat ?? -1]?.note;

  return (
    <section className="rp" style={{ background: visual.background, color: visual.ink, ["--rp-me" as string]: seat !== null ? visual.players[seat] : visual.ink }}>
      <div className="rp-top">
        <Wheel view={view} rules={rules} visual={visualOf(config)} now={now} offset={clockOffset ?? 0} />
        <div>
          {!superOn && <p className="rp-question">Слово {view.wordIndex + 1} из {view.wordCount}</p>}
          {view.question && <p className="rp-question">{view.question}</p>}
          {superOn ? <Crossword view={view} /> : (
            <div className="rp-tiles">
              {words.map((group, groupIndex) => (
                <div className="rp-word" key={groupIndex}>
                  {group.map((tile) => (
                    <div key={tile.index} className={`rp-tile${tile.open ? " is-open" : ""}${visual.tile === "flip" && tile.open ? " rp-flip" : ""}`}>
                      {mine && view.phase === "plus" && !tile.open ? (
                        <button type="button" onClick={() => send(onAction, { type: "plus", index: tile.index })}>+</button>
                      ) : (
                        tile.ch
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {note && <p className="rp-note">Подсказка: {note}</p>}
        </div>
      </div>
      <div className="rp-players">
        {view.players.map((player, index) => (
          <div key={index} className={`rp-player${match.currentSeats.includes(index) ? " is-turn" : ""}${player.out ? " is-out" : ""}`} style={{ borderColor: match.currentSeats.includes(index) ? visual.players[index] : undefined }}>
            <span>{playerNames?.[index] ?? `Игрок ${index + 1}`}</span>
            <b>{player.total}{player.round ? ` +${player.round}` : ""}{player.lives > 0 ? ` · ♥${player.lives}` : ""}</b>
          </div>
        ))}
      </div>
      {mine && <Controls view={view} rules={rules} text={text} setText={setText} picked={picked} setPicked={setPicked} claim={claim} setClaim={setClaim} onAction={onAction} seat={seat ?? 0} />}
      <ol className="rp-log">
        {view.events.map((event) => (
          <li key={event.id}>{event.text}</li>
        ))}
      </ol>
    </section>
  );
}

function Crossword({ view }: { view: PoleView }) {
  const rows = view.cells.map((cell) => cell.row);
  const cols = view.cells.map((cell) => cell.col);
  const width = (Math.max(...cols, 0) + 1) * 36;
  const height = (Math.max(...rows, 0) + 1) * 36;
  return (
    <div>
      <ul className="rp-log">
        {view.words.map((word, index) => (
          <li key={index}>{word.main ? "Главное. " : ""}{word.question || "Без вопроса"}{word.owner !== null ? " — забрано" : ""}</li>
        ))}
      </ul>
      <div className="rp-cross" style={{ width, height }}>
        {view.cells.map((cell) => (
          <div key={cell.key} className={`rp-cell${cell.open ? " is-open" : ""}`} style={{ left: cell.col * 36, top: cell.row * 36 }}>
            {cell.ch}
          </div>
        ))}
      </div>
      {view.phase === "race" && <p className="rp-note">Назовите слово в поле ниже: первое верное забирает его.</p>}
    </div>
  );
}

function Controls({ view, rules, text, setText, picked, setPicked, claim, setClaim, onAction, seat }: { view: PoleView; rules: PoleRules; text: string; setText: (value: string) => void; picked: string[]; setPicked: (value: string[]) => void; claim: number; setClaim: (value: number) => void; onAction: BoardProps["onAction"]; seat: number }) {
  const act = (action: PoleAction) => send(onAction, action);
  if (view.phase === "spin") {
    return (
      <div className="rp-actions">
        <button type="button" onClick={() => act({ type: "spin" })}>Крутить</button>
        {view.spin && !view.spin.skipped && <button type="button" onClick={() => act({ type: "skip-spin" })}>Дальше</button>}
      </div>
    );
  }
  if (view.phase === "guess") {
    return (
      <div>
        <div className="rp-keys">
          {view.alphabet.map((letter) => (
            <button key={letter} type="button" disabled={view.showCalled && view.called.includes(letter)} onClick={() => act({ type: "letter", letter })}>
              {letter}
            </button>
          ))}
        </div>
        <form className="rp-form" onSubmit={(event) => { event.preventDefault(); if (text.trim()) act({ type: "solve", text }); }}>
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Слово целиком" aria-label="Слово целиком" />
          <button type="submit">Назвать</button>
        </form>
      </div>
    );
  }
  if (view.phase === "prize") return <div className="rp-actions"><button type="button" onClick={() => act({ type: "prize", choice: "cash" })}>Деньги</button><button type="button" onClick={() => act({ type: "prize", choice: "box" })}>Чёрный ящик</button></div>;
  if (view.phase === "detector") return <div className="rp-actions"><button type="button" onClick={() => act({ type: "detector", buy: true })}>Купить детектор</button><button type="button" onClick={() => act({ type: "detector", buy: false })}>Не надо</button></div>;
  if (view.phase === "roulette") {
    const sector = view.sector !== null ? rules.wheel[view.sector] : undefined;
    const cap = sector?.type === "roulette" ? sector.capacity : 6;
    return <div className="rp-actions">{Array.from({ length: cap }, (_, index) => <button key={index} type="button" onClick={() => act({ type: "roulette", bullets: index + 1 })}>{index + 1}</button>)}</div>;
  }
  if (view.phase === "math") {
    return (
      <form className="rp-form" onSubmit={(event) => { event.preventDefault(); act({ type: "math", value: Number(text) }); }}>
        <b>{view.math?.text}</b>
        <input value={text} onChange={(event) => setText(event.target.value)} inputMode="numeric" aria-label="Ответ примера" />
        <button type="submit">Ответить</button>
      </form>
    );
  }
  if (view.phase === "steal" || view.phase === "swap") {
    return <div className="rp-actions">{view.players.map((_, index) => index !== seat && !view.players[index]?.out ? <button key={index} type="button" onClick={() => act({ type: "target", seat: index })}>Игрок {index + 1}</button> : null)}</div>;
  }
  if (view.phase === "chests") return <div className="rp-actions">{Array.from({ length: view.chests ?? 2 }, (_, index) => <button key={index} type="button" onClick={() => act({ type: "chest", index })}>Шкатулка {index + 1}</button>)}</div>;
  if (view.phase === "offer") return <div className="rp-actions"><button type="button" onClick={() => act({ type: "super", accept: true })}>Играть</button><button type="button" onClick={() => act({ type: "super", accept: false })}>Отказаться</button></div>;
  if (view.phase === "wheel") return <div className="rp-actions"><button type="button" onClick={() => act({ type: "spin" })}>Крутить суперприз</button></div>;
  if (view.phase === "letters" || view.phase === "sk-letters") {
    return (
      <div>
        <div className="rp-keys">
          {view.alphabet.map((letter) => (
            <button key={letter} type="button" disabled={picked.includes(letter) || picked.length >= view.lettersLeft} onClick={() => setPicked([...picked, letter])}>{letter}</button>
          ))}
        </div>
        <div className="rp-actions">
          <span>{picked.join(" ") || "Буквы не выбраны"}</span>
          <button type="button" onClick={() => setPicked([])}>Сбросить</button>
          <button type="button" onClick={() => act({ type: "letters", letters: picked })}>Открыть</button>
          {rules.super.modifiers.buyLetter && <button type="button" onClick={() => act({ type: "buy-letter" })}>Купить букву</button>}
        </div>
      </div>
    );
  }
  if (view.phase === "answer" || view.phase === "race") {
    return (
      <form className="rp-form" onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        if (view.phase === "race") act({ type: "claim", word: claim, text });
        else act({ type: "solve", text });
      }}>
        {view.phase === "race" && (
          <select value={claim} onChange={(event) => setClaim(Number(event.target.value))} aria-label="Какое слово">
            {view.words.map((word, index) => (
              <option key={index} value={index} disabled={word.owner !== null}>
                {word.main ? "Главное" : `Слово ${index + 1}`}
                {word.question ? `: ${word.question}` : ""}
              </option>
            ))}
          </select>
        )}
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder={view.phase === "race" ? "Ответ на выбранное слово" : "Основное слово, бонусные через запятую"} aria-label="Ответ" />
        <button type="submit">Ответить</button>
      </form>
    );
  }
  if (view.phase === "sk-sabotage") {
    const rivals = view.finalists.filter((index) => index !== seat);
    return (
      <div className="rp-actions">
        <button type="button" onClick={() => act({ type: "sabotage", kind: "none" })}>Без пакости</button>
        <button type="button" onClick={() => act({ type: "sabotage", kind: "shield" })}>Щит</button>
        {rivals.map((target) => (
          <span key={target}>
            <button type="button" onClick={() => act({ type: "sabotage", kind: "freeze", target })}>Заморозить {target + 1}</button>
            <button type="button" onClick={() => act({ type: "sabotage", kind: "fog", target })}>Туман {target + 1}</button>
            <button type="button" onClick={() => act({ type: "sabotage", kind: "peek", target })}>Подглядеть {target + 1}</button>
          </span>
        ))}
      </div>
    );
  }
  return null;
}

function StaticBoard({ view, rules, visual }: { view: PoleView; rules: PoleRules; visual: PoleVisual }) {
  const look = resolveVisual(visual);
  const n = Math.max(1, rules.wheel.length);
  const sweep = (Math.PI * 2) / n;
  const stop = view.spin ? -((view.spin.sector + 0.5) * 360) / n : 0;
  return (
    <svg viewBox="0 0 768 480" xmlns="http://www.w3.org/2000/svg">
      <rect width="768" height="480" fill={look.background} />
      <g transform={`translate(40 40) rotate(${stop + 360 * 5} 100 100)`}>
        {rules.wheel.map((sector, index) => {
          const a0 = index * sweep - Math.PI / 2;
          const a1 = a0 + sweep;
          const x0 = 100 + Math.cos(a0) * 90;
          const y0 = 100 + Math.sin(a0) * 90;
          const x1 = 100 + Math.cos(a1) * 90;
          const y1 = 100 + Math.sin(a1) * 90;
          return <path key={index} d={`M 100 100 L ${x0} ${y0} A 90 90 0 ${sweep > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`} fill={sectorColor(visual, index, sector.color)} />;
        })}
        <circle cx="100" cy="100" r="28" fill={look.background} />
      </g>
      {view.tiles.slice(0, 24).map((tile, index) => (
        <rect key={index} x={280 + (index % 12) * 38} y={70 + Math.floor(index / 12) * 48} width="32" height="40" rx="4" fill={tile.open ? look.ink : "rgba(255,255,255,.16)"} />
      ))}
      {view.players.map((player, index) => (
        <rect key={index} x={40 + index * 140} y={400} width="120" height="36" rx="8" fill={player.out ? "#666" : look.players[index] ?? look.ink} />
      ))}
    </svg>
  );
}

export function RusskoePoleSeatIcon({ config, seat, size = 28 }: SeatIconProps) {
  const visual = resolveVisual(visualOf(config));
  const color = visual.players[seat] ?? "#888";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill={color} />
      <path d="M16 4 A12 12 0 0 1 26 16 L16 16 Z" fill="rgba(255,255,255,.35)" />
    </svg>
  );
}
