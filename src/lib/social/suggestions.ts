import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who to suggest an athlete adds, from the graph they are already in.
 *
 * ## No location, deliberately
 *
 * "People near you" was asked for and is not built here. A run's start point is
 * usually somebody's front door — which is why this app already has a
 * route-privacy-zone concept — so proximity suggestions need explicit opt-in
 * consent, a disclosure in the privacy policy, and a decision about precision,
 * none of which belong in a change that ships days before an App Store review.
 * Everything below uses data the athlete has already shared with these exact
 * people: who their friends are, which squads they joined, and which squads they are in.
 *
 * ## The signals, in order of how much they mean
 *
 * MUTUAL FRIENDS is the strongest and the most explicable. Two mutuals is a
 * real signal; the count is returned so the UI can say "3 mutual friends"
 * rather than presenting a stranger with no reason.
 *
 * SHARED SQUADS is nearly as strong and cheaper to trust — both people chose to
 * join the same group, which is a deliberate act rather than an inference.
 *
 * SPORT OVERLAP was specified and is NOT here. There is no `public_activities`
 * view, and `activities` is RLS-scoped to the viewer and their friends — so by
 * construction a candidate's sports are unreadable, because a candidate is
 * someone who is not yet a friend. Powering a tie-break would mean publishing a
 * new view of everybody's training, which is a real widening of what leaves the
 * database in exchange for separating two suggestions that are otherwise equal.
 * The field is kept on the type and returned empty so a future view can fill it
 * without a signature change.
 *
 * ## What is excluded, and why each one matters
 *
 * Self, existing friends, and PENDING requests in either direction — suggesting
 * someone you already asked reads as the app having forgotten. Blocks are
 * excluded in BOTH directions: the blocker must not see the blocked, and the
 * blocked must not be handed a route back to the blocker. RLS has the final say
 * on every row, so a mistake here can under-fetch but not leak.
 */

export interface FriendSuggestion {
  userId: string;
  mutualFriends: number;
  sharedSquads: number;
  /** Always empty for now — see the note on sport overlap above. */
  sharedSports: string[];
  /** Ranking score; the UI should show the reasons, not this. */
  score: number;
}

/** Mutuals dominate; a squad is worth nearly a mutual. */
const WEIGHT_MUTUAL = 10;
const WEIGHT_SQUAD = 8;

export const MAX_SUGGESTIONS = 10;

type Rel = { user_id: string; friend_id: string; status?: string | null };

export async function fetchFriendSuggestions(
  supabase: SupabaseClient,
  userId: string,
  limit: number = MAX_SUGGESTIONS
): Promise<{ suggestions: FriendSuggestion[]; error: string | null }> {
  // 1. Every relationship this athlete already has, at any status.
  const rels = await supabase
    .from("friends")
    .select("user_id, friend_id, status")
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  if (rels.error) return { suggestions: [], error: rels.error.message };

  const other = (r: Rel) => (r.user_id === userId ? r.friend_id : r.user_id);
  const rows = (rels.data ?? []) as Rel[];
  const friendIds = rows.filter((r) => r.status === "accepted").map(other);
  // Anyone already related in any way is off the list — including a pending
  // request, in either direction. Suggesting someone you already asked, or who
  // already asked you, reads as the app having lost track.
  const alreadyRelated = new Set<string>([userId, ...rows.map(other)]);

  // 2. Blocks, both directions.
  const blocks = await supabase
    .from("blocked_users")
    .select("blocker_id, blocked_id")
    .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
  if (blocks.error) return { suggestions: [], error: blocks.error.message };
  for (const b of (blocks.data ?? []) as Array<{ blocker_id: string; blocked_id: string }>) {
    alreadyRelated.add(b.blocker_id === userId ? b.blocked_id : b.blocker_id);
  }

  const candidates = new Map<string, FriendSuggestion>();
  const bump = (id: string, patch: Partial<FriendSuggestion>) => {
    if (alreadyRelated.has(id)) return;
    const cur =
      candidates.get(id) ??
      ({ userId: id, mutualFriends: 0, sharedSquads: 0, sharedSports: [], score: 0 } as FriendSuggestion);
    candidates.set(id, { ...cur, ...patch });
  };

  // 3. Friends of friends.
  if (friendIds.length > 0) {
    const foaf = await supabase
      .from("friends")
      .select("user_id, friend_id")
      .eq("status", "accepted")
      .or(`user_id.in.(${friendIds.join(",")}),friend_id.in.(${friendIds.join(",")})`);
    if (foaf.error) return { suggestions: [], error: foaf.error.message };
    for (const r of (foaf.data ?? []) as Rel[]) {
      for (const side of [r.user_id, r.friend_id]) {
        if (alreadyRelated.has(side)) continue;
        const cur = candidates.get(side);
        bump(side, { mutualFriends: (cur?.mutualFriends ?? 0) + 1 });
      }
    }
  }

  // 4. Squads in common.
  const mySquads = await supabase.from("squad_members").select("squad_id").eq("user_id", userId);
  if (mySquads.error) return { suggestions: [], error: mySquads.error.message };
  const squadIds = ((mySquads.data ?? []) as Array<{ squad_id: string }>).map((r) => r.squad_id);
  if (squadIds.length > 0) {
    const mates = await supabase
      .from("squad_members")
      .select("user_id, squad_id")
      .in("squad_id", squadIds);
    if (mates.error) return { suggestions: [], error: mates.error.message };
    for (const m of (mates.data ?? []) as Array<{ user_id: string }>) {
      if (alreadyRelated.has(m.user_id)) continue;
      const cur = candidates.get(m.user_id);
      bump(m.user_id, { sharedSquads: (cur?.sharedSquads ?? 0) + 1 });
    }
  }

  if (candidates.size === 0) return { suggestions: [], error: null };

  const suggestions = [...candidates.values()]
    .map((c) => ({
      ...c,
      score: c.mutualFriends * WEIGHT_MUTUAL + c.sharedSquads * WEIGHT_SQUAD,
    }))
    // Every suggestion must carry a reason the athlete can read. Nothing
    // reaches this list without a mutual friend or a shared squad behind it.
    .filter((c) => c.mutualFriends > 0 || c.sharedSquads > 0)
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId))
    .slice(0, limit);

  return { suggestions, error: null };
}
