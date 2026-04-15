"use client";

import Link from "next/link";
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
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";

const GREEN = "#04a45c";

export default function Home() {
  return (
    <div style={{ fontFamily: "var(--font-chillax), var(--font-geist-sans), system-ui, sans-serif", background: "#111", minHeight: "100vh" }}>

      {/* Floating nav pill */}
      <div style={{ position: "fixed", left: "50%", top: 20, transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 0, background: "rgba(30,30,30,0.95)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: 12, padding: "6px 6px 6px 10px", zIndex: 99999 }}>
        <span style={{ padding: "8px 16px 8px 6px", fontSize: 14, fontWeight: 600, color: "white", letterSpacing: 0.5 }}>SECUREWARP</span>
        <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)" }} />
        <Link href="#features" style={{ padding: "8px 16px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Features</Link>
        <Link href="#" style={{ padding: "8px 16px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>About</Link>
        <Link href="#" style={{ padding: "8px 16px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Support</Link>
        <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />
        <Link href="/login" style={{ padding: "8px 14px", fontSize: 14, color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Log in</Link>
        <Link href="/signup" style={{ padding: "8px 14px", fontSize: 14, fontWeight: 500, color: "#111", background: "white", borderRadius: 8, textDecoration: "none" }}>Get Started</Link>
      </div>

      {/* Hero copy */}
      <section style={{ padding: "140px 32px 0", maxWidth: 1400, margin: "0 auto", textAlign: "center" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <span style={{ display: "inline-block", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace", textTransform: "uppercase", letterSpacing: 2, color: "rgba(255,255,255,0.4)", marginBottom: 18 }}>
            Zero-knowledge cloud drive
          </span>
          <h1 style={{ fontSize: "clamp(32px, 4.2vw, 48px)", fontWeight: 700, lineHeight: 1.08, color: "white", margin: "0 0 18px", letterSpacing: -1.5 }}>
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

      {/* Dashboard mockup */}
      <section style={{ padding: "72px 32px 0" }}>
        <div style={{ background: "#111", borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden", maxWidth: 1400, margin: "0 auto" }}>
          <div style={{ display: "flex", minHeight: 560 }}>
            {/* Sidebar */}
            <div className="hidden lg:flex" style={{ width: 195, flexDirection: "column", background: "#111", padding: "12px 8px", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", borderRadius: 6, marginBottom: 12, cursor: "default" }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: GREEN, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "white" }}>P</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "white", flex: 1 }}>Personal</span>
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
                  <div key={pin.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 6, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                    <HugeiconsIcon icon={pin.isFolder ? Folder01Icon : File01Icon} size={15} color={pin.isFolder ? "rgb(100,170,220)" : "rgba(255,255,255,0.3)"} />
                    {pin.name}
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
                    return (
                      <div key={f.name} style={{ display: "flex", alignItems: "center", height: 56, padding: "0 16px", borderRadius: 12, border: isSelected ? "1px solid rgba(110,210,170,0.2)" : "1px solid rgba(255,255,255,0.04)", background: isSelected ? "rgba(255,255,255,0.03)" : "transparent", marginBottom: 6 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: isSelected ? "none" : "1px solid rgba(255,255,255,0.08)", background: isSelected ? "rgba(110,210,170,0.85)" : "transparent", marginRight: 16, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {isSelected && <HugeiconsIcon icon={Tick01Icon} size={12} color="white" />}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                          <div style={{ width: 32, height: 32, borderRadius: f.kind === "folder" ? 8 : 6, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <HugeiconsIcon icon={cfg.icon} size={18} color={cfg.color} />
                          </div>
                          <span style={{ fontSize: 13, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        </div>
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
      </section>

      {/* Three-column feature explainers */}
      <section id="features" style={{ padding: "96px 32px 96px", maxWidth: 1600, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 24 }}>
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
    </div>
  );
}
