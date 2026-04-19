"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import DashboardCircleIcon from "@hugeicons/core-free-icons/DashboardCircleIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import SecurityLockIcon from "@hugeicons/core-free-icons/SecurityLockIcon";
import MegaphoneIcon01 from "@hugeicons/core-free-icons/Megaphone01Icon";
import Flag03Icon from "@hugeicons/core-free-icons/Flag03Icon";
import MessageMultiple01Icon from "@hugeicons/core-free-icons/MessageMultiple01Icon";
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import { BrandMark } from "@/components/brand-mark";
import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import SidebarLeft01Icon from "@hugeicons/core-free-icons/SidebarLeft01Icon";
import { createPortal } from "react-dom";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Tooltip } from "@/components/tooltip";

type Me = { userId: string; email: string; role: "admin" | "owner" };

/**
 * Sidebar open/toggle shared with every page so their in-card header
 * bar can render the toggle button. Matches the drive's pattern of
 * putting the toggle next to the breadcrumb.
 */
const AdminSidebarContext = createContext<{ open: boolean; toggle: () => void } | null>(null);

export function useAdminSidebar() {
  const ctx = useContext(AdminSidebarContext);
  if (!ctx) throw new Error("useAdminSidebar outside AdminSidebarContext");
  return ctx;
}

/**
 * Admin app shell. Mirrors the drive shell layout: bg-bg-side outer, a
 * collapsible sidebar (195px expanded / 52px collapsed), and main
 * content rendered inside a rounded floating card. Client-side role
 * gate for UX; the real security boundary is the per-route
 * requireAdmin() check server-side.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AdminShell>{children}</AdminShell>
    </ThemeProvider>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [newFeedback, setNewFeedback] = useState(0);
  const [loading, setLoading] = useState(true);
  // Persist under a separate key from the drive's `sidebar_open` so the
  // admin panel remembers its own collapse state independently.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("admin_sidebar_open") !== "false";
    }
    return true;
  });

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("admin_sidebar_open", String(next)); } catch { /* */ }
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/me");
        if (!res.ok) {
          if (!cancelled) router.replace("/drive");
          return;
        }
        const data = await res.json();
        if (!cancelled) setMe(data);
      } catch {
        if (!cancelled) router.replace("/drive");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  // Poll the feedback count every 60s so the sidebar dot reflects new
  // submissions without requiring a page reload. Only runs once `me` is
  // set — avoids a 403 flicker before the auth check resolves.
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await fetch("/api/admin/feedback/count");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setNewFeedback(data.newCount ?? 0);
      } catch { /* swallow */ }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [me]);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-bg-side flex items-center justify-center text-text-tertiary text-[13px]">
        Checking access…
      </div>
    );
  }
  if (!me) return null;

  return (
    <AdminSidebarContext.Provider value={{ open: sidebarOpen, toggle: toggleSidebar }}>
      <div className="flex h-full bg-bg-side">
        {/* Sidebar — inline, hidden on mobile. Admin is desktop-first. */}
        <div className="relative z-20 h-full hidden md:block">
          <AdminSidebar me={me} collapsed={!sidebarOpen} newFeedback={newFeedback} />
        </div>

        {/* Main content card */}
        <div className={`flex-1 p-2 relative z-10 ${sidebarOpen ? "md:pl-0" : ""}`}>
          <div className="h-full rounded-xl border border-border-secondary bg-bg-main overflow-hidden flex flex-col">
            {children}
          </div>
        </div>
      </div>
    </AdminSidebarContext.Provider>
  );
}

/**
 * Toggle button for the sidebar. Render this inside a page's header bar
 * so it sits in the same spot the drive puts its sidebar toggle.
 */
export function AdminSidebarToggle() {
  const { toggle } = useAdminSidebar();
  return (
    <button
      onClick={toggle}
      className="hidden md:block p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
      aria-label="Toggle sidebar"
    >
      <HugeiconsIcon icon={SidebarLeft01Icon} size={16} />
    </button>
  );
}

const navItems = [
  { icon: DashboardCircleIcon, label: "Overview", href: "/admin", exact: true },
  { icon: UserGroupIcon, label: "Users", href: "/admin/users", exact: false },
  { icon: MessageMultiple01Icon, label: "Feedback", href: "/admin/feedback", exact: false },
  { icon: MegaphoneIcon01, label: "Announcements", href: "/admin/announcements", exact: false },
  { icon: Flag03Icon, label: "Feature flags", href: "/admin/flags", exact: false },
  { icon: SecurityLockIcon, label: "Audit log", href: "/admin/audit", exact: false },
];

function AdminSidebar({
  me,
  collapsed,
  newFeedback,
}: {
  me: Me;
  collapsed: boolean;
  newFeedback: number;
}) {
  const pathname = usePathname();
  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      className="h-full flex flex-col shrink-0 bg-bg-side select-none overflow-visible transition-all duration-200 ease-in-out"
      style={{ width: collapsed ? 52 : 195, minWidth: collapsed ? 52 : 195 }}
    >
      {/* Brand / admin label */}
      <div className={`shrink-0 transition-all duration-200 ${collapsed ? "flex justify-center py-3" : "px-3 py-3"}`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-1 px-2.5"} h-[36px]`}>
          <BrandMark size={28} />
          {!collapsed && (
            <div className="flex flex-col leading-none">
              <span className="text-[12px] font-semibold text-text-primary">SecureWarp</span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-text-disabled mt-0.5">Admin</span>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className={`flex-1 py-1 overflow-y-auto overflow-x-hidden transition-all duration-200 ${collapsed ? "px-[10px]" : "px-2"}`}>
        <div className={`flex flex-col gap-[2px] ${collapsed ? "items-center" : ""}`}>
          {navItems.map((item) => {
            const active = isActive(item.href, item.exact);
            // "Unread feedback" dot — a small green pip on the icon when
            // collapsed, and a count chip next to the label when expanded.
            const hasDot = item.href === "/admin/feedback" && newFeedback > 0;
            const link = (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex items-center rounded-[6px] transition-colors cursor-pointer ${
                  collapsed
                    ? "w-8 h-8 justify-center"
                    : "w-full gap-3 px-2.5 h-[32px] text-[13px]"
                } ${
                  active
                    ? "bg-cta-nav-active text-text-primary font-medium"
                    : "text-text-secondary hover:bg-cta-nav-hover"
                }`}
              >
                <div className="relative">
                  <HugeiconsIcon icon={item.icon} size={18} />
                  {hasDot && collapsed && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                      style={{
                        background: "rgb(239,90,60)",
                        boxShadow: "0 0 0 1.5px var(--bg-side)",
                      }}
                      aria-label={`${newFeedback} new`}
                    />
                  )}
                </div>
                {!collapsed && (
                  <>
                    <span className="whitespace-nowrap">{item.label}</span>
                    {hasDot && (
                      <span
                        className="ml-auto text-[10px] font-mono font-semibold px-1.5 py-[1px] rounded-full"
                        style={{
                          background: "rgba(239,90,60,0.15)",
                          color: "rgb(239,90,60)",
                          minWidth: 18,
                          textAlign: "center",
                        }}
                      >
                        {newFeedback > 99 ? "99+" : newFeedback}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
            return collapsed ? (
              <Tooltip
                key={item.href}
                label={hasDot ? `${item.label} (${newFeedback} new)` : item.label}
              >
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      </nav>

      {/* Footer: back-to-drive + user menu */}
      <div className={`py-2 transition-all duration-200 ${collapsed ? "px-[10px]" : "px-2"}`}>
        {(() => {
          const backLink = (
            <Link
              href="/drive"
              className={`flex items-center rounded-[6px] transition-colors cursor-pointer ${
                collapsed
                  ? "w-8 h-8 justify-center"
                  : "w-full gap-3 px-2.5 h-[32px] text-[13px]"
              } text-text-secondary hover:bg-cta-nav-hover mb-1`}
            >
              <HugeiconsIcon icon={ArrowLeft02Icon} size={18} />
              {!collapsed && <span className="whitespace-nowrap">Back to drive</span>}
            </Link>
          );
          return collapsed ? <Tooltip label="Back to drive">{backLink}</Tooltip> : backLink;
        })()}
        <AdminUserMenu me={me} collapsed={collapsed} />
      </div>
    </aside>
  );
}

function AdminUserMenu({ me, collapsed }: { me: Me; collapsed: boolean }) {
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [btnEl, setBtnEl] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !btnEl) return;
    const rect = btnEl.getBoundingClientRect();
    if (collapsed) {
      setPos({ top: rect.bottom - 140, left: rect.right + 8 });
    } else {
      setPos({ top: rect.top - 140, left: rect.left });
    }
    const handler = (e: MouseEvent) => {
      if (btnEl && !btnEl.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, btnEl, collapsed]);

  const button = (
    <button
      ref={setBtnEl}
      onClick={() => setOpen((o) => !o)}
      className={`rounded-[6px] transition-colors cursor-pointer flex items-center ${
        collapsed
          ? "w-8 h-8 justify-center text-icon-tertiary hover:bg-cta-nav-hover"
          : "w-full gap-3 px-2.5 h-[36px] text-[13px] text-text-secondary hover:bg-cta-nav-hover"
      }`}
    >
      <HugeiconsIcon icon={UserCircleIcon} size={18} />
      {!collapsed && (
        <div className="flex flex-col leading-none items-start min-w-0">
          <span className="text-[12px] font-medium text-text-primary truncate max-w-[120px]">{me.email}</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-disabled mt-0.5">{me.role}</span>
        </div>
      )}
    </button>
  );

  return (
    <div className={collapsed ? "flex justify-center" : ""}>
      {collapsed ? <Tooltip label={me.email}>{button}</Tooltip> : button}
      {open && typeof window !== "undefined" && createPortal(
        <div
          className="fixed z-[9999] w-[180px] rounded-[8px] bg-bg-l3 border border-border-primary overflow-hidden"
          style={{ top: pos.top, left: pos.left, boxShadow: "var(--shadow-l2)" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2.5 border-b border-border-tertiary">
            <div className="text-[12px] text-text-primary font-medium truncate">{me.email}</div>
            <div className="text-[11px] text-text-disabled mt-0.5">{me.role === "owner" ? "Owner" : "Admin"}</div>
          </div>
          <div className="py-1">
            <button
              onClick={() => { toggle(); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={theme === "dark" ? Sun01Icon : Moon02Icon} size={15} />
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          </div>
          <div className="py-1 border-t border-border-tertiary">
            <button
              onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}
              className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-accent-red hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Logout01Icon} size={15} />
              Sign out
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
