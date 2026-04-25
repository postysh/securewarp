import "server-only";
import { supabase } from "./supabase";

/**
 * Server-side equivalent of src/lib/display.ts#userLabel — resolves an
 * actor user id to their displayName when set, falling back to the
 * provided email. Used in notification description templates so the
 * human-readable text baked into the row is prettier for users who've
 * set a display name. Notifications created before a user set their
 * name keep their baked email — acceptable staleness.
 */
export async function resolveActorLabel(
  actorUserId: string | null | undefined,
  fallbackEmail: string
): Promise<string> {
  if (!actorUserId) return fallbackEmail;
  const { data } = await supabase
    .from("users")
    .select("display_name")
    .eq("id", actorUserId)
    .single();
  const name = ((data as { display_name: string | null } | null)?.display_name ?? "").trim();
  return name || fallbackEmail;
}

export type NotificationType =
  | "file_shared"
  | "file_unshared"
  | "permission_changed"
  | "collaborator_joined"
  | "collaborator_left"
  | "workspace_transferred"
  | "changelog_published";

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  description: string;
  file_id: string | null;
  actor_user_id: string | null;
  actor_email?: string;
  actor_display_name?: string | null;
  read: boolean;
  created_at: string;
}

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  description: string;
  fileId?: string | null;
  actorUserId?: string | null;
}): Promise<void> {
  // Check user's notification preferences before creating
  const { data: user } = await supabase
    .from("users")
    .select("notification_prefs")
    .eq("id", params.userId)
    .single();
  const prefs = (user?.notification_prefs as Record<string, boolean>) ?? {};
  if (prefs[params.type] === false) return;

  const { error } = await supabase.from("notifications").insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    description: params.description,
    file_id: params.fileId ?? null,
    actor_user_id: params.actorUserId ?? null,
  });
  if (error) {
    console.error("Failed to create notification:", error.message);
  }
}

/**
 * Fan-out a "new changelog entry" notification to every active
 * (non-suspended) user — including the admin who published it
 * (they're a user too, and seeing the row is useful confirmation
 * that the publish landed). Honours
 * `notification_prefs.changelog_published === false` as opt-out
 * (matches the existing per-type-key convention in createNotification).
 *
 * Inserts run in batches of 1k rows so a large user base doesn't blow
 * past Supabase's payload limit. Errors are logged and swallowed —
 * a publish should not 500 because the broadcast hit a transient
 * insert error; the changelog page itself is the source of truth.
 */
export async function broadcastChangelogPublished(params: {
  title: string;
}): Promise<void> {
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, notification_prefs")
    .is("suspended_at", null);
  if (usersErr || !users) {
    console.error("changelog broadcast: load users failed", usersErr?.message);
    return;
  }

  const recipients = users.filter((u) => {
    const prefs = (u.notification_prefs as Record<string, boolean> | null) ?? {};
    return prefs.changelog_published !== false;
  });
  if (recipients.length === 0) return;

  const rows = recipients.map((u) => ({
    user_id: u.id,
    type: "changelog_published" as const,
    title: "What's new on SecureWarp",
    description: params.title,
    file_id: null,
    actor_user_id: null,
  }));

  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase.from("notifications").insert(slice);
    if (error) {
      console.error("changelog broadcast: insert batch failed", error.message);
    }
  }
}

export async function getNotifications(
  userId: string,
  limit = 20
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*, actor:users!notifications_actor_user_id_fkey(email, display_name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch notifications: ${error.message}`);
  return (data || []).map((row) => {
    const { actor, ...rest } = row as Record<string, unknown> & {
      actor: { email: string; display_name: string | null } | null;
    };
    return {
      ...rest,
      actor_email: actor?.email ?? undefined,
      actor_display_name: actor?.display_name ?? null,
    } as NotificationRow;
  });
}

export async function markNotificationRead(
  notificationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to mark read: ${error.message}`);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) throw new Error(`Failed to mark all read: ${error.message}`);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) return 0;
  return count ?? 0;
}
