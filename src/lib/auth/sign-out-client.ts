"use client";

import { createClient } from "@/lib/supabase/client";
import { clearRacePredictions } from "@/lib/native/race-predictions";
import { clearDailyTraining } from "@/lib/native/daily-training";

/**
 * Sign out, and take the home-screen widgets' copies of this account's data
 * with it.
 *
 * The widgets read an App Group container that outlives the webview, so
 * dropping the session alone leaves the previous account's race times and
 * training block on the phone's home screen — wrong for the next person to
 * sign in, and a small privacy leak on a shared device. Both clears are
 * best-effort (they no-op off-device) and are awaited BEFORE signOut so a
 * slow bridge call cannot race the navigation away from the caller.
 *
 * One function, because there are now two places to sign out from — the
 * sidebar footer and the account menu in the top bar — and the widget clear
 * is exactly the kind of step that gets forgotten by the second copy.
 */
export async function signOutEverywhere(): Promise<void> {
  await clearRacePredictions();
  await clearDailyTraining();
  const supabase = createClient();
  await supabase.auth.signOut();
}
