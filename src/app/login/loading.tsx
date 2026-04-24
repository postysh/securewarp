/**
 * Streaming shell while /login's client bundle is fetched +
 * hydrated. Prevents the white-flash-during-route-transition when
 * coming from the marketing `(marketing)` route group: those pages
 * use a different layout tree, so navigating to /login tears down
 * the marketing layout and briefly shows the document body's
 * default bg before AuthScreen mounts and paints `bg-bg-side`.
 *
 * Intentionally empty beyond the themed bg — a loading dot or
 * skeleton here reads as a flicker in its own right because
 * AuthScreen paints fully-formed content the very next frame.
 * Server component = zero JS shipped for the fallback itself.
 */
export default function LoginLoading() {
  return <div className="h-full bg-bg-side" />;
}
