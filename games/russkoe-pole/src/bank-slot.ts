/**
 * The word bank is installed by the server. The site bundle does not import it,
 * so a player cannot search the client for a question and read the answer.
 * Preview on the site uses the tiny fallback below, never a real bank entry.
 */

export interface BankWord {
  question: string;
  answer: string;
}

export interface BankTheme {
  id: string;
  title: string;
  words: BankWord[];
}

export interface WordBank {
  themes: BankTheme[];
  puzzles: { words: BankWord[] }[];
}

/** Sample crossword for previews when the server bank is not installed. Not a bank entry. */
const FALLBACK: WordBank = {
  themes: [],
  puzzles: [
    {
      words: [
        { question: "За ним едят", answer: "СТОЛ" },
        { question: "Ночной отдых", answer: "СОН" },
        { question: "Овощ для супа", answer: "ЛУК" },
      ],
    },
  ],
};

let current: WordBank = FALLBACK;

export function useWordBank(bank: WordBank): void {
  current = bank;
}

export function getWordBank(): WordBank {
  return current;
}

export const BANK_THEME_IDS = ["priroda", "kuhnya", "dom"] as const;
export type BankThemeId = (typeof BANK_THEME_IDS)[number];
