"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import BugIcon from "@hugeicons/core-free-icons/Bug01Icon";
import Idea01Icon from "@hugeicons/core-free-icons/Idea01Icon";
import MessageMultiple01Icon from "@hugeicons/core-free-icons/MessageMultiple01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import EyeIcon from "@hugeicons/core-free-icons/ViewIcon";
import { AdminSidebarToggle } from "../layout";

type FeedbackStatus = "new" | "read" | "resolved";
type FeedbackCategory = "bug" | "idea" | "other";
type StatusFilter = "all" | FeedbackStatus;

interface FeedbackRow {
  id: string;
  category: FeedbackCategory;
  body: string;
  status: FeedbackStatus;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_META: Record<FeedbackCategory, { label: string; icon: typeof BugIcon; color: string }> = {
  bug: { label: "Bug", icon: BugIcon, color: "var(--accent-red-primary)" },
  idea: { label: "Idea", icon: Idea01Icon, color: "var(--accent-blue-primary)" },
  other: { label: "Other", icon: MessageMultiple01Icon, color: "var(--icon-tertiary)" },
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AdminFeedbackPage() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("new");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback?status=${statusFilter}`);
      if (!res.ok) throw new Error("Failed to load feedback");
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStatus = useCallback(
    async (id: string, status: FeedbackStatus) => {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      // Optimistic local update, then refetch to reconcile counts.
      setRows((prev) => {
        if (statusFilter === "all") {
          return prev.map((r) => (r.id === id ? { ...r, status } : r));
        }
        return prev.filter((r) => r.id !== id);
      });
      if (statusFilter !== "all") setTotal((t) => Math.max(0, t - 1));
    },
    [statusFilter],
  );

  const filters: { id: StatusFilter; label: string }[] = useMemo(
    () => [
      { id: "new", label: "New" },
      { id: "read", label: "Read" },
      { id: "resolved", label: "Resolved" },
      { id: "all", label: "All" },
    ],
    [],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border-tertiary">
        <AdminSidebarToggle />
        <h1 className="text-[15px] font-semibold text-text-primary">Feedback</h1>
        <span className="text-[12px] text-text-disabled font-mono">{total}</span>
      </div>

      {/* Filters */}
      <div className="shrink-0 flex items-center gap-2 px-6 py-3 border-b border-border-tertiary">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`h-[28px] px-3 rounded-[6px] text-[12px] font-medium transition-colors cursor-pointer ${
              statusFilter === f.id
                ? "bg-cta-nav-active text-text-primary"
                : "text-text-secondary hover:bg-cta-nav-hover"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mb-3 text-[11px] text-text-disabled">
          Feedback is anonymous. The submitter&apos;s email and identity are
          intentionally not shown here.
        </div>

        {loading ? (
          <div className="text-[13px] text-text-tertiary">Loading…</div>
        ) : error ? (
          <div className="text-[13px] text-accent-red">{error}</div>
        ) : rows.length === 0 ? (
          <div className="text-[13px] text-text-tertiary">
            No {statusFilter === "all" ? "" : statusFilter} feedback.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((row) => {
              const meta = CATEGORY_META[row.category];
              return (
                <div
                  key={row.id}
                  className="rounded-[10px] border border-border-tertiary bg-bg-l2 p-4"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-[6px] bg-bg-overlay-tertiary flex items-center justify-center">
                        <HugeiconsIcon icon={meta.icon} size={13} color={meta.color} />
                      </div>
                      <span className="text-[11px] font-mono uppercase tracking-wider text-text-disabled">
                        {meta.label}
                      </span>
                      <span className="text-[11px] text-text-disabled">·</span>
                      <span className="text-[11px] text-text-disabled">
                        {formatRelative(row.createdAt)}
                      </span>
                      <span className="text-[11px] text-text-disabled">·</span>
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {row.status !== "read" && (
                        <button
                          onClick={() => updateStatus(row.id, "read")}
                          className="h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer inline-flex items-center gap-1"
                        >
                          <HugeiconsIcon icon={EyeIcon} size={12} />
                          Mark read
                        </button>
                      )}
                      {row.status !== "resolved" && (
                        <button
                          onClick={() => updateStatus(row.id, "resolved")}
                          className="h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer inline-flex items-center gap-1"
                        >
                          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
                          Resolve
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-[13px] text-text-primary whitespace-pre-wrap leading-relaxed">
                    {row.body}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  const palette: Record<FeedbackStatus, { label: string; bg: string; color: string }> = {
    new: { label: "New", bg: "rgba(239,90,60,0.12)", color: "rgba(239,90,60,0.95)" },
    read: { label: "Read", bg: "var(--bg-overlay-tertiary)", color: "var(--text-tertiary)" },
    resolved: { label: "Resolved", bg: "rgba(125,148,179,0.12)", color: "var(--text-tertiary)" },
  };
  const p = palette[status];
  return (
    <span
      className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ background: p.bg, color: p.color }}
    >
      {p.label}
    </span>
  );
}
