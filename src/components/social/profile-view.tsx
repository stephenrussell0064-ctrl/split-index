"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Flame, GitCompare, MapPin } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/social/user-avatar";
import { CompareModal } from "@/components/social/compare-modal";
import { SPORTS } from "@/lib/constants/sports";
import { formatIndex } from "@/lib/utils/format";
import type { PublicProfile } from "@/lib/social/types";
import { format } from "date-fns";
import { useState } from "react";

interface ProfileViewProps {
  profile: PublicProfile;
  isOwnProfile: boolean;
}

export function ProfileView({ profile, isOwnProfile }: ProfileViewProps) {
  const [compareOpen, setCompareOpen] = useState(false);

  const preferredSportLabels = profile.preferredSports
    .map((id) => SPORTS.find((s) => s.id === id))
    .filter(Boolean);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          href="/social"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Social
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl border border-white/10 p-6 glow-accent"
        >
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <UserAvatar
              name={profile.displayName ?? profile.username}
              avatarUrl={profile.avatarUrl}
              size="lg"
            />
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl font-bold">
                {profile.displayName ?? profile.username}
              </h1>
              <p className="text-sm text-muted">@{profile.username}</p>
              {profile.bio && (
                <p className="mt-2 text-sm text-muted/90">{profile.bio}</p>
              )}
              <div className="mt-3 flex flex-wrap justify-center gap-3 text-xs text-muted sm:justify-start">
                {profile.country && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {profile.country}
                  </span>
                )}
                {profile.streak > 0 && (
                  <span className="flex items-center gap-1 text-warning">
                    <Flame className="h-3 w-3" />
                    {profile.streak} day streak
                  </span>
                )}
                <span>
                  Joined {format(new Date(profile.createdAt), "MMM yyyy")}
                </span>
              </div>
            </div>
            {!isOwnProfile && (
              <Button size="sm" variant="secondary" onClick={() => setCompareOpen(true)}>
                <GitCompare className="h-4 w-4" />
                Compare
              </Button>
            )}
          </div>
        </motion.div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Split Index", value: profile.currentSplitIndex, color: "text-accent" },
            {
              label: "Endurance",
              value: profile.currentEnduranceIndex,
              color: "text-endurance",
            },
            {
              label: "Strength",
              value: profile.currentStrengthIndex,
              color: "text-strength",
            },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
            >
              <Card padding="sm" className="text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  {stat.label}
                </p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${stat.color}`}>
                  {stat.value != null ? formatIndex(stat.value) : "—"}
                </p>
              </Card>
            </motion.div>
          ))}
        </div>

        {preferredSportLabels.length > 0 && (
          <Card padding="sm">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
              Preferred Sports
            </p>
            <div className="flex flex-wrap gap-2">
              {preferredSportLabels.map((sport) => (
                <span
                  key={sport!.id}
                  className="rounded-lg glass px-3 py-1 text-xs"
                >
                  {sport!.icon} {sport!.name}
                </span>
              ))}
            </div>
          </Card>
        )}

        <Card padding="sm">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
            Recent Activity (30 days)
          </p>
          <div className="flex gap-6">
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {profile.recentActivityCount}
              </p>
              <p className="text-xs text-muted">Workouts</p>
            </div>
            {profile.recentAvgIndex != null && (
              <div>
                <p className="text-2xl font-bold tabular-nums text-accent">
                  {formatIndex(profile.recentAvgIndex)}
                </p>
                <p className="text-xs text-muted">Avg Index</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <CompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        initialUsername={profile.username}
      />
    </AppShell>
  );
}
