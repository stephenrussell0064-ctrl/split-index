"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { CountUp } from "@/components/dashboard/count-up";

const SIZE = 190;
const STROKE = 12;
const R = (SIZE - STROKE * 2) / 2;
const CX = SIZE / 2;
const CIRC = 2 * Math.PI * R;
/** Whoop-style 270° arc with the gap at the bottom */
const ARC_FRACTION = 0.75;
const ARC = CIRC * ARC_FRACTION;

type Band = "high" | "mid" | "low";

function bandFor(score: number): Band {
  if (score >= 67) return "high";
  if (score >= 34) return "mid";
  return "low";
}

const bandMeta: Record<
  Band,
  { color: string; label: string; blurb: string }
> = {
  high: { color: "#10b981", label: "Primed", blurb: "Body is ready for load" },
  mid: { color: "#f59e0b", label: "Steady", blurb: "Train, but manage intensity" },
  low: { color: "#ef4444", label: "Run down", blurb: "Prioritize rest today" },
};

/** Background zone segment of the 270° arc: start/length as fractions of the arc */
function zoneSegment(start: number, length: number, color: string) {
  return (
    <circle
      cx={CX}
      cy={CX}
      r={R}
      fill="none"
      stroke={color}
      strokeOpacity={0.14}
      strokeWidth={STROKE}
      strokeLinecap="butt"
      strokeDasharray={`${ARC * length} ${CIRC}`}
      strokeDashoffset={-ARC * start}
    />
  );
}

interface RecoveryGaugeProps {
  score: number;
  className?: string;
}

export function RecoveryGauge({ score, className }: RecoveryGaugeProps) {
  const reducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, score));
  const band = bandFor(clamped);
  const { color, label, blurb } = bandMeta[band];
  const filled = ARC * (clamped / 100);

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="rotate-[135deg]"
        >
          {/* track */}
          <circle
            cx={CX}
            cy={CX}
            r={R}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${ARC} ${CIRC}`}
          />
          {/* color band hints: red / amber / green thirds */}
          {zoneSegment(0, 1 / 3, "#ef4444")}
          {zoneSegment(1 / 3, 1 / 3, "#f59e0b")}
          {zoneSegment(2 / 3, 1 / 3, "#10b981")}
          {/* value arc */}
          <motion.circle
            cx={CX}
            cy={CX}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 10px ${color}66)` }}
            initial={
              reducedMotion
                ? { strokeDasharray: `${filled} ${CIRC}` }
                : { strokeDasharray: `0.01 ${CIRC}` }
            }
            animate={{ strokeDasharray: `${filled} ${CIRC}` }}
            transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted">
            Recovery
          </span>
          <span
            className="index-display mt-1 text-5xl font-bold tabular-nums"
            style={{ color }}
          >
            <CountUp value={clamped} delay={0.3} />
          </span>
          <span className="mt-1 text-xs font-medium" style={{ color }}>
            {label}
          </span>
        </div>
      </div>
      <p className="-mt-3 text-xs text-muted">{blurb}</p>
    </div>
  );
}
