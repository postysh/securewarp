"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "./brand-mark";

/**
 * Shared shell for every / page — layout wrapper + sticky
 * header + footer + section dividers + design tokens. Keeps the
 * mockup pages (landing, privacy, etc.) in lockstep without
 * duplicating ~500 lines of chrome per page.
 *
 * Token block is intentionally colocated so any page can import
 * BG / TEXT / BORDER / GREEN / etc. without reaching back into
 * a parent route file.
 */

// ─── Tokens ────────────────────────────────────────────────────
export const BG = "#faf8f4";
export const TEXT = "#0a0a0a";
// Muted text + border eased a tick lighter than the canonical
// 0.55 / 0.08 values to raise the overall page luminance and
// close the gap with Gately's reference.
export const TEXT_MUTED = "rgba(0,0,0,0.5)";
export const BORDER = "rgba(0,0,0,0.06)";
// Named GREEN for legacy reasons — actually the warm orange from
// --text-link (the Sign up link colour on the auth page). Swapped
// from the original #04a45c brand green per the mockup experiment.
export const GREEN = "rgb(239,90,60)";
// Chillax is our brand sans — used everywhere on the mockup now
// that the Iceland/Doto/Fraunces experiments are retired. MONO
// stays on Geist Mono for eyebrows + small UI labels. SERIF + LOGO
// alias BRAND_SANS so the three-token API still works for any
// imports that reference them.
const CHILLAX_STACK =
  "var(--font-chillax), var(--font-geist-sans), system-ui, sans-serif";
export const BRAND_SANS = CHILLAX_STACK;
export const BRAND_MONO = "var(--font-geist-mono), ui-monospace, monospace";
export const BRAND_SERIF = CHILLAX_STACK;
export const BRAND_LOGO = CHILLAX_STACK;

// ─── Layout wrapper ────────────────────────────────────────────
/**
 * Full-page shell: cream `<main>` + centred 1200px body column with
 * the two vertical rules, the sticky `HeaderBar` pinned to the top
 * of the column, and the `MockupFooter` pinned to the bottom. Any
 * page content (sections, divs) passes through `children` and
 * renders inside the body column between them.
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    // Outer `<main>` paints cream in the side gutters — anywhere
    // outside the 1200px body column. The body column itself sits
    // on a pure-white fill so the content area reads cleaner while
    // the gutters keep Gately's warm-cream surround.
    <main style={{ background: BG, minHeight: "100vh", color: TEXT }}>
      <div
        style={{
          width: "100%",
          maxWidth: 1200,
          margin: "0 auto",
          borderLeft: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          minHeight: "100vh",
          background: "#ffffff",
        }}
      >
        <HeaderBar />
        {children}
        <DotDivider />
        <MockupFooter />
      </div>
    </main>
  );
}

// ─── Sticky header ─────────────────────────────────────────────
/**
 * Decrypt-reveal of the SECUREWARP wordmark — lifted from the
 * landing marketing nav so the mockup's logo is visually identical.
 * Each slot cycles through random glyphs, then locks in left to
 * right. Clicking after reveal scrolls to top (or navigates to
 * / if on a different page).
 */
function LogoReveal({ text }: { text: string }) {
  const [display, setDisplay] = useState<string[]>(() =>
    text.split("").map(() => "*"),
  );
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
    if (pathname !== "/") {
      router.push("/");
      return;
    }
    if (window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!revealed}
      aria-label={revealed ? `${text}. Scroll to top` : text}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        color: "inherit",
        font: "inherit",
        cursor: revealed ? "pointer" : "default",
        // Doto here only — novelty dot-matrix face is limited to
        // the logo wordmark so it doesn't impact body legibility.
        fontFamily: BRAND_LOGO,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: 1,
      }}
    >
      {display.join("")}
    </button>
  );
}

export function HeaderBar() {
  const linkStyle: React.CSSProperties = {
    padding: "8px 16px",
    fontSize: 11,
    color: TEXT,
    textDecoration: "none",
    fontWeight: 500,
    fontFamily: BRAND_MONO,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    borderRadius: 8,
    // Base border + transition live on inline `style` so they're
    // present in the SSR'd HTML — otherwise the styled-jsx `:hover`
    // rule animates in from "no border" on first paint and flashes.
    // `:hover` / `:active` CSS below uses `!important` to override
    // the inline `border-color: transparent`.
    border: "1px solid transparent",
    transition: "border-color 160ms ease, background-color 160ms ease",
  };

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        borderBottom: `1px solid ${BORDER}`,
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
      }}
    >
      <div
        style={{
          padding: "0 24px",
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: TEXT,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: BRAND_MONO,
          }}
        >
          <BrandMark size={72} />
          <LogoReveal text="SECUREWARP" />
          <span
            style={{
              fontSize: 9,
              fontFamily: BRAND_MONO,
              fontWeight: 600,
              letterSpacing: "0.1em",
              color: GREEN,
              background: "rgba(239,90,60,0.1)",
              border: "1px solid rgba(239,90,60,0.25)",
              padding: "2px 6px",
              borderRadius: 4,
              lineHeight: 1,
            }}
            aria-label="Beta product"
          >
            BETA
          </span>
        </div>
        <nav
          className="nav-bar"
          style={{ display: "flex", alignItems: "center", gap: 0 }}
        >
          <Link href="/about" className="nav-link" style={linkStyle}>
            About
          </Link>
          <Link href="/features" className="nav-link" style={linkStyle}>
            Features
          </Link>
          <Link href="/pricing" className="nav-link" style={linkStyle}>
            Pricing
          </Link>
          <Link href="/support" className="nav-link" style={linkStyle}>
            Support
          </Link>
        </nav>
        <style jsx global>{`
          .nav-bar .nav-link:hover {
            border-color: ${BORDER} !important;
          }
          .nav-bar .nav-link:active {
            border-color: rgba(0, 0, 0, 0.14) !important;
            background-color: rgba(0, 0, 0, 0.02);
          }
        `}</style>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            justifyContent: "flex-end",
          }}
        >
          <Link
            href="/login"
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "6px 14px",
              color: TEXT,
              textDecoration: "none",
              fontFamily: BRAND_MONO,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
            }}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "6px 14px",
              borderRadius: 8,
              background: GREEN,
              color: "white",
              textDecoration: "none",
              fontFamily: BRAND_MONO,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

// ─── Section divider ───────────────────────────────────────────
/**
 * Dot-grid strip used as a section divider. Renders a 24×24 dot
 * pattern with a 1px hairline top and bottom. Height defaults to
 * 72px (~3 rows of dots).
 */
export function DotDivider({ height = 72 }: { height?: number }) {
  return (
    <div
      aria-hidden
      style={{
        height,
        borderTop: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='1' fill='%23000' fill-opacity='0.1'/></svg>\")",
        backgroundSize: "24px 24px",
      }}
    />
  );
}

// ─── Footer ────────────────────────────────────────────────────
export function MockupFooter() {
  const cols: Array<{
    heading: string;
    links: Array<{ label: string; href: string; soon?: boolean }>;
  }> = [
    {
      heading: "Product",
      links: [
        { label: "Features", href: "/features" },
        { label: "Pricing", href: "/pricing" },
        { label: "Changelog", href: "#", soon: true },
        { label: "Roadmap", href: "#", soon: true },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Support", href: "/support" },
        { label: "X", href: "https://x.com/Securewarp" },
      ],
    },
    {
      heading: "Legal",
      links: [
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
        { label: "Refunds", href: "/refund" },
      ],
    },
  ];

  return (
    <footer style={{ padding: "48px 32px" }}>
      <div
        className="mockup-footer-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 40,
        }}
      >
        <div className="mockup-footer-brand">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <BrandMark size={52} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: TEXT,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontFamily: BRAND_MONO,
              }}
            >
              Securewarp
            </span>
            <span
              style={{
                fontSize: 9,
                fontFamily: BRAND_MONO,
                fontWeight: 600,
                letterSpacing: "0.1em",
                color: GREEN,
                background: "rgba(239,90,60,0.1)",
                border: "1px solid rgba(239,90,60,0.25)",
                padding: "2px 6px",
                borderRadius: 4,
                lineHeight: 1,
              }}
            >
              BETA
            </span>
          </div>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: TEXT_MUTED,
              margin: 0,
              maxWidth: 240,
              fontFamily: BRAND_SANS,
            }}
          >
            The cloud drive that can&apos;t read your files. End to end
            encrypted. Zero knowledge by design.
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 18,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: GREEN,
                boxShadow: "0 0 8px rgba(239,90,60,0.5)",
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontFamily: BRAND_MONO,
                color: TEXT_MUTED,
                letterSpacing: "0.04em",
              }}
            >
              All systems operational
            </span>
          </div>
        </div>
        {cols.map((col) => (
          <div key={col.heading}>
            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: TEXT,
                margin: "0 0 16px",
                fontFamily: BRAND_SANS,
              }}
            >
              {col.heading}
            </p>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {col.links.map((l) => {
                const external = /^https?:\/\//.test(l.href);
                return (
                  <li
                    key={l.label}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <Link
                      href={l.href}
                      target={external ? "_blank" : undefined}
                      rel={external ? "noopener noreferrer" : undefined}
                      style={{
                        fontSize: 13,
                        color: TEXT,
                        opacity: l.soon ? 0.4 : 0.6,
                        textDecoration: "none",
                        fontFamily: BRAND_SANS,
                        cursor: l.soon ? "default" : "pointer",
                      }}
                      onClick={l.soon ? (e) => e.preventDefault() : undefined}
                    >
                      {l.label}
                    </Link>
                    {l.soon && <SoonPill />}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 48,
          paddingTop: 24,
          borderTop: `1px solid ${BORDER}`,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <p
          style={{
            fontSize: 12,
            color: TEXT,
            opacity: 0.5,
            margin: 0,
            fontFamily: BRAND_MONO,
          }}
        >
          © {new Date().getFullYear()} SecureWarp. All rights reserved.
        </p>
        {/* Build / status tag. `NEXT_PUBLIC_BUILD_VERSION` is
            injected by next.config.ts at build time (date · short
            git sha), so every deploy automatically shows a unique
            version. Status pill stays "Beta" until the product
            leaves beta. */}
        <p
          style={{
            fontSize: 12,
            margin: 0,
            fontFamily: BRAND_MONO,
            letterSpacing: "0.08em",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: TEXT, opacity: 0.5 }}>
            {process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev"}
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
              padding: "2px 7px",
              borderRadius: 4,
              lineHeight: 1,
            }}
          >
            Beta
          </span>
        </p>
      </div>
      <style jsx>{`
        @media (max-width: 900px) {
          .mockup-footer-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          .mockup-footer-brand {
            grid-column: span 2;
          }
        }
        @media (max-width: 480px) {
          .mockup-footer-grid {
            grid-template-columns: 1fr !important;
          }
          .mockup-footer-brand {
            grid-column: auto;
          }
        }
      `}</style>
    </footer>
  );
}

/**
 * Small muted "Soon" badge rendered next to footer links that
 * aren't live yet (Changelog, Roadmap). Mono uppercase, subtle
 * grey — reads as a state marker rather than a hot CTA.
 */
function SoonPill() {
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: BRAND_MONO,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: TEXT_MUTED,
        background: "rgba(0,0,0,0.04)",
        border: `1px solid ${BORDER}`,
        padding: "2px 6px",
        borderRadius: 4,
        lineHeight: 1,
      }}
    >
      Soon
    </span>
  );
}
