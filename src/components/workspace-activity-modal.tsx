"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import AnalyticsUpIcon from "@hugeicons/core-free-icons/AnalyticsUpIcon";

interface ActivityModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
}

interface ActivityEvent {
  id: string;
  type: string;
  actorEmail: string | null;
  targetEmail: string | null;
  detail: string | null;
  createdAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  "files.share": "Shared a file",
  "files.unshare": "Revoked access",
  "files.leave": "Left a file",
  "files.permission_change": "Changed permissions",
  "files.delete": "Deleted a file",
  "files.rename": "Renamed a file",
  "files.move": "Moved a file",
  "files.restore": "Restored a file",
  "files.purge": "Permanently deleted",
  "files.rotate": "Rotated keys",
  "link.create": "Created a link",
  "link.revoke": "Revoked a link",
};

function formatEvent(e: ActivityEvent): string {
  const label = EVENT_LABELS[e.type] || e.type;
  if (e.type === "files.share" && e.targetEmail) return `Shared with ${e.targetEmail}`;
  if (e.type === "files.unshare" && e.targetEmail) return `Revoked access for ${e.targetEmail}`;
  if (e.type === "files.permission_change" && e.detail?.startsWith("workspace.transfer")) return "Transferred workspace ownership";
  if (e.type === "link.create" && e.detail === "password") return "Created password-protected link";
  return label;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function WorkspaceActivityModal({ open, onClose, workspaceId }: ActivityModalProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId) return;
    setLoading(true);
    fetch(`/api/workspaces/activity?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((d) => { if (d.events) setEvents(d.events); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        role="dialog" aria-modal="true" aria-label="Workspace activity"
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[480px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in flex flex-col"
        style={{ boxShadow: "var(--shadow-l2)", maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={AnalyticsUpIcon} size={18} color="var(--accent-blue-primary)" />
            </div>
            <div>
              <span className="text-[14px] font-semibold text-text-primary">Activity</span>
              <p className="text-[11px] text-text-disabled">Recent workspace events</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* Events */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="text-center py-8 text-[12px] text-text-disabled">Loading...</div>
          ) : events.length === 0 ? (
            <div className="text-center py-8 text-[12px] text-text-disabled">No activity yet</div>
          ) : (
            <div className="space-y-0.5">
              {events.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-2 py-2.5 rounded-[8px] hover:bg-bg-cell-hover transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-blue-primary mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-text-primary">{formatEvent(e)}</p>
                    <p className="text-[11px] text-text-disabled">
                      {e.actorEmail && <span>{e.actorEmail}</span>}
                      <span className="mx-1.5">-</span>
                      <span>{timeAgo(e.createdAt)}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-tertiary shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
