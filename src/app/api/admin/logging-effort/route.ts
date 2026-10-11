import { NextResponse } from "next/server";
import { parseQuery } from "@/lib/validation/boundary";
import { windowDaysQuerySchema } from "@/lib/validation/schemas/query";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdminRole } from "@/lib/auth/admin-role";
import { recordAdminAccess } from "@/lib/auth/admin-audit";

/**
 * GET /api/admin/logging-effort?days=84 — the logging-effort plan's
 * measurement, read from the three weekly views migration 090 creates.
 *
 * Same gate and the same audit row as the Hybrid Plan fleet route: a
 * non-admin gets a 404 and a recorded denial; an admin's read is recorded
 * with its window. Aggregate only — the views carry no user id, and this
 * route adds nothing to them. The targets the plan set travel with the
 * numbers so the page can show the gap rather than leave it to memory.
 */

const DEFAULT_WINDOW_DAYS = 84;
const ROUTE = "/api/admin/logging-effort";

/** The plan's own targets, stated once, beside the numbers. */
export const LOGGING_EFFORT_TARGETS = {
  gymFieldsTouched: { typedBaseline: 60, target: 10, note: "gym sessions, median fields filled by hand" },
  cardioSecondsToSave: { target: 20, note: "cardio sessions from an import, median seconds from open to save" },
  appleHealthShare: { target: 0.5, note: "share of cardio sessions with source apple_health, within a month of phase 1 shipping" },
  prescribedAccepted: { target: 0.5, note: "share of prescribed sets logged untouched on plan days" },
  weeklyActiveLoggers: { note: "the one that matters: rising, not just effort per log falling" },
} as const;

export async function GET(request: Request) {
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

  const q = parseQuery(request, windowDaysQuerySchema(DEFAULT_WINDOW_DAYS));
  if (q.response) return q.response;
  const windowDays = q.data.days;
  await recordAdminAccess({
    userId: user.id,
    role: identity.role,
    route: ROUTE,
    action: "read",
    granted: true,
    detail: { windowDays },
  });

  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const admin = createAdminClient(ROUTE);

  const [{ data: effort, error: effortError }, { data: recovery, error: recoveryError }, { data: loggers, error: loggersError }] =
    await Promise.all([
      admin.from("logging_effort_weekly").select("*").gte("week_start", since).order("week_start", { ascending: true }),
      admin.from("recovery_inputs_weekly").select("*").gte("week_start", since).order("week_start", { ascending: true }),
      admin.from("active_loggers_weekly").select("*").gte("week_start", since).order("week_start", { ascending: true }),
    ]);

  const missing = [effortError, recoveryError, loggersError].find((e) => e != null);
  if (missing) {
    // The views are migration 090; a database behind on it answers with the
    // unknown relation, and the page says so rather than showing zeros.
    console.error("[admin/logging-effort] view read failed (migration 090?):", missing.message);
    return NextResponse.json(
      { error: "The measurement views are not available. Apply migration 090." },
      { status: 503 }
    );
  }

  return NextResponse.json({
    windowDays,
    since,
    effort: effort ?? [],
    recovery: recovery ?? [],
    loggers: loggers ?? [],
    targets: LOGGING_EFFORT_TARGETS,
  });
}
