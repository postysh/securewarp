"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import DashboardCircleIcon from "@hugeicons/core-free-icons/DashboardCircleIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import SecurityLockIcon from "@hugeicons/core-free-icons/SecurityLockIcon";
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import { createPortal } from "react-dom";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

type Me = { userId: string; email: string; role: "admin" | "owner" };

/**
 * Admin app shell. Mirrors the drive shell layout: bg-bg-side outer, a
 * fixed-width sidebar, and main content rendered inside a rounded
 * floating card. Client-side role gate for UX; the real security
 * boundary is the per-route requireAdmin() check server-side.
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
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div className="h-screen w-screen bg-bg-side flex items-center justify-center text-text-tertiary text-[13px]">
        Checking access…
      </div>
    );
  }
  if (!me) return null;

  return (
    <div className="flex h-full bg-bg-side">
      {/* Sidebar — inline */}
      <div className="relative z-20 h-full hidden md:block">
        <AdminSidebar me={me} />
      </div>

      {/* Main content card */}
      <div className="flex-1 p-2 md:pl-0 relative z-10">
        <div className="h-full rounded-xl border border-border-secondary bg-bg-main overflow-hidden flex flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}

const navItems = [
  { icon: DashboardCircleIcon, label: "Overview", href: "/admin", exact: true },
  { icon: UserGroupIcon, label: "Users", href: "/admin/users", exact: false },
  { icon: SecurityLockIcon, label: "Audit log", href: "/admin/audit", exact: false },
];

function AdminSidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      className="h-full flex flex-col shrink-0 bg-bg-side select-none overflow-visible"
      style={{ width: 195, minWidth: 195 }}
    >
      {/* Brand / admin label */}
      <div className="shrink-0 px-3 py-3">
        <div className="flex items-center gap-2.5 px-2.5 h-[36px]">
          <div className="w-6 h-6 rounded-[6px] bg-bg-overlay-tertiary flex items-center justify-center shrink-0">
            <HugeiconsIcon icon={Shield01Icon} size={14} color="var(--accent-green-primary)" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[12px] font-semibold text-text-primary">SecureWarp</span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-disabled mt-0.5">Admin</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-1 px-2 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col gap-[2px]">
          {navItems.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center rounded-[6px] transition-colors cursor-pointer w-full gap-3 px-2.5 h-[32px] text-[13px] ${
                  active
                    ? "bg-cta-nav-active text-text-primary font-medium"
                    : "text-text-secondary hover:bg-cta-nav-hover"
                }`}
              >
                <HugeiconsIcon icon={item.icon} size={18} />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="mt-3 pt-3 border-t border-border-tertiary">
          <Link
            href="/drive"
            className="flex items-center rounded-[6px] transition-colors cursor-pointer w-full gap-3 px-2.5 h-[32px] text-[13px] text-text-secondary hover:bg-cta-nav-hover"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} size={18} />
            <span className="whitespace-nowrap">Back to drive</span>
          </Link>
        </div>
      </nav>

      {/* User */}
      <div className="py-2 px-2">
        <AdminUserMenu me={me} />
      </div>
    </aside>
  );
}

function AdminUserMenu({ me }: { me: Me }) {
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [btnEl, setBtnEl] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !btnEl) return;
    const rect = btnEl.getBoundingClientRect();
    setPos({ top: rect.top - 140, left: rect.left });
    const handler = (e: MouseEvent) => {
      if (btnEl && !btnEl.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, btnEl]);

  return (
    <div>
      <button
        ref={setBtnEl}
        onClick={() => setOpen((o) => !o)}
        className="w-full gap-3 px-2.5 h-[36px] rounded-[6px] transition-colors cursor-pointer flex items-center text-[13px] text-text-secondary hover:bg-cta-nav-hover"
      >
        <HugeiconsIcon icon={UserCircleIcon} size={18} />
        <div className="flex flex-col leading-none items-start min-w-0">
          <span className="text-[12px] font-medium text-text-primary truncate max-w-[120px]">{me.email}</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-disabled mt-0.5">{me.role}</span>
        </div>
      </button>
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
