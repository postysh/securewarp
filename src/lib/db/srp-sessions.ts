import "server-only";
import { supabase } from "./supabase";

export interface SrpSessionRow {
  id: string;
  user_id: string;
  server_secret_ephemeral: string;
  client_public_ephemeral: string;
  created_at: string;
  expires_at: string;
}

export async function createSrpSession(data: {
  userId: string;
  serverSecretEphemeral: string;
  clientPublicEphemeral: string;
}): Promise<string> {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

  const { data: session, error } = await supabase
    .from("srp_sessions")
    .insert({
      user_id: data.userId,
      server_secret_ephemeral: data.serverSecretEphemeral,
      client_public_ephemeral: data.clientPublicEphemeral,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create SRP session: ${error.message}`);
  return session.id;
}

export async function getSrpSession(sessionId: string): Promise<SrpSessionRow | null> {
  // Clean up expired sessions
  await supabase.from("srp_sessions").delete().lt("expires_at", new Date().toISOString());

  const { data, error } = await supabase
    .from("srp_sessions")
    .select("*")
    .eq("id", sessionId)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch SRP session: ${error.message}`);
  }

  return data || null;
}

export async function deleteSrpSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("srp_sessions")
    .delete()
    .eq("id", sessionId);

  if (error) throw new Error(`Failed to delete SRP session: ${error.message}`);
}
