"use client";

/**
 * Preview of the `global-error.tsx` visual, rendered inline
 * without actually crashing the root layout. The real global-error
 * component supplies its own `<html>` + `<body>` because by the
 * time it fires, Next has no layout context to lean on — this
 * preview just inlines the visible content inside the normal app
 * layout so you can eyeball the design while iterating.
 *
 * Keep the styles here in sync with `src/app/global-error.tsx`.
 * This page is dev-scratch; delete with /dev/errors/ before
 * shipping.
 */
export default function GlobalErrorPreview() {
  return (
    <div
      style={{
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
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <svg
          width="56"
          height="52"
          viewBox="0 0 24 22"
          fill="none"
          aria-hidden
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
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
        <p
          style={{
            fontSize: 11,
            color: "rgba(0,0,0,0.5)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.08em",
            margin: "0 0 28px",
          }}
        >
          ref abc123def456
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            flexWrap: "wrap",
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
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
    </div>
  );
}
