import { describe, expect, it } from "vitest";
import { unknownPlaceholders, validateTemplatePlaceholders } from "./template";

describe("validateTemplatePlaceholders", () => {
  it("accepts every legal placeholder", () => {
    expect(
      validateTemplatePlaceholders("Olá {nome}, {data} às {hora} com {medico}"),
    ).toEqual({ ok: true });
  });

  it("accepts a template with no placeholders", () => {
    expect(validateTemplatePlaceholders("Lembrete fixo")).toEqual({ ok: true });
  });

  it("names the unknown placeholder in the rejection", () => {
    const result = validateTemplatePlaceholders("Plano: {convenio}");
    expect(result).toEqual({ ok: false, unknown: ["convenio"] });
  });

  it("names every distinct unknown placeholder, once each", () => {
    const result = validateTemplatePlaceholders("{convenio} e {convenio} e {plano}");
    expect(result.ok).toBe(false);
    expect((result as { unknown: string[] }).unknown.sort()).toEqual([
      "convenio",
      "plano",
    ]);
  });
});

describe("unknownPlaceholders", () => {
  it("returns [] when every token is legal", () => {
    expect(unknownPlaceholders("{nome} {data}")).toEqual([]);
  });
});
