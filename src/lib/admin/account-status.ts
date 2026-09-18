// ============================================================
// What the operator console can work out for itself about one
// account: whether it is configured to report, whether it is stuck in
// test mode, what its conversions add up to, and which setup
// conditions are already satisfied.
//
// Pure, so it has a runnable check without standing up a
// component-rendering test harness this repository does not otherwise
// have (design.md D9/D11).
// ============================================================

/** `whatsapp_config.connection_state` (migration 040). */
export type ConnectionState = "disconnected" | "connecting" | "connected" | "hibernated";

/** `meta_capi_events.status` (migrations 048 and 049). */
export const CONVERSION_STATUSES = [
  "pending",
  "unconfigured",
  "sending",
  "sent",
  "failed",
  "expired",
  "canceled",
] as const;

export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

export type ConversionCounts = Partial<Record<ConversionStatus, number>>;

export interface AccountMetaRow {
  id: string;
  name: string;
  metaDatasetId: string | null;
  /** Never the ciphertext — only whether one is stored (provisioning spec.md). */
  hasAccessToken: boolean;
  metaPageId: string | null;
  metaEventName: string;
  metaTestEventCode: string | null;
  metaSendPh: boolean;
  /** `null` when the account has no `whatsapp_config` row at all (a provision that failed midway). */
  connectionState: ConnectionState | null;
  pairedPhone: string | null;
  pairedAt: string | null;
  counts: ConversionCounts;
}

export function classifyAccountMetaStatus(account: AccountMetaRow) {
  const isConfigured = Boolean(account.metaDatasetId) && account.hasAccessToken;
  const isPartial = Boolean(account.metaDatasetId) !== account.hasAccessToken;
  const isTestMode = Boolean(account.metaTestEventCode);
  const isConnected = account.connectionState === "connected";
  const hasNoConversions = totalConversions(account.counts) === 0;
  return { isConfigured, isPartial, isTestMode, isConnected, hasNoConversions };
}

export function totalConversions(counts: ConversionCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
}

/**
 * Which counts the console shows.
 *
 * Waiting (`pending`) and unreportable (`unconfigured`) are always
 * shown, including at zero — they are the two an operator reads to know
 * the account is alive. Every other state appears only once it holds
 * something, which is what makes the conversion sender's first delivery
 * failure surface here with no further change to this code
 * (design.md D3).
 */
export function visibleConversionCounts(
  counts: ConversionCounts,
): { status: ConversionStatus; count: number }[] {
  return CONVERSION_STATUSES.filter(
    (status) =>
      status === "pending" || status === "unconfigured" || (counts[status] ?? 0) > 0,
  ).map((status) => ({ status, count: counts[status] ?? 0 }));
}

export interface AccountSetupFacts {
  account: AccountMetaRow;
  /** Any contact of this account carrying a `ctwa_clid`. */
  hasAdOriginatedContact: boolean;
}

/**
 * The five setup conditions the system can determine for itself.
 *
 * Everything the system CANNOT determine — the dataset being shared
 * with the client's ad account, the campaign being live with a matching
 * performance goal, the credentials having been delivered — is stated
 * as a reminder in the console instead, never as state (design.md D11).
 */
export function deriveAccountSetup({ account, hasAdOriginatedContact }: AccountSetupFacts) {
  const { isConfigured, isTestMode, isConnected, hasNoConversions } =
    classifyAccountMetaStatus(account);
  return {
    whatsappConnected: isConnected,
    credentialsPresent: isConfigured,
    /** Satisfied means NO test code: an account left in test mode reports nothing. */
    testModeCleared: !isTestMode,
    adContactArrived: hasAdOriginatedContact,
    conversionRecorded: !hasNoConversions,
  };
}
