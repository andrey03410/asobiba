import { appendFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, resetDb, signUp, SIMPLE_SVG, type TestApp } from "../test/helpers";

let t: TestApp;
let clients: Client[];
beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  await t.listen();
  clients = [];
});
afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await t.close();
});

async function connect(secret?: string) {
  const client = new Client({ name: "player-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", t.url), {
      requestInit: secret ? { headers: { Authorization: `Bearer ${secret}` } } : {},
    }),
  );
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args = {} as Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const block = (result.content as { type: string; text?: string }[])[0];
  if (result.isError) throw new Error(block?.text);
  return JSON.parse(block!.text!);
}

describe("seat-only MCP", () => {
  it("serves guests only seat tools and refuses bad credentials", async () => {
    const guest = await connect();
    const tools = (await guest.listTools()).tools.map((x) => x.name);
    expect(tools).toContain("agent_join_by_link");
    expect(tools).not.toContain("config_get");
    expect(tools).not.toContain("lobby_create");
    await expect(connect("revoked")).rejects.toThrow();
    const resp = await guest.callTool({
      name: "config_get",
      arguments: { configId: "other", revealSecrets: true },
    });
    expect(resp.isError).toBe(true);
  });

  it("returns rendered pixels and denies an upcoming scene before reading a browser video grant", async () => {
    const owner = await signUp(t, "media-owner");
    const asset = await t.services.assets.createFromSvg(owner.user.id, "Кадр", SIMPLE_SVG);
    const original = await t.services.assets.file(asset.id);
    await appendFile(original!.path, "PRIVATE_IMAGE_METADATA");
    const client = await connect();
    const svc = t.services.lobbies;
    const { id: lobbyId, url } = await svc.create(owner.user, {
      config: { sdk: 1, game: "tic-tac-toe", gameVersion: 1 },
    });
    const attempt = (await call(client, "agent_prepare_join")).attempt;
    const { key } = await call(client, "agent_join_by_link", { url, name: "Гость", attempt });
    const videoAccess = vi.spyOn(svc, "videoAccess");
    vi.spyOn(svc, "botMediaView").mockResolvedValue({
      gameId: "quizor",
      now: 0,
      view: { blocks: [{ type: "image", asset: asset.id }], reveal: [], fields: [] },
    });
    const img = await client.callTool({ name: "agent_media", arguments: { lobbyId, key, assetId: asset.id } });
    expect(img.isError).not.toBe(true);
    const png = Buffer.from((img.content as { data: string }[])[0]!.data, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.includes(Buffer.from("PRIVATE_IMAGE_METADATA"))).toBe(false);
    const hidden = await client.callTool({
      name: "agent_media",
      arguments: { lobbyId, key, sceneKey: "a".repeat(32) },
    });
    expect(hidden.isError).toBe(true);
    expect(videoAccess).not.toHaveBeenCalled();
  });

  it("creates blindly from a preset with a player token and gives two independent guests distinct identities", async () => {
    const owner = await signUp(t, "owner");
    const token = await t.app.inject({
      method: "POST",
      url: "/api/tokens",
      headers: { cookie: owner.cookie },
      payload: { name: "Игрок", scope: "player" },
    });
    expect(token.json().token.scope).toBe("player");
    const creator = await connect(token.json().secret);
    const caps = await call(creator, "game_capabilities", { gameId: "quizor" });
    expect(caps.presets.length).toBeGreaterThan(0);
    expect(caps).not.toHaveProperty("configSchema");
    expect(caps).not.toHaveProperty("presetConfigs");
    expect((await creator.listTools()).tools.map((x) => x.name)).not.toContain("config_probe");
    const { lobby, inviteUrl } = await call(creator, "lobby_create", {
      preset: { gameId: "tic-tac-toe", presetId: "classic", players: 4 },
      player: { name: "Рин", difficulty: "maximum" },
    });
    expect(lobby.seats).toBe(4);
    const first = await connect(),
      second = await connect();
    const attempt = (await call(first, "agent_prepare_join")).attempt;
    const one = await call(first, "agent_join_by_link", { url: inviteUrl, name: "Рин", attempt });
    const same = await call(first, "agent_join_by_link", { url: inviteUrl, name: "Рин", attempt });
    expect(same.key).toBe(one.key);
    const two = await call(second, "agent_join_by_link", {
      url: lobby.url,
      name: "Рин",
      attempt: (await call(second, "agent_prepare_join")).attempt,
    });
    expect(one.member.bot.number).not.toBe(two.member.bot.number);
    expect(one.member.bot.difficulty).toBe("maximum");
    const wait = await call(first, "agent_wait", { lobbyId: lobby.id, key: one.key, timeoutMs: 0 });
    expect(wait.event.kind).toBe("waiting");
    await expect(
      call(second, "agent_join_by_link", {
        url: inviteUrl,
        name: "Рин",
        attempt: (await call(second, "agent_prepare_join")).attempt,
      }),
    ).rejects.toThrow();
  });
});
