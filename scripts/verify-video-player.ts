// Second player of the live video quiz check (task 07): verify-b joins a lobby as a
// player over HTTP and WebSocket, fetches every scene slice it is shown and its files,
// probes keys it was not shown, answers the poll and records the reveal data.
// Usage: npx tsx --env-file-if-exists=.env scripts/verify-video-player.ts <lobbyId> [pick] [--out DIR]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket from "ws";

const root = resolve(import.meta.dirname, "..");
const [lobbyId, pick = "b"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const outIndex = process.argv.indexOf("--out");
const out = resolve(root, outIndex > 0 ? process.argv[outIndex + 1] : "storage/verification/07-video-games/live");
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:8787";
const { accounts } = JSON.parse(readFileSync(resolve(root, "storage/verify/accounts.json"), "utf8"));

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ login: accounts["verify-b"].login, password: accounts["verify-b"].password }),
});
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
if (!login.ok || !cookie) throw new Error(`login ${login.status}`);
const api = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } });
const joined = await api(`/api/lobbies/${lobbyId}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "player" }) });
console.log(`join ${joined.status}`);

const log: Record<string, unknown>[] = [];
const seen = new Set<string>();
let answered = false;
const ws = new WebSocket(`${base.replace("http", "ws")}/ws`, { headers: { cookie } });
ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", lobbyId })));
const done = new Promise<void>((resolveDone) => {
  ws.on("message", async (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== "match" || !message.match) return;
    const view = message.match.game;
    if (message.match.phase === "finished" || view.phase === "done") return resolveDone();
    for (const directive of [view.video, ...(view.videoPreload ?? [])].filter(Boolean)) {
      if (seen.has(directive.key)) continue;
      seen.add(directive.key);
      const res = await api(`/api/lobbies/${lobbyId}/video/${directive.key}`);
      const body = res.ok ? await res.json() : null;
      const files = body ? [...new Set<string>(JSON.stringify(body.plan).match(/\/files\/video\/[a-f0-9]{64}\.[a-z0-9]+/g) ?? [])] : [];
      const statuses = await Promise.all(files.slice(0, 4).map(async (f) => (await api(f, { method: "HEAD" })).status));
      log.push({ phase: view.phase, play: directive.play, hold: directive.hold, data: directive.data, slice: res.status, frames: body?.plan.durationInFrames, files: files.length, fileStatuses: statuses });
      console.log(`${view.phase}: ${JSON.stringify(directive.play)} slice ${res.status}, ${files.length} files ${statuses.join(",")}`);
    }
    if (view.phase === "answer" && view.canAnswer && !answered) {
      answered = true;
      const probe = await api(`/api/lobbies/${lobbyId}/video/${"f".repeat(32)}`);
      log.push({ probeUnknownKey: probe.status });
      ws.send(JSON.stringify({ type: "action", lobbyId, action: { type: "answer", questionId: view.questionId, answers: { pick } } }));
      console.log(`answered ${pick}; unknown key → ${probe.status}`);
    }
    if (view.phase === "reveal" && view.video?.data) {
      log.push({ reveal: view.video.data });
      console.log(`reveal data: ${JSON.stringify(view.video.data.participants)}`);
      resolveDone();
    }
  });
});
await Promise.race([done, new Promise((r) => setTimeout(r, 10 * 60 * 1000))]);
writeFileSync(resolve(out, "player-b.json"), JSON.stringify(log, null, 2) + "\n");
ws.close();
