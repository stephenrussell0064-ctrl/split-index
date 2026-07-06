"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Target, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SPORTS } from "@/lib/constants/sports";
import type { ChallengeWithProgress } from "@/lib/social/types";
import { format } from "date-fns";

interface ChallengesPanelProps {
  initialChallenges: ChallengeWithProgress[];
}

export function ChallengesPanel({ initialChallenges }: ChallengesPanelProps) {
  const [challenges, setChallenges] = useState(initialChallenges);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function toggleJoin(challenge: ChallengeWithProgress) {
    setLoadingId(challenge.id);
    try {
      const res = await fetch(`/api/challenges/${challenge.id}/join`, {
        method: challenge.joined ? "DELETE" : "POST",
      });
      if (res.ok) {
        setChallenges((prev) =>
          prev.map((c) =>
            c.id === challenge.id
              ? {
                  ...c,
                  joined: !c.joined,
                  participantCount: c.joined
                    ? c.participantCount - 1
                    : c.participantCount + 1,
                  progress: c.joined ? 0 : c.progress,
                }
              : c
          )
        );
      }
    } finally {
      setLoadingId(null);
    }
  }

  if (challenges.length === 0) {
    return (
      <Card padding="md">
        <div className="flex flex-col items-center py-12 text-center">
          <Target className="mb-3 h-8 w-8 text-endurance/60" />
          <p className="text-sm text-muted">No active challenges right now</p>
          <p className="mt-1 text-xs text-muted/70">Check back soon for new events</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {challenges.map((challenge, i) => {
        const sport = SPORTS.find((s) => s.id === challenge.sport);
        const endLabel = format(new Date(challenge.endDate), "d MMM");

        return (
          <motion.div
            key={challenge.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <Card padding="sm" className="h-full flex flex-col">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{challenge.title}</h3>
                  <p className="mt-0.5 text-xs text-muted line-clamp-2">
                    {challenge.description}
                  </p>
                </div>
                {sport && <span className="text-lg">{sport.icon}</span>}
              </div>

              <div className="mb-3 h-1.5 rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-endurance transition-all duration-500"
                  style={{ width: `${challenge.progress}%` }}
                />
              </div>

              <div className="mb-3 flex justify-between text-xs text-muted">
                <span>
                  {challenge.joined
                    ? `${challenge.progress}% complete`
                    : "Join to track progress"}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {challenge.participantCount}
                </span>
              </div>

              <div className="mt-auto flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted">
                  Ends {endLabel}
                </span>
                <Button
                  size="sm"
                  variant={challenge.joined ? "secondary" : "endurance"}
                  loading={loadingId === challenge.id}
                  onClick={() => toggleJoin(challenge)}
                >
                  {challenge.joined ? "Leave" : "Join"}
                </Button>
              </div>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
