import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, resetDb, signUp, type TestApp } from "../../server/src/test/helpers";

let t: TestApp;
let lobbyId: string;
let cookie = "";
let loseNextGuestResponse = false;
const nativeFetch = globalThis.fetch;

beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  const host = await signUp(t, "host");
  const cap = await t.app.inject({ url: "/api/games/tic-tac-toe", headers: { cookie: host.cookie } });
  const config = cap.json().game.presetConfigs.find((p: { id: string }) => p.id === "classic").config;
  const lobby = await t.app.inject({ method: "POST", url: "/api/lobbies", headers: { cookie: host.cookie }, payload: { config } });
  lobbyId = lobby.json().lobby.id;
  cookie = "";
  loseNextGuestResponse = false;
  await t.listen();
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } });
  // Model the browser's cross-tab exclusive lock, not a shared module-local mutex.
  let tail = Promise.resolve();
  vi.stubGlobal("navigator", { locks: { request: (_name: string, run: () => Promise<unknown>) => {
    const result = tail.then(run);
    tail = result.then(() => undefined, () => undefined);
    return result;
  } } });
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    const result = await nativeFetch(t.url + path, { ...init, headers });
    if (path === "/api/auth/guest" && loseNextGuestResponse) {
      loseNextGuestResponse = false;
      await result.arrayBuffer();
      throw new TypeError("response lost before headers reached the browser");
    }
    cookie = result.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    return result;
  });
});
afterEach(async () => { vi.unstubAllGlobals(); await t?.close(); });

async function tabs() {
  vi.resetModules();
  const first = (await import("./api")).api;
  vi.resetModules();
  const second = (await import("./api")).api;
  return [first, second] as const;
}
const input = () => ({ name: "Друг", lobbyId, role: "player" as const });

describe("first guest identity across tabs", () => {
  it("uses one identity and place for two independent concurrent invitation forms", async () => {
    const [a, b] = await tabs();
    const results = await Promise.allSettled([a.guestJoin(input()), b.guestJoin(input())]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const ids = results.filter((r) => r.status === "fulfilled").map((r) => r.value.user.id);
    expect(new Set(ids).size).toBe(1);
    expect(await t.db.user.count({ where: { role: "guest" } })).toBe(1);
    expect(await t.db.lobbyMember.count({ where: { lobbyId } })).toBe(2);
    expect((await a.me()).user?.id).toBe(ids[0]);
  });

  it("retries a lost response from another tab without orphaning the first place", async () => {
    const [a, b] = await tabs();
    loseNextGuestResponse = true;
    await expect(a.guestJoin(input())).rejects.toMatchObject({ code: "network" });
    const result = await b.guestJoin(input());
    expect(result.user.role).toBe("guest");
    expect(await t.db.user.count({ where: { role: "guest" } })).toBe(1);
    expect(await t.db.lobbyMember.count({ where: { lobbyId } })).toBe(2);
  });

  it("forgets a completed attempt so clearing cookies does not recover an old guest", async () => {
    const [a, b] = await tabs();
    const first = await a.guestJoin(input());
    cookie = "";
    const second = await b.guestJoin({ ...input(), role: "spectator" });
    expect(second.user.id).not.toBe(first.user.id);
  });
});
