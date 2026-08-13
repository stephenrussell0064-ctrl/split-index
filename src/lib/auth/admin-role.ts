import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin role resolution.
 *
 * Checked through the SERVICE-ROLE client on purpose, not through the
 * requesting user's own RLS-scoped client. The user-scoped path would work —
 * `admin_users` has a "read your own row" policy — but it would make the
 * answer to "is this person an admin" depend on an RLS policy being correct.
 * Reading it with the service role means a mistake in that policy can leak an
 * admin's existence to themselves and still cannot grant anybody the role.
 *
 * There is no `grantAdmin` here, deliberately. `admin_users` has no INSERT
 * policy, so grants happen through a migration, the Supabase dashboard or a
 * script an operator runs knowingly. Shipping a code path that writes to this
 * table is how privilege escalation bugs get written.
 */

export type AdminRole = "operator" | "viewer";

export interface AdminIdentity {
  userId: string;
  role: AdminRole;
}

export async function resolveAdminRole(userId: string): Promise<AdminIdentity | null> {
  // A missing service-role key means we cannot verify anything, and an
  // unverifiable admin check must answer "no". Failing open here would make
  // every operations endpoint public the moment an env var went missing.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("admin_users")
      .select("user_id, role")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return null;
    return { userId: data.user_id as string, role: data.role as AdminRole };
  } catch {
    return null;
  }
}

/** `viewer` can read the fleet view; only `operator` can change the rollout. */
export function canChangeRollout(identity: AdminIdentity | null): boolean {
  return identity?.role === "operator";
}
