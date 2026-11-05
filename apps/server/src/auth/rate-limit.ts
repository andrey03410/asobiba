import { HttpError } from "../http-errors";

/**
 * Counts failed attempts per key in a fixed window and refuses further tries once
 * the limit is hit. In memory: the site is one process, and a restart forgiving
 * everyone is acceptable.
 */
export class FailureLimiter {
  private readonly hits = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws 429 when any of the keys is over the limit. */
  check(keys: readonly string[]): void {
    const now = this.now();
    for (const key of keys) {
      const entry = this.hits.get(key);
      if (!entry) continue;
      if (entry.until <= now) this.hits.delete(key);
      else if (entry.count >= this.limit) {
        const minutes = Math.ceil((entry.until - now) / 60_000);
        throw new HttpError(429, "too_many_attempts", `Слишком много неудачных попыток. Попробуйте через ${minutes} мин.`);
      }
    }
  }

  fail(keys: readonly string[]): void {
    const now = this.now();
    for (const key of keys) {
      const entry = this.hits.get(key);
      if (!entry || entry.until <= now) this.hits.set(key, { count: 1, until: now + this.windowMs });
      else entry.count += 1;
    }
    if (this.hits.size > 10_000) {
      for (const [key, entry] of this.hits) if (entry.until <= now) this.hits.delete(key);
    }
  }

  reset(keys: readonly string[]): void {
    for (const key of keys) this.hits.delete(key);
  }
}
