import { format } from "date-fns";
import { cn } from "@/lib/utils/cn";
import { formatDistance, formatDuration } from "@/lib/utils/format";
import { LogbookRow } from "@/components/activities/logbook-row";
import { surfaceTheme, type LogbookSurface } from "@/components/activities/logbook-theme";
import type { LogbookEntry } from "@/lib/activities/logbook-query";

/**
 * Month-separated session rows.
 *
 * Deliberately presentational and free of "use client" so the same grouping
 * renders from a server component (an embedded zone list) and from the
 * paginating client feed, rather than the two drifting into two subtly
 * different-looking logbooks — which is how the app ended up with three
 * near-identical list components in the first place.
 *
 * Months, not weeks: an athlete training five times a week produces a
 * separator every five rows on a weekly grouping, which is more chrome than
 * content. The weekday sits in each row's date column instead, so week
 * structure is still readable inside the month.
 */

export interface LogbookGroup {
  key: string;
  label: string;
  entries: LogbookEntry[];
  distanceMeters: number;
  durationSeconds: number;
}

/** Follows whatever order the rows arrive in, so an oldest-first sort groups forwards without special-casing. */
export function groupByMonth(entries: LogbookEntry[]): LogbookGroup[] {
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

export function LogbookGroups({
  entries,
  surface,
  showZoneBadge = true,
  sticky = false,
}: {
  entries: LogbookEntry[];
  surface: LogbookSurface;
  showZoneBadge?: boolean;
  /**
   * Only for a full-page feed. An embedded zone list sits inside a clipped,
   * rounded panel — `position: sticky` inside an `overflow: hidden` ancestor
   * has no scrollport to stick to and just renders static.
   */
  sticky?: boolean;
}) {
  const theme = surfaceTheme(surface);
  const groups = groupByMonth(entries);

  return (
    <>
      {groups.map((group) => (
        <section key={group.key}>
          <div
            className={cn(
              "flex items-baseline justify-between gap-3 px-4 py-2 sm:px-5",
              theme.fill,
              // env() resolves to 0 on the web and to the real status-bar
              // inset in the Capacitor shell, where top-0 would slide the
              // month label under the clock.
              sticky && cn("sticky top-[env(safe-area-inset-top)] z-10", theme.sticky)
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
                showZoneBadge={showZoneBadge}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
