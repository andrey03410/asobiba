import type { ConfigIssue } from "./issues";

/**
 * Video layer of games (task 07). The video itself comes from a Douga snapshot
 * (`vsn_…`); a game only says what to play, from when, where to hold and with what
 * data. The server compiles scenes, the client plays them in step with the server
 * clock. The SDK stays pure: no Douga code here, only data shapes.
 */
export const VIDEO_CONTRACT = 1 as const;
export const VIDEO_SNAPSHOT_ID = /^vsn_[A-Za-z0-9]{12}$/;

/** Match data a video scene shows. Same shape as Douga `MatchData` (contract 1). */
export interface VideoMatchData {
  players?: { id: string; name: string; score?: number; rank?: number }[];
  participants?: Record<
    string,
    { votes?: number; score?: number; rank?: number; pickedBy?: string[]; comment?: string }
  >;
  rounds?: Record<string, { answer?: { cardIds?: string[]; groupIds?: string[] } }>;
  texts?: Record<string, string>;
}

export type VideoPlay = { segmentId: string } | { sceneIds: string[] };

export interface VideoDirective {
  /** Hash of snapshot, play and data: the cache key and the access key of the slice. */
  key: string;
  snapshot: string;
  play: VideoPlay;
  /** Server time (ms) when frame 0 of the slice plays. */
  startedAt: number;
  /** Stop on this moment until the directive changes. */
  hold?: { momentId: string } | null;
  /** Match data that is already safe to show to this viewer. */
  data?: VideoMatchData | null;
}

/** What the server knows about a snapshot when it checks a config. */
export interface VideoSnapshotSummary {
  id: string;
  title: string;
  fps: number;
  durationInFrames: number;
  segments: { id: string; title: string; from: number; to: number }[];
  scenes: {
    id: string;
    sourceSceneId: string;
    segmentId?: string;
    from: number;
    to: number;
    holds: { momentId: string; frame: number }[];
    choices: { choiceId: string; cardId?: string; participantId?: string; label?: string }[];
    uses: string[];
  }[];
}

export interface GameVideoSupport<C = unknown, PV = unknown> {
  contract: typeof VIDEO_CONTRACT;
  /** Markdown for game_capabilities: where scenes go, moments, data. */
  guide: string;
  /** Douga interactive recipes that fit this game (entry 2: from scratch). */
  recipes: string[];
  /** Snapshots a config uses. The server checks ownership and freezes them with the lobby. */
  configSnapshots(config: C): string[];
  /** Current and preloaded directives of a view: the only slices a viewer may fetch. */
  directives(view: PV): VideoDirective[];
  /** References of the config against snapshot summaries. Paths are relative to the config. */
  checkVideo?(config: C, snapshots: Record<string, VideoSnapshotSummary>): ConfigIssue[];
}

/** JSON with sorted keys and no undefined fields. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** The key of a directive: SHA-256 of what is drawn (not when). Pure, sync, any runtime. */
export function videoKey(input: Pick<VideoDirective, "snapshot" | "play" | "data">): string {
  return sha256Hex(canonicalJson({ snapshot: input.snapshot, play: input.play, data: input.data ?? null })).slice(0, 32);
}

export function videoDirective(input: Omit<VideoDirective, "key">): VideoDirective {
  return { ...input, key: videoKey(input) };
}

// ---- SHA-256 (FIPS 180-4), small and synchronous ------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const length = data.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}
