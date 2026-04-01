"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: string;
  content?: React.ReactNode;
  children: React.ReactNode;
  side?: "right" | "bottom";
  delay?: number;
}

export function Tooltip({ label, content, children, side = "right", delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    if (side === "right") {
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 });
    } else {
      setPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
    }
  }, [side]);

  const show = useCallback(() => {
    timeout.current = setTimeout(() => {
      updatePos();
      setVisible(true);
    }, delay);
  }, [delay, updatePos]);

  const hide = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => { if (timeout.current) clearTimeout(timeout.current); };
  }, []);

  const transformClass =
    side === "right"
      ? "-translate-y-1/2"
      : "-translate-x-1/2";

  return (
    <>
      <div className="relative inline-flex" ref={triggerRef} onMouseEnter={show} onMouseLeave={hide}>
        {children}
      </div>
      {visible && createPortal(
        <div
          className={`fixed z-[9999] ${transformClass} rounded-[8px] bg-bg-l3 border border-border-primary text-text-primary pointer-events-none ${
            content ? "p-3 w-[180px]" : "whitespace-nowrap px-2.5 py-1.5 text-[12px] font-medium"
          }`}
          style={{ top: pos.top, left: pos.left, boxShadow: "var(--shadow-l1)" }}
        >
          {content || label}
        </div>,
        document.body
      )}
    </>
  );
}
