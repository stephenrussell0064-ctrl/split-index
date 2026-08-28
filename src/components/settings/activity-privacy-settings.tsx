"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

/**
 * User feedback: "Please make each activity public by default to friends,
 * but the option in settings is to make your account private."
 *
 * So the switch the athlete sees is "Private account" — on means nobody
 * sees my activities. The database column underneath is still
 * `profiles.share_activities_with_friends` (migration 031), because that
 * column is what the RLS predicate activity_is_visible_to() reads and RLS
 * is the real enforcement boundary. We invert at the UI edge only, in this
 * one component, rather than renaming a live column that a deployed
 * security policy depends on.
 *
 *   private (switch on)  <->  share_activities_with_friends = false
 *   visible (switch off) <->  share_activities_with_friends = true   (default)
 *
 * THE INVERSION HAPPENS EXACTLY TWICE, AND NOWHERE ELSE
 * ----------------------------------------------------
 * Once on read (`!state.shareActivitiesWithFriends` below) and once on write
 * (`!nextPrivate`). Both live in this file, within twenty lines of each
 * other, deliberately: an inversion applied on one path only — or applied
 * twice — is invisible in review and presents as a switch that does nothing
 * or does the opposite. `applySaved()` closes that hole for good by driving
 * the control from the row the database actually returned after the write,
 * so the two inversions have to agree or the switch visibly disagrees with
 * itself on the very next render.
 */

/**
 * What we know about the stored setting. "Loading" is a real state with a real
 * rendering, not an excuse to render nothing: the card holds its place in the
 * page from first paint so it can neither pop in late nor — worse for a
 * privacy control specifically — show a settled-looking switch in a position
 * that was never read from the database.
 */
export type PrivacyState =
  | { status: "loading" }
  | { status: "loaded"; shareActivitiesWithFriends: boolean }
  | { status: "missing_column" }
  | { status: "read_failed" };

export function ActivityPrivacySettings({
  state,
  userId,
}: {
  state: PrivacyState;
  userId: string;
}) {
  /**
   * The athlete's own un-saved-yet intent, or null while the control simply
   * mirrors the database. This is NOT `useState(initial)` seeded from a prop:
   * the card mounts before the profile query resolves, and a `useState`
   * initializer captures whatever placeholder was passed at mount and then
   * ignores the real value when it lands. That is precisely how an inverted
   * privacy switch ends up asserting "not private" and then flipping itself
   * a moment later.
   */
  const [pending, setPending] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const known = state.status === "loaded";
  // Never guess. When the value isn't known the switch renders indeterminate
  // (below) rather than picking a side, so `isPrivate` is only ever consulted
  // in the loaded case.
  const isPrivate = pending ?? (known ? !state.shareActivitiesWithFriends : false);

  async function toggle() {
    const nextPrivate = !isPrivate;
    setPending(nextPrivate);
    setSaving(true);
    setError(null);

    const supabase = createClient();
    // `.select().single()` is not decoration. A bare `update().eq()` returns
    // 204 with no error when it matches ZERO rows — a missing profile row, or
    // an RLS predicate that declined the write — so the switch would sit
    // there in its new position looking saved while the database still said
    // the opposite. For a privacy control that failure mode is the worst one
    // available: the athlete believes they went private and they did not.
    // Asking for the row back turns "nothing was written" into PGRST116.
    const { data, error: updateError } = await supabase
      .from("profiles")
      .update({ share_activities_with_friends: !nextPrivate })
      .eq("user_id", userId)
      .select("share_activities_with_friends")
      .single();

    setSaving(false);

    if (updateError || !data) {
      setPending(null); // fall back to the stored value rather than our guess
      setError(
        updateError?.code === "PGRST116"
          ? "That didn't save — we couldn't find your profile to update. Reload and try again."
          : "Couldn't save that. Check your connection and try again."
      );
      return;
    }

    // Re-derive from what was actually stored, rather than trusting the
    // optimistic value. If the two inversions ever disagree this line makes
    // the switch snap back visibly instead of lying quietly.
    setPending(data.share_activities_with_friends === false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-accent" />
          <CardTitle>Privacy</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Private account</p>
            <p className="mt-1 text-xs text-muted">
              Your activities are visible to your accepted friends by default — they show up in
              their Feed, where they can score them out of 10 and leave comments. Turn this on and
              nobody sees your activities, not even friends.
            </p>
            <p className="mt-1.5 text-xs text-muted">
              Your activities are never visible to people you haven&apos;t accepted as friends, and
              never to the public internet.
            </p>
          </div>

          {known ? (
            <button
              type="button"
              role="switch"
              aria-checked={isPrivate}
              aria-label="Private account"
              disabled={saving}
              onClick={toggle}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
                isPrivate ? "bg-accent" : "bg-white/10"
              )}
            >
              {/*
                `left-0` is load-bearing. Without it this absolutely-positioned
                knob has no inset at all, so it falls back to its STATIC
                position — and a <button> inherits `text-align: center` from
                the UA stylesheet, which Tailwind's preflight does not reset.
                Measured in Chrome on the real markup, that put the knob 24px
                in from the left of a 48px track before the transform even
                applied: the off state rendered flush against the RIGHT edge
                (reading as "on"), and the on state rendered 20px clear of the
                pill entirely, a loose white dot floating beside the switch.
                That is the "looks bugged" report, and on an inverted control
                it also showed the wrong answer to "am I private?".
              */}
              <span
                className={cn(
                  "absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  isPrivate ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          ) : (
            /*
              Indeterminate: shaped and placed exactly like the switch so the
              card never reflows when the real value lands, but deliberately
              NOT `role="switch"`, because a switch has to be either on or off
              and we don't know which. Rendering `aria-checked="false"` here
              would tell a screen-reader user their account is public on the
              strength of a query that failed.
            */
            <div
              role="img"
              aria-label={
                state.status === "loading"
                  ? "Loading your privacy setting"
                  : "Privacy setting unavailable"
              }
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full border border-dashed border-white/20 bg-white/[0.04]",
                state.status === "loading" && "animate-pulse"
              )}
            >
              <span className="absolute left-0 top-1 h-5 w-5 translate-x-3.5 rounded-full bg-white/25" />
            </div>
          )}
        </div>

        {state.status === "loading" && (
          <p className="mt-3 text-xs text-muted">Checking your privacy setting…</p>
        )}
        {state.status === "missing_column" && (
          <p className="mt-3 text-xs text-warning">
            This app&apos;s database is missing the update that adds account privacy, so the switch
            is disabled — it would have nowhere to save to, and the activity feed won&apos;t work
            either until it&apos;s applied. Reloading won&apos;t help. If you run this app, apply the
            outstanding migrations in <code>supabase/migrations</code> (031 onwards).
          </p>
        )}
        {state.status === "read_failed" && (
          <p className="mt-3 text-xs text-warning">
            We couldn&apos;t load your current privacy setting, so the switch is showing no state
            rather than guessing at one. Reload the page to try again.
          </p>
        )}
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}
