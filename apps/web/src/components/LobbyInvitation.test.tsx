import type { LobbyInvitationDto } from "@asobiba/api";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { LobbyInvitation } from "./LobbyInvitation";

const invitation: LobbyInvitationDto = { id: "lob_friend", name: "Вечер друзей", gameTitle: "Крестики-нолики", host: "ann", status: "waiting", players: 1, seats: 2 };
const render = (patch: Partial<LobbyInvitationDto> = {}) => renderToStaticMarkup(
  <MemoryRouter><LobbyInvitation invitation={{ ...invitation, ...patch }} name="Саша" error={null} busy={false} onName={() => {}} onJoin={() => {}} /></MemoryRouter>,
);

describe("LobbyInvitation", () => {
  it("offers a named, single-step player join and preserves the login destination", () => {
    const html = render();
    expect(html).toContain("Вечер друзей");
    expect(html).toContain("Как вас зовут?");
    expect(html).toContain('value="Саша"');
    expect(html).toContain("Присоединиться");
    expect(html).toContain("Смотреть");
    expect(html).toContain("/login?next=%2Flobby%2Flob_friend");
    expect(html).not.toContain('type="password"');
  });

  it.each([{ players: 2 }, { status: "playing" as const }])("offers observation when a player cannot join: %j", (patch) => {
    const html = render(patch);
    expect(html).toContain("Смотреть");
    expect(html).not.toContain("Присоединиться");
    expect(html).toContain("Как вас зовут?");
  });

  it("does not ask for a name for a closed lobby", () => {
    const html = render({ status: "closed" });
    expect(html).toContain("Лобби закрыто");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Как вас зовут?");
  });
});
