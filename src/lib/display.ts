import { initialsFromEmail, colorForEmail } from "@/lib/avatar";

/**
 * Client-side user display helpers. Source of truth for "what do we
 * show for this user in the UI" — display name when set, email
 * otherwise. Used for member lists, facepiles, and activity feeds so
 * the fallback rule lives in one place and can't drift.
 *
 * Admin surfaces deliberately keep raw email display — the admin's
 * job is identity management and they need the stable handle.
 *
 * Avatar color keeps hashing on `email` (via colorForEmail) so a user's
 * colour stays stable across display-name edits. Initials prefer the
 * display name so the avatar matches the label next to it.
 */

export interface UserLike {
  email?: string | null;
  displayName?: string | null;
}

export function userLabel(user: UserLike): string {
  const name = user.displayName?.trim();
  if (name) return name;
  return user.email?.trim() || "Unknown";
}

export function userInitials(user: UserLike): string {
  const name = user.displayName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (name.slice(0, 2) || "?").toUpperCase();
  }
  return initialsFromEmail(user.email || "");
}

export function userColor(user: UserLike): string {
  return colorForEmail(user.email || "");
}
