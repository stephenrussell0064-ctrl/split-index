import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectBrowserTimezone } from "@/lib/utils/timezone";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const timezone =
    typeof body.timezone === "string" && body.timezone.trim()
      ? body.timezone.trim()
      : detectBrowserTimezone();

  const { error } = await supabase
    .from("profiles")
    .update({ timezone })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ timezone });
}
