"use client";

import { useEffect, useState } from "react";

/**
 * Isolated .xlsx viewer page.
 *
 * Reads the workbook with ExcelJS (no known advisories vs. legacy
 * sheetjs on npm), renders each sheet as a plain HTML table built
 * from React elements — no `dangerouslySetInnerHTML`, every cell
 * value goes through React's text escaping.
 *
 * Same isolation guarantees as the docx and pdf viewers: served on
 * pdf.securewarp.com so a malicious workbook that exploits the parser
 * runs cordoned off from the main app's cookies and storage.
 */

const ALLOWED_PARENT_ORIGINS = [
  "https://securewarp.com",
  "https://www.securewarp.com",
];

interface XlsxMessage {
  type: "xlsx-bytes";
  bytes: Uint8Array;
}

function isXlsxMessage(data: unknown): data is XlsxMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.type === "xlsx-bytes" && d.bytes instanceof Uint8Array;
}

interface SheetData {
  name: string;
  rows: string[][];
}

export default function XlsxViewerPage() {
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (window.top === window) {
      window.location.replace("https://www.securewarp.com");
      return;
    }

    let bytesReceived = false;
    const handler = async (e: MessageEvent) => {
      if (!ALLOWED_PARENT_ORIGINS.includes(e.origin)) return;
      if (!isXlsxMessage(e.data)) return;
      bytesReceived = true;
      let copy: Uint8Array | null = null;
      try {
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        copy = new Uint8Array(e.data.bytes);
        await workbook.xlsx.load(copy.buffer as ArrayBuffer);
        const out: SheetData[] = [];
        workbook.eachSheet((worksheet) => {
          const rows: string[][] = [];
          worksheet.eachRow({ includeEmpty: false }, (row) => {
            const values: string[] = [];
            row.eachCell({ includeEmpty: true }, (cell) => {
              values.push(cellToString(cell.value));
            });
            rows.push(values);
          });
          out.push({ name: worksheet.name, rows });
        });
        setSheets(out);
      } catch {
        setErrored(true);
      } finally {
        // Zero the plaintext bytes once exceljs has parsed them.
        if (copy) {
          try {
            copy.fill(0);
          } catch {
            // Already detached; nothing to clear.
          }
        }
      }
    };
    window.addEventListener("message", handler);

    const parentOrigin = (() => {
      try {
        return new URL(document.referrer).origin;
      } catch {
        return "";
      }
    })();

    // Retry viewer-ready until bytes arrive — closes a race where the
    // iframe hydrates before the parent attaches its message listener
    // (likely on cached subsequent opens).
    // 100 attempts × 150ms ≈ 15s window, matching the parent's
    // readiness timeout. First-visit-after-login pays for Cloudflare
    // challenges on the pdf subdomain AND a cold exceljs bundle.
    let attempts = 0;
    const ping = () => {
      if (bytesReceived || attempts >= 100) {
        clearInterval(pingInterval);
        return;
      }
      attempts++;
      if (!ALLOWED_PARENT_ORIGINS.includes(parentOrigin)) return;
      try {
        window.parent.postMessage({ type: "viewer-ready" }, parentOrigin);
      } catch {
        // Parent's 5s timeout will fall back if nothing arrives.
      }
    };
    ping();
    const pingInterval = setInterval(ping, 150);

    return () => {
      clearInterval(pingInterval);
      window.removeEventListener("message", handler);
    };
  }, []);

  if (errored) return <Centered>Spreadsheet viewer unavailable.</Centered>;
  if (!sheets) return <Centered>Loading…</Centered>;
  if (sheets.length === 0)
    return <Centered>Workbook contains no sheets.</Centered>;

  const active = sheets[activeIndex];
  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        minHeight: "100vh",
        background: "#fff",
        color: "#1a1a2e",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {sheets.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "8px 12px",
            borderBottom: "1px solid #e5e5e5",
            background: "#f7f7f9",
            overflowX: "auto",
          }}
        >
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveIndex(i)}
              style={{
                border: "1px solid #d4d4d8",
                borderBottom:
                  i === activeIndex
                    ? "1px solid #fff"
                    : "1px solid #d4d4d8",
                borderRadius: "6px 6px 0 0",
                padding: "6px 12px",
                background: i === activeIndex ? "#fff" : "#ececef",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div style={{ overflow: "auto", padding: "12px" }}>
        <table
          style={{
            borderCollapse: "collapse",
            fontSize: 12,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          <tbody>
            {active.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      border: "1px solid #e5e5e5",
                      padding: "4px 8px",
                      whiteSpace: "pre",
                      verticalAlign: "top",
                      maxWidth: 320,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // ExcelJS returns rich text/formula/hyperlink as objects.
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text;
    if (typeof v.result === "string") return v.result;
    if (typeof v.result === "number") return String(v.result);
    if (Array.isArray(v.richText)) {
      return v.richText
        .map((rt) => (typeof rt === "object" && rt && "text" in rt ? String((rt as { text: unknown }).text) : ""))
        .join("");
    }
  }
  return String(value);
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        color: "#666",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
