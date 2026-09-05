"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bandage, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import {
  INJURY_STATUSES,
  injuryStatusLabel,
  parseInjuryStatus,
  type InjuryStatus,
} from "@/lib/social/injury-status";
import { cn } from "@/lib/utils/cn";

/**
 * The ONLY thing in this app that writes `profiles.injury_status`.
 *
 * User feedback: "I want this to be a status available to put on your social
 * profile to inform others that you are injured."
 *
 * THREE RULES THIS COMPONENT EXISTS TO KEEP
 * -----------------------------------------
 * 1. OPT-IN, ALWAYS. Nothing sets this status except an athlete tapping one of
 *    these buttons. In particular the Hybrid Plan's injury input — which is
 *    finer-grained, names a body region, and was given to a training tool in
 *    private — must never flow here. That would publish a health disclosure
 *    the athlete never agreed to publish. If the two ever need connecting, the
 *    connection is a question asked here, not a copy made elsewhere.
 * 2. COARSE, ALWAYS. Two options and an off. No body part, no diagnosis, no
 *    severity, no dates, no free text. The database refuses anything else
 *    (migration 053's CHECK), so this is not the only guard, but it is the one
 *    a product conversation will push against first.
 * 3. TRIVIALLY REMOVABLE. "Not saying anything" is the first button, always
 *    visible, one tap, no confirmation. An athlete who set a status in a bad
 *    week must never have to hunt for the way to take it down.
 *
 * WHO SEES IT — and why the copy says so
 * --------------------------------------
 * `profiles` is governed by "Public profiles readable" (migration 001):
 * `USING (username IS NOT NULL)`, with no auth check. So for anyone who has
 * claimed a username this is as visible as their bio — WIDER than the
 * activities feed, which is accepted-friends-only. Athletes reasonably assume
 * this app's friends-only model covers everything, and for health-adjacent
 * information that assumption has to be corrected before they choose, not
 * after. Hence the sentence below, which is the plain truth rather than the
 * comfortable version.
 */

/**
 * `select("*")` returns no key at all for a column that doesn't exist, so a
 * database missing migration 053 is indistinguishable from "status not set"
 * unless the page tells us which it is. Saving into a missing column fails
 * with a 42703 the athlete cannot act on, so we disable rather than let them
 * try.
 */
export type InjuryStatusAvailability =
  | { status: "available"; injuryStatus: InjuryStatus | null }
  | { status: "missing_column" };

const OPTIONS: { value: InjuryStatus | null; label: string }[] = [
  { value: null, label: "Not saying anything" },
  ...INJURY_STATUSES.map((value) => ({ value, label: injuryStatusLabel(value) })),
];

export function InjuryStatusCard({
  availability,
  userId,
}: {
  availability: InjuryStatusAvailability;
  userId: string;
}) {
  const router = useRouter();
  const stored = availability.status === "available" ? availability.injuryStatus : null;

  /**
   * The athlete's un-saved-yet choice, or `undefined` while the control simply
   * mirrors what is stored. Not seeded into `useState` from the prop: the same
   * mistake the privacy switch made means a value that lands after mount is
   * ignored, and this control is re-rendered by `router.refresh()` on every
   * save.
   */
  const [pending, setPending] = useState<InjuryStatus | null | undefined>(undefined);
  const [saving, setSaving] = useState<InjuryStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const selected = pending === undefined ? stored : pending;
  const disabled = availability.status !== "available";

  async function choose(next: InjuryStatus | null) {
    if (disabled || next === selected) return;

    setSaving(next);
    setError(null);

    const supabase = createClient();
    // `.select().single()` for the same reason the privacy switch needs it: a
    // bare `update().eq()` that matches ZERO rows returns 204 with no error, so
    // a missing profile row or a declining RLS predicate would leave this
    // control showing a status the database never stored. Here that cuts the
    // dangerous way too — an athlete could believe they had taken an injury
    // status DOWN while it was still on their profile.
    const { data, error: updateError } = await supabase
      .from("profiles")
      .update({ injury_status: next })
      .eq("user_id", userId)
      .select("injury_status")
      .single();

    setSaving(undefined);

    if (updateError || !data) {
      setError(
        updateError?.code === "PGRST116"
          ? "That didn't save — we couldn't find your profile to update. Reload and try again."
          : "Couldn't save that. Check your connection and try again."
      );
      return;
    }

    // Drive the control from what was actually stored, never from the tap.
    setPending(parseInjuryStatus(data.injury_status));
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bandage className="h-4 w-4 text-accent" />
          <CardTitle>Injury status</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted">
          An optional badge on your profile, so people following your training know why it has gone
          quiet. Off unless you turn it on, and one tap to take back down.
        </p>
        <p className="mt-1.5 text-xs text-muted">
          Anyone who can see your profile can see this — a wider audience than your activities,
          which only accepted friends ever see. Nothing you tell your Hybrid Plan about an injury
          ever appears here; this is the only place it can be set.
        </p>

        <div
          role="radiogroup"
          aria-label="Injury status"
          className="mt-4 flex flex-wrap gap-2"
        >
          {OPTIONS.map((option) => {
            const active = selected === option.value;
            return (
              <button
                key={option.value ?? "none"}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled || saving !== undefined}
                onClick={() => choose(option.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                  active ? "bg-accent text-accent-foreground" : "glass text-muted hover:text-foreground"
                )}
              >
                {active && <Check className="h-3 w-3" />}
                {option.label}
              </button>
            );
          })}
        </div>

        {availability.status === "missing_column" && (
          <p className="mt-3 text-xs text-warning">
            This app&apos;s database is missing the update that adds injury status, so there is
            nowhere to save it yet. If you run this app, apply the outstanding migrations in{" "}
            <code>supabase/migrations</code> (053 onwards).
          </p>
        )}
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}
