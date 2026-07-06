"use client";

import { motion, useReducedMotion } from "framer-motion";
import { format } from "date-fns";
import { Calendar, Crown } from "lucide-react";
import { formatIndex } from "@/lib/utils/format";
import type { Profile } from "@/types";

interface ProfileHeaderProps {
  profile: Profile;
  email: string;
  splitIndex: number | null;
  enduranceIndex: number | null;
  strengthIndex: number | null;
  activityCount: number;
  prCount: number;
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
}: ProfileHeaderProps) {
  const reducedMotion = useReducedMotion();
  const isPremium = profile.subscription_tier === "premium";

  const stats = [
    { label: "Split Index", value: splitIndex, accent: "text-foreground" },
    { label: "Endurance", value: enduranceIndex, accent: "text-endurance" },
    { label: "Strength", value: strengthIndex, accent: "text-strength" },
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
      <div className="h-24 bg-gradient-to-r from-accent/25 via-endurance/15 to-strength/20" />

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

        <div className="mt-6 grid grid-cols-3 sm:grid-cols-5 gap-3">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
              className="glass rounded-xl border border-white/[0.06] p-3 text-center transition-colors hover:border-white/10"
            >
              <p
                className={`index-display text-xl font-bold ${stat.accent}`}
              >
                {stat.value !== null ? formatIndex(stat.value) : "—"}
              </p>
              <p className="mt-1 text-[11px] text-muted uppercase tracking-wider">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
