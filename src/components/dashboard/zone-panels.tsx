"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { Dumbbell, PlusCircle, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatIndex } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";

interface GymZonePanelProps {
  strengthIndex: number | null;
  recentGymScores: { date: string; score: number }[];
  hasHistory: boolean;
  className?: string;
}

export function GymZonePanel({
  strengthIndex,
  recentGymScores,
  hasHistory,
  className,
}: GymZonePanelProps) {
  const reducedMotion = useReducedMotion();
  const maxScore = Math.max(...recentGymScores.map((s) => s.score), 1);

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, x: -32 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative overflow-hidden rounded-3xl bg-gym-zone film-grain light-rays",
        className
      )}
    >
      <div className="relative z-[2] p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="micro-label text-gym-accent/70 mb-2">The Lab</p>
            <h2 className="headline-tight text-2xl font-bold text-gym-text sm:text-3xl">
              Strength HQ
            </h2>
            <p className="mt-2 max-w-sm text-sm text-gym-muted">
              Per-lift scores. Preset plans. Repeat any session.
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gym-accent/15 glow-gym">
            <Dumbbell className="h-6 w-6 text-gym-accent" />
          </div>
        </div>

        <div className="mt-8 glass-gym holographic-border rounded-2xl p-6 glow-gym">
          {hasHistory && strengthIndex !== null ? (
            <>
              <p className="micro-label text-gym-muted mb-2">Gym Strength Index</p>
              <p className="index-display text-5xl font-bold text-gradient-gym sm:text-6xl">
                {formatIndex(strengthIndex)}
              </p>
              {recentGymScores.length > 0 && (
                <div className="mt-5">
                  <p className="micro-label text-gym-muted mb-3">Recent sessions</p>
                  <div className="flex items-end gap-1.5 h-12">
                    {recentGymScores.slice(0, 8).map((s, i) => (
                      <motion.div
                        key={`${s.date}-${i}`}
                        initial={reducedMotion ? { height: `${(s.score / maxScore) * 100}%` } : { height: 0 }}
                        animate={{ height: `${(s.score / maxScore) * 100}%` }}
                        transition={{ delay: 0.3 + i * 0.05, duration: 0.5 }}
                        className="flex-1 rounded-t bg-gradient-to-t from-gym-accent/80 to-gym-accent-soft/40 min-h-[4px]"
                        title={`${s.score}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-4 text-center">
              <p className="micro-label text-gym-muted mb-3">Gym Strength Index</p>
              <p className="text-lg font-medium text-gym-text/80">
                Log a gym session to unlock strength scoring
              </p>
              <p className="mt-2 text-xs text-gym-muted">
                Per-lift PRs, relative strength, muscle balance
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/gym/log">
            <Button size="sm" className="bg-gym-accent hover:bg-gym-accent/90 text-white border-0">
              <PlusCircle className="h-4 w-4" />
              Log gym session
            </Button>
          </Link>
          <Link href="/gym">
            <Button variant="secondary" size="sm" className="border-gym-border text-gym-text">
              Open The Lab
            </Button>
          </Link>
        </div>
      </div>
    </motion.section>
  );
}

interface CardioZonePanelProps {
  enduranceIndex: number | null;
  sportScores: { sport: string; avg: number; count: number }[];
  hasHistory: boolean;
  className?: string;
}

export function CardioZonePanel({
  enduranceIndex,
  sportScores,
  hasHistory,
  className,
}: CardioZonePanelProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
      className={cn(
        "relative overflow-hidden rounded-3xl bg-cardio-zone film-grain scan-line",
        className
      )}
    >
      <div className="relative z-[2] p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="micro-label text-cardio-accent mb-2">The Engine</p>
            <h2 className="headline-tight text-2xl font-bold text-cardio-text sm:text-3xl">
              Endurance HQ
            </h2>
            <p className="mt-2 max-w-sm text-sm text-cardio-muted">
              Your 5K run score vs your last 10 runs — apples to apples, sport by sport.
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cardio-accent/10 glow-cardio">
            <TrendingUp className="h-6 w-6 text-cardio-accent" />
          </div>
        </div>

        <div className="mt-8 glass-cardio rounded-2xl p-6 glow-cardio">
          {hasHistory && enduranceIndex !== null ? (
            <>
              <p className="micro-label text-cardio-muted mb-2">Endurance Blend</p>
              <p className="index-display text-5xl font-bold text-gradient-cardio sm:text-6xl">
                {formatIndex(enduranceIndex)}
              </p>
              {sportScores.length > 0 && (
                <div className="mt-5 space-y-2">
                  {sportScores.slice(0, 4).map((s) => (
                    <div key={s.sport} className="flex items-center justify-between text-sm">
                      <span className="capitalize text-cardio-muted">
                        {s.sport.replace("_", " ")}
                      </span>
                      <span className="font-semibold tabular-nums text-cardio-text">
                        {formatIndex(s.avg)}
                        <span className="ml-1.5 text-[10px] font-normal text-cardio-muted">
                          · {s.count} sessions
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="py-4 text-center">
              <p className="micro-label text-cardio-muted mb-3">Endurance Index</p>
              <p className="text-lg font-medium text-cardio-text/80">
                Log a run, row, or swim to start building
              </p>
              <p className="mt-2 text-xs text-cardio-muted">
                Pace splits, sport leaderboards, session deltas
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/cardio/log">
            <Button
              size="sm"
              className="bg-cardio-accent hover:bg-cardio-accent/90 text-white border-0"
            >
              <PlusCircle className="h-4 w-4" />
              Log cardio session
            </Button>
          </Link>
          <Link href="/cardio">
            <Button
              variant="secondary"
              size="sm"
              className="border-cardio-border text-cardio-text bg-white/60"
            >
              Open The Engine
            </Button>
          </Link>
        </div>
      </div>
    </motion.section>
  );
}
