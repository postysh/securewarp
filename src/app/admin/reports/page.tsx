"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import ShieldUserIcon from "@hugeicons/core-free-icons/ShieldUserIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import ArrowUpRight01Icon from "@hugeicons/core-free-icons/ArrowUpRight01Icon";
import LinkSquare02Icon from "@hugeicons/core-free-icons/LinkSquare02Icon";
import PauseIcon from "@hugeicons/core-free-icons/PauseIcon";
import UserBlock01Icon from "@hugeicons/core-free-icons/UserBlock01Icon";
import UnavailableIcon from "@hugeicons/core-free-icons/UnavailableIcon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import SnowIcon from "@hugeicons/core-free-icons/SnowIcon";
import DatabaseIcon from "@hugeicons/core-free-icons/DatabaseIcon";
import { AdminSidebarToggle } from "../layout";

type ReportCategory = "csam" | "harassment" | "malware" | "copyright" | "illegal" | "other";
type ReportStatus = "pending" | "dismissed" | "actioned" | "escalated";
type StatusFilter = "all" | ReportStatus;

interface ReportRow {
  id: string;
  category: ReportCategory;
  details: string;
  status: ReportStatus;
  createdAt: string;
  handledAt: string | null;
  handlerNotes: string | null;
  reporterEmail: string | null;
  reporterIsRegistered: boolean;
  fileId: string | null;
  linkId: string | null;
  ownerEmail: string | null;
  ownerSuspendedAt: string | null;
  ownerPreservationHoldAt: string | null;
  fileSizeBytes: number | null;
  fileCreatedAt: string | null;
  fileDeletedAt: string | null;
  fileUploadComplete: boolean | null;
  fileEvidenceHoldAt: string | null;
  linkRevokedAt: string | null;
  linkExpiresAt: string | null;
}

type CardAction =
  | "revoke-link"
  | "suspend-uploader"
  | "unsuspend-uploader"
  | "evidence-hold"
  | "clear-evidence-hold"
  | "set-preservation"
  | "clear-preservation"
  | "ban-uploader";

const CATEGORY_LABEL: Record<ReportCategory, string> = {
  csam: "CSAM",
  harassment: "Harassment",
  malware: "Malware / phishing",
  copyright: "Copyright",
  illegal: "Illegal content",
  other: "Other",
};

const CATEGORY_COLOR: Record<ReportCategory, string> = {
  csam: "var(--accent-red-primary)",
  harassment: "var(--accent-red-primary)",
  malware: "var(--accent-orange-primary)",
  copyright: "var(--accent-yellow-primary)",
  illegal: "var(--accent-orange-primary)",
  other: "var(--icon-tertiary)",
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

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "unknown size";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function AdminReportsPage() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports?status=${statusFilter}`);
      if (!res.ok) throw new Error("Failed to load reports");
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = useCallback(
    async (id: string, status: ReportStatus, handlerNotes?: string) => {
      const res = await fetch(`/api/admin/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, handlerNotes: handlerNotes ?? null }),
      });
      if (!res.ok) return;
      // Drop the row from the current filtered view. "all" keeps it but
      // refetch to reconcile handled_at.
      if (statusFilter === "all") {
        load();
      } else {
        setRows((prev) => prev.filter((r) => r.id !== id));
      }
    },
    [statusFilter, load],
  );

  const performAction = useCallback(
    async (
      id: string,
      action: CardAction,
      extra?: { banIp?: boolean; banReason?: "csam" | "abuse" | "fraud" | "manual" },
    ): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch(`/api/admin/reports/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        return { ok: false, error: (data as { error?: string }).error ?? "Action failed" };
      }
      // Side-effect happened on the server; refresh the current view
      // so column state (suspended badge, link revoked, etc.) reflects
      // reality.
      await load();
      return { ok: true };
    },
    [load],
  );

  const filters: { id: StatusFilter; label: string }[] = useMemo(
    () => [
      { id: "pending", label: "Pending" },
      { id: "actioned", label: "Actioned" },
      { id: "escalated", label: "Escalated" },
      { id: "dismissed", label: "Dismissed" },
      { id: "all", label: "All" },
    ],
    [],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border-tertiary">
        <AdminSidebarToggle />
        <h1 className="text-[15px] font-semibold text-text-primary">Reports</h1>
        <span className="text-[12px] text-text-disabled font-mono">{rows.length}</span>
      </div>

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

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mb-3 text-[11px] text-text-disabled leading-relaxed">
          File contents and filenames are encrypted client-side. We see the
          reporter&apos;s written claim plus metadata (size, timestamps, owner
          email). For content review on a specific report, contact the
          owner to cooperate with the investigation.
        </div>

        {loading ? (
          <div className="text-[13px] text-text-tertiary">Loading…</div>
        ) : error ? (
          <div className="text-[13px] text-accent-red">{error}</div>
        ) : rows.length === 0 ? (
          <div className="text-[13px] text-text-tertiary">
            No {statusFilter === "all" ? "" : statusFilter} reports.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <ReportCard
                key={row.id}
                row={row}
                onUpdate={updateStatus}
                onAction={performAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportCard({
  row,
  onUpdate,
  onAction,
}: {
  row: ReportRow;
  onUpdate: (id: string, status: ReportStatus, notes?: string) => void;
  onAction: (
    id: string,
    action: CardAction,
    extra?: { banIp?: boolean; banReason?: "csam" | "abuse" | "fraud" | "manual" },
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [notes, setNotes] = useState(row.handlerNotes ?? "");
  const [actionBusy, setActionBusy] = useState<CardAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const submit = (status: ReportStatus) => {
    onUpdate(row.id, status, notes.trim() || undefined);
  };

  const runAction = async (
    action: CardAction,
    extra?: { banIp?: boolean; banReason?: "csam" | "abuse" | "fraud" | "manual" },
  ) => {
    setActionBusy(action);
    setActionError(null);
    const res = await onAction(row.id, action, extra);
    setActionBusy(null);
    if (!res.ok && res.error) setActionError(res.error);
  };

  const confirmAndRun = (
    message: string,
    action: CardAction,
    extra?: { banIp?: boolean; banReason?: "csam" | "abuse" | "fraud" | "manual" },
  ) => {
    if (window.confirm(message)) void runAction(action, extra);
  };

  const linkActive =
    !!row.linkId &&
    !row.linkRevokedAt &&
    !(row.linkExpiresAt && new Date(row.linkExpiresAt) < new Date());
  const onHold = !!row.fileEvidenceHoldAt;
  const suspended = !!row.ownerSuspendedAt;
  const preserved = !!row.ownerPreservationHoldAt;

  return (
    <div className="rounded-[10px] border border-border-tertiary bg-bg-l2 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-6 h-6 rounded-[6px] bg-bg-overlay-tertiary flex items-center justify-center">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              size={13}
              color={CATEGORY_COLOR[row.category]}
            />
          </div>
          <span
            className="text-[11px] font-mono uppercase tracking-wider"
            style={{ color: CATEGORY_COLOR[row.category] }}
          >
            {CATEGORY_LABEL[row.category]}
          </span>
          <span className="text-[11px] text-text-disabled">·</span>
          <span className="text-[11px] text-text-disabled">
            {formatRelative(row.createdAt)}
          </span>
          <span className="text-[11px] text-text-disabled">·</span>
          <StatusBadge status={row.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <FactBlock label="Reporter">
          {row.reporterEmail ? (
            <>
              <span className="text-text-primary">{row.reporterEmail}</span>
              {row.reporterIsRegistered && (
                <span className="ml-1.5 text-[10px] font-mono uppercase tracking-wider text-text-disabled">
                  registered
                </span>
              )}
            </>
          ) : (
            <span className="text-text-disabled">Anonymous (no email)</span>
          )}
        </FactBlock>

        <FactBlock label="Uploader">
          {row.ownerEmail ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-text-primary">{row.ownerEmail}</span>
              {row.ownerSuspendedAt && (
                <span
                  className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    background: "rgba(239,90,60,0.12)",
                    color: "rgb(239,90,60)",
                  }}
                >
                  suspended
                </span>
              )}
              {row.ownerPreservationHoldAt && (
                <span
                  className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    background: "rgba(66,153,225,0.15)",
                    color: "var(--accent-blue-primary)",
                  }}
                  title="IP logging is active for this user"
                >
                  preserving
                </span>
              )}
              <Link
                href={`/admin/users?q=${encodeURIComponent(row.ownerEmail)}`}
                className="inline-flex items-center text-text-link hover:underline text-[11px]"
              >
                <HugeiconsIcon icon={ArrowUpRight01Icon} size={11} />
              </Link>
            </div>
          ) : (
            <span className="text-text-disabled">Unknown</span>
          )}
        </FactBlock>

        <FactBlock label="File">
          {row.fileId ? (
            <div className="flex flex-col text-text-primary">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span>
                  {formatBytes(row.fileSizeBytes)}
                  {row.fileCreatedAt && (
                    <>
                      {" · "}uploaded {formatRelative(row.fileCreatedAt)}
                    </>
                  )}
                </span>
                {row.fileEvidenceHoldAt && (
                  <span
                    className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      background: "rgba(239,90,60,0.12)",
                      color: "rgb(239,90,60)",
                    }}
                    title="Frozen from deletion and download"
                  >
                    on hold
                  </span>
                )}
              </div>
              <span className="text-[11px] text-text-disabled font-mono">
                {row.fileDeletedAt ? "deleted · " : row.fileUploadComplete === false ? "upload incomplete · " : ""}
                {row.fileId.slice(0, 8)}…
              </span>
            </div>
          ) : (
            <span className="text-text-disabled">File row missing</span>
          )}
        </FactBlock>

        <FactBlock label="Share link">
          {row.linkId ? (
            <div className="flex flex-col text-text-primary">
              <span>
                {row.linkRevokedAt
                  ? "Revoked"
                  : row.linkExpiresAt && new Date(row.linkExpiresAt) < new Date()
                    ? "Expired"
                    : "Active"}
              </span>
              <span className="text-[11px] text-text-disabled font-mono">
                {row.linkId.slice(0, 8)}…
              </span>
            </div>
          ) : (
            <span className="text-text-disabled">Not a link report</span>
          )}
        </FactBlock>
      </div>

      <div className="rounded-[8px] bg-bg-l3 border border-border-tertiary p-3 mb-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
          Reporter notes
        </div>
        <div className="text-[13px] text-text-primary whitespace-pre-wrap leading-relaxed">
          {row.details}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-text-disabled">
          Handler notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Action taken, escalation reference, etc."
          className="w-full px-3 py-2 rounded-[8px] bg-bg-field text-[12px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40 resize-none"
        />
      </div>

      {actionError && (
        <div
          className="mt-3 text-[11px] px-3 py-2 rounded-[6px]"
          style={{
            color: "rgb(239,90,60)",
            background: "rgba(239,90,60,0.08)",
          }}
        >
          {actionError}
        </div>
      )}

      {/* Direct actions — the report-card buttons that actually do
          things to content and accounts, separate from the
          dismiss/actioned/escalated status lifecycle below. */}
      <div className="mt-3 -mx-1 flex items-center gap-1 flex-wrap border-t border-border-tertiary pt-3">
        {row.linkId && linkActive && (
          <ActionButton
            icon={LinkSquare02Icon}
            label={actionBusy === "revoke-link" ? "Revoking…" : "Revoke link"}
            color="var(--accent-orange-primary)"
            disabled={actionBusy !== null}
            onClick={() => runAction("revoke-link")}
          />
        )}
        {row.fileId && !onHold && (
          <ActionButton
            icon={SnowIcon}
            label={actionBusy === "evidence-hold" ? "Holding…" : "Evidence hold"}
            color="var(--accent-blue-primary)"
            disabled={actionBusy !== null}
            onClick={() => runAction("evidence-hold")}
          />
        )}
        {row.fileId && onHold && (
          <ActionButton
            icon={SnowIcon}
            label={actionBusy === "clear-evidence-hold" ? "Clearing…" : "Clear hold"}
            color="var(--icon-tertiary)"
            disabled={actionBusy !== null}
            onClick={() =>
              confirmAndRun(
                "Clear the evidence hold on this file? The uploader will be able to delete it again.",
                "clear-evidence-hold",
              )
            }
          />
        )}
        {!preserved ? (
          <ActionButton
            icon={DatabaseIcon}
            label={actionBusy === "set-preservation" ? "Starting…" : "Start IP log"}
            color="var(--accent-blue-primary)"
            disabled={actionBusy !== null}
            onClick={() => runAction("set-preservation")}
          />
        ) : (
          <ActionButton
            icon={DatabaseIcon}
            label={actionBusy === "clear-preservation" ? "Stopping…" : "Stop IP log"}
            color="var(--icon-tertiary)"
            disabled={actionBusy !== null}
            onClick={() => runAction("clear-preservation")}
          />
        )}
        {!suspended ? (
          <ActionButton
            icon={PauseIcon}
            label={actionBusy === "suspend-uploader" ? "Suspending…" : "Suspend uploader"}
            color="var(--accent-orange-primary)"
            disabled={actionBusy !== null}
            onClick={() =>
              confirmAndRun(
                "Suspend this uploader? Their active sessions are invalidated and they cannot log back in until unsuspended.",
                "suspend-uploader",
              )
            }
          />
        ) : (
          <ActionButton
            icon={CheckmarkCircle02Icon}
            label={actionBusy === "unsuspend-uploader" ? "Unsuspending…" : "Unsuspend"}
            color="var(--icon-tertiary)"
            disabled={actionBusy !== null}
            onClick={() => runAction("unsuspend-uploader")}
          />
        )}
        <ActionButton
          icon={UserBlock01Icon}
          label={actionBusy === "ban-uploader" ? "Banning…" : "Ban uploader"}
          color="var(--accent-red-primary)"
          disabled={actionBusy !== null}
          onClick={() =>
            confirmAndRun(
              "Permanently ban this uploader by email and recent IPs? They will be suspended immediately and blocked from re-registering. This is typically reserved for CSAM and serious abuse.",
              "ban-uploader",
              { banIp: true, banReason: row.category === "csam" ? "csam" : "abuse" },
            )
          }
        />
        <a
          href={`/api/admin/reports/${row.id}/forensic`}
          className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer inline-flex items-center gap-1.5"
          download
        >
          <HugeiconsIcon icon={Download04Icon} size={12} color="var(--accent-blue-primary)" />
          Forensic packet
        </a>
      </div>

      {/* Status lifecycle */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {row.status !== "dismissed" && (
          <ActionButton
            icon={Cancel01Icon}
            label="Dismiss"
            color="var(--icon-tertiary)"
            onClick={() => submit("dismissed")}
          />
        )}
        {row.status !== "actioned" && (
          <ActionButton
            icon={CheckmarkCircle02Icon}
            label="Mark actioned"
            color="var(--accent-blue-primary)"
            onClick={() => submit("actioned")}
          />
        )}
        {row.status !== "escalated" && (
          <ActionButton
            icon={ShieldUserIcon}
            label="Escalate"
            color="var(--accent-red-primary)"
            onClick={() => submit("escalated")}
          />
        )}
      </div>
    </div>
  );
}

function FactBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono uppercase tracking-wider text-text-disabled">
        {label}
      </span>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  color,
  onClick,
  disabled,
}: {
  icon: typeof AlertCircleIcon;
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <HugeiconsIcon icon={icon} size={12} color={color} />
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: ReportStatus }) {
  const palette: Record<ReportStatus, { label: string; bg: string; color: string }> = {
    pending: { label: "Pending", bg: "rgba(239,90,60,0.12)", color: "rgb(239,90,60)" },
    actioned: { label: "Actioned", bg: "rgba(125,148,179,0.12)", color: "var(--text-tertiary)" },
    escalated: { label: "Escalated", bg: "rgba(239,90,60,0.12)", color: "rgb(239,90,60)" },
    dismissed: { label: "Dismissed", bg: "var(--bg-overlay-tertiary)", color: "var(--text-tertiary)" },
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
