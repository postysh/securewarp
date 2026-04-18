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
  tier: "plus" | "pro" = "plus",
): Promise<EmbedCheckoutResult> {
  try {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      return { ok: false, error: data.error ?? "Failed to start checkout" };
    }

    // Dynamic import keeps the Polar embed bundle out of the main
    // JS chunk — only loaded when a user actually clicks Upgrade.
    const { PolarEmbedCheckout } = await import("@polar-sh/checkout/embed");

    // Polar's embed adds body.polar-no-scroll but the app's scroll
    // container is <html> (body has overflow-x only), so its class
    // has no effect and the page keeps scrolling behind the modal.
    // Pin html overflow ourselves and restore on close.
    const htmlEl = document.documentElement;
    const prevOverflow = htmlEl.style.overflow;
    htmlEl.style.overflow = "hidden";

    const instance = await PolarEmbedCheckout.create(data.url, { theme: "dark" });

    return new Promise((resolve) => {
      let done = false;
      const finish = (status: "success" | "closed") => {
        if (done) return;
        done = true;
        htmlEl.style.overflow = prevOverflow;
        resolve({ ok: true, status });
      };
      instance.addEventListener("success", () => {
        onSuccess?.();
        finish("success");
      });
      instance.addEventListener("close", () => finish("closed"));
    });
  } catch (err) {
    // Restore scroll if we added the lock but the embed failed to open.
    try { document.documentElement.style.overflow = ""; } catch { /* */ }
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
