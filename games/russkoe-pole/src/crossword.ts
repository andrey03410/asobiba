/** Automatic crossword: the first word is the main horizontal, the rest cross it. */

export interface LayoutWord {
  question: string;
  answer: string;
}

export interface PlacedWord extends LayoutWord {
  dir: "h" | "v";
  row: number;
  col: number;
  main: boolean;
}

export interface LayoutCell {
  key: string;
  ch: string;
  row: number;
  col: number;
  words: number[];
}

function place(existing: Map<string, string>, answer: string, dir: "h" | "v", row: number, col: number): boolean {
  const cells: { key: string; ch: string; fresh: boolean }[] = [];
  for (let i = 0; i < answer.length; i++) {
    const r = row + (dir === "v" ? i : 0);
    const c = col + (dir === "h" ? i : 0);
    const key = `${r},${c}`;
    const prev = existing.get(key);
    if (prev !== undefined && prev !== answer[i]) return false;
    cells.push({ key, ch: answer[i] ?? "", fresh: prev === undefined });
  }
  const beforeR = row + (dir === "v" ? -1 : 0);
  const beforeC = col + (dir === "h" ? -1 : 0);
  const afterR = row + (dir === "v" ? answer.length : 0);
  const afterC = col + (dir === "h" ? answer.length : 0);
  if (existing.has(`${beforeR},${beforeC}`) || existing.has(`${afterR},${afterC}`)) return false;
  for (const cell of cells) {
    if (!cell.fresh) continue;
    const [r, c] = cell.key.split(",").map(Number) as [number, number];
    const sides = dir === "h" ? [`${r - 1},${c}`, `${r + 1},${c}`] : [`${r},${c - 1}`, `${r},${c + 1}`];
    if (sides.some((key) => existing.has(key))) return false;
  }
  if (!cells.some((cell) => !cell.fresh) && existing.size > 0) return false;
  return true;
}

function findSpot(existing: Map<string, string>, hosts: PlacedWord[], answer: string): { dir: "h" | "v"; row: number; col: number } | null {
  for (const host of hosts) {
    for (let h = 0; h < host.answer.length; h++) {
      for (let w = 0; w < answer.length; w++) {
        if (host.answer[h] !== answer[w]) continue;
        const dir: "h" | "v" = host.dir === "h" ? "v" : "h";
        const row = host.dir === "h" ? host.row - w : host.row + h;
        const col = host.dir === "h" ? host.col + h : host.col - w;
        if (place(existing, answer, dir, row, col)) return { dir, row, col };
      }
    }
  }
  return null;
}

/** Uppercases answers. Returns null when a word shares no letter with the rest. */
export function layoutCrossword(words: LayoutWord[]): PlacedWord[] | null {
  if (words.length === 0) return null;
  const prepared = words.map((word) => ({
    question: word.question.trim(),
    answer: word.answer.trim().toLocaleUpperCase("ru-RU"),
  }));
  if (prepared.some((word) => word.answer.length === 0)) return null;
  const placed: PlacedWord[] = [{ ...prepared[0]!, dir: "h", row: 0, col: 0, main: true }];
  const map = new Map<string, string>();
  for (let i = 0; i < placed[0]!.answer.length; i++) map.set(`0,${i}`, placed[0]!.answer[i] ?? "");
  for (let i = 1; i < prepared.length; i++) {
    const word = prepared[i]!;
    const spot = findSpot(map, placed, word.answer);
    if (!spot) return null;
    placed.push({ ...word, ...spot, main: false });
    for (let k = 0; k < word.answer.length; k++) {
      const r = spot.row + (spot.dir === "v" ? k : 0);
      const c = spot.col + (spot.dir === "h" ? k : 0);
      map.set(`${r},${c}`, word.answer[k] ?? "");
    }
  }
  const minR = Math.min(...placed.map((word) => word.row));
  const minC = Math.min(...placed.map((word) => word.col));
  return placed.map((word) => ({ ...word, row: word.row - minR, col: word.col - minC }));
}

export function crosswordCells(words: PlacedWord[]): LayoutCell[] {
  const byKey = new Map<string, LayoutCell>();
  words.forEach((word, index) => {
    for (let i = 0; i < word.answer.length; i++) {
      const row = word.row + (word.dir === "v" ? i : 0);
      const col = word.col + (word.dir === "h" ? i : 0);
      const key = `${row},${col}`;
      const prev = byKey.get(key);
      if (prev) prev.words.push(index);
      else byKey.set(key, { key, ch: word.answer[i] ?? "", row, col, words: [index] });
    }
  });
  return [...byKey.values()];
}

export function distinctLetters(words: PlacedWord[], canon: (char: string) => string): number {
  const set = new Set<string>();
  for (const word of words) for (const char of word.answer) if (/\p{L}|\p{N}/u.test(char)) set.add(canon(char));
  return set.size;
}
