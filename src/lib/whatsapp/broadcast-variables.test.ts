import { describe, expect, it } from "vitest";
import {
  extractVariableNames,
  resolveVariableValues,
  substituteVariables,
} from "./broadcast-variables";

describe("extractVariableNames", () => {
  it("finds every unique placeholder, trimmed", () => {
    const names = extractVariableNames(
      "Hi {{ name }}, your order for {{company}} is ready. Thanks {{name}}!",
    );
    expect(names).toEqual(["name", "company"]);
  });

  it("returns an empty array when the body has no placeholders", () => {
    expect(extractVariableNames("Hello there")).toEqual([]);
  });
});

describe("resolveVariableValues", () => {
  it("resolves a built-in contact field", () => {
    const { values, unresolvedVariable } = resolveVariableValues(["name"], {
      name: "Jane Doe",
    });
    expect(values).toEqual({ name: "Jane Doe" });
    expect(unresolvedVariable).toBeUndefined();
  });

  it("resolves a custom field by name, case-insensitively", () => {
    const customValues = new Map([["deal size", "$500"]]);
    const { values } = resolveVariableValues(["Deal Size"], {
      customValues,
    });
    expect(values).toEqual({ "Deal Size": "$500" });
  });

  it("falls back to the user-supplied default when the recipient has no value", () => {
    const { values, unresolvedVariable } = resolveVariableValues(
      ["company"],
      { company: null },
      { company: "our valued customer" },
    );
    expect(values).toEqual({ company: "our valued customer" });
    expect(unresolvedVariable).toBeUndefined();
  });

  it("treats an empty-string value as missing, not resolved", () => {
    const { values } = resolveVariableValues(
      ["company"],
      { company: "   " },
      { company: "fallback" },
    );
    expect(values).toEqual({ company: "fallback" });
  });

  it("reports the first unresolved variable when there is no fallback", () => {
    const { unresolvedVariable } = resolveVariableValues(
      ["name", "company"],
      { name: "Jane", company: null },
      null,
    );
    expect(unresolvedVariable).toBe("company");
  });

  it("stops at the first unresolved variable without resolving later ones", () => {
    const { values, unresolvedVariable } = resolveVariableValues(
      ["company", "name"],
      { name: "Jane", company: null },
    );
    expect(unresolvedVariable).toBe("company");
    expect(values).toEqual({});
  });
});

describe("substituteVariables", () => {
  it("replaces every occurrence of a resolved placeholder", () => {
    const text = substituteVariables("Hi {{name}}, hi again {{name}}!", {
      name: "Jane",
    });
    expect(text).toBe("Hi Jane, hi again Jane!");
  });

  it("leaves a placeholder untouched when it has no resolved value", () => {
    const text = substituteVariables("Hi {{name}}", {});
    expect(text).toBe("Hi {{name}}");
  });
});
