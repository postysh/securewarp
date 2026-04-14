"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function FadeIn({ children, delay = 0, className = "", style = {} }: { children: React.ReactNode; delay?: number; className?: string; style?: React.CSSProperties }) {
  const { ref, visible } = useInView();
  return (
    <div ref={ref} className={className} style={{ ...style, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s` }}>
      {children}
    </div>
  );
}

import { HugeiconsIcon } from "@hugeicons/react";
import HardDriveIcon from "@hugeicons/core-free-icons/HardDriveIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import Tag01Icon from "@hugeicons/core-free-icons/Tag01Icon";
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
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import Link04Icon from "@hugeicons/core-free-icons/Link04Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";

const GREEN = "#04a45c";
const LIGHT_BG = "#F5F5F4";

export default function Home() {

  return (
    <div style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif", background: "#111", minHeight: "100vh" }}>

      {/* Floating nav pill — top level so no parent clips it */}
      <div style={{ position: "fixed", left: "50%", top: 20, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 0, background: "rgba(30,30,30,0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: 12, padding: "6px 10px", zIndex: 99999 }}>
        <span style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, color: "white", letterSpacing: 0.5 }}>SECUREWARP</span>
        <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)" }} />
        <Link href="#features" style={{ padding: "8px 16px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Features</Link>
        <Link href="#" style={{ padding: "8px 16px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>About</Link>
        <Link href="#" style={{ padding: "8px 16px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Support</Link>
      </div>

      {/* ─── HERO ─── green full-width ─── */}
      <section style={{ background: GREEN, position: "relative", overflow: "hidden" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "flex-end", padding: "24px 32px 0", position: "relative", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link href="/login" style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Login</Link>
            <Link href="/signup" style={{ fontSize: 13, fontWeight: 500, color: GREEN, background: "white", padding: "6px 16px", borderRadius: 8, textDecoration: "none" }}>Get Started</Link>
          </div>
        </div>

        {/* Hero content */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "60px 32px 0", position: "relative", zIndex: 2 }}>
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "rgba(255,255,255,0.4)" }}>SecureWarp Drive</span>
          </div>
          <h1 style={{ fontSize: "clamp(36px, 5.5vw, 60px)", fontWeight: 700, lineHeight: 1.05, color: "white", margin: "0 0 16px", letterSpacing: -2 }}>
            Your files. Your keys.
            <br />
            Zero access.
          </h1>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, margin: "0 0 28px", maxWidth: 460 }}>
            End-to-end encrypted cloud storage where only you hold the keys. Not us. Not anyone.
          </p>
          <Link href="/signup" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 24px", fontSize: 14, fontWeight: 500, color: GREEN, background: "white", borderRadius: 10, textDecoration: "none" }}>
            Start for free
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </Link>
        </div>

        {/* File browser mockup — uses actual Hugeicons, cuts off at bottom */}
        <div style={{ padding: "32px 32px 0", position: "relative", zIndex: 2, maxHeight: 520, overflow: "hidden" }}>
          <div style={{ background: "#111", borderRadius: "16px 16px 0 0", border: "1px solid rgba(255,255,255,0.08)", borderBottom: "none", overflow: "hidden" }}>
            <div style={{ display: "flex", minHeight: 560 }}>
              {/* Sidebar — bg-bg-side, no right border */}
              <div className="hidden lg:flex" style={{ width: 195, flexDirection: "column", background: "#111", padding: "12px 8px", flexShrink: 0 }}>
                {/* Workspace switcher */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", borderRadius: 6, marginBottom: 12, cursor: "default" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "white" }}>P</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "white", flex: 1 }}>Personal</span>
                  <HugeiconsIcon icon={UnfoldMoreIcon} size={14} color="rgba(255,255,255,0.3)" />
                </div>
                {/* Nav */}
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
                {/* Pinned */}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 12, paddingTop: 12 }}>
                  <div style={{ padding: "0 10px", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", letterSpacing: 1 }}>Pinned</span>
                  </div>
                  {[
                    { name: "Engineering", isFolder: true },
                    { name: "Q4 Report.pdf", isFolder: false },
                  ].map((pin) => (
                    <div key={pin.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 6, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                      <HugeiconsIcon icon={pin.isFolder ? Folder01Icon : File01Icon} size={15} color={pin.isFolder ? "rgb(100,170,220)" : "rgba(255,255,255,0.3)"} />
                      {pin.name}
                    </div>
                  ))}
                </div>
                {/* Labels */}
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
                {/* Storage */}
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
                {/* User */}
                <div style={{ padding: "8px 10px", borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: "#e85d30", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white" }}>E</div>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>evan@mail.com</span>
                  </div>
                </div>
              </div>
              {/* Main content — flex-1 p-2 pl-0 > rounded-xl border container */}
              <div style={{ flex: 1, background: "#111", padding: "8px 8px 8px 0" }}>
              <div style={{ height: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "#1a1a1a", overflow: "hidden" }}>
                {/* Header bar — h-[52px] with sidebar toggle, breadcrumb, centered search, actions */}
                <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 0 20px", height: 52 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, zIndex: 1 }}>
                    <div style={{ padding: 6, borderRadius: 6 }}>
                      <HugeiconsIcon icon={SidebarLeft01Icon} size={16} color="rgba(255,255,255,0.45)" />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "white" }}>My Drive</span>
                  </div>
                  {/* Centered search bar */}
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
                {/* Table header — h-[40px] with checkbox, Name | Type Size Shared Modified */}
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
                {/* File rows — h-[56px] px-4 rounded-xl border mb-1.5 */}
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
                    return (
                      <div key={f.name} style={{ display: "flex", alignItems: "center", height: 56, padding: "0 16px", borderRadius: 12, border: isSelected ? "1px solid rgba(110,210,170,0.2)" : "1px solid rgba(255,255,255,0.04)", background: isSelected ? "rgba(255,255,255,0.03)" : "transparent", marginBottom: 6 }}>
                        {/* Checkbox */}
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: isSelected ? "none" : "1px solid rgba(255,255,255,0.08)", background: isSelected ? "rgba(110,210,170,0.85)" : "transparent", marginRight: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {isSelected && <HugeiconsIcon icon={Tick01Icon} size={12} color="white" />}
                        </div>
                        {/* Icon + name */}
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                          <div style={{ width: 32, height: 32, borderRadius: f.kind === "folder" ? 8 : 6, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <HugeiconsIcon icon={cfg.icon} size={18} color={cfg.color} />
                          </div>
                          <span style={{ fontSize: 13, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        </div>
                        {/* Metadata — gap-[46px] matching real app */}
                        <div className="hidden md:flex" style={{ alignItems: "center", gap: 46 }}>
                          <div style={{ width: 100, display: "flex", justifyContent: "flex-end" }}>
                            {f.kind !== "folder" && ext && (
                              <span style={{ display: "flex", height: 20, alignItems: "center", justifyContent: "center", borderRadius: 4, background: "rgba(255,255,255,0.04)", padding: "0 6px", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.2)" }}>{ext}</span>
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
        </div>
      </section>

      {/* ─── STATEMENT + DIFFERENCE — single dark panel ─── */}
      <section style={{ background: "#111", padding: "100px 32px" }}>
        <FadeIn>
          <div style={{ maxWidth: 960, margin: "0 auto", background: "#1a1a1a", borderRadius: 24, border: "1px solid rgba(255,255,255,0.06)", padding: "clamp(40px, 6vw, 72px) clamp(32px, 5vw, 56px)", overflow: "hidden" }}>
            <h2 style={{ fontSize: "clamp(28px, 4.5vw, 48px)", fontWeight: 700, color: "white", margin: "0 0 8px", letterSpacing: -1.5, lineHeight: 1.1, textAlign: "center" }}>
              Your cloud provider can read your files.
            </h2>
            <p style={{ fontSize: "clamp(28px, 4.5vw, 48px)", fontWeight: 700, color: GREEN, margin: "0 0 40px", letterSpacing: -1.5, lineHeight: 1.1, textAlign: "center" }}>
              We can&apos;t. By design.
            </p>
            <div style={{ maxWidth: 560, margin: "0 auto 40px", textAlign: "center" }}>
              <p style={{ fontSize: 15, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, margin: 0 }}>
                Everything is encrypted in your browser before it reaches our servers. Your password never leaves your device. We store only ciphertext — unreadable without your keys.
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, maxWidth: 700, margin: "0 auto" }}>
              {[
                "Zero-knowledge encryption",
                "Password never transmitted",
                "XSalsa20-Poly1305 ciphers",
                "Argon2id key derivation",
                "BIP39 recovery phrase",
                "SRP-6a authentication",
              ].map((line) => (
                <div key={line} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ color: GREEN, fontSize: 14 }}>✓</span>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>{line}</span>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ─── FEATURES — alternating full-width sections with mockups ─── */}

      {/* Feature 1: It works like a real drive */}
      <section id="features" style={{ background: "#111", padding: "120px 32px 0" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto", display: "flex", gap: 48, flexWrap: "wrap", alignItems: "center" }}>
          <FadeIn style={{ flex: "0 0 340px", maxWidth: 400 }}>
            <span style={{ fontSize: 12, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", letterSpacing: 2, color: GREEN }}>File management</span>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 700, color: "white", margin: "12px 0 16px", letterSpacing: -0.5, lineHeight: 1.15 }}>
              Feels like Google Drive. Works like a vault.
            </h2>
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.45)", lineHeight: 1.7, margin: 0 }}>
              Drag and drop files, create folders, preview documents and images, organize with labels and pins. Everything you expect — except we can&apos;t see any of it.
            </p>
          </FadeIn>
          <FadeIn delay={0.1} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ background: "#1a1a1a", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
              {/* Mini header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "white" }}>My Drive</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <HugeiconsIcon icon={FolderAddIcon} size={12} color="rgba(255,255,255,0.4)" />
                  </div>
                  <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, color: "white", background: "white", display: "flex", alignItems: "center", gap: 4 }}>
                    <HugeiconsIcon icon={Upload04Icon} size={12} color="#1a1a1a" />
                    <span style={{ color: "#1a1a1a", fontWeight: 500 }}>Upload</span>
                  </div>
                </div>
              </div>
              {/* Column header */}
              <div style={{ display: "flex", alignItems: "center", padding: "8px 16px", fontSize: 10, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.2)" }}>
                <span style={{ flex: 1 }}>Name</span>
                <span style={{ width: 60, textAlign: "right" }}>Type</span>
                <span style={{ width: 70, textAlign: "right" }}>Size</span>
                <span style={{ width: 80, textAlign: "right" }}>Modified</span>
              </div>
              {([
                { name: "Engineering", kind: "folder" as const, ext: "", size: "—", date: "Dec 15" },
                { name: "Design Assets", kind: "folder" as const, ext: "", size: "—", date: "Dec 12" },
                { name: "Q4 Report.pdf", kind: "pdf" as const, ext: "PDF", size: "2.4 MB", date: "Dec 10" },
                { name: "Architecture.png", kind: "image" as const, ext: "PNG", size: "1.1 MB", date: "Dec 5" },
                { name: "Budget.xlsx", kind: "spreadsheet" as const, ext: "XLSX", size: "340 KB", date: "Dec 3" },
                { name: "Recording.mp4", kind: "video" as const, ext: "MP4", size: "48 MB", date: "Nov 29" },
                { name: "App.tsx", kind: "code" as const, ext: "TSX", size: "12 KB", date: "Nov 20" },
              ]).map((f) => {
                const ic = { folder: { i: Folder01Icon, c: "rgb(100,170,220)" }, pdf: { i: Pdf01Icon, c: "rgb(220,120,120)" }, image: { i: Image01Icon, c: "rgba(110,210,170,0.85)" }, spreadsheet: { i: Table01Icon, c: "rgba(110,210,170,0.85)" }, video: { i: Video01Icon, c: "rgb(220,120,120)" }, code: { i: CodeIcon, c: "rgb(225,140,110)" } }[f.kind];
                return (
                  <div key={f.name} style={{ display: "flex", alignItems: "center", height: 44, padding: "0 16px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                      <div style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <HugeiconsIcon icon={ic.i} size={14} color={ic.c} />
                      </div>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.8)" }}>{f.name}</span>
                    </div>
                    <span style={{ width: 60, textAlign: "right", fontSize: 10, fontFamily: "var(--font-geist-mono), monospace", color: "rgba(255,255,255,0.15)" }}>{f.ext}</span>
                    <span style={{ width: 70, textAlign: "right", fontSize: 12, color: "rgba(255,255,255,0.2)" }}>{f.size}</span>
                    <span style={{ width: 80, textAlign: "right", fontSize: 12, color: "rgba(255,255,255,0.2)" }}>{f.date}</span>
                  </div>
                );
              })}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Feature 2: Workspaces */}
      <section style={{ background: "#111", padding: "120px 32px 0" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto", display: "flex", gap: 48, flexWrap: "wrap", alignItems: "center", flexDirection: "row-reverse" }}>
          <FadeIn style={{ flex: "0 0 340px", maxWidth: 400 }}>
            <span style={{ fontSize: 12, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", letterSpacing: 2, color: GREEN }}>Collaboration</span>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 700, color: "white", margin: "12px 0 16px", letterSpacing: -0.5, lineHeight: 1.15 }}>
              Workspaces with role-based access
            </h2>
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.45)", lineHeight: 1.7, margin: 0 }}>
              Create shared workspaces and invite your team as admins, editors, or viewers. Share a folder and everyone inside gets access automatically — no per-file key distribution.
            </p>
          </FadeIn>
          <FadeIn delay={0.1} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ background: "#1a1a1a", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <HugeiconsIcon icon={UserGroupIcon} size={16} color="#6aa4dc" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "white" }}>Members</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>4 members</div>
                </div>
              </div>
              {/* Search */}
              <div style={{ padding: "10px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}>
                  <HugeiconsIcon icon={Search01Icon} size={14} color="rgba(255,255,255,0.25)" />
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.25)" }}>Search members</span>
                </div>
              </div>
              {/* Members */}
              <div style={{ padding: "0 20px 12px" }}>
                <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  {[
                    { email: "evan@securewarp.com", role: "Admin", color: GREEN },
                    { email: "alice@team.com", role: "Editor", color: "#6aa4dc" },
                    { email: "bob@team.com", role: "Viewer", color: "#c88caf" },
                    { email: "sarah@team.com", role: "Editor", color: "#e1886e" },
                  ].map((m, i) => (
                    <div key={m.email} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 6, background: m.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white" }}>{m.email[0].toUpperCase()}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>{m.email}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{m.role}</div>
                      </div>
                      {m.role !== "Admin" && (
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", padding: "2px 8px" }}>{m.role} ▾</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {/* Footer */}
              <div style={{ padding: "10px 20px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "flex-end" }}>
                <div style={{ padding: "6px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "#1a1a1a", background: "white" }}>Done</div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Feature 3: Link sharing */}
      <section style={{ background: "#111", padding: "120px 32px 0" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto", display: "flex", gap: 48, flexWrap: "wrap", alignItems: "center" }}>
          <FadeIn style={{ flex: "0 0 340px", maxWidth: 400 }}>
            <span style={{ fontSize: 12, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", letterSpacing: 2, color: GREEN }}>Sharing</span>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 700, color: "white", margin: "12px 0 16px", letterSpacing: -0.5, lineHeight: 1.15 }}>
              Encrypted links that expire
            </h2>
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.45)", lineHeight: 1.7, margin: 0 }}>
              Share files with anyone via a link. Add a password. Set an expiration date. The decryption key lives in the URL fragment — it never touches the server.
            </p>
          </FadeIn>
          <FadeIn delay={0.1} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ background: "#1a1a1a", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
              {/* Header — matches real share-modal.tsx */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <HugeiconsIcon icon={UserAdd01Icon} size={16} color="#6aa4dc" />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "white" }}>Share file</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Q4 Report.pdf</div>
                  </div>
                </div>
              </div>
              {/* Email input */}
              <div style={{ padding: "16px 20px 0" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, padding: "9px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)", fontSize: 13, color: "rgba(255,255,255,0.25)" }}>Recipient email</div>
                  <div style={{ padding: "9px 16px", borderRadius: 10, fontSize: 12, fontWeight: 500, color: "#1a1a1a", background: "white" }}>Share</div>
                </div>
              </div>
              {/* Collaborators */}
              <div style={{ padding: "12px 20px" }}>
                <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  {[
                    { email: "evan@securewarp.com", role: "Owner", color: GREEN },
                    { email: "alice@team.com", role: "Can edit", color: "#6aa4dc" },
                  ].map((c, i) => (
                    <div key={c.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.04)" }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: c.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "white" }}>{c.email[0].toUpperCase()}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>{c.email}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{c.role}</div>
                      </div>
                      {c.role !== "Owner" && <span style={{ fontSize: 10, color: "rgb(220,120,120)" }}>Revoke</span>}
                    </div>
                  ))}
                </div>
              </div>
              {/* Public link section */}
              <div style={{ padding: "0 20px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <HugeiconsIcon icon={Link04Icon} size={14} color="rgba(255,255,255,0.35)" />
                    <span style={{ fontSize: 12, fontWeight: 500, color: "white" }}>Public link</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>No expiry ▾</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Password</span>
                    <span style={{ fontSize: 11, color: GREEN }}>Create link</span>
                  </div>
                </div>
                {/* Existing link */}
                <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", color: "rgba(255,255,255,0.6)" }}>/share/a8f2c9d1...</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>Expires Dec 20</div>
                    </div>
                    <span style={{ fontSize: 11, color: "rgb(220,120,120)" }}>Revoke</span>
                  </div>
                </div>
              </div>
              {/* Footer */}
              <div style={{ padding: "10px 20px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <HugeiconsIcon icon={LockIcon} size={11} color="rgba(255,255,255,0.25)" />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>End-to-end encrypted</span>
                </div>
                <div style={{ padding: "6px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>Done</div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Feature 4: Recovery */}
      <section style={{ background: "#111", padding: "120px 32px 0" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto", display: "flex", gap: 48, flexWrap: "wrap", alignItems: "center", flexDirection: "row-reverse" }}>
          <FadeIn style={{ flex: "0 0 340px", maxWidth: 400 }}>
            <span style={{ fontSize: 12, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", letterSpacing: 2, color: GREEN }}>Recovery</span>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 700, color: "white", margin: "12px 0 16px", letterSpacing: -0.5, lineHeight: 1.15 }}>
              Forget your password, not your files
            </h2>
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.45)", lineHeight: 1.7, margin: 0 }}>
              A 24-word recovery phrase lets you regain full access. No reset emails. No server-side backdoor. Your keys, your recovery.
            </p>
          </FadeIn>
          <FadeIn delay={0.1} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ background: "#1a1a1a", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(210,180,80,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <HugeiconsIcon icon={StarIcon} size={16} color="rgb(210,180,80)" />
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: "white" }}>Recovery Key</span>
              </div>
              {/* Warning */}
              <div style={{ margin: "16px 20px 0", padding: "12px 14px", borderRadius: 10, background: "rgba(210,180,80,0.06)", border: "1px solid rgba(210,180,80,0.12)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, marginTop: 1 }}>⚠</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "rgb(210,180,80)" }}>Save this recovery phrase somewhere safe</div>
                  <div style={{ fontSize: 11, color: "rgba(210,180,80,0.6)", marginTop: 2 }}>If you lose it and forget your password, your data is gone forever.</div>
                </div>
              </div>
              {/* Phrase */}
              <div style={{ padding: "16px 20px" }}>
                <div style={{ position: "relative", borderRadius: 10, background: "rgba(255,255,255,0.03)", padding: 16, filter: "blur(3px)", userSelect: "none" }}>
                  <div style={{ fontSize: 13, fontFamily: "var(--font-geist-mono), monospace", color: "rgba(255,255,255,0.5)", lineHeight: 2, wordSpacing: 4 }}>
                    ocean harvest gentle mystery carbon silver ancient rhythm crystal meadow cipher velvet tunnel branch solar kingdom fossil gravity plasma beacon
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>24 words · BIP39</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>Reveal</div>
                    <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>Copy</div>
                  </div>
                </div>
              </div>
              {/* Actions */}
              <div style={{ padding: "0 20px 16px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <div style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>Download backup</div>
                <div style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "#1a1a1a", background: "white" }}>I&apos;ve saved my key</div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Feature 5: Free storage — with visual */}
      <section style={{ background: "#111", padding: "120px 32px" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto", display: "flex", gap: 48, flexWrap: "wrap", alignItems: "center" }}>
          <FadeIn style={{ flex: "0 0 340px", maxWidth: 400 }}>
            <span style={{ fontSize: 12, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", letterSpacing: 2, color: GREEN }}>Storage</span>
            <h2 style={{ fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 700, color: "white", margin: "12px 0 16px", letterSpacing: -0.5, lineHeight: 1.15 }}>
              20 GB free. No strings.
            </h2>
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.45)", lineHeight: 1.7, margin: 0 }}>
              No credit card. No trial period. No ads. No tracking. Every byte encrypted with XSalsa20-Poly1305 before it leaves your browser.
            </p>
          </FadeIn>
          <FadeIn delay={0.1} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ background: "#1a1a1a", borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", padding: 24 }}>
              {/* Storage bar */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <HugeiconsIcon icon={CloudServerIcon} size={16} color="rgba(255,255,255,0.35)" />
                <span style={{ fontSize: 13, fontWeight: 500, color: "white" }}>Storage</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden", marginBottom: 10 }}>
                <div style={{ width: "12%", height: "100%", borderRadius: 3, background: GREEN }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>2.3 GB used</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>20 GB</span>
              </div>
              {/* Quick stats */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {[
                  { label: "Files", value: "142" },
                  { label: "Folders", value: "23" },
                  { label: "Shared", value: "8" },
                ].map((s) => (
                  <div key={s.label} style={{ padding: "14px 16px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: 20, fontWeight: 600, color: "white", marginBottom: 2 }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── CTA + FOOTER ─── combined dark section ─── */}
      <footer style={{ background: "#111", padding: "0 32px 0" }}>
        {/* CTA */}
        <FadeIn>
          <div style={{ maxWidth: 600, margin: "0 auto", textAlign: "center", padding: "100px 0 80px" }}>
            <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 700, color: "white", margin: "0 0 16px", letterSpacing: -1 }}>
              Ready to own your data?
            </h2>
            <p style={{ fontSize: 16, color: "rgba(255,255,255,0.45)", margin: "0 0 32px", lineHeight: 1.6 }}>
              Free forever. 20 GB encrypted storage. No credit card.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
              <Link href="/signup" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 32px", fontSize: 15, fontWeight: 600, color: "#111", background: "white", borderRadius: 12, textDecoration: "none" }}>
                Get started free
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </Link>
              <Link href="/login" style={{ display: "inline-flex", alignItems: "center", padding: "14px 24px", fontSize: 15, fontWeight: 500, color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, textDecoration: "none" }}>
                Sign in
              </Link>
            </div>
          </div>
        </FadeIn>

        {/* Divider */}
        <div style={{ maxWidth: 1060, margin: "0 auto", borderTop: "1px solid rgba(255,255,255,0.06)" }} />

        {/* Footer links */}
        <div style={{ maxWidth: 1060, margin: "0 auto", padding: "40px 0 32px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "32px 48px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: "white" }}>SecureWarp</span>
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", margin: 0 }}>&copy; 2026. All rights reserved.</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "32px 48px" }}>
            {[
              { title: "Products", items: ["Drive"] },
              { title: "Resources", items: ["Changelog"] },
              { title: "Developer", items: ["GitHub", "Whitepaper"] },
              { title: "Legal", items: ["Privacy policy", "Terms of service"] },
            ].map((col) => (
              <div key={col.title}>
                <div style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", marginBottom: 8 }}>{col.title}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {col.items.map((item) => (
                    <Link key={item} href="#" style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", textDecoration: "none" }}>{item}</Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
