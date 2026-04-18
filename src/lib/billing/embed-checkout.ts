/**
 * Client-side helper that asks our server for a Polar checkout URL
 * and opens Polar's embedded checkout modal in-page. Used by both
 * the storage-quota modal's Upgrade button and the Settings → Billing
 * Upgrade button so they never redirect away from securewarp.com.
 *
 * The modal is a Polar-hosted iframe with postMessage signalling;
 * the SDK manages the DOM. We hook `success` to refresh the caller
 * via the provided onSuccess callback, and `close` to reset any
 * local spinner state.
 */

export type EmbedCheckoutResult =
  | { ok: true; status: "success" | "closed" }
  | { ok: false; error: string };

export async function openEmbeddedCheckout(
  onSuccess?: () => void,
): Promise<EmbedCheckoutResult> {
  try {
    const res = await fetch("/api/billing/checkout", { method: "POST" });
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      return { ok: false, error: data.error ?? "Failed to start checkout" };
    }

    // Dynamic import keeps the Polar embed bundle out of the main
    // JS chunk — only loaded when a user actually clicks Upgrade.
    const { PolarEmbedCheckout } = await import("@polar-sh/checkout/embed");
    const instance = await PolarEmbedCheckout.create(data.url, { theme: "dark" });

    return new Promise((resolve) => {
      instance.addEventListener("success", () => {
        onSuccess?.();
        resolve({ ok: true, status: "success" });
      });
      instance.addEventListener("close", () => {
        resolve({ ok: true, status: "closed" });
      });
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
