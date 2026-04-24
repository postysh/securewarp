/**
 * Streaming skeleton while /login's client bundle is fetched +
 * hydrated. Prevents the white-flash-during-route-transition when
 * coming from the marketing `(marketing)` route group: those pages
 * use a different layout tree, so navigating to /login tears down
 * the marketing layout and briefly shows the document body's
 * default bg before AuthScreen mounts and paints `bg-bg-side`.
 *
 * This shell covers the viewport with the same theme token so the
 * transition is seamless. Server component = zero JS shipped for
 * the fallback itself. Intentionally minimal: just the themed bg
 * and a centered loading dot. No auth form; that's the real page.
 */
export default function LoginLoading() {
  return (
    <div className="h-full flex items-center justify-center bg-bg-side">
      <div className="w-2 h-2 rounded-full bg-text-tertiary animate-pulse" />
    </div>
  );
}
