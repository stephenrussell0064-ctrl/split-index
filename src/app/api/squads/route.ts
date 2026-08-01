import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSquads } from "@/lib/social/queries";
import { generateInviteCode } from "@/lib/social/squads";

const MAX_NAME_LENGTH = 40;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const squads = await fetchSquads(supabase, user.id);
  return NextResponse.json({ squads });
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
  const name = String(body.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
  if (!name) {
    return NextResponse.json({ error: "Squad name required" }, { status: 400 });
  }

  let squad, error;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await supabase
      .from("squads")
      .insert({ name, invite_code: generateInviteCode(), created_by: user.id })
      .select()
      .single();
    squad = result.data;
    error = result.error;
    if (!error || error.code !== "23505") break;
  }

  if (error || !squad) {
    return NextResponse.json({ error: error?.message ?? "Failed to create squad" }, { status: 500 });
  }

  const { error: memberError } = await supabase
    .from("squad_members")
    .insert({ squad_id: squad.id, user_id: user.id });

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  const squads = await fetchSquads(supabase, user.id);
  return NextResponse.json({ squads });
}
