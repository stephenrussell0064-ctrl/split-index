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
 */
export function ActivityPrivacySettings({
  initialShareActivities,
  userId,
  /**
   * Why the current setting couldn't be read, or null when it was. The control
   * is shown disabled rather than hidden — a silently missing privacy switch
   * is exactly the bug this replaces — and the two reasons get different copy
   * because only one of them is worth retrying.
   */
  unavailable = null,
}: {
  initialShareActivities: boolean;
  userId: string;
  unavailable?: "missing_column" | "read_failed" | null;
}) {
  const [isPrivate, setIsPrivate] = useState(!initialShareActivities);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const nextPrivate = !isPrivate;
    setIsPrivate(nextPrivate);
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ share_activities_with_friends: !nextPrivate })
      .eq("user_id", userId);
    setSaving(false);
    if (updateError) {
      setIsPrivate(!nextPrivate); // revert on failure
      setError("Couldn't save that. Check your connection and try again.");
    }
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
          <button
            type="button"
            role="switch"
            aria-checked={isPrivate}
            aria-label="Private account"
            disabled={saving || unavailable !== null}
            onClick={toggle}
            className={cn(
              "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
              isPrivate ? "bg-accent" : "bg-white/10"
            )}
          >
            <span
              className={cn(
                "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform",
                isPrivate ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>
        {unavailable === "missing_column" && (
          <p className="mt-3 text-xs text-warning">
            This app&apos;s database is missing the update that adds account privacy, so the switch
            is disabled — it would have nowhere to save to, and the activity feed won&apos;t work
            either until it&apos;s applied. Reloading won&apos;t help. If you run this app, apply the
            outstanding migrations in <code>supabase/migrations</code> (031 onwards).
          </p>
        )}
        {unavailable === "read_failed" && (
          <p className="mt-3 text-xs text-warning">
            We couldn&apos;t load your current privacy setting, so this switch is disabled to avoid
            showing you the wrong state. Reload the page to try again.
          </p>
        )}
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}
