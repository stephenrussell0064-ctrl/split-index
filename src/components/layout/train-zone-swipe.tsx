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
  // Plain word first: the brand names ("The Lab", "The Engine") say nothing to
  // someone who has just installed the app, so they are the caption and
  // "Strength"/"Endurance" is the label everywhere this control speaks.
  const otherLabel = mode === "gym" ? "Endurance" : "Strength";

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
        {/*
          flex-1 on phones so the two halves fill the row and the control reads
          as the Train tab's own switcher rather than a pair of chips that
          happen to sit above the page. It goes back to its content width from
          `sm` up, where the side shortcut shares the row with it.
        */}
        <div className="flex flex-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1 sm:flex-none">
          <Link
            href="/gym"
            className={cn(
              "flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-lg px-4 py-1.5 text-center text-sm font-medium transition-colors duration-200 sm:flex-none",
              mode === "gym"
                ? "bg-gym-accent/15 text-gym-accent"
                : "text-muted hover:text-foreground"
            )}
          >
            Strength
            <span className="text-[10px] font-normal leading-tight text-muted">
              The Lab
            </span>
          </Link>
          <Link
            href="/cardio"
            className={cn(
              "flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-lg px-4 py-1.5 text-center text-sm font-medium transition-colors duration-200 sm:flex-none",
              mode === "cardio"
                ? "bg-cardio-accent/15 text-cardio-accent"
                : "text-muted hover:text-foreground"
            )}
          >
            Endurance
            <span className="text-[10px] font-normal leading-tight text-muted">
              The Engine
            </span>
          </Link>
        </div>
        <button
          type="button"
          onClick={navigateOther}
          className="hidden sm:flex shrink-0 items-center gap-1 text-xs text-muted hover:text-foreground transition-colors duration-200"
        >
          {mode === "gym" ? (
            <>
              Endurance <ChevronRight className="h-4 w-4" />
            </>
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" /> Strength
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
