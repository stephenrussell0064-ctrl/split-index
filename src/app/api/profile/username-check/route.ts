import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { validateUsernameFormat } from "@/lib/utils/username";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const username = (searchParams.get("u") ?? "").trim();

  const format = validateUsernameFormat(username);
  if (!format.valid) {
    return NextResponse.json({ available: false, reason: format.reason });
  }

  /*
    `profile_usernames`, not `profiles`.

    Reading the base table across athletes only worked because a policy from
    001 — `USING (username IS NOT NULL)`, with no TO clause — let ANY caller
    read ANY named profile, every column of it, the anon role included. 073
    removes that, and this is one of exactly two routes that depended on it.

    Not `public_profiles` either, which would look like the obvious choice.
    That view requires a confirmed email address (061), and uniqueness has to
    consider every account: `username` is UNIQUE at the column level, so
    checking only verified rows would report a name as free, let the athlete
    choose it, and fail the save with a constraint violation they cannot act
    on. `profile_usernames` is two columns over every profile, readable by
    signed-in callers only.
  */
  const { data, error } = await supabase
    .from("profile_usernames")
    .select("user_id")
    .ilike("username", username)
    .maybeSingle();

  if (error) {
    return databaseError(error, { operation: "GET /api/profile/username-check" });
  }

  const takenByOther = !!data && data.user_id !== user.id;
  return NextResponse.json({
    available: !takenByOther,
    reason: takenByOther ? "That username is taken" : undefined,
  });
}
