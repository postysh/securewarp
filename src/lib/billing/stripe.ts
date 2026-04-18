import "server-only";
import Stripe from "stripe";
import { requireStripeConfig } from "./config";

/**
 * Singleton Stripe SDK client. Created lazily on first use so unit
 * tests that don't touch billing don't need STRIPE_SECRET_KEY set.
 * API version is pinned so upstream changes don't silently change
 * webhook payload shape; bump intentionally when regression testing.
 *
 * Workers runtime: the default Stripe SDK config uses Node's
 * `https` for HTTP and Node's `crypto` for webhook signature
 * verification. Neither behaves reliably on Cloudflare Workers
 * even with nodejs_compat — the HTTPS client can't reach
 * api.stripe.com cleanly and crypto.timingSafeEqual is missing
 * in Workers' subset. Swap in the SDK's Fetch + SubtleCrypto
 * providers, which are designed for Workers / edge runtimes.
 */
let _client: Stripe | null = null;

export function stripe(): Stripe {
  if (_client) return _client;
  const { secretKey } = requireStripeConfig();
  _client = new Stripe(secretKey, {
    apiVersion: "2026-03-25.dahlia",
    typescript: true,
    httpClient: Stripe.createFetchHttpClient(),
  });
  return _client;
}

/**
 * Webhook signature verification needs a SubtleCrypto-backed
 * provider instead of Node's crypto. Pass this to
 * `constructEventAsync` (the async variant — the sync one still
 * uses Node crypto under the hood).
 */
let _cryptoProvider: ReturnType<typeof Stripe.createSubtleCryptoProvider> | null = null;
export function stripeCryptoProvider() {
  if (!_cryptoProvider) {
    _cryptoProvider = Stripe.createSubtleCryptoProvider();
  }
  return _cryptoProvider;
}
