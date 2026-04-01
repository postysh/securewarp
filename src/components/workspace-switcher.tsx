"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import UnfoldMoreIcon from "@hugeicons/core-free-icons/UnfoldMoreIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import Login01Icon from "@hugeicons/core-free-icons/Login01Icon";
import Setting07Icon from "@hugeicons/core-free-icons/Setting07Icon";
import { Tooltip } from "./tooltip";

interface Workspace {
  id: string;
  name: string;
  initial: string;
  bg: string;
  members: number;
  plan: string;
}

const workspaces: Workspace[] = [
  { id: "personal", name: "Personal", initial: "P", bg: "var(--accent-green-primary)", members: 1, plan: "Free" },
  { id: "acme", name: "Acme Corp", initial: "A", bg: "var(--accent-blue-primary)", members: 12, plan: "Pro" },
  { id: "design", name: "Design Team", initial: "D", bg: "var(--accent-pink-primary)", members: 5, plan: "Free" },
];

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState("personal");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const activeWorkspace = workspaces.find((w) => w.id === activeId)!;

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    if (collapsed) {
      setPos({ top: rect.top, left: rect.right + 8 });
    } else {
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
  }, [collapsed]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleToggle = () => {
    if (!open) updatePos();
    setOpen(!open);
  };

  const switchWorkspace = (id: string) => {
    setActiveId(id);
    setOpen(false);
  };

  const dropdown = open && createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] w-[240px] rounded-[10px] bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
      style={{ top: pos.top, left: pos.left, boxShadow: "var(--shadow-l2)" }}
    >
      {/* Workspace list */}
      <div className="py-1.5">
        <div className="px-3 py-1.5">
          <span className="text-[10px] font-mono uppercase text-text-disabled tracking-wider">Workspaces</span>
        </div>
        {workspaces.map((ws) => (
          <button
            key={ws.id}
            onClick={() => switchWorkspace(ws.id)}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-bg-cell-hover transition-colors cursor-pointer"
          >
            <div
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{ backgroundColor: ws.bg }}
            >
              {ws.initial}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[12px] text-text-primary truncate">{ws.name}</p>
              <p className="text-[10px] text-text-disabled">{ws.members} {ws.members === 1 ? "member" : "members"} · {ws.plan}</p>
            </div>
            {ws.id === activeId && (
              <HugeiconsIcon icon={Tick01Icon} size={14} color="var(--accent-green-primary)" />
            )}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="py-1.5 border-t border-border-tertiary">
        <button className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer">
          <HugeiconsIcon icon={Add01Icon} size={14} color="var(--icon-tertiary)" />
          Create workspace
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer">
          <HugeiconsIcon icon={Login01Icon} size={14} color="var(--icon-tertiary)" />
          Join workspace
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer">
          <HugeiconsIcon icon={Setting07Icon} size={14} color="var(--icon-tertiary)" />
          Workspace settings
        </button>
      </div>
    </div>,
    document.body
  );

  if (collapsed) {
    return (
      <>
        <Tooltip label={activeWorkspace.name}>
          <button
            ref={btnRef}
            onClick={handleToggle}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center hover:opacity-90 transition-opacity cursor-pointer"
            style={{ backgroundColor: activeWorkspace.bg }}
          >
            <span className="text-[11px] font-bold text-text-inverse">{activeWorkspace.initial}</span>
          </button>
        </Tooltip>
        {dropdown}
      </>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="w-full flex items-center gap-3 h-[36px] px-2.5 rounded-[6px] hover:bg-cta-nav-hover transition-colors cursor-pointer"
      >
        <div
          className="w-7 h-7 rounded-[6px] flex items-center justify-center shrink-0"
          style={{ backgroundColor: activeWorkspace.bg }}
        >
          <span className="text-[11px] font-bold text-text-inverse">{activeWorkspace.initial}</span>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] text-text-primary font-semibold truncate block whitespace-nowrap">{activeWorkspace.name}</span>
        </div>
        <HugeiconsIcon icon={UnfoldMoreIcon} size={14} color="var(--icon-tertiary)" />
      </button>
      {dropdown}
    </>
  );
}
