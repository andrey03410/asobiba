import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex, sliceWindow, videoDirective, videoKey } from "./video";

describe("video contract", () => {
  it("hashes like node:crypto", () => {
    for (const text of ["", "abc", "кириллица и 日本語", "x".repeat(1000)])
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
  });

  it("keys depend on what is drawn, not when", () => {
    const a = videoDirective({ snapshot: "vsn_aaaaaaaaaaaa", play: { segmentId: "s" }, startedAt: 1, data: { texts: { a: "1", b: "2" } } });
    const b = videoDirective({ snapshot: "vsn_aaaaaaaaaaaa", play: { segmentId: "s" }, startedAt: 2, data: { texts: { b: "2", a: "1" } } });
    expect(a.key).toBe(b.key);
    expect(a.key).toMatch(/^[a-f0-9]{32}$/);
    expect(videoKey({ snapshot: "vsn_aaaaaaaaaaaa", play: { segmentId: "s" } })).toBe(
      videoKey({ snapshot: "vsn_aaaaaaaaaaaa", play: { segmentId: "s" }, data: null }),
    );
    expect(videoKey({ snapshot: "vsn_aaaaaaaaaaaa", play: { segmentId: "t" } })).not.toBe(a.key);
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe('{"a":[2,{"c":3}],"b":1}');
    // Where a piece is cut is part of what is drawn.
    const play = { snapshot: "vsn_aaaaaaaaaaaa", play: { segmentId: "s" } };
    expect(videoKey({ ...play, hold: { momentId: "wait" } })).not.toBe(videoKey(play));
    expect(videoKey({ ...play, start: { momentId: "wait" } })).not.toBe(videoKey({ ...play, hold: { momentId: "wait" } }));
  });

  it("cuts a piece from the scene of start to the scene of hold", () => {
    const scenes = [
      { from: 0, to: 100, holds: [{ momentId: "wait", frame: 60 }] },
      { from: 100, to: 160, holds: [] },
      { from: 160, to: 220, holds: [{ momentId: "wait", frame: 200 }, { momentId: "end", frame: 210 }] },
    ];
    expect(sliceWindow(scenes)).toEqual({ from: 0, to: 220, startFrame: 0, holdFrame: null });
    // A question waits in the first scene: the reveal scenes after it are not in its slice.
    expect(sliceWindow(scenes, null, "wait")).toEqual({ from: 0, to: 100, startFrame: 0, holdFrame: 60 });
    // The reveal continues from the moment: its slice begins with that scene.
    expect(sliceWindow(scenes, "wait", null)).toEqual({ from: 0, to: 220, startFrame: 60, holdFrame: null });
    // The same moment again is the next one after start.
    expect(sliceWindow(scenes, "wait", "wait")).toEqual({ from: 0, to: 220, startFrame: 60, holdFrame: 200 });
    expect(sliceWindow(scenes.slice(1), "end", null)).toEqual({ from: 160, to: 220, startFrame: 210, holdFrame: null });
    expect(sliceWindow(scenes, "nope", null)).toEqual({ missing: "start" });
    expect(sliceWindow(scenes, "end", "wait")).toEqual({ missing: "hold" });
  });
});
