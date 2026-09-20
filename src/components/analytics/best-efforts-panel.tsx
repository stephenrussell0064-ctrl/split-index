"use client";

import Link from "next/link";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChartEmptyState } from "@/components/analytics/charts";
import { SPORTS } from "@/lib/constants/sports";
import { isSpeedBased, sportVocabulary } from "@/lib/analysis/vocabulary";
import type { PersonalBestEffort } from "@/lib/analysis/records";
import type { SportType } from "@/types";

/**
 * The athlete's fastest ever effort at each standard distance, across every
 * GPS session they have recorded.
 *
 * Sits beside Race Records deliberately rather than replacing it, because the
 * two answer different questions and an athlete wants both. Race Records is
 * the best WHOLE logged activity at a distance: you went out and ran a 5K,
 * that is your 5K. This is the fastest STRETCH of that distance found anywhere
 * inside any session, so a quick 5K buried in the middle of a long run counts.
 * For most people the second is the faster number, and it is invisible without
 * per-sample data — which is why this could not exist before activity streams
 * (migration 078) and the cross-activity query in 079.
 *
 * Grouped by sport, because a 5K on foot and a 5K on a bike are not comparable
 * and a single ladder mixing them would be nonsense.
 */
export function BestEffortsPanel({ efforts }: { efforts: PersonalBestEffort[] }) {
  const bySport = groupBySport(efforts);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning" />
            <CardTitle>Best Efforts</CardTitle>
          </div>
          <p className="mt-1 text-xs text-muted">
            Your fastest ever at each distance, found anywhere inside a tracked session — not
            only in sessions you set out to race.
          </p>
        </CardHeader>
        <CardContent>
          {efforts.length === 0 ? (
            <ChartEmptyState message="Record a run, ride or walk with GPS and your fastest efforts at every distance appear here" />
          ) : (
            <div className="space-y-4">
              {bySport.map(({ sport, rows }) => (
                <SportGroup key={sport} sport={sport} rows={rows} showSportName={bySport.length > 1} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function groupBySport(efforts: PersonalBestEffort[]): { sport: SportType; rows: PersonalBestEffort[] }[] {
  const map = new Map<SportType, PersonalBestEffort[]>();
  for (const e of efforts) {
    const list = map.get(e.sport) ?? [];
    list.push(e);
    map.set(e.sport, list);
  }
  return [...map.entries()]
    .map(([sport, rows]) => ({
      sport,
      rows: [...rows].sort((a, b) => a.distanceMeters - b.distanceMeters),
    }))
    .sort((a, b) => b.rows.length - a.rows.length);
}

function SportGroup({
  sport,
  rows,
  showSportName,
}: {
  sport: SportType;
  rows: PersonalBestEffort[];
  showSportName: boolean;
}) {
  const meta = SPORTS.find((s) => s.id === sport);
  const speedBased = isSpeedBased(sport);

  return (
    <div>
      {showSportName && (
        <p className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
          <span aria-hidden>{meta?.icon}</span>
          {meta?.name ?? sportVocabulary(sport).Noun}
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((e) => (
          <li key={`${e.sport}-${e.distanceMeters}`} className="glass rounded-xl p-3">
            <Link
              href={`/activities/${e.activityId}`}
              className="block rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <p className="text-[10px] uppercase tracking-wider text-muted">{e.label}</p>
              <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums">
                {effortClock(e.elapsedSeconds)}
              </p>
              <p className="text-[10px] text-muted tabular-nums">
                {speedBased
                  ? `${(3600 / e.paceSecondsPerKm).toFixed(1)} km/h`
                  : `${paceClock(e.paceSecondsPerKm)}/km`}
                {" · "}
                {format(new Date(e.achievedAt), "MMM d, yyyy")}
              </p>
              {/* One attempt is a first, not a record. Saying "best" would
                  imply a field of efforts it was measured against. */}
              {e.attempts === 1 && <p className="text-[10px] text-muted/70">first at this distance</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function paceClock(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

/**
 * m:ss, or h:mm:ss past the hour.
 *
 * Deliberately NOT the shared formatDuration, which renders anything over an
 * hour as "1h 38m" and drops the seconds entirely. That is fine for a training
 * volume and wrong for a personal best: a half marathon best of 1:38:02 and
 * one of 1:38:59 are not the same achievement, and a PB card that cannot tell
 * them apart is not showing a PB. This is the same clock the per-session best
 * efforts list uses, so the two halves of the feature agree.
 */
function effortClock(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
