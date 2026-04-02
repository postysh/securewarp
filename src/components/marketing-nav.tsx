"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon"

export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout>>(null)

  const onScroll = useCallback(() => {
    const y = window.scrollY
    if (y > 20 && !scrolled) {
      if (timeout.current) clearTimeout(timeout.current)
      setScrolled(true)
    } else if (y <= 5 && scrolled) {
      if (timeout.current) clearTimeout(timeout.current)
      timeout.current = setTimeout(() => setScrolled(false), 150)
    }
  }, [scrolled])

  useEffect(() => {
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (timeout.current) clearTimeout(timeout.current)
    }
  }, [onScroll])

  return (
    <div className="fixed top-0 left-0 right-0 z-50 pointer-events-none">
      <div className="flex justify-center pt-3 px-6">
      <nav
        style={{
          maxWidth: scrolled ? "820px" : "1024px",
          padding: scrolled ? "0 10px 0 20px" : "0 4px",
          gap: scrolled ? "16px" : "0px",
          borderColor: scrolled ? "rgba(255,255,255,0.08)" : "transparent",
          backgroundColor: scrolled ? "rgba(255,255,255,0.04)" : "transparent",
          boxShadow: scrolled ? "0 25px 50px -12px rgba(0,0,0,0.25)" : "none",
          backdropFilter: scrolled ? "blur(64px)" : "none",
          WebkitBackdropFilter: scrolled ? "blur(64px)" : "none",
        }}
        className="flex items-center h-14 w-full rounded-2xl border transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto"
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0 no-underline">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-green">
            <HugeiconsIcon icon={Shield01Icon} size={14} color="white" />
          </div>
          <span className="text-lg font-semibold text-text-primary">SecureWarp</span>
        </Link>

        {/* Links — centered */}
        <div className="flex-1 flex items-center justify-center gap-0.5">
          <Link href="#features" className="px-2.5 py-2 text-[13px] text-text-disabled hover:text-text-primary transition-colors rounded-lg hover:bg-cta-nav-hover no-underline">
            Features
          </Link>
          <Link href="#pricing" className="px-2.5 py-2 text-[13px] text-text-disabled hover:text-text-primary transition-colors rounded-lg hover:bg-cta-nav-hover no-underline">
            Pricing
          </Link>
          <Link href="#" className="px-2.5 py-2 text-[13px] text-text-disabled hover:text-text-primary transition-colors rounded-lg hover:bg-cta-nav-hover no-underline">
            Security
          </Link>
          <Link href="#" className="px-2.5 py-2 text-[13px] text-text-disabled hover:text-text-primary transition-colors rounded-lg hover:bg-cta-nav-hover no-underline">
            About
          </Link>
        </div>

        {/* Status badge */}
        <div className="shrink-0">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-accent-green/20 bg-accent-green/10 px-3 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-green" />
            <span className="text-[11px] font-medium text-accent-green">In Development</span>
          </span>
        </div>
      </nav>
      </div>
    </div>
  )
}
