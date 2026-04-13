import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const CreateSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().min(1).max(100),
});

const DeleteSchema = z.object({
  labelId: z.string().uuid(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("labels")
      .select("id, name, color, sort_order")
      .eq("user_id", session.userId)
      .order("sort_order");
    if (error) throw error;

    return NextResponse.json({ labels: data || [] });
  } catch (err) {
    logError("labels.list", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    // Limit to 10 labels
    const { count } = await supabase
      .from("labels")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.userId);
    if ((count ?? 0) >= 10) {
      return NextResponse.json({ error: "Maximum 10 labels reached" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("labels")
      .insert({ user_id: session.userId, name: parsed.data.name, color: parsed.data.color })
      .select("id, name, color")
      .single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Label already exists" }, { status: 409 });
      throw error;
    }

    return NextResponse.json({ label: data });
  } catch (err) {
    logError("labels.create", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    const { error } = await supabase
      .from("labels")
      .delete()
      .eq("id", parsed.data.labelId)
      .eq("user_id", session.userId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("labels.delete", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
