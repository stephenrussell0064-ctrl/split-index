import { NextResponse } from "next/server";
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

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .ilike("username", username)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const takenByOther = !!data && data.user_id !== user.id;
  return NextResponse.json({
    available: !takenByOther,
    reason: takenByOther ? "That username is taken" : undefined,
  });
}
