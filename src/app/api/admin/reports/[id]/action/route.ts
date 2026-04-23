import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { getReportById } from "@/lib/db/reports";
import {
  setEvidenceHold,
  clearEvidenceHold,
  setPreservationHold,
  clearPreservationHold,
  addBan,
  type BanReason,
} from "@/lib/db/trust-safety";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * POST /api/admin/reports/[id]/action — unified action dispatcher for
 * the report-card buttons. Every action:
 *   - validates the action against the report's current state
 *     (e.g. can't revoke a link on a non-link report)
 *   - performs the side effect
 *   - writes to admin_audit with a structured `detail` string
 *
 * Actions:
 *   revoke-link          — sets file_links.revoked_at
 *   suspend-uploader     — sets users.suspended_at
 *   unsuspend-uploader   — clears users.suspended_at (dismiss path)
 *   evidence-hold        — sets files.evidence_hold_at
 *   clear-evidence-hold  — clears files.evidence_hold_at
 *   set-preservation     — sets users.preservation_hold_at
 *   clear-preservation   — clears users.preservation_hold_at
 *   ban-uploader         — adds an entry to banned_identifiers keyed on
 *                          email + reporter_ip_hash. Meant for CSAM and
 *                          other terminal actions.
 */

const PARAMS = z.object({ id: z.string().uuid() });

const BODY = z.object({
  action: z.enum([
    "revoke-link",
    "suspend-uploader",
    "unsuspend-uploader",
    "evidence-hold",
    "clear-evidence-hold",
    "set-preservation",
    "clear-preservation",
    "ban-uploader",
  ]),
  banReason: z.enum(["csam", "abuse", "fraud", "manual"]).optional(),
  banIp: z.boolean().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const resolved = await params;
    const paramsParsed = PARAMS.safeParse(resolved);
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = BODY.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const report = await getReportById(paramsParsed.data.id);
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const { action } = parsed.data;
    let detail = "";

    switch (action) {
      case "revoke-link": {
        if (!report.link_id) {
          return NextResponse.json(
            { error: "Report is not attached to a share link" },
            { status: 400 },
          );
        }
        const { error } = await supabase
          .from("file_links")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", report.link_id)
          .is("revoked_at", null);
        if (error) throw new Error(error.message);
        detail = `revoked link=${report.link_id}`;
        break;
      }

      case "suspend-uploader": {
        const { error } = await supabase
          .from("users")
          .update({ suspended_at: new Date().toISOString() })
          .eq("id", report.file_owner_id)
          .is("suspended_at", null);
        if (error) throw new Error(error.message);
        detail = `suspended user=${report.file_owner_id}`;
        break;
      }

      case "unsuspend-uploader": {
        const { error } = await supabase
          .from("users")
          .update({ suspended_at: null })
          .eq("id", report.file_owner_id);
        if (error) throw new Error(error.message);
        detail = `unsuspended user=${report.file_owner_id}`;
        break;
      }

      case "evidence-hold": {
        if (!report.file_id) {
          return NextResponse.json(
            { error: "Report does not reference a file" },
            { status: 400 },
          );
        }
        await setEvidenceHold(report.file_id);
        detail = `evidence hold on file=${report.file_id}`;
        break;
      }

      case "clear-evidence-hold": {
        if (!report.file_id) {
          return NextResponse.json(
            { error: "Report does not reference a file" },
            { status: 400 },
          );
        }
        await clearEvidenceHold(report.file_id);
        detail = `cleared evidence hold on file=${report.file_id}`;
        break;
      }

      case "set-preservation": {
        await setPreservationHold(report.file_owner_id);
        detail = `preservation on user=${report.file_owner_id}`;
        break;
      }

      case "clear-preservation": {
        await clearPreservationHold(report.file_owner_id);
        detail = `cleared preservation on user=${report.file_owner_id}`;
        break;
      }

      case "ban-uploader": {
        // Email ban is always attempted; IP ban is opt-in because it's
        // fragile (VPNs, NATs, CGN). The best candidate for an IP ban
        // is the reporter_ip_hash captured on the report — that's the
        // IP the uploader used to serve the link (for anon reports)
        // or that a registered reporter came from. For authed-uploader
        // reports we don't have the uploader's IP at report time, but
        // preservation-hold logging fills that in going forward.
        const { data: ownerRow } = await supabase
          .from("users")
          .select("email")
          .eq("id", report.file_owner_id)
          .single();
        if (!ownerRow) {
          return NextResponse.json({ error: "Owner not found" }, { status: 404 });
        }
        const reason: BanReason = parsed.data.banReason ?? "abuse";
        // Collect the best available IP hashes for this uploader.
        // Preference order: their own captured login/upload IPs,
        // then the report's reporter_ip_hash if configured.
        const ipHashes: string[] = [];
        if (parsed.data.banIp) {
          // Try the preservation log first.
          const { data: ips } = await supabase
            .from("user_ip_log")
            .select("ip_hash")
            .eq("user_id", report.file_owner_id)
            .order("occurred_at", { ascending: false })
            .limit(5);
          if (ips) ipHashes.push(...ips.map((r) => r.ip_hash));
          // As a last resort, fall back to the report's captured IP
          // (which may be the UPLOADER's for anon share-link reports
          // where the reporter IS the uploader, but usually isn't).
          // Skip — it's the reporter, not the uploader — to avoid
          // banning innocent reporters.
        }
        await addBan({
          email: ownerRow.email,
          ipHash: null, // separate entry per IP below
          reason,
          sourceReportId: report.id,
          bannedByUserId: ctx.userId,
        });
        for (const ipHash of Array.from(new Set(ipHashes))) {
          await addBan({
            email: null,
            ipHash,
            reason,
            sourceReportId: report.id,
            bannedByUserId: ctx.userId,
          });
        }
        // Suspend the user too — a ban without suspension leaves an
        // active session that would still have drive access. Belt +
        // suspenders.
        await supabase
          .from("users")
          .update({ suspended_at: new Date().toISOString() })
          .eq("id", report.file_owner_id)
          .is("suspended_at", null);
        detail = `banned user=${report.file_owner_id} reason=${reason} ip_entries=${ipHashes.length}`;
        break;
      }
    }

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: `report.${action}`,
      targetUserId: report.file_owner_id,
      detail: `report=${report.id} ${detail}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("admin.reports.action", err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
