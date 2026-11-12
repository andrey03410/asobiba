import { readdir } from "node:fs/promises";
import { createServer, request } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PNG_1x1, resetDb, signUp, type TestApp } from "../test/helpers";
import { mp3, mp4, ogg, wav, webm } from "./media-fixtures";
import { fetchPublicUrl } from "./fetch";

let t: TestApp;
beforeEach(async () => { await t?.close(); t = await createTestApp(); await resetDb(t.db); });
afterAll(async () => { await t?.close(); });

describe("media assets", () => {
  it.each([
    ["wave", wav, "audio/wav"], ["mp3", mp3, "audio/mpeg"], ["ogg", ogg, "audio/ogg"],
    ["m4a", () => mp4(true), "audio/mp4"], ["mp4", mp4, "video/mp4"], ["webm", webm, "video/webm"],
  ])("accepts %s by container rather than the declared content type", async (_name, fixture, mime) => {
    const a = await signUp(t, "ann");
    const res = await t.app.inject({ method: "POST", url: "/api/assets?name=recording", headers: { cookie: a.cookie, "content-type": "application/octet-stream" }, payload: (fixture as () => Buffer)() });
    expect(res.statusCode).toBe(201);
    expect(res.json().asset).toMatchObject({ mime, source: "upload" });
  });

  it("rejects container labels without a valid media structure", async () => {
    const a = await signUp(t, "ann");
    for (const body of [Buffer.from("RIFFxxxxWAVE"), Buffer.from("OggSxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), Buffer.from("\0\0\0\x18ftypisom"), Buffer.from("ID3garbage")]) {
      await expect(t.services.assets.save(a.user.id, { body, source: "upload" })).rejects.toMatchObject({ status: 422 });
    }
    expect(await t.services.assets.list(a.user.id)).toEqual([]);
  });

  it("rejects an empty upload with a file error", async () => {
    const a = await signUp(t, "ann");
    const res = await t.app.inject({ method: "POST", url: "/api/assets", headers: { cookie: a.cookie } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("empty");
  });

  it("imports chunked media, limits streamed imports, and removes interrupted imports", async () => {
    const a = await signUp(t, "ann");
    const source = createServer((req, res) => {
      if (req.url === "/redirect") { res.writeHead(302, { location: "/wav" }); res.end(); return; }
      if (req.url === "/oversize") { res.writeHead(200, { "content-length": "1073741825" }); res.end(); return; }
      if (req.url === "/interrupted") { res.writeHead(200, { "content-length": "100" }); res.write(wav()); setImmediate(() => res.destroy()); return; }
      res.writeHead(200, { "content-type": "text/plain" }); res.write(wav().subarray(0, 20)); res.end(wav().subarray(20));
    });
    await new Promise<void>((r) => source.listen(0, "127.0.0.1", r));
    const address = source.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    try {
      const asset = await t.services.assets.importUrl(a.user.id, `${url}/redirect`);
      expect(asset).toMatchObject({ mime: "audio/wav", bytes: 48, source: "url" });
      await expect(t.services.assets.importUrl(a.user.id, `${url}/oversize`)).rejects.toMatchObject({ status: 413 });
      await expect(t.services.assets.importUrl(a.user.id, `${url}/interrupted`)).rejects.toMatchObject({ status: 422, code: "fetch_failed" });
      await expect(fetchPublicUrl(`${url}/wav`, { allowPrivate: true, maxBytes: 32 })).rejects.toMatchObject({ status: 413 });
      expect((await t.services.assets.list(a.user.id)).map((row) => row.id)).toEqual([asset.id]);
      expect(await readdir(join(t.services.env.storageDir, "assets", a.user.id))).toEqual([`${asset.id}.wav`]);
    } finally { await new Promise<void>((r) => source.close(() => r())); }
  });

  it("serves bounded ranges, suffixes, HEAD and unsatisfiable ranges", async () => {
    const a = await signUp(t, "ann");
    const body = wav();
    const asset = await t.services.assets.save(a.user.id, { body, source: "upload" });
    const get = (range: string) => t.app.inject({ url: asset.url, headers: { cookie: a.cookie, range } });
    const first = await get("bytes=0-3");
    expect(first.statusCode).toBe(206);
    expect(first.headers["content-range"]).toBe("bytes 0-3/48");
    expect(first.headers["content-length"]).toBe("4");
    expect(first.rawPayload).toEqual(Buffer.from("RIFF"));
    expect((await get("bytes=-4")).rawPayload).toEqual(body.subarray(44));
    expect((await get("bytes=44-")).rawPayload).toEqual(body.subarray(44));
    for (const range of ["bytes=48-", "bytes=9-2", "bytes=0-1,4-5", "bytes=-0"]) {
      const res = await get(range);
      expect(res.statusCode).toBe(416);
      expect(res.headers["content-range"]).toBe("bytes */48");
    }
    const head = await t.app.inject({ method: "HEAD", url: asset.url, headers: { cookie: a.cookie } });
    expect(head.statusCode).toBe(200); expect(head.body).toBe(""); expect(head.headers["content-length"]).toBe("48");
    const headRange = await t.app.inject({ method: "HEAD", url: asset.url, headers: { cookie: a.cookie, range: "bytes=0-3" } });
    expect(headRange.statusCode).toBe(200); expect(headRange.body).toBe(""); expect(headRange.headers["content-length"]).toBe("48");
  });

  it("streams an upload over a real HTTP socket and serves its media range and HEAD", async () => {
    const a = await signUp(t, "ann");
    await t.listen();
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(`${t.url}/api/assets?name=socket.wav`, { method: "POST", headers: { cookie: a.cookie, "content-type": "audio/wav" } }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.write(wav().subarray(0, 20));
      req.end(wav().subarray(20));
    });
    expect(response.status).toBe(201);
    const { asset } = JSON.parse(response.body);
    const range = await fetch(`${t.url}${asset.url}`, { headers: { cookie: a.cookie, range: "bytes=8-11" } });
    expect(range.status).toBe(206); expect(await range.text()).toBe("WAVE");
    const head = await fetch(`${t.url}${asset.url}`, { method: "HEAD", headers: { cookie: a.cookie } });
    expect(head.status).toBe(200); expect(head.headers.get("content-length")).toBe("48"); expect(await head.text()).toBe("");
  });

  it("cleans an interrupted stream and consumes its one-use ticket", async () => {
    const a = await signUp(t, "ann");
    const { uploadUrl } = await t.services.assets.beginUpload(a.user.id, "bad.wav");
    const ticket = new URL(uploadUrl).pathname.split("/").pop()!;
    const interrupted = Readable.from((async function* () { yield wav(); throw new Error("upload interrupted"); })());
    await expect(t.services.assets.finishUpload(ticket, interrupted)).rejects.toThrow("upload interrupted");
    expect(await t.services.assets.list(a.user.id)).toEqual([]);
    expect(await readdir(join(t.services.env.storageDir, "assets", a.user.id))).toEqual([]);
    await expect(t.services.assets.finishUpload(ticket, wav())).rejects.toMatchObject({ status: 410 });
  });

  it("limits actual stream bytes and removes partial files", async () => {
    const a = await signUp(t, "ann");
    const chunk = Buffer.alloc(1024 * 1024); wav().copy(chunk);
    const oversized = Readable.from((async function* () { for (let n = 0; n < 1025; n++) yield chunk; })());
    await expect(t.services.assets.save(a.user.id, { body: oversized, source: "upload" })).rejects.toMatchObject({ status: 413, code: "too_big" });
    expect(await t.services.assets.list(a.user.id)).toEqual([]);
    expect(await readdir(join(t.services.env.storageDir, "assets", a.user.id))).toEqual([]);
  });

  it("enforces the pool quota and sums unique media only for config limits", async () => {
    const a = await signUp(t, "ann");
    const first = await t.services.assets.save(a.user.id, { body: wav(), source: "upload" });
    const second = await t.services.assets.save(a.user.id, { body: mp4(), source: "upload" });
    await t.db.asset.update({ where: { id: first.id }, data: { bytes: 700 * 1024 * 1024 } });
    await t.db.asset.update({ where: { id: second.id }, data: { bytes: 400 * 1024 * 1024 } });
    expect(await t.services.assets.ownershipIssues(a.user.id, [{ path: "a", assetId: first.id }, { path: "b", assetId: first.id }])).toEqual([]);
    expect(await t.services.assets.ownershipIssues(a.user.id, [{ path: "a", assetId: first.id }, { path: "b", assetId: second.id }])).toEqual(expect.arrayContaining([expect.objectContaining({ code: "media_quota" })]));
    await t.db.asset.update({ where: { id: first.id }, data: { bytes: 10 * 1024 * 1024 * 1024 - 400 * 1024 * 1024 } });
    await expect(t.services.assets.save(a.user.id, { body: wav(), source: "upload" })).rejects.toMatchObject({ code: "asset_quota" });
  });

  it("does not read media into image previews and keeps image size limits", async () => {
    const a = await signUp(t, "ann");
    const sound = await t.services.assets.save(a.user.id, { body: wav(), source: "upload" });
    const image = await t.services.assets.save(a.user.id, { body: PNG_1x1, source: "upload" });
    const uris = await t.services.assets.previewDataUris([sound.id, image.id]);
    expect(uris.has(sound.id)).toBe(false); expect(uris.get(image.id)).toMatch(/^data:image\/png;base64,/);
    await expect(t.services.assets.save(a.user.id, { body: Buffer.concat([PNG_1x1, Buffer.alloc(2 * 1024 * 1024)]), source: "upload" })).rejects.toMatchObject({ code: "too_big" });
  });

  it("keeps the normal JSON parser bounded independently of the media limit", async () => {
    const a = await signUp(t, "ann");
    const res = await t.app.inject({ method: "POST", url: "/api/lobbies", headers: { cookie: a.cookie }, payload: { name: "x".repeat(3 * 1024 * 1024) } });
    expect(res.statusCode).toBe(413);
  });
});
