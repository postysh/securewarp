/**
 * Streaming skeleton for /share/[id]. The page itself is "use client"
 * (required: a public share link must render for anonymous visitors,
 * so it can't touch cookies/session on the server — see AGENTS.md
 * "Phase 4 invariants — public link sharing"). Without this loading
 * file, the visitor sees a blank screen while the client bundle
 * downloads + parses + the link metadata fetches. A streamed shell
 * paints immediately so the tab stops feeling dead.
 *
 * Intentionally NOT "use client" — server component that ships zero
 * JS. Contains no encrypted content and no linkKey material (would
 * violate rule 9 in AGENTS.md). Just a branded loading frame.
 */
export default function ShareLoading() {
  return (
    <div className="min-h-screen bg-bg-main flex items-center justify-center p-4">
      <div className="w-full max-w-[560px] rounded-2xl border border-border-secondary bg-bg-l3 overflow-hidden">
        {/* Header strip */}
        <div className="h-[72px] border-b border-border-tertiary flex items-center px-6 gap-3">
          <div className="skeleton h-8 w-8 rounded-[8px]" />
          <div className="flex-1">
            <div className="skeleton h-3 w-28 rounded-sm mb-2" />
            <div className="skeleton h-2 w-20 rounded-sm" />
          </div>
        </div>

        {/* File card */}
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="skeleton h-12 w-12 rounded-xl shrink-0" />
            <div className="flex-1">
              <div className="skeleton h-4 w-3/4 rounded-md mb-2" />
              <div className="skeleton h-3 w-1/3 rounded-sm" />
            </div>
          </div>

          <div className="skeleton h-10 rounded-[10px]" />
          <div className="grid grid-cols-2 gap-2">
            <div className="skeleton h-9 rounded-[10px]" />
            <div className="skeleton h-9 rounded-[10px]" />
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border-tertiary px-6 py-4 flex items-center justify-between">
          <div className="skeleton h-2 w-24 rounded-sm" />
          <div className="skeleton h-2 w-16 rounded-sm" />
        </div>
      </div>
    </div>
  );
}
