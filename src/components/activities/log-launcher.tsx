"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Dumbbell, MapPin, PencilLine, ChevronRight } from "lucide-react";
import { ENDURANCE_SPORTS, SPORTS } from "@/lib/constants/sports";
import { cn } from "@/lib/utils/cn";
import type { SportType } from "@/types";

/**
 * What the + button opens.
 *
 * Two things were wrong with the grid this replaces (user feedback: "when you
 * click the + button... this allows you to start recording using GPS as well
 * as manually logging activities. Also currently you have to scroll down for
 * the lab"):
 *
 *   1. GPS was not reachable from here at all. Live tracking lived only on the
 *      Engine tab behind a "Start GPS tracking" button, so the one control the
 *      whole bottom bar builds a raised circle around could only ever type a
 *      workout in after the fact.
 *   2. Nine equal tiles in a two-column grid put Gym — the app's entire
 *      strength half — ninth, below the fold on a phone. The Lab was
 *      literally something you had to scroll to find.
 *
 * So the screen is now split down the middle the same way the product is: The
 * Lab gets half, The Engine gets the other half, and neither can push the
 * other off screen. The halves carry their own zone colours (black/green,
 * white/blue) rather than being two identical dark cards, so which half is
 * which is legible before a word is read.
 */

/** GPS tracking only supports these three — see GPS_SPORTS on the gps-run page, which this must not get ahead of. */
const GPS_OPTIONS: { sport: SportType; label: string; icon: string }[] = [
  { sport: "running", label: "Run", icon: "🏃" },
  { sport: "outdoor_cycling", label: "Ride", icon: "🚵" },
  { sport: "walking", label: "Walk", icon: "🚶" },
];

/**
 * "Start recording" as three one-tap destinations.
 *
 * Exported so The Engine's own log screen (/cardio/log, which the + button
 * opens while the athlete is on the Engine tab) offers the same three. GPS
 * being reachable from the + button in one mode and not another is the bug
 * this is here to avoid, not a design.
 */
export function GpsRecordRow() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {GPS_OPTIONS.map(({ sport, label, icon }) => (
        <Link
          key={sport}
          href={`/cardio/gps-run?sport=${sport}`}
          /*
            text-cardio-text, not text-white. White on the Engine's blue is
            2.60:1 — below AA and below the 3:1 large-text floor. The dark
            label on the same blue is 6.80:1, so the brand fill is unchanged
            and the words on it are legible. The global [data-mode="cardio"]
            override cannot help here: the launcher renders in neutral mode.
          */
          className="flex flex-col items-center justify-center gap-0.5 rounded-2xl bg-cardio-accent px-2 py-2.5 text-cardio-text transition-opacity hover:opacity-90"
        >
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider opacity-80">
            <MapPin className="h-3 w-3" />
            GPS
          </span>
          <span className="text-sm font-semibold leading-none">
            <span aria-hidden className="mr-1">
              {icon}
            </span>
            {label}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function LogLauncher({
  onSelect,
  draftSports,
}: {
  onSelect: (sport: SportType) => void;
  draftSports: SportType[];
}) {
  const enduranceSports = SPORTS.filter((s) => ENDURANCE_SPORTS.includes(s.id));
  const gymHasDraft = draftSports.includes("gym");

  return (
    <div className="mx-auto max-w-3xl">
      <p className="micro-label mb-3 text-muted">Log workout</p>

      {/*
        Half each, and a real height rather than `flex-1` inside an auto-height
        page: the app shell's content wrapper grows with its children, so
        percentage heights have nothing to resolve against. The subtraction is
        the shell's own chrome — top bar, top padding, and the pb-24 that keeps
        content clear of the bottom nav — so the two halves land on one screen
        without the page scrolling. min-h is the floor for short screens, where
        scrolling a little beats crushing the sport tiles.
      */}
      <div className="grid min-h-[30rem] grid-rows-2 gap-3 lg:h-auto lg:min-h-0 lg:grid-cols-2 lg:grid-rows-1 h-[calc(100dvh-14rem)]">
        {/* ── THE LAB ─────────────────────────────────────────────────── */}
        <motion.button
          type="button"
          onClick={() => onSelect("gym")}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className={cn(
            "group relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl border p-5 text-center",
            "border-gym-border bg-gym-bg-elevated transition-colors duration-200",
            "hover:border-gym-accent/45 focus-visible:border-gym-accent/45"
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_90%_at_50%_0%,var(--gym-glow),transparent_65%)]"
          />
          {gymHasDraft && (
            <span className="absolute right-5 top-5 z-10 rounded-full bg-warning/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-warning">
              Draft
            </span>
          )}

          <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gym-accent/12 text-gym-accent">
            <Dumbbell className="h-8 w-8" />
          </span>

          <div className="relative">
            <p className="micro-label text-gym-accent">The Lab · Strength</p>
            <h2 className="headline-tight mt-1 text-2xl font-bold text-gym-text sm:text-3xl">
              Gym session
            </h2>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-gym-muted">
              Exercises, sets and reps — scored against your own best lifts.
            </p>
          </div>

          <span className="relative flex items-center gap-1 rounded-full bg-gym-accent/12 px-4 py-1.5 text-sm font-semibold text-gym-accent">
            Start lifting
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </motion.button>

        {/* ── THE ENGINE ──────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.25 }}
          className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-cardio-border bg-cardio-bg p-5"
        >
          <p className="micro-label text-cardio-accent">The Engine · Endurance</p>

          {/*
            GPS first, and as its own row rather than a badge on three of the
            tiles below: recording live and typing a session in afterwards are
            different intentions, not two ways of picking a sport, and the one
            that has to happen before the session is the one that belongs at
            the top.
          */}
          <div className="mt-2.5">
            <GpsRecordRow />
          </div>

          <p className="mt-4 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cardio-muted">
            <PencilLine className="h-3 w-3" />
            Or log one you&apos;ve done
          </p>

          {/*
            The individual cardio disciplines, inside the Engine half where
            they belong. min-h-0 + overflow-y-auto so a long list scrolls
            WITHIN this half rather than pushing The Lab off the screen —
            which is the exact failure this layout exists to fix.
          */}
          <div className="mt-2 grid min-h-0 flex-1 grid-cols-4 content-start gap-1.5 overflow-y-auto">
            {enduranceSports.map((sport) => {
              const hasDraft = draftSports.includes(sport.id);
              return (
                <button
                  key={sport.id}
                  type="button"
                  onClick={() => onSelect(sport.id)}
                  className={cn(
                    "relative flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-colors",
                    "border-cardio-border/60 bg-cardio-bg-elevated hover:border-cardio-accent hover:bg-cardio-accent/10"
                  )}
                >
                  {hasDraft && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning" />
                  )}
                  <span aria-hidden className="text-lg leading-none">
                    {sport.icon}
                  </span>
                  <span className="text-center text-[10px] font-semibold leading-tight text-cardio-text">
                    {sport.name}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.section>
      </div>
    </div>
  );
}
