import { createHash } from "node:crypto";
import type { ServerMessage } from "@asobiba/api";
import { quizor, type QuizorView } from "@asobiba/game-quizor";
import { presetDocument } from "@asobiba/sdk";
import {
  compileVideo,
  INTERACTIVE_SNAPSHOT_FORMAT,
  interactiveExample,
  interactiveSnapshotHash,
  type InteractiveSnapshot,
} from "@douga/video";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, PNG_1x1, resetDb, signUp, type TestApp, type TestUser } from "../test/helpers";
import { LOCAL_REMOTION_VERSION } from "./service";

const TOKEN = "tok_abcdefghijklmnop";
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const PNG_HASH = sha(PNG_1x1);

/** A real snapshot made with Douga's own functions: archetypes with one image per card. */
async function makeSnapshot(engine = LOCAL_REMOTION_VERSION): Promise<InteractiveSnapshot> {
  const document = interactiveExample();
  delete document.audio;
  const src = `${PNG_HASH}.png`;
  const manifest = Object.fromEntries(
    ["a", "b", "c"].map((id) => [id, { id, kind: "image" as const, src, width: 1, height: 1, hash: PNG_HASH }]),
  );
  const plan = compileVideo(document, manifest).plan;
  const content: Omit<InteractiveSnapshot, "hash"> = {
    format: INTERACTIVE_SNAPSHOT_FORMAT,
    version: 1,
    contract: 1,
    engine: { remotion: engine, compilerVersion: plan.compilerVersion, packages: "douga-packages@1" },
    project: { id: "prj", title: "Архетипы", revision: 3 },
    document,
    manifest,
    files: [{ hash: PNG_HASH, ext: ".png", bytes: PNG_1x1.length, kind: "image" }],
    runtimeFonts: [],
    fps: plan.fps,
    width: plan.width,
    height: plan.height,
    durationInFrames: plan.durationInFrames,
    scenes: plan.interaction!.scenes.map((s) => ({
      id: s.id, sourceSceneId: s.sourceSceneId, ...(s.segmentId ? { segmentId: s.segmentId } : {}), title: s.sourceSceneId,
      from: s.from, to: s.to, holds: s.holds,
      choices: s.choices.map(({ nodeId: _n, ...c }) => c), uses: s.uses,
    })),
    segments: (plan.segments ?? []).map((s) => ({ id: s.id, title: s.title ?? s.id, from: s.from, to: s.to })),
    sample: document.interactive!.sample,
  };
  return { ...content, hash: await interactiveSnapshotHash(content) };
}

let t: TestApp;
let snapshot: InteractiveSnapshot;
let calls: string[];
let status = 200;

beforeEach(async () => {
  snapshot = await makeSnapshot();
  calls = [];
  status = 200;
  t = await createTestApp({
    dougaUrl: "http://douga.test",
    fetch: (async (url: string) => {
      calls.push(url);
      if (status !== 200) return new Response("{}", { status });
      if (url.endsWith(`/api/interactive/${TOKEN}/manifest`)) return new Response(JSON.stringify(snapshot));
      if (url.endsWith(`/api/interactive/${TOKEN}/files/${PNG_HASH}.png`)) return new Response(PNG_1x1);
      return new Response(null, { status: 404 });
    }) as typeof fetch,
  });
  await resetDb(t.db);
});
afterEach(async () => {
  await t?.close();
});

async function post(user: TestUser, url: string, payload: unknown) {
  const res = await t.app.inject({ method: "POST", url, headers: { cookie: user.cookie }, payload: payload as never });
  return { status: res.statusCode, body: res.json() };
}

function quizConfig(id: string) {
  const config = presetDocument(quizor);
  const options = ["a", "b", "c"].map((p) => ({ id: p, text: `Архетип ${p}`, card: `card-${p}` }));
  config.rules = quizor.rulesSchema.parse({
    video: { snapshot: id },
    defaults: { judge: "poll", poll: { scoring: "majority" }, timers: { preloadSeconds: 0 } },
    rounds: [
      {
        id: "r",
        questions: [
          {
            id: "q",
            prompt: "Кто твой любимец?",
            blocks: [{ type: "scene", play: { segmentId: "question" }, hold: "wait" }],
            fields: [{ id: "pick", type: "choice", options }],
            reveal: [{ type: "scene", play: { segmentId: "result" }, data: "poll" }],
          },
        ],
      },
    ],
  });
  return config;
}

describe("Douga snapshots", () => {
  it("imports by token once, stores files by hash and refuses broken or foreign snapshots", async () => {
    const owner = await signUp(t, "owner");
    const first = await post(owner, "/api/video/snapshots", { token: TOKEN });
    expect(first.status).toBe(201);
    expect(first.body.snapshot).toMatchObject({ title: "Архетипы", revision: 3, bytes: PNG_1x1.length });
    expect(first.body.snapshot.id).toMatch(/^vsn_/);
    const again = await post(owner, "/api/video/snapshots", { token: TOKEN });
    expect(again).toMatchObject({ status: 200, body: { reused: true, snapshot: { id: first.body.snapshot.id } } });
    expect(calls.filter((c) => c.includes("/files/"))).toHaveLength(1);
    // Nothing in the log or the database keeps the token.
    expect(JSON.stringify(await t.db.videoSnapshot.findMany(), (_k, v) => (typeof v === "bigint" ? Number(v) : v))).not.toContain(TOKEN);

    status = 409;
    expect((await post(owner, "/api/video/snapshots", { token: TOKEN })).body.error.code).toBe("snapshot_not_ready");
    status = 404;
    expect((await post(owner, "/api/video/snapshots", { token: TOKEN })).status).toBe(404);
    status = 200;
    snapshot = await makeSnapshot("4.0.1");
    expect((await post(owner, "/api/video/snapshots", { token: TOKEN })).body.error.code).toBe("douga_version");
    snapshot = { ...(await makeSnapshot()), title: "x" } as never;
    expect((await post(owner, "/api/video/snapshots", { token: TOKEN })).body.error.code).toBe("bad_snapshot");
    snapshot = { ...(await makeSnapshot()) };
    snapshot.project.title = "Подмена";
    expect((await post(owner, "/api/video/snapshots", { token: TOKEN })).body.error.code).toBe("bad_snapshot");
    expect((await post(owner, "/api/video/snapshots", { token: "../../etc" })).body.error.code).toBe("bad_token");

    const other = await signUp(t, "other");
    const list = await t.app.inject({ method: "GET", url: "/api/video/snapshots", headers: { cookie: other.cookie } });
    expect(list.json().snapshots).toEqual([]);
    const foreign = await t.app.inject({ method: "DELETE", url: `/api/video/snapshots/${first.body.snapshot.id}`, headers: { cookie: other.cookie } });
    expect(foreign.statusCode).toBe(404);
  });

  it("times scenes from frames, serves slices only when shown and files only of given slices", async () => {
    const host = await signUp(t, "host");
    const player = await signUp(t, "player");
    const stranger = await signUp(t, "stranger");
    const { snapshot: imported } = (await post(host, "/api/video/snapshots", { token: TOKEN })).body;
    const config = quizConfig(imported.id);
    const validation = await t.services.configs.validate(host.user.id, config);
    expect(validation.issues.filter((i) => i.severity === "error")).toEqual([]);
    const rules = validation.config!.rules as ReturnType<typeof quizor.rulesSchema.parse>;
    const question = snapshot.scenes.find((s) => s.holds.length)!;
    const segment = snapshot.segments.find((s) => s.id === "question")!;
    expect(rules.rounds[0].questions[0].blocks[0]).toMatchObject({
      startSeconds: 0,
      durationSeconds: (question.holds[0].frame - segment.from) / snapshot.fps,
    });
    const deleted = await t.app.inject({ method: "DELETE", url: `/api/video/snapshots/${imported.id}`, headers: { cookie: host.cookie } });
    expect(deleted.statusCode).toBe(200);
    const { snapshot: back } = (await post(host, "/api/video/snapshots", { token: TOKEN })).body;
    const lobby = await t.services.lobbies.create(host.user, { name: "Видео", config: quizConfig(back.id) });
    await t.services.lobbies.join(player.user, lobby.id, "player");
    expect((await t.app.inject({ method: "DELETE", url: `/api/video/snapshots/${back.id}`, headers: { cookie: host.cookie } })).json().error.code).toBe("video_in_use");

    const messages: ServerMessage[] = [];
    await t.services.lobbies.subscribe({ userId: player.user.id, send: (m) => messages.push(m) }, lobby.id);
    await t.services.lobbies.start(host.user, lobby.id);
    let view: QuizorView | undefined;
    for (let i = 0; i < 20; i++) {
      const last = messages.filter((m) => m.type === "match").at(-1) as Extract<ServerMessage, { type: "match" }> | undefined;
      view = last?.match?.game as QuizorView | undefined;
      if (view?.video) break;
      await t.services.lobbies.action(player.user, lobby.id, { type: "ready" }).catch(() => undefined);
    }
    expect(view?.video).toMatchObject({ play: { segmentId: "question" }, hold: { momentId: "wait" } });
    const key = view!.video!.key;
    const slice = await t.app.inject({ method: "GET", url: `/api/lobbies/${lobby.id}/video/${key}`, headers: { cookie: player.cookie } });
    expect(slice.statusCode).toBe(200);
    const plan = slice.json().plan;
    expect(plan.scenes.every((s: { segmentId: string }) => s.segmentId === "question")).toBe(true);
    expect(plan.interaction.scenes[0].holds[0].momentId).toBe("wait");
    expect(JSON.stringify(plan)).toContain(`/files/video/${PNG_HASH}.png`);
    // The poll result scene is not shown yet: its key is unknown and refused.
    expect((await t.app.inject({ method: "GET", url: `/api/lobbies/${lobby.id}/video/${"0".repeat(32)}`, headers: { cookie: player.cookie } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "GET", url: `/api/lobbies/${lobby.id}/video/${key}`, headers: { cookie: stranger.cookie } })).statusCode).toBe(403);
    const file = await t.app.inject({ method: "GET", url: `/files/video/${PNG_HASH}.png`, headers: { cookie: player.cookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(sha(file.rawPayload)).toBe(PNG_HASH);
    expect((await t.app.inject({ method: "GET", url: `/files/video/${PNG_HASH}.png`, headers: { cookie: stranger.cookie } })).statusCode).toBe(403);
    const range = await t.app.inject({ method: "GET", url: `/files/video/${PNG_HASH}.png`, headers: { cookie: player.cookie, range: "bytes=0-3" } });
    expect(range.statusCode).toBe(206);
  });
});
