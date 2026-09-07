import { NextResponse } from "next/server";
import { serverError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurityEvent } from "@/lib/observability/security-log";
import { correlationId } from "@/lib/api/errors";

/**
 * Erasure. One statement, because the schema already does the work.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS WORSE THAN IT LOOKED
 * --------------------------------------------------------
 * It walked a hard-coded list of nineteen tables, deleting from each in turn,
 * then handled friends/duels/squads by hand, then deleted the auth user.
 *
 * The schema has forty-one tables carrying a user column. Every one of them —
 * including the reverse-direction `friends.friend_id`, both sides of a duel,
 * and `squads.created_by` — declares `REFERENCES auth.users(id) ON DELETE
 * CASCADE`. So deleting the auth user removes all of it, and the list was
 * doing by hand, incompletely, what Postgres was going to do anyway.
 *
 * That mattered in three ways:
 *
 *  1. **It looked broken.** Twenty-two tables were absent from the list,
 *     including the entire Hybrid Plan surface — `hpe_intake`, injury reports,
 *     the athlete profile. Erasure was in fact complete, but only because of a
 *     mechanism the code did not mention, so the next person to read it would
 *     reasonably conclude health data survived deletion and "fix" it by
 *     lengthening the list.
 *  2. **It was not atomic.** Supabase's client has no transaction. A failure at
 *     table twelve returned a 500 with twelve tables already emptied and the
 *     login still working — the worst available outcome, and unrecoverable
 *     without an operator.
 *  3. **The list could only ever go stale.** A table added next month is
 *     covered by the cascade automatically and would never have been added
 *     here.
 *
 * WHAT SURVIVES, DELIBERATELY
 * ---------------------------
 * Three columns are `ON DELETE SET NULL` rather than CASCADE, and that is the
 * intended behaviour rather than an oversight:
 *
 *   admin_access_log.admin_user_id  an account being erased must not erase the
 *   security_events.user_id         record that it once read the fleet, or was
 *                                   denied repeatedly
 *   challenges.created_by           a challenge other athletes joined outlives
 *                                   the person who created it
 *
 * The rows survive without naming a live user, which is the balance between an
 * audit trail and the right to erasure. account-deletion.test.ts asserts that
 * every OTHER user-bearing table cascades, so a new table that does not is a
 * failing build rather than data left behind after a deletion request.
 */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  /*
   * Logged BEFORE the delete, because afterwards there is no user id to log —
   * and an erasure with no record that it was requested is indistinguishable
   * from data loss. The event itself contains no personal data beyond the id,
   * which is about to stop referring to anybody.
   */
  logSecurityEvent({
    type: "elevated_query",
    correlationId: correlationId(),
    userId: user.id,
    source: "/api/account/delete",
    outcome: "allowed",
    retention: "audit",
    detail: { action: "account_erasure_requested" },
  });

  const { error } = await admin.auth.admin.deleteUser(user.id);

  if (error) {
    /*
     * Nothing has been deleted at this point. The single-statement shape is
     * what makes that true: either the cascade ran or it did not, so a failure
     * leaves the account exactly as it was rather than partly erased with a
     * working login.
     */
    return serverError({
      operation: "DELETE /api/account/delete",
      cause: error,
    });
  }

  return NextResponse.json({ success: true });
}
