import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext config for Cloudflare Workers. The default export is used by
// `opennextjs-cloudflare build` to bundle the Next.js app for Workers.
//
// Incremental cache / tag cache / queue are all optional; we omit them
// for now and rely on Next's default in-memory caching. If we later add
// ISR-heavy pages we can wire these to KV or R2.
export default defineCloudflareConfig({});
