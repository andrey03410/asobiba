import { describe, expect, it } from "vitest";
import { quizorMediaRefs } from "./media-refs";

describe("renderer-owned Quizor media", () => {
  it("includes only the current round background alongside visible blocks", () => {
    const refs = quizorMediaRefs({
      blocks: [{ type: "image", asset: "ast_visible00000" }],
      roundVisual: { background: { asset: "ast_roundbg00000" }, answers: { asset: "ast_injected0000" } },
      rules: { rounds: [{ visual: { background: { asset: "ast_future000000" } } }] },
      answers: { asset: "ast_answer000000" },
      own: { answers: { asset: "ast_answer000000" } },
    });
    expect(refs.map(ref => ref.assetId).sort()).toEqual(["ast_roundbg00000", "ast_visible00000"]);
  });
});
