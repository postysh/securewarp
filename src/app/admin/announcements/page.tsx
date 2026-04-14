"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import PlayCircleIcon from "@hugeicons/core-free-icons/PlayCircleIcon";
import StopCircleIcon from "@hugeicons/core-free-icons/StopCircleIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import PencilEdit01Icon from "@hugeicons/core-free-icons/PencilEdit01Icon";
import { AdminSidebarToggle } from "../layout";

type Severity = "info" | "warning" | "critical";

type Announcement = {
  id: string;
  created_at: string;
  updated_at: string;
  created_by_email: string | null;
  title: string;
  body: string;
  severity: Severity;
  published_at: string | null;
  expires_at: string | null;
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60_000);
  const prefix = diff < 0 ? "in " : "";
  const suffix = diff < 0 ? "" : " ago";
  if (mins < 1) return "just now";
  if (mins < 60) return `${prefix}${mins}m${suffix}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${prefix}${hours}h${suffix}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${prefix}${days}d${suffix}`;
  return iso.slice(0, 10);
}

function statusOf(a: Announcement): { label: string; color: string } {
  if (!a.published_at) return { label: "Draft", color: "var(--text-tertiary)" };
  if (a.expires_at && a.expires_at < new Date().toISOString())
    return { label: "Expired", color: "var(--text-disabled)" };
  return { label: "Live", color: "var(--accent-green-primary)" };
}

const severityStyle: Record<Severity, { bg: string; text: string; dot: string }> = {
  info: { bg: "bg-bg-field", text: "text-text-secondary", dot: "var(--accent-blue-primary)" },
  warning: { bg: "bg-accent-yellow-bg", text: "text-accent-yellow", dot: "var(--accent-yellow-primary)" },
  critical: { bg: "bg-accent-red/12", text: "text-accent-red", dot: "var(--accent-red-primary)" },
};

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; item: Announcement } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/announcements");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setItems(data.announcements ?? []);
    } catch {
      setError("Failed to load announcements");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<Response>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
      setEditor(null);
    }
  };

  const togglePublish = (a: Announcement) =>
    act(() =>
      fetch(`/api/admin/announcements/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: !a.published_at }),
      })
    );

  const remove = (id: string) =>
    act(() => fetch(`/api/admin/announcements/${id}`, { method: "DELETE" }));

  return (
    <>
      {/* Header bar */}
      <div className="relative flex items-center justify-between pl-3 pr-5 h-[52px] shrink-0 border-b border-border-secondary gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AdminSidebarToggle />
          <span className="text-[13px] text-text-primary font-medium ml-1">Announcements</span>
          <span className="text-[12px] text-text-tertiary">
            {items.length.toLocaleString()} total
          </span>
        </div>
        <button
          onClick={() => setEditor({ mode: "create" })}
          className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={13} />
          New announcement
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-3 px-4 py-3 rounded-[8px] bg-accent-yellow-bg text-[13px] text-text-primary">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-8">
        {loading ? (
          <div className="text-center text-[12px] text-text-tertiary">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <h3 className="text-[15px] font-medium text-text-primary mb-1">No announcements yet</h3>
            <p className="text-[12px] text-text-tertiary mb-5">
              Publish a notice all signed-in users will see at the top of their drive.
            </p>
            <button
              onClick={() => setEditor({ mode: "create" })}
              className="flex items-center gap-1.5 h-[34px] px-4 rounded-[8px] text-[13px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} />
              Create your first one
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {items.map((a) => {
              const status = statusOf(a);
              const sev = severityStyle[a.severity];
              return (
                <div
                  key={a.id}
                  className="rounded-[12px] border border-border-secondary bg-bg-l2 p-5 flex flex-col"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-[7px] h-[7px] rounded-full"
                        style={{ background: sev.dot }}
                      />
                      <span
                        className={`inline-block px-2 py-0.5 rounded-[4px] text-[10px] font-mono uppercase tracking-wider ${sev.bg} ${sev.text}`}
                      >
                        {a.severity}
                      </span>
                      <span
                        className="text-[10px] font-mono uppercase tracking-wider"
                        style={{ color: status.color }}
                      >
                        {status.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditor({ mode: "edit", item: a })}
                        disabled={busy}
                        className="p-1.5 rounded-md text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
                        title="Edit"
                      >
                        <HugeiconsIcon icon={PencilEdit01Icon} size={13} />
                      </button>
                      <button
                        onClick={() => togglePublish(a)}
                        disabled={busy}
                        className="p-1.5 rounded-md text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
                        title={a.published_at ? "Unpublish" : "Publish"}
                      >
                        <HugeiconsIcon
                          icon={a.published_at ? StopCircleIcon : PlayCircleIcon}
                          size={14}
                        />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Delete this announcement?")) remove(a.id);
                        }}
                        disabled={busy}
                        className="p-1.5 rounded-md text-icon-tertiary hover:text-accent-red hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
                        title="Delete"
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={13} />
                      </button>
                    </div>
                  </div>

                  <h3 className="text-[14px] font-semibold text-text-primary mb-1">{a.title}</h3>
                  <p className="text-[13px] text-text-secondary whitespace-pre-wrap break-words mb-4 flex-1">
                    {a.body}
                  </p>

                  <div className="text-[11px] text-text-tertiary flex flex-wrap gap-x-4 gap-y-1 pt-3 border-t border-border-tertiary">
                    {a.published_at ? (
                      <span>Published {formatRelative(a.published_at)}</span>
                    ) : (
                      <span>Created {formatRelative(a.created_at)}</span>
                    )}
                    {a.expires_at && <span>Expires {formatRelative(a.expires_at)}</span>}
                    {a.created_by_email && <span>by {a.created_by_email}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editor && (
        <EditorModal
          existing={editor.mode === "edit" ? editor.item : null}
          busy={busy}
          onCancel={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            load();
          }}
        />
      )}
    </>
  );
}

function EditorModal({
  existing,
  busy,
  onCancel,
  onSaved,
}: {
  existing: Announcement | null;
  busy: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [severity, setSeverity] = useState<Severity>(existing?.severity ?? "info");
  // `datetime-local` input format: YYYY-MM-DDTHH:mm. Convert from ISO.
  const [expiresLocal, setExpiresLocal] = useState(
    existing?.expires_at ? existing.expires_at.slice(0, 16) : ""
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (publish: boolean) => {
    setSaving(true);
    setErr(null);
    try {
      const expiresAt = expiresLocal ? new Date(expiresLocal).toISOString() : null;
      const payload = { title: title.trim(), body: body.trim(), severity, expiresAt, publish };
      const res = existing
        ? await fetch(`/api/admin/announcements/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/announcements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const isValid = title.trim().length > 0 && body.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-[14px] border border-border-primary bg-bg-l2 p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold text-text-primary">
            {existing ? "Edit announcement" : "New announcement"}
          </h2>
          <button
            onClick={onCancel}
            className="p-1 rounded-md text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </button>
        </div>

        {err && (
          <div className="mb-3 px-3 py-2 rounded-[8px] bg-accent-red/12 text-[12px] text-accent-red">
            {err}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="e.g. Scheduled maintenance tonight"
              className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Shown to every user at the top of the drive until they dismiss it."
              className="w-full px-3 py-2 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
                Severity
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                className="w-full h-[34px] px-2 rounded-[8px] bg-bg-field text-[13px] text-text-primary border border-transparent focus:border-border-primary focus:outline-none cursor-pointer"
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
                Expires (optional)
              </label>
              <input
                type="datetime-local"
                value={expiresLocal}
                onChange={(e) => setExpiresLocal(e.target.value)}
                className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary border border-transparent focus:border-border-primary focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={saving || busy}
            className="h-[34px] px-4 rounded-[8px] text-[13px] text-text-secondary hover:bg-cta-secondary-hover transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => save(false)}
            disabled={saving || busy || !isValid}
            className="h-[34px] px-4 rounded-[8px] text-[13px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            {existing?.published_at ? "Unpublish & save" : "Save draft"}
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving || busy || !isValid}
            className="h-[34px] px-4 rounded-[8px] text-[13px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
          >
            {existing?.published_at ? "Save" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
