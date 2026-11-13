// Live check of task 07 through both real MCP servers. Douga (stdio, ../douga) builds
// interactive videos by both entries: a finished linear video copied and made
// interactive, and a video from an interactive recipe; then a quiz video from the
// archetypes example. Each is published; asobiba (HTTP, verify-a token) imports the
// snapshots, checks a Quizor config with scenes and creates a lobby.
// Needs: douga `npm run dev` + `npm run studio:worker`, its e2e account
// (node scripts/e2e-setup.mjs in douga), asobiba `npm run dev`, scripts/seed-verify.ts.
// Usage: npx tsx --env-file-if-exists=.env scripts/verify-video.ts [--out storage/verification/07-video-games/live]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { interactiveExample } from "@douga/video";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const root = resolve(import.meta.dirname, "..");
const douga = resolve(root, "../douga");
const out = resolve(root, arg("out", "storage/verification/07-video-games/live"));
const base = arg("base", "http://127.0.0.1:8787");
const actor = arg("actor", "e2e@test.local");
mkdirSync(out, { recursive: true });
const save = (name: string, data: unknown) => writeFileSync(resolve(out, name), JSON.stringify(data, null, 2) + "\n");
const step = (msg: string) => console.log(`✓ ${msg}`);

type Call = (name: string, args?: Record<string, unknown>) => Promise<any>;
function caller(client: Client): Call {
  return async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
    const content = res.content as { type: string; text?: string; data?: string }[];
    const text = content.find((c) => c.type === "text")?.text ?? "null";
    if (res.isError) throw new Error(`${name}: ${text}`);
    return Object.assign(JSON.parse(text), { __content: content });
  };
}

// ---- Douga ---------------------------------------------------------------------------
const dougaClient = new Client({ name: "verify-video", version: "1.0.0" });
await dougaClient.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [resolve(douga, "node_modules/tsx/dist/cli.mjs"), "--env-file-if-exists=.env", "--tsconfig", "tsconfig.mcp.json", "src/mcp/server.ts"],
    cwd: douga,
    env: Object.fromEntries(Object.entries({ ...process.env, MCP_ACTOR_EMAIL: actor }).filter(([, v]) => v !== undefined)) as Record<string, string>,
    stderr: "ignore",
  }),
);
const d = caller(dougaClient);
const caps = await d("video_capabilities");
step(`douga capabilities: interactive contract ${caps.interactive.contract}, ${caps.interactive.recipes.length} recipes, transport ${caps.protocol.transport}`);

async function commit(projectId: string) {
  const project = await d("video_project_get", { projectId });
  return d("video_draft_commit", { projectId, expectedVersion: project.version });
}
async function publish(projectId: string, label: string) {
  let pub = await d("video_interactive_publish", { projectId });
  for (let i = 0; i < 120 && pub.status !== "ready"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    pub = (await d("video_interactive_get", { projectId })).publication;
  }
  if (pub.status !== "ready") throw new Error(`${label}: stills not ready`);
  step(`${label}: published revision ${pub.revision}, ${pub.scenes} interactive scenes, stills ${pub.stills}`);
  return pub;
}

// Entry 1: a finished linear picker video becomes a game through a copy.
const linear = await d("video_project_create", { presetId: "recipe.clean.picker.wide", title: "Архетипы (линейный)" });
const participants = ["a", "b", "c"].map((id) => ({ id, label: `Архетип ${id.toUpperCase()}` }));
await d("video_content_set", {
  projectId: linear.id,
  expectedVersion: linear.version,
  content: {
    kind: "picker",
    mode: "replace",
    title: "Архетипы",
    participants,
    rounds: [{ id: "q1", prompt: "Кто твой любимец?", cards: participants.map((p) => ({ participantId: p.id })), answerParticipantIds: ["a"] }],
  },
});
const linearCommitted = await commit(linear.id);
step(`entry 1: linear project ${linear.id} revision ${linearCommitted.revision}`);
const copy = await d("video_project_copy", { projectId: linear.id, title: "Архетипы: игра" });
await d("video_content_set", {
  projectId: copy.id,
  expectedVersion: copy.version,
  content: {
    kind: "picker",
    mode: "merge",
    interactive: {
      moments: [{ id: "wait", sceneId: "main", at: { event: "timer.start" } }],
      choices: [{ id: "favourite", sceneId: "main", cards: "all" }],
    },
  },
});
await commit(copy.id);
const original = await d("video_document_get", { projectId: linear.id, section: "head" });
if (JSON.stringify(original).includes('"interactive"')) throw new Error("the original got an interactive layer");
step(`entry 1: copy ${copy.id} has the layer, the original keeps its linear video`);
const entry1 = await publish(copy.id, "entry 1");

// Entry 2: from scratch by an interactive recipe.
const recipes = await d("video_interactive_recipe_list", { format: "wide" });
const fromRecipe = await d("video_interactive_create", { recipeId: "recipe.interactive.vote-result.wide", title: "Топ по голосам" });
step(`entry 2: ${recipes.recipes.length} wide recipes, project ${fromRecipe.id} from vote-result`);
const entry2 = await publish(fromRecipe.id, "entry 2");

// The quiz video: archetypes with a question, a top by votes and a scoreboard.
const archetypes = interactiveExample();
for (const p of archetypes.source.participants) delete p.media;
delete archetypes.audio;
archetypes.title = "Архетипы: видео-квиз";
archetypes.settings.typography = { version: 1, theme: "clean" };
const quiz = await d("video_project_create", { document: archetypes });
const timeline = await d("video_timeline_get", { projectId: quiz.id, matchData: { players: [{ id: "x", name: "Икс" }, { id: "y", name: "Игрек" }, { id: "z", name: "Зет" }] }, limit: 100 });
const board = timeline.items.filter((i: { segmentId: string }) => i.segmentId === "board").map((i: { participantId: string }) => i.participantId);
step(`matchData in timeline: board scenes ${board.join(", ")}`);
const quizPub = await publish(quiz.id, "quiz video");
save("douga.json", { linear: linear.id, copy: copy.id, entry1: { revision: entry1.revision, scenes: entry1.scenes }, entry2: { revision: entry2.revision, scenes: entry2.scenes }, quiz: { id: quiz.id, revision: quizPub.revision, scenes: quizPub.scenes }, board });
await dougaClient.close();

// ---- Asobiba ---------------------------------------------------------------------------
const { mcpToken } = JSON.parse(readFileSync(resolve(root, "storage/verify/accounts.json"), "utf8"));
const asoClient = new Client({ name: "verify-video", version: "1.0.0" });
await asoClient.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${mcpToken}` } } }));
const a = caller(asoClient);
const tools = await asoClient.listTools();
step(`asobiba tools: ${tools.tools.length}`);
const quizor = await a("game_capabilities", { gameId: "quizor" });
step(`quizor video section: ${quizor.video ? quizor.video.recipes.length + " recipes" : "missing"}`);

const imported = [];
for (const pub of [entry1, entry2, quizPub]) imported.push(await a("video_snapshot_import", { token: pub.token }));
const again = await a("video_snapshot_import", { token: quizPub.token });
step(`imported ${imported.map((s) => s.id).join(", ")}; repeat reused=${again.reused}`);
const snapshotId = imported[2].id;
const got = await a("video_snapshot_get", { snapshotId, stills: true });
const images = got.__content.filter((c: { type: string }) => c.type === "image");
images.forEach((img: { data: string }, i: number) => writeFileSync(resolve(out, `still-${i}.png`), Buffer.from(img.data, "base64")));
const summary = got.snapshot;
step(`snapshot: ${summary.segments.length} segments, ${summary.scenes.length} scenes, ${images.length} stills`);

const options = ["a", "b", "c"].map((id) => ({ id, text: `Архетип ${id.toUpperCase()}`, card: `card-${id}` }));
const preset = quizor.presetConfigs[0].config;
const config = {
  ...preset,
  title: "Архетипы: видео-квиз",
  rules: {
    video: { snapshot: snapshotId },
    players: { min: 1, max: 8 },
    defaults: { judge: "poll", poll: { scoring: "majority" }, timers: { preloadSeconds: 0, revealSeconds: 12, answerSeconds: 60 } },
    rounds: [
      {
        id: "r1",
        title: "Любимцы",
        intro: [{ type: "scene", play: { segmentId: "board" }, data: "scores" }],
        questions: [
          {
            id: "fav",
            prompt: "Кто твой любимец?",
            blocks: [{ type: "scene", play: { segmentId: "question" }, hold: "wait" }],
            fields: [{ id: "pick", type: "choice", label: "Любимец", options }],
            reveal: [{ type: "scene", play: { segmentId: "result" }, data: "poll" }],
          },
        ],
      },
    ],
    tiebreak: [],
  },
};
const validation = await a("config_validate", { config });
if (!validation.ok) throw new Error(`config_validate: ${JSON.stringify(validation.issues)}`);
const block = validation.config.rules.rounds[0].questions[0].blocks[0];
step(`config_validate ok: question scene ${block.durationSeconds.toFixed(2)} s to hold, warnings ${validation.issues.length}`);
const preview = await a("config_preview", { config: validation.config, target: { kind: "question", id: "fav" } }).catch((e: Error) => ({ error: e.message }));
step(`config_preview: ${"error" in preview ? preview.error : "ok"}`);
const lobby = await a("lobby_create", { name: "Видео-квиз", config: validation.config });
step(`lobby: ${lobby.lobby.url}`);
save("asobiba.json", { snapshots: imported.map((s) => ({ id: s.id, title: s.title, scenes: s.scenes, bytes: s.bytes })), snapshotId, lobby: lobby.lobby, config: validation.config });
await asoClient.close();
