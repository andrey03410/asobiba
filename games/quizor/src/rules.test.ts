import { describe, expect, it } from "vitest";
import { checkRules, resolveQuestion, rulesSchema } from "./rules";

describe("Quizor authoring", () => {
  it("warns when the correct-answer target exceeds the finite question pool", () => {
    const q = (id: string) => ({
      id,
      prompt: "Один",
      fields: [{ id: "a", type: "number", target: 1 }],
    });
    const rules = rulesSchema.parse({
      rounds: [{ id: "r", winsToEnd: 3, questions: [q("q")] }],
      final: { type: "duel", wins: 4, questions: [q("f1"), q("f2")] },
    });
    expect(
      checkRules(rules).filter((i) => i.code === "target_exceeds_pool"),
    ).toEqual([
      expect.objectContaining({
        path: "rounds.r.winsToEnd",
        severity: "warning",
      }),
      expect.objectContaining({ path: "final.wins", severity: "warning" }),
    ]);
  });
  it("accepts a gift without a dummy question or answer field", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [{ id: "gift", special: { type: "gift" }, value: 25 }],
        },
      ],
    });
    expect(checkRules(rules).filter((i) => i.severity !== "warning")).toEqual(
      [],
    );
  });
  it("inherits nested settings and records each winning source", () => {
    const rules = rulesSchema.parse({
      defaults: { timers: { answerSeconds: 40, wagerSeconds: 12 } },
      rounds: [
        {
          id: "r",
          settings: { timers: { answerSeconds: 20 } },
          questions: [
            {
              id: "q",
              prompt: "Столица?",
              settings: { value: 200 },
              fields: [
                {
                  id: "a",
                  type: "text",
                  settings: { strictness: "exact" },
                  answers: [{ text: "Москва" }],
                },
              ],
            },
          ],
        },
      ],
    });
    const q = resolveQuestion(rules, "q");
    expect(q.settings.timers.answerSeconds).toBe(20);
    expect(q.settings.timers.wagerSeconds).toBe(12);
    expect(q.settings.value).toBe(200);
    expect(q.provenance["timers.answerSeconds"]).toBe("round:r");
    expect(q.fields[0].settings.strictness).toBe("exact");
    expect(q.fields[0].provenance.strictness).toBe("field:a");
  });
  it("rejects unknown configuration and diagnoses unsupported judges and oral algorithm", () => {
    expect(rulesSchema.safeParse({ executable: "return true" }).success).toBe(
      false,
    );
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Спойте",
              fields: [{ id: "a", type: "oral" }],
              settings: { judge: "ai" },
            },
          ],
        },
      ],
    });
    expect(checkRules(rules).some((i) => i.code === "ai_unavailable")).toBe(
      true,
    );
  });
  it("rejects invalid media ids and inverted media fragments", () => {
    const raw = {
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Медиа",
              blocks: [{ type: "audio", asset: "bad", from: 10, to: 5 }],
              fields: [{ id: "a", type: "oral" }],
              settings: { judge: "self" },
            },
          ],
        },
      ],
    };
    expect(rulesSchema.safeParse(raw).success).toBe(false);
    raw.rounds[0].questions[0].blocks[0].asset = "ast_audio000000";
    expect(
      checkRules(rulesSchema.parse(raw)).some(
        (i) => i.code === "media_fragment",
      ),
    ).toBe(true);
  });
  it("warns when wrong and correct text collide under fuzzy tolerance", () => {
    const rules = rulesSchema.parse({
      rounds: [
        {
          id: "r",
          questions: [
            {
              id: "q",
              prompt: "Текст",
              fields: [
                {
                  id: "a",
                  type: "text",
                  answers: [{ text: "Австралия" }],
                  wrong: [{ text: "Австаралия", grade: "fail" }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(checkRules(rules).some((i) => i.code === "ambiguous_text")).toBe(
      true,
    );
  });
});
