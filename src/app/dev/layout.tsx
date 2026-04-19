import { notFound } from "next/navigation";

/**
 * Guard for everything under `/dev/*`. Any route nested below this
 * layout returns 404 in production builds, so dev-only preview
 * routes (like /dev/errors) can't be accessed even if they slip
 * through into a deploy. `process.env.NODE_ENV` is inlined by the
 * bundler at build time, so the check disappears in dev and
 * short-circuits immediately in prod.
 */
export default function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <>{children}</>;
}
