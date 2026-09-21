import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Blocking — the storage side of App Store Guideline 1.2's "ability to block
 * abusive users".
 *
 * TWO PROPERTIES MATTER AND BOTH ARE EASY TO GET WRONG.
 *
 * It is BIDIRECTIONAL. A block is stored one way round — one row, blocker to
 * blocked — but it hides each athlete from the other. An athlete who blocks
 * someone and then keeps appearing in that person's feed has not been given the
 * thing the guideline asks for, and worse, the person they were trying to get
 * away from can still watch them train.
 *
 * It is enforced SERVER-SIDE. Filtering a feed in the browser means the blocked
 * athlete's name, avatar and sessions were all sent to the device and merely not
 * painted — one devtools panel away from being read, and shipped over the wire
 * regardless. Every reader below returns ids for a server query to exclude.
 */

/** Everyone this athlete has blocked, plus everyone who has blocked them. */
export async function fetchBlockedUserIds(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const [{ data: outgoing }, { data: incoming }] = await Promise.all([
    supabase.from("blocked_users").select("blocked_id").eq("blocker_id", userId),
    supabase.from("blocked_users").select("blocker_id").eq("blocked_id", userId),
  ]);

  const ids = new Set<string>();
  for (const row of outgoing ?? []) ids.add(row.blocked_id as string);
  // The incoming half is what makes the block bidirectional. It cannot be read
  // through the "Users manage own blocks" policy — that scopes on blocker_id —
  // so this half requires a caller holding the service role, or a policy that
  // permits reading rows naming you. See the note on fetchBlockedUserIdsAdmin.
  for (const row of incoming ?? []) ids.add(row.blocker_id as string);
  return ids;
}

/**
 * The same set, read with a client that bypasses RLS.
 *
 * Needed because the incoming half of a block is deliberately unreadable by the
 * blocked party: if an athlete could query "who has blocked me", the block would
 * itself become a notification, which is exactly what a blocking feature must
 * not be. Server routes therefore read the pair through the admin client and use
 * the result only to filter — the ids never reach the response body.
 */
export async function fetchBlockedUserIdsAdmin(
  admin: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  return fetchBlockedUserIds(admin, userId);
}

/** True when these two athletes cannot see each other, in either direction. */
export async function isBlockedBetween(
  admin: SupabaseClient,
  a: string,
  b: string
): Promise<boolean> {
  const { data } = await admin
    .from("blocked_users")
    .select("id")
    .or(
      `and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`
    )
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Drop anything authored by a blocked athlete.
 *
 * A helper rather than an inline filter at each call site, because "which field
 * holds the author id" differs per surface and the failure mode of getting it
 * wrong is silent — the list still renders, just with the blocked person still
 * in it.
 */
export function withoutBlocked<T>(
  rows: T[],
  blocked: Set<string>,
  authorIdOf: (row: T) => string | null | undefined
): T[] {
  if (blocked.size === 0) return rows;
  return rows.filter((row) => {
    const id = authorIdOf(row);
    return !id || !blocked.has(id);
  });
}
