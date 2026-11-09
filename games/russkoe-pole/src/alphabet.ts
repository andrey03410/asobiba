/** Letters a config may offer, and the comparison key of a guess. */

const RU = [..."абвгдежзийклмнопрстуфхцчшщъыьэюя"];
const EN = [..."abcdefghijklmnopqrstuvwxyz"];
const DIGITS = [..."0123456789"];

export interface AlphabetRules {
  sets: ReadonlyArray<"ru" | "en" | "digits">;
  yoAsYe: boolean;
  extra: string;
  revealNonAlphabet: boolean;
}

export function canonChar(char: string, yoAsYe: boolean): string {
  const lower = char.toLocaleLowerCase("ru-RU");
  if (yoAsYe && lower === "ё") return "е";
  return lower;
}

export function canonText(text: string, yoAsYe: boolean): string {
  return [...text.trim()].map((char) => canonChar(char, yoAsYe)).join("");
}

/** Guessable symbols, in keyboard order, without duplicates. */
export function alphabetChars(rules: AlphabetRules): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (char: string) => {
    const key = canonChar(char, rules.yoAsYe);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  if (rules.sets.includes("ru")) for (const char of RU) push(char);
  if (rules.sets.includes("ru") && !rules.yoAsYe) push("ё");
  if (rules.sets.includes("en")) for (const char of EN) push(char);
  if (rules.sets.includes("digits")) for (const char of DIGITS) push(char);
  for (const char of rules.extra) if (char.trim()) push(char);
  return out;
}

export function alphabetSet(rules: AlphabetRules): Set<string> {
  return new Set(alphabetChars(rules));
}

const VOWELS = new Set([..."аеёиоуыэюяaeiouy"]);

export function isVowel(char: string, yoAsYe: boolean): boolean {
  return VOWELS.has(canonChar(char, yoAsYe));
}

/** A character the player cannot name from the keyboard. */
export function isForeignLetter(char: string, letters: Set<string>, yoAsYe: boolean): boolean {
  if (char.trim() === "") return false;
  const key = canonChar(char, yoAsYe);
  if (letters.has(key)) return false;
  return /\p{L}|\p{N}/u.test(char);
}
