/**
 * Matching /signup streaming skeleton. Same rationale as
 * /login/loading.tsx — navigating in from the marketing route group
 * otherwise flashes the body's default bg before AuthScreen mounts.
 */
export default function SignupLoading() {
  return (
    <div className="h-full flex items-center justify-center bg-bg-side">
      <div className="w-2 h-2 rounded-full bg-text-tertiary animate-pulse" />
    </div>
  );
}
