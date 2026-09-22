import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LogbookGroups } from "./logbook-groups";
import type { LogbookEntry } from "@/lib/activities/logbook-query";
import type { RoutePoint } from "@/lib/scoring/gps-track";

/**
 * OSM's licence and CARTO's terms both ask for credit that a person can
 * actually see. The logbook draws its route maps at 48px square, which is
 * too small to carry Leaflet's own attribution control legibly, so the
 * credit is drawn once per list instead — and the thing that can silently
 * break is the CONDITION, not the markup: a credit that never renders is a
 * licence problem, and one that renders under a list of gym sessions with
 * no maps in it is a lie about what is on screen.
 */

function entry(overrides: Partial<LogbookEntry> = {}): LogbookEntry {
  return {
    id: "a1",
    sport: "run",
    title: "Morning run",
    startedAt: "2026-09-20T07:00:00Z",
    durationSeconds: 1800,
    distanceMeters: 5000,
    elevationMeters: null,
    avgHeartRate: null,
    avgPaceSecondsPerKm: null,
    avgSplitSeconds: null,
    sessionType: null,
    zone: "cardio",
    score: null,
    personalScore: null,
    route: null,
    gymSummary: null,
    ...overrides,
  } as LogbookEntry;
}

/** Two points is the least that draws a line, and the least LogbookRow will map. */
const ROUTE: RoutePoint[] = [
  [51.6, -0.7],
  [51.61, -0.71],
];

const CREDIT = /OpenStreetMap/;

function markup(entries: LogbookEntry[]): string {
  return renderToStaticMarkup(<LogbookGroups entries={entries} surface="cardio" />);
}

describe("basemap credit in the logbook", () => {
  it("credits OSM and CARTO when a row draws a route map", () => {
    const html = markup([entry({ route: ROUTE })]);
    expect(html).toMatch(CREDIT);
    expect(html).toMatch(/CARTO/);
  });

  it("stays silent when no row has a route — nothing on screen to credit", () => {
    expect(markup([entry({ route: null, sport: "strength", zone: "gym" })])).not.toMatch(CREDIT);
  });

  it("agrees with LogbookRow about what counts as a route", () => {
    // LogbookRow draws a map on `route.length >= 2`. A single point is not a
    // route and gets no map, so it must get no credit either — the two tests
    // have to move together or the credit drifts away from the maps.
    expect(markup([entry({ route: [ROUTE[0]!] })])).not.toMatch(CREDIT);
    expect(markup([entry({ route: ROUTE })])).toMatch(CREDIT);
  });

  it("credits once for a list of many routed sessions, not once per thumbnail", () => {
    const routed = [1, 2, 3].map((i) =>
      entry({ id: `a${i}`, route: ROUTE })
    );
    expect(markup(routed).match(/carto\.com\/attributions/g)).toHaveLength(1);
  });
});
