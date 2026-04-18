import "server-only";
import Stripe from "stripe";
import { requireStripeConfig } from "./config";

/**
 * Singleton Stripe SDK client. Created lazily on first use so unit
 * tests that don't touch billing don't need STRIPE_SECRET_KEY set.
 * API version is pinned so upstream changes don't silently change
 * webhook payload shape; bump intentionally when regression testing.
 */
let _client: Stripe | null = null;

export function stripe(): Stripe {
  if (_client) return _client;
  const { secretKey } = requireStripeConfig();
  _client = new Stripe(secretKey, {
    apiVersion: "2026-03-25.dahlia",
    typescript: true,
  });
  return _client;
}
