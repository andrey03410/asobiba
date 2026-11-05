import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb, signUp, type TestApp } from "../test/helpers";

let t: TestApp;
beforeEach(async () => {
  t?.close();
  t = await createTestApp();
  await resetDb(t.db);
});
afterAll(() => t?.close());

describe("auth", () => {
  it("registers only with a valid single-use invite", async () => {
    const noInvite = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { login: "ann", password: "password-1", invite: "nope" } });
    expect(noInvite.statusCode).toBe(400);
    expect(noInvite.json().error.code).toBe("bad_invite");

    const { code } = await t.services.auth.createInvite(null, "user");
    expect((await t.app.inject({ url: `/api/invites/check/${code}` })).json()).toEqual({ valid: true, role: "user" });
    const ok = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { login: "Ann", password: "password-1", invite: code } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().user).toMatchObject({ login: "ann", role: "user" });
    expect(String(ok.headers["set-cookie"])).toMatch(/asobiba_session=ses_.+HttpOnly/i);

    const again = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { login: "bob", password: "password-1", invite: code } });
    expect(again.json().error.code).toBe("bad_invite");
  });

  it("logs in, reports the user and logs out", async () => {
    const a = await signUp(t, "ann");
    const me = await t.app.inject({ url: "/api/me", headers: { cookie: a.cookie } });
    expect(me.json().user.login).toBe("ann");
    expect((await t.app.inject({ url: "/api/me" })).json()).toEqual({ user: null });

    const bad = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "ann", password: "wrong-pass" } });
    expect(bad.statusCode).toBe(401);
    const good = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "ANN", password: a.password } });
    expect(good.statusCode).toBe(200);

    await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: a.cookie } });
    expect((await t.app.inject({ url: "/api/me", headers: { cookie: a.cookie } })).json()).toEqual({ user: null });
  });

  it("lets only admins create invites", async () => {
    const user = await signUp(t, "ann");
    const admin = await signUp(t, "boss", "admin");
    expect((await t.app.inject({ method: "POST", url: "/api/invites", headers: { cookie: user.cookie }, payload: {} })).statusCode).toBe(403);
    const res = await t.app.inject({ method: "POST", url: "/api/invites", headers: { cookie: admin.cookie }, payload: { role: "user" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().url).toMatch(/^http:\/\/asobiba\.test\/register\?invite=/);
    const list = await t.app.inject({ url: "/api/invites", headers: { cookie: admin.cookie } });
    expect(list.json().invites.length).toBeGreaterThanOrEqual(1);
  });

  it("creates, lists and revokes personal MCP tokens", async () => {
    const a = await signUp(t, "ann");
    const created = await t.app.inject({ method: "POST", url: "/api/tokens", headers: { cookie: a.cookie }, payload: { name: "Claude" } });
    expect(created.statusCode).toBe(201);
    const { token, secret, mcpUrl } = created.json();
    expect(secret).toMatch(/^asb_/);
    expect(mcpUrl).toBe("http://asobiba.test/mcp");
    expect(await t.services.auth.userByToken(secret)).toMatchObject({ login: "ann" });

    const list = await t.app.inject({ url: "/api/tokens", headers: { cookie: a.cookie } });
    expect(JSON.stringify(list.json())).not.toContain(secret);

    const b = await signUp(t, "bob");
    expect((await t.app.inject({ method: "DELETE", url: `/api/tokens/${token.id}`, headers: { cookie: b.cookie } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "DELETE", url: `/api/tokens/${token.id}`, headers: { cookie: a.cookie } })).statusCode).toBe(204);
    expect(await t.services.auth.userByToken(secret)).toBeNull();
  });

  it("requires a session for the API", async () => {
    expect((await t.app.inject({ url: "/api/lobbies" })).statusCode).toBe(401);
    expect((await t.app.inject({ url: "/api/games" })).statusCode).toBe(401);
  });
});
