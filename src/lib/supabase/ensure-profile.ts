import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/** Ensures a profiles row exists (handles OAuth signups before migrations/trigger ran). */
export async function ensureProfileForUser(user: User) {
  const admin = createAdminClient();
  return admin.from("profiles").upsert(
    {
      user_id: user.id,
      display_name:
        (user.user_metadata?.full_name as string | undefined) ??
        user.email ??
        null,
    },
    { onConflict: "user_id" }
  );
}
