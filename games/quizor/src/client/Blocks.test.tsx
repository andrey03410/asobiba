import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Blocks } from "./Blocks";

it("renders only supplied blocks, escapes text and does not preload whole media", () => {
  const html = renderToStaticMarkup(
    <Blocks
      blocks={[
        { type: "text", text: "<script>bad()</script> **Вопрос**" },
        {
          type: "group",
          layout: "grid",
          blocks: [
            { type: "audio", asset: "ast_audio000" },
            { type: "video", asset: "ast_video000", audioOnly: true },
          ],
        },
      ]}
      assetUrl={(id) => `/files/${id}`}
      now={1000}
      startedAt={0}
      muted
      paused={false}
    />,
  );
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain('preload="metadata"');
  expect(html).toContain("ast_audio000");
  expect(html).toContain("qz-audio-only");
  expect(html).toContain("<strong>Вопрос</strong>");
});
it("uses a low resolution canvas for the pixelation effect", () => {
  const html = renderToStaticMarkup(
    <Blocks
      blocks={[{ type: "image", asset: "ast_image000", effect: "pixelate" }]}
      assetUrl={(id) => `/files/${id}`}
      now={1000}
      startedAt={0}
      muted
      paused={false}
    />,
  );
  expect(html).toContain("<canvas");
  expect(html).not.toContain('class="qz-pixel-grid"');
});
