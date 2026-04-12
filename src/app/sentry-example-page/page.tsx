"use client";

export default function SentryExamplePage() {
  return (
    <div style={{ padding: 40, fontFamily: "system-ui", maxWidth: 480 }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Sentry Test Page</h1>
      <p style={{ fontSize: 14, color: "#888", marginBottom: 24 }}>
        Click the button below to trigger a test error. It should appear in your Sentry dashboard within seconds.
      </p>
      <button
        type="button"
        onClick={() => {
          throw new Error("Sentry Frontend Test Error");
        }}
        style={{
          padding: "10px 24px",
          borderRadius: 8,
          border: "none",
          background: "#e04040",
          color: "white",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Throw Test Error
      </button>
    </div>
  );
}
