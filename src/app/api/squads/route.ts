import { parseBody } from "@/lib/validation/boundary";
import {
  MAX_SQUAD_NAME_LENGTH,
  createSquadSchema,
} from "@/lib/validation/schemas/social";
import { NextResponse } from "next/server";
import { validateDisplayText } from "@/lib/utils/username";
import { databaseError, serverError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { fetchSquads } from "@/lib/social/queries";
import { generateInviteCode } from "@/lib/social/squads";


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

  /*
    N1. This used to `.slice(0, MAX_NAME_LENGTH)`, which silently truncated: an
    athlete who typed a long squad name got a shorter one back with nothing
    saying so. The schema refuses and names the field, which is not stricter —
    it is honest about what happened.

    The length itself is unchanged. MAX_SQUAD_NAME_LENGTH is the same 40 that
    was here, moved into the schema module so the validator and the content
    check below cannot drift apart.
  */
  const parsed = await parseBody(request, createSquadSchema);
  if (parsed.response) return parsed.response;
  const name = parsed.data.name;
  /*
    A squad name is user-generated content every member and every invitee reads,
    and it went through no filter at all — App Store Guideline 1.2 requires "a
    method for filtering objectionable material from being posted to the app",
    and the app's only filter ran on usernames. Server-side because a client
    check is a suggestion.
  */
  const nameCheck = validateDisplayText(name, { label: "Squad name", maxLength: MAX_SQUAD_NAME_LENGTH });
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
