"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import {
  crossedIndexMilestone,
  markMilestoneCelebrated,
  getCelebratedMilestones,
  type IndexMilestone,
} from "@/lib/retention/milestones";

interface MilestoneToastProps {
  previousIndex: number;
  currentIndex: number;
}

export function MilestoneToast({
  previousIndex,
  currentIndex,
}: MilestoneToastProps) {
  const [milestone, setMilestone] = useState<IndexMilestone | null>(null);

  useEffect(() => {
    const crossed = crossedIndexMilestone(previousIndex, currentIndex);
    if (!crossed) return;
    const celebrated = getCelebratedMilestones();
    if (celebrated.includes(crossed)) return;
    markMilestoneCelebrated(crossed);
    const showTimer = setTimeout(() => setMilestone(crossed), 0);
    const hideTimer = setTimeout(() => setMilestone(null), 5000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [previousIndex, currentIndex]);

  return (
    <AnimatePresence>
      {milestone && (
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: "spring", bounce: 0.35 }}
          className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-warning/30 bg-background/95 px-5 py-4 shadow-2xl backdrop-blur lg:bottom-8"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/20">
            <Sparkles className="h-5 w-5 text-warning" />
          </span>
          <div>
            <p className="text-sm font-semibold">Index milestone</p>
            <p className="text-xs text-muted">
              You crossed {milestone} — elite territory awaits.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
