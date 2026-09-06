import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveAdminRole } from "@/lib/auth/admin-role";

/**
 * "Am I an operator?" — the one question the client needs answered in order to
 * decide whether to show a link to the fleet page.
 *
 * WHY THIS EXISTS. `/admin/hpe-fleet` is where the Hybrid Plan Engine's rollout
 * is turned on, and the feature ships disabled (migration 040 seeds the flag
 * `enabled = FALSE, 0%`). That page is `notFound()` for anyone who is not an
 * admin — correct — but it was also linked from nowhere at all, so the only way
 * to reach the control that makes the app's flagship feature visible to
 * athletes was to know the URL and type it. A kill switch nobody can find is
 * not a kill switch; it is an off switch.
 *
 * Returns the role, or 404 for everyone else. Deliberately the same answer a
 * non-admin gets from the page itself: this endpoint must not become a way to
 * discover that an admin surface exists.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const identity = await resolveAdminRole(user.id);
  if (!identity) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ role: identity.role });
}
