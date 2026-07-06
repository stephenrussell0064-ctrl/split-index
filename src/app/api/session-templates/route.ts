import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SportType } from "@/types";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport") as SportType | undefined;

  let query = supabase
    .from("session_templates")
    .select("id, name, sport, template_data, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (sport) {
    query = query.eq("sport", sport);
  }

  const { data, error } = await query.limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, sport, template_data } = body as {
    name?: string;
    sport?: SportType;
    template_data?: Record<string, unknown>;
  };

  if (!name?.trim() || !sport || !template_data) {
    return NextResponse.json(
      { error: "name, sport, and template_data are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("session_templates")
    .insert({
      user_id: user.id,
      name: name.trim(),
      sport,
      template_data,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ template: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("session_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
