import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The provider's name, or nothing. NEVER the email address.
 *
 * This used to fall back to `user.email`, which contradicted migration 081
 * (the trigger that creates the row refuses an email as a name), the
 * onboarding upsert, and the profile form. It ran on every /auth/callback,
 * so an email/password signup had its address written into `display_name` —
 * the column the public leaderboard and the share-card PNGs print — before
 * onboarding had a chance to null it. Onboarding now greets the athlete by
 * this very column, which made the hole visible: "Hey stephen@gmail.com".
 */
export function providerDisplayName(user: User): string | null {
  const raw = user.user_metadata?.full_name;
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.includes("@")) return null;
  return name;
}

/** Ensures a profiles row exists (handles OAuth signups before migrations/trigger ran). */
export async function ensureProfileForUser(user: User) {
  const admin = createAdminClient("lib/supabase/ensure-profile");
  const displayName = providerDisplayName(user);
  return admin.from("profiles").upsert(
    // Only carry a display name when the provider gave one. Upserting
    // `display_name: null` onto an existing row would erase a name the
    // athlete typed into their profile on every sign-in.
    displayName ? { user_id: user.id, display_name: displayName } : { user_id: user.id },
    { onConflict: "user_id" }
  );
}
