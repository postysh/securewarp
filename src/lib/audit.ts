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
  | "auth.register"
  | "auth.password_change"
  | "auth.recovery.verify.success"
  | "auth.recovery.verify.fail"
  | "auth.recovery.update"
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
  | "link.create"
  | "link.revoke"
  | "link.access.anon"
  | "cleanup.run";

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
