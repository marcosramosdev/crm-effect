/**
 * Format — single source of truth for the app's display locale.
 *
 * Every `toLocaleString()` / `toLocaleDateString()` call left without a
 * locale argument renders in the browser's locale, not the product's.
 * `APP_LOCALE` mirrors the resolution `src/i18n/request.ts` already does
 * for next-intl, so server code, client components and plain (non-React)
 * modules all agree on the same locale without threading `useLocale()`
 * through every call site.
 */
export const APP_LOCALE = process.env.NEXT_PUBLIC_APP_LOCALE || "pt-BR";

export function formatNumber(
  value: number,
  locale: string = APP_LOCALE,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDate(
  value: Date | string | number,
  locale: string = APP_LOCALE,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatTime(
  value: Date | string | number,
  locale: string = APP_LOCALE,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...options,
  }).format(date);
}

export function formatDateTime(
  value: Date | string | number,
  locale: string = APP_LOCALE,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    ...options,
  }).format(date);
}
