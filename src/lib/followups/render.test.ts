import { describe, expect, it } from "vitest";
import { renderFollowupBody } from "./render";

describe("renderFollowupBody", () => {
  it("renders {data} and {hora} in the account timezone (America/Sao_Paulo)", () => {
    // 2026-03-10T14:30:00Z -> 11:30 in São Paulo (UTC-3, no DST since 2019).
    const body = renderFollowupBody(
      "{data} {hora}",
      { contactName: "Ana", scheduledAt: "2026-03-10T14:30:00.000Z" },
      "America/Sao_Paulo",
    );
    expect(body).toBe("10/03/2026 11:30");
  });

  it("substitutes {nome}", () => {
    const body = renderFollowupBody(
      "Olá {nome}!",
      { contactName: "Maria", scheduledAt: "2026-01-01T12:00:00.000Z" },
      "America/Sao_Paulo",
    );
    expect(body).toBe("Olá Maria!");
  });

  it("renders {medico} empty with no literal token when the deal has none", () => {
    const body = renderFollowupBody(
      "Com {medico}.",
      { contactName: "Ana", scheduledAt: "2026-01-01T12:00:00.000Z" },
      "America/Sao_Paulo",
    );
    expect(body).toBe("Com .");
    expect(body).not.toContain("{medico}");
  });

  it("substitutes {medico} from the deal's custom field", () => {
    const body = renderFollowupBody(
      "Com {medico}.",
      {
        contactName: "Ana",
        scheduledAt: "2026-01-01T12:00:00.000Z",
        customFieldsByName: { medico: "Dr. Souza" },
      },
      "America/Sao_Paulo",
    );
    expect(body).toBe("Com Dr. Souza.");
  });

  it("renders {nome} empty (not the literal token) when the contact has no name", () => {
    const body = renderFollowupBody(
      "Olá {nome}!",
      { contactName: null, scheduledAt: "2026-01-01T12:00:00.000Z" },
      "America/Sao_Paulo",
    );
    expect(body).toBe("Olá !");
  });
});
