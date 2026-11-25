import { blockDuration, type Block } from "./rules";

/** Shared by the board and the server projection so a player cannot read text ahead of its animation. */
export function blockProgress(block: Block, now: number, startedAt: number): number {
  const duration = (block.effectSeconds ?? blockDuration(block) / 1000) * 1000 || 1;
  return Math.max(0, Math.min(1, (now - startedAt) / duration));
}

export function visibleBlockText(block: Block, progress: number): string {
  const text = block.text ?? "";
  if (block.effect !== "words" && block.effect !== "hidden-words") return text;
  const words = text.split(/\s+/);
  const count = Math.ceil(words.length * progress);
  if (block.effect === "words") return words.slice(0, Math.max(1, count)).join(" ");
  return words.map((word, i) => i < count ? word : "▰".repeat(Math.min(word.length, 7))).join(" ");
}
