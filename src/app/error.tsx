"use client";

import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";

import {
  MarketingShell,
  TEXT,
  TEXT_MUTED,
  BORDER,
  GREEN,
  BRAND_SANS,
  BRAND_MONO,
} from "@/components/marketing-shell";

/**
 * Route-level error boundary. Fires when a page or its descendants
 * throw at render time after the root layout has already mounted —
 * so we can still use the full MarketingShell (header / rules /
 * footer) and add the same scramble-reveal flourish that the 404
 * uses. Captures the error to Sentry and surfaces a reset button
 * that re-renders the segment. Global crashes that happen before
 * the layout mounts fall through to `global-error.tsx`.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <MarketingShell>
      <section
        style={{
          padding: "120px 32px 96px",
          textAlign: "center",
          minHeight: "calc(100vh - 56px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
            margin: "0 0 24px",
          }}
        >
          Something broke
        </p>

        <ScrambledDigits target="500" />

        <h1
          style={{
            marginTop: 24,
            fontSize: "clamp(1.75rem, 3vw, 2.25rem)",
            lineHeight: 1.1,
            color: TEXT,
            fontFamily: BRAND_SANS,
            fontWeight: 400,
            letterSpacing: -0.8,
            margin: "24px 0 16px",
          }}
        >
          That didn&apos;t go as{" "}
          <span style={{ color: GREEN }}>planned</span>.
        </h1>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: TEXT_MUTED,
            margin: "0 auto 12px",
            maxWidth: 520,
            fontFamily: BRAND_SANS,
            textWrap: "pretty",
          }}
        >
          The page hit an unexpected error. A report has been sent to our team
          automatically. You can try again or head back home.
        </p>
        {error.digest && (
          <p
            style={{
              fontSize: 11,
              color: TEXT_MUTED,
              fontFamily: BRAND_MONO,
              letterSpacing: "0.08em",
              margin: 0,
            }}
          >
            ref {error.digest}
          </p>
        )}

        <div
          style={{
            marginTop: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => reset()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontFamily: BRAND_MONO,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 12,
              background: GREEN,
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontFamily: BRAND_MONO,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 12,
              background: "none",
              color: TEXT,
              border: `1px solid ${BORDER}`,
              textDecoration: "none",
            }}
          >
            Back to home
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}

/**
 * Shared scramble-reveal display. Duplicates the helper in
 * `not-found.tsx` — these two files live next to each other and
 * extracting it to a shared client component is more moving parts
 * than the 30 lines are worth.
 */
function ScrambledDigits({ target }: { target: string }) {
  const [display, setDisplay] = useState<string[]>(() =>
    target.split("").map(() => "#"),
  );

  useEffect(() => {
    const FRAME_MS = 45;
    const REVEAL_DELAY = 160;
    const CYCLES_PER_SLOT = 8;
    const GLYPHS = "0123456789ABCDEF#*@!$%&+<>?/";

    let cancelled = false;
    const slots = target.split("");
    const locked = slots.map(() => false);
    const current = slots.map(() => "#");
    let tick = 0;

    const timer = setInterval(() => {
      if (cancelled) return;
      tick++;
      for (let i = 0; i < slots.length; i++) {
        if (locked[i]) continue;
        const startTick = Math.floor((i * REVEAL_DELAY) / FRAME_MS);
        if (tick < startTick) continue;
        const elapsed = tick - startTick;
        if (elapsed >= CYCLES_PER_SLOT) {
          current[i] = slots[i];
          locked[i] = true;
        } else {
          current[i] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
      }
      setDisplay([...current]);
      if (locked.every(Boolean)) clearInterval(timer);
    }, FRAME_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [target]);

  return (
    <div
      aria-label={`Error ${target}`}
      style={{
        fontFamily: BRAND_MONO,
        fontVariantNumeric: "tabular-nums",
        fontSize: "clamp(6rem, 18vw, 12rem)",
        lineHeight: 0.9,
        fontWeight: 700,
        color: TEXT,
        letterSpacing: "-0.04em",
        display: "inline-flex",
      }}
    >
      {display.map((ch, i) => (
        <span
          key={i}
          style={{
            color: i === 1 ? GREEN : TEXT,
            width: "0.75em",
            textAlign: "center",
          }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}
