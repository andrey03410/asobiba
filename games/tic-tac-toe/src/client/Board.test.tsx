import { type ConfigDocument, createCatalog, Match, validateConfig } from "@asobiba/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ticTacToe } from "../game";
import { previewMatch, TicTacToeBoard, TicTacToeSeatIcon } from "./index";

const catalog = createCatalog([ticTacToe]);
function cfg(patch: Record<string, unknown> = {}): ConfigDocument {
  const res = validateConfig(catalog, { sdk: 1, game: "tic-tac-toe", gameVersion: 1, ...patch });
  if (!res.ok) throw new Error(JSON.stringify(res.issues));
  return res.config;
}
const assetUrl = (id: string) => `/files/assets/${id}`;

describe("TicTacToeBoard", () => {
  it("renders an empty board with clickable legal cells for the seat to move", () => {
    const config = cfg();
    const match = Match.start({ game: ticTacToe, config, seats: 2, seed: 1, startedAt: 0 }).view(0);
    const html = renderToStaticMarkup(<TicTacToeBoard match={match} config={config} seat={0} assetUrl={assetUrl} />);
    expect(html.match(/class="ttt-hit is-legal"/g)).toHaveLength(9);
    expect(html).toContain('viewBox="0 0 340 340"');
  });

  it("previews the end of a round statically, with pieces and a win line", () => {
    const config = cfg({ rules: { board: { width: 5, height: 5 }, win: { line: 3 } }, visual: { theme: "party" } });
    const match = previewMatch(config, "end", 3);
    expect(match.lastRound).not.toBeNull();
    const html = renderToStaticMarkup(<TicTacToeBoard match={match} config={config} seat={null} assetUrl={assetUrl} staticRender />);
    expect(html).not.toContain("ttt-hit");
    expect(html).not.toMatch(/place-|idle-|win-(pulse|confetti)/);
    if (!match.lastRound?.draw) expect(html).toContain("ttt-winline");
  });

  it("uses images from slots and draws blocked cells", () => {
    const config = cfg({
      rules: { board: { blocked: [[1, 1]] } },
      visual: { pieces: [{ asset: "ast_pieceimage01" }], board: { background: { asset: "ast_boardimage01" }, style: "tiles", cell: { asset: "ast_cellimage001" } } },
    });
    const m = Match.start({ game: ticTacToe, config, seats: 2, seed: 1, startedAt: 0 });
    m.dispatch(0, { type: "place", row: 0, col: 0 }, 1);
    const html = renderToStaticMarkup(<TicTacToeBoard match={m.view(1)} config={config} seat={1} assetUrl={assetUrl} />);
    expect(html).toContain("/files/assets/ast_pieceimage01");
    expect(html).toContain("/files/assets/ast_boardimage01");
    expect(html).toContain("/files/assets/ast_cellimage001");
    expect(html.match(/class="ttt-hit is-legal"/g)).toHaveLength(7);
    expect(html).toContain("place-pop");
  });

  it("draws a seat icon", () => {
    const html = renderToStaticMarkup(<TicTacToeSeatIcon config={cfg()} seat={1} assetUrl={assetUrl} />);
    expect(html).toContain("<circle");
  });
});
