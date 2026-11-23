import { ticTacToe } from "@asobiba/game-tic-tac-toe";
import { presetDocument } from "@asobiba/sdk";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createTestApp, resetDb, PNG_1x1 } from "./test/helpers";
import { SESSION_COOKIE } from "./routes";

afterEach(() => vi.unstubAllEnvs());

it("uses the central Asobiba scope for sessions, MCP, concurrent saves, uploads and revocation", async () => {
  let revoked = false;
  const broker = createServer((req, res) => {
    if (req.headers.authorization !== "Bearer service-token" || revoked) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        subject: "tester",
        login: "tester",
        service: "asobiba",
        role: "user",
        limits: {
          storageBytes: PNG_1x1.length,
          items: null,
          configs: 1,
          lobbies: 1,
          projects: null,
          publications: null,
          groups: null,
        },
        permissions: { heavy: false, html: true },
      }),
    );
  });
  await new Promise<void>((resolve) => broker.listen(0, "127.0.0.1", resolve));
  const address = broker.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  for (const [key, value] of Object.entries({
    ENABLED: "1",
    URL: "http://127.0.0.1:" + address.port,
    SITE_URL: "http://localhost",
    PUBLIC_URL: "http://localhost",
    OIDC_ISSUER: "http://localhost",
    SERVICE_TOKEN: "service-token",
    REPORT_TOKEN: "report-token",
  }))
    vi.stubEnv("KANAME_" + key, value);
  const t = await createTestApp();
  let socket: WebSocket | undefined;
  try {
    await resetDb(t.db);
    const user = await t.db.user.create({
      data: {
        id: "tester",
        login: "old-admin",
        role: "admin",
        kanameSubject: "tester",
        kanameIssuer: "http://localhost",
      },
    });
    const legacy = await t.services.auth.createSession(user.id);
    const session = await t.services.auth.createSession(user.id, true);
    const cookies = { [SESSION_COOKIE]: session.token };
    expect(await t.services.auth.userBySession(legacy.token)).toBeNull();
    expect((await t.services.auth.userBySession(session.token))?.role).toBe("user");
    expect((await t.app.inject({ url: "/admin", cookies })).statusCode).toBe(403);
    const concurrent = await Promise.allSettled(
      ["a", "b"].map((title) => t.services.configs.save(user.id, { game: "tic-tac-toe", title })),
    );
    expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await t.services.assets.save(user.id, { body: PNG_1x1, name: "pixel.png", source: "upload" });
    await expect(
      t.services.assets.save(user.id, { body: PNG_1x1, name: "second.png", source: "upload" }),
    ).rejects.toThrow();
    const reportUrl = "/internal/kaname/v1/usage/tester";
    expect(
      (await t.app.inject({ url: reportUrl, headers: { authorization: "Bearer service-token" } })).statusCode,
    ).toBe(403);
    const report = await t.app.inject({ url: reportUrl, headers: { authorization: "Bearer report-token" } });
    expect(report.json()).toMatchObject({ storageBytes: PNG_1x1.length, counts: { configs: 1 } });
    const apiToken = await t.services.auth.createToken(user.id, "integration");
    expect((await t.services.auth.userByToken(apiToken.secret))?.role).toBe("user");
    vi.stubEnv("KANAME_OIDC_ISSUER", "http://other.example");
    expect(await t.services.auth.userBySession(session.token)).toBeNull();
    expect(
      (await t.app.inject({ url: reportUrl, headers: { authorization: "Bearer report-token" } })).json()
        .storageBytes,
    ).toBe(0);
    vi.stubEnv("KANAME_OIDC_ISSUER", "http://localhost");
    const file = (await t.services.assets.list(user.id))[0]!;
    const cached = await t.app.inject({ url: "/files/assets/" + file.id, cookies });
    expect(cached.headers["cache-control"]).toBe("private, no-store");
    const actor = (await t.services.auth.userBySession(session.token))!;
    const lobby = await t.services.lobbies.create(actor, {
      config: presetDocument(
        ticTacToe,
        ticTacToe.presets.find((p) => p.id === "classic"),
      ),
    });
    expect(lobby.host.login).toBe(actor.login);
    const base = await t.listen();
    socket = new WebSocket(base.replace("http:", "ws:") + "/ws", {
      headers: { cookie: SESSION_COOKIE + "=" + session.token },
    });
    await once(socket, "open");
    const subscribed = once(socket, "message");
    socket.send(JSON.stringify({ type: "subscribe", lobbyId: lobby.id }));
    await subscribed;
    const states: string[] = [];
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "lobby") states.push(event.lobby.status);
    });
    const ended = once(socket, "close", { signal: AbortSignal.timeout(2500) });
    revoked = true;
    await t.services.lobbies.close(actor, lobby.id);
    expect((await ended)[0]).toBe(4401);
    expect(states).not.toContain("closed");
    expect(await t.services.auth.userByToken(apiToken.secret)).toBeNull();
    expect(await t.services.auth.userBySession(session.token)).toBeNull();
  } finally {
    socket?.terminate();
    await t.close();
    broker.closeAllConnections();
    await new Promise<void>((r) => broker.close(() => r()));
  }
});
