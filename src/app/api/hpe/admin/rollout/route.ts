import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canChangeRollout, resolveAdminRole } from "@/lib/auth/admin-role";
import { evaluateRolloutChange } from "@/lib/scoring/hpe/rollout";

/**
 * The kill switch and rollout dial, as an operator action.
 *
 * Gated on the fleet review for any change that RAISES exposure, and
 * deliberately not gated at all for any change that lowers it. Making it
 * harder to turn something off than to turn it on is how a bad rollout stays
 * live while somebody hunts for a dashboard — so disabling always works, from
 * any state, with no review and no clean-dashboard requirement.
 *
 * Every change is written to `hpe_rollout_audit` with the reason and what the
 * dashboard was showing at the time. A kill switch with no record of who threw
 * it is an outage nobody can reconstruct afterwards.
 */

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const identity = await resolveAdminRole(user.id);
  if (!identity) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canChangeRollout(identity)) {
    return NextResponse.json(
      { error: "Your admin role is read-only. Changing the rollout needs the operator role." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 8) {
    // Not bureaucracy: the audit row is the only thing that will explain this
    // change to whoever reads it in three months, including the person making
    // it now.
    return NextResponse.json({ error: "A reason of at least 8 characters is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: flagRow } = await admin
    .from("hpe_feature_flags")
    .select("enabled, rollout_percentage, last_fleet_review_at, last_fleet_review_by, last_fleet_review_alarm_count")
    .eq("key", "hpe_generation")
    .maybeSingle();

  const currentEnabled = flagRow ? Boolean(flagRow.enabled) : false;
  const currentPercentage = flagRow ? Number(flagRow.rollout_percentage) : 0;

  const nextEnabled = typeof body.enabled === "boolean" ? body.enabled : currentEnabled;
  const rawPercentage = body.percentage != null ? Number(body.percentage) : currentPercentage;
  if (!Number.isFinite(rawPercentage) || rawPercentage < 0 || rawPercentage > 100) {
    return NextResponse.json({ error: "percentage must be between 0 and 100." }, { status: 400 });
  }
  const nextPercentage = Math.round(rawPercentage);

  const decision = evaluateRolloutChange(
    { currentEnabled, currentPercentage, nextEnabled, nextPercentage },
    {
      reviewedAt: (flagRow?.last_fleet_review_at as string | null) ?? null,
      reviewedBy: (flagRow?.last_fleet_review_by as string | null) ?? null,
      alarmCount: (flagRow?.last_fleet_review_alarm_count as number | null) ?? null,
    }
  );

  if (!decision.allowed) {
    return NextResponse.json(
      { error: decision.reason, blockedByFleetReview: true, currentEnabled, currentPercentage },
      { status: 409 }
    );
  }

  const { error: updateError } = await admin
    .from("hpe_feature_flags")
    .update({
      enabled: nextEnabled,
      rollout_percentage: nextPercentage,
      note: reason,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("key", "hpe_generation");

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await admin.from("hpe_rollout_audit").insert({
    changed_by: user.id,
    from_enabled: currentEnabled,
    to_enabled: nextEnabled,
    from_percentage: currentPercentage,
    to_percentage: nextPercentage,
    reason,
    alarm_count: (flagRow?.last_fleet_review_alarm_count as number | null) ?? null,
  });

  return NextResponse.json({
    ok: true,
    enabled: nextEnabled,
    percentage: nextPercentage,
    wasDeEscalation: decision.isDeEscalation,
  });
}
