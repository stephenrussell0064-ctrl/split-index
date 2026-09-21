import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseRoutePolyline } from "@/lib/scoring/gps-track";

/**
 * THE LOGBOOK USED TO SHIP EVERY MERGE'S UNDO RECORD TO READ ONE KEY.
 *
 * `ENTRY_COLUMNS` selected the whole `metadata` column so the mapper could
 * reach `metadata.route` for the map polyline. For a merged session that column
 * also carries the entire undo record — every leg as it was, across all 28
 * snapshot columns, nested one level deeper per merge. Measured at 891 bytes
 * for one leg and about 1.8KB per merge, so a session merged four times shipped
 * roughly 7KB of merge history per row, up to 25 rows a page, to draw a line on
 * a map.
 *
 * (The audit filed this as metadata "roughly doubling per nested merge". It
 * does not: the `merge:` key in mergedMetadata overwrites the one arriving with
 * the `...survivorMetadata` spread, so the chain is nested once rather than
 * duplicated, and growth is linear. The nesting itself is correct and
 * load-bearing — it is what lets an A+B+C session be unmerged twice — so the
 * fix is to stop SELECTING it, not to flatten it.)
 *
 * This is pinned as a string because the alternative is a live PostgREST round
 * trip: if the projection is ever widened back to `metadata`, or the JSON path
 * loses its alias, nothing else in the suite notices and the only symptom is a
 * slower logbook.
 */

const SOURCE = readFileSync("src/lib/activities/logbook-query.ts", "utf8");

describe("what a logbook page asks the database for", () => {
  it("projects the one JSON path it needs, not the whole column", () => {
    expect(SOURCE).toContain("route:metadata->route");
  });

  it("does not select the metadata column itself", () => {
    // `->` is a projection; a bare `metadata` in the column list is the bug.
    const columnList = SOURCE.slice(SOURCE.indexOf("const ENTRY_COLUMNS"));
    const selectString = columnList.slice(columnList.indexOf('"id, sport'), columnList.indexOf('";') + 1);
    expect(selectString).not.toMatch(/(^|,\s*)metadata\s*(,|")/);
  });
});

describe("a row whose route projection came back empty", () => {
  it("renders without a map rather than throwing", () => {
    // The projection returns null for a manually logged session, and undefined
    // is what a mistyped path would produce. Neither may take down the page:
    // the row is still a session the athlete logged.
    expect(parseRoutePolyline(null)).toBeNull();
    expect(parseRoutePolyline(undefined)).toBeNull();
    expect(parseRoutePolyline({})).toBeNull();
  });

  it("still parses a real polyline", () => {
    expect(parseRoutePolyline([[51.5, -0.12], [51.51, -0.13]])).toEqual([
      [51.5, -0.12],
      [51.51, -0.13],
    ]);
  });
});
