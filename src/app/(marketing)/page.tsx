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

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useInView();
  return (
    <div ref={ref} className={className} style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s` }}>
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

const GREEN = "#04a45c";
const LIGHT_BG = "#F5F5F4";

export default function Home() {
  useEffect(() => {
    document.documentElement.classList.remove("dark");
    return () => { document.documentElement.classList.add("dark"); };
  }, []);

  return (
    <div style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif", background: LIGHT_BG, minHeight: "100vh" }}>

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
            <Link href="/register" style={{ fontSize: 13, fontWeight: 500, color: GREEN, background: "white", padding: "6px 16px", borderRadius: 8, textDecoration: "none" }}>Get Started</Link>
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
          <Link href="/register" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 24px", fontSize: 14, fontWeight: 500, color: GREEN, background: "white", borderRadius: 10, textDecoration: "none" }}>
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

      {/* ─── STATEMENT ─── dark section with visual break ─── */}
      <FadeIn>
        <section style={{ background: "#111", padding: "100px 32px" }}>
          <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
            <h2 style={{ fontSize: "clamp(26px, 4vw, 44px)", fontWeight: 700, color: "white", margin: "0 0 24px", letterSpacing: -1, lineHeight: 1.2 }}>
              Your cloud provider can read your files.<br />We can&apos;t. By design.
            </h2>
            <p style={{ fontSize: 16, color: "rgba(255,255,255,0.45)", lineHeight: 1.7, maxWidth: 480, margin: "0 auto 48px" }}>
              Everything is encrypted in your browser before it touches our servers. We never see your data. Not even if we wanted to.
            </p>
            {/* Encryption flow visual */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
              {[
                { label: "Your browser", sub: "Encrypts locally" },
                null,
                { label: "Our server", sub: "Stores ciphertext" },
                null,
                { label: "Recipient", sub: "Decrypts locally" },
              ].map((item, i) => item === null ? (
                <div key={i} style={{ width: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="14 7 19 12 14 17"/></svg>
                </div>
              ) : (
                <div key={i} style={{ width: 160, padding: "20px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "white", marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{item.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </FadeIn>

      {/* ─── FEATURES ─── cards on light bg ─── */}
      <section id="features" style={{ background: LIGHT_BG, padding: "100px 32px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <FadeIn>
            <div style={{ textAlign: "center", marginBottom: 64 }}>
              <h2 style={{ fontSize: "clamp(24px, 3vw, 36px)", fontWeight: 700, color: "#111", margin: 0, letterSpacing: -0.5 }}>
                Everything you need to store securely
              </h2>
            </div>
          </FadeIn>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {[
              { icon: LockIcon, color: GREEN, title: "Zero-knowledge encryption", desc: "Files are encrypted in your browser before upload. The server only stores ciphertext — it can never read your data." },
              { icon: UserGroupIcon, color: "#6aa4dc", title: "Team workspaces", desc: "Shared spaces with admin, editor, and viewer roles. Invite your team and access is inherited through folders automatically." },
              { icon: Link04Icon, color: "#e1886e", title: "Encrypted link sharing", desc: "Share via link with optional password and expiry. The decryption key stays in the URL fragment — never hits the server." },
              { icon: CloudServerIcon, color: GREEN, title: "20 GB free storage", desc: "Start with 20 GB of encrypted storage. Every byte is encrypted with XSalsa20-Poly1305 before it leaves your browser." },
              { icon: Image01Icon, color: "#c88caf", title: "Preview anything", desc: "Documents, images, PDFs — decrypted and rendered client-side. The server never handles your plaintext files." },
              { icon: StarIcon, color: "#d4b450", title: "24-word recovery", desc: "Forget your password, not your files. A BIP39 recovery phrase lets you regain access. No server-side backdoor." },
            ].map((f, i) => (
              <FadeIn key={f.title} delay={i * 0.06}>
                <div style={{ background: "white", borderRadius: 16, padding: 28, border: "1px solid rgba(0,0,0,0.06)", height: "100%" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${f.color}12`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                    <HugeiconsIcon icon={f.icon} size={20} color={f.color} />
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "#111", margin: "0 0 8px" }}>{f.title}</h3>
                  <p style={{ fontSize: 14, color: "#888", lineHeight: 1.65, margin: 0 }}>{f.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECURITY ─── dark strip with crypto standards ─── */}
      <FadeIn>
        <section style={{ background: "#111", padding: "56px 32px" }}>
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <span style={{ fontSize: 12, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", letterSpacing: 2, color: "rgba(255,255,255,0.3)" }}>Built on proven cryptography</span>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
              {[
                { name: "XSalsa20-Poly1305", role: "Encryption" },
                { name: "Argon2id", role: "Key derivation" },
                { name: "SRP-6a", role: "Authentication" },
                { name: "BIP39", role: "Recovery" },
                { name: "HKDF-SHA256", role: "Key separation" },
              ].map((c) => (
                <div key={c.name} style={{ padding: "12px 20px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "white", fontFamily: "var(--font-geist-mono), monospace" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{c.role}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </FadeIn>

      {/* ─── CTA ─── green ─── */}
      <FadeIn>
        <section style={{ background: GREEN, padding: "80px 32px" }}>
          <div style={{ maxWidth: 500, margin: "0 auto", textAlign: "center" }}>
            <h2 style={{ fontSize: "clamp(24px, 3vw, 34px)", fontWeight: 600, color: "white", margin: "0 0 12px", letterSpacing: -0.5 }}>
              Ready to own your data?
            </h2>
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.7)", margin: "0 0 28px" }}>
              20 GB encrypted storage. No credit card. No tracking.
            </p>
            <Link href="/register" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 32px", fontSize: 15, fontWeight: 600, color: GREEN, background: "white", borderRadius: 12, textDecoration: "none" }}>
              Get started free
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </Link>
          </div>
        </section>
      </FadeIn>

      {/* ─── FOOTER ─── dark ─── */}
      <footer style={{ background: "#1a1a1a", padding: "40px 32px 24px" }}>
        <div style={{ maxWidth: 1060, margin: "0 auto", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "32px 48px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: "white" }}>SecureWarp</span>
            </div>
            <p style={{ fontSize: 13, color: "#666", margin: 0 }}>&copy; 2026. All rights reserved.</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "32px 48px" }}>
            {[
              { title: "Products", items: ["Drive"] },
              { title: "Resources", items: ["Changelog"] },
              { title: "Developer", items: ["GitHub", "Whitepaper"] },
              { title: "Legal", items: ["Privacy policy", "Terms of service"] },
            ].map((col) => (
              <div key={col.title}>
                <div style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>{col.title}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {col.items.map((item) => (
                    <Link key={item} href="#" style={{ fontSize: 14, color: "#aaa", textDecoration: "none" }}>{item}</Link>
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
