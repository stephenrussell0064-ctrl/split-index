/**
 * A time series, said out loud (N7 item 1).
 *
 * The text alternative for a trend chart. A sighted athlete reads the shape of
 * the line in half a second and takes four things from it: where it started,
 * where it ended, which way it went, and how far it ranged. This produces that
 * sentence.
 *
 * Deliberately not a list of every value — the table alongside it carries those,
 * and a screen reader reading 90 numbers in sequence conveys less than one
 * sentence does, not more.
 *
 * A pure function so it can be tested for real. The wrapper component around a
 * chart cannot be, because this project has no React testing library, and the
 * sentence is where the mistakes would be: an off-by-one on direction, a
 * division by zero on a flat line, a single-point series read as a trend.
 */

export interface SeriesPoint {
  /** Whatever labels the x-axis — a date string, a week number. */
  at: string;
  value: number;
}

/** Rounded to one decimal, then trailing `.0` dropped, so "412" not "412.0". */
function num(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function describeSeries(name: string, points: SeriesPoint[]): string {
  if (points.length === 0) return `${name}: no data for this period yet.`;

  if (points.length === 1) {
    // One point is a reading, not a trend. Saying "unchanged" would be a claim
    // about a period that has not happened.
    return `${name}: a single reading of ${num(points[0].value)} on ${points[0].at}.`;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const delta = last.value - first.value;

  const direction =
    delta > 0 ? "up" : delta < 0 ? "down" : "level";

  const movement =
    direction === "level"
      ? `unchanged at ${num(last.value)}`
      : `${direction} from ${num(first.value)} to ${num(last.value)}, a change of ${
          delta > 0 ? "+" : ""
        }${num(delta)}`;

  // The range is only worth saying when it adds something the endpoints do not
  // — a line that dipped and recovered reads as "unchanged" without it.
  const rangeMatters = min < Math.min(first.value, last.value) || max > Math.max(first.value, last.value);
  const range = rangeMatters ? ` Ranged between ${num(min)} and ${num(max)}.` : "";

  return `${name}: ${movement}, across ${points.length} points from ${first.at} to ${last.at}.${range}`;
}
