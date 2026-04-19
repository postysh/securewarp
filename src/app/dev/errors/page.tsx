"use client";

import Link from "next/link";

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
 * Dev-only index for inspecting the three error pages without
 * having to chase real crashes. Each tile either triggers the
 * corresponding real Next.js mechanism (404 by navigating to a
 * nonexistent path, `error.tsx` by rendering a route that throws)
 * or previews the visual directly (`global-error.tsx` is hard to
 * provoke without breaking the layout, so it's rendered here).
 */
export default function ErrorIndex() {
  const tiles = [
    {
      heading: "404 Not found",
      desc: "src/app/not-found.tsx — triggers on any unknown route.",
      action: "View 404",
      href: "/dev/errors/a-path-that-does-not-exist",
      mode: "link" as const,
    },
    {
      heading: "500 Render error",
      desc: "src/app/error.tsx — catches render-time throws inside a route.",
      action: "Throw now",
      href: "/dev/errors/throw",
      mode: "link" as const,
    },
    {
      heading: "Critical error",
      desc: "src/app/global-error.tsx — root-layout crash fallback. Previewed inline (can't safely trigger without breaking the layout).",
      action: "Preview",
      href: "/dev/errors/global-preview",
      mode: "link" as const,
    },
  ];

  return (
    <MarketingShell>
      <section
        style={{
          padding: "96px 32px 48px",
          textAlign: "center",
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
            margin: "0 0 12px",
          }}
        >
          Dev · Error preview
        </p>
        <h1
          style={{
            fontSize: "clamp(2rem, 4vw, 3rem)",
            lineHeight: 1.05,
            color: TEXT,
            fontFamily: BRAND_SANS,
            fontWeight: 400,
            letterSpacing: -1,
            margin: "0 auto 12px",
            maxWidth: 560,
          }}
        >
          Inspect the three error pages
        </h1>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: TEXT_MUTED,
            margin: "0 auto",
            maxWidth: 520,
            fontFamily: BRAND_SANS,
          }}
        >
          Uncommitted helper. Delete this directory before shipping if you
          don&apos;t want it exposed in production.
        </p>
      </section>

      <div
        className="dev-error-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          borderTop: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {tiles.map((t, i) => (
          <div
            key={t.heading}
            style={{
              padding: 28,
              borderRight:
                i === tiles.length - 1 ? "none" : `1px solid ${BORDER}`,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minHeight: 220,
            }}
          >
            <h3
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: TEXT,
                margin: 0,
                fontFamily: BRAND_SANS,
                letterSpacing: -0.2,
              }}
            >
              {t.heading}
            </h3>
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.6,
                color: TEXT_MUTED,
                margin: 0,
                fontFamily: BRAND_SANS,
                flex: 1,
              }}
            >
              {t.desc}
            </p>
            <div>
              <Link
                href={t.href}
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
                  padding: "10px 18px",
                  fontSize: 11,
                  background: "none",
                  color: TEXT,
                  border: `1px solid ${BORDER}`,
                  textDecoration: "none",
                }}
              >
                {t.action} →
              </Link>
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .dev-error-grid {
            grid-template-columns: 1fr !important;
          }
          .dev-error-grid > div {
            border-right: none !important;
            border-bottom: 1px solid ${BORDER};
          }
          .dev-error-grid > div:last-child {
            border-bottom: none !important;
          }
        }
      `}</style>
    </MarketingShell>
  );
}
