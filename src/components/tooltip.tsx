"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: string;
  content?: React.ReactNode;
  children: React.ReactNode;
  side?: "right" | "bottom";
  delay?: number;
}

const VIEWPORT_MARGIN = 8;

export function Tooltip({ label, content, children, side = "right", delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  // `pos` is the trigger-anchored position computed on show. The tooltip
  // is rendered at this point with its transform class, then a
  // post-layout effect clamps it to the viewport if it would overflow —
  // shifting left/right or flipping sides as needed.
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    if (side === "right") {
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 });
    } else {
      setPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
    }
    setOffset({ dx: 0, dy: 0 });
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

  // Post-layout clamp: measure the rendered tooltip and nudge it back
  // into the viewport. For side="right" we flip to the left of the
  // trigger when there isn't room on the right. For side="bottom" we
  // shift horizontally so the tooltip's left/right edge stays inside.
  useLayoutEffect(() => {
    if (!visible || !tipRef.current || !triggerRef.current) return;
    const tip = tipRef.current.getBoundingClientRect();
    const trig = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let dx = 0;
    let dy = 0;

    if (side === "right") {
      if (tip.right > vw - VIEWPORT_MARGIN) {
        // Flip to the left side of the trigger.
        dx = -(trig.width + tip.width + 16);
      }
      if (tip.top < VIEWPORT_MARGIN) dy = VIEWPORT_MARGIN - tip.top;
      else if (tip.bottom > vh - VIEWPORT_MARGIN) dy = vh - VIEWPORT_MARGIN - tip.bottom;
    } else {
      if (tip.right > vw - VIEWPORT_MARGIN) dx = vw - VIEWPORT_MARGIN - tip.right;
      else if (tip.left < VIEWPORT_MARGIN) dx = VIEWPORT_MARGIN - tip.left;
      if (tip.bottom > vh - VIEWPORT_MARGIN) {
        // Flip above the trigger.
        dy = -(trig.height + tip.height + 16);
      }
    }

    if (dx !== 0 || dy !== 0) setOffset({ dx, dy });
  }, [visible, side, pos.top, pos.left]);

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
          ref={tipRef}
          className={`fixed z-[9999] ${transformClass} rounded-[8px] bg-bg-l3 border border-border-primary text-text-primary pointer-events-none ${
            content ? "p-3 w-[180px]" : "whitespace-nowrap px-2.5 py-1.5 text-[12px] font-medium"
          }`}
          style={{ top: pos.top + offset.dy, left: pos.left + offset.dx, boxShadow: "var(--shadow-l1)" }}
        >
          {content || label}
        </div>,
        document.body
      )}
    </>
  );
}
