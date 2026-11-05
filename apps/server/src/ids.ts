import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Uniform base62 string from crypto randomness. */
export function randomString(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248 && out.length < length) out += ALPHABET[byte % 62];
    }
  }
  return out;
}

export type IdPrefix = "usr" | "ses" | "inv" | "tok" | "ast" | "cfg" | "lob" | "mat";

export function newId(prefix: IdPrefix, length = 12): string {
  return `${prefix}_${randomString(length)}`;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomSeed(): number {
  // 31 bits: Match.seed is a signed INT column
  return randomBytes(4).readUInt32LE(0) & 0x7fffffff;
}
