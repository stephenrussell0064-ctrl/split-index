import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchSquads } from "@/lib/social/queries";
import { normalizeInviteCode } from "@/lib/social/squads";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const inviteCode = normalizeInviteCode(String(body.inviteCode ?? ""));
  if (!inviteCode) {
    return NextResponse.json({ error: "Invite code required" }, { status: 400 });
  }

  // Squads are only SELECT-able by existing members, so the code -> id lookup
  // needs the admin client — the code itself is the trust boundary, and the
  // membership insert right below still runs through the user's own client.
  const admin = createAdminClient();
  const { data: squad } = await admin
    .from("squads")
    .select("id")
    .eq("invite_code", inviteCode)
    .maybeSingle();

  if (!squad) {
    return NextResponse.json({ error: "No squad found for that invite code" }, { status: 404 });
  }

  const { error } = await supabase
    .from("squad_members")
    .insert({ squad_id: squad.id, user_id: user.id });

  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const squads = await fetchSquads(supabase, user.id);
  return NextResponse.json({ squads });
}
