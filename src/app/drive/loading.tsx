/**
 * Streaming shell rendered before the client JS parses + hydrates.
 * The /drive page is `"use client" + dynamic({ssr:false})` so without
 * a loading.tsx the browser shows a blank screen for the duration of
 * the bundle download + parse + first render. Matching the real
 * layout's outer frame + six skeleton rows keeps the visual size
 * stable so there's no layout shift when DriveClient mounts.
 *
 * Intentionally NOT "use client" — this is a server component so
 * Next can stream the markup without shipping any JS for it.
 * Intentionally contains ZERO decrypted file data: zero-knowledge
 * means the server cannot know the user's filenames, so the shell
 * is layout only. The real list fills in client-side after keys are
 * loaded from sessionStorage.
 */
export default function DriveLoading() {
  return (
    <div className="h-full flex bg-bg-side">
      {/* Sidebar placeholder */}
      <div className="hidden md:block shrink-0 bg-bg-side" style={{ width: 195 }}>
        <div className="p-3 flex flex-col gap-2">
          <div className="skeleton h-9 rounded-[8px]" />
          <div className="h-2" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="skeleton h-7 rounded-[6px]"
              style={{ animationDelay: `${i * 0.08}s` }}
            />
          ))}
        </div>
      </div>

      {/* Main panel placeholder */}
      <div className="flex-1 p-2 relative z-10 pb-[72px] md:pb-2">
        <div className="h-full rounded-xl border border-border-secondary bg-bg-main overflow-hidden flex flex-col">
          {/* Toolbar placeholder */}
          <div className="h-[52px] border-b border-border-tertiary flex items-center px-4 gap-3">
            <div className="skeleton h-6 w-24 rounded-md" />
            <div className="flex-1" />
            <div className="skeleton h-7 w-7 rounded-md" />
            <div className="skeleton h-7 w-7 rounded-md" />
          </div>

          {/* Column headers placeholder */}
          <div className="h-[36px] border-b border-border-tertiary flex items-center px-4 gap-6">
            <div className="skeleton h-3 w-12 rounded-sm" />
            <div className="flex-1" />
            <div className="skeleton h-3 w-10 rounded-sm" />
            <div className="skeleton h-3 w-12 rounded-sm" />
          </div>

          {/* File row skeletons — match file-browser.tsx:1610-1624 */}
          <div className="flex-1 p-2 space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center h-[56px] px-4 rounded-xl border border-border-tertiary"
                style={{ animationDelay: `${i * 0.15}s` }}
              >
                <div
                  className="skeleton w-[18px] h-[18px] rounded-[4px] mr-4"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
                <div
                  className="skeleton w-8 h-8 rounded-lg mr-3"
                  style={{ animationDelay: `${i * 0.15 + 0.05}s` }}
                />
                <div className="flex-1 flex items-center gap-3">
                  <div
                    className="skeleton h-3 rounded-md"
                    style={{
                      width: `${100 + i * 15}px`,
                      animationDelay: `${i * 0.15 + 0.1}s`,
                    }}
                  />
                </div>
                <div
                  className="skeleton h-[20px] w-10 rounded-md ml-4"
                  style={{ animationDelay: `${i * 0.15 + 0.15}s` }}
                />
                <div
                  className="skeleton h-3 w-12 rounded-md ml-6"
                  style={{ animationDelay: `${i * 0.15 + 0.2}s` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
