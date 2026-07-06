"use client";

import { motion } from "framer-motion";
import { ENDURANCE_SPORTS, SPORTS } from "@/lib/constants/sports";
import { cn } from "@/lib/utils/cn";
import type { SportType } from "@/types";

export function CardioSportPicker({
  onSelect,
  draftSports,
}: {
  onSelect: (sport: SportType) => void;
  draftSports: SportType[];
}) {
  const enduranceSports = SPORTS.filter((s) => ENDURANCE_SPORTS.includes(s.id));

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-widest text-cardio-accent/80 mb-2">
        The Engine · Log
      </p>
      <h1 className="headline-tight text-3xl font-bold tracking-tight mb-2 text-cardio-text">
        What did you train?
      </h1>
      <p className="text-cardio-muted mb-8">Endurance sports only — tailored metrics per discipline.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {enduranceSports.map((sport, index) => {
          const hasDraft = draftSports.includes(sport.id);
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
                "border-cardio-border/30 bg-cardio-bg-elevated/10 hover:border-cardio-accent/40 hover:bg-cardio-accent/5"
              )}
            >
              {hasDraft && (
                <span className="absolute right-3 top-3 text-[9px] font-medium uppercase tracking-wider text-warning">
                  Draft
                </span>
              )}
              <span className="mb-3 block text-3xl">{sport.icon}</span>
              <span className="block text-sm font-semibold text-cardio-text">{sport.name}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
