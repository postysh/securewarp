import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy singleton. Cloudflare Workers Builds runs the Next.js build step
// without runtime secrets in scope (the `collect page data` phase imports
// every API route module). If we throw at module evaluation, the build
// fails even though nothing actually queries Supabase at build time.
//
// Using a Proxy defers the env var check until first property access —
// i.e. when a handler actually runs `supabase.from(...)` — so the build
// completes cleanly and the real check fires on the first real request.
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  }
  _client = createClient(supabaseUrl, supabaseServiceKey);
  return _client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
