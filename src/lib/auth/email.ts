import "server-only";

/**
 * Canonical email form used for storage, lookups, and rate-limit keys.
 * We lowercase the entire address and strip leading/trailing whitespace.
 *
 * Why: without this, `a@example.com` and `A@example.com` register as two
 * distinct accounts (the DB unique constraint is case-sensitive), and a
 * rate-limit bucket keyed on the raw email can be trivially bypassed by
 * varying letter case. Normalizing at every boundary collapses both
 * issues into a single path.
 *
 * Technical note: RFC 5321 says the local-part CAN be case-sensitive in
 * principle, but in practice every major provider treats it as
 * case-insensitive, and treating it that way is consistent with what
 * users expect. Domain-part is always case-insensitive per RFC.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
