import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon"

const links = {
  Product: [
    { label: "Features", href: "#features" },
    { label: "Pricing", href: "#pricing" },
    { label: "Security", href: "#" },
  ],
  Resources: [
    { label: "Documentation", href: "#", comingSoon: true },
    { label: "API Reference", href: "#", comingSoon: true },
    { label: "Whitepaper", href: "#" },
  ],
  Company: [
    { label: "About", href: "#" },
    { label: "Twitter", href: "#" },
    { label: "Support", href: "#" },
  ],
  Legal: [
    { label: "Privacy", href: "#" },
    { label: "Terms", href: "#" },
  ],
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border-tertiary">
      <div className="mx-auto max-w-5xl px-6 pt-14 pb-10">
        <div className="grid gap-12 sm:grid-cols-[1.5fr_1fr_1fr_1fr_0.7fr]">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-green">
                <HugeiconsIcon icon={Shield01Icon} size={14} color="white" />
              </div>
              <span className="text-lg font-semibold text-text-primary">SecureWarp</span>
            </div>
            <p className="text-[13px] text-text-disabled leading-relaxed max-w-[200px] mb-5">
              End-to-end encrypted cloud storage. Zero-knowledge by design.
            </p>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-green opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-green" />
              </span>
              <span className="text-xs text-accent-green/50">All systems encrypted</span>
            </div>
          </div>

          {Object.entries(links).map(([title, items]) => (
            <div key={title}>
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-disabled mb-4">{title}</h4>
              <ul className="space-y-2.5">
                {items.map((link) => (
                  <li key={link.label}>
                    {"comingSoon" in link && link.comingSoon ? (
                      <span className="text-[13px] text-text-disabled flex items-center gap-2">
                        {link.label}
                        <span className="text-[9px] text-text-disabled border border-border-tertiary rounded px-1 py-0.5">Soon</span>
                      </span>
                    ) : (
                      <Link href={link.href} className="text-[13px] text-text-tertiary hover:text-text-primary transition-colors no-underline">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-border-tertiary flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-text-disabled">&copy; 2026 SecureWarp. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="#" className="text-xs text-text-disabled hover:text-text-tertiary transition-colors no-underline">Privacy</Link>
            <Link href="#" className="text-xs text-text-disabled hover:text-text-tertiary transition-colors no-underline">Terms</Link>
            <Link href="#" className="text-xs text-text-disabled hover:text-text-tertiary transition-colors no-underline">Security</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
