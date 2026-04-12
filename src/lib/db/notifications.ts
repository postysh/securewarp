import "server-only";
import { supabase } from "./supabase";

export type NotificationType =
  | "file_shared"
  | "file_unshared"
  | "permission_changed"
  | "collaborator_joined"
  | "collaborator_left";

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  description: string;
  file_id: string | null;
  actor_user_id: string | null;
  actor_email?: string;
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

export async function getNotifications(
  userId: string,
  limit = 20
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*, actor:users!notifications_actor_user_id_fkey(email)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch notifications: ${error.message}`);
  return (data || []).map((row) => {
    const { actor, ...rest } = row as Record<string, unknown> & {
      actor: { email: string } | null;
    };
    return {
      ...rest,
      actor_email: actor?.email ?? undefined,
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
