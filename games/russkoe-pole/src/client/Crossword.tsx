import type { CSSProperties } from "react";
import type { PoleView } from "../game";

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Super game grid: the main word across, the others crossing it. */
export function Crossword({ view, names, colors, seat }: { view: PoleView; names: (i: number) => string; colors: string[]; seat: number | null }) {
  const rows = Math.max(1, ...view.cells.map((cell) => cell.row + 1));
  const cols = Math.max(1, ...view.cells.map((cell) => cell.col + 1));
  const starts = new Map<string, number>();
  view.words.forEach((word, index) => {
    const key = `${word.row}:${word.col}`;
    if (!starts.has(key)) starts.set(key, index + 1);
  });
  const mainIndex = view.words.findIndex((word) => word.main);
  const mine = new Set(view.yours.map((letter) => letter.toLocaleLowerCase("ru-RU")));
  const style = { ["--rows" as string]: rows, ["--cols" as string]: cols } as CSSProperties;
  return (
    <div className="rp-cross-wrap">
      <div className="rp-cross" style={style} role="grid" aria-label="Кроссворд суперигры">
        {view.cells.map((cell) => {
          const owner = cell.words.map((w) => view.words[w]?.owner ?? null).find((o) => o !== null) ?? null;
          const isMain = cell.words.includes(mainIndex);
          const number = starts.get(`${cell.row}:${cell.col}`);
          const secret = cell.open && seat !== null && mine.has(cell.ch.toLocaleLowerCase("ru-RU")) && owner === null;
          return (
            <div
              key={cell.key}
              className={`rp-cell${cell.open ? " is-open" : ""}${isMain ? " is-main" : ""}${owner !== null ? " is-owned" : ""}${secret ? " is-secret" : ""}`}
              style={{ gridRow: cell.row + 1, gridColumn: cell.col + 1, ...(owner !== null ? { ["--oc" as string]: colors[owner] } : {}) }}
            >
              {number !== undefined && <i>{number}</i>}
              <span>{cell.open ? cell.ch : ""}</span>
            </div>
          );
        })}
      </div>
      <ol className="rp-clues">
        {view.words.map((word, index) => (
          <li key={index} className={`${word.main ? "is-main" : ""}${word.owner !== null ? " is-taken" : ""}`}>
            <b>{index + 1}</b>
            <span>
              {word.question || "Без вопроса"}
              <small>
                {word.dir === "h" ? "по горизонтали" : "по вертикали"} · {word.length} {plural(word.length, "буква", "буквы", "букв")}
                {word.main ? " · главное" : ""}
                {view.finalists.length > 1 ? ` · ${word.price}` : ""}
              </small>
            </span>
            {word.owner !== null && (
              <em style={{ background: colors[word.owner] }}>{names(word.owner)}</em>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
