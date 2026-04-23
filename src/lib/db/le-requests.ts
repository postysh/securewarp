import "server-only";
import { supabase } from "./supabase";

/**
 * Admin intake log for legal process (subpoenas, warrants,
 * preservation orders, MLAT, NSLs). Populated by hand because
 * legal process doesn't arrive through the product — admins see
 * the request via email or mail and log it here so the
 * transparency report can count it.
 */

export type LeRequestType =
  | "subpoena-us"
  | "warrant-us"
  | "preservation-us"
  | "mlat"
  | "nsl"
  | "other";

export type LeRequestStatus = "pending" | "produced" | "challenged" | "rejected";

export interface LeRequestRow {
  id: string;
  received_at: string;
  type: LeRequestType;
  jurisdiction: string | null;
  status: LeRequestStatus;
  produced_at: string | null;
  gag_order_until: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLeRequestInput {
  receivedAt: string;
  type: LeRequestType;
  jurisdiction?: string | null;
  gagOrderUntil?: string | null;
  notes?: string | null;
  createdByUserId: string;
}

export async function createLeRequest(
  input: CreateLeRequestInput,
): Promise<LeRequestRow> {
  const { data, error } = await supabase
    .from("law_enforcement_requests")
    .insert({
      received_at: input.receivedAt,
      type: input.type,
      jurisdiction: input.jurisdiction ?? null,
      gag_order_until: input.gagOrderUntil ?? null,
      notes: input.notes ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createLeRequest failed: ${error.message}`);
  return data as LeRequestRow;
}

export async function listLeRequests(opts: {
  status?: LeRequestStatus;
  limit?: number;
} = {}): Promise<LeRequestRow[]> {
  let q = supabase
    .from("law_enforcement_requests")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as LeRequestRow[];
}

export interface UpdateLeRequestInput {
  status?: LeRequestStatus;
  producedAt?: string | null;
  gagOrderUntil?: string | null;
  notes?: string | null;
  jurisdiction?: string | null;
}

export async function updateLeRequest(
  id: string,
  patch: UpdateLeRequestInput,
): Promise<LeRequestRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.producedAt !== undefined) update.produced_at = patch.producedAt;
  if (patch.gagOrderUntil !== undefined) update.gag_order_until = patch.gagOrderUntil;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.jurisdiction !== undefined) update.jurisdiction = patch.jurisdiction;

  // If we're transitioning to "produced" and the caller didn't set
  // produced_at explicitly, timestamp it now.
  if (patch.status === "produced" && patch.producedAt === undefined) {
    update.produced_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("law_enforcement_requests")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateLeRequest failed: ${error.message}`);
  return data as LeRequestRow;
}
