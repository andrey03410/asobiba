import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type ConfigDocument, presetDocument } from "@asobiba/sdk";
import { ticTacToe } from "@asobiba/game-tic-tac-toe";
import { renderPreview } from "../preview/render";
import { createTestApp, PNG_1x1, resetDb, SIMPLE_SVG, signUp, type TestApp } from "../test/helpers";
import { isPrivateAddress } from "./fetch";
import { AssetService } from "./service";

let t: TestApp;
let source: Server;
let sourceUrl = "";

beforeAll(async () => {
  source = createServer((req, res) => {
    if (req.url === "/pic.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(PNG_1x1);
    } else if (req.url === "/redirect") {
      res.writeHead(302, { location: "/pic.png" });
      res.end();
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>not an image</html>");
    }
  });
  await new Promise<void>((r) => source.listen(0, "127.0.0.1", () => r()));
  const addr = source.address();
  sourceUrl = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => {
  source.close();
  await t?.close();
});
beforeEach(async () => {
  await t?.close();
  t = await createTestApp();
  await resetDb(t.db);
});

describe("assets", () => {
  it("uploads a PNG, serves it to logged-in users and deletes it", async () => {
    const a = await signUp(t, "ann");
    const res = await t.app.inject({ method: "POST", url: "/api/assets?name=dot.png", headers: { cookie: a.cookie, "content-type": "image/png" }, payload: PNG_1x1 });
    expect(res.statusCode).toBe(201);
    const asset = res.json().asset;
    expect(asset).toMatchObject({ name: "dot.png", mime: "image/png", width: 1, height: 1, source: "upload" });
    expect(asset.id).toMatch(/^ast_/);

    const b = await signUp(t, "bob");
    const file = await t.app.inject({ url: asset.url, headers: { cookie: b.cookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect((await t.app.inject({ url: asset.url })).statusCode).toBe(401);

    expect((await t.app.inject({ method: "DELETE", url: `/api/assets/${asset.id}`, headers: { cookie: b.cookie } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "DELETE", url: `/api/assets/${asset.id}`, headers: { cookie: a.cookie } })).statusCode).toBe(204);
    expect((await t.app.inject({ url: asset.url, headers: { cookie: a.cookie } })).statusCode).toBe(404);
  });

  it("rejects things that are not images", async () => {
    const a = await signUp(t, "ann");
    const res = await t.app.inject({ method: "POST", url: "/api/assets", headers: { cookie: a.cookie, "content-type": "image/png" }, payload: Buffer.from("hello") });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("not_image");
  });

  it("rasterizes agent SVG into a 512 px PNG and refuses external references", async () => {
    const a = await signUp(t, "ann");
    const asset = await t.services.assets.createFromSvg(a.user.id, "круг", SIMPLE_SVG);
    expect(asset).toMatchObject({ mime: "image/png", width: 512, height: 512, source: "svg" });
    await expect(
      t.services.assets.createFromSvg(a.user.id, "x", '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd" width="10" height="10"/></svg>'),
    ).rejects.toMatchObject({ code: "svg_external" });
    await expect(
      t.services.assets.createFromSvg(a.user.id, "x", '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(http://evil/x.css);</style></svg>'),
    ).rejects.toMatchObject({ code: "svg_external" });
    await expect(t.services.assets.createFromSvg(a.user.id, "x", "<!DOCTYPE svg [<!ENTITY x 'y'>]><svg/>")).rejects.toMatchObject({ code: "svg_unsafe" });
  });

  it("imports by URL, follows redirects and checks the content", async () => {
    const a = await signUp(t, "ann");
    const asset = await t.services.assets.importUrl(a.user.id, `${sourceUrl}/redirect`);
    expect(asset).toMatchObject({ name: "pic.png", source: "url", width: 1 });
    await expect(t.services.assets.importUrl(a.user.id, `${sourceUrl}/page`)).rejects.toMatchObject({ code: "not_image" });
    await expect(t.services.assets.importUrl(a.user.id, "ftp://example.com/x.png")).rejects.toMatchObject({ code: "bad_url" });
  });

  it("refuses private addresses unless allowed", async () => {
    const a = await signUp(t, "ann");
    const strict = new AssetService(t.db, { ...t.services.env, allowPrivateUrls: false });
    await expect(strict.importUrl(a.user.id, `${sourceUrl}/pic.png`)).rejects.toMatchObject({ code: "private_address" });
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("accepts exactly one upload per ticket", async () => {
    const a = await signUp(t, "ann");
    const { uploadUrl } = await t.services.assets.beginUpload(a.user.id, "фон");
    const path = new URL(uploadUrl).pathname;
    const first = await t.app.inject({ method: "PUT", url: path, payload: PNG_1x1 });
    expect(first.statusCode).toBe(201);
    expect(first.json().asset).toMatchObject({ name: "фон", source: "upload" });
    const second = await t.app.inject({ method: "PUT", url: path, payload: PNG_1x1 });
    expect(second.statusCode).toBe(410);
    expect((await t.services.assets.list(a.user.id)).length).toBe(1);
  });
});

describe("heavy inputs (review fixes)", () => {
  it("refuses an SVG whose proportions would render a huge image", async () => {
    const a = await signUp(t, "ann");
    const tall = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 2000"><rect width="1" height="2000"/></svg>';
    const started = Date.now();
    await expect(t.services.assets.createFromSvg(a.user.id, "столб", tall)).rejects.toMatchObject({ code: "svg_aspect" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("embeds small thumbnails in previews, even when one image fills every cell", async () => {
    const a = await signUp(t, "ann");
    const asset = await t.services.assets.createFromSvg(a.user.id, "клетка", SIMPLE_SVG);
    const uris = await t.services.assets.previewDataUris([asset.id]);
    const thumb = uris.get(asset.id) as string;
    const png = Buffer.from(thumb.split(",")[1] as string, "base64");
    expect(png.readUInt32BE(16)).toBeLessThanOrEqual(160);
    const base = presetDocument(ticTacToe, ticTacToe.presets.find((p) => p.id === "gomoku")) as ConfigDocument<Record<string, unknown>, Record<string, unknown>>;
    const config = { ...base, rules: { ...base.rules, board: { width: 15, height: 15, blocked: [] } }, visual: { ...base.visual, board: { cell: { asset: asset.id } } } };
    const preview = await renderPreview(t.services.assets, config as ConfigDocument, "end", 3);
    expect(preview.width).toBe(768);
  });
});
