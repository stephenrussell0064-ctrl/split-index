"use client";

import { cn } from "@/lib/utils/cn";

interface SplitWeightSliderProps {
  enduranceWeight: number;
  onChange: (enduranceWeight: number) => void;
  disabled?: boolean;
  className?: string;
}

export function SplitWeightSlider({
  enduranceWeight,
  onChange,
  disabled = false,
  className,
}: SplitWeightSliderProps) {
  const endPct = Math.round(enduranceWeight * 100);
  const strPct = 100 - endPct;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex justify-between text-xs">
        <span className="text-cardio-accent font-medium">
          Cardio {endPct}%
        </span>
        <span className="text-strength-accent font-medium">
          Strength {strPct}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        disabled={disabled}
        value={endPct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gradient-to-r from-cardio-accent/60 via-white/10 to-strength-accent/60 accent-white disabled:opacity-50"
        aria-label="Split Index endurance vs strength weighting"
      />
      <p className="text-[10px] text-muted text-center">
        Adjust how cardio and strength contribute to your Split Index
      </p>
    </div>
  );
}
