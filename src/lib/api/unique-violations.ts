/**
 * What to say when the database refuses a duplicate.
 *
 * Deliberately dependency-free, because both sides of the app need it and they
 * cannot import each other. `lib/api/errors.ts` pulls in `next/server` and is
 * therefore unusable from a client component; `lib/supabase/errors.ts` runs in
 * the browser. Before this the map existed only on the server side, so the same
 * failure produced "That username is taken." through an API route and "Could not
 * save your profile. Please try again." through onboarding — which writes
 * directly with the browser client.
 *
 * That second message is not merely vaguer. It is wrong advice: trying again
 * with the same username fails in exactly the same way, and the athlete has no
 * reason to think the name is the problem.
 *
 * M14's race lands here. `username-check` reads, the athlete submits, and the
 * write happens later — so two people can pass the check and one of them loses
 * at the unique constraint. That race cannot be closed by checking harder; it
 * closes at the constraint, and the only question is whether the loser is told
 * something useful.
 */

/**
 * Constraint name to message. Matched as a substring of the error text, because
 * Postgres puts the constraint in `details` or `message` depending on the
 * client, and neither is a documented shape.
 */
export const UNIQUE_VIOLATION_MESSAGES: Record<string, string> = {
  profiles_username_key: "That username is taken.",
  profiles_user_id_key: "That profile already exists.",
  profiles_stripe_customer_id_key: "That billing account is already linked.",
  activities_user_id_source_external_id_key:
    "That session has already been imported.",
  activity_reactions_activity_id_user_id_key: "You have already scored this session.",
  squad_members_squad_id_user_id_key: "You are already in that squad.",
  friends_user_id_friend_id_key: "You are already connected to that athlete.",
  leaderboard_entries_period_period_start_user_id_key:
    "That leaderboard entry already exists.",
  hpe_intake_pkey: "Your intake answers already exist.",
};

/** Postgres unique-violation SQLSTATE. */
export const UNIQUE_VIOLATION = "23505";

/**
 * The message for a unique violation, or null if this is not one.
 *
 * Never returns the raw error text. The constraint NAME is read and the text
 * discarded, because Postgres's message includes the conflicting VALUE — which
 * for a username is another person's, and for `profiles_stripe_customer_id_key`
 * is a billing identifier.
 */
export function uniqueViolationMessage(
  error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined
): string | null {
  if (!error || error.code !== UNIQUE_VIOLATION) return null;

  const haystack = `${error.details ?? ""} ${error.message ?? ""}`;
  for (const [constraint, message] of Object.entries(UNIQUE_VIOLATION_MESSAGES)) {
    if (haystack.includes(constraint)) return message;
  }
  return "That already exists.";
}
