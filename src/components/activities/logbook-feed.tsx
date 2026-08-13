"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { formatDistance, formatDuration } from "@/lib/utils/format";
import { SPORTS } from "@/lib/constants/sports";
import { LogbookRow } from "@/components/activities/logbook-row";
import {
  surfaceTheme,
  zoneChipActiveClass,
  ZONE_LABELS,
  type LogbookSurface,
} from "@/components/activities/logbook-theme";
import {
  LOGBOOK_PAGE_SIZE,
  zoneTotals,
  type LogbookEntry,
  type LogbookPage,
  type LogbookSort,
  type LogbookSportCounts,
  type LogbookZone,
} from "@/lib/activities/logbook-query";

/**
 * The logbook, everywhere it appears.
 *
 * Three problems drove this, in the order the user hit them:
 *
 *  1. ACCESS. Every list was a hard `.limit()` with nothing after it — 8 on
 *     The Lab, 20 later, 50 on /activities — so a history longer than the cap
 *     simply stopped, with no indication anything had been cut. Now every
 *     list states its own truncation ("Showing 25 of 312") and can page all
 *     the way to the end through /api/activities/logbook.
 *  2. READABILITY. See LogbookRow: fixed columns, pace promoted to a first-
 *     class metric, month separators carrying their own totals.
 *  3. VIEWING EVERYTHING. The two side-by-side zone panels made the one view
 *     an athlete actually wants — "what did I do, in order" — impossible to
 *     render, because a session's zone decided which *column* it went in.
 *     Zone is now an accent on a single chronological feed, so Tuesday's
 *     squats sit directly above Tuesday's run.
 *
 * Filtering and sorting are server-side by design: a client-side filter over
 * the already-loaded page would silently hide history again, which is the
 * bug this component exists to remove.
 */

export type LogbookFeedMode = "full" | "zone";

interface LogbookGroup {
  key: string;
  label: string;
  entries: LogbookEntry[];
  distanceMeters: number;
  durationSeconds: number;
}

/** Reverse-chronological months (or forward, when sorted oldest-first — the grouping just follows the order the rows arrive in). */
function groupByMonth(entries: LogbookEntry[]): LogbookGroup[] {
  const groups: LogbookGroup[] = [];
  let current: LogbookGroup | null = null;

  for (const entry of entries) {
    const date = new Date(entry.startedAt);
    const key = format(date, "yyyy-MM");
    if (!current || current.key !== key) {
      current = {
        key,
        label: format(date, "MMMM yyyy"),
        entries: [],
        distanceMeters: 0,
        durationSeconds: 0,
      };
      groups.push(current);
    }
    current.entries.push(entry);
    current.distanceMeters += entry.distanceMeters ?? 0;
    current.durationSeconds += entry.durationSeconds ?? 0;
  }

  return groups;
}

function groupSummary(group: LogbookGroup): string {
  const parts = [`${group.entries.length} session${group.entries.length === 1 ? "" : "s"}`];
  if (group.distanceMeters > 0) parts.push(formatDistance(group.distanceMeters));
  if (group.durationSeconds > 0) parts.push(formatDuration(group.durationSeconds));
  return parts.join(" · ");
}

export function LogbookFeed({
  initialPage,
  surface,
  mode = "full",
  zone: lockedZone = "all",
  sportCounts = {},
  pageSize = LOGBOOK_PAGE_SIZE,
  title,
  viewAllHref,
}: {
  initialPage: LogbookPage;
  surface: LogbookSurface;
  mode?: LogbookFeedMode;
  /** In "zone" mode this is fixed and the zone filter is hidden. */
  zone?: LogbookZone;
  sportCounts?: LogbookSportCounts;
  pageSize?: number;
  title?: string;
  /** Shown as "Full logbook →" on an embedded zone list. */
  viewAllHref?: string;
}) {
  const theme = surfaceTheme(surface);
  const totals = useMemo(() => zoneTotals(sportCounts), [sportCounts]);

  const [zone, setZone] = useState<LogbookZone>(lockedZone);
  const [sport, setSport] = useState<string | null>(null);
  const [sort, setSort] = useState<LogbookSort>("recent");
  const [page, setPage] = useState<LogbookPage>(initialPage);
  const [loading, setLoading] = useState(false);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupByMonth(page.entries), [page.entries]);
  const filtered = zone !== lockedZone || sport !== null || sort !== "recent";

  /** Sports this athlete has actually logged in the visible zone — an empty filter option is just a dead end. */
  const sportOptions = useMemo(
    () =>
      SPORTS.filter((s) => {
        if (!sportCounts[s.id]) return false;
        if (zone === "gym") return s.id === "gym";
        if (zone === "cardio") return s.id !== "gym";
        return true;
      }).map((s) => ({ id: s.id as string, name: s.name, count: sportCounts[s.id] ?? 0 })),
    [sportCounts, zone]
  );

  async function fetchPage(
    next: { zone: LogbookZone; sport: string | null; sort: LogbookSort },
    offset: number
  ): Promise<LogbookPage | null> {
    const params = new URLSearchParams({
      zone: next.zone,
      sort: next.sort,
      offset: String(offset),
      limit: String(pageSize),
    });
    if (next.sport) params.set("sport", next.sport);

    const res = await fetch(`/api/activities/logbook?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "Could not load the logbook");
    return data as LogbookPage;
  }

  /**
   * Filters re-query from offset 0 rather than filtering `page.entries` —
   * the loaded rows are one page of possibly hundreds, so anything else
   * would answer "show me every run" with "every run in the last 25
   * sessions."
   */
  async function applyFilters(next: { zone?: LogbookZone; sport?: string | null; sort?: LogbookSort }) {
    const resolvedZone = next.zone ?? zone;
    // A sport from the previous zone can't survive a zone switch.
    const resolvedSport =
      next.sport !== undefined
        ? next.sport
        : next.zone && next.zone !== zone
          ? null
          : sport;
    const resolvedSort = next.sort ?? sort;

    setZone(resolvedZone);
    setSport(resolvedSport);
    setSort(resolvedSort);
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPage(
        { zone: resolvedZone, sport: resolvedSport, sort: resolvedSort },
        0
      );
      if (result) setPage(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the logbook");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    setPaging(true);
    setError(null);
    try {
      const result = await fetchPage({ zone, sport, sort }, page.nextOffset);
      if (result) {
        setPage({
          entries: [...page.entries, ...result.entries],
          total: result.total,
          hasMore: result.hasMore,
          nextOffset: result.nextOffset,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more sessions");
    } finally {
      setPaging(false);
    }
  }

  const zoneChips: { id: LogbookZone; label: string; count: number }[] = [
    { id: "all", label: "All", count: totals.all },
    { id: "gym", label: ZONE_LABELS.gym, count: totals.gym },
    { id: "cardio", label: ZONE_LABELS.cardio, count: totals.cardio },
  ];

  const showing = page.entries.length;

  return (
    <div className={cn("rounded-2xl border", theme.border)}>
      {(title || viewAllHref) && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5",
            theme.border
          )}
        >
          <div className="min-w-0">
            <p className={cn("micro-label", theme.muted)}>{title ?? "Logbook"}</p>
            <p className={cn("mt-1 text-xs tabular-nums", theme.faint)}>
              {showing === page.total
                ? `${page.total} session${page.total === 1 ? "" : "s"}`
                : `Showing ${showing} of ${page.total}`}
            </p>
          </div>
          {viewAllHref && (
            <Link
              href={viewAllHref}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                theme.chip,
                theme.chipHover
              )}
            >
              Full logbook →
            </Link>
          )}
        </div>
      )}

      {mode === "full" && (
        <div className={cn("border-b px-4 py-3 sm:px-5", theme.border)}>
          {/* Horizontally scrollable rather than wrapping: on a narrow phone a
              wrapped chip row pushes the first session below the fold. */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {zoneChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                disabled={loading}
                onClick={() => applyFilters({ zone: chip.id })}
                aria-pressed={zone === chip.id}
                className={cn(
                  "logbook-filter-chip shrink-0 whitespace-nowrap disabled:opacity-60",
                  zone === chip.id && zoneChipActiveClass(chip.id)
                )}
              >
                {chip.label}
                <span className="ml-1.5 tabular-nums opacity-70">{chip.count}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="logbook-sport">
              Filter by sport
            </label>
            <select
              id="logbook-sport"
              value={sport ?? ""}
              disabled={loading}
              onChange={(e) => applyFilters({ sport: e.target.value || null })}
              className={cn(
                "h-9 rounded-xl border px-2.5 text-xs font-medium disabled:opacity-60",
                theme.border,
                theme.fill,
                theme.text
              )}
            >
              <option value="">All sports</option>
              {sportOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.count})
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="logbook-sort">
              Sort order
            </label>
            <select
              id="logbook-sort"
              value={sort}
              disabled={loading}
              onChange={(e) => applyFilters({ sort: e.target.value as LogbookSort })}
              className={cn(
                "h-9 rounded-xl border px-2.5 text-xs font-medium disabled:opacity-60",
                theme.border,
                theme.fill,
                theme.text
              )}
            >
              <option value="recent">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>

            <p className={cn("ml-auto text-xs tabular-nums", theme.faint)} aria-live="polite">
              {loading
                ? "Loading…"
                : page.total === 0
                  ? "No matches"
                  : showing === page.total
                    ? `${page.total} session${page.total === 1 ? "" : "s"}`
                    : `${showing} of ${page.total}`}
            </p>
          </div>
        </div>
      )}

      {page.entries.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className={cn("text-sm font-medium", theme.text)}>
            {filtered ? "No sessions match these filters" : "No sessions yet"}
          </p>
          {filtered ? (
            <button
              type="button"
              onClick={() => applyFilters({ zone: lockedZone, sport: null, sort: "recent" })}
              className={cn("mt-3 text-xs font-medium underline underline-offset-4", theme.muted)}
            >
              Clear filters
            </button>
          ) : (
            <Link
              href="/activities/new"
              className={cn("mt-3 inline-block text-xs font-medium underline underline-offset-4", theme.muted)}
            >
              Log a workout →
            </Link>
          )}
        </div>
      ) : (
        <div className={cn(loading && "opacity-50 transition-opacity")}>
          {groups.map((group) => (
            <section key={group.key}>
              {/* Sticky only on the full logbook: an embedded zone list lives
                  inside a rounded, clipped panel, where a sticky child has
                  nothing to stick to anyway. */}
              <div
                className={cn(
                  "flex items-baseline justify-between gap-3 px-4 py-2 sm:px-5",
                  theme.fill,
                  mode === "full" && "sticky top-[env(safe-area-inset-top)] z-10",
                  mode === "full" && theme.sticky
                )}
              >
                <h2 className={cn("micro-label", theme.text)}>{group.label}</h2>
                <p className={cn("text-[11px] tabular-nums", theme.faint)}>{groupSummary(group)}</p>
              </div>
              <ul className={cn("divide-y", theme.divider)}>
                {group.entries.map((entry) => (
                  <LogbookRow
                    key={entry.id}
                    entry={entry}
                    surface={surface}
                    showZoneBadge={zone === "all"}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {(page.hasMore || error) && (
        <div className={cn("border-t px-4 py-4 text-center sm:px-5", theme.border)}>
          {error && <p className="mb-3 text-xs text-danger">{error}</p>}
          {page.hasMore && (
            <>
              <Button variant="ghost" size="sm" loading={paging} onClick={loadMore}>
                Load {Math.min(pageSize, page.total - showing)} more
              </Button>
              <p className={cn("mt-2 text-[11px] tabular-nums", theme.faint)}>
                Showing {showing} of {page.total} sessions
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
