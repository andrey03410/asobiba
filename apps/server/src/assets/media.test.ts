import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectAssetFile, parseFileRange } from "./media";
import { mp3, mp4, ogg, wav, webm } from "./media-fixtures";

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "asobiba-media-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
async function inspect(body: Buffer) {
  const path = join(dir, "asset");
  await writeFile(path, body);
  return inspectAssetFile(path, body.length);
}

describe("media inspection", () => {
  it.each([[wav(), "audio/wav"], [mp3(), "audio/mpeg"], [ogg(), "audio/ogg"], [mp4(true), "audio/mp4"], [mp4(), "video/mp4"], [webm(), "video/webm"]])("detects its container", async (body, mime) => {
    expect(await inspect(body as Buffer)).toMatchObject({ mime });
  });

  it("seeks to movie metadata after a large mdat instead of requiring it in the prefix", async () => {
    const small = mp4();
    const mdat = small.indexOf(Buffer.from("mdat")) - 4;
    const next = mdat + small.readUInt32BE(mdat);
    const data = Buffer.alloc(2 * 1024 * 1024); data.writeUInt32BE(data.length); data.write("mdat", 4);
    expect(await inspect(Buffer.concat([small.subarray(0, mdat), data, small.subarray(next)]))).toMatchObject({ mime: "video/mp4" });
  });

  it("refuses a truncated second MP3 frame", async () => {
    await expect(inspect(mp3().subarray(0, 500))).rejects.toMatchObject({ code: "invalid_media" });
  });

  it("requires the full PCM GUID for extensible WAV", async () => {
    const sample = wav();
    const extended = Buffer.concat([sample.subarray(0, 36), Buffer.alloc(24), sample.subarray(36)]);
    extended.writeUInt32LE(extended.length - 8, 4); extended.writeUInt32LE(40, 16); extended.writeUInt16LE(0xfffe, 20);
    extended.writeUInt16LE(22, 36); extended.writeUInt16LE(1, 44);
    await expect(inspect(extended)).rejects.toMatchObject({ code: "invalid_media" });
    Buffer.from("00001000800000aa00389b71", "hex").copy(extended, 48);
    expect(await inspect(extended)).toMatchObject({ mime: "audio/wav" });
  });

  it("refuses a QuickTime brand disguised as MP4", async () => {
    const body = mp4(); body.write("qt  ", 8); body.write("qt  qt  ", 16);
    await expect(inspect(body)).rejects.toMatchObject({ code: "invalid_media" });
  });
});

describe("byte ranges", () => {
  it.each([["bytes=3-100", { start: 3, end: 9 }], ["bytes=-100", { start: 0, end: 9 }], ["bytes=0-0", { start: 0, end: 0 }], ["bytes=9-", { start: 9, end: 9 }]])("bounds %s", (value, want) => {
    expect(parseFileRange(value as string, 10)).toEqual(want);
  });
  it.each(["bytes=10-", "bytes=-0", "bytes=4-2", "bytes=", "bytes=0-1,2-3", "items=0-1", "bytes=9999999999999999999999-", "bytes=0-9999999999999999999999"])("rejects malformed/unsatisfiable %s", (value) => {
    expect(parseFileRange(value, 10)).toBeNull();
  });
});
