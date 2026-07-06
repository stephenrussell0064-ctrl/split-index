"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { PlusCircle, Sparkles, Target, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyDashboardHeroProps {
  displayName?: string | null;
}

export function EmptyDashboardHero({ displayName }: EmptyDashboardHeroProps) {
  const firstName = displayName?.split(" ")[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="glass-strong holographic-border relative overflow-hidden rounded-3xl film-grain"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgba(99,102,241,0.12),transparent)]"
      />
      <div className="relative py-10 px-6 text-center sm:px-10">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 glow-accent">
          <Sparkles className="h-7 w-7 text-accent" />
        </div>
        <h2 className="headline-tight text-xl font-bold sm:text-2xl">
          {firstName ? `${firstName}, your index is unwritten` : "Your index is unwritten"}
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted">
          No baseline guess. Log your first workout and earn a sport-specific score —
          your running index vs your runs, your bench score vs your bench history.
        </p>

        <div className="mx-auto mt-6 grid max-w-md gap-3 text-left sm:grid-cols-2">
          {[
            "Per-sport comparative scoring",
            "Hybrid 50/50 composite index",
            "Session-to-session sport deltas",
            "AI coach on score breakdown",
          ].map((item) => (
            <p key={item} className="flex items-start gap-2 text-xs text-muted">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              {item}
            </p>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/gym/log">
            <Button size="lg" variant="secondary">
              <PlusCircle className="h-4 w-4" />
              Log gym
            </Button>
          </Link>
          <Link href="/cardio/log">
            <Button size="lg">
              <PlusCircle className="h-4 w-4" />
              Log cardio
            </Button>
          </Link>
          <Link href="/activities/new" className="text-xs text-muted hover:text-foreground">
            All sports →
          </Link>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Target className="h-3.5 w-3.5" />
            Sport score unlocks instantly
          </p>
        </div>
      </div>
    </motion.div>
  );
}
