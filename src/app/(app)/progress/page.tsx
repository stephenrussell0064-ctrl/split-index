import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProgressHub } from "@/components/progress/progress-hub";
import { hasShowcaseAccess } from "@/lib/retention/trial";

export const metadata: Metadata = {
  title: "Progress",
};

/**
 * The Progress hub — the map of everything retrospective and social.
 *
 * WHY IT IS A PAGE AND NOT A MENU. Analytics, Recovery, Interference, the
 * logbook, the athlete report and Social all used to live behind a "More"
 * button: a popover list of nine rows, which is where features go to be
 * forgotten (see the note at the top of lib/navigation/app-nav.ts). A tab of
 * its own is only half the fix, because a list of labels is still a list of
 * labels. So every row here carries a LIVE NUMBER from the thing it leads to —
 * how many sessions are in the logbook, when the last one was, how many
 * friends you have — so the page answers "is there anything in there for me?"
 * before you spend a tap finding out.
 *
 * WHAT THIS FILE DOES AND DOES NOT DO. It reads; progress-hub.tsx renders.
 * The destinations themselves are never listed here or there — they come from
 * PROGRESS_NAV, COMMUNITY_NAV and ACCOUNT_NAV, so a destination added to the
 * nav list appears on this page without anybody remembering to add it, and
 * cannot be described here differently from the tab bar or the guide.
 * progress-hub.test.ts pins that.
 */
export default async function ProgressPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, subscription_tier, subscription_status, created_at")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  /*
   * Only to LABEL the athlete report row, never to gate it — the report page
   * does its own gating, and this page's job is to say what is behind a door
   * before you walk to it. `hasShowcaseAccess` rather than `hasPaidAccess`
   * because it is the showcase question: a new athlete inside the card-less
   * trial can open the report, so telling them it is locked would be a lie.
   */
  const premium = hasShowcaseAccess(profile);

  const [{ data: latestIndex }, { data: lastSessions, count: sessionCount }, { count: friendCount }] =
    await Promise.all([
      /*
        Ordered exactly as the dashboard and `sync_profile_current_index()`
        (migration 059) order it — `is_provisional` ascending FIRST, so a
        scored session outranks the onboarding estimate whatever their dates.
        Without the matching term this page would show one number and Home
        another for the same athlete. The provisional row is then treated as
        "no real score yet" below rather than rendered, because a score the
        athlete has not earned from a logged session is not a score to put on
        the page that exists to show them what their training has produced.
      */
      supabase
        .from("split_index_history")
        .select("split_index, endurance_index, strength_index, is_provisional, recorded_at")
        .eq("user_id", user.id)
        .order("is_provisional", { ascending: true })
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      /*
        One read for both numbers the logbook row needs: PostgREST computes an
        exact count over the whole matching set and applies `limit` only to the
        rows it returns, so this is the total session count AND the most recent
        session's date without a second query.
      */
      supabase
        .from("activities")
        .select("started_at", { count: "exact" })
        .eq("user_id", user.id)
        .eq("is_draft", false)
        .order("started_at", { ascending: false })
        .limit(1),
      /*
        Accepted friendships, counted rather than fetched — the Social row needs
        a number, not a list, and fetchFriendsData() would additionally read
        every one of those athletes' public profiles to build it.

        `friends` stores one row per pair with the two sides in `user_id` and
        `friend_id` (whichever way round the request happened to be sent), which
        is why this matches on either column. Blocking cannot leak through a
        `status = 'accepted'` filter: blocking rewrites the row's status, so a
        blocked pair is not an accepted one.
      */
      supabase
        .from("friends")
        .select("id", { count: "exact", head: true })
        .eq("status", "accepted")
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`),
    ]);

  // A provisional row is the onboarding estimate, not a result: "TBC", not a number.
  const scored = latestIndex && !latestIndex.is_provisional ? latestIndex : null;

  return (
    <ProgressHub
      splitIndex={scored?.split_index ?? null}
      strengthIndex={scored?.strength_index ?? null}
      enduranceIndex={scored?.endurance_index ?? null}
      sessionCount={sessionCount ?? 0}
      lastSessionAt={lastSessions?.[0]?.started_at ?? null}
      friendCount={friendCount ?? 0}
      premium={premium}
    />
  );
}
