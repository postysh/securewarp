"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import DashboardCircleIcon from "@hugeicons/core-free-icons/DashboardCircleIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import SecurityLockIcon from "@hugeicons/core-free-icons/SecurityLockIcon";
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";

type Me = { userId: string; email: string; role: "admin" | "owner" };

/**
 * Admin app shell. Client-side gate: fetches /api/admin/me; redirects
 * non-admins to /drive. The server-side check in every /api/admin/* route
 * is the real security boundary — this is just UX.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
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
      <div className="h-screen w-screen bg-bg-main flex items-center justify-center text-text-tertiary text-[13px]">
        Checking access…
      </div>
    );
  }

  if (!me) return null;

  const navItems = [
    { href: "/admin", label: "Overview", icon: DashboardCircleIcon, exact: true },
    { href: "/admin/users", label: "Users", icon: UserGroupIcon, exact: false },
    { href: "/admin/audit", label: "Audit log", icon: SecurityLockIcon, exact: false },
  ];

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="h-screen w-screen flex bg-bg-main text-text-primary">
      {/* Sidebar */}
      <aside className="w-[240px] shrink-0 bg-bg-side border-r border-border-secondary flex flex-col">
        <div className="px-5 py-4 border-b border-border-secondary">
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">
            SecureWarp
          </div>
          <div className="text-[15px] font-semibold text-text-primary">Admin</div>
        </div>

        <nav className="flex-1 p-3">
          {navItems.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 h-[34px] rounded-[8px] text-[13px] transition-colors mb-0.5 ${
                  active
                    ? "bg-cta-nav-active text-text-primary font-medium"
                    : "text-text-secondary hover:bg-cta-nav-hover"
                }`}
              >
                <HugeiconsIcon icon={item.icon} size={15} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border-secondary">
          <Link
            href="/drive"
            className="flex items-center gap-2 px-3 h-[32px] rounded-[8px] text-[12px] text-text-tertiary hover:bg-cta-nav-hover transition-colors"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} size={13} />
            Back to drive
          </Link>
          <div className="px-3 pt-2 mt-1">
            <div className="text-[11px] text-text-tertiary truncate">{me.email}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-disabled mt-0.5">
              {me.role}
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
