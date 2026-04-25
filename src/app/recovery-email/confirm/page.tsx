"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import { BrandMark } from "@/components/brand-mark";

/**
 * Recovery-email confirm landing page. The setup email points here
 * with `?ct=<confirmToken>` in the query string. We POST that token
 * to /api/auth/recovery-email/confirm exactly once and show
 * success/expired feedback. The recovery token (the OTHER token in
 * the email) lives in the email's URL fragment for /recover —
 * never sent here, never stored on this page.
 *
 * Page-level export wraps the inner component in `<Suspense>`
 * because `useSearchParams()` triggers a client-side bailout
 * during prerender; without a boundary Next refuses to
 * statically render the route at all.
 */
export default function RecoveryEmailConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg-side" />}>
      <ConfirmInner />
    </Suspense>
  );
}

function ConfirmInner() {
  const params = useSearchParams();
  const ct = params?.get("ct") ?? "";
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ct) {
        if (cancelled) return;
        setErr("This link is missing its confirmation token.");
        setState("fail");
        return;
      }
      try {
        const res = await fetch("/api/auth/recovery-email/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmToken: ct }),
        });
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setErr(data.error || "Confirmation failed.");
          setState("fail");
        } else {
          setState("ok");
        }
      } catch {
        if (cancelled) return;
        setErr("Confirmation failed.");
        setState("fail");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ct]);

  return (
    <div className="min-h-screen flex flex-col bg-bg-side">
      <header className="flex items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="no-underline text-text-primary text-[13px] font-semibold tracking-[1px] hover:opacity-80 transition-opacity flex items-center gap-1"
          style={{ fontFamily: "var(--font-geist-mono), monospace" }}
        >
          <BrandMark size={40} />
          SECUREWARP
        </Link>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 pb-10">
        <div className="w-full max-w-[440px]">
          <div
            className="rounded-2xl border border-border-tertiary bg-bg-l3 p-7"
            style={{ boxShadow: "var(--shadow-l2)" }}
          >
            {state === "loading" && (
              <p className="text-[12px] font-mono uppercase tracking-[0.18em] text-text-tertiary text-center py-8">
                Confirming…
              </p>
            )}

            {state === "ok" && (
              <div>
                <div className="w-12 h-12 rounded-xl bg-accent-green/10 border border-accent-green/30 flex items-center justify-center mb-4">
                  <HugeiconsIcon
                    icon={Tick01Icon}
                    size={22}
                    color="var(--accent-green-primary)"
                  />
                </div>
                <h1 className="text-[20px] font-semibold text-text-primary mb-2 tracking-[-0.01em]">
                  Backup recovery activated
                </h1>
                <p className="text-[13px] text-text-tertiary leading-relaxed mb-2">
                  Your backup email is now live. If you lose your password and your 24 word phrase,
                  the URL in the email we just sent is the only other way back in.
                </p>
                <p className="text-[13px] text-text-primary leading-relaxed mb-6">
                  Save that email somewhere you won&apos;t lose it.
                </p>
                <Link
                  href="/drive"
                  className="inline-flex items-center justify-center px-5 h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer no-underline"
                >
                  Open your drive
                </Link>
              </div>
            )}

            {state === "fail" && (
              <div>
                <div className="w-12 h-12 rounded-xl bg-accent-red/10 border border-accent-red/30 flex items-center justify-center mb-4">
                  <HugeiconsIcon
                    icon={AlertCircleIcon}
                    size={22}
                    color="var(--accent-red-primary)"
                  />
                </div>
                <h1 className="text-[20px] font-semibold text-text-primary mb-2 tracking-[-0.01em]">
                  Couldn&apos;t confirm
                </h1>
                <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
                  {err ?? "This link has expired or already been used."}
                </p>
                <Link
                  href="/drive"
                  className="inline-flex items-center justify-center px-5 h-[40px] rounded-[10px] border border-border-secondary text-text-primary text-[13px] font-medium hover:bg-cta-secondary-hover transition-colors cursor-pointer no-underline"
                >
                  Go to drive
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
