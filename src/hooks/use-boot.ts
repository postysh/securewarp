"use client";

import { createContext, useContext } from "react";

/**
 * Shell-bootstrap payload. Mirrors /api/boot response shape — fields
 * the app shell needs on cold start so we don't fan out 6+ fetches
 * on /drive mount. Individual endpoints stay around for refreshes
 * (pin/unpin, label add/delete, etc.).
 *
 * `null` during the initial fetch; consumers fall back to their own
 * loaders in that window so first paint doesn't block on one roundtrip.
 */
export interface BootProfile {
  displayName: string;
  notificationPrefs: Record<string, boolean>;
  onboarded: boolean;
  totpEnabled: boolean;
  srpSalt: string | null;
  argon2Salt: string | null;
}

export interface BootPin {
  file_id: string;
  sort_order: number;
  is_folder: boolean;
}

export interface BootLabel {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface BootWorkspace {
  id: string;
  name: string;
  rootFolderId: string;
  ownerId: string;
  color: string;
  description: string;
  defaultRole: string;
  role: string;
  require2fa: boolean;
  linksDisabled: boolean;
  linksRequirePassword: boolean;
  linksMaxExpiryDays: number | null;
  lockedByTwoFactor: boolean;
}

export interface BootUsage {
  filesBytes: number;
  filesCount: number;
  trashBytes: number;
  trashCount: number;
  usedBytes: number;
}

export interface BootEntitlements {
  tier: string;
  tierLabel: string;
  isCustom?: boolean;
  storageGB: number;
  seats: number;
  workspaces: number;
  maxFileSizeBytes: number;
  versionCount: number;
  versionTtlDays: number;
  priceCents?: number;
}

export interface BootRealtime {
  userChannel: string;
  workspaceChannels: { workspaceId: string; channel: string }[];
}

export interface BootPayload {
  profile: BootProfile | null;
  entitlements: BootEntitlements | null;
  // `null` when the loader failed/timed out (distinct from `[]` =
  // user genuinely has none). Consumers MUST fall back to the
  // dedicated endpoint on null — overwriting local state with a
  // failed loader's "empty" value caused the sidebar's PINNED +
  // LABELS sections to flicker and disappear in production.
  pins: BootPin[] | null;
  labels: BootLabel[] | null;
  usage: BootUsage | null;
  workspaces: BootWorkspace[];
  realtime: BootRealtime;
}

export const BootContext = createContext<BootPayload | null>(null);

/**
 * Returns the shell-bootstrap payload or null while the fetch is in
 * flight. Consumers should handle the null case by falling back to
 * their own individual endpoint (keeps components independently
 * renderable during dev / pre-boot).
 */
export function useBoot(): BootPayload | null {
  return useContext(BootContext);
}
