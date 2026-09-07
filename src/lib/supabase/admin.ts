import "server-only";
import { createClient } from "@supabase/supabase-js";
import { logSecurityEvent, type LogValue } from "@/lib/observability/security-log";
import { correlationId } from "@/lib/api/errors";

/**
 * The service-role Supabase client. This key bypasses row level security
 * entirely — every policy written in migration 056 and everywhere else is
 * simply not applied to queries made with it.
 *
 * `import "server-only"` is the first line for that reason. It is not a
 * convention or a comment: the package's browser entry point throws at build
 * time, so importing this module from anything that ends up in a client bundle
 * fails the build rather than shipping the key. Before it, nothing but
 * discipline stood between this file and a `"use client"` component.
 *
 * WHERE THIS IS USED, AND WHY EACH ONE IS JUSTIFIED
 * ------------------------------------------------
 * Twelve call sites, all server-side, all needing to act outside one user's
 * RLS scope. Kept here rather than scattered so the list can be read in one
 * place and audited without a grep — verify it with:
 *
 *   grep -rln createAdminClient src --include=*.ts --include=*.tsx
 *
 * SECURITY.md carries the same table for whoever is holding the incident.
 *
 *   api/stripe/webhook          Stripe calls us, not a signed-in user. There is
 *                               no session to scope to; the caller is proved by
 *                               the signature, not by a cookie.
 *   api/revenuecat/webhook      Same shape, same reason.
 *   api/cron/leaderboard        Ranks every athlete against every other. A
 *                               user-scoped client sees one row.
 *   api/cron/hybrid-reports     Generates reports for every eligible athlete on
 *                               a schedule, with nobody signed in.
 *   api/account/delete          Deletes the auth user itself, which the user's
 *                               own client cannot do, and must complete even if
 *                               a policy would have blocked part of it.
 *   api/hpe/admin/fleet         Fleet-wide read, behind resolveAdminRole.
 *   api/hpe/admin/rollout       Fleet-wide write, behind resolveAdminRole and
 *                               an audit row.
 *   api/races                   Writes the shared known-race catalogue, which
 *                               is reference data no single user owns.
 *   api/squads/join             Reads a squad by invite code before the joiner
 *                               is a member, so RLS cannot see it yet.
 *   lib/supabase/ensure-profile Creates the profile row a brand-new user does
 *                               not yet have, so there is no row to scope to.
 *   lib/auth/admin-role         Resolves the admin role itself — deliberately
 *                               not through the user's own client, so a mistake
 *                               in the admin_users policy cannot grant the role.
 *   lib/auth/admin-audit        Writes admin_access_log, which has no RLS
 *                               policies at all — an admin who could read or
 *                               edit the log of their own accesses defeats the
 *                               point of keeping one.
 *
 * Adding a thirteenth means adding it to that list and to SECURITY.md. If the
 * reason is "it was easier", it is the wrong client.
 *
 * N9 — WHY THE RECORD IS MADE HERE AND NOT AT EACH CALL SITE
 * ---------------------------------------------------------
 * WP7 lists elevated-credential queries among the events to record, and one of
 * twelve sites was recording one. The obvious fix is to add a `logSecurityEvent`
 * call to the other eleven, and it is the wrong fix: it records the eleven that
 * exist today and nothing about the thirteenth, which will be added by somebody
 * who has never read this file.
 *
 * So `source` is a REQUIRED argument. The compiler now refuses a call that does
 * not say where it is from, which means the record cannot be forgotten — it can
 * only be wrong, and a wrong one is visible in review in a way a missing one is
 * not.
 *
 * WHAT THIS RECORDS, PRECISELY
 * ---------------------------
 * That an elevated client was OBTAINED here, not that a query was made with it.
 * A handler that builds one and then returns early still logs. That is
 * deliberate: over-recording the availability of a service-role client is the
 * cheap error, and the alternative — wrapping every query method — is a large
 * surface for a smaller gain. The log line says "obtained", not "queried", so
 * nobody reads it as more than it is.
 *
 * There is no recursion risk in logging from here even though `admin-audit`
 * uses this client: `logSecurityEvent` writes to stdout and touches no table.
 */
export function createAdminClient(
  source: string,
  context: { userId?: string | null; detail?: Record<string, LogValue> } = {}
) {
  logSecurityEvent({
    type: "elevated_query",
    correlationId: correlationId(),
    userId: context.userId ?? null,
    source,
    outcome: "allowed",
    retention: "audit",
    detail: { action: "service_role_client_obtained", ...context.detail },
  });

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
