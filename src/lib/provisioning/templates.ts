/**
 * Specialty vocabulary and funnel pipeline templates
 * (health-specialties-and-funnel-templates design.md D1).
 *
 * Two independent exports, deliberately not indexed into each other:
 *
 * - SPECIALTY_KEYS / SpecialtyKey: what health niche the clinic is in.
 *   Stored on the account (provisioning.ts), read back by an operator
 *   (admin-console). Decides nothing else — see the provisioning spec,
 *   "The clinic specialty describes the clinic and decides nothing".
 * - FUNNEL_MODEL_KEYS / FUNNEL_MODELS: the four pipeline shapes an
 *   account can be seeded with. Defined in code, not data — the set
 *   only changes on a deploy, and a templates table would need CRUD,
 *   RLS, and an editor for four rows nobody outside the repository
 *   edits. A model is read once, at creation, so changing the set
 *   never touches an account that already exists.
 *
 * Every model's first stage is the system stage "Em contato" and its
 * last stage is "Perdido" (an ordinary stage — see the deals spec,
 * "A 'Perdido' stage organises the board and does not carry the
 * status"). Every seeded pipeline is named PIPELINE_NAME, whatever
 * model was chosen.
 */

/** The sixteen specialties (design.md D2). Labelled in messages/*.json
 *  under admin.specialties.<key>. "other" always stores its niche in
 *  the account's specialty_other column, never in this list. */
export type SpecialtyKey =
  | "social-worker"
  | "biologist"
  | "biomedical-scientist"
  | "physical-education-professional"
  | "nurse"
  | "pharmacist"
  | "physiotherapist"
  | "speech-therapist"
  | "physician"
  | "veterinarian"
  | "nutritionist"
  | "dentist"
  | "psychologist"
  | "occupational-therapist"
  | "aesthetics-cosmetology"
  | "other";

export const SPECIALTY_KEYS: readonly SpecialtyKey[] = [
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
] as const;

export interface TemplateStage {
  name: string;
  isSystem: boolean;
  position: number;
  color: string;
}

// Blue-to-rose ramp, extended from six to eight entries for the eight-
// stage funnel models (design.md D7). template() indexes this directly
// rather than wrapping modulo, so a model growing past eight stages
// fails loudly (undefined color) instead of silently repeating one.
const STAGE_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
  "#fb7185",
  "#f97316",
];

function template(names: string[]): TemplateStage[] {
  return names.map((name, position) => ({
    name,
    isSystem: position === 0,
    position,
    color: STAGE_COLORS[position],
  }));
}

/** The four funnel models (design.md D3). Labelled "Modelo 1" … "Modelo
 *  4" in messages/*.json under admin.funnelModels.<key> — the operator
 *  picks by the stage sequence shown under the label, not the number. */
export type FunnelModelKey = "model-1" | "model-2" | "model-3" | "model-4";

export const FUNNEL_MODEL_KEYS: readonly FunnelModelKey[] = [
  "model-1",
  "model-2",
  "model-3",
  "model-4",
] as const;

/** Every seeded pipeline's name, whatever model was chosen
 *  (design.md D4). */
export const PIPELINE_NAME = "Funil de vendas";

export const FUNNEL_MODELS: Record<FunnelModelKey, TemplateStage[]> = {
  "model-1": template([
    "Em contato",
    "Follow-up",
    "Avaliação agendada",
    "Avaliação realizada",
    "Orçamento apresentado",
    "Procedimento agendado",
    "Concluído",
    "Perdido",
  ]),
  "model-2": template([
    "Em contato",
    "Follow-up",
    "Consulta agendada",
    "Consulta realizada",
    "Tratamento indicado",
    "Retorno agendado",
    "Concluído",
    "Perdido",
  ]),
  "model-3": template([
    "Em contato",
    "Follow-up",
    "Avaliação agendada",
    "Avaliação realizada",
    "Proposta apresentada",
    "Procedimento agendado",
    "Concluído",
    "Perdido",
  ]),
  "model-4": template([
    "Em contato",
    "Follow-up",
    "Reunião agendada",
    "Reunião realizada",
    "Proposta enviada",
    "Negociação",
    "Fechado",
    "Perdido",
  ]),
};
