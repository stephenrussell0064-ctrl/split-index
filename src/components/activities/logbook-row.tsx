import Link from "next/link";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { RouteMap } from "@/components/activities/route-map";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatDuration, formatDistance, formatPace, formatSpeed } from "@/lib/utils/format";
import { SPORTS, SESSION_TYPES } from "@/lib/constants/sports";
import type { LogbookEntry } from "@/lib/activities/logbook-query";
import {
  surfaceTheme,
  zoneRailClass,
  zoneScoreClass,
  zoneBadgeClass,
  ZONE_SHORT_LABELS,
  type LogbookSurface,
} from "@/components/activities/logbook-theme";
import type { SportType } from "@/types";

/**
 * One session, built to be read at a glance rather than parsed.
 *
 * The old row was `icon · title · "12 Aug 2026 · 45m 12s · 10.02 km" · score`
 * — every fact at the same size, in the same colour, in one run-on line, with
 * pace missing entirely. This splits it into four fixed columns that stay in
 * the same place on every row, so the eye scans down a column instead of
 * re-reading each row from scratch:
 *
 *   [zone rail] [date] [route/sport] [title + metrics] [index]
 *
 * Fixed widths on the date and media columns are load-bearing: a ragged left
 * edge is what made the old list feel like a wall of text.
 */

/** Rowing and ski-erg think in split per 500m, a different stored column from pace per km — see RawStatsPanel, which owns the same distinction on the detail page. */
const SPLIT_SPORTS = new Set<string>(["rowing", "ski_erg"]);

function formatSplit(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}/500m`;
}

/**
 * The session's speed, however this sport expresses it. Cycling reads as
 * km/h, rowing/ski-erg as a 500m split, everything else as min/km — the same
 * mapping the activity detail page uses, so a run's pace doesn't change units
 * between the list and the page it opens.
 */
function paceMetric(entry: LogbookEntry): string | null {
  if (SPLIT_SPORTS.has(entry.sport) && entry.avgSplitSeconds !== null) {
    return formatSplit(entry.avgSplitSeconds);
  }
  const secondsPerKm =
    entry.avgPaceSecondsPerKm ??
    // Manually logged sessions often store only distance and duration; a
    // derived pace is still the number the athlete is scanning for, and it is
    // the same arithmetic they'd do in their head.
    (entry.distanceMeters && entry.distanceMeters > 0 && entry.durationSeconds
      ? entry.durationSeconds / (entry.distanceMeters / 1000)
      : null);
  if (secondsPerKm === null || secondsPerKm <= 0) return null;
  return entry.sport === "outdoor_cycling" ? formatSpeed(secondsPerKm) : formatPace(secondsPerKm);
}

interface Metric {
  key: string;
  value: string;
  /** The one number that answers "how fast/hard was this" — gets the zone accent. */
  lead?: boolean;
  /** Detail that earns its place on a wide screen but not on a phone. */
  desktopOnly?: boolean;
}

function metricsFor(entry: LogbookEntry): Metric[] {
  const metrics: Metric[] = [];

  if (entry.zone === "cardio") {
    if (entry.distanceMeters) {
      metrics.push({ key: "distance", value: formatDistance(entry.distanceMeters) });
    }
    if (entry.durationSeconds) {
      metrics.push({ key: "duration", value: formatDuration(entry.durationSeconds) });
    }
    const pace = paceMetric(entry);
    if (pace) metrics.push({ key: "pace", value: pace, lead: true });
    if (entry.elevationMeters) {
      metrics.push({
        key: "elevation",
        value: `↑ ${Math.round(entry.elevationMeters)} m`,
        desktopOnly: true,
      });
    }
    if (entry.avgHeartRate) {
      metrics.push({ key: "hr", value: `${entry.avgHeartRate} bpm`, desktopOnly: true });
    }
    return metrics;
  }

  if (entry.durationSeconds) {
    metrics.push({ key: "duration", value: formatDuration(entry.durationSeconds) });
  }
  const gym = entry.gymSummary;
  if (gym) {
    if (gym.exercises) {
      metrics.push({ key: "exercises", value: `${gym.exercises} exercises` });
    }
    if (gym.sets) metrics.push({ key: "sets", value: `${gym.sets} sets`, lead: true });
    if (gym.volumeKg >= 1) {
      metrics.push({
        key: "volume",
        value: `${Math.round(gym.volumeKg).toLocaleString()} kg`,
        desktopOnly: true,
      });
    }
  }
  return metrics;
}

/**
 * Selection mode, used when merging sessions that are really one session.
 * Present only while the athlete is choosing; absent, the row is the ordinary
 * link it has always been.
 */
export interface LogbookRowSelection {
  selected: boolean;
  /** True when this session cannot join what is already selected (wrong sport, too far away). */
  disabled: boolean;
  /** Shown as the row's title when disabled, so a greyed-out row explains itself. */
  disabledReason?: string;
  onToggle: () => void;
}

export function LogbookRow({
  entry,
  surface,
  showZoneBadge = true,
  selection,
}: {
  entry: LogbookEntry;
  surface: LogbookSurface;
  /** Off for a zone page, where every row is the same zone and the pill is noise. */
  showZoneBadge?: boolean;
  selection?: LogbookRowSelection;
}) {
  const theme = surfaceTheme(surface);
  const meta = SPORTS.find((s) => s.id === entry.sport);
  const started = new Date(entry.startedAt);
  const metrics = metricsFor(entry);
  const accent = zoneScoreClass(entry.zone, surface);
  const sessionType = SESSION_TYPES.find((t) => t.value === entry.sessionType)?.label ?? null;
  const hasRoute = !!entry.route && entry.route.length >= 2;

  const rowClass = cn(
    "group relative flex w-full items-center gap-3 py-3 pl-4 pr-3 text-left transition-colors sm:gap-4 sm:pl-5 sm:pr-4",
    theme.rowHover,
    selection?.disabled && "opacity-40",
    selection?.selected && "bg-accent/[0.07]"
  );

  const content = (
    <>
      {/* Zone identity, on every row, in the one place the eye is already
          tracking as it scans down the list. */}
      <span
        aria-hidden
        className={cn("absolute inset-y-1 left-0 w-[2px] rounded-full", zoneRailClass(entry.zone))}
      />

      {selection && (
        <span
          aria-hidden
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            selection.selected
              ? "border-accent bg-accent text-black"
              : cn(theme.border, "bg-transparent")
          )}
        >
          {selection.selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
      )}

      <div className="w-8 shrink-0 text-center sm:w-9">
          <p className={cn("font-display text-lg font-bold leading-none tabular-nums", theme.text)}>
            {format(started, "d")}
          </p>
          <p className={cn("micro-label mt-1 text-[9px]", theme.faint)}>{format(started, "EEE")}</p>
        </div>

        {/* One fixed media slot, whether or not this session has a route — a
            map that only some rows have would otherwise shift every other
            row's text sideways. */}
        <div className="h-12 w-12 shrink-0 sm:h-14 sm:w-16">
          {hasRoute ? (
            <RouteMap
              route={entry.route!}
              className="h-full w-full"
              variant={surface === "cardio" ? "light" : "dark"}
              ariaLabel={`Route map for the ${meta?.name ?? entry.sport} on ${format(started, "MMMM d, yyyy")}`}
            />
          ) : (
            <span
              className={cn(
                "flex h-full w-full items-center justify-center rounded-xl border text-xl",
                zoneBadgeClass(entry.zone, surface)
              )}
              aria-hidden
            >
              {meta?.icon ?? "🏋️"}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-medium leading-snug", theme.text)}>
            {entry.title ?? meta?.name ?? entry.sport}
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {showZoneBadge && (
              <span
                className={cn(
                  "micro-label rounded-full border px-1.5 py-px text-[9px]",
                  zoneBadgeClass(entry.zone, surface)
                )}
              >
                {ZONE_SHORT_LABELS[entry.zone]}
              </span>
            )}
            <span className={cn("micro-label text-[9px]", theme.faint)}>
              {meta?.name ?? entry.sport}
              {sessionType ? ` · ${sessionType}` : ""}
            </span>
          </div>

          {metrics.length > 0 && (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px] tabular-nums">
              {metrics.map((metric, i) => (
                <span
                  key={metric.key}
                  className={cn(
                    "inline-flex items-baseline gap-2",
                    metric.desktopOnly && "hidden sm:inline-flex",
                    metric.lead ? cn("font-semibold", accent) : theme.muted
                  )}
                >
                  {i > 0 && <span className={cn("select-none", theme.faint)}>·</span>}
                  {metric.value}
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="w-12 shrink-0 text-right sm:w-14">
          {entry.score !== null ? (
            <>
              <p className={cn("font-display text-xl font-bold leading-none tabular-nums", accent)}>
                {formatIndex(entry.score)}
              </p>
              <p className={cn("micro-label mt-1 text-[9px]", theme.faint)}>Index</p>
            </>
          ) : (
            <p className={cn("text-sm tabular-nums", theme.faint)} aria-label="Not scored">
              —
            </p>
          )}
        </div>
    </>
  );

  return (
    <li className="relative">
      {selection ? (
        // A checkbox rather than a link while selecting: tapping a row to
        // open it and tapping a row to tick it cannot be the same gesture,
        // and a merge that navigates away halfway through choosing is worse
        // than no merge at all.
        <button
          type="button"
          role="checkbox"
          aria-checked={selection.selected}
          aria-label={`${entry.title ?? meta?.name ?? entry.sport}, ${format(started, "d MMMM yyyy")}`}
          title={selection.disabled ? selection.disabledReason : undefined}
          disabled={selection.disabled}
          onClick={selection.onToggle}
          className={cn(rowClass, selection.disabled && "cursor-not-allowed")}
        >
          {content}
        </button>
      ) : (
        <Link href={`/activities/${entry.id}`} className={rowClass}>
          {content}
        </Link>
      )}
    </li>
  );
}

/** Shared by the row and the feed's group summaries, so "10.02 km" means the same thing in both. */
export function sportLabel(sport: string): string {
  return SPORTS.find((s) => s.id === (sport as SportType))?.name ?? sport;
}
