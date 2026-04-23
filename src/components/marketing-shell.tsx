"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Menu01Icon from "@hugeicons/core-free-icons/Menu01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
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
    // Outer `<main>` is all white — both the 1200px body column and
    // the side gutters share a single white fill. The thin borders
    // on the body column are kept as a subtle frame for large
    // viewports; on narrow screens they're edge-to-edge with the
    // viewport so they don't render visibly.
    //
    // `BG` (cream) is still used by specific mockup cards inside
    // page sections (pricing, how-it-works, etc.) as an intentional
    // design accent — those stay untouched.
    <main style={{ background: "#ffffff", minHeight: "100vh", color: TEXT }}>
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
 * Clickable wordmark — renders "SECUREWARP" statically. Previously
 * ran a decrypt-style reveal where each glyph cycled through random
 * characters before locking in; swapped for a static mark paired
 * with the animated brand icon (see AnimatedBrandMark) so the entry
 * animation lives in the graphical logo, not the text.
 *
 * Click → scroll to top on /, or navigate to / from any other page.
 */
function LogoWordmark({ text }: { text: string }) {
  const router = useRouter();
  const pathname = usePathname();

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
      aria-label={`${text}. Scroll to top`}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        color: "inherit",
        font: "inherit",
        cursor: "pointer",
        fontFamily: BRAND_LOGO,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: 1,
      }}
    >
      {text}
    </button>
  );
}

/**
 * Animated brand mark — three-bar chevron icon whose individual bars
 * slide in with staggered delays on mount. The same three paths from
 * /public/logos/mark-w.svg, inlined here so each path can carry its
 * own CSS animation. Bars arrive palest-first (left → right) so the
 * final bright bar locks in last, mirroring the visual hierarchy of
 * the static mark.
 *
 * `prefers-reduced-motion` users get the final state instantly.
 */
function AnimatedBrandMark({ size = 72 }: { size?: number }) {
  // Source viewBox lifted verbatim from mark-w.svg. Trimming the
  // large 375×375 canvas padding via a tight viewBox so the glyph
  // fills the requested size without BrandMark's negative-margin
  // hack.
  return (
    <span
      aria-label="SecureWarp"
      role="img"
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        // Crop the source viewBox padding — the glyph only occupies
        // the centre band of the 375×375 canvas.
        flexShrink: 0,
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="115 140 145 100"
        preserveAspectRatio="xMidYMid meet"
        width={size}
        height={size}
        aria-hidden
      >
        {/* Bar 3 (palest, leftmost). Arrives first. */}
        <path
          className="securewarp-bar securewarp-bar-1"
          fill="#eba587"
          d="M 140.488281 150.132812 L 124.757812 165.859375 C 123.546875 167.070312 123.546875 169.03125 124.757812 170.238281 L 139.875 185.355469 L 163.648438 161.582031 L 152.199219 150.132812 C 148.964844 146.898438 143.722656 146.898438 140.488281 150.132812 Z"
        />
        {/* Bar 2 (mid tone). */}
        <path
          className="securewarp-bar securewarp-bar-2"
          fill="#e18c6e"
          d="M 181.859375 154.964844 L 145.671875 191.152344 L 162.976562 208.457031 L 205.019531 166.410156 L 193.574219 154.964844 C 190.339844 151.726562 185.09375 151.726562 181.859375 154.964844 Z"
        />
        {/* Bar 1 (brightest, rightmost). Locks in last. */}
        <path
          className="securewarp-bar securewarp-bar-3"
          fill="#ef5a3c"
          d="M 228.265625 154.761719 L 168.773438 214.253906 L 180.21875 225.703125 C 183.457031 228.9375 188.699219 228.9375 191.933594 225.703125 L 251.425781 166.210938 L 239.980469 154.761719 C 236.742188 151.527344 231.5 151.527344 228.265625 154.761719 Z"
        />
      </svg>
      <style jsx>{`
        @keyframes securewarp-bar-in {
          from {
            opacity: 0;
            transform: translate(-14px, 8px);
          }
          to {
            opacity: 1;
            transform: translate(0, 0);
          }
        }
        :global(.securewarp-bar) {
          opacity: 0;
          transform-origin: center;
          transform-box: fill-box;
          animation: securewarp-bar-in 420ms cubic-bezier(0.22, 1, 0.36, 1)
            forwards;
        }
        :global(.securewarp-bar-1) {
          animation-delay: 0ms;
        }
        :global(.securewarp-bar-2) {
          animation-delay: 140ms;
        }
        :global(.securewarp-bar-3) {
          animation-delay: 280ms;
        }
        @media (prefers-reduced-motion: reduce) {
          :global(.securewarp-bar) {
            animation: none;
            opacity: 1;
            transform: none;
          }
        }
      `}</style>
    </span>
  );
}

export function HeaderBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close the mobile menu on route change so tapping a link
  // doesn't leave the panel hanging on top of the destination page.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const linkStyle: React.CSSProperties = {
    padding: "6px 12px",
    fontSize: 11,
    color: TEXT,
    textDecoration: "none",
    fontWeight: 500,
    // System monospace (SF Mono on Mac, Consolas on Windows) so the
    // letterforms render tight and condensed rather than Geist Mono's
    // wider geometric shapes.
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    borderRadius: 8,
    border: "1px solid transparent",
    opacity: 0.6,
    transition: "opacity 160ms ease, border-color 160ms ease, background-color 160ms ease",
  };

  const drawerLinkStyle: React.CSSProperties = {
    display: "block",
    padding: "14px 24px",
    fontSize: 13,
    color: TEXT,
    textDecoration: "none",
    fontWeight: 500,
    fontFamily: BRAND_MONO,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    borderBottom: `1px solid ${BORDER}`,
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
          className="header-brand"
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
            minWidth: 0,
          }}
        >
          <AnimatedBrandMark size={72} />
          <LogoWordmark text="SECUREWARP" />
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
          className="nav-bar header-nav-desktop"
          style={{ display: "flex", alignItems: "center", gap: 4 }}
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
        <div
          className="header-ctas"
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
            className="header-login"
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
          <button
            type="button"
            className="header-burger"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="marketing-mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              display: "none",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              padding: 0,
              background: "transparent",
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              color: TEXT,
              cursor: "pointer",
            }}
          >
            <HugeiconsIcon
              icon={menuOpen ? Cancel01Icon : Menu01Icon}
              size={16}
              strokeWidth={1.5}
            />
          </button>
        </div>
      </div>
      {menuOpen && (
        <div
          id="marketing-mobile-nav"
          className="header-mobile-drawer"
          style={{
            borderTop: `1px solid ${BORDER}`,
            background: "rgba(255,255,255,0.95)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
          }}
        >
          <Link href="/about" style={drawerLinkStyle}>About</Link>
          <Link href="/features" style={drawerLinkStyle}>Features</Link>
          <Link href="/pricing" style={drawerLinkStyle}>Pricing</Link>
          <Link href="/support" style={drawerLinkStyle}>Support</Link>
          <Link href="/login" style={{ ...drawerLinkStyle, borderBottom: "none" }}>
            Log in
          </Link>
        </div>
      )}
      <style jsx global>{`
        .nav-bar .nav-link:hover {
          opacity: 1 !important;
          border-color: ${BORDER} !important;
        }
        .nav-bar .nav-link:active {
          border-color: rgba(0, 0, 0, 0.14) !important;
          background-color: rgba(0, 0, 0, 0.02);
        }
        .header-mobile-drawer a:active {
          background-color: rgba(0, 0, 0, 0.03);
        }
      `}</style>
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
        { label: "Instagram", href: "https://www.instagram.com/securewarp" },
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
          <StatusIndicator />
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
 * Footer status indicator. Reads the latest row from
 * `system_status` via /api/status — the actual health check is
 * driven by an hourly cron (see /api/cron/status-check), not by
 * visitors. This keeps the footer O(1) per page view regardless
 * of traffic volume and means no visitor triggers a live ping of
 * our dependencies.
 *
 * Per-tab cache (sessionStorage, 10 min) means navigating between
 * marketing pages doesn't re-fetch. Edge cache (5 min) smooths
 * origin load even across tabs.
 *
 * Response is boolean-only; anon visitors never learn which
 * dependency is red. Admins get the per-service breakdown on the
 * admin overview.
 */
function StatusIndicator() {
  const [state, setState] = useState<"loading" | "ok" | "degraded">("loading");

  useEffect(() => {
    let alive = true;
    const CACHE_KEY = "securewarp_status_cache";
    const CACHE_TTL_MS = 10 * 60_000;

    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const entry = JSON.parse(raw) as { ok: boolean | null; at: number };
        if (Date.now() - entry.at < CACHE_TTL_MS) {
          setState(entry.ok === null ? "loading" : entry.ok ? "ok" : "degraded");
          return;
        }
      }
    } catch { /* corrupt entry — fall through to fetch */ }

    (async () => {
      try {
        const res = await fetch("/api/status");
        if (!alive) return;
        if (!res.ok) {
          setState("degraded");
          return;
        }
        const data = (await res.json()) as { ok: boolean | null };
        setState(data.ok === null ? "loading" : data.ok ? "ok" : "degraded");
        try {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ ok: data.ok, at: Date.now() }),
          );
        } catch { /* quota / private mode — not fatal */ }
      } catch {
        if (alive) setState("degraded");
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const dotColor =
    state === "ok" ? GREEN : state === "degraded" ? "rgb(220,140,60)" : "rgba(0,0,0,0.25)";
  const dotShadow =
    state === "ok"
      ? "0 0 8px rgba(239,90,60,0.5)"
      : state === "degraded"
        ? "0 0 8px rgba(220,140,60,0.5)"
        : "none";
  // Label is always "All systems operational" — the dot color
  // (green / amber / grey) carries the live state on its own.
  // Keeps the footer quiet and consistent even when something's
  // degraded; admins read the real detail on the admin overview.

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginTop: 18,
      }}
      aria-live="polite"
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          background: dotColor,
          boxShadow: dotShadow,
          transition: "background 0.25s, box-shadow 0.25s",
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
