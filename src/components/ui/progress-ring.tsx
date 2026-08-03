import { cn } from "@/lib/utils/cn";

interface ProgressRingProps {
  /** 0–1. Values outside this range are clamped. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  /** Tailwind text-color class — the ring stroke uses currentColor. */
  colorClassName?: string;
  trackClassName?: string;
  children?: React.ReactNode;
  className?: string;
}

/** A circular progress gauge, SVG-based — the hero-card visual centerpiece (Apple Fitness / SunSafe style "ring" motif). */
export function ProgressRing({
  progress,
  size = 88,
  strokeWidth = 8,
  colorClassName = "text-accent",
  trackClassName = "text-white/10",
  children,
  className,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const offset = circumference * (1 - clamped);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          stroke="currentColor"
          className={trackClassName}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(colorClassName, "transition-[stroke-dashoffset] duration-700 ease-out")}
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}
