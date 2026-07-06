"use client";

import { motion } from "framer-motion";
import { SPORTS } from "@/lib/constants/sports";
import { cn } from "@/lib/utils/cn";
import type { SportType } from "@/types";

export function SportPicker({
  onSelect,
  draftSports,
}: {
  onSelect: (sport: SportType) => void;
  draftSports: SportType[];
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-widest text-muted mb-2">
        Log workout
      </p>
      <h1 className="text-3xl font-bold tracking-tight mb-2">What did you train?</h1>
      <p className="text-muted mb-8">Pick a sport — each gets a tailored form.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SPORTS.map((sport, index) => {
          const hasDraft = draftSports.includes(sport.id);
          const isStrength = sport.category === "strength";
          return (
            <motion.button
              key={sport.id}
              type="button"
              onClick={() => onSelect(sport.id)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03, duration: 0.25 }}
              className={cn(
                "relative rounded-2xl border p-5 text-center transition-colors duration-200 min-h-[120px]",
                "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/15",
                isStrength && "hover:border-gym-accent/30",
                !isStrength && "hover:border-cardio-accent/30"
              )}
            >
              {hasDraft && (
                <span className="absolute right-3 top-3 text-[9px] font-medium uppercase tracking-wider text-warning">
                  Draft
                </span>
              )}
              <span className="mb-3 block text-3xl">{sport.icon}</span>
              <span className="block text-sm font-semibold">{sport.name}</span>
              <span
                className={cn(
                  "mt-1 block text-[10px] font-medium uppercase tracking-wider text-muted",
                  isStrength && "text-gym-accent/80",
                  !isStrength && "text-cardio-accent/80"
                )}
              >
                {sport.category}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
