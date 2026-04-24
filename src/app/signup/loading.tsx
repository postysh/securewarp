/**
 * Matching /signup streaming shell. Same rationale as
 * /login/loading.tsx — navigating in from the marketing route group
 * otherwise flashes the body's default bg before AuthScreen mounts.
 */
export default function SignupLoading() {
  return <div className="h-full bg-bg-side" />;
}
