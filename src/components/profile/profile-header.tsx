"use client";

import { motion, useReducedMotion } from "framer-motion";
import { format } from "date-fns";
import { Calendar, Crown } from "lucide-react";
import { formatIndex } from "@/lib/utils/format";
import { InjuryStatusBadge } from "@/components/social/injury-status-badge";
import type { InjuryStatus } from "@/lib/social/injury-status";
import type { Profile } from "@/types";

interface ProfileHeaderProps {
  profile: Profile;
  email: string;
  splitIndex: number | null;
  enduranceIndex: number | null;
  strengthIndex: number | null;
  activityCount: number;
  prCount: number;
  /**
   * Shown here so the athlete sees their own status in the same place other
   * people see it. A status you cannot see is a status you forget you left on.
   */
  injuryStatus?: InjuryStatus | null;
}

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function ProfileHeader({
  profile,
  email,
  splitIndex,
  enduranceIndex,
  strengthIndex,
  activityCount,
  prCount,
  injuryStatus = null,
}: ProfileHeaderProps) {
  const reducedMotion = useReducedMotion();
  const isPremium = profile.subscription_tier === "premium";

  // User feedback: "Why is my PRs in profile 2.9 this doesn't make sense."
  // Root cause: every stat tile ran its value through formatIndex(), which
  // divides by 10 to rescale an internal 0-1000 index score to the
  // user-facing 0-100 display scale — correct for Split Index/Endurance/
  // Strength, but Workouts and PRs are plain counts, not scores on that
  // scale, so a real count of 29 PRs rendered as "2.9". Counts now render
  // as-is; only genuine index scores go through formatIndex.
  const indexStats = [
    { label: "Split Index", value: splitIndex, accent: "text-foreground" },
    { label: "Endurance", value: enduranceIndex, accent: "text-endurance" },
    { label: "Strength", value: strengthIndex, accent: "text-strength" },
  ];
  const countStats = [
    { label: "Workouts", value: activityCount, accent: "text-foreground" },
    { label: "PRs", value: prCount, accent: "text-foreground" },
  ];

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="glass-strong overflow-hidden rounded-3xl border border-white/[0.08]"
    >
      {/*
        48px on a phone, 96 from `sm` up. This carries no information at all,
        and at h-24 it spent 15% of the 620px visible window on decoration —
        enough that ProfileForm started around y585 and showed about two fields
        before the bottom nav. The gradient still does its job as a header at
        half the height; it was never doing 96px of work.
      */}
      <div className="h-12 bg-gradient-to-r from-accent/25 via-endurance/15 to-strength/20 sm:h-24" />

      <div className="px-6 pb-6 md:px-8 md:pb-8">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 -mt-10">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt={profile.display_name ?? "Avatar"}
              className="h-20 w-20 rounded-2xl object-cover ring-4 ring-background"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-strength text-2xl font-bold text-white ring-4 ring-background">
              {initials(profile.display_name, email)}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold truncate">
                {profile.display_name ?? "Athlete"}
              </h1>
              {isPremium && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 border border-accent/30 px-2.5 py-0.5 text-xs font-medium text-accent">
                  <Crown className="h-3 w-3" />
                  Premium
                </span>
              )}
              {injuryStatus && <InjuryStatusBadge status={injuryStatus} />}
            </div>
            <p className="text-sm text-muted truncate">
              {profile.username ? `@${profile.username}` : email}
            </p>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
            <Calendar className="h-3.5 w-3.5" />
            Joined {format(new Date(profile.created_at), "MMM yyyy")}
          </div>
        </div>

        {profile.bio && (
          <p className="mt-4 text-sm text-muted leading-relaxed">{profile.bio}</p>
        )}

        {/*
          Six columns, spanned 2/2/2 then 3/3, so both rows fill completely.

          There are exactly five stats and this was `grid-cols-3`, which left
          the last two alone on a second row with a hole beside them — a row's
          worth of height that reads as something having failed to load.

          Five across was the obvious fix and I measured it before taking it:
          at 390px it gives each label a 39px box, and SPLIT INDEX, ENDURANCE,
          STRENGTH and WORKOUTS all truncate. "STRE…" under a number is worse
          than the hole it replaces, and there is no honest six-character word
          for "Workouts" — LOGGED needs 41px, SESSIONS 46, WORKOUTS 53. So the
          row stays, and what gets fixed is the gap in it.
        */}
        <div className="mt-6 grid grid-cols-6 gap-1.5 sm:grid-cols-5 sm:gap-3">
          {indexStats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
              className="glass col-span-2 rounded-xl border border-white/[0.06] p-3 text-center transition-colors hover:border-white/10 sm:col-span-1"
            >
              <p className={`index-display text-xl font-bold ${stat.accent}`}>
                {stat.value !== null ? formatIndex(stat.value) : "—"}
              </p>
              <p className="mt-1 text-[10px] text-muted uppercase tracking-wider sm:text-[11px]">
                {stat.label}
              </p>
            </motion.div>
          ))}
          {countStats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + (indexStats.length + i) * 0.05 }}
              className="glass col-span-3 rounded-xl border border-white/[0.06] p-3 text-center transition-colors hover:border-white/10 sm:col-span-1"
            >
              <p className={`index-display text-xl font-bold ${stat.accent}`}>
                {stat.value.toLocaleString()}
              </p>
              <p className="mt-1 text-[10px] text-muted uppercase tracking-wider sm:text-[11px]">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
