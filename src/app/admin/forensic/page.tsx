"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import ShieldUserIcon from "@hugeicons/core-free-icons/ShieldUserIcon";
import { AdminSidebarToggle } from "../layout";

/**
 * /admin/forensic — the one-stop export page for LE subpoena
 * responses. Admin types an email, we pull every metadata field we
 * legally hold for that user, render a summary, and provide a JSON
 * download for attachment to the response. Never shows decrypted
 * file content or filenames because we don't have them.
 */

interface Bundle {
  generatedAt: string;
  subject: {
    userId: string;
    email: string;
    displayName: string | null;
    createdAt: string;
    suspendedAt: string | null;
    preservationHoldAt: string | null;
  };
  ipLog: { event: string; ipHash: string; occurredAt: string }[];
  filesOwned: {
    id: string;
    sizeBytes: number;
    createdAt: string;
    uploadComplete: boolean;
    deletedAt: string | null;
    evidenceHoldAt: string | null;
    parentId: string | null;
  }[];
  linksCreated: {
    id: string;
    fileId: string;
    createdAt: string;
    revokedAt: string | null;
    expiresAt: string | null;
    hasPassword: boolean;
  }[];
  sharingGraph: {
    fileKeysGranted: { fileId: string; grantedToUserId: string; createdAt: string }[];
    fileKeysReceived: { fileId: string; grantedByUserId: string | null; createdAt: string }[];
  };
  reportsAgainst: {
    id: string;
    category: string;
    status: string;
    details: string;
    reporterEmail: string | null;
    fileId: string | null;
    linkId: string | null;
    createdAt: string;
  }[];
  reportsFiled: {
    id: string;
    category: string;
    status: string;
    fileOwnerId: string;
    fileId: string | null;
    linkId: string | null;
    createdAt: string;
  }[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function AdminForensicPage() {
  const [email, setEmail] = useState("");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBundle = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    setBundle(null);
    try {
      const res = await fetch(
        `/api/admin/forensic?email=${encodeURIComponent(email.trim())}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        throw new Error((data as { error?: string }).error ?? "Lookup failed");
      }
      setBundle(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  };

  const downloadUrl = bundle
    ? `/api/admin/forensic?email=${encodeURIComponent(email.trim())}&download=1`
    : "";

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border-tertiary">
        <AdminSidebarToggle />
        <HugeiconsIcon icon={ShieldUserIcon} size={16} color="var(--accent-blue-primary)" />
        <h1 className="text-[15px] font-semibold text-text-primary">Forensic export</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 text-[12px] text-text-tertiary leading-relaxed max-w-[600px]">
          Look up a user by email and export the full metadata bundle we can
          legally disclose under a subpoena, court order, or search warrant.
          File contents and filenames are encrypted client-side and are never
          in this bundle.
        </div>

        <form onSubmit={fetchBundle} className="flex items-center gap-2 mb-5 max-w-[560px]">
          <div className="relative flex-1">
            <HugeiconsIcon
              icon={SearchIcon}
              size={14}
              color="var(--icon-tertiary)"
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="subject@example.com"
              className="w-full pl-9 pr-3 h-[36px] rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="h-[36px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Looking up…" : "Look up"}
          </button>
        </form>

        {error && (
          <div
            className="text-[12px] mb-4 px-3 py-2 rounded-[6px] max-w-[560px]"
            style={{
              color: "rgb(239,90,60)",
              background: "rgba(239,90,60,0.08)",
            }}
          >
            {error}
          </div>
        )}

        {bundle && (
          <div className="flex flex-col gap-4 max-w-[900px]">
            <div className="rounded-[10px] border border-border-tertiary bg-bg-l2 p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="text-[13px] font-semibold text-text-primary">
                    {bundle.subject.email}
                  </div>
                  <div className="text-[11px] text-text-tertiary font-mono mt-0.5">
                    {bundle.subject.userId}
                  </div>
                </div>
                <a
                  href={downloadUrl}
                  className="h-[32px] px-3.5 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] inline-flex items-center gap-1.5"
                  download
                >
                  <HugeiconsIcon icon={Download04Icon} size={13} />
                  Download JSON
                </a>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Account age" value={formatDate(bundle.subject.createdAt)} />
                <Stat label="Display name" value={bundle.subject.displayName ?? "—"} />
                <Stat
                  label="Suspended"
                  value={bundle.subject.suspendedAt ? formatDate(bundle.subject.suspendedAt) : "No"}
                />
                <Stat
                  label="IP preservation"
                  value={
                    bundle.subject.preservationHoldAt
                      ? `on since ${formatDate(bundle.subject.preservationHoldAt)}`
                      : "off"
                  }
                />
              </div>
            </div>

            <SectionCard label="IP log" count={bundle.ipLog.length}>
              {bundle.ipLog.length === 0 ? (
                <div className="text-[12px] text-text-disabled">
                  No IPs recorded. Preservation hold was never enabled, or no
                  activity since it was turned on.
                </div>
              ) : (
                <div className="max-h-[260px] overflow-y-auto">
                  <Table
                    headers={["Event", "IP hash", "When"]}
                    rows={bundle.ipLog.slice(0, 200).map((e) => [
                      e.event,
                      <span key="ip" className="font-mono text-text-tertiary">{e.ipHash.slice(0, 16)}…</span>,
                      formatDate(e.occurredAt),
                    ])}
                  />
                </div>
              )}
            </SectionCard>

            <SectionCard label="Files owned" count={bundle.filesOwned.length}>
              <div className="max-h-[260px] overflow-y-auto">
                <Table
                  headers={["File id", "Size", "Created", "State"]}
                  rows={bundle.filesOwned.slice(0, 200).map((f) => [
                    <span key="id" className="font-mono text-text-tertiary">{f.id.slice(0, 12)}…</span>,
                    formatBytes(f.sizeBytes),
                    formatDate(f.createdAt),
                    f.evidenceHoldAt
                      ? "on hold"
                      : f.deletedAt
                        ? "deleted"
                        : !f.uploadComplete
                          ? "incomplete"
                          : "active",
                  ])}
                />
              </div>
            </SectionCard>

            <SectionCard label="Links created" count={bundle.linksCreated.length}>
              <div className="max-h-[260px] overflow-y-auto">
                <Table
                  headers={["Link", "File", "Created", "State"]}
                  rows={bundle.linksCreated.slice(0, 200).map((l) => [
                    <span key="lid" className="font-mono text-text-tertiary">{l.id.slice(0, 12)}…</span>,
                    <span key="fid" className="font-mono text-text-tertiary">{l.fileId.slice(0, 12)}…</span>,
                    formatDate(l.createdAt),
                    l.revokedAt
                      ? "revoked"
                      : l.expiresAt && new Date(l.expiresAt) < new Date()
                        ? "expired"
                        : l.hasPassword
                          ? "active (password)"
                          : "active",
                  ])}
                />
              </div>
            </SectionCard>

            <SectionCard label="Reports against this user" count={bundle.reportsAgainst.length}>
              {bundle.reportsAgainst.length === 0 ? (
                <div className="text-[12px] text-text-disabled">None.</div>
              ) : (
                <div className="max-h-[260px] overflow-y-auto">
                  <Table
                    headers={["Category", "Status", "When", "Reporter"]}
                    rows={bundle.reportsAgainst.slice(0, 100).map((r) => [
                      r.category,
                      r.status,
                      formatDate(r.createdAt),
                      r.reporterEmail ?? "anonymous",
                    ])}
                  />
                </div>
              )}
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono uppercase tracking-wider text-text-disabled">
        {label}
      </span>
      <span className="text-[12px] text-text-primary">{value}</span>
    </div>
  );
}

function SectionCard({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-border-tertiary bg-bg-l2 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary">
          {label}
        </span>
        <span className="text-[11px] text-text-disabled font-mono">{count}</span>
      </div>
      {children}
    </div>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-[10px] font-mono uppercase tracking-wider text-text-disabled">
          {headers.map((h, i) => (
            <th key={i} className="text-left py-1 pr-3 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-t border-border-tertiary text-text-secondary">
            {row.map((cell, j) => (
              <td key={j} className="py-1.5 pr-3 align-top">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
