import "server-only";
import { supabase } from "./supabase";
import { normalizeEmail } from "@/lib/auth/email";
import { hashIp } from "./reports";

/**
 * Trust & safety automation. Everything admins need to respond to
 * reports without hopping between screens, plus the preservation-hold
 * plumbing that keeps IPs for a tiny set of flagged users while
 * leaving the 99% default of minimal retention intact.
 *
 * Zero-knowledge note: none of these functions touch file contents
 * or decrypt anything. They operate on metadata (owner ids,
 * timestamps, IP hashes, sharing graph) that the server already
 * holds. If a change here would require a plaintext signal, stop —
 * it's a product-level regression.
 */

// ─── Preservation hold + IP logging ─────────────────────────────────

/**
 * Flip preservation on for a user. Idempotent — subsequent calls
 * don't reset the timestamp. Once set, `logUserIp` starts recording
 * to `user_ip_log`. Clearing is admin-only (see
 * `clearPreservationHold`). The timestamp marks the start of
 * preservation so the forensic bundle can say "we have IPs from X
 * onward".
 */
export async function setPreservationHold(userId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ preservation_hold_at: new Date().toISOString() })
    .eq("id", userId)
    .is("preservation_hold_at", null);
  if (error) throw new Error(`setPreservationHold failed: ${error.message}`);
}

export async function clearPreservationHold(userId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ preservation_hold_at: null })
    .eq("id", userId);
  if (error) throw new Error(`clearPreservationHold failed: ${error.message}`);
}

/**
 * Log a hot-path event's IP if — and only if — the user is under
 * preservation. Cheap no-op for everyone else: a single SELECT by PK
 * that short-circuits before touching the log table. Fire-and-forget
 * friendly — callers typically `void logUserIp(...)` to avoid
 * blocking the request.
 *
 * `rawIp` accepts the raw inbound address (we hash here); pass null
 * to explicitly skip (e.g. internal cron paths).
 */
export async function logUserIp(
  userId: string,
  event: "login" | "upload" | "download" | "link-create" | "api",
  rawIp: string | null,
): Promise<void> {
  if (!rawIp) return;
  const { data } = await supabase
    .from("users")
    .select("preservation_hold_at")
    .eq("id", userId)
    .single();
  if (!data?.preservation_hold_at) return;
  const ip_hash = await hashIp(rawIp);
  await supabase.from("user_ip_log").insert({
    user_id: userId,
    event,
    ip_hash,
  });
}

/**
 * Extract the caller's IP from a request, matching what the abuse
 * report endpoint uses. Centralized here so every T&S call site
 * follows the same CF-first → Vercel → X-Forwarded-For order.
 */
export function extractRequestIp(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-vercel-forwarded-for") ??
    (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null)
  );
}

// ─── Evidence hold ──────────────────────────────────────────────────

/**
 * Freeze a file from deletion/purge/download pending T&S review.
 * Deliberately idempotent. Cleared only via `clearEvidenceHold`
 * which is admin-only.
 */
export async function setEvidenceHold(fileId: string): Promise<void> {
  const { error } = await supabase
    .from("files")
    .update({ evidence_hold_at: new Date().toISOString() })
    .eq("id", fileId)
    .is("evidence_hold_at", null);
  if (error) throw new Error(`setEvidenceHold failed: ${error.message}`);
}

export async function clearEvidenceHold(fileId: string): Promise<void> {
  const { error } = await supabase
    .from("files")
    .update({ evidence_hold_at: null })
    .eq("id", fileId);
  if (error) throw new Error(`clearEvidenceHold failed: ${error.message}`);
}

/**
 * Returns true if the file is currently held. Cheap single-row read
 * — callers in the hot delete/download path use this as a gate.
 */
export async function isFileOnHold(fileId: string): Promise<boolean> {
  const { data } = await supabase
    .from("files")
    .select("evidence_hold_at")
    .eq("id", fileId)
    .single();
  return !!data?.evidence_hold_at;
}

// ─── Banlist ────────────────────────────────────────────────────────

export type BanReason = "csam" | "abuse" | "fraud" | "manual";

export interface AddBanInput {
  email?: string | null;
  ipHash?: string | null;
  reason: BanReason;
  sourceReportId?: string | null;
  bannedByUserId: string;
  notes?: string | null;
}

/**
 * Add an entry to the banlist. Accepts either email (normalized
 * before insert), an IP hash, or both. At least one must be non-null
 * — the DB enforces this with a CHECK constraint. Duplicate bans
 * for the same email/ip pair are allowed; the ban check only needs
 * one matching row.
 */
export async function addBan(input: AddBanInput): Promise<{ id: string }> {
  const emailNormalized = input.email ? normalizeEmail(input.email) : null;
  if (!emailNormalized && !input.ipHash) {
    throw new Error("addBan requires email or ipHash");
  }
  const { data, error } = await supabase
    .from("banned_identifiers")
    .insert({
      email_normalized: emailNormalized,
      ip_hash: input.ipHash ?? null,
      reason: input.reason,
      source_report_id: input.sourceReportId ?? null,
      banned_by_user_id: input.bannedByUserId,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`addBan failed: ${error.message}`);
  return { id: data.id as string };
}

/**
 * Check an incoming signup against the banlist. Returns true on a
 * match for either normalized email or IP hash. The caller MUST
 * fail the signup with a generic error — never reveal that a ban
 * caused the failure, to avoid confirming bans to probers.
 */
export async function isBanned(
  email: string | null,
  rawIp: string | null,
): Promise<boolean> {
  if (!email && !rawIp) return false;
  if (email) {
    const emailNormalized = normalizeEmail(email);
    const { data } = await supabase
      .from("banned_identifiers")
      .select("id")
      .eq("email_normalized", emailNormalized)
      .limit(1);
    if (data && data.length > 0) return true;
  }
  if (rawIp) {
    const ipHash = await hashIp(rawIp);
    const { data } = await supabase
      .from("banned_identifiers")
      .select("id")
      .eq("ip_hash", ipHash)
      .limit(1);
    if (data && data.length > 0) return true;
  }
  return false;
}

// ─── Forensic bundle ────────────────────────────────────────────────

export interface ForensicBundle {
  generatedAt: string;
  generatedByUserId: string;
  subject: {
    userId: string;
    email: string;
    displayName: string | null;
    createdAt: string;
    suspendedAt: string | null;
    preservationHoldAt: string | null;
  };
  ipLog: {
    event: string;
    ipHash: string;
    occurredAt: string;
  }[];
  filesOwned: {
    id: string;
    sizeBytes: number;
    createdAt: string;
    uploadComplete: boolean;
    deletedAt: string | null;
    evidenceHoldAt: string | null;
    parentId: string | null;
  }[];
  linksCreated: {
    id: string;
    fileId: string;
    createdAt: string;
    revokedAt: string | null;
    expiresAt: string | null;
    hasPassword: boolean;
  }[];
  sharingGraph: {
    fileKeysGranted: {
      fileId: string;
      grantedToUserId: string;
      createdAt: string;
    }[];
    fileKeysReceived: {
      fileId: string;
      grantedByUserId: string | null;
      createdAt: string;
    }[];
  };
  reportsAgainst: {
    id: string;
    category: string;
    status: string;
    details: string;
    reporterEmail: string | null;
    reporterIpHash: string | null;
    fileId: string | null;
    linkId: string | null;
    createdAt: string;
    handledAt: string | null;
    handlerNotes: string | null;
  }[];
  reportsFiled: {
    id: string;
    category: string;
    status: string;
    fileOwnerId: string;
    fileId: string | null;
    linkId: string | null;
    createdAt: string;
  }[];
}

/**
 * Pull everything we can legally disclose about a user in response
 * to an LE request. Never reads encrypted content or decrypts
 * metadata. File names stay server-opaque.
 */
export async function getForensicBundle(
  userId: string,
  generatedByUserId: string,
): Promise<ForensicBundle | null> {
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, email, display_name, created_at, suspended_at, preservation_hold_at")
    .eq("id", userId)
    .single();
  if (userErr || !user) return null;

  const [
    ipLog,
    filesOwned,
    linksCreated,
    fileKeysGranted,
    fileKeysReceived,
    reportsAgainst,
    reportsFiled,
  ] = await Promise.all([
    supabase
      .from("user_ip_log")
      .select("event, ip_hash, occurred_at")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(5000),
    supabase
      .from("files")
      .select("id, size_bytes, created_at, upload_complete, deleted_at, evidence_hold_at, parent_id")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("file_links")
      .select("id, file_id, created_at, revoked_at, expires_at, password_salt, files!inner(owner_id)")
      .eq("files.owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("file_keys")
      .select("file_id, user_id, created_at")
      .eq("wrapped_by_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("file_keys")
      .select("file_id, wrapped_by_user_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("file_reports")
      .select(
        "id, category, status, details, reporter_email, reporter_ip_hash, file_id, link_id, created_at, handled_at, handler_notes",
      )
      .eq("file_owner_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("file_reports")
      .select("id, category, status, file_owner_id, file_id, link_id, created_at")
      .eq("reporter_user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    generatedByUserId,
    subject: {
      userId: user.id,
      email: user.email,
      displayName: user.display_name ?? null,
      createdAt: user.created_at,
      suspendedAt: user.suspended_at ?? null,
      preservationHoldAt: user.preservation_hold_at ?? null,
    },
    ipLog: (ipLog.data ?? []).map((r) => ({
      event: r.event,
      ipHash: r.ip_hash,
      occurredAt: r.occurred_at,
    })),
    filesOwned: (filesOwned.data ?? []).map((f) => ({
      id: f.id,
      sizeBytes: f.size_bytes,
      createdAt: f.created_at,
      uploadComplete: !!f.upload_complete,
      deletedAt: f.deleted_at ?? null,
      evidenceHoldAt: f.evidence_hold_at ?? null,
      parentId: f.parent_id ?? null,
    })),
    linksCreated: (linksCreated.data ?? []).map((l) => ({
      id: l.id as string,
      fileId: l.file_id as string,
      createdAt: l.created_at as string,
      revokedAt: (l.revoked_at as string | null) ?? null,
      expiresAt: (l.expires_at as string | null) ?? null,
      hasPassword: !!l.password_salt,
    })),
    sharingGraph: {
      fileKeysGranted: (fileKeysGranted.data ?? []).map((k) => ({
        fileId: k.file_id,
        grantedToUserId: k.user_id,
        createdAt: k.created_at,
      })),
      fileKeysReceived: (fileKeysReceived.data ?? []).map((k) => ({
        fileId: k.file_id,
        grantedByUserId: k.wrapped_by_user_id ?? null,
        createdAt: k.created_at,
      })),
    },
    reportsAgainst: (reportsAgainst.data ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      status: r.status,
      details: r.details,
      reporterEmail: r.reporter_email ?? null,
      reporterIpHash: r.reporter_ip_hash ?? null,
      fileId: r.file_id ?? null,
      linkId: r.link_id ?? null,
      createdAt: r.created_at,
      handledAt: r.handled_at ?? null,
      handlerNotes: r.handler_notes ?? null,
    })),
    reportsFiled: (reportsFiled.data ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      status: r.status,
      fileOwnerId: r.file_owner_id,
      fileId: r.file_id ?? null,
      linkId: r.link_id ?? null,
      createdAt: r.created_at,
    })),
  };
}

/**
 * Find a user by email for admin forensic lookups. Returns null if
 * no such user.
 */
export async function findUserByEmail(
  email: string,
): Promise<{ id: string; email: string } | null> {
  const normalized = normalizeEmail(email);
  const { data } = await supabase
    .from("users")
    .select("id, email")
    .eq("email", normalized)
    .single();
  return data ?? null;
}
