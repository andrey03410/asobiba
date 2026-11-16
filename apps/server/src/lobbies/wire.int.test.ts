import { afterEach, beforeEach, expect, it } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@asobiba/api";
import { createJinchiDecoder } from "@asobiba/game-jinchi/wire";
import { createTestApp, resetDb, signUp, type TestApp } from "../test/helpers";

let t: TestApp;
beforeEach(async () => { t = await createTestApp(); await resetDb(t.db); });
afterEach(async () => { await t.close(); });

it.each([200, 201])("packs large Jinchi WS snapshots while keeping the 200×200 protocol unchanged: %i", async (side) => {
  const host = await signUp(t, "host"), player = await signUp(t, "player");
  const rows = Array.from({ length: side }, (_, y) => y < 2 ? "11" + ".".repeat(side - 2) : y >= side - 2 ? ".".repeat(side - 2) + "22" : ".".repeat(side));
  const lobby = await t.services.lobbies.create(host.user, { name: "Packed", config: { sdk: 1, game: "jinchi", gameVersion: 1, rules: { map: { width: side, height: side, rows }, dice: { sides: 2 }, starts: { assignment: "ordered" } } } });
  await t.services.lobbies.join(player.user, lobby.id, "player");
  await t.services.lobbies.start(host.user, lobby.id);
  const base = await t.listen();
  const socket = new WebSocket(base.replace("http", "ws") + "/ws", { headers: { cookie: host.cookie } });
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  try {
    const received = new Promise<Extract<ServerMessage, { type: "match" }>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Missing match snapshot")), 5000);
      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as ServerMessage;
        if (message.type === "match") { clearTimeout(timeout); resolve(message); }
      });
    });
    socket.send(JSON.stringify({ type: "subscribe", lobbyId: lobby.id }));
    const message = await received;
    expect(message.seat).toBe(0);
    expect(message.match).not.toBeNull();
    const encodedGame = message.match!.game as { cells: unknown };
    expect(Array.isArray(encodedGame.cells)).toBe(side === 200);
    const restored = createJinchiDecoder()(message.match!);
    expect(restored.game).toMatchObject({ width: side, height: side, canAct: true });
    expect((restored.game as { cells: number[] }).cells).toHaveLength(side * side);
    if (side === 201) expect(JSON.stringify(message).length).toBeLessThan(20_000);
  } finally { socket.close(); }
});
