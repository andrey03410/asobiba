import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestApp, resetDb, signUp, type TestApp } from "../test/helpers";

let t: TestApp;
beforeEach(async () => { t = await createTestApp(); await resetDb(t.db); });
afterEach(async () => { await t?.close(); });

it("returns one safe summary through validation and the lobby, keeping the author out of invitations", async () => {
  const host = await signUp(t, "host");
  const config = { sdk: 1, game: "quizor", gameVersion: 1, info: { title: "Для друзей", text: "АВТОРСКОЕВСТУПЛЕНИЕ" }, rules: { rounds: [{ id: "r", questions: [{ id: "q", prompt: "БУДУЩИЙВОПРОС", fields: [{ id: "a", type: "text", answers: [{ text: "ЭТАЛОНСЕКРЕТ" }] }] }] }] } };
  const checked = await t.app.inject({ method: "POST", url: "/api/configs/validate", headers: { cookie: host.cookie }, payload: { config } });
  expect(checked.json().ok).toBe(true);
  expect(checked.json().summary).toMatchObject({ players: { min: 1, max: 16 } });
  const lobby = await t.services.lobbies.create(host.user, { name: "Информация", config });
  expect(lobby.information.summary).toEqual(checked.json().summary);
  expect(lobby.information.author).toEqual(config.info);
  const text = JSON.stringify(lobby.information);
  expect(text).not.toContain("БУДУЩИЙВОПРОС");
  expect(text).not.toContain("ЭТАЛОНСЕКРЕТ");
  const invitation = await t.services.lobbies.invitation(lobby.id);
  expect(invitation.description.length).toBeGreaterThan(0);
  expect(JSON.stringify(invitation)).not.toContain("АВТОРСКОЕВСТУПЛЕНИЕ");
  expect(JSON.stringify(invitation)).not.toContain("БУДУЩИЙВОПРОС");
});
