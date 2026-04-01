"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import FolderShared01Icon from "@hugeicons/core-free-icons/FolderShared01Icon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon";
import CheckmarkCircle01Icon from "@hugeicons/core-free-icons/CheckmarkCircle01Icon";

interface Notification {
  id: string;
  type: "shared" | "upload" | "team" | "link" | "access";
  title: string;
  description: string;
  time: string;
  read: boolean;
  avatar: { initials: string; bg: string };
}

const mockNotifications: Notification[] = [
  {
    id: "1",
    type: "shared",
    title: "Alice Martin shared a folder",
    description: "Projects folder was shared with you",
    time: "2 min ago",
    read: false,
    avatar: { initials: "AM", bg: "var(--accent-green-primary)" },
  },
  {
    id: "2",
    type: "upload",
    title: "Upload complete",
    description: "Architecture Diagram.pdf uploaded successfully",
    time: "15 min ago",
    read: false,
    avatar: { initials: "SW", bg: "var(--accent-blue-primary)" },
  },
  {
    id: "3",
    type: "team",
    title: "Sam Kim joined the workspace",
    description: "Added to Personal workspace",
    time: "1 hour ago",
    read: false,
    avatar: { initials: "SK", bg: "var(--accent-orange-primary)" },
  },
  {
    id: "4",
    type: "link",
    title: "Link accessed",
    description: "Someone viewed Q1 Budget.xlsx via shared link",
    time: "3 hours ago",
    read: true,
    avatar: { initials: "??", bg: "var(--icon-tertiary)" },
  },
  {
    id: "5",
    type: "access",
    title: "Access expired",
    description: "John Doe's access to Financial Reports expired",
    time: "Yesterday",
    read: true,
    avatar: { initials: "JD", bg: "var(--accent-blue-primary)" },
  },
];

const typeIcons = {
  shared: FolderShared01Icon,
  upload: Upload04Icon,
  team: UserGroupIcon,
  link: Link01Icon,
  access: CheckmarkCircle01Icon,
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(mockNotifications);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleToggle = () => {
    if (!open) updatePos();
    setOpen(!open);
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const dropdown = open && createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9999] w-[360px] max-h-[480px] rounded-[10px] bg-bg-l3 border border-border-primary overflow-hidden flex flex-col"
      style={{ top: pos.top, right: pos.right, boxShadow: "var(--shadow-l2)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-tertiary shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-text-primary">Notifications</span>
          {unreadCount > 0 && (
            <span className="flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-accent-red text-[10px] font-bold text-white">
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-[11px] text-accent-green font-medium hover:underline cursor-pointer"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {notifications.map((n) => {
          const TypeIcon = typeIcons[n.type];
          return (
            <div
              key={n.id}
              className={`flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-bg-cell-hover border-b border-border-tertiary ${
                !n.read ? "bg-bg-overlay-tertiary" : ""
              }`}
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                <div
                  className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: n.avatar.bg }}
                >
                  {n.avatar.initials}
                </div>
                <div
                  className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-bg-l3 flex items-center justify-center border border-border-tertiary"
                >
                  <HugeiconsIcon icon={TypeIcon} size={10} color="var(--icon-secondary)" />
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-[12px] leading-tight ${!n.read ? "text-text-primary font-medium" : "text-text-secondary"}`}>
                    {n.title}
                  </p>
                  {!n.read && (
                    <div className="w-2 h-2 rounded-full bg-accent-blue shrink-0 mt-1" />
                  )}
                </div>
                <p className="text-[11px] text-text-tertiary mt-0.5 truncate">{n.description}</p>
                <p className="text-[10px] text-text-disabled mt-1">{n.time}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-border-tertiary shrink-0">
        <button className="w-full text-center text-[12px] text-accent-green font-medium hover:underline cursor-pointer">
          View all notifications
        </button>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="relative flex items-center justify-center h-[30px] w-[30px] rounded-[8px] text-icon-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
      >
        <HugeiconsIcon icon={Notification01Icon} size={16} />
        {unreadCount > 0 && (
          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent-red border-2 border-bg-main" />
        )}
      </button>
      {dropdown}
    </>
  );
}
