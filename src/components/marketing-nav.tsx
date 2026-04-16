"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Decrypt-style reveal for the SECUREWARP logo. Each slot starts as
 * `*`, cycles through random glyphs briefly, then locks to the real
 * letter left-to-right. Monospace + tabular-nums keeps every slot
 * the same pixel width so the nav pill doesn't jitter.
 *
 * After the reveal completes the logo becomes a button that
 * smooth-scrolls to the top and clears any `#hash` from the URL so
 * refreshing the page doesn't jump back to the last anchor.
 */
function LogoReveal({ text }: { text: string }) {
  const [display, setDisplay] = useState<string[]>(() => text.split("").map(() => "*"));
  const [revealed, setRevealed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const FRAME_MS = 40;
    const REVEAL_DELAY = 110;
    const CYCLES_PER_SLOT = 5;
    const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ*/#@!$%&+<>?";

    let cancelled = false;
    const slots = text.split("");
    const locked = slots.map(() => false);
    const current = slots.map(() => "*");
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
      if (locked.every(Boolean)) {
        clearInterval(timer);
        setRevealed(true);
      }
    }, FRAME_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [text]);

  const handleClick = () => {
    if (typeof window === "undefined") return;
    // Off the landing page, the logo should take users home. When
    // already on the landing, scroll to the top and clear any
    // anchor hash so a refresh doesn't jump back down.
    if (pathname !== "/") {
      router.push("/");
      return;
    }
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!revealed}
      aria-label={
        revealed
          ? pathname === "/"
            ? `${text}. Scroll to top`
            : `${text}. Home`
          : text
      }
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        color: "inherit",
        font: "inherit",
        cursor: revealed ? "pointer" : "default",
        fontFamily: "var(--font-geist-mono), monospace",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: 1,
      }}
    >
      {display.join("")}
    </button>
  );
}

/**
 * Floating nav pill used on every marketing page (landing, about).
 * `current` highlights the matching link so users know where they
 * are. Features/Support always anchor back to landing because those
 * sections live on /.
 */
export function MarketingNav({ current }: { current?: "about" | "features" | "support" } = {}) {
  const linkStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px",
    fontSize: 14,
    color: active ? "white" : "rgba(255,255,255,0.7)",
    textDecoration: "none",
    fontWeight: active ? 500 : 400,
  });

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        top: 20,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 0,
        background: "rgba(30,30,30,0.95)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderRadius: 12,
        padding: "6px 6px 6px 10px",
        zIndex: 99999,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px 8px 6px", fontSize: 14, fontWeight: 600, color: "white", letterSpacing: 0.5 }}>
        <LogoReveal text="SECUREWARP" />
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-geist-mono), monospace",
            fontWeight: 600,
            letterSpacing: 1.5,
            color: "rgba(110,210,170,0.95)",
            background: "rgba(110,210,170,0.12)",
            border: "1px solid rgba(110,210,170,0.25)",
            padding: "2px 6px",
            borderRadius: 4,
            lineHeight: 1,
          }}
          aria-label="Beta product"
        >
          BETA
        </span>
      </span>
      <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)" }} />
      <Link href="/about" style={linkStyle(current === "about")}>About</Link>
      <Link href="/#features" style={linkStyle(current === "features")}>Features</Link>
      <Link href="/support" style={linkStyle(current === "support")}>Support</Link>
      <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />
      <Link href="/login" style={{ padding: "8px 14px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Log in</Link>
      <Link href="/signup" style={{ padding: "8px 14px", fontSize: 14, fontWeight: 500, color: "#111", background: "white", borderRadius: 8, textDecoration: "none" }}>Get Started</Link>
    </div>
  );
}
