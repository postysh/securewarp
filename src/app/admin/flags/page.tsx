"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminSidebarToggle } from "../layout";

type Flag = {
  key: string;
  type: "bool" | "unknown";
  value: boolean | string;
  defaultValue: boolean | null;
  description: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
};

function formatRelative(iso: string | null): string {
  if (!iso) return "never changed";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminFlagsPage() {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/flags");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setFlags(data.flags ?? []);
    } catch {
      setError("Failed to load flags");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (flag: Flag) => {
    if (flag.type !== "bool") return;
    const nextValue = !(flag.value === true);
    setBusyKey(flag.key);
    setError(null);
    try {
      const res = await fetch(`/api/admin/flags/${encodeURIComponent(flag.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: nextValue }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <>
      {/* Header bar */}
      <div className="relative flex items-center pl-3 pr-5 h-[52px] shrink-0 border-b border-border-secondary gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AdminSidebarToggle />
          <span className="text-[13px] text-text-primary font-medium ml-1">Feature flags</span>
          <span className="text-[12px] text-text-tertiary">
            Toggle without a deploy
          </span>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 px-4 py-3 rounded-[8px] bg-accent-yellow-bg text-[13px] text-text-primary">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 md:px-8 py-8">
        {!flags ? (
          <div className="text-center text-[12px] text-text-tertiary">Loading…</div>
        ) : flags.length === 0 ? (
          <div className="text-center text-[13px] text-text-tertiary py-16">
            No flags configured.
          </div>
        ) : (
          <div className="space-y-3 max-w-[760px]">
            {flags.map((f) => (
              <div
                key={f.key}
                className="rounded-[12px] border border-border-secondary bg-bg-l2 p-5 flex items-start gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <code className="text-[13px] font-mono text-text-primary font-semibold">
                      {f.key}
                    </code>
                    {f.defaultValue !== null && f.value !== f.defaultValue && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-accent-yellow bg-accent-yellow-bg px-1.5 py-0.5 rounded-[4px]">
                        Overridden
                      </span>
                    )}
                    {f.type === "unknown" && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-text-disabled bg-bg-field px-1.5 py-0.5 rounded-[4px]">
                        Unknown
                      </span>
                    )}
                  </div>
                  {f.description && (
                    <p className="text-[12px] text-text-secondary leading-relaxed mb-2">
                      {f.description}
                    </p>
                  )}
                  <div className="text-[11px] text-text-tertiary flex flex-wrap gap-x-3 gap-y-0.5">
                    {f.defaultValue !== null && (
                      <span>
                        Default: <span className="font-mono">{String(f.defaultValue)}</span>
                      </span>
                    )}
                    {f.updatedAt && (
                      <span>Updated {formatRelative(f.updatedAt)}</span>
                    )}
                    {f.updatedByEmail && <span>by {f.updatedByEmail}</span>}
                  </div>
                </div>

                {/* Toggle */}
                {f.type === "bool" ? (
                  <ToggleSwitch
                    checked={f.value === true}
                    disabled={busyKey === f.key}
                    onChange={() => toggle(f)}
                  />
                ) : (
                  <div className="text-[12px] font-mono text-text-tertiary shrink-0">
                    {String(f.value)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      className={`relative shrink-0 w-[44px] h-[24px] rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
        checked ? "bg-accent-green" : "bg-bg-field"
      }`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-[20px] h-[20px] rounded-full bg-white transition-transform ${
          checked ? "translate-x-[20px]" : "translate-x-0"
        }`}
        style={{ boxShadow: "var(--shadow-l1)" }}
      />
    </button>
  );
}
