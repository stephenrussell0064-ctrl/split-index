import { NextResponse } from "next/server";
import { validateDisplayText } from "@/lib/utils/username";
import { databaseError, serverError } from "@/lib/api/errors";
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
  /*
    A squad name is user-generated content every member and every invitee reads,
    and it went through no filter at all — App Store Guideline 1.2 requires "a
    method for filtering objectionable material from being posted to the app",
    and the app's only filter ran on usernames. Server-side because a client
    check is a suggestion.
  */
  const nameCheck = validateDisplayText(name, { label: "Squad name", maxLength: MAX_NAME_LENGTH });
  if (!nameCheck.valid) {
    return NextResponse.json({ error: nameCheck.reason }, { status: 400 });
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
    return serverError({ operation: "POST /api/squads", cause: error });
  }

  const { error: memberError } = await supabase
    .from("squad_members")
    .insert({ squad_id: squad.id, user_id: user.id });

  if (memberError) {
    return databaseError(memberError, { operation: "POST /api/squads" });
  }

  const squads = await fetchSquads(supabase, user.id);
  return NextResponse.json({ squads });
}
