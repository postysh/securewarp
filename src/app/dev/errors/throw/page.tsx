"use client";

/**
 * Dev-only route that throws on render to trigger the nearest
 * `error.tsx` boundary. Visit /dev/errors/throw to see what the
 * route-level error page looks like with a real error object +
 * digest. Delete alongside /dev/errors/ before shipping.
 */
export default function ThrowOnRender() {
  throw new Error(
    "Deliberate test throw from /dev/errors/throw — see src/app/error.tsx",
  );
}
