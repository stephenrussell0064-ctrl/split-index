import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { detectBrowserTimezone, isValidTimezone } from "@/lib/utils/timezone";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const submitted = typeof body.timezone === "string" ? body.timezone.trim() : "";

  /*
    Rejected rather than stored, because an unknown zone is not a cosmetic
    problem. `Intl.DateTimeFormat` throws on one, and `localDateKeyInTz` runs
    inside the dashboard and analytics server components — so a single POST of
    `{"timezone":"Not/AZone"}` used to 500 the athlete's own home page
    permanently, with nothing in the app able to undo it.
  */
  if (submitted && !isValidTimezone(submitted)) {
    return NextResponse.json({ error: "Unrecognised time zone" }, { status: 400 });
  }

  const timezone = submitted || detectBrowserTimezone();

  const { error } = await supabase
    .from("profiles")
    .update({ timezone })
    .eq("user_id", user.id);

  if (error) {
    return databaseError(error, { operation: "POST /api/profile/timezone" });
  }

  return NextResponse.json({ timezone });
}
