/**
 * Specialty pipeline templates (client-provisioning design.md D8).
 *
 * Two of them, the dentist and the physician, because those are the two
 * funnels the agency implements (admin-client-lifecycle design.md D7).
 * A template is read once, at creation, so changing the set never
 * touches an account that already exists.
 * Defined in code, not data — the set only changes on a deploy, and
 * a templates table would need CRUD, RLS, and an editor for three
 * rows nobody outside the repository edits.
 *
 * Every template's first stage is the system stage "Em contato".
 * Colours reuse the STAGE_COLORS palette from pipeline-settings.tsx.
 */

export type SpecialtyKey = "dentist" | "physician";

export const SPECIALTY_KEYS: readonly SpecialtyKey[] = [
  "dentist",
  "physician",
] as const;

export interface TemplateStage {
  name: string;
  isSystem: boolean;
  position: number;
  color: string;
}

const STAGE_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
];

function template(names: string[]): TemplateStage[] {
  return names.map((name, position) => ({
    name,
    isSystem: position === 0,
    position,
    color: STAGE_COLORS[position],
  }));
}

export const SPECIALTY_TEMPLATES: Record<SpecialtyKey, TemplateStage[]> = {
  dentist: template([
    "Em contato",
    "Avaliação agendada",
    "Avaliação realizada",
    "Orçamento enviado",
    "Tratamento aceito",
    "Perdido",
  ]),
  physician: template([
    "Em contato",
    "Consulta agendada",
    "Consulta realizada",
    "Retorno / exames",
    "Em acompanhamento",
    "Perdido",
  ]),
};
