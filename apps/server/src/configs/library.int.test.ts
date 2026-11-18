import type { ConfigsResponse } from "@asobiba/api";
import { yomifuda } from "@asobiba/game-yomifuda";
import { presetDocument } from "@asobiba/sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PNG_1x1, createTestApp, resetDb, signUp, type TestApp, type TestUser } from "../test/helpers";
import { MAX_CONFIG_BYTES, MAX_CONFIGS_PER_USER } from "./service";

let t: TestApp;
let owner: TestUser;
beforeEach(async () => {
  t = await createTestApp();
  await resetDb(t.db);
  owner = await signUp(t, "owner");
});
afterEach(async () => { vi.restoreAllMocks(); await t?.close(); });

const source = { sdk: 1, game: "tic-tac-toe", gameVersion: 1, title: "Игровой заголовок" };
const request = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: Record<string, unknown>, cookie = owner.cookie) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

it("allows a configuration at its storage limit inside the HTTP transport envelope", async () => {
  const config = { note: "" };
  config.note = "x".repeat(MAX_CONFIG_BYTES - Buffer.byteLength(JSON.stringify(config)));
  const saved = await request("POST", "/api/configs", { config, name: "Полный черновик" });
  expect(saved.statusCode).toBe(201);
  expect(saved.json().config.document.note.length).toBe(config.note.length);
  const tooLarge = await request("POST", "/api/configs", { config: { note: config.note + "x" } });
  expect(tooLarge.statusCode).toBe(422);
  expect(tooLarge.json().issues[0].code).toBe("config_limit");
});

it("stores drafts verbatim, preserves their library name on repair and freezes new lobbies", async () => {
  const draft = { title: "Черновик", unfinished: { note: "сценарий" } };
  const saved = await request("POST", "/api/configs", { config: draft, name: "Пятничная игра" });
  expect(saved.statusCode).toBe(201);
  expect(saved.json().config).toMatchObject({
    document: draft, title: "Пятничная игра", gameId: "", validationStatus: "invalid",
    issues: [expect.objectContaining({ path: "game", code: "unknown_game" })],
  });
  const { id } = saved.json().config;
  expect((await request("POST", "/api/lobbies", { configId: id })).statusCode).toBe(422);
  const listed = (await request("GET", "/api/configs")).json<ConfigsResponse>().configs;
  expect(listed).toEqual([expect.objectContaining({ id, validationStatus: "invalid" })]);
  expect(listed[0]).not.toHaveProperty("document");
  expect(listed[0]).not.toHaveProperty("issues");

  const repaired = await request("PUT", `/api/configs/${id}`, { config: source });
  expect(repaired.json().config).toMatchObject({ document: source, title: "Пятничная игра", validationStatus: "valid" });
  expect(repaired.json().config.document).toEqual(source);
  const renamed = await request("PATCH", `/api/configs/${id}`, { name: "Субботняя игра" });
  expect(renamed.json().config).toMatchObject({ title: "Субботняя игра", document: source });
  const created = await request("POST", "/api/lobbies", { configId: id });
  expect(created.statusCode).toBe(201);
  expect(created.json().lobby).toMatchObject({ name: source.title, config: { rules: expect.any(Object) } });
  await request("PUT", `/api/configs/${id}`, { config: { ...source, title: "Другой сценарий" } });
  expect((await request("GET", `/api/lobbies/${created.json().lobby.id}`)).json().lobby.config.title).toBe(source.title);
});

it("accepts a draft during temporary validation failure and rechecks current assets", async () => {
  const asset = await t.services.assets.save(owner.user.id, { body: PNG_1x1, source: "upload" });
  const config = { ...source, visual: { pieces: [{ asset: asset.id }] } };
  const unavailable = vi.spyOn(t.services.assets, "ownershipIssues").mockRejectedValue(new Error("validation dependency temporarily down"));
  const saved = await request("POST", "/api/configs", { config });
  expect(saved.statusCode).toBe(201);
  const { id } = saved.json().config;
  expect(saved.json().config).toMatchObject({ document: config, validationStatus: "unavailable" });
  expect((await request("GET", "/api/configs")).json().configs[0]).toMatchObject({ id, validationStatus: "unavailable" });
  unavailable.mockRestore();
  expect((await request("GET", "/api/configs")).json().configs[0]).toMatchObject({ id, validationStatus: "valid" });
  await t.services.assets.remove(owner.user.id, asset.id);
  expect((await request("GET", `/api/configs/${id}`)).json().config).toMatchObject({
    document: config, validationStatus: "invalid", issues: [expect.objectContaining({ code: "asset_not_found" })],
  });
  expect((await request("POST", "/api/lobbies", { configId: id })).statusCode).toBe(422);
});

it("requires exactly one HTTP lobby source", async () => {
  const saved = await request("POST", "/api/configs", { config: source });
  expect(saved.statusCode).toBe(201);
  for (const payload of [{}, { config: source, configId: saved.json().config.id }]) {
    const response = await request("POST", "/api/lobbies", payload);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("config_source");
  }
  expect(await t.db.lobby.count()).toBe(0);
});

it("checks the host and copies secret rules from the lobby row even when the snapshot is stale", async () => {
  const outsider = await signUp(t, "outsider");
  const config = presetDocument(yomifuda, yomifuda.presets[0]);
  const { lobby } = (await request("POST", "/api/lobbies", { config })).json();
  const url = `/api/lobbies/${lobby.id}/config`;
  expect((await request("POST", url, { name: "Чужая колода" }, outsider.cookie)).statusCode).toBe(403);

  const copied = await request("POST", url, { name: "Своя колода" });
  expect(copied.statusCode).toBe(201);
  expect(copied.json().config).toMatchObject({
    title: "Своя колода", secretsHidden: true, validationStatus: "valid", document: { rules: { cards: [] } },
  });
  const copiedUrl = `/api/configs/${copied.json().config.id}?revealSecrets=true`;
  expect((await request("GET", copiedUrl)).json().config.document).toEqual(config);
  expect((await request("GET", copiedUrl, undefined, outsider.cookie)).statusCode).toBe(404);
  expect((await request("PATCH", `/api/configs/${copied.json().config.id}`, { name: "Чужая" }, outsider.cookie)).statusCode).toBe(404);

  const stale = { ...config, gameVersion: 0, rules: { cards: ["старые закрытые правила"] } };
  await t.db.lobby.update({ where: { id: lobby.id }, data: { config: JSON.parse(JSON.stringify(stale)) } });
  const copiedStale = await request("POST", url, { name: "Прежняя колода" });
  expect(copiedStale.statusCode).toBe(201);
  expect(copiedStale.json().config).toMatchObject({ secretsHidden: true, validationStatus: "invalid", document: { rules: null } });
  expect(copiedStale.body).not.toContain("старые закрытые правила");
  expect((await request("GET", `/api/configs/${copiedStale.json().config.id}?revealSecrets=true`)).json().config.document).toEqual(stale);
});

it("enforces the object, byte and concurrent library limits", async () => {
  expect((await request("POST", "/api/configs", { config: [source] })).statusCode).toBe(422);
  await expect(t.services.configs.save(owner.user.id, { note: "я".repeat(MAX_CONFIG_BYTES / 2) })).rejects.toMatchObject({
    status: 422, issues: [expect.objectContaining({ code: "config_limit" })],
  });
  await t.db.gameConfig.createMany({
    data: Array.from({ length: MAX_CONFIGS_PER_USER - 1 }, (_, index) => ({
      id: `draft-${index}`, ownerId: owner.user.id, title: "Черновик", gameId: "", document: {},
    })),
  });
  const results = await Promise.all([request("POST", "/api/configs", { config: {} }), request("POST", "/api/configs", { config: {} })]);
  expect(results.map(({ statusCode }) => statusCode).sort()).toEqual([201, 409]);
});

it("keeps an oversized game identifier only in the document", async () => {
  const config = { game: "a".repeat(81) };
  const saved = await request("POST", "/api/configs", { config });
  expect(saved.statusCode).toBe(201);
  expect(saved.json().config).toMatchObject({ document: config, gameId: "", validationStatus: "invalid" });
  expect((await request("GET", "/api/configs")).json().configs[0].gameId).toBe("");
});

it("allows a guest to read the demonstration guide while keeping the library private", async () => {
  const { lobby } = (await request("POST", "/api/lobbies", { config: source })).json();
  const joined = await request("POST", "/api/auth/guest", {
    name: "Гость", lobbyId: lobby.id, role: "spectator", attempt: "a".repeat(40),
  }, "");
  expect(joined.statusCode).toBe(200);
  const header = joined.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0] : header)?.split(";")[0];
  expect(cookie).toBeTruthy();
  const guide = await request("GET", "/api/games/yomifuda/guide", undefined, cookie);
  expect(guide.statusCode).toBe(200);
  expect(guide.json().guide).toMatchObject({
    id: "yomifuda", exampleConfig: { game: "yomifuda" },
  });
  expect(guide.json().guide.promptExamples).toEqual(expect.arrayContaining([expect.any(String)]));
  expect(guide.body).not.toContain(source.title);
  expect((await request("GET", "/api/games/missing/guide", undefined, cookie)).statusCode).toBe(404);
  expect((await request("GET", "/api/games/yomifuda/guide", undefined, "")).statusCode).toBe(401);
  expect((await request("GET", "/api/configs", undefined, cookie)).statusCode).toBe(403);
  expect((await request("POST", `/api/lobbies/${lobby.id}/config`, { name: "Копия" }, cookie)).statusCode).toBe(403);
});
