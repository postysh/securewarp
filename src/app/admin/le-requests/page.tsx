"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import CourtLawIcon from "@hugeicons/core-free-icons/CourtLawIcon";
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { AdminSidebarToggle } from "../layout";

/**
 * /admin/le-requests — intake log for legal process. Admins log each
 * subpoena / warrant / preservation order / MLAT / NSL as it
 * arrives. The transparency page aggregates these counts live.
 */

type LeType =
  | "subpoena-us"
  | "warrant-us"
  | "preservation-us"
  | "mlat"
  | "nsl"
  | "other";

type LeStatus = "pending" | "produced" | "challenged" | "rejected";
type StatusFilter = "all" | LeStatus;

interface LeRow {
  id: string;
  receivedAt: string;
  type: LeType;
  jurisdiction: string | null;
  status: LeStatus;
  producedAt: string | null;
  gagOrderUntil: string | null;
  notes: string | null;
  createdAt: string;
}

const TYPE_LABEL: Record<LeType, string> = {
  "subpoena-us": "US subpoena",
  "warrant-us": "US search warrant",
  "preservation-us": "US preservation order",
  mlat: "International (MLAT)",
  nsl: "National Security Letter",
  other: "Other",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminLeRequestsPage() {
  const [rows, setRows] = useState<LeRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/le-requests?status=${statusFilter}`);
      if (!res.ok) throw new Error("Failed to load requests");
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = useCallback(
    async (id: string, status: LeStatus) => {
      const res = await fetch(`/api/admin/le-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      await load();
    },
    [load],
  );

  const filters: { id: StatusFilter; label: string }[] = useMemo(
    () => [
      { id: "all", label: "All" },
      { id: "pending", label: "Pending" },
      { id: "produced", label: "Produced" },
      { id: "challenged", label: "Challenged" },
      { id: "rejected", label: "Rejected" },
    ],
    [],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border-tertiary">
        <AdminSidebarToggle />
        <HugeiconsIcon icon={CourtLawIcon} size={16} color="var(--accent-blue-primary)" />
        <h1 className="text-[15px] font-semibold text-text-primary">Legal process</h1>
        <span className="text-[12px] text-text-disabled font-mono">{rows.length}</span>
        <button
          onClick={() => setLogOpen(true)}
          className="ml-auto h-[32px] px-3.5 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] inline-flex items-center gap-1.5"
        >
          <HugeiconsIcon icon={Add01Icon} size={13} />
          Log new request
        </button>
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
        <div className="mb-3 text-[11px] text-text-disabled leading-relaxed max-w-[600px]">
          Log every subpoena, warrant, preservation order, MLAT request, and
          National Security Letter as it arrives. These counts feed the public
          transparency report.
        </div>

        {loading ? (
          <div className="text-[13px] text-text-tertiary">Loading…</div>
        ) : error ? (
          <div className="text-[13px] text-accent-red">{error}</div>
        ) : rows.length === 0 ? (
          <div className="text-[13px] text-text-tertiary">
            No {statusFilter === "all" ? "" : statusFilter} requests on file.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <LeCard key={row.id} row={row} onUpdate={updateStatus} />
            ))}
          </div>
        )}
      </div>

      {logOpen && (
        <LogRequestDialog
          onClose={() => setLogOpen(false)}
          onSubmitted={async () => {
            setLogOpen(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function LeCard({
  row,
  onUpdate,
}: {
  row: LeRow;
  onUpdate: (id: string, status: LeStatus) => void;
}) {
  const gagged =
    row.gagOrderUntil && new Date(row.gagOrderUntil) > new Date();
  return (
    <div className="rounded-[10px] border border-border-tertiary bg-bg-l2 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono uppercase tracking-wider text-text-primary">
            {TYPE_LABEL[row.type]}
          </span>
          <span className="text-[11px] text-text-disabled">·</span>
          <span className="text-[11px] text-text-disabled">
            received {formatDate(row.receivedAt)}
          </span>
          {row.jurisdiction && (
            <>
              <span className="text-[11px] text-text-disabled">·</span>
              <span className="text-[11px] text-text-tertiary">
                {row.jurisdiction}
              </span>
            </>
          )}
          <StatusBadge status={row.status} />
          {gagged && (
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                background: "rgba(239,90,60,0.12)",
                color: "rgb(239,90,60)",
              }}
              title={`Gag order until ${formatDate(row.gagOrderUntil!)}`}
            >
              gag
            </span>
          )}
        </div>
      </div>
      {row.notes && (
        <div className="text-[12px] text-text-secondary whitespace-pre-wrap leading-relaxed mt-1 mb-2">
          {row.notes}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {row.status !== "produced" && (
          <button
            onClick={() => onUpdate(row.id, "produced")}
            className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
          >
            Mark produced
          </button>
        )}
        {row.status !== "challenged" && (
          <button
            onClick={() => onUpdate(row.id, "challenged")}
            className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
          >
            Challenged
          </button>
        )}
        {row.status !== "rejected" && (
          <button
            onClick={() => onUpdate(row.id, "rejected")}
            className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
          >
            Rejected
          </button>
        )}
        {row.status !== "pending" && (
          <button
            onClick={() => onUpdate(row.id, "pending")}
            className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
          >
            Back to pending
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LeStatus }) {
  const palette: Record<LeStatus, { label: string; bg: string; color: string }> = {
    pending: { label: "Pending", bg: "rgba(239,90,60,0.12)", color: "rgb(239,90,60)" },
    produced: { label: "Produced", bg: "rgba(66,153,225,0.15)", color: "var(--accent-blue-primary)" },
    challenged: { label: "Challenged", bg: "var(--bg-overlay-tertiary)", color: "var(--text-tertiary)" },
    rejected: { label: "Rejected", bg: "var(--bg-overlay-tertiary)", color: "var(--text-tertiary)" },
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

function LogRequestDialog({
  onClose,
  onSubmitted,
}: {
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [receivedAt, setReceivedAt] = useState(today);
  const [type, setType] = useState<LeType>("subpoena-us");
  const [jurisdiction, setJurisdiction] = useState("");
  const [gagOrderUntil, setGagOrderUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        receivedAt: new Date(`${receivedAt}T00:00:00Z`).toISOString(),
        type,
      };
      if (jurisdiction.trim()) body.jurisdiction = jurisdiction.trim();
      if (gagOrderUntil) {
        body.gagOrderUntil = new Date(`${gagOrderUntil}T00:00:00Z`).toISOString();
      }
      if (notes.trim()) body.notes = notes.trim();
      const res = await fetch("/api/admin/le-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        throw new Error((data as { error?: string }).error ?? "Log failed");
      }
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Log failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-[480px] rounded-2xl border border-border-tertiary bg-bg-l3 overflow-hidden"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={CourtLawIcon} size={15} color="var(--accent-blue-primary)" />
            <div className="text-[13px] font-semibold text-text-primary">
              Log legal process
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-bg-cell-hover transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Close"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} color="var(--icon-tertiary)" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          <Field label="Received">
            <input
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              required
              max={today}
              className="w-full px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40"
            />
          </Field>
          <Field label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as LeType)}
              className="w-full px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40"
            >
              <option value="subpoena-us">US subpoena</option>
              <option value="warrant-us">US search warrant</option>
              <option value="preservation-us">US preservation order</option>
              <option value="mlat">International (MLAT)</option>
              <option value="nsl">National Security Letter</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Jurisdiction (optional)">
            <input
              type="text"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              maxLength={200}
              placeholder="e.g. E.D. Va., Ramsey Co. MN, BKA (DE)"
              className="w-full px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40"
            />
          </Field>
          <Field label="Gag order until (optional)">
            <input
              type="date"
              value={gagOrderUntil}
              onChange={(e) => setGagOrderUntil(e.target.value)}
              className="w-full px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40"
            />
          </Field>
          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Docket number, scope, contact at the requesting agency, etc."
              className="w-full px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40 resize-none"
            />
          </Field>

          {error && <div className="text-[11px] text-accent-red">{error}</div>}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-[36px] px-4 rounded-[10px] text-[12px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-[36px] px-5 rounded-[10px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? "Logging…" : "Log request"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary">
        {label}
      </label>
      {children}
    </div>
  );
}
