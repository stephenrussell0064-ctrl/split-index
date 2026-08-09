"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

/**
 * User feedback (Slice 1): "this is an option you can select in your
 * profile to turn on or off as some users may want to keep their
 * activities private." On by default (migration 031, flipped from an
 * initial off-by-default per follow-up user feedback: "i also want to make
 * this public on default for friends and people can turn it private if
 * they wish") — this is where a user who wants to keep their activities
 * private opts out.
 */
export function ActivityPrivacySettings({
  initialShareActivities,
  userId,
}: {
  initialShareActivities: boolean;
  userId: string;
}) {
  const [shareActivities, setShareActivities] = useState(initialShareActivities);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !shareActivities;
    setShareActivities(next);
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ share_activities_with_friends: next })
      .eq("user_id", userId);
    setSaving(false);
    if (error) setShareActivities(!next); // revert on failure
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-accent" />
          <CardTitle>Privacy</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Share my activities with friends</p>
            <p className="mt-1 text-xs text-muted">
              When on, friends can see your logged workouts in the Feed, score them out of 10, and
              leave comments — like Strava. When off, your activities stay private and never
              appear anywhere outside your own account, even to friends.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={shareActivities}
            aria-label="Share my activities with friends"
            disabled={saving}
            onClick={toggle}
            className={cn(
              "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
              shareActivities ? "bg-accent" : "bg-white/10"
            )}
          >
            <span
              className={cn(
                "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform",
                shareActivities ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
