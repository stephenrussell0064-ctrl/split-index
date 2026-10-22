import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdminRole } from "@/lib/auth/admin-role";
import { recordAdminAccess } from "@/lib/auth/admin-audit";
import { computeHeadroom, type HeadroomRaw } from "@/lib/admin/supabase-headroom";

/**
 * GET /api/admin/supabase-headroom — how close the project is to the
 * Supabase free-plan limits, read from migration 092's function.
 *
 * Same gate and the same audit row as the other admin routes: a non-admin
 * gets a 404 and a recorded denial; an admin's read is recorded. Aggregate
 * only — counts and byte totals, never a row. A database behind on 092
 * answers with a 503 that names it rather than a card of zeros.
 */

const ROUTE = "/api/admin/supabase-headroom";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const identity = await resolveAdminRole(user.id);
  if (!identity) {
    await recordAdminAccess({ userId: user.id, role: null, route: ROUTE, action: "read", granted: false });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await recordAdminAccess({ userId: user.id, role: identity.role, route: ROUTE, action: "read", granted: true });

  const admin = createAdminClient(ROUTE);
  const { data, error } = await admin.rpc("supabase_headroom");
  if (error || !data) {
    console.error("[admin/supabase-headroom] function call failed (migration 092?):", error?.message);
    return NextResponse.json(
      { error: "The headroom function is not available. Apply migration 092." },
      { status: 503 }
    );
  }

  return NextResponse.json(computeHeadroom(data as HeadroomRaw));
}
