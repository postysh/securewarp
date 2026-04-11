/**
 * Deterministic avatar helpers — no PII beyond what the client already has.
 * Initials come from the email local-part; color is hashed to a fixed palette
 * so a user appears with the same colour everywhere in the UI.
 */

const PALETTE = [
  "var(--accent-blue-primary)",
  "var(--accent-green-primary)",
  "var(--accent-orange-primary)",
  "var(--accent-pink-primary)",
  "var(--accent-yellow-primary)",
  "var(--accent-dark-blue-primary)",
];

export function initialsFromEmail(email: string): string {
  if (!email) return "?";
  const local = email.split("@")[0] || "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (local.slice(0, 2) || email.slice(0, 2) || "?").toUpperCase();
}

export function colorForEmail(email: string): string {
  if (!email) return "var(--icon-tertiary)";
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
