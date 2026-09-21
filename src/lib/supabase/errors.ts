import type { PostgrestError } from "@supabase/supabase-js";
import { uniqueViolationMessage } from "@/lib/api/unique-violations";

/**
 * A Postgrest failure, as a sentence for the athlete.
 *
 * M14. Onboarding writes the profile with the BROWSER client, so a username
 * lost to the check-then-write race never reached `safeDatabaseMessage` and
 * surfaced as the caller's fallback — "Could not save your profile. Please try
 * again." That is not merely vague, it is wrong: trying again with the same
 * username fails identically, and nothing tells the athlete the name is the
 * problem.
 *
 * Unique violations now resolve through the same map the API routes use, so the
 * two cannot drift. Everything else still falls back, because a database error
 * an athlete cannot act on is noise at best and a leak at worst — the raw text
 * carries table and column names, and for a duplicate it carries the
 * conflicting VALUE, which may be another person's.
 */
export function supabaseErrorMessage(
  fallback: string,
  error: PostgrestError | null | undefined
): string {
  if (!error) return fallback;

  const duplicate = uniqueViolationMessage(error);
  if (duplicate) return duplicate;

  if (process.env.NODE_ENV === "development") {
    console.error(fallback, error);
    const code = error.code ? ` [${error.code}]` : "";
    return `${fallback} (${error.message}${code})`;
  }

  return fallback;
}
