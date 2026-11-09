import type { BoardProps, ConfigDocument, SeatIconProps } from "@asobiba/sdk";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PoleAction, PoleView } from "../game";
import { sectorLabel, type PoleRules, type Sector } from "../rules";
import { resolveVisual, type PoleVisual, type ResolvedVisual } from "../visual";
import { Crossword } from "./Crossword";
import { StaticBoard } from "./StaticBoard";
import { Wheel } from "./Wheel";

function rulesOf(config: ConfigDocument): PoleRules {
  return config.rules as PoleRules;
}

function visualOf(config: ConfigDocument): PoleVisual {
  return config.visual as PoleVisual;
}

const SUPER_PHASES = new Set(["offer", "wheel", "letters", "answer", "sk-letters", "sk-sabotage", "race"]);

/** Canonical form for comparing a tile with a called letter. */
function canon(ch: string, yoMerged: boolean): string {
  const low = ch.toLocaleLowerCase("ru-RU");
  return yoMerged && low === "ё" ? "е" : low;
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function useTicker(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return now;
}

/** What a seat is busy with, for the people who wait. */
function doing(phase: string): string {
  switch (phase) {
    case "spin":
      return "крутит барабан";
    case "guess":
      return "называет букву";
    case "plus":
      return "выбирает букву для «Плюса»";
    case "prize":
      return "решает: деньги или чёрный ящик";
    case "detector":
      return "думает о детекторе";
    case "roulette":
      return "заряжает револьвер";
    case "math":
      return "решает пример";
    case "steal":
      return "выбирает, у кого украсть";
    case "swap":
      return "выбирает, с кем меняться";
    case "chests":
      return "выбирает шкатулку";
    case "offer":
      return "решает, играть ли суперигру";
    case "wheel":
      return "крутит барабан суперприза";
    case "letters":
      return "выбирает буквы";
    case "answer":
      return "отгадывает кроссворд";
    default:
      return "ходит";
  }
}

export function RusskoePoleBoard(props: BoardProps) {
  if (props.staticRender) {
    const view = props.match.game as PoleView;
    return <StaticBoard view={view} rules={rulesOf(props.config)} look={resolveVisual(visualOf(props.config))} centerUrl={visualOf(props.config).center ? props.assetUrl(visualOf(props.config).center as string) : undefined} />;
  }
  return <LiveBoard {...props} />;
}

function LiveBoard({ match, config, seat, onAction, playerNames, clockOffset = 0, stage, assetUrl, onHold }: BoardProps) {
  const latest = match.game as PoleView;
  const rules = rulesOf(config);
  const visual = visualOf(config);
  const look = useMemo(() => resolveVisual(visual), [visual]);
  const centerUrl = visual.center ? assetUrl(visual.center) : undefined;

  // Keep the result of a fresh spin off the screen until the wheel stops.
  const [revealed, setRevealed] = useState<number | null>(() => latest.spin?.startedAt ?? null);
  const stable = useRef(latest);
  const spin = latest.spin;
  const spinning = Boolean(spin && !spin.skipped && spin.startedAt !== revealed && Date.now() + clockOffset < spin.startedAt + spin.durationMs);
  if (!spinning) stable.current = latest;
  const view = spinning ? stable.current : latest;
  const spinner = spinning ? stable.current.turn : null;
  // Before paint, so the stage HUD never shows the outcome for a frame.
  const hold = useRef(onHold);
  hold.current = onHold;
  useLayoutEffect(() => {
    hold.current?.(spinning);
  }, [spinning]);
  useLayoutEffect(() => () => hold.current?.(false), []);
  // The wheel this viewer sees: skipping the animation is local, so it works for
  // whoever watches, even when the turn has already moved on.
  const shownSpin = spin && revealed === spin.startedAt && !spin.skipped ? { ...spin, skipped: true } : spin;
  const skipSpin = () => {
    if (!spin) return;
    setRevealed(spin.startedAt);
    // Everybody sees the sector at once only when the spinner still holds the turn.
    if (seat !== null && seat === spinner && match.currentSeats.includes(seat)) onAction?.({ type: "skip-spin" });
  };

  const names = (index: number) => playerNames?.[index] ?? `Игрок ${index + 1}`;
  const acting = spinning ? [] : match.currentSeats;
  const mine = seat !== null && acting.includes(seat) && match.phase === "playing";
  const superOn = view.words.length > 0 && (SUPER_PHASES.has(view.phase) || view.phase === "done");
  const yoMerged = !view.alphabet.includes("ё");
  const sector: Sector | undefined = view.sector !== null ? rules.wheel[view.sector] : undefined;
  // One action per update: a double click must not spin twice or leak a phase change
  // through an error. A refused action unlocks after a moment.
  const sent = useRef<{ view: unknown; at: number } | null>(null);
  const act = (action: PoleAction) => {
    const last = sent.current;
    if (last && last.view === match.game && Date.now() - last.at < 1500) return;
    sent.current = { view: match.game, at: Date.now() };
    onAction?.(action);
  };
  // On a phone the controls sit below the wheel: bring them up when the turn comes.
  const controlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mine || !stage) return;
    controlsRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [mine, stage, view.phase]);

  const style = {
    ...(visual.background ? { ["--rp-bg" as string]: visual.background } : {}),
    ...(visual.ink ? { ["--rp-ink" as string]: visual.ink } : {}),
    ["--rp-me" as string]: seat !== null ? look.players[seat] : look.palette[0],
  } as CSSProperties;

  const plate = spinning ? (
    <>
      <span className="rp-plate-kicker">Барабан крутится</span>
      <b>{spinner !== null ? names(spinner) : ""}</b>
    </>
  ) : superOn ? (
    <>
      <span className="rp-plate-kicker">Суперигра</span>
      <b>{view.finalists.length > 1 ? "Схватка" : view.finalists.map(names).join("")}</b>
    </>
  ) : sector && view.spin ? (
    <>
      <span className="rp-plate-kicker">Сектор</span>
      <b>{sector.type === "points" ? `${sector.value} очков` : sectorLabel(sector)}</b>
    </>
  ) : (
    <>
      <span className="rp-plate-kicker">Ход</span>
      <b>{names(view.turn)}</b>
    </>
  );

  return (
    <section className={`rp theme-${look.theme}${stage ? " is-stage" : ""}${spinning ? " is-spinning" : ""}${superOn ? " is-super" : ""}`} style={style}>
      <div className="rp-grid">
      <div className="rp-wheelcol">
        <Wheel wheel={rules.wheel} look={look} spin={shownSpin} clockOffset={clockOffset} centerUrl={centerUrl} onSettled={setRevealed} />
        <div className="rp-plate" aria-live="polite">
          {plate}
        </div>
      </div>

      <div className="rp-main">
        <header className="rp-head">
          {superOn ? (
            <span className="rp-chip is-gold">Суперигра{view.finalists.length > 1 ? " · Схватка" : ""}</span>
          ) : (
            <span className="rp-chip">
              Раунд {Math.min(view.wordIndex + 1, view.wordCount)} из {view.wordCount}
            </span>
          )}
          {!superOn && view.called.length > 0 && view.showCalled && (
            <span className="rp-chip is-quiet">
              Названо {view.called.length} {plural(view.called.length, "буква", "буквы", "букв")}
            </span>
          )}
        </header>
        <RevealBanner view={view} names={names} colors={look.players} />
        {!superOn && view.question && <h2 className="rp-question">{view.question}</h2>}
        {superOn ? (
          <Crossword view={view} names={names} colors={look.players} seat={seat} />
        ) : (
          <Tablo view={view} pick={mine && view.phase === "plus" ? (index) => act({ type: "plus", index }) : undefined} />
        )}
        {view.players[seat ?? -1]?.note && <p className="rp-note">Вам шепнули: в слове есть буква «{view.players[seat ?? -1]?.note}»</p>}
        <div className="rp-controls" ref={controlsRef}>
          {spinning ? (
            <SpinWait mine={seat !== null && seat === spinner} onSkip={skipSpin} name={spinner !== null ? names(spinner) : ""} />
          ) : mine ? (
            <Controls view={view} rules={rules} sector={sector} seat={seat ?? 0} names={names} yoMerged={yoMerged} act={act} clockOffset={clockOffset} />
          ) : match.phase === "playing" ? (
            <Waiting view={view} acting={acting} names={names} colors={look.players} />
          ) : null}
        </div>
        <HostFeed view={view} names={names} colors={look.players} />
      </div>

      <Players view={view} acting={spinning && spinner !== null ? [spinner] : acting} names={names} colors={look.players} seat={seat} />
      </div>
    </section>
  );
}

/** The word that was just played, shown in full for a few seconds. */
function RevealBanner({ view, names, colors }: { view: PoleView; names: (i: number) => string; colors: string[] }) {
  const reveal = view.reveal;
  const key = reveal ? `${reveal.word}:${reveal.answer}` : null;
  const seen = useRef<string | null>(key);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (key === seen.current) return;
    seen.current = key;
    if (!key) return;
    setShown(key);
    const timer = window.setTimeout(() => setShown(null), 6500);
    return () => window.clearTimeout(timer);
  }, [key]);
  if (!reveal || shown !== key || view.phase === "done") return null;
  return (
    <button type="button" className="rp-reveal" onClick={() => setShown(null)} aria-live="polite" title="Скрыть">
      <span className="rp-reveal-kicker">{reveal.solver !== null ? "Слово отгадано" : "Слово открыто"}</span>
      <span className="rp-reveal-word">
        {[...reveal.answer].map((ch, index) => (
          <i key={index} className={ch === " " ? "is-gap" : undefined} style={{ animationDelay: `${index * 60}ms` }}>
            {ch === " " ? "" : ch}
          </i>
        ))}
      </span>
      <span className="rp-reveal-meta">
        {reveal.question}
        {reveal.solver !== null && (
          <>
            {" · "}
            <b style={{ color: colors[reveal.solver] }}>{names(reveal.solver)}</b>
          </>
        )}
      </span>
    </button>
  );
}

function Tablo({ view, pick }: { view: PoleView; pick?: (index: number) => void }) {
  const prevOpen = useRef<{ word: number; open: Set<number> }>({ word: view.wordIndex, open: new Set() });
  const fresh = new Map<number, number>();
  const known = prevOpen.current.word === view.wordIndex ? prevOpen.current.open : null;
  let order = 0;
  view.tiles.forEach((tile, index) => {
    if (tile.open && tile.ch !== " " && known && !known.has(index)) fresh.set(index, order++);
  });
  useEffect(() => {
    prevOpen.current = { word: view.wordIndex, open: new Set(view.tiles.flatMap((tile, index) => (tile.open ? [index] : []))) };
  });

  const words: { ch: string; open: boolean; index: number }[][] = [];
  let row: { ch: string; open: boolean; index: number }[] = [];
  view.tiles.forEach((tile, index) => {
    if (tile.open && tile.ch === " ") {
      if (row.length) words.push(row);
      row = [];
    } else row.push({ ...tile, index });
  });
  if (row.length) words.push(row);
  const longest = Math.max(4, ...words.map((word) => word.length));

  return (
    <div className="rp-tablo" style={{ ["--longest" as string]: longest }}>
      <div className="rp-tablo-inner">
        {words.map((word, w) => (
          <div className="rp-word" key={w}>
            {word.map((tile) => {
              const delay = fresh.get(tile.index);
              return (
                <div key={tile.index} className={`rp-tile${tile.open ? " is-open" : ""}${delay !== undefined ? " is-new" : ""}${pick && !tile.open ? " is-pick" : ""}`} style={delay !== undefined ? { animationDelay: `${delay * 140}ms` } : undefined}>
                  {pick && !tile.open ? (
                    <button type="button" onClick={() => pick(tile.index)} aria-label={`Открыть букву ${tile.index + 1}`}>
                      {tile.index + 1}
                    </button>
                  ) : (
                    <span>{tile.open ? tile.ch : ""}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpinWait({ mine, onSkip, name }: { mine: boolean; onSkip: () => void; name: string }) {
  return (
    <div className="rp-panel rp-wait">
      <p>{mine ? "Барабан крутится…" : `Крутит ${name}…`}</p>
      <button type="button" className="rp-btn is-ghost" onClick={onSkip}>
        Пропустить анимацию
      </button>
    </div>
  );
}

function Waiting({ view, acting, names, colors }: { view: PoleView; acting: number[]; names: (i: number) => string; colors: string[] }) {
  if (view.phase === "done") return null;
  if (view.phase === "sk-letters" || view.phase === "sk-sabotage" || view.phase === "race") {
    return (
      <div className="rp-panel rp-wait">
        <p>{view.phase === "race" ? "Идёт гонка за слова" : view.phase === "sk-letters" ? "Финалисты тайно выбирают буквы" : "Финалисты готовят пакости"}</p>
        {view.phase !== "race" && (
          <ul className="rp-ready">
            {view.finalists.map((index) => {
              const thinking = acting.includes(index);
              const count = view.chosenCounts[index];
              return (
                <li key={index} className={thinking ? "is-thinking" : "is-ready"}>
                  <i className="rp-dot" style={{ background: colors[index] }} />
                  {names(index)}
                  <small>{thinking ? "думает…" : view.phase === "sk-letters" && typeof count === "number" ? `готово · ${count} ${plural(count, "буква", "буквы", "букв")}` : "готово"}</small>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }
  const who = acting[0] ?? view.turn;
  return (
    <div className="rp-panel rp-wait">
      <p>
        <i className="rp-dot" style={{ background: colors[who] }} />
        <b>{names(who)}</b> {doing(view.phase)}
      </p>
    </div>
  );
}

interface ControlsProps {
  view: PoleView;
  rules: PoleRules;
  sector: Sector | undefined;
  seat: number;
  names: (i: number) => string;
  yoMerged: boolean;
  act: (action: PoleAction) => void;
  clockOffset: number;
}

function Keyboard({ view, yoMerged, onKey, chosen, limit, disabledAll, taken }: { view: PoleView; yoMerged: boolean; onKey: (letter: string) => void; chosen?: string[]; limit?: number; disabledAll?: boolean; taken?: string[] }) {
  const superKeys = taken !== undefined;
  const openLetters = new Set(superKeys ? view.cells.filter((cell) => cell.open).map((cell) => canon(cell.ch, yoMerged)) : view.tiles.filter((tile) => tile.open).map((tile) => canon(tile.ch, yoMerged)));
  return (
    <div className="rp-keys" role="group" aria-label="Буквы">
      {view.alphabet.map((letter) => {
        // In the super game the letters called in the last word mean nothing.
        const used = superKeys ? taken.includes(letter) : view.showCalled && view.called.includes(letter);
        const hit = used && openLetters.has(letter);
        const picked = chosen?.includes(letter) ?? false;
        const full = limit !== undefined && (chosen?.length ?? 0) >= limit && !picked;
        return (
          <button key={letter} type="button" className={`rp-key${used ? (hit ? " is-hit" : " is-miss") : ""}${picked ? " is-picked" : ""}`} disabled={disabledAll || used || full} onClick={() => onKey(letter)}>
            {letter}
          </button>
        );
      })}
    </div>
  );
}

function Solve({ onSolve, label, placeholder }: { onSolve: (text: string) => void; label: string; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <button type="button" className="rp-btn is-ghost" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <form
      className="rp-solve"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSolve(text.trim());
      }}
    >
      <input autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <button type="submit" className="rp-btn">
        Назвать
      </button>
      <button type="button" className="rp-btn is-ghost" onClick={() => setOpen(false)}>
        Отмена
      </button>
    </form>
  );
}

function Countdown({ startedAt, seconds, clockOffset }: { startedAt: number; seconds: number; clockOffset: number }) {
  const now = useTicker(true, 100) + clockOffset;
  // Before the problem opens (a wheel skipped only on this screen) the clock stays full.
  const left = Math.min(seconds * 1000, Math.max(0, startedAt + seconds * 1000 - now));
  const share = Math.min(1, left / (seconds * 1000));
  return (
    <div className="rp-countdown" aria-label={`Осталось ${Math.ceil(left / 1000)} с`}>
      <i style={{ transform: `scaleX(${share})` }} />
      <span>{Math.ceil(left / 1000)} с</span>
    </div>
  );
}

function Controls({ view, rules, sector, seat, names, yoMerged, act, clockOffset }: ControlsProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [claim, setClaim] = useState<number | null>(null);
  const [text, setText] = useState("");
  const phase = view.phase;
  useEffect(() => {
    setPicked([]);
    setText("");
  }, [phase]);

  if (phase === "spin") {
    return (
      <div className="rp-panel rp-cta">
        <p>Ваш ход</p>
        <button type="button" className="rp-btn is-big" onClick={() => act({ type: "spin" })}>
          Крутить барабан
        </button>
      </div>
    );
  }
  if (phase === "guess") {
    const title = sector?.type === "multiplier" ? `Сектор ×${sector.k}: назовите букву` : sector?.type === "points" ? `${sector.value} очков за букву — назовите её` : "Назовите букву";
    return (
      <div className="rp-panel">
        <p className="rp-panel-title">{title}</p>
        <Keyboard view={view} yoMerged={yoMerged} onKey={(letter) => act({ type: "letter", letter })} />
        <div className="rp-row">
          <Solve onSolve={(value) => act({ type: "solve", text: value })} label="Назвать слово целиком" placeholder="Слово целиком" />
        </div>
      </div>
    );
  }
  if (phase === "plus") {
    return (
      <div className="rp-panel">
        <p className="rp-panel-title">Сектор «Плюс»: нажмите на любую закрытую плитку — откроются все такие буквы</p>
      </div>
    );
  }
  if (phase === "prize") {
    const cash = sector?.type === "prize" ? `${sector.min}–${sector.max} очков` : "очки";
    return (
      <div className="rp-panel">
        <p className="rp-panel-title">Приз на барабане! Деньги или чёрный ящик?</p>
        <div className="rp-choices">
          <button type="button" className="rp-choice" onClick={() => act({ type: "prize", choice: "cash" })}>
            <span className="rp-choice-icon" aria-hidden="true">
              ₽
            </span>
            <b>Деньги</b>
            <small>{cash}</small>
          </button>
          <button type="button" className="rp-choice is-dark" onClick={() => act({ type: "prize", choice: "box" })}>
            <span className="rp-choice-icon" aria-hidden="true">
              ?
            </span>
            <b>Чёрный ящик</b>
            <small>случайное событие</small>
          </button>
        </div>
      </div>
    );
  }
  if (phase === "detector") {
    const cost = sector?.type === "prize" ? sector.detectorCost : 0;
    return (
      <div className="rp-panel">
        <p className="rp-panel-title">Детектор знаков за {cost} очков: открыть все цифры и знаки?</p>
        <div className="rp-row">
          <button type="button" className="rp-btn" onClick={() => act({ type: "detector", buy: true })}>
            Купить
          </button>
          <button type="button" className="rp-btn is-ghost" onClick={() => act({ type: "detector", buy: false })}>
            Не надо
          </button>
        </div>
      </div>
    );
  }
  if (phase === "roulette") {
    const cap = sector?.type === "roulette" ? sector.capacity : 6;
    const price = sector?.type === "roulette" ? sector.bulletValue : 0;
    return (
      <div className="rp-panel">
        <p className="rp-panel-title">Русская рулетка: сколько патронов зарядить? +{price} за каждый</p>
        <div className="rp-drum" style={{ ["--n" as string]: cap - 1 }}>
          {Array.from({ length: cap - 1 }, (_, i) => {
            const bullets = i + 1;
            const alive = Math.round(((cap - bullets) / cap) * 100);
            return (
              <button key={bullets} type="button" className="rp-chamber" style={{ ["--k" as string]: i }} onClick={() => act({ type: "roulette", bullets })} title={`Выжить ≈ ${alive}%`}>
                <b>{bullets}</b>
                <small>+{price * bullets}</small>
                <small>{alive}%</small>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (phase === "math" && view.math) {
    return (
      <form
        className="rp-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() !== "") act({ type: "math", value: Number(text.replace(",", ".")) });
        }}
      >
        <p className="rp-panel-title">Сектор «Счёт»: чем быстрее, тем больше множитель</p>
        <p className="rp-math">{view.math.text} = ?</p>
        <Countdown startedAt={view.math.startedAt} seconds={view.math.seconds} clockOffset={clockOffset} />
        <div className="rp-solve">
          <input autoFocus value={text} onChange={(event) => setText(event.target.value)} inputMode="numeric" aria-label="Ответ" placeholder="Ответ" />
          <button type="submit" className="rp-btn">
            Ответить
          </button>
        </div>
      </form>
    );
  }
  if (phase === "steal" || phase === "swap") {
    return (
      <div className="rp-panel">
        <p className="rp-panel-title">{phase === "steal" ? "Кража: у кого забрать очки?" : "Обмен: с кем поменяться очками раунда?"}</p>
        <div className="rp-choices">
          {view.players.map((player, index) =>
            index !== seat && !player.out && !player.outRound ? (
              <button key={index} type="button" className="rp-choice" onClick={() => act({ type: "target", seat: index })}>
                <b>{names(index)}</b>
                <small>{phase === "steal" ? `${player.total} всего` : `${player.round} в раунде`}</small>
              </button>
            ) : null,
          )}
        </div>
      </div>
    );
  }
  if (phase === "chests") {
    return (
      <div className="rp-panel">
        <p className="rp-panel-title">Шкатулки в студию! В одной из них приз</p>
        <div className="rp-chests">
          {Array.from({ length: view.chests ?? 2 }, (_, index) => (
            <button key={index} type="button" className="rp-chest" onClick={() => act({ type: "chest", index })} aria-label={`Шкатулка ${index + 1}`}>
              <svg viewBox="0 0 64 52" aria-hidden="true">
                <rect x="4" y="20" width="56" height="28" rx="4" fill="#7a3f1c" stroke="#e2b54d" strokeWidth="3" />
                <path d="M4 22 Q32 2 60 22 Z" fill="#9a5426" stroke="#e2b54d" strokeWidth="3" />
                <rect x="27" y="22" width="10" height="12" rx="2" fill="#e2b54d" />
              </svg>
              <span>{index + 1}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (phase === "offer") {
    return (
      <div className="rp-panel rp-cta">
        <p className="rp-panel-title">Вы в суперигре! Играете?</p>
        <div className="rp-row">
          <button type="button" className="rp-btn is-big" onClick={() => act({ type: "super", accept: true })}>
            Играю
          </button>
          <button type="button" className="rp-btn is-ghost" onClick={() => act({ type: "super", accept: false })}>
            Забрать очки и уйти
          </button>
        </div>
      </div>
    );
  }
  if (phase === "wheel") {
    return (
      <div className="rp-panel rp-cta">
        <p className="rp-panel-title">Барабан суперприза задаст множитель выигрыша</p>
        <button type="button" className="rp-btn is-big" onClick={() => act({ type: "spin" })}>
          Крутить суперприз
        </button>
      </div>
    );
  }
  if (phase === "letters" || phase === "sk-letters") {
    const limit = view.lettersLeft;
    const buy = rules.super.modifiers.buyLetter && (
      <button type="button" className="rp-btn is-ghost" onClick={() => act({ type: "buy-letter" })}>
        Купить букву за {rules.super.modifiers.buyLetterCost}
      </button>
    );
    const vowels = rules.super.modifiers.vowelLimit > 0 && <p className="rp-hint">Гласных не больше {rules.super.modifiers.vowelLimit}</p>;
    if (phase === "letters" && view.oneByOne) {
      return (
        <div className="rp-panel">
          <p className="rp-panel-title">
            Открывайте буквы по одной · осталось {limit} {plural(limit, "буква", "буквы", "букв")}
          </p>
          <Keyboard view={view} yoMerged={yoMerged} taken={view.yours} disabledAll={limit <= 0} onKey={(letter) => act({ type: "letters", letters: [letter] })} />
          <div className="rp-row">
            <button type="button" className="rp-btn" onClick={() => act({ type: "letters", letters: [] })}>
              {limit > 0 ? "Хватит, к ответу" : "К ответу"}
            </button>
            {buy}
          </div>
          {vowels}
        </div>
      );
    }
    return (
      <div className="rp-panel">
        <p className="rp-panel-title">
          {phase === "sk-letters" ? "Тайно выберите буквы — они откроются только у вас" : "Выберите буквы для открытия"}: {picked.length} из {limit}
        </p>
        <Keyboard view={view} yoMerged={yoMerged} taken={[]} chosen={picked} limit={limit} onKey={(letter) => setPicked(picked.includes(letter) ? picked.filter((item) => item !== letter) : [...picked, letter])} />
        <div className="rp-row">
          <button type="button" className="rp-btn" onClick={() => act({ type: "letters", letters: picked })}>
            {picked.length < limit ? `Открыть ${picked.length}` : "Открыть"}
          </button>
          {picked.length > 0 && (
            <button type="button" className="rp-btn is-ghost" onClick={() => setPicked([])}>
              Сбросить
            </button>
          )}
          {buy}
        </div>
        {vowels}
      </div>
    );
  }
  if (phase === "answer") {
    return <AnswerForm view={view} attempts={rules.super.attempts} act={act} />;
  }
  if (phase === "sk-sabotage") {
    const rivals = view.finalists.filter((index) => index !== seat);
    const cost = rules.super.sabotage.cost;
    const kinds: { kind: "freeze" | "fog" | "peek"; title: string; note: string }[] = [
      { kind: "freeze", title: "Заморозка", note: `старт на ${rules.super.sabotage.freezeSeconds} с позже` },
      { kind: "fog", title: "Туман", note: "закрыть одну его букву" },
      { kind: "peek", title: "Подглядеть", note: "увидеть его буквы" },
    ];
    return (
      <div className="rp-panel">
        <p className="rp-panel-title">Пакость сопернику — {cost} очков. Все пакости раскроются разом</p>
        <div className="rp-sabotage">
          {rivals.map((target) => (
            <div key={target} className="rp-sabotage-col">
              <b>{names(target)}</b>
              {kinds.map((item) => (
                <button key={item.kind} type="button" className="rp-choice is-small" onClick={() => act({ type: "sabotage", kind: item.kind, target })}>
                  <b>{item.title}</b>
                  <small>{item.note}</small>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="rp-row">
          <button type="button" className="rp-btn" onClick={() => act({ type: "sabotage", kind: "shield" })}>
            Щит
          </button>
          <button type="button" className="rp-btn is-ghost" onClick={() => act({ type: "sabotage", kind: "none" })}>
            Без пакостей
          </button>
        </div>
      </div>
    );
  }
  if (phase === "race") {
    const me = view.players[seat];
    const free = view.words.map((word, index) => ({ word, index })).filter((item) => item.word.owner === null);
    const target = claim !== null && view.words[claim]?.owner === null ? claim : (free[0]?.index ?? null);
    return (
      <RaceForm
        target={target}
        free={free.map((item) => ({ index: item.index, label: item.word.main ? "Главное" : `Слово ${item.index + 1}`, length: item.word.length, price: item.word.price }))}
        onPick={setClaim}
        pausedUntil={me?.pausedUntil ?? 0}
        raceEndsAt={view.raceEndsAt}
        clockOffset={clockOffset}
        onClaim={(word, value) => act({ type: "claim", word, text: value })}
      />
    );
  }
  return null;
}

function AnswerForm({ view, attempts, act }: { view: PoleView; attempts: number; act: (action: PoleAction) => void }) {
  const [values, setValues] = useState<string[]>(() => view.words.map(() => ""));
  return (
    <form
      className="rp-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const answers = values.map((value) => value.trim());
        if (answers[0]) act({ type: "answer", answers });
      }}
    >
      <p className="rp-panel-title">
        Назовите слова. Главное решает суперигру, остальные дают бонус
        {attempts > 1 && <span className="rp-attempts"> · {view.attemptsLeft > 1 ? `попыток: ${view.attemptsLeft}` : "последняя попытка"}</span>}
      </p>
      <div className="rp-answers">
        {view.words.map((word, index) => (
          <label key={index} className={word.main ? "is-main" : undefined}>
            <span>
              {index + 1}. {word.main ? "Главное" : "Бонус"} · {word.length} {plural(word.length, "буква", "буквы", "букв")}
            </span>
            <input value={values[index] ?? ""} autoFocus={index === 0} onChange={(event) => setValues(values.map((value, i) => (i === index ? event.target.value : value)))} />
          </label>
        ))}
      </div>
      <button type="submit" className="rp-btn is-big">
        Ответить
      </button>
    </form>
  );
}

function RaceForm({ target, free, onPick, pausedUntil, raceEndsAt, clockOffset, onClaim }: { target: number | null; free: { index: number; label: string; length: number; price: number }[]; onPick: (index: number) => void; pausedUntil: number; raceEndsAt: number; clockOffset: number; onClaim: (word: number, text: string) => void }) {
  const [text, setText] = useState("");
  const now = useTicker(true, 200) + clockOffset;
  const paused = pausedUntil > now;
  return (
    <form
      className="rp-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (target !== null && text.trim() && !paused) {
          onClaim(target, text.trim());
          setText("");
        }
      }}
    >
      <p className="rp-panel-title">Гонка! Первый верный ответ забирает слово{raceEndsAt > 0 ? ` · осталось ${Math.max(0, Math.ceil((raceEndsAt - now) / 1000))} с` : ""}</p>
      <div className="rp-row rp-race-words">
        {free.map((item) => (
          <button key={item.index} type="button" className={`rp-btn is-ghost${item.index === target ? " is-on" : ""}`} onClick={() => onPick(item.index)}>
            {item.label} · {item.length} · {item.price}
          </button>
        ))}
      </div>
      <div className="rp-solve">
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder={paused ? `Пауза ${Math.ceil((pausedUntil - now) / 1000)} с` : "Ответ на выбранное слово"} disabled={paused || target === null} aria-label="Ответ" />
        <button type="submit" className="rp-btn" disabled={paused || target === null}>
          Забрать
        </button>
      </div>
    </form>
  );
}

function HostFeed({ view, names, colors }: { view: PoleView; names: (i: number) => string; colors: string[] }) {
  const items = [...view.events].reverse().slice(0, 5);
  if (items.length === 0) return null;
  return (
    <ol className="rp-feed" aria-label="Ведущий">
      {items.map((event, i) => (
        <li key={event.id} className={i === 0 ? "is-last" : undefined}>
          {event.seat !== null && <i className="rp-dot" style={{ background: colors[event.seat] }} />}
          {event.seat !== null && <b>{names(event.seat)}:</b>} {event.text}
        </li>
      ))}
    </ol>
  );
}

function Players({ view, acting, names, colors, seat }: { view: PoleView; acting: number[]; names: (i: number) => string; colors: string[]; seat: number | null }) {
  return (
    <ol className="rp-players">
      {view.players.map((player, index) => {
        const turn = acting.includes(index) && view.phase !== "done";
        const status = player.out ? "выбыл" : player.outRound ? "вне раунда" : turn ? "ходит" : view.finalists.includes(index) && SUPER_PHASES.has(view.phase) ? "финалист" : "";
        return (
          <li key={index} className={`rp-player${turn ? " is-turn" : ""}${player.out || player.outRound ? " is-out" : ""}${index === seat ? " is-me" : ""}`} style={{ ["--pc" as string]: colors[index] }}>
            <span className="rp-avatar" aria-hidden="true">
              {names(index).slice(0, 1).toLocaleUpperCase("ru-RU")}
            </span>
            <span className="rp-player-name">
              <b>{names(index)}</b>
              <small>
                {index === seat ? "вы" : ""}
                {index === seat && status ? " · " : ""}
                {status}
              </small>
            </span>
            <span className="rp-player-score">
              <Score value={player.total + player.round} />
              {player.round > 0 && <small>+{player.round} в раунде</small>}
            </span>
            {player.lives > 0 && (
              <span className="rp-lives" title={`Жизней: ${player.lives}`}>
                {"♥".repeat(Math.min(player.lives, 6))}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Rolls the number towards its new value. */
function Score({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    if (begin === value) return;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      const v = Math.round(begin + (value - begin) * (1 - (1 - t) ** 3));
      setShown(v);
      from.current = v;
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <b className={shown !== value ? "is-rolling" : undefined}>{shown.toLocaleString("ru-RU")}</b>;
}

export function RusskoePoleSeatIcon({ config, seat, size = 28 }: SeatIconProps): ReactNode {
  const visual = resolveVisual(visualOf(config));
  return <SeatGlyph look={visual} seat={seat} size={size} />;
}

function SeatGlyph({ look, seat, size }: { look: ResolvedVisual; seat: number; size: number }) {
  const color = look.players[seat] ?? "#888";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" fill={color} stroke="#e2b54d" strokeWidth="2" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <line key={i} x1={16} y1={16} x2={16 + Math.cos(a) * 13} y2={16 + Math.sin(a) * 13} stroke="rgba(255,255,255,.35)" strokeWidth="1.2" />;
      })}
      <circle cx="16" cy="16" r="4" fill="#e2b54d" />
    </svg>
  );
}
