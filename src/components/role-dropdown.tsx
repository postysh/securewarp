"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";

interface RoleDropdownProps<T extends string> {
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  onChange: (value: T) => void;
  onRemove?: () => void;
  disabled?: boolean;
}

/**
 * Reusable role/permission picker. Originally the one-off dropdown inside
 * `members-modal`; now the single source of truth for any membership UI so
 * the share modal, workspace members list, and future access surfaces all
 * look and behave identically.
 */
export function RoleDropdown<T extends string>({
  value,
  options,
  labels,
  onChange,
  onRemove,
  disabled,
}: RoleDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = () => {
    if (disabled) return;
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen(!open);
  };

  const label = (opt: T) => labels?.[opt] ?? opt;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        disabled={disabled}
        className="flex items-center gap-1 px-2 h-[26px] rounded-[6px] text-[11px] text-text-tertiary hover:bg-bg-cell-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {label(value)}
        <HugeiconsIcon icon={ArrowDown01Icon} size={10} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed w-[120px] rounded-[8px] bg-bg-l3 border border-border-primary overflow-hidden z-[99999]"
          style={{ top: pos.top, right: pos.right, boxShadow: "var(--shadow-l2)" }}
        >
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={`w-full text-left px-3 h-[30px] text-[12px] hover:bg-bg-cell-hover transition-colors cursor-pointer ${
                value === opt ? "text-text-primary font-medium" : "text-text-secondary"
              }`}
            >
              {label(opt)}
            </button>
          ))}
          {onRemove && (
            <>
              <div className="h-px bg-border-tertiary" />
              <button
                onClick={() => {
                  onRemove();
                  setOpen(false);
                }}
                className="w-full text-left px-3 h-[30px] text-[12px] text-accent-red hover:bg-bg-cell-hover transition-colors cursor-pointer"
              >
                Remove
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
