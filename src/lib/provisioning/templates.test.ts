import { describe, expect, it } from "vitest";
import { SPECIALTY_KEYS, SPECIALTY_TEMPLATES } from "./templates";

describe("SPECIALTY_TEMPLATES", () => {
  it.each(SPECIALTY_KEYS)("%s starts with the system stage", (key) => {
    const stages = SPECIALTY_TEMPLATES[key];
    expect(stages[0]).toMatchObject({
      name: "Em contato",
      isSystem: true,
      position: 0,
    });
  });

  it.each(SPECIALTY_KEYS)("%s has no other system stage", (key) => {
    const stages = SPECIALTY_TEMPLATES[key];
    expect(stages.slice(1).every((s) => !s.isSystem)).toBe(true);
  });

  it.each(SPECIALTY_KEYS)("%s positions are contiguous from 0", (key) => {
    const stages = SPECIALTY_TEMPLATES[key];
    expect(stages.map((s) => s.position)).toEqual(
      stages.map((_, i) => i),
    );
  });
});
