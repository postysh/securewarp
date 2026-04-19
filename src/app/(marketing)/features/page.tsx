"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import Link03Icon from "@hugeicons/core-free-icons/Link03Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import EyeIcon from "@hugeicons/core-free-icons/EyeIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import Rotate01Icon from "@hugeicons/core-free-icons/Rotate01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import HardDriveIcon from "@hugeicons/core-free-icons/HardDriveIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";

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
 * Features page — /features. Goes deeper than the landing's
 * 6-card feature grid: organises every SecureWarp capability into
 * three categories (Encryption, Sharing, Storage) with its own
 * intro + grid, then a technical-primitives strip and a final CTA.
 */
export default function MockupFeatures() {
  return (
    <MarketingShell>
      <HeroBlock />
      <DottedSpacer />
      <CategoryBlock
        eyebrow="Encryption & Security"
        title="Encrypted before it leaves you"
        accent="Everything is encrypted"
        body="Every file, filename, and share link is encrypted in your browser with client-side cryptography before it touches our servers. Your password never crosses the wire."
        features={ENCRYPTION_FEATURES}
      />
      <DottedSpacer />
      <CategoryBlock
        eyebrow="Sharing & Collaboration"
        title="Share without handing over keys"
        accent="without handing over keys"
        body="Collaborate with teammates or send a one-off link. Either way, the decryption key is wrapped to the recipient and never visible to our servers."
        features={SHARING_FEATURES}
      />
      <DottedSpacer />
      <CategoryBlock
        eyebrow="Storage & Organization"
        title="A real drive, not a dead archive"
        accent="not a dead archive"
        body="File versioning, trash with recovery, nested folders, client-side search. Everything you expect from a cloud drive — running on opaque ciphertext."
        features={STORAGE_FEATURES}
      />
      <DottedSpacer />
      <PrimitivesStrip />
      <DottedSpacer />
      <FinalCtaBlock />
    </MarketingShell>
  );
}

// ─── Components ───────────────────────────────────────────────

function DottedSpacer() {
  return (
    <div
      aria-hidden
      style={{
        height: 72,
        borderTop: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='1' fill='%23000' fill-opacity='0.1'/></svg>\")",
        backgroundSize: "24px 24px",
      }}
    />
  );
}

function HeroBlock() {
  return (
    <section style={{ padding: "96px 32px 64px", textAlign: "center" }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: GREEN,
          fontFamily: BRAND_MONO,
        }}
      >
        Features
      </span>
      <h1
        style={{
          marginTop: 12,
          fontSize: "clamp(2.5rem, 5vw, 3.5rem)",
          lineHeight: 1.05,
          color: TEXT,
          fontFamily: BRAND_SANS,
          fontWeight: 400,
          letterSpacing: -1,
          margin: "12px auto 20px",
          maxWidth: 720,
        }}
      >
        Everything a cloud drive should be.{" "}
        <span style={{ color: GREEN }}>Nothing it shouldn&apos;t</span>.
      </h1>
      <p
        style={{
          fontSize: 17,
          lineHeight: 1.6,
          maxWidth: 600,
          margin: "0 auto",
          color: TEXT_MUTED,
          fontFamily: BRAND_SANS,
          textWrap: "pretty",
        }}
      >
        Full file management, fast sharing, real collaboration — all running
        on top of a server that never sees your files.
      </p>
    </section>
  );
}

function CategoryBlock({
  eyebrow,
  title,
  accent,
  body,
  features,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  body: string;
  features: FeatureItem[];
}) {
  // Split title at the accent phrase so we can colour it in green.
  const [lead, tail] = splitAtAccent(title, accent);

  return (
    <section>
      {/* Intro */}
      <div style={{ padding: "64px 32px 32px", textAlign: "center" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
          }}
        >
          {eyebrow}
        </span>
        <h2
          style={{
            marginTop: 12,
            fontSize: "2rem",
            lineHeight: 1.1,
            maxWidth: 640,
            marginLeft: "auto",
            marginRight: "auto",
            color: TEXT,
            fontFamily: BRAND_SANS,
            fontWeight: 400,
            letterSpacing: -0.5,
            marginBottom: 0,
          }}
        >
          {lead}
          {tail && (
            <>
              <span style={{ color: GREEN }}>{accent}</span>
              {tail}
            </>
          )}
        </h2>
        <p
          style={{
            marginTop: 16,
            fontSize: 15,
            lineHeight: 1.625,
            maxWidth: 560,
            marginLeft: "auto",
            marginRight: "auto",
            color: TEXT_MUTED,
            fontFamily: BRAND_SANS,
            marginBottom: 0,
          }}
        >
          {body}
        </p>
      </div>

      {/* Feature grid — 3 columns, hairline borders matching the
          landing's features grid. Responsive collapses to 2 then 1. */}
      <div
        className="mockup-feature-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        {features.map((f, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const rows = Math.ceil(features.length / 3);
          return (
            <div
              key={f.title}
              style={{
                padding: 24,
                borderRight: col === 2 ? "none" : `1px solid ${BORDER}`,
                borderBottom: row === rows - 1 ? "none" : `1px solid ${BORDER}`,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "rgba(239,90,60,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 14,
                }}
              >
                <HugeiconsIcon
                  icon={f.icon}
                  size={16}
                  color={GREEN}
                  strokeWidth={1.5}
                />
              </div>
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: TEXT,
                  margin: "0 0 6px",
                  fontFamily: BRAND_SANS,
                  letterSpacing: -0.1,
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: TEXT_MUTED,
                  margin: 0,
                  fontFamily: BRAND_SANS,
                }}
              >
                {f.body}
              </p>
            </div>
          );
        })}
      </div>

      <style jsx>{`
        @media (max-width: 1024px) {
          .mockup-feature-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 640px) {
          .mockup-feature-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

function PrimitivesStrip() {
  const primitives = [
    "XSalsa20-Poly1305",
    "Argon2id",
    "SRP-6a",
    "HKDF-SHA256",
    "BIP39",
    "nacl.box",
    "nacl.secretbox",
  ];
  return (
    <section style={{ padding: "40px 32px", textAlign: "center" }}>
      <p
        style={{
          fontSize: 12,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: GREEN,
          fontFamily: BRAND_MONO,
          margin: "0 0 20px",
        }}
      >
        Built on open cryptographic standards
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "nowrap",
          gap: 8,
          justifyContent: "center",
          overflowX: "auto",
          maxWidth: 900,
          margin: "0 auto",
        }}
      >
        {primitives.map((p) => (
          <span
            key={p}
            style={{
              fontSize: 11,
              fontFamily: BRAND_MONO,
              letterSpacing: "0.05em",
              color: TEXT,
              background: "rgba(0,0,0,0.03)",
              border: `1px solid ${BORDER}`,
              padding: "5px 10px",
              borderRadius: 6,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {p}
          </span>
        ))}
      </div>
    </section>
  );
}

function FinalCtaBlock() {
  return (
    <section style={{ padding: "64px 32px", textAlign: "center" }}>
      <h2
        style={{
          fontSize: "2rem",
          lineHeight: 1.1,
          color: TEXT,
          fontFamily: BRAND_SANS,
          fontWeight: 400,
          letterSpacing: -0.5,
          margin: 0,
        }}
      >
        Ready to try <span style={{ color: GREEN }}>every one</span>?
      </h2>
      <p
        style={{
          fontSize: 16,
          lineHeight: 1.6,
          color: TEXT_MUTED,
          margin: "16px auto 28px",
          maxWidth: 480,
          fontFamily: BRAND_SANS,
        }}
      >
        Free while in beta. 20 GB included. Every feature on this page is
        available on every plan.
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
        <Link
          href="/signup"
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
          Start encrypting everything
          <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} />
        </Link>
        <Link
          href="/pricing"
          style={{
            fontSize: 13,
            color: TEXT_MUTED,
            textDecoration: "none",
            fontFamily: BRAND_SANS,
          }}
        >
          See pricing →
        </Link>
      </div>
    </section>
  );
}

// ─── Data ─────────────────────────────────────────────────────

type FeatureItem = {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  title: string;
  body: string;
};

const ENCRYPTION_FEATURES: FeatureItem[] = [
  {
    icon: LockIcon,
    title: "Zero knowledge encryption",
    body:
      "Files, folder names, and shares are encrypted in your browser with xsalsa20-poly1305 before upload.",
  },
  {
    icon: Key01Icon,
    title: "Argon2id password derivation",
    body:
      "Your password is turned into keys locally with Argon2id (memory-hard) then split with HKDF. Never sent to us.",
  },
  {
    icon: Shield01Icon,
    title: "SRP-6a authentication",
    body:
      "Login uses the Secure Remote Password protocol, so we verify you without ever receiving your password.",
  },
  {
    icon: Key01Icon,
    title: "Two factor auth (TOTP)",
    body:
      "Standard TOTP re-challenged on every unlock, not just on fresh logins.",
  },
  {
    icon: Key01Icon,
    title: "24 word recovery phrase",
    body:
      "BIP39 phrase you hold. Forget your password and this gets you back in. Lose both and nobody can recover your files.",
  },
  {
    icon: Shield01Icon,
    title: "Client side verified",
    body:
      "Every download checks its ciphertext integrity in your browser. Tampering is detected before decryption.",
  },
];

const SHARING_FEATURES: FeatureItem[] = [
  {
    icon: Link03Icon,
    title: "Public share links",
    body:
      "Create a link to any file or folder. The decryption key lives in the URL fragment and never touches the server.",
  },
  {
    icon: LockIcon,
    title: "Password protected links",
    body:
      "Add a password on top of any share link. The password derives a second key locally before decryption.",
  },
  {
    icon: UserGroupIcon,
    title: "Collaborator invites",
    body:
      "Wrap a file's key to your teammate's public key, peer to peer. No central key server involved.",
  },
  {
    icon: Folder01Icon,
    title: "Folder level permissions",
    body:
      "Share a whole folder. Everything inside inherits access through hierarchical keys automatically.",
  },
  {
    icon: Rotate01Icon,
    title: "Forward secret revocation",
    body:
      "Remove a collaborator and rotate the folder's keys in one step. New content is sealed under fresh keys.",
  },
  {
    icon: EyeIcon,
    title: "Link expiry & view caps",
    body:
      "Time limit a share, cap the view count, or revoke at any time. Links die on schedule without your intervention.",
  },
];

const STORAGE_FEATURES: FeatureItem[] = [
  {
    icon: HardDriveIcon,
    title: "Nested folders",
    body:
      "Organize how you like — folders nest as deep as you want with no performance penalty.",
  },
  {
    icon: Search01Icon,
    title: "Client side search",
    body:
      "Search files by name, type, date. Everything runs locally on the decrypted index; the server never sees your query.",
  },
  {
    icon: Rotate01Icon,
    title: "File versioning",
    body:
      "Previous versions of every file are kept. Revert a mistake or restore an older state without leaving the app.",
  },
  {
    icon: Delete02Icon,
    title: "Trash with 30 day recovery",
    body:
      "Deleted files stay in a trash bin for 30 days. One click restores them; one click purges them for good.",
  },
  {
    icon: EyeIcon,
    title: "Safe file previews",
    body:
      "PDFs, images, docs, and spreadsheets render in a sandboxed origin so untrusted bytes never run as app code.",
  },
  {
    icon: Folder01Icon,
    title: "Workspaces",
    body:
      "Keep personal, work, and client files in separate workspaces with their own keys. Switch with one click.",
  },
];

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Split `full` around an `accent` phrase so a caller can render the
 * accent in a green span. Returns `[textBefore, textAfter]`. If the
 * accent isn't found, returns `[full, ""]`, so the whole title still
 * renders in the default colour.
 */
function splitAtAccent(full: string, accent: string): [string, string | null] {
  const idx = full.indexOf(accent);
  if (idx === -1) return [full, null];
  return [full.slice(0, idx), full.slice(idx + accent.length)];
}
