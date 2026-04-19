"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

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
 * App-level 404. Big display digits scramble through random glyphs
 * and lock in left to right, echoing the decrypt-reveal animation
 * on the home page's SECUREWARP logo. Below that, the URL the user
 * was trying to reach is rendered as ciphertext with a red
 * "[not found]" stamp — the same "server can't read" motif the
 * hero visual leans on, flipped for error context.
 */
export default function NotFound() {
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
          Error 404
        </p>

        <ScrambledDigits target="404" />

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
          Page not <span style={{ color: GREEN }}>found</span>.
        </h1>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: TEXT_MUTED,
            margin: "0 auto 28px",
            maxWidth: 520,
            fontFamily: BRAND_SANS,
            textWrap: "pretty",
          }}
        >
          The page you&apos;re after doesn&apos;t exist or has moved. Maybe you
          followed a stale link, or the URL got mangled along the way.
        </p>

        <RequestedPathStamp />

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
              background: GREEN,
              color: "white",
              textDecoration: "none",
            }}
          >
            Back to home
          </Link>
          <Link
            href="/support"
            style={{
              fontSize: 13,
              color: TEXT_MUTED,
              textDecoration: "none",
              fontFamily: BRAND_SANS,
            }}
          >
            Contact support →
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}

/**
 * Big "404" where each digit cycles through random characters and
 * locks to its real value left-to-right. Same frame loop as the
 * LogoReveal in marketing-shell; shorter CYCLES_PER_SLOT so the
 * reveal finishes in under a second.
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
            // Tint the middle character orange so the eye lands on
            // the shape of the number, not a flat colour wall.
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

/**
 * Shows the pathname the user tried to reach as monospace
 * "ciphertext" with a `[not found]` stamp — echoes the server
 * sees / you see framing from the hero cipher cascade.
 */
function RequestedPathStamp() {
  const pathname = usePathname();
  const displayPath = pathname || "/";

  return (
    <div
      style={{
        maxWidth: 520,
        width: "100%",
        padding: "14px 18px",
        borderRadius: 10,
        background: "rgba(0,0,0,0.02)",
        border: `1px solid ${BORDER}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: BRAND_MONO,
        fontSize: 12,
        color: TEXT_MUTED,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: TEXT_MUTED,
          flexShrink: 0,
        }}
      >
        Requested
      </span>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: TEXT,
          textAlign: "left",
        }}
      >
        {displayPath}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: GREEN,
          background: "rgba(239,90,60,0.1)",
          border: "1px solid rgba(239,90,60,0.25)",
          padding: "3px 8px",
          borderRadius: 999,
          flexShrink: 0,
        }}
      >
        Not found
      </span>
    </div>
  );
}
