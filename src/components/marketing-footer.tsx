import Link from "next/link";
import { EYEBROW_STYLE, SECTION_MAX } from "@/lib/marketing-style";

/**
 * Shared footer for marketing pages (landing, about). Matches the
 * rest of the landing's design language — SECTION_MAX container,
 * EYEBROW_STYLE column headings, monospace metadata strip at the
 * bottom. Responsive: 4 cols → 2 cols → 1 col as viewport narrows.
 */
export function MarketingFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        marginTop: 48,
        padding: "48px 32px 32px",
      }}
    >
      <div style={{ maxWidth: SECTION_MAX, margin: "0 auto" }}>
        <div
          className="footer-grid"
          style={{
            display: "grid",
            gap: 40,
            gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
          }}
        >
          {/* Brand block */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "white",
                  letterSpacing: 0.5,
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                SECUREWARP
              </span>
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
              >
                BETA
              </span>
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, margin: 0, maxWidth: 280 }}>
              The cloud drive that can&apos;t read your files. End-to-end encrypted. Zero-knowledge by design.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "rgba(110,210,170,0.9)",
                  boxShadow: "0 0 8px rgba(110,210,170,0.6)",
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono), monospace",
                  color: "rgba(255,255,255,0.45)",
                  letterSpacing: 0.5,
                }}
              >
                All systems operational
              </span>
            </div>
          </div>

          {/* Link columns */}
          {[
            {
              heading: "Product",
              links: [
                { label: "Features", href: "/#features" },
                { label: "Pricing", href: "#" },
                { label: "Changelog", href: "#" },
                { label: "Roadmap", href: "#" },
              ],
            },
            {
              heading: "Company",
              links: [
                { label: "About", href: "/about" },
                { label: "Blog", href: "#" },
                { label: "Contact", href: "#" },
                { label: "Support", href: "#" },
              ],
            },
            {
              heading: "Legal",
              links: [
                { label: "Privacy", href: "#" },
                { label: "Terms", href: "#" },
                { label: "Security", href: "#" },
                { label: "Threat model", href: "#" },
              ],
            },
          ].map((col) => (
            <div key={col.heading}>
              <div style={EYEBROW_STYLE}>{col.heading}</div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      style={{
                        fontSize: 13,
                        color: "rgba(255,255,255,0.6)",
                        textDecoration: "none",
                        transition: "color 160ms ease",
                      }}
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 48,
            paddingTop: 20,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 12,
            color: "rgba(255,255,255,0.35)",
          }}
        >
          <span style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
            © {new Date().getFullYear()} SecureWarp. All rights reserved.
          </span>
          <span style={{ fontFamily: "var(--font-geist-mono), monospace", letterSpacing: 1 }}>
            XSalsa20-Poly1305 · Argon2id · SRP-6a · BIP39
          </span>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .footer-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 480px) {
          .footer-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </footer>
  );
}
