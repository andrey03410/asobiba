import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { describeConfig, presetDocument } from "@asobiba/sdk";
import { ticTacToe } from "@asobiba/game-tic-tac-toe";
import { GameInformation, AuthorInformationFields } from "./GameInformation";

describe("GameInformation", () => {
  it("separates the real rules from a plain text author introduction", () => {
    const config = presetDocument(ticTacToe);
    config.info = { title: "<script>не исполнять</script>", text: "Первый абзац\n\nВторой <iframe src='https://example.test'>" };
    const html = renderToStaticMarkup(<GameInformation information={describeConfig(ticTacToe, config)} />);
    expect(html).toContain("Об этой партии");
    expect(html).toContain("Вступление автора");
    expect(html).toContain("Об игре");
    expect(html).toContain("3×3");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<iframe");
    expect(html).toMatch(/<p[^>]*>Первый абзац<\/p>/);
  });

  it("does not invent an author for old configurations", () => {
    const html = renderToStaticMarkup(<GameInformation information={describeConfig(ticTacToe, presetDocument(ticTacToe))} />);
    expect(html).not.toContain("Вступление автора");
  });

  it("provides text and title fields even outside the generated schema form", () => {
    const html = renderToStaticMarkup(<AuthorInformationFields value={{ title: "Друзьям", text: "Два\nабзаца" }} onChange={() => {}} />);
    expect(html).toContain('maxLength="80"');
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain("<textarea");
    expect(html).toContain("Два\nабзаца");
  });
});
