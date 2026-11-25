/** Presentation IDs belong to one player in one live match. Only a currently visible domain can resolve them. */
export class PlayerHandles {
  constructor(private readonly generate: (scope: string, value: string) => string = () => crypto.randomUUID()) {}

  private readonly issued = new Map<string, Map<string, string>>();

  issue(scope: string, value: string): string {
    let ids = this.issued.get(scope);
    if (!ids) {
      ids = new Map();
      this.issued.set(scope, ids);
    }
    const previous = ids.get(value);
    if (previous) return previous;
    const handle = this.generate(scope, value);
    ids.set(value, handle);
    return handle;
  }

  resolve(scope: string, handle: unknown, allowed: readonly string[]): string | undefined {
    if (typeof handle !== "string") return;
    const ids = this.issued.get(scope);
    return allowed.find(value => ids?.get(value) === handle);
  }
}
