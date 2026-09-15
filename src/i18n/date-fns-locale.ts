import { ptBR } from "date-fns/locale";
import type { Locale } from "date-fns";

/**
 * Maps the app locale to a date-fns Locale for relative/absolute date
 * formatting. Returns undefined for locales date-fns should format with
 * its English default (also `ko`, which has no date-fns wiring in scope).
 */
export function dateFnsLocale(locale: string): Locale | undefined {
  return locale === "pt-BR" ? ptBR : undefined;
}
