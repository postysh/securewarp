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

type Category = "feature" | "improvement" | "fix" | "security";

type ChangelogEntry = {
  id: string;
  created_at: string;
  updated_at: string;
  created_by_email: string | null;
  title: string;
  body: string;
  category: Category;
  published_at: string | null;
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

function statusOf(e: ChangelogEntry): { label: string; color: string } {
  if (!e.published_at) return { label: "Draft", color: "var(--text-tertiary)" };
  return { label: "Live", color: "var(--accent-green-primary)" };
}

const categoryStyle: Record<Category, { bg: string; text: string; dot: string }> = {
  feature: { bg: "bg-bg-field", text: "text-text-secondary", dot: "var(--accent-blue-primary)" },
  improvement: {
    bg: "bg-accent-yellow-bg",
    text: "text-accent-yellow",
    dot: "var(--accent-yellow-primary)",
  },
  fix: { bg: "bg-bg-field", text: "text-text-secondary", dot: "var(--accent-green-primary)" },
  security: {
    bg: "bg-accent-red/12",
    text: "text-accent-red",
    dot: "var(--accent-red-primary)",
  },
};

export default function AdminChangelogPage() {
  const [items, setItems] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<
    { mode: "create" } | { mode: "edit"; item: ChangelogEntry } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/changelog");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setItems(data.entries ?? []);
    } catch {
      setError("Failed to load changelog");
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

  const togglePublish = (e: ChangelogEntry) =>
    act(() =>
      fetch(`/api/admin/changelog/${e.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish: !e.published_at }),
      })
    );

  const remove = (id: string) =>
    act(() => fetch(`/api/admin/changelog/${id}`, { method: "DELETE" }));

  return (
    <>
      <div className="relative flex items-center justify-between pl-3 pr-5 h-[52px] shrink-0 border-b border-border-secondary gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AdminSidebarToggle />
          <span className="text-[13px] text-text-primary font-medium ml-1">Changelog</span>
          <span className="text-[12px] text-text-tertiary">
            {items.length.toLocaleString()} total
          </span>
        </div>
        <button
          onClick={() => setEditor({ mode: "create" })}
          className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={13} />
          New entry
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
            <h3 className="text-[15px] font-medium text-text-primary mb-1">No entries yet</h3>
            <p className="text-[12px] text-text-tertiary mb-5">
              Publish notes about new features, improvements, fixes, and security updates.
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
          <>
            <div className="hidden md:flex items-center h-[40px] px-4 box-border select-none shrink-0 border-b border-border-tertiary">
              <div className="w-[110px] shrink-0">
                <span className="text-[11px] font-mono uppercase text-text-disabled">Category</span>
              </div>
              <div className="flex-1 min-w-0 pr-4">
                <span className="text-[11px] font-mono uppercase text-text-disabled">Title</span>
              </div>
              <div className="flex items-center gap-[46px]">
                <div className="w-[80px] flex justify-end">
                  <span className="text-[11px] font-mono uppercase text-text-disabled">Status</span>
                </div>
                <div className="w-[110px] hidden lg:flex justify-end">
                  <span className="text-[11px] font-mono uppercase text-text-disabled">
                    Published
                  </span>
                </div>
              </div>
            </div>

            <div className="py-1">
              {items.map((e) => {
                const status = statusOf(e);
                const cat = categoryStyle[e.category];
                return (
                  <div
                    key={e.id}
                    className="group relative flex items-center h-[52px] px-4 rounded-[8px] transition-colors hover:bg-bg-cell-hover"
                  >
                    <button
                      onClick={() => setEditor({ mode: "edit", item: e })}
                      className="absolute inset-0 rounded-[8px] focus:outline-none focus:ring-2 focus:ring-text-link/50 cursor-pointer"
                      aria-label={`Edit ${e.title}`}
                    />

                    <div className="w-[110px] shrink-0 flex items-center gap-2 relative pointer-events-none">
                      <span
                        className="w-[7px] h-[7px] rounded-full shrink-0"
                        style={{ background: cat.dot }}
                      />
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded-[4px] text-[10px] font-mono uppercase tracking-wider ${cat.bg} ${cat.text}`}
                      >
                        {e.category}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0 pr-4 relative pointer-events-none">
                      <div className="text-[13px] text-text-primary font-medium truncate">
                        {e.title}
                      </div>
                      <div className="text-[11px] text-text-tertiary truncate" title={e.body}>
                        {e.body}
                      </div>
                    </div>

                    <div className="hidden md:flex items-center gap-[46px] relative pointer-events-none">
                      <div className="w-[80px] flex justify-end">
                        <span
                          className="text-[11px] font-mono uppercase tracking-wider"
                          style={{ color: status.color }}
                        >
                          {status.label}
                        </span>
                      </div>
                      <div className="w-[110px] hidden lg:flex justify-end transition-opacity group-hover:opacity-0">
                        <span className="text-[12px] text-text-disabled">
                          {formatRelative(e.published_at ?? e.created_at)}
                        </span>
                      </div>

                      <div
                        className="absolute right-0 flex items-center transition-opacity opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setEditor({ mode: "edit", item: e });
                          }}
                          disabled={busy}
                          className="p-1.5 rounded-md text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
                          title="Edit"
                        >
                          <HugeiconsIcon icon={PencilEdit01Icon} size={13} />
                        </button>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            togglePublish(e);
                          }}
                          disabled={busy}
                          className="p-1.5 rounded-md text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
                          title={e.published_at ? "Unpublish" : "Publish"}
                        >
                          <HugeiconsIcon
                            icon={e.published_at ? StopCircleIcon : PlayCircleIcon}
                            size={14}
                          />
                        </button>
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            if (confirm("Delete this entry?")) remove(e.id);
                          }}
                          disabled={busy}
                          className="p-1.5 rounded-md text-icon-tertiary hover:text-accent-red hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
                          title="Delete"
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
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
  existing: ChangelogEntry | null;
  busy: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [category, setCategory] = useState<Category>(existing?.category ?? "feature");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (publish: boolean) => {
    setSaving(true);
    setErr(null);
    try {
      const payload = { title: title.trim(), body: body.trim(), category, publish };
      const res = existing
        ? await fetch(`/api/admin/changelog/${existing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin/changelog", {
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
        className="w-full max-w-[560px] rounded-[14px] border border-border-primary bg-bg-l2 p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold text-text-primary">
            {existing ? "Edit changelog entry" : "New changelog entry"}
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
              maxLength={140}
              placeholder="e.g. Folder rotation on revoke"
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
              rows={8}
              maxLength={8000}
              placeholder="Plain text. Line breaks are preserved on the public page. One paragraph per change reads best."
              className="w-full px-3 py-2 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none resize-none"
            />
            <div className="mt-1 text-[10px] text-text-disabled font-mono uppercase tracking-wider text-right">
              {body.length}/8000
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="w-full h-[34px] px-2 rounded-[8px] bg-bg-field text-[13px] text-text-primary border border-transparent focus:border-border-primary focus:outline-none cursor-pointer"
            >
              <option value="feature">Feature</option>
              <option value="improvement">Improvement</option>
              <option value="fix">Fix</option>
              <option value="security">Security</option>
            </select>
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
