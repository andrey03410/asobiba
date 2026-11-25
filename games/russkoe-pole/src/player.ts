import type { PlayerActionForm } from "@asobiba/sdk";
import type { PoleView } from "./game";

export function polePlayerActions(view: PoleView, seat: number): PlayerActionForm[] {
  if (view.you !== seat || !view.input || view.result) return [];
  const actions = phaseInputs(view, seat, view.input);
  if (view.spin && !view.spin.skipped) actions.push({ type: "skip-spin" });
  return actions;
}

function phaseInputs(view: PoleView, seat: number, limits: NonNullable<PoleView["input"]>): PlayerActionForm[] {
  const text = { type: "string", minLength: 1, maxLength: 80 };
  switch (view.phase) {
    case "spin":
    case "wheel":
      return [{ type: "spin" }];
    case "guess": {
      const solve = { type: "solve", fields: { text } };
      if (limits.mustSolve) return [solve];
      return [{ type: "letter", fields: { letter: { enum: view.alphabet.filter(l => !view.called.includes(l)) } } }, solve];
    }
    case "plus":
      return view.tiles.flatMap((tile, index) => tile.open ? [] : [{ type: "plus", fields: { index } }]);
    case "prize":
      return [{ type: "prize", fields: { choice: { enum: ["cash", "box"] } } }];
    case "detector":
      return [{ type: "detector", fields: { buy: limits.canDetect ? { type: "boolean" } : false } }];
    case "roulette":
      return [{ type: "roulette", fields: { bullets: { type: "integer", minimum: 1, maximum: limits.capacity } } }];
    case "math":
      return [{ type: "math", fields: { value: { type: "number" } } }];
    case "steal":
    case "swap":
      return view.players.flatMap((p, i) => i === seat || p.out || p.outRound ? [] : [{ type: "target", fields: { seat: i } }]);
    case "chests":
      return Array.from({ length: view.chests ?? 0 }, (_, index) => ({ type: "chest", fields: { index } }));
    case "offer":
      return [{ type: "super", fields: { accept: { type: "boolean" } } }];
    case "letters":
    case "sk-letters":
      return [{ type: "letters", fields: { letters: { type: "array", items: { enum: view.alphabet },
        maxItems: view.phase === "letters" && view.oneByOne ? Math.min(view.lettersLeft, 1) : view.lettersLeft } } },
        ...(limits.canBuy ? [{ type: "buy-letter" }] : [])];
    case "answer":
      return [{ type: "answer", fields: { answers: { type: "array", items: { type: "string", maxLength: 60 }, minItems: 1, maxItems: view.words.length } },
        description: "Ответы по порядку слов кроссворда. Главное слово первое." }];
    case "sk-sabotage":
      return [{ type: "sabotage", fields: { kind: "none" } }, ...(limits.canSabotage
        ? [{ type: "sabotage", fields: { kind: "shield" } }, { type: "sabotage", fields: {
          kind: { enum: ["freeze", "fog", "peek"] }, target: { enum: view.finalists.filter(i => i !== seat) },
        } }] : [])];
    case "race":
      return view.words.flatMap((word, i) => word.owner === null
        ? [{ type: "claim", fields: { word: i, text: { type: "string", minLength: 1, maxLength: 60 } } }] : []);
    case "done":
      return [];
  }
}
