"use client";

import { useRouter, usePathname } from "next/navigation";
import { motion, PanInfo, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

const SWIPE_THRESHOLD = 80;

interface TrainZoneSwipeProps {
  mode: "gym" | "cardio";
  children: React.ReactNode;
}

export function TrainZoneSwipe({ mode, children }: TrainZoneSwipeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();

  const other = mode === "gym" ? "/cardio" : "/gym";
  const otherLabel = mode === "gym" ? "The Engine" : "The Lab";

  const navigateOther = () => {
    if (pathname !== other) router.push(other);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (reducedMotion) return;
    const { offset, velocity } = info;
    if (mode === "gym" && (offset.x < -SWIPE_THRESHOLD || velocity.x < -400)) {
      navigateOther();
    } else if (mode === "cardio" && (offset.x > SWIPE_THRESHOLD || velocity.x > 400)) {
      navigateOther();
    }
  };

  return (
    <div className="relative">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
          <Link
            href="/gym"
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-200 min-h-[44px] flex items-center",
              mode === "gym"
                ? "bg-gym-accent/15 text-gym-accent"
                : "text-muted hover:text-foreground"
            )}
          >
            The Lab
          </Link>
          <Link
            href="/cardio"
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-200 min-h-[44px] flex items-center",
              mode === "cardio"
                ? "bg-cardio-accent/15 text-cardio-accent"
                : "text-muted hover:text-foreground"
            )}
          >
            The Engine
          </Link>
        </div>
        <button
          type="button"
          onClick={navigateOther}
          className="hidden sm:flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors duration-200"
        >
          {mode === "gym" ? (
            <>
              Engine <ChevronRight className="h-4 w-4" />
            </>
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" /> Lab
            </>
          )}
        </button>
      </div>

      <motion.div
        drag={reducedMotion ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.12}
        onDragEnd={onDragEnd}
        className="touch-pan-y"
      >
        {children}
      </motion.div>

      <p className="mt-4 text-center text-[11px] text-muted/60 sm:hidden">
        Swipe {mode === "gym" ? "left" : "right"} for {otherLabel}
      </p>
    </div>
  );
}
