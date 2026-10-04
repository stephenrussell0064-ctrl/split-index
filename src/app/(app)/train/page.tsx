import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The Train tab. It never renders — it chooses between the two halves.
 *
 * Strength (/gym) and Endurance (/cardio) used to be two tabs. Each page
 * already carried a toggle to the other, so the tab bar was spending two of
 * its four slots on one thing. One "Train" tab now covers both, and the
 * shell remembers which half the athlete was last in (see `lastTabPaths` in
 * app-shell.tsx), so this redirect is only ever hit on the first tap of a
 * session — and then it goes to the side the athlete told us they train.
 *
 * A pure runner lands in Endurance; everyone else, including a hybrid
 * athlete, lands in Strength, which is also where the launcher's first
 * option lives. Either way it is one toggle from the other half.
 */
export default async function TrainPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, preferred_sports")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const sports = (profile.preferred_sports ?? []) as string[];
  const enduranceOnly = sports.length > 0 && !sports.includes("gym");

  redirect(enduranceOnly ? "/cardio" : "/gym");
}
