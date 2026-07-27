"use client";

import { useState } from "react";
import Link from "next/link";
import { Compass, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "split-index-complete-profile-dismissed";

/**
 * Nudges toward /profile to fill in experience/goals/motivation — fields
 * dropped from required onboarding (Slice D) so a casual user can log a
 * first session without answering them first. Only shown once there's
 * actually a first score to react to (needsProfile is server-computed from
 * hasActivities && profile.experience == null), and dismissible like
 * FriendInviteBanner rather than reappearing every visit.
 */
export function CompleteProfileBanner({ needsProfile }: { needsProfile: boolean }) {
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && !!localStorage.getItem(STORAGE_KEY)
  );

  if (!needsProfile || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 pr-12">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="absolute right-3 top-3 rounded-lg p-1 text-muted hover:bg-white/5 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15">
          <Compass className="h-5 w-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Nice first score — finish your profile?</p>
          <p className="text-xs text-muted">
            Add your experience level and a goal so your predictions and progress tracking get
            sharper.
          </p>
        </div>
        <Link href="/profile">
          <Button variant="secondary" size="sm">
            Complete profile
          </Button>
        </Link>
      </div>
    </div>
  );
}
