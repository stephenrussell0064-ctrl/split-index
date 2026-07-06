import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sport, formData } = await request.json();

  const { data, error } = await supabase
    .from("workout_drafts")
    .upsert(
      {
        user_id: user.id,
        sport,
        form_data: formData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,sport" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ draft: data });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport");

  let query = supabase.from("workout_drafts").select("*").eq("user_id", user.id);

  if (sport) {
    query = query.eq("sport", sport);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ drafts: data });
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
  const sport = searchParams.get("sport");

  if (!sport) {
    return NextResponse.json({ error: "sport is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("workout_drafts")
    .delete()
    .eq("user_id", user.id)
    .eq("sport", sport);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
