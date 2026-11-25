import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BotLabel, BotReservation } from "./BotSeats";

describe("AI player seats", () => {
  it("describes a reserved place and its difficulty to a reader", () => {
    const html = renderToStaticMarkup(<BotLabel bot={{ number: 2, difficulty: "maximum", status: "reserved" }} />);
    expect(html).toContain("Максимальный");
    expect(html).toContain("Ждёт подключения");
  });

  it("explains which invitation a host can give an independent agent", () => {
    const html = renderToStaticMarkup(<BotReservation lobbyId="lob_test" available />);
    expect(html).toContain("Зарезервировать место");
    expect(html).toContain("обычную ссылку");
    expect(html).toContain("Средний");
  });
});
