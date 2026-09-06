import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminRole } from "@/lib/auth/admin-role";

/**
 * WP6.4 — record every attempt to reach an admin surface.
 *
 * The fleet view runs the one service-role query in the app that crosses every
 * athlete's row level security. "Who looked, and when" is the first question an
 * incident asks, and until this existed nothing could answer it — migration 041
 * audits rollout CHANGES, which is a different event.
 *
 * Denials are recorded as well as grants. A non-admin hitting an admin route is
 * not an error to swallow: repeated denials from one account are the signature
 * of somebody probing, and a log of successes only cannot show an attempt that
 * failed.
 */

/**
 * The fields a caller may attach. Deliberately narrow.
 *
 * `detail` is jsonb at the database and would take anything, which is exactly
 * why the TYPE here is restrictive: request parameters are numbers, booleans
 * and short strings. Widening this to `Record<string, unknown>` would make
 * "just log the payload" a one-word change, and the payload is where the health
 * data lives.
 */
export type AuditDetail = Record<string, string | number | boolean | null>;

export interface AdminAccessEvent {
  userId: string | null;
  role: AdminRole | null;
  /** The route, not a description — so these group. */
  route: string;
  action: "read" | "write";
  granted: boolean;
  detail?: AuditDetail;
}

/**
 * Field names that must never be logged, whatever the caller passes.
 *
 * A runtime backstop on the rule in the migration's comment. The comment is for
 * the person writing the next call site; this is for the one who does not read
 * it. Cheap next to the query that produced the payload — the same reasoning as
 * `assertNoIdentifiers` in the fleet route.
 */
const FORBIDDEN_DETAIL_KEYS = [
  "bodyweight",
  "weight",
  "hr",
  "heart_rate",
  "heartrate",
  "hrv",
  "parq",
  "injury",
  "pregnan",
  "lea_",
  "email",
  "token",
  "password",
  "secret",
  "key",
];

/** Strip anything that looks like health data or a credential. */
export function sanitiseDetail(detail: AuditDetail): AuditDetail {
  const safe: AuditDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_DETAIL_KEYS.some((forbidden) => lower.includes(forbidden))) continue;
    safe[key] = value;
  }
  return safe;
}

/**
 * Write one audit row.
 *
 * NEVER THROWS, and never blocks the request. An audit write that can fail the
 * thing it is auditing turns a logging outage into a product outage, and the
 * operator staring at a broken fleet dashboard during an incident is the last
 * person who should be debugging the audit table. A failure here is logged and
 * swallowed.
 *
 * That is a real trade: it means a determined attacker who can break the audit
 * write gets an unlogged access. The alternative — refusing the request —
 * protects the log at the cost of the incident response it exists to support,
 * and on balance the log is the thing that should degrade.
 */
export async function recordAdminAccess(event: AdminAccessEvent): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("admin_access_log").insert({
      admin_user_id: event.userId,
      admin_role: event.role,
      route: event.route,
      action: event.action,
      granted: event.granted,
      detail: sanitiseDetail(event.detail ?? {}),
    });
  } catch (error) {
    console.error("[admin-audit] failed to record an admin access", {
      route: event.route,
      granted: event.granted,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
