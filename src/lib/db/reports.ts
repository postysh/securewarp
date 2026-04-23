import "server-only";
import { supabase } from "./supabase";

export type ReportCategory =
  | "csam"
  | "harassment"
  | "malware"
  | "copyright"
  | "illegal"
  | "other";

export type ReportStatus = "pending" | "dismissed" | "actioned" | "escalated";

export interface CreateReportInput {
  fileId: string | null;
  linkId: string | null;
  fileOwnerId: string;
  fileWorkspaceId: string | null;
  reporterUserId: string | null;
  reporterEmail: string | null;
  reporterIpHash: string | null;
  category: ReportCategory;
  details: string;
}

export async function createReport(input: CreateReportInput): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("file_reports")
    .insert({
      file_id: input.fileId,
      link_id: input.linkId,
      file_owner_id: input.fileOwnerId,
      file_workspace_id: input.fileWorkspaceId,
      reporter_user_id: input.reporterUserId,
      reporter_email: input.reporterEmail,
      reporter_ip_hash: input.reporterIpHash,
      category: input.category,
      details: input.details,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Create report failed: ${error.message}`);
  return { id: data.id as string };
}

/**
 * Hash an IP address for the `reporter_ip_hash` column. We don't want
 * to store raw IPs long-term — just enough to detect dedup + abuse
 * patterns. SHA-256 is fine; if an attacker controls the DB and wants
 * to find an IP, they can, but that's outside our threat model.
 */
export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Returns recent reports from the same IP for the same file, so the
 * API can reject obvious duplicates without burning a rate-limit bucket.
 * Small time window: we tolerate honest retries but want to block
 * spam loops.
 */
export async function hasRecentDuplicate(
  ipHash: string,
  fileId: string | null,
  withinSeconds: number = 600,
): Promise<boolean> {
  if (!fileId) return false;
  const since = new Date(Date.now() - withinSeconds * 1000).toISOString();
  const { data } = await supabase
    .from("file_reports")
    .select("id")
    .eq("reporter_ip_hash", ipHash)
    .eq("file_id", fileId)
    .gte("created_at", since)
    .limit(1);
  return !!(data && data.length > 0);
}

export interface ReportRow {
  id: string;
  file_id: string | null;
  link_id: string | null;
  file_owner_id: string;
  file_workspace_id: string | null;
  reporter_user_id: string | null;
  reporter_email: string | null;
  reporter_ip_hash: string | null;
  category: ReportCategory;
  details: string;
  status: ReportStatus;
  handled_by_user_id: string | null;
  handled_at: string | null;
  handler_notes: string | null;
  created_at: string;
}

export async function listReports(opts: {
  status?: ReportStatus;
  limit?: number;
} = {}): Promise<ReportRow[]> {
  let q = supabase
    .from("file_reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ReportRow[];
}

export interface AdminReportView extends ReportRow {
  ownerEmail: string | null;
  ownerSuspendedAt: string | null;
  ownerPreservationHoldAt: string | null;
  reporterUserEmail: string | null;
  fileSizeBytes: number | null;
  fileCreatedAt: string | null;
  fileUploadComplete: boolean | null;
  fileDeletedAt: string | null;
  fileEvidenceHoldAt: string | null;
  linkRevokedAt: string | null;
  linkExpiresAt: string | null;
  linkCreatedAt: string | null;
}

/**
 * Admin-only. Joins user + file + link context onto each report so the
 * review UI can render everything in one pass without client-side
 * fan-out. Crypto invariant: NEVER reads encrypted metadata — filenames
 * and paths stay opaque to the server.
 */
export async function listReportsWithContext(opts: {
  status?: ReportStatus;
  limit?: number;
} = {}): Promise<AdminReportView[]> {
  const reports = await listReports(opts);
  if (reports.length === 0) return [];

  const ownerIds = Array.from(new Set(reports.map((r) => r.file_owner_id)));
  const reporterIds = Array.from(
    new Set(reports.map((r) => r.reporter_user_id).filter((x): x is string => !!x)),
  );
  const userIds = Array.from(new Set([...ownerIds, ...reporterIds]));
  const fileIds = Array.from(
    new Set(reports.map((r) => r.file_id).filter((x): x is string => !!x)),
  );
  const linkIds = Array.from(
    new Set(reports.map((r) => r.link_id).filter((x): x is string => !!x)),
  );

  const [usersRes, filesRes, linksRes] = await Promise.all([
    userIds.length
      ? supabase
          .from("users")
          .select("id, email, suspended_at, preservation_hold_at")
          .in("id", userIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            email: string;
            suspended_at: string | null;
            preservation_hold_at: string | null;
          }[],
          error: null,
        }),
    fileIds.length
      ? supabase
          .from("files")
          .select("id, size_bytes, created_at, upload_complete, deleted_at, evidence_hold_at")
          .in("id", fileIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            size_bytes: number;
            created_at: string;
            upload_complete: boolean;
            deleted_at: string | null;
            evidence_hold_at: string | null;
          }[],
          error: null,
        }),
    linkIds.length
      ? supabase
          .from("file_links")
          .select("id, revoked_at, expires_at, created_at")
          .in("id", linkIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            revoked_at: string | null;
            expires_at: string | null;
            created_at: string;
          }[],
          error: null,
        }),
  ]);

  const users = new Map(
    (usersRes.data ?? []).map((u) => [u.id, u]),
  );
  const files = new Map(
    (filesRes.data ?? []).map((f) => [f.id, f]),
  );
  const links = new Map(
    (linksRes.data ?? []).map((l) => [l.id, l]),
  );

  return reports.map((r) => {
    const owner = users.get(r.file_owner_id);
    const reporter = r.reporter_user_id ? users.get(r.reporter_user_id) : undefined;
    const file = r.file_id ? files.get(r.file_id) : undefined;
    const link = r.link_id ? links.get(r.link_id) : undefined;
    return {
      ...r,
      ownerEmail: owner?.email ?? null,
      ownerSuspendedAt: owner?.suspended_at ?? null,
      ownerPreservationHoldAt: owner?.preservation_hold_at ?? null,
      reporterUserEmail: reporter?.email ?? null,
      fileSizeBytes: file?.size_bytes ?? null,
      fileCreatedAt: file?.created_at ?? null,
      fileUploadComplete: file?.upload_complete ?? null,
      fileDeletedAt: file?.deleted_at ?? null,
      fileEvidenceHoldAt: file?.evidence_hold_at ?? null,
      linkRevokedAt: link?.revoked_at ?? null,
      linkExpiresAt: link?.expires_at ?? null,
      linkCreatedAt: link?.created_at ?? null,
    };
  });
}

export async function countReports(status: ReportStatus): Promise<number> {
  const { count, error } = await supabase
    .from("file_reports")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getReportById(id: string): Promise<ReportRow | null> {
  const { data, error } = await supabase
    .from("file_reports")
    .select("*")
    .eq("id", id)
    .single();
  if (error && error.code !== "PGRST116") throw new Error(error.message);
  return (data as unknown as ReportRow) ?? null;
}

export async function updateReportStatus(
  id: string,
  patch: {
    status: ReportStatus;
    handledByUserId: string;
    handlerNotes?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("file_reports")
    .update({
      status: patch.status,
      handled_by_user_id: patch.handledByUserId,
      handled_at: new Date().toISOString(),
      handler_notes: patch.handlerNotes ?? null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
