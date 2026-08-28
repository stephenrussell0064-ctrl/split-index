"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Target, Trophy, Users, Medal, Swords, Users2, Rss } from "lucide-react";
import { LeaderboardPanel } from "@/components/social/leaderboard-panel";
import { FeedPanel } from "@/components/social/feed-panel";
import { FriendsPanel } from "@/components/social/friends-panel";
import { ChallengesPanel } from "@/components/social/challenges-panel";
import { DuelsPanel } from "@/components/social/duels-panel";
import { SquadsPanel } from "@/components/social/squads-panel";
import { AchievementsPanel } from "@/components/social/achievements-panel";
import { CompareModal } from "@/components/social/compare-modal";
import { PageHeader } from "@/components/ui/page-header";
import type {
  AchievementBadge,
  BracketSummary,
  ChallengeWithProgress,
  DuelWithStandings,
  FriendConnection,
  LeaderboardRow,
  SquadSummary,
} from "@/lib/social/types";
import { cn } from "@/lib/utils/cn";

type SocialTab = "feed" | "squads" | "duels" | "friends" | "challenges" | "leaderboards" | "achievements";

// Feed leads (Slice 1: "integrate this into the social part of the app") —
// the athlete's own activities interleaved with their friends' shared ones
// are the most Strava-like, immediately-relevant surface here, ahead of even
// Squads/Duels. Squads and Duels come next —
// real training partners you know, not anonymous bracket peers.
// Leaderboards are demoted (kept, not removed) per the interference-brief
// Part 4 social layer rework.
const TABS: { id: SocialTab; label: string; icon: typeof Trophy }[] = [
  { id: "feed", label: "Feed", icon: Rss },
  { id: "squads", label: "Squads", icon: Users2 },
  { id: "duels", label: "Duels", icon: Swords },
  { id: "friends", label: "Friends", icon: Users },
  { id: "challenges", label: "Challenges", icon: Target },
  { id: "leaderboards", label: "Leaderboards", icon: Trophy },
  { id: "achievements", label: "Achievements", icon: Medal },
];

interface SocialHubProps {
  currentUserId: string;
  userCountry: string | null;
  isPremium: boolean;
  leaderboard: LeaderboardRow[];
  leaderboardBracket?: BracketSummary | null;
  friends: FriendConnection[];
  incoming: FriendConnection[];
  outgoing: FriendConnection[];
  challenges: ChallengeWithProgress[];
  achievements: AchievementBadge[];
  duels: DuelWithStandings[];
  squads: SquadSummary[];
  streak: number;
}

export function SocialHub({
  currentUserId,
  userCountry,
  isPremium,
  leaderboard,
  leaderboardBracket = null,
  friends,
  incoming,
  outgoing,
  challenges,
  achievements,
  duels,
  squads,
  streak,
}: SocialHubProps) {
  const [tab, setTab] = useState<SocialTab>("feed");
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareTarget, setCompareTarget] = useState<{
    username?: string;
    userId?: string;
  }>({});
  const reducedMotion = useReducedMotion();
  const spring = { type: "spring" as const, stiffness: 400, damping: 30 };

  function openCompare(username: string | null, userId: string) {
    setCompareTarget({ username: username ?? undefined, userId });
    setCompareOpen(true);
  }

  const friendOptions = friends.map((f) => ({
    userId: f.profile.userId,
    username: f.profile.username,
    label: f.profile.displayName ?? f.profile.username ?? "Friend",
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Community"
        title="Social"
        subtitle="Compete, connect, and challenge"
      />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200",
                tab === t.id
                  ? "border-accent/30 bg-accent text-accent-foreground shadow-md shadow-accent/25"
                  : "border-white/[0.06] glass text-muted hover:border-white/10 hover:bg-white/[0.04] hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              {t.label}
            </button>
          );
        })}
      </div>

      <motion.div
        key={tab}
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        {tab === "feed" && <FeedPanel />}

        {tab === "squads" && <SquadsPanel initialSquads={squads} currentUserId={currentUserId} />}

        {tab === "leaderboards" && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <LeaderboardPanel
                initialRows={leaderboard}
                initialBracket={leaderboardBracket}
                currentUserId={currentUserId}
                userCountry={userCountry}
                isPremium={isPremium}
                onCompare={openCompare}
              />
            </div>
            <AchievementsPanel achievements={achievements} streak={streak} />
          </div>
        )}

        {tab === "friends" && (
          <FriendsPanel
            initialFriends={friends}
            initialIncoming={incoming}
            initialOutgoing={outgoing}
            onCompare={openCompare}
          />
        )}

        {tab === "duels" && (
          <DuelsPanel initialDuels={duels} friends={friends} currentUserId={currentUserId} />
        )}

        {tab === "challenges" && (
          <div>
            <div className="mb-4 flex items-center gap-2">
              <Target className="h-5 w-5 text-endurance" />
              <h2 className="text-lg font-semibold">Active Challenges</h2>
            </div>
            <ChallengesPanel initialChallenges={challenges} />
          </div>
        )}

        {tab === "achievements" && (
          <AchievementsPanel achievements={achievements} streak={streak} />
        )}
      </motion.div>

      <CompareModal
        key={`${compareTarget.userId ?? ""}-${compareTarget.username ?? ""}`}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        initialUsername={compareTarget.username}
        initialUserId={compareTarget.userId}
        friendOptions={friendOptions}
      />
    </div>
  );
}
