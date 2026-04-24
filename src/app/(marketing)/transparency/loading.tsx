/**
 * Streaming skeleton for /transparency. The page fetches live
 * aggregates from /api/transparency client-side, so a cold visit
 * otherwise shows a blank area until the response lands. Shell is
 * server-rendered (zero JS) so it paints as soon as the HTML streams.
 *
 * Numbers + headings are placeholder bars; real values fill in on
 * the client when the fetch resolves.
 */
export default function TransparencyLoading() {
  return (
    <div className="max-w-[760px] mx-auto px-6 py-16">
      {/* Title */}
      <div className="skeleton h-7 w-56 rounded-md mb-3" />
      <div className="skeleton h-4 w-full max-w-[480px] rounded-sm mb-10" />

      {/* Warrant canary card */}
      <div className="rounded-xl border border-border-secondary bg-bg-l3 p-6 mb-10">
        <div className="skeleton h-3 w-24 rounded-sm mb-3" />
        <div className="skeleton h-4 w-5/6 rounded-sm mb-1.5" />
        <div className="skeleton h-4 w-3/5 rounded-sm" />
      </div>

      {/* Table 1: reports */}
      <div className="skeleton h-5 w-48 rounded-sm mb-4" />
      <div className="rounded-xl border border-border-secondary overflow-hidden mb-10">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 h-12 border-b border-border-tertiary last:border-b-0"
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <div className="skeleton h-3 w-40 rounded-sm" />
            <div className="skeleton h-3 w-10 rounded-sm" />
          </div>
        ))}
      </div>

      {/* Table 2: actions */}
      <div className="skeleton h-5 w-40 rounded-sm mb-4" />
      <div className="rounded-xl border border-border-secondary overflow-hidden mb-10">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 h-12 border-b border-border-tertiary last:border-b-0"
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <div className="skeleton h-3 w-48 rounded-sm" />
            <div className="skeleton h-3 w-10 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
