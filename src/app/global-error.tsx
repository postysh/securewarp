"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort error boundary. Fires when the root layout itself
 * fails to render, so we MUST supply our own `<html>` + `<body>`
 * and can't depend on any of the app's usual layout context
 * (including MarketingShell / Chillax / globals.css). Every style
 * here is inline + system-font for maximum resilience; the only
 * external dependency is Sentry for error reporting.
 *
 * For in-segment errors that fire after the layout has mounted,
 * see `error.tsx` instead — it can use the full MarketingShell.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#faf8f4",
          color: "#0a0a0a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <div
          style={{
            maxWidth: 520,
            textAlign: "center",
          }}
        >
          {/* Inline warning triangle — no font / asset dependencies,
              safe even when the root layout has failed. */}
          <svg
            width="56"
            height="52"
            viewBox="0 0 24 22"
            fill="none"
            aria-hidden
            // `display: block` + `margin: 0 auto` centres the SVG
            // independently of the parent's `textAlign: center`,
            // which can miss inline SVGs depending on baseline
            // alignment.
            style={{ display: "block", margin: "0 auto 20px" }}
          >
            <path
              d="M12 2L23 21H1L12 2Z"
              fill="rgba(239,90,60,0.12)"
              stroke="rgb(239,90,60)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <line
              x1="12"
              y1="9"
              x2="12"
              y2="15"
              stroke="rgb(239,90,60)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="12" cy="18" r="1" fill="rgb(239,90,60)" />
          </svg>
          <p
            style={{
              fontSize: 12,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              color: "rgb(239,90,60)",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
              margin: "0 0 16px",
            }}
          >
            Critical error
          </p>
          <h1
            style={{
              fontSize: "clamp(2rem, 5vw, 3rem)",
              lineHeight: 1.1,
              fontWeight: 500,
              letterSpacing: -1,
              margin: "0 0 20px",
            }}
          >
            Something has gone{" "}
            <span style={{ color: "rgb(239,90,60)" }}>wrong</span>.
          </h1>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.6,
              color: "rgba(0,0,0,0.5)",
              margin: "0 0 12px",
            }}
          >
            The page couldn&apos;t load at all. A report has been sent to our
            team automatically. Please reload the page or try again in a
            minute.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 11,
                color: "rgba(0,0,0,0.5)",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: "0.08em",
                margin: "0 0 28px",
              }}
            >
              ref {error.digest}
            </p>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              flexWrap: "wrap",
              marginTop: error.digest ? 8 : 28,
            }}
          >
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                borderRadius: 8,
                padding: "12px 24px",
                fontSize: 12,
                background: "rgb(239,90,60)",
                color: "white",
                border: "none",
                cursor: "pointer",
              }}
            >
              Reload page
            </button>
            <a
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                borderRadius: 8,
                padding: "12px 24px",
                fontSize: 12,
                background: "none",
                color: "#0a0a0a",
                border: "1px solid rgba(0,0,0,0.06)",
                textDecoration: "none",
              }}
            >
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
