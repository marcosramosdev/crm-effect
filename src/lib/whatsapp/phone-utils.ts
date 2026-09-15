/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1);
  const n2 = normalizePhone(phone2);
  if (n1 === n2) return true;
  if (n1.length >= 8 && n2.length >= 8) {
    return n1.slice(-8) === n2.slice(-8);
  }
  return false;
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone);
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return [];
  const seen = new Set<string>();
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v);
  };

  // 1. Original
  push(sanitized);

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue;
    const cc = sanitized.slice(0, ccLen);
    const rest = sanitized.slice(ccLen);
    if (!rest.startsWith("0")) {
      push(cc + "0" + rest);
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue;
    const cc = sanitized.slice(0, ccLen);
    const rest = sanitized.slice(ccLen);
    if (rest.startsWith("0")) {
      push(cc + rest.slice(1));
    }
  }

  return [...seen];
}

/**
 * Returns true when a WhatsApp send error indicates the recipient
 * number itself is the problem — not registered on WhatsApp, or
 * otherwise an invalid/unreachable recipient — as opposed to an auth,
 * rate-limit, or gateway fault. Used to (a) drive the phone-variant
 * retry above (try the next numbering variant before giving up) and
 * (b) classify the final failure for the caller (whatsapp-messaging
 * spec, "Recipient not on WhatsApp").
 *
 * Retargeted from Meta's numbered sandbox error (#131030, "not in
 * allowed list") to UAZAPI's gateway. UAZAPI's OpenAPI spec
 * (uazapi-openapi-spec.yaml) does not document a fixed error string for
 * this case on `/send/text` or `/send/media` — unlike Meta there is no
 * single canonical phrase to match, so this pattern covers the
 * phrasings used on adjacent UAZAPI surfaces (`/call/*`'s "invalid
 * number [JID]") plus common gateway wording for an unregistered
 * recipient. Confirm against a live send in task 10.5 and tighten if
 * the real text differs.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /not (?:on|registered on|found on) whatsapp|invalid number|number[^.]*(?:invalid|not (?:found|registered))|recipient[^.]*not (?:found|reachable|valid)/i.test(
    message,
  );
}
