import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb, SIMPLE_SVG, signUp, type TestApp } from "../test/helpers";
import { MCP_INSTRUCTIONS, TOOL_NAMES } from "./instructions";
import { wavSeconds } from "../assets/media-fixtures";
import { MAX_CONFIG_BYTES } from "../configs/service";

let t: TestApp;
let base = "";
beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  base = await t.listen();
});
afterEach(async () => {
  await t?.close();
});

async function connect(secret: string): Promise<Client> {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
  return client;
}

type Content = { type: string; text?: string; data?: string; mimeType?: string };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Content[] };
  const text = res.content.find((c) => c.type === "text")?.text ?? "null";
  return { isError: !!res.isError, json: JSON.parse(text), content: res.content };
}

describe("MCP over Streamable HTTP", () => {
  it("allows a configuration at its storage limit inside the MCP transport envelope", async () => {
    const owner = await signUp(t, "owner");
    const { secret } = await t.services.auth.createToken(owner.user.id, "Граница размера");
    const client = await connect(secret);
    try {
      const config = { note: "" };
      config.note = "x".repeat(MAX_CONFIG_BYTES - Buffer.byteLength(JSON.stringify(config)));
      const saved = await call(client, "config_save", { config, name: "Полный черновик" });
      expect(saved.isError).toBe(false);
      expect(saved.json.config.document.note.length).toBe(config.note.length);
      const tooLarge = await call(client, "config_save", { config: { note: config.note + "x" } });
      expect(tooLarge.isError).toBe(true);
      expect(tooLarge.json.issues[0].code).toBe("config_limit");
    } finally {
      await client.close();
    }
  });

  it("lets an agent repair, rename and copy owned configurations", async () => {
    const owner = await signUp(t, "owner");
    const other = await signUp(t, "other");
    const client = await connect((await t.services.auth.createToken(owner.user.id, "Редактор")).secret);
    try {
      const config = { sdk: 1, game: "tic-tac-toe", gameVersion: 1, title: "Исходный заголовок" };
      const draft = await call(client, "config_save", { config: { game: "unknown-game" }, name: "Рабочий сценарий" });
      expect(draft.isError).toBe(false);
      const configId = draft.json.config.id;
      expect(draft.json.config).toMatchObject({ title: "Рабочий сценарий", validationStatus: "invalid" });
      expect((await call(client, "lobby_create", { configId })).json.error.code).toBe("invalid_config");
      const repaired = await call(client, "config_save", { configId, config });
      expect(repaired.json.config).toMatchObject({ id: configId, title: "Рабочий сценарий", validationStatus: "valid", document: config });
      expect((await call(client, "config_save", { configId, name: "Новое имя" })).json.config).toMatchObject({ id: configId, title: "Новое имя", document: config });
      for (const args of [{}, { configId, config }]) {
        expect((await call(client, "lobby_create", args)).json.error.code).toBe("config_source");
      }
      const created = await call(client, "lobby_create", { configId });
      expect(created.json.lobby.name).toBe(config.title);
      const lobbyId = created.json.lobby.id;
      const copy = await call(client, "config_save", { lobbyId, name: "Снимок" });
      expect(copy.json.config).toMatchObject({ title: "Снимок", validationStatus: "valid", document: { title: config.title, rules: expect.any(Object) } });
      expect(copy.json.config.id).not.toBe(configId);
      for (const args of [{ lobbyId }, { config, lobbyId, name: "X" }, { configId, lobbyId, name: "X" }, { configId }, { name: "X" }]) {
        expect((await call(client, "config_save", args)).isError).toBe(true);
      }
      const foreign = await t.services.lobbies.create(other.user, { config });
      expect((await call(client, "config_save", { lobbyId: foreign.id, name: "Чужой снимок" })).json.error.code).toBe("forbidden");
      const listed = (await call(client, "config_list")).json.configs;
      expect(listed).toHaveLength(2);
      expect(listed[0]).not.toHaveProperty("document");
      expect(listed[0]).not.toHaveProperty("issues");
    } finally { await client.close(); }
  });

  it("freezes a full uploaded WAV duration through the real agent recipe", async () => {
    const owner = await signUp(t, "owner");
    const { secret } = await t.services.auth.createToken(owner.user.id, "Media timing");
    const client = await connect(secret);
    try {
      const ticket = await call(client, "asset_upload_begin", { name: "12.5 seconds" });
      const response = await fetch(`${base}${new URL(ticket.json.uploadUrl).pathname}`, { method: "PUT", body: new Uint8Array(wavSeconds(12.5)) });
      expect(response.status).toBe(201);
      const { asset } = await response.json() as { asset: { id: string } };
      const caps = await call(client, "game_capabilities", { gameId: "quizor" });
      const config = caps.json.presetConfigs.find((p: { id: string }) => p.id === "classic").config;
      config.rules.rounds[0].questions[0].blocks = [{ type: "audio", asset: asset.id }];
      const valid = await call(client, "config_validate", { config });
      expect(valid.json.ok).toBe(true);
      expect(valid.json.config.rules.rounds[0].questions[0].blocks[0].durationSeconds).toBe(12.5);
      const saved = await call(client, "config_save", { config });
      expect(saved.isError).toBe(false);
      expect(saved.json.config).toMatchObject({ secretsHidden: true, validationStatus: "valid" });
      expect(saved.json.config.document.rules.rounds[0].questions).toEqual([]);
      const original = await call(client, "config_get", { configId: saved.json.config.id, revealSecrets: true });
      expect(original.json.config.document).toEqual(config);
      const lobby = await call(client, "lobby_create", { name: "Timed audio", configId: saved.json.config.id });
      expect(lobby.isError).toBe(false);
      const frozen = await t.db.lobby.findUniqueOrThrow({ where: { id: lobby.json.lobby.id } });
      expect((frozen.config as any).rules.rounds[0].questions[0].blocks[0].durationSeconds).toBe(12.5);
    } finally { await client.close(); }
  });

  it("rejects requests without a valid token", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer asb_wrong" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(Buffer.byteLength(MCP_INSTRUCTIONS, "utf8")).toBeLessThan(3072);
  });

  it("walks the agent recipe from capabilities to a lobby", async () => {
    const ann = await signUp(t, "ann");
    const { secret } = await t.services.auth.createToken(ann.user.id, "Claude");
    const client = await connect(secret);

    expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);
    const tools = await client.listTools();
    expect(tools.tools.map((x) => x.name).sort()).toEqual([...TOOL_NAMES].sort());

    const games = await call(client, "games_list");
    expect(games.json.games[0].id).toBe("tic-tac-toe");
    const caps = await call(client, "game_capabilities", { gameId: "tic-tac-toe" });
    expect(caps.json.configSchema.properties.rules).toBeDefined();
    expect(caps.json.slots.map((s: { path: string }) => s.path)).toContain("visual.pieces[i]");
    const party = caps.json.presetConfigs.find((p: { id: string }) => p.id === "party").config;

    const bad = await call(client, "config_validate", { config: { ...party, rules: { ...party.rules, win: { line: 9 } } } });
    expect(bad.json.ok).toBe(false);
    expect(bad.json.issues[0]).toMatchObject({ path: "rules.win.line" });

    const svg = await call(client, "asset_create_svg", { name: "кругляш", svg: SIMPLE_SVG });
    expect(svg.json.asset).toMatchObject({ width: 512, mime: "image/png" });
    const config = { ...party, title: "Смешные кругляши", visual: { ...party.visual, pieces: [{ asset: svg.json.asset.id }, { preset: "cat" }] } };

    const ok = await call(client, "config_validate", { config });
    expect(ok.json.ok).toBe(true);

    const sim = await call(client, "config_simulate", { config, rounds: 30 });
    expect(sim.json.finished).toBe(30);

    const preview = await call(client, "config_preview", { config, moment: "end", seed: 2 });
    const image = preview.content.find((c) => c.type === "image");
    expect(image?.mimeType).toBe("image/png");
    const png = Buffer.from(image?.data ?? "", "base64");
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(768);

    const saved = await call(client, "config_save", { config });
    expect(saved.json.config.id).toMatch(/^cfg_/);
    const list = await call(client, "config_list");
    expect(list.json.configs).toEqual([expect.objectContaining({ id: saved.json.config.id, title: "Смешные кругляши" })]);

    const lobby = await call(client, "lobby_create", { name: "Вечеринка у Ани", configId: saved.json.config.id });
    expect(lobby.json.lobby.url).toBe(`http://asobiba.test/lobby/${lobby.json.lobby.id}`);
    const got = await call(client, "lobby_get", { lobbyId: lobby.json.lobby.id });
    expect(got.json.lobby.host.login).toBe("ann");
    expect(got.json.match).toBeNull();

    const upload = await call(client, "asset_upload_begin", { name: "фон" });
    expect(upload.json.uploadUrl).toMatch(/^http:\/\/asobiba\.test\/api\/uploads\/upl_/);
    expect(upload.json.method).toBe("PUT");
  });

  it("labels a budget-limited large map preview as an intermediate position", async () => {
    const ann = await signUp(t, "ann");
    const { secret } = await t.services.auth.createToken(ann.user.id, "Preview");
    const client = await connect(secret);
    try {
      const rows = Array.from({ length: 200 }, (_, y) => y === 0 ? "11" + ".".repeat(198) : y === 199 ? ".".repeat(198) + "22" : ".".repeat(200));
      const preview = await call(client, "config_preview", { config: { sdk: 1, game: "jinchi", gameVersion: 1, rules: { map: { width: 200, height: 200, rows }, dice: { sides: 2 }, capture: { walls: false }, end: { skipRounds: 0 } } }, moment: "end", seed: 1 });
      expect(preview.isError).toBe(false);
      expect(preview.json).toMatchObject({ phase: "playing", partial: true });
      expect(preview.json.round).not.toBe("раунд не начат");
      expect(preview.content.some(c => c.type === "image")).toBe(true);
    } finally { await client.close(); }
  });

  it("exposes authoring probes without allowing game moves", async () => {
    const ann = await signUp(t, "ann");
    const { secret } = await t.services.auth.createToken(ann.user.id, "Authoring");
    const client = await connect(secret);
    try {
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain("config_probe");
      const response = await call(client, "config_probe", { config: { sdk: 1, game: "tic-tac-toe", gameVersion: 1 }, questionId: "q", answers: [{ answer: "A" }] });
      expect(response.isError).toBe(true);
      expect(response.json.error.code).toBe("unsupported_probe");
      const tools = await client.listTools();
      expect(tools.tools.some(tool => /action|control|move/.test(tool.name))).toBe(false);
    } finally { await client.close(); }
  });

  it("grades Quizor examples and resolves inherited settings through real MCP", async () => {
    const ann = await signUp(t, "ann");
    const { secret } = await t.services.auth.createToken(ann.user.id, "Quizor author");
    const client = await connect(secret);
    const config = {
      sdk: 1, game: "quizor", gameVersion: 1,
      rules: {
        defaults: { value: 80 },
        rounds: [{ id: "r", settings: { value: 120 }, questions: [{
          id: "q", prompt: "Столица?", settings: { value: 200 },
          fields: [{ id: "a", type: "text", settings: { value: 300 }, answers: [{ text: "Москва" }] }],
        }] }],
      },
    };
    try {
      const resolved = await call(client, "config_resolve", { config, questionId: "q" });
      expect(resolved.isError, JSON.stringify(resolved.json)).toBe(false);
      expect(resolved.json).toMatchObject({ settings: { value: 200 }, provenance: { value: "question:q" }, fields: [{ settings: { value: 300 }, provenance: { value: "field:a" } }] });
      const grades = await call(client, "config_probe", { config, questionId: "q", answers: [{ a: "Москва" }, { a: "Париж" }] });
      expect(grades.isError).toBe(false);
      expect(grades.json.grades).toMatchObject([{ grade: "correct", points: 300, fields: [{ fieldId: "a", correct: true, explanation: expect.any(String) }] }, { grade: "miss", points: 0 }]);
      const missing = await call(client, "config_resolve", { config, questionId: "missing" });
      expect(missing.isError).toBe(true);
      expect(missing.json.error.code).toBe("not_found");
      const preview = await call(client, "config_preview", { config, target: { kind: "question", id: "q" } });
      expect(preview.isError).toBe(false);
      expect(preview.json).toMatchObject({ partial: false, target: { kind: "question", id: "q" }, width: 768 });
      expect(preview.content.some(item => item.type === "image" && item.mimeType === "image/png")).toBe(true);
      const badPreview = await call(client, "config_preview", { config, target: { kind: "question", id: "missing" } });
      expect(badPreview.isError).toBe(true);
      expect(badPreview.json.error.code).toBe("target_not_found");
    } finally { await client.close(); }
  });

  it("keeps users apart", async () => {
    const ann = await signUp(t, "ann");
    const bob = await signUp(t, "bob");
    const annAsset = await t.services.assets.createFromSvg(ann.user.id, "a", SIMPLE_SVG);
    const annConfig = await t.services.configs.save(ann.user.id, {
      sdk: 1,
      game: "tic-tac-toe",
      gameVersion: 1,
      visual: { pieces: [{ asset: annAsset.id }] },
    });
    const { secret } = await t.services.auth.createToken(bob.user.id, "Bob agent");
    const client = await connect(secret);

    expect((await call(client, "config_get", { configId: annConfig.id })).isError).toBe(true);
    const stolen = await call(client, "lobby_create", { name: "x", config: annConfig.document });
    expect(stolen.isError).toBe(true);
    expect(stolen.json.issues[0]).toMatchObject({ code: "asset_not_found" });
    const lobby = await t.services.lobbies.create(ann.user, { name: "Анино", configId: annConfig.id });
    const close = await call(client, "lobby_close", { lobbyId: lobby.id });
    expect(close.isError).toBe(true);
    expect(close.json.error.code).toBe("forbidden");
  });
});
