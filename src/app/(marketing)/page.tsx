"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import HardDriveIcon from "@hugeicons/core-free-icons/HardDriveIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import Table01Icon from "@hugeicons/core-free-icons/Table01Icon";
import MusicNote01Icon from "@hugeicons/core-free-icons/MusicNote01Icon";
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon";
import Pdf01Icon from "@hugeicons/core-free-icons/Pdf01Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import UnfoldMoreIcon from "@hugeicons/core-free-icons/UnfoldMoreIcon";
import SidebarLeft01Icon from "@hugeicons/core-free-icons/SidebarLeft01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";

const GREEN = "#04a45c";

// Unified layout constants. Every content section uses SECTION_MAX;
// the dashboard mockup is the one intentional wider moment because
// it's the visual focal point. SECTION_PAD_Y normalizes the vertical
// rhythm so readers don't ping-pong between wide/narrow/tall/short.
const SECTION_MAX = 1200;
const MOCKUP_MAX = 1400;
const SECTION_PAD_Y = 96;

const EYEBROW_STYLE: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontFamily: "var(--font-geist-mono), monospace",
  textTransform: "uppercase",
  letterSpacing: 2,
  color: "rgba(255,255,255,0.4)",
  marginBottom: 14,
};

const H2_STYLE: React.CSSProperties = {
  fontSize: "clamp(28px, 3.5vw, 40px)",
  fontWeight: 700,
  color: "white",
  letterSpacing: -1.2,
  lineHeight: 1.12,
  margin: 0,
};

/**
 * Logo reveal animation: each character starts as `*`, then cycles
 * through random glyphs for a brief moment before resolving to the
 * real letter. Lands left-to-right like a decryption sequence —
 * fits the zero-knowledge positioning.
 *
 * The string width stays fixed throughout the animation because
 * every in-between glyph is the same single-character monospace
 * width, so the nav pill doesn't reflow during the reveal.
 */
function LogoReveal({ text }: { text: string }) {
  // One cycle char per position. Starts with `*` for every slot, gets
  // resolved to the real letter when that position's turn comes.
  const [display, setDisplay] = useState<string[]>(() => text.split("").map(() => "*"));
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const FRAME_MS = 40;          // glitch cycle speed per position
    const REVEAL_DELAY = 110;     // delay between each position locking in
    const CYCLES_PER_SLOT = 5;    // how many random chars flash before the real letter
    const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ*/#@!$%&+<>?";

    let cancelled = false;
    const slots = text.split("");
    const locked = slots.map(() => false);
    const current = slots.map(() => "*");

    // Drive the animation from a single interval so all still-cycling
    // positions update in sync. Once a position is locked we stop
    // scrambling it; when every position is locked we stop the loop.
    let tick = 0;
    const timer = setInterval(() => {
      if (cancelled) return;
      tick++;
      for (let i = 0; i < slots.length; i++) {
        if (locked[i]) continue;
        // Only start cycling a position after its reveal delay has
        // elapsed. Before that, leave it as `*`.
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!revealed}
      aria-label={revealed ? `${text} — scroll to top` : text}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        color: "inherit",
        font: "inherit",
        // During the reveal the button is non-interactive so users
        // can't trigger a scroll before the name finishes animating.
        cursor: revealed ? "pointer" : "default",
        fontFamily: "var(--font-geist-mono), monospace",
        // Monospace + tabular-nums keeps every slot the same pixel
        // width so the nav pill doesn't jitter as glyphs swap.
        fontVariantNumeric: "tabular-nums",
        letterSpacing: 1,
      }}
    >
      {display.join("")}
    </button>
  );
}

/**
 * Deterministic pseudo-ciphertext. Takes a seed string (the real
 * filename / folder name), returns a fixed-length base64-looking
 * string that stays stable across renders. Used to illustrate what
 * our server actually stores — an opaque blob — instead of the
 * plaintext the user sees.
 */
function mockCipher(seed: string, length = 24): string {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/";
  // FNV-1a hash to derive the initial seed. Math.imul keeps the
  // multiplication in true 32-bit range; plain `*` loses precision
  // for values above 2^53 and makes every output collapse to the
  // same character.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // LCG to stream pseudo-random bytes. Same reason for Math.imul.
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    out.push(alphabet[h % alphabet.length]);
  }
  return out.join("");
}


/**
 * Interactive "encrypt anything" widget. User types a word; it gets
 * HMAC-ish transformed with the same mockCipher as the dashboard
 * toggle, updating on every keystroke. Feels like real-time
 * encryption even though it's a deterministic hash for demo
 * purposes only. Seeds the input with a rotating placeholder so
 * first-time visitors see something happening before they type.
 */
function EncryptPlayground() {
  const SAMPLES = [
    "tax returns 2025.pdf",
    "Patient Records.xlsx",
    "Q4 Financials",
    "Design Mockups",
    "family photos",
  ];
  const [input, setInput] = useState(SAMPLES[0]);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [focused, setFocused] = useState(false);

  // Rotate the sample every 3s while the input is untouched, so the
  // widget has motion and demonstrates different kinds of content.
  // Stops rotating once the user interacts.
  const [userTouched, setUserTouched] = useState(false);
  useEffect(() => {
    if (userTouched) return;
    const t = setInterval(() => {
      setSampleIdx((i) => (i + 1) % SAMPLES.length);
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userTouched]);
  useEffect(() => {
    if (!userTouched) setInput(SAMPLES[sampleIdx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleIdx]);

  const cipher = input.length === 0 ? "" : mockCipher(input, 40);

  return (
    <section style={{ padding: `${SECTION_PAD_Y}px 32px`, maxWidth: SECTION_MAX, margin: "0 auto" }}>
      <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 32px" }}>
        <span style={EYEBROW_STYLE}>Try it yourself</span>
        <h2 style={H2_STYLE}>Type anything. Watch it disappear.</h2>
      </div>
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          background: "#1a1a1a",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: "28px 28px 24px",
        }}
      >
        {/* Input row */}
        <label
          style={{
            display: "block",
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: 1.5,
            color: "rgba(255,255,255,0.4)",
            marginBottom: 8,
          }}
        >
          You type
        </label>
        <input
          value={input}
          onChange={(e) => {
            setUserTouched(true);
            setInput(e.target.value.slice(0, 80));
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Type a filename, note, anything…"
          style={{
            width: "100%",
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${focused ? "rgba(110,210,170,0.4)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 10,
            padding: "12px 14px",
            fontSize: 15,
            color: "white",
            outline: "none",
            transition: "border-color 180ms ease",
            fontFamily: "inherit",
          }}
        />

        {/* Arrow divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 8px" }}>
          <span style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.08)" }} />
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            Encrypt in browser
          </span>
          <span style={{ height: 1, flex: 1, background: "rgba(255,255,255,0.08)" }} />
        </div>

        {/* Ciphertext row */}
        <label
          style={{
            display: "block",
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: 1.5,
            color: "rgba(255,255,255,0.4)",
            marginBottom: 8,
          }}
        >
          Our server stores
        </label>
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "12px 14px",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 13,
            color: "rgba(255,255,255,0.55)",
            wordBreak: "break-all",
            lineHeight: 1.55,
            minHeight: 44,
          }}
        >
          {cipher || <span style={{ color: "rgba(255,255,255,0.3)" }}>—</span>}
        </div>
        <p
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.4)",
            marginTop: 14,
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          Demo transform. Real content is encrypted with XSalsa20-Poly1305
          under a key that never leaves your device.
        </p>
      </div>
    </section>
  );
}

export default function Home() {
  const [encryptedView, setEncryptedView] = useState(false);
  // Track which ciphertext row the user is hovering so we can
  // "decrypt" it back to the real filename. Reinforces the
  // zero-knowledge claim: same file, your key is the only thing
  // standing between the blob and the plaintext.
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  return (
    <div style={{ fontFamily: "var(--font-chillax), var(--font-geist-sans), system-ui, sans-serif", background: "#111", minHeight: "100vh" }}>

      {/* Floating nav pill */}
      <div style={{ position: "fixed", left: "50%", top: 20, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 0, background: "rgba(30,30,30,0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: 12, padding: "6px 6px 6px 10px", zIndex: 99999 }}>
        <span style={{ padding: "8px 16px 8px 6px", fontSize: 14, fontWeight: 600, color: "white", letterSpacing: 0.5 }}>
          <LogoReveal text="SECUREWARP" />
        </span>
        <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)" }} />
        <Link href="#features" style={{ padding: "8px 16px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Features</Link>
        <Link href="#" style={{ padding: "8px 16px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>About</Link>
        <Link href="#" style={{ padding: "8px 16px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Support</Link>
        <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />
        <Link href="/login" style={{ padding: "8px 14px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Log in</Link>
        <Link href="/signup" style={{ padding: "8px 14px", fontSize: 14, fontWeight: 500, color: "#111", background: "white", borderRadius: 8, textDecoration: "none" }}>Get Started</Link>
      </div>

      {/* Hero copy */}
      <section style={{ padding: "140px 32px 0", maxWidth: SECTION_MAX, margin: "0 auto", textAlign: "center" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <span style={EYEBROW_STYLE}>Zero-knowledge cloud drive</span>
          <h1 style={{ ...H2_STYLE, fontSize: "clamp(32px, 4.2vw, 48px)", margin: "0 0 18px" }}>
            The cloud drive
            <br />
            that can&apos;t read your files.
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: "rgba(255,255,255,0.55)", margin: "0 auto 36px", maxWidth: 560, textWrap: "pretty" }}>
            SecureWarp encrypts every file, every folder name, and every share in your
            browser before it leaves your device. Your password never reaches our servers.
            We store only ciphertext. Unreadable without keys we never see.
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
            <Link href="/signup" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 22px", fontSize: 14, fontWeight: 500, color: "#111", background: "white", borderRadius: 10, textDecoration: "none" }}>
              Get Started
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </Link>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>
              Free while in beta · 20 GB included
            </span>
          </div>
        </div>
      </section>

      {/* Dashboard mockup — let the visual speak for itself. The
          before/after toggle above the mockup is self-explanatory;
          adding a section heading here just piles more large text
          onto the page without adding information. */}
      <section style={{ padding: `${SECTION_PAD_Y}px 32px 0` }}>
        {/* Before/after toggle — lets visitors see the same files
            as the user sees them (decrypted) vs what the server
            actually stores (opaque ciphertext). Concrete proof of
            the zero-knowledge claim in the copy above. */}
        <div style={{ maxWidth: MOCKUP_MAX, margin: "0 auto 16px", display: "flex", justifyContent: "center" }}>
          <div
            role="tablist"
            aria-label="Dashboard view"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: 4,
              background: "rgba(30,30,30,0.95)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              fontFamily: "var(--font-geist-mono), monospace",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={!encryptedView}
              onClick={() => setEncryptedView(false)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: 11,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: !encryptedView ? "#111" : "rgba(255,255,255,0.6)",
                background: !encryptedView ? "white" : "transparent",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: !encryptedView ? "rgba(4,164,92,0.9)" : "rgba(255,255,255,0.3)",
                }}
              />
              What you see
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={encryptedView}
              onClick={() => setEncryptedView(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                fontSize: 11,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: encryptedView ? "#111" : "rgba(255,255,255,0.6)",
                background: encryptedView ? "white" : "transparent",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <HugeiconsIcon icon={LockIcon} size={12} />
              What we see
            </button>
          </div>
        </div>

        <div style={{ background: "#111", borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden", maxWidth: MOCKUP_MAX, margin: "0 auto" }}>
          <div style={{ display: "flex", minHeight: 560 }}>
            {/* Sidebar */}
            <div className="hidden lg:flex" style={{ width: 195, flexDirection: "column", background: "#111", padding: "12px 8px", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", borderRadius: 6, marginBottom: 12, cursor: "default" }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "white" }}>P</span>
                </div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "white",
                    flex: 1,
                    fontFamily: encryptedView ? "var(--font-geist-mono), monospace" : undefined,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {encryptedView ? mockCipher("Personal", 10) : "Personal"}
                </span>
                <HugeiconsIcon icon={UnfoldMoreIcon} size={14} color="rgba(255,255,255,0.3)" />
              </div>
              {[
                { name: "My Drive", icon: HardDriveIcon, active: true },
                { name: "Recent", icon: Clock01Icon, active: false },
                { name: "Starred", icon: StarIcon, active: false },
                { name: "Shared with me", icon: UserGroupIcon, active: false },
                { name: "Trash", icon: Delete02Icon, active: false },
              ].map((item) => (
                <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 6, fontSize: 13, color: item.active ? "white" : "rgba(255,255,255,0.45)", fontWeight: item.active ? 500 : 400, background: item.active ? "rgba(255,255,255,0.08)" : "transparent", marginBottom: 1 }}>
                  <HugeiconsIcon icon={item.icon} size={18} color={item.active ? "white" : "rgba(255,255,255,0.45)"} />
                  {item.name}
                </div>
              ))}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 12, paddingTop: 12 }}>
                <div style={{ padding: "0 10px", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", letterSpacing: 1 }}>Pinned</span>
                </div>
                {[
                  { name: "Engineering", isFolder: true },
                  { name: "Q4 Report.pdf", isFolder: false },
                ].map((pin) => (
                  <div
                    key={pin.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.4)",
                      fontFamily: encryptedView ? "var(--font-geist-mono), monospace" : undefined,
                      overflow: "hidden",
                    }}
                  >
                    <HugeiconsIcon
                      icon={encryptedView ? LockIcon : pin.isFolder ? Folder01Icon : File01Icon}
                      size={15}
                      color={
                        encryptedView
                          ? "rgba(255,255,255,0.3)"
                          : pin.isFolder
                            ? "rgb(100,170,220)"
                            : "rgba(255,255,255,0.3)"
                      }
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {encryptedView ? mockCipher(pin.name, 12) : pin.name}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 12, paddingTop: 12 }}>
                <div style={{ padding: "0 10px", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", letterSpacing: 1 }}>Labels</span>
                </div>
                {[
                  { name: "Important", color: "#e85d30" },
                  { name: "Work", color: "#6aa4dc" },
                  { name: "Personal", color: GREEN },
                ].map((label) => (
                  <div key={label.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 6, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: label.color }} />
                    {label.name}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "auto", padding: "8px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <HugeiconsIcon icon={CloudServerIcon} size={14} color="rgba(255,255,255,0.3)" />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Storage</span>
                  </div>
                  <span style={{ fontSize: 10, color: "rgba(110,210,170,0.85)" }}>Upgrade</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div style={{ width: "23%", height: "100%", borderRadius: 2, background: "rgba(110,210,170,0.85)" }} />
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>2.3 of 20 GB</div>
              </div>
              <div style={{ padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: "#e85d30", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white" }}>E</div>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>evan@mail.com</span>
                </div>
              </div>
            </div>
            {/* Main content */}
            <div style={{ flex: 1, background: "#111", padding: "8px 8px 8px 0" }}>
              <div style={{ height: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "#1a1a1a", overflow: "hidden" }}>
                <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 0 20px", height: 52 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, zIndex: 1 }}>
                    <div style={{ padding: 6, borderRadius: 6 }}>
                      <HugeiconsIcon icon={SidebarLeft01Icon} size={16} color="rgba(255,255,255,0.45)" />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "white" }}>My Drive</span>
                  </div>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <div style={{ display: "flex", height: 32, width: "100%", maxWidth: 320, alignItems: "center", borderRadius: 8, background: "rgba(255,255,255,0.04)", padding: "0 12px", gap: 8, pointerEvents: "auto" }}>
                      <HugeiconsIcon icon={Search01Icon} size={15} color="rgba(255,255,255,0.25)" />
                      <span style={{ flex: 1, fontSize: 13, color: "rgba(255,255,255,0.25)" }}>Search files and actions...</span>
                      <span style={{ fontSize: 10, fontFamily: "var(--font-geist-mono), monospace", background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 4, color: "rgba(255,255,255,0.2)" }}>⌘K</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, zIndex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <HugeiconsIcon icon={FolderAddIcon} size={14} color="rgba(255,255,255,0.5)" />
                      New folder
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "#1a1a1a", background: "white" }}>
                      <HugeiconsIcon icon={Upload04Icon} size={14} color="#1a1a1a" />
                      Upload
                    </div>
                    <div style={{ padding: 6, borderRadius: 6, position: "relative" }}>
                      <HugeiconsIcon icon={Notification01Icon} size={18} color="rgba(255,255,255,0.45)" />
                      <div style={{ position: "absolute", top: 5, right: 5, width: 6, height: 6, borderRadius: "50%", background: "rgba(110,210,170,0.85)", border: "1.5px solid #1a1a1a" }} />
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", height: 40, padding: "0 16px", margin: "0 12px" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid rgba(255,255,255,0.12)", marginRight: 16, flexShrink: 0 }} />
                  <div style={{ display: "flex", alignItems: "center", width: 80, borderRight: "1px solid rgba(255,255,255,0.06)", paddingRight: 16 }}>
                    <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>Name</span>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 46 }}>
                    <span style={{ width: 100, textAlign: "right", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>Type</span>
                    <span style={{ width: 100, textAlign: "right", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>Size</span>
                    <span className="hidden lg:block" style={{ width: 110, textAlign: "right", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>Shared</span>
                    <span className="hidden lg:block" style={{ width: 100, textAlign: "right", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>Modified</span>
                  </div>
                </div>
                <div style={{ padding: "4px 12px" }}>
                  {([
                    { name: "Engineering", kind: "folder" as const, size: "—", date: "Dec 15" },
                    { name: "Design Assets", kind: "folder" as const, size: "—", date: "Dec 12" },
                    { name: "Q4 Report.pdf", kind: "pdf" as const, size: "2.4 MB", date: "Dec 10" },
                    { name: "Architecture.png", kind: "image" as const, size: "1.1 MB", date: "Dec 5" },
                    { name: "Budget 2026.xlsx", kind: "spreadsheet" as const, size: "340 KB", date: "Dec 3" },
                    { name: "Team Review.docx", kind: "document" as const, size: "840 KB", date: "Nov 29" },
                    { name: "Recording.mp4", kind: "video" as const, size: "48 MB", date: "Nov 25" },
                    { name: "App.tsx", kind: "code" as const, size: "12 KB", date: "Nov 20" },
                    { name: "Podcast.mp3", kind: "audio" as const, size: "24 MB", date: "Nov 18" },
                  ] as const).map((f, idx) => {
                    const fileIconMap = {
                      folder: { icon: Folder01Icon, color: "rgb(100,170,220)" },
                      pdf: { icon: Pdf01Icon, color: "rgb(220,120,120)" },
                      image: { icon: Image01Icon, color: "rgba(110,210,170,0.85)" },
                      spreadsheet: { icon: Table01Icon, color: "rgba(110,210,170,0.85)" },
                      document: { icon: File01Icon, color: "rgb(120,150,220)" },
                      video: { icon: Video01Icon, color: "rgb(220,120,120)" },
                      code: { icon: CodeIcon, color: "rgb(225,140,110)" },
                      audio: { icon: MusicNote01Icon, color: "rgb(200,140,175)" },
                    };
                    const cfg = fileIconMap[f.kind];
                    const ext = f.name.includes(".") ? f.name.split(".").pop()!.toUpperCase() : "";
                    const isSelected = idx === 2;
                    // When hovering an encrypted row, "decrypt" just
                    // that one row so the visitor sees the real name
                    // behind the cipher — reinforces the zero-knowledge
                    // idea interactively. Only triggers in encrypted mode.
                    const isHovered = encryptedView && hoveredRow === f.name;
                    return (
                      <div
                        key={f.name}
                        onMouseEnter={() => encryptedView && setHoveredRow(f.name)}
                        onMouseLeave={() => encryptedView && setHoveredRow((r) => (r === f.name ? null : r))}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          height: 56,
                          padding: "0 16px",
                          borderRadius: 12,
                          border: isHovered
                            ? "1px solid rgba(110,210,170,0.35)"
                            : isSelected
                              ? "1px solid rgba(110,210,170,0.2)"
                              : "1px solid rgba(255,255,255,0.04)",
                          background: isHovered
                            ? "rgba(110,210,170,0.04)"
                            : isSelected
                              ? "rgba(255,255,255,0.03)"
                              : "transparent",
                          marginBottom: 6,
                          cursor: encryptedView ? "help" : "default",
                          transition: "border-color 180ms ease, background 180ms ease",
                        }}
                      >
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: isSelected ? "none" : "1px solid rgba(255,255,255,0.08)", background: isSelected ? "rgba(110,210,170,0.85)" : "transparent", marginRight: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {isSelected && <HugeiconsIcon icon={Tick01Icon} size={12} color="white" />}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                          <div style={{ width: 32, height: 32, borderRadius: f.kind === "folder" ? 8 : 6, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <HugeiconsIcon
                              icon={isHovered ? cfg.icon : encryptedView ? LockIcon : cfg.icon}
                              size={18}
                              color={isHovered ? cfg.color : encryptedView ? "rgba(255,255,255,0.35)" : cfg.color}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: 13,
                              color: "white",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontFamily: encryptedView && !isHovered
                                ? "var(--font-geist-mono), monospace"
                                : undefined,
                              letterSpacing: encryptedView && !isHovered ? 0 : undefined,
                              transition: "color 180ms ease",
                            }}
                          >
                            {encryptedView && !isHovered ? mockCipher(f.name, 28) : f.name}
                          </span>
                        </div>
                        <div className="hidden md:flex" style={{ alignItems: "center", gap: 46 }}>
                          <div style={{ width: 100, display: "flex", justifyContent: "flex-end" }}>
                            {(!encryptedView || isHovered) && f.kind !== "folder" && ext && (
                              <span style={{ display: "flex", height: 20, alignItems: "center", justifyContent: "center", borderRadius: 4, background: "rgba(255,255,255,0.04)", padding: "0 6px", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.2)" }}>{ext}</span>
                            )}
                            {encryptedView && !isHovered && f.kind !== "folder" && (
                              <span style={{ display: "flex", height: 20, alignItems: "center", justifyContent: "center", borderRadius: 4, background: "rgba(255,255,255,0.04)", padding: "0 6px", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", color: "rgba(255,255,255,0.2)" }}>???</span>
                            )}
                          </div>
                          <div style={{ width: 100, display: "flex", justifyContent: "flex-end" }}>
                            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>{f.size}</span>
                          </div>
                          <div className="hidden lg:flex" style={{ width: 110, justifyContent: "flex-end" }}>
                            {/* Collaborator dot */}
                          </div>
                          <div className="hidden lg:flex" style={{ width: 100, justifyContent: "flex-end" }}>
                            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>{f.date}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Three-column feature explainers */}
      <section id="features" style={{ padding: `${SECTION_PAD_Y}px 32px`, maxWidth: SECTION_MAX, margin: "0 auto" }}>
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 48px" }}>
          <span style={EYEBROW_STYLE}>What makes it different</span>
          <h2 style={H2_STYLE}>
            Three promises we can actually keep.
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          {[
            {
              icon: LockIcon,
              accent: "rgba(110,210,170,0.85)",
              eyebrow: "Encrypted before upload",
              title: "Locked before it leaves your device",
              body:
                "Every file, every folder name, every share is encrypted in your browser. What reaches our servers is ciphertext that even we can't read. Your password never transits the wire.",
            },
            {
              icon: UserAdd01Icon,
              accent: "rgb(120,150,220)",
              eyebrow: "Zero-knowledge sharing",
              title: "Share without trusting the middleman",
              body:
                "Grant access by wrapping file keys directly to a collaborator's public key, peer to peer. Revoke someone and we rotate the key forward so old devices can't read new content.",
            },
            {
              icon: Key01Icon,
              accent: "rgb(225,140,110)",
              eyebrow: "Recovery you own",
              title: "A key nobody else can copy",
              body:
                "A 24-word recovery phrase is your second path in. Forget your password? Use the phrase. Lose both, and neither we nor anyone else can restore access. That's the point.",
            },
          ].map((card) => (
            <div
              key={card.title}
              style={{
                background: "#1a1a1a",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 16,
                padding: "28px 26px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <HugeiconsIcon icon={card.icon} size={20} color={card.accent} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-geist-mono), monospace",
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    color: "rgba(255,255,255,0.4)",
                    marginBottom: 10,
                  }}
                >
                  {card.eyebrow}
                </div>
                <h3
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: "white",
                    letterSpacing: -0.3,
                    margin: "0 0 10px",
                    lineHeight: 1.25,
                  }}
                >
                  {card.title}
                </h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                  {card.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Encrypt-anything interactive widget. Type a word, watch it
          resolve into the same pseudo-ciphertext the server sees.
          A tangible way to feel how zero-knowledge works without
          writing a sentence of marketing copy. */}
      <EncryptPlayground />

      {/* Transparency block — honest inventory of what our servers
          can and cannot see. The whole point of a zero-knowledge
          app is that the list on the right is real, and the list on
          the left is the legitimate minimum we need to run a cloud
          service. Visitors who care about privacy scrutinize these
          tradeoffs; stating them plainly builds more trust than any
          generic "we value your privacy" copy. */}
      <section style={{ padding: `${SECTION_PAD_Y}px 32px`, maxWidth: SECTION_MAX, margin: "0 auto" }}>
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 48px" }}>
          <span style={EYEBROW_STYLE}>Honest by design</span>
          <h2 style={H2_STYLE}>
            Here&apos;s everything we can&apos;t see.
            <br />
            And the little we can.
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 20,
          }}
        >
          {/* What we CAN'T see */}
          <div style={{ background: "#1a1a1a", border: "1px solid rgba(110,210,170,0.2)", borderRadius: 16, padding: "28px 26px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(110,210,170,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <HugeiconsIcon icon={LockIcon} size={16} color="rgba(110,210,170,0.9)" />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 600, color: "white", letterSpacing: -0.3, margin: 0 }}>
                What we can&apos;t see
              </h3>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { what: "File contents", why: "Every byte is encrypted in your browser before upload." },
                { what: "Filenames and folder names", why: "Stored as ciphertext alongside the content." },
                { what: "Your password", why: "SRP-6a means your password never leaves your device." },
                { what: "Your recovery phrase", why: "Generated client-side, we only store a hash." },
                { what: "What's inside a shared link", why: "The link key lives in the URL fragment, which browsers never send to us." },
                { what: "Who a collaborator shares with downstream", why: "Re-shares wrap keys directly between client devices." },
              ].map((item) => (
                <li key={item.what} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    <HugeiconsIcon icon={Tick01Icon} size={14} color="rgba(110,210,170,0.9)" />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, color: "white", fontWeight: 500, marginBottom: 2 }}>
                      {item.what}
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
                      {item.why}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* What we CAN see */}
          <div style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "28px 26px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <HugeiconsIcon icon={CloudServerIcon} size={16} color="rgba(255,255,255,0.55)" />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 600, color: "white", letterSpacing: -0.3, margin: 0 }}>
                What we do see
              </h3>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                { what: "Your email address", why: "Needed to sign you in and send account notifications." },
                { what: "File sizes", why: "The number of encrypted bytes, not their content." },
                { what: "Upload and modified timestamps", why: "When a file changed, never what changed." },
                { what: "Sharing relationships", why: "Which accounts have access to which files, not what the files contain." },
                { what: "Workspace membership", why: "Which users belong to which teams." },
                { what: "IP and device info (temporarily)", why: "For rate limiting and abuse prevention. Not tied to content." },
              ].map((item) => (
                <li key={item.what} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    <HugeiconsIcon icon={Cancel01Icon} size={14} color="rgba(255,255,255,0.45)" />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, color: "white", fontWeight: 500, marginBottom: 2 }}>
                      {item.what}
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
                      {item.why}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p style={{ textAlign: "center", marginTop: 32, fontSize: 13, color: "rgba(255,255,255,0.4)", maxWidth: 640, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
          If you see anything on the right that surprises you, it&apos;s because we&apos;d rather be honest than
          hide a metadata leak in fine print.
        </p>
      </section>
    </div>
  );
}
