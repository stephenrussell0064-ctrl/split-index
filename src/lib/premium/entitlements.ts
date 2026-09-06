import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubscriptionStatus, SubscriptionTier } from "@/types";
import { getTrialDaysRemaining, hasSoftTrialAccess, isPremiumUser } from "@/lib/retention/trial";
import { PREMIUM_FEATURES, type PremiumFeature } from "@/lib/premium/features";
import { resolveAdminRole, type AdminRole } from "@/lib/auth/admin-role";
import { correlationId } from "@/lib/api/errors";
import { logSecurityEvent } from "@/lib/observability/security-log";

/**
 * WP6.2 — the single place that answers "what is this account allowed to do".
 *
 * WHAT WAS WRONG
 * --------------
 * Nothing was broken, and that is worth saying plainly: `features.ts` already
 * held one typed map of feature → tier, and `canAccessProfile` was already the
 * one gate. The problem was that resolving the INPUTS to that gate was
 * duplicated at twenty-one call sites, each re-querying `profiles` for its own
 * two or three columns and combining them slightly differently.
 *
 * That is how two entitlement concepts came to exist without anyone deciding:
 * `isPremiumUser` (paid, from the subscription) and `hasSoftTrialAccess` (a
 * card-less trial from the signup date). Both are legitimate. Neither knew
 * about the other, so the dashboard and the reports page applied both while
 * export and the leaderboards applied only the first — and no single place
 * could tell you which surfaces a fourteen-day-old free account could reach.
 *
 * This resolves all of it once, from state only the payment webhooks write.
 *
 * WHAT IT NEVER READS
 * -------------------
 * A client-sent field, a header, local storage, or anything in the request
 * body. `profiles.subscription_tier` and `subscription_status` are written by
 * the Stripe and RevenueCat webhooks and by nothing else; the admin role comes
 * from `admin_users`, which has no INSERT policy at all. An entitlement derived
 * from something the caller controls is not an entitlement.
 *
 * `import "server-only"` because this resolves an admin role, and a module that
 * can answer "is this person an admin" has no business in a client bundle.
 */

export type Plan = "free" | "premium";

/** Which kind of trial, if any, is currently carrying this account. */
export type TrialKind =
  /** A real trial on the payment provider's subscription. */
  | "paid"
  /**
   * The card-less grant from signup date. Deliberately weaker: it opens the
   * surfaces where showing the real experience up front is the point, and NOT
   * the paid gates like export or global leaderboards. See hasSoftTrialAccess.
   */
  | "soft"
  | null;

export interface Entitlements {
  userId: string;
  plan: Plan;
  status: SubscriptionStatus | null;
  /** True only for real paid or provider-trialling access. */
  premium: boolean;
  trial: {
    active: boolean;
    kind: TrialKind;
    daysRemaining: number | null;
  };
  isAdmin: boolean;
  adminRole: AdminRole | null;
}

/** What a caller with no readable profile gets. Fails closed on every axis. */
function noEntitlements(userId: string): Entitlements {
  return {
    userId,
    plan: "free",
    status: null,
    premium: false,
    trial: { active: false, kind: null, daysRemaining: null },
    isAdmin: false,
    adminRole: null,
  };
}

interface ProfileEntitlementRow {
  subscription_tier: SubscriptionTier | null;
  subscription_status: SubscriptionStatus | null;
  created_at: string | null;
}

/** The columns entitlement depends on, named once so a caller cannot under-select. */
export const ENTITLEMENT_COLUMNS =
  "subscription_tier, subscription_status, created_at";

/**
 * Resolve what an account may do.
 *
 * Fails closed: an unreadable profile, a query error or a thrown exception all
 * produce the free, non-admin answer. The failure mode of this function is an
 * athlete seeing an upgrade prompt they should not, which is recoverable in one
 * support message. The other direction hands out paid features, or worse, an
 * admin surface.
 */
export async function getEntitlements(
  supabase: SupabaseClient,
  userId: string
): Promise<Entitlements> {
  let profile: ProfileEntitlementRow | null = null;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(ENTITLEMENT_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (!error) profile = data as ProfileEntitlementRow | null;
  } catch {
    // Fall through to the closed answer below.
  }

  if (!profile) return noEntitlements(userId);

  const tier: SubscriptionTier = profile.subscription_tier ?? "free";
  const status = profile.subscription_status ?? null;
  const createdAt = profile.created_at;

  const premium = isPremiumUser(tier, status);
  const soft = createdAt ? hasSoftTrialAccess(createdAt, tier, status) : false;
  const daysRemaining = createdAt ? getTrialDaysRemaining(createdAt, tier, status) : null;

  /*
   * Admin resolution is a second query, and it is only made when it can matter.
   * resolveAdminRole reads admin_users through the SERVICE ROLE deliberately —
   * so a mistake in that table's policy cannot grant anybody the role — which
   * means it is not free, and running it on every dashboard render would put a
   * privileged query on the hot path of every page.
   */
  const adminIdentity = await resolveAdminRole(userId);

  return {
    userId,
    plan: tier === "premium" ? "premium" : "free",
    status,
    premium,
    trial: {
      // A paid trial is premium; a soft trial is not, and conflating them is
      // how a free account ends up with data export.
      active: status === "trialing" || soft,
      kind: status === "trialing" ? "paid" : soft ? "soft" : null,
      daysRemaining,
    },
    isAdmin: adminIdentity !== null,
    adminRole: adminIdentity?.role ?? null,
  };
}

/**
 * Whether these entitlements open a feature.
 *
 * Reads the same PREMIUM_FEATURES map `canAccessProfile` does — one table, not
 * two — so this cannot drift from the existing gate while call sites are
 * migrated across.
 *
 * Admin is deliberately NOT a premium bypass. An operator looking at the fleet
 * dashboard has no business silently holding a paid subscription's features on
 * their own account; the two are different questions and conflating them makes
 * the entitlement matrix untestable.
 */
export function allows(entitlements: Entitlements, feature: PremiumFeature): boolean {
  const access = PREMIUM_FEATURES[feature];
  return entitlements.premium ? access.premium : access.free;
}

/** The 403 body for a premium gate. Shaped consistently so the client can act on it. */
export const PREMIUM_REQUIRED = {
  error: "That feature is part of Premium.",
  premium_required: true,
} as const;

/**
 * Record a refused premium request.
 *
 * WP7 names this specifically: "an alert path for repeated auth failure and for
 * repeated entitlement denial from one account — the latter is the signature of
 * someone probing the paywall."
 *
 * One denial is ordinary. A free account hitting export once a week is somebody
 * discovering the feature exists. The same account hitting four gated routes in
 * a minute is somebody mapping the paywall, and only a per-account record can
 * tell those apart.
 *
 * The plan is logged; nothing about the athlete is.
 */
export function logEntitlementDenial(
  entitlements: Entitlements,
  feature: PremiumFeature | string,
  source: string
): void {
  logSecurityEvent({
    type: "entitlement.denied",
    correlationId: correlationId(),
    userId: entitlements.userId,
    source,
    outcome: "denied",
    // Health-adjacent: this is a record about who tried to reach a Hybrid Plan
    // or analytics surface, so it keeps the longer period.
    retention: "audit",
    detail: { feature: String(feature), plan: entitlements.plan, trial: entitlements.trial.kind },
  });
}
