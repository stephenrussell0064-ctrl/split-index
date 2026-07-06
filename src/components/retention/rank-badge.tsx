"use client";

import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface RankBadgeProps {
  percentile: number | null;
  className?: string;
}

export function RankBadge({ percentile, className }: RankBadgeProps) {
  if (percentile === null) return null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-warning/20 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning",
        className
      )}
    >
      <Trophy className="h-3.5 w-3.5" />
      Top {100 - percentile}% globally
    </div>
  );
}
