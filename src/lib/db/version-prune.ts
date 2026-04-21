import "server-only";
import { supabase } from "./supabase";
import { deleteFileVersion } from "./files";
import { deleteBlob } from "./r2";
import { getEntitlements } from "@/lib/billing/customers";
import { logError } from "@/lib/log";

/**
 * Prune past versions of a single file to the owner's retention caps.
 *
 * Two caps apply, whichever trips first:
 *   - `versionCount`: retain the current version plus the N most recent
 *     prior versions. Older prior versions get deleted.
 *   - `versionTtlDays`: any version (current or otherwise) older than
 *     this gets deleted — except the current version, which is always
 *     kept so the file remains downloadable.
 *
 * Caller is the file owner. Permissioning is the caller's job; this
 * helper is a data-layer utility.
 *
 * Returns a summary: how many versions were deleted and how many R2
 * blobs were purged. R2 errors are logged and swallowed (same pattern
 * as the delete-version endpoint) so a single orphan blob doesn't
 * abort the whole prune run.
 */
export interface PruneSummary {
  versionsDeleted: number;
  blobsPurged: number;
}

export async function pruneVersionsForFile(
  ownerUserId: string,
  fileId: string,
): Promise<PruneSummary> {
  const ent = await getEntitlements(ownerUserId);

  const { data: fileRow } = await supabase
    .from("files")
    .select("id, owner_id, current_version_number")
    .eq("id", fileId)
    .eq("owner_id", ownerUserId)
    .maybeSingle();
  if (!fileRow) return { versionsDeleted: 0, blobsPurged: 0 };
  const currentVersionNumber = fileRow.current_version_number as number;

  const { data: versions } = await supabase
    .from("file_versions")
    .select("id, version_number, created_at")
    .eq("file_id", fileId)
    .order("version_number", { ascending: false });
  if (!versions || versions.length === 0) {
    return { versionsDeleted: 0, blobsPurged: 0 };
  }

  const ttlCutoff = Date.now() - ent.versionTtlDays * 24 * 60 * 60 * 1000;
  const toDelete: string[] = [];
  // Walk newest → oldest. Past versions are indexed by their rank
  // *excluding* the current one: the 1st past version is the most
  // recent pre-current, the 2nd past is one before that, etc.
  let pastVersionRank = 0;
  for (const v of versions) {
    const versionNum = v.version_number as number;
    const isCurrent = versionNum === currentVersionNumber;
    if (isCurrent) continue;
    pastVersionRank++;
    // Count-based: keep only the first `versionCount` past versions.
    const exceedsCount = pastVersionRank > ent.versionCount;
    // TTL-based: drop anything older than the cutoff.
    const createdAt = new Date(v.created_at as string).getTime();
    const exceedsTtl = Number.isFinite(createdAt) && createdAt < ttlCutoff;
    if (exceedsCount || exceedsTtl) {
      toDelete.push(v.id as string);
    }
  }

  if (toDelete.length === 0) return { versionsDeleted: 0, blobsPurged: 0 };

  let blobsPurged = 0;
  for (const versionId of toDelete) {
    let orphaned: string[] = [];
    try {
      orphaned = await deleteFileVersion(versionId);
    } catch (err) {
      logError("version-prune.delete", { fileId, versionId, err });
      continue;
    }
    for (const key of orphaned) {
      try {
        await deleteBlob(key);
        blobsPurged++;
      } catch (err) {
        logError("version-prune.r2", { fileId, versionId, key, err });
      }
    }
  }

  // Recount remaining versions so files.version_count stays honest.
  // Same pattern as the manual-delete endpoint.
  const { count: remaining } = await supabase
    .from("file_versions")
    .select("id", { count: "exact", head: true })
    .eq("file_id", fileId);
  await supabase
    .from("files")
    .update({
      version_count: Math.max(1, remaining ?? 1),
      updated_at: new Date().toISOString(),
    })
    .eq("id", fileId);

  return { versionsDeleted: toDelete.length, blobsPurged };
}
