import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getEntitlements } from "@/lib/billing/customers";
import { syncLatestSubscriptionFor } from "@/lib/billing/sync";
import { logError } from "@/lib/log";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // All owned files with their trash state
    const { data, error } = await supabase
      .from("files")
      .select("size_bytes, deleted_at, id")
      .eq("owner_id", session.userId)
      .eq("upload_complete", true);

    if (error) throw error;

    const rows = data || [];
    let filesBytes = 0;
    let trashBytes = 0;
    let filesCount = 0;
    let trashCount = 0;
    for (const f of rows) {
      const size = (f as { size_bytes: number }).size_bytes || 0;
      if ((f as { deleted_at: string | null }).deleted_at) {
        trashBytes += size;
        trashCount++;
      } else {
        filesBytes += size;
        filesCount++;
      }
    }

    // Shared files (where user has access but doesn't own)
    const { data: shared, error: sharedErr } = await supabase
      .from("file_keys")
      .select("file_id")
      .eq("user_id", session.userId);
    if (sharedErr) throw sharedErr;

    let sharedCount = 0;
    if (shared) {
      const { data: ownedIds } = await supabase
        .from("files")
        .select("id")
        .eq("owner_id", session.userId);
      const ownedSet = new Set((ownedIds || []).map((r) => r.id));
      sharedCount = shared.filter((r) => !ownedSet.has(r.file_id)).length;
    }

    const usedBytes = filesBytes + trashBytes;
    // Pull latest state from Stripe before reading tier so the max
    // shown here matches the Plan & billing panel even when webhook
    // delivery is unavailable (dev) or delayed. Same pattern as
    // /api/billing/status.
    try { await syncLatestSubscriptionFor(session.userId); }
    catch (e) { logError("files.usage.sync", e); }
    const ent = await getEntitlements(session.userId);
    const maxBytes = ent.storageGB * 1024 * 1024 * 1024;

    return NextResponse.json({
      usedBytes,
      maxBytes,
      maxFileSizeBytes: ent.maxFileSizeBytes,
      versionCount: ent.versionCount,
      versionTtlDays: ent.versionTtlDays,
      tierLabel: ent.tierLabel,
      filesBytes,
      filesCount,
      trashBytes,
      trashCount,
      sharedCount,
    });
  } catch (err) {
    logError("files.usage", err);
    return NextResponse.json({ error: "Failed to get usage" }, { status: 500 });
  }
}
