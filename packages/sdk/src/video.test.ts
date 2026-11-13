import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex, videoDirective, videoKey } from "./video";

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
  });
});
