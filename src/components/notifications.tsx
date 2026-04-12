"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import FolderShared01Icon from "@hugeicons/core-free-icons/FolderShared01Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import CheckmarkCircle01Icon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { supabaseClient } from "@/lib/db/supabase-client";
import { useUserKeys } from "@/hooks/use-user-keys";

interface Notification {
  id: string;
  type: string;
  title: string;
  description: string;
  actor_email?: string;
  read: boolean;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function typeIcon(type: string) {
  switch (type) {
    case "file_shared":
    case "collaborator_joined":
      return FolderShared01Icon;
    case "file_unshared":
    case "collaborator_left":
      return Cancel01Icon;
    case "permission_changed":
      return UserGroupIcon;
    default:
      return CheckmarkCircle01Icon;
  }
}

function typeColor(type: string): string {
  switch (type) {
    case "file_shared":
    case "collaborator_joined":
      return "var(--accent-blue-primary)";
    case "file_unshared":
    case "collaborator_left":
      return "var(--accent-red-primary)";
    case "permission_changed":
      return "var(--accent-yellow-primary)";
    default:
      return "var(--accent-green-primary)";
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const userKeys = useUserKeys();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling + optional Supabase Realtime
  useEffect(() => {
    fetchNotifications();

    // Poll every 10 seconds as the reliable baseline. Realtime
    // (below) delivers sub-second updates when connected, but
    // polling covers env-var-missing, connection failures, and
    // Vercel cold starts where the websocket hasn't connected yet.
    const interval = setInterval(fetchNotifications, 10_000);

    // Realtime layer — additive, not a replacement
    let channel: ReturnType<NonNullable<typeof supabaseClient>["channel"]> | null = null;

    if (supabaseClient) {
      (async () => {
        try {
          const sessionRes = await fetch("/api/auth/session");
          if (!sessionRes.ok) return;
          const session = await sessionRes.json();
          if (!session.userId) return;

          channel = supabaseClient
            .channel(`notifications-${session.userId}`)
            .on(
              "postgres_changes",
              {
                event: "INSERT",
                schema: "public",
                table: "notifications",
                filter: `user_id=eq.${session.userId}`,
              },
              (payload) => {
                const row = payload.new as Notification;
                setNotifications((prev) => {
                  if (prev.some((n) => n.id === row.id)) return prev;
                  return [row, ...prev];
                });
              }
            )
            .subscribe();

          // Safari throws SecurityError when WebSocket reconnects on
          // visibilitychange. Suppress it globally so it doesn't flood
          // Sentry — polling handles the reconnect gap anyway.
          window.addEventListener("error", (e) => {
            if (e.message?.includes("The operation is insecure")) {
              e.preventDefault();
            }
          });
        } catch {
          // Realtime failed — polling covers it
        }
      })();
    }

    return () => {
      clearInterval(interval);
      if (channel && supabaseClient) supabaseClient.removeChannel(channel);
    };
  }, [fetchNotifications, userKeys]);

  useEffect(() => {
    if (!open) return;
    fetchNotifications();
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, fetchNotifications]);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }, []);

  const handleToggle = () => {
    if (!open) updatePos();
    setOpen(!open);
  };

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // silent
    }
  };

  const markRead = async (id: string) => {
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: id }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      // silent
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="relative p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
      >
        <HugeiconsIcon icon={Notification01Icon} size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-[16px] h-[16px] rounded-full bg-accent-red text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[9999] w-[360px] rounded-xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
            style={{
              top: pos.top,
              right: pos.right,
              boxShadow: "var(--shadow-l2)",
              maxHeight: "min(480px, 80vh)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-tertiary">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-text-primary">
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-medium text-accent-green bg-accent-green/10 px-1.5 py-0.5 rounded-full">
                    {unreadCount} new
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[11px] text-text-link hover:underline cursor-pointer"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* List */}
            <div className="overflow-y-auto" style={{ maxHeight: "min(400px, 70vh)" }}>
              {loading && notifications.length === 0 ? (
                <div className="flex items-center justify-center h-[80px]">
                  <span className="text-[12px] text-text-disabled">Loading…</span>
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 px-4">
                  <HugeiconsIcon
                    icon={Notification01Icon}
                    size={24}
                    color="var(--icon-tertiary)"
                  />
                  <span className="text-[12px] text-text-disabled mt-2">
                    No notifications yet
                  </span>
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (!n.read) markRead(n.id);
                    }}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-cell-hover cursor-pointer ${
                      !n.read ? "bg-accent-green/[0.03]" : ""
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${typeColor(n.type)} 15%, transparent)` }}
                    >
                      <HugeiconsIcon
                        icon={typeIcon(n.type)}
                        size={16}
                        color={typeColor(n.type)}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-text-primary truncate">
                          {n.title}
                        </span>
                        {!n.read && (
                          <div className="w-1.5 h-1.5 rounded-full bg-accent-green shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
                        {n.description}
                      </p>
                      <span className="text-[10px] text-text-disabled mt-1 block">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
