import "server-only";
import { supabase } from "./db/supabase";
import { logError } from "./log";

/**
 * Canonical event types. Add new strings here as new surfaces are
 * instrumented. Keeping the list as a union so a typo in a call site
 * fails at compile time and the grep for "all logged events" is a
 * single file search.
 */
export type AuditEventType =
  | "auth.login.success"
  | "auth.login.fail"
  | "auth.2fa.fail"
  | "auth.register"
  | "auth.password_change"
  | "auth.recovery.verify.success"
  | "auth.recovery.verify.fail"
  | "auth.recovery.update"
  | "auth.delete_account"
  | "auth.revoke_all"
  | "auth.sessions.revoke"
  | "auth.sessions.revoke_others"
  | "files.share"
  | "files.unshare"
  | "files.leave"
  | "files.permission_change"
  | "files.delete"
  | "files.rename"
  | "files.move"
  | "files.restore"
  | "files.purge"
  | "files.rotate"
  | "files.version_restore"
  | "files.version_delete"
  | "files.version_create"
  | "link.create"
  | "link.revoke"
  | "link.access.anon"
  | "cleanup.run"
  | "workspace.invite"
  | "workspace.remove"
  | "workspace.role_change"
  | "workspace.leave"
  | "feedback.submitted"
  | "billing.override.dormant";

export interface AuditInput {
  event: AuditEventType;
  actorUserId?: string | null;
  targetUserId?: string | null;
  targetFileId?: string | null;
  targetLinkId?: string | null;
  sourceHint?: string | null;
  detail?: string | null;
}

/**
 * Append a row to the security_audit log. Fire-and-forget — the log is
 * defensive, not operational, so a failure to write it must never break
 * the primary request. Errors are routed through logError so they still
 * surface in structured logs.
 *
 * NOTE on runtime: on Cloudflare Workers, the handler's execution halts
 * the moment its Response is returned, which can kill detached promises
 * before they finish. For call sites where the write MUST land (cron
 * heartbeats the admin UI reads), use `auditEventAwait()` and await it
 * instead of this fire-and-forget helper.
 */
export function auditEvent(input: AuditInput): void {
  void supabase
    .from("security_audit")
    .insert({
      event_type: input.event,
      actor_user_id: input.actorUserId ?? null,
      target_user_id: input.targetUserId ?? null,
      target_file_id: input.targetFileId ?? null,
      target_link_id: input.targetLinkId ?? null,
      source_hint: input.sourceHint ?? null,
      detail: input.detail ?? null,
    })
    .then(({ error }) => {
      if (error) logError("audit.insert", { event: input.event, error: error.message });
    });
}

/**
 * Same as `auditEvent` but awaits the write. Use from endpoints where
 * the row's presence is load-bearing (e.g. cron heartbeats surfaced in
 * the admin health strip). Small added latency, but guaranteed durable
 * on Workers where detached promises get cut off.
 */
export async function auditEventAwait(input: AuditInput): Promise<void> {
  const { error } = await supabase.from("security_audit").insert({
    event_type: input.event,
    actor_user_id: input.actorUserId ?? null,
    target_user_id: input.targetUserId ?? null,
    target_file_id: input.targetFileId ?? null,
    target_link_id: input.targetLinkId ?? null,
    source_hint: input.sourceHint ?? null,
    detail: input.detail ?? null,
  });
  if (error) logError("audit.insert", { event: input.event, error: error.message });
}
