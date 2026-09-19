import { describe, expect, it } from "vitest";
import {
  FUNNEL_MODEL_KEYS,
  FUNNEL_MODELS,
  PIPELINE_NAME,
  SPECIALTY_KEYS,
} from "./templates";

// health-specialties-and-funnel-templates tasks.md 2.1 — the sixteen
// specialties, "other" last.
describe("SPECIALTY_KEYS", () => {
  it("offers exactly the sixteen specialties, with 'other' last", () => {
    expect([...SPECIALTY_KEYS]).toEqual([
      "social-worker",
      "biologist",
      "biomedical-scientist",
      "physical-education-professional",
      "nurse",
      "pharmacist",
      "physiotherapist",
      "speech-therapist",
      "physician",
      "veterinarian",
      "nutritionist",
      "dentist",
      "psychologist",
      "occupational-therapist",
      "aesthetics-cosmetology",
      "other",
    ]);
    expect(SPECIALTY_KEYS[SPECIALTY_KEYS.length - 1]).toBe("other");
  });
});

// tasks.md 2.2 — the four eight-stage funnel models.
describe("FUNNEL_MODELS", () => {
  it("offers exactly the four models", () => {
    expect([...FUNNEL_MODEL_KEYS]).toEqual([
      "model-1",
      "model-2",
      "model-3",
      "model-4",
    ]);
    expect(Object.keys(FUNNEL_MODELS)).toEqual([...FUNNEL_MODEL_KEYS]);
  });

  it("seeds every pipeline under the same fixed name", () => {
    expect(PIPELINE_NAME).toBe("Funil de vendas");
  });

  const expectedStageNames: Record<string, string[]> = {
    "model-1": [
      "Em contato",
      "Follow-up",
      "Avaliação agendada",
      "Avaliação realizada",
      "Orçamento apresentado",
      "Procedimento agendado",
      "Concluído",
      "Perdido",
    ],
    "model-2": [
      "Em contato",
      "Follow-up",
      "Consulta agendada",
      "Consulta realizada",
      "Tratamento indicado",
      "Retorno agendado",
      "Concluído",
      "Perdido",
    ],
    "model-3": [
      "Em contato",
      "Follow-up",
      "Avaliação agendada",
      "Avaliação realizada",
      "Proposta apresentada",
      "Procedimento agendado",
      "Concluído",
      "Perdido",
    ],
    "model-4": [
      "Em contato",
      "Follow-up",
      "Reunião agendada",
      "Reunião realizada",
      "Proposta enviada",
      "Negociação",
      "Fechado",
      "Perdido",
    ],
  };

  it.each(FUNNEL_MODEL_KEYS)("%s carries its exact stage sequence in order", (key) => {
    const stages = FUNNEL_MODELS[key];
    expect(stages.map((s) => s.name)).toEqual(expectedStageNames[key]);
  });

  it.each(FUNNEL_MODEL_KEYS)("%s starts with the system stage", (key) => {
    const stages = FUNNEL_MODELS[key];
    expect(stages[0]).toMatchObject({
      name: "Em contato",
      isSystem: true,
      position: 0,
    });
  });

  it.each(FUNNEL_MODEL_KEYS)("%s has no other system stage", (key) => {
    const stages = FUNNEL_MODELS[key];
    expect(stages.slice(1).every((s) => !s.isSystem)).toBe(true);
  });

  it.each(FUNNEL_MODEL_KEYS)("%s ends with 'Perdido'", (key) => {
    const stages = FUNNEL_MODELS[key];
    expect(stages[stages.length - 1].name).toBe("Perdido");
  });

  it.each(FUNNEL_MODEL_KEYS)("%s positions are contiguous from 0", (key) => {
    const stages = FUNNEL_MODELS[key];
    expect(stages.map((s) => s.position)).toEqual(stages.map((_, i) => i));
  });

  // tasks.md 2.3 — the palette grows to eight, one per stage.
  it.each(FUNNEL_MODEL_KEYS)("%s has a defined color for every stage", (key) => {
    const stages = FUNNEL_MODELS[key];
    expect(stages.every((s) => typeof s.color === "string" && s.color.length > 0)).toBe(
      true,
    );
  });
});
