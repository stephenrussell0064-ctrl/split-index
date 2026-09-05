import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recomputeUser, RecomputeError } from "@/lib/activities/recompute-user";

/**
 * Re-scores every one of the CALLER'S OWN past activities with the current
 * scoring engine.
 *
 * This route is now only the auth boundary: it establishes who is asking and
 * hands their id to `recomputeUser`, which holds the actual work. The bulk
 * script (`scripts/recompute-all-users.ts`) calls that same function with a
 * service-role client, so a calibration change is applied by one
 * implementation rather than two that can drift apart.
 *
 * Deliberately takes no parameters. The user comes from the session and
 * nothing else, so there is no shape of request that recomputes somebody
 * else's data.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await recomputeUser(supabase, user.id);
    return NextResponse.json(result);
  } catch (err) {
    // Preserves the statuses this route returned before the extraction — a
    // missing profile was a 404 and a failed activity read a 500, and the
    // client distinguishes them.
    if (err instanceof RecomputeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
