import { describe, expect, it } from "vitest";
import { computeGpxElevation, parseGpxPoints } from "./gpx-elevation";

function gpxWithTrackPoints(points: Array<{ lat: number; lon: number; ele?: number }>): string {
  const trkpts = points
    .map(
      (p) =>
        `<trkpt lat="${p.lat}" lon="${p.lon}">${p.ele !== undefined ? `<ele>${p.ele}</ele>` : ""}</trkpt>`
    )
    .join("\n");
  return `<?xml version="1.0"?><gpx><trk><trkseg>${trkpts}</trkseg></trk></gpx>`;
}

describe("parseGpxPoints", () => {
  it("parses lat/lon/ele from real-shaped trkpt elements", () => {
    const gpx = gpxWithTrackPoints([
      { lat: 51.5, lon: -0.1, ele: 10 },
      { lat: 51.501, lon: -0.101, ele: 15 },
    ]);
    const points = parseGpxPoints(gpx);
    expect(points).not.toBeNull();
    expect(points).toHaveLength(2);
    expect(points![0]).toMatchObject({ latitude: 51.5, longitude: -0.1, altitude: 10 });
    expect(points![1]).toMatchObject({ latitude: 51.501, longitude: -0.101, altitude: 15 });
  });

  it("falls back to rtept for route-only GPX files", () => {
    const gpx = `<?xml version="1.0"?><gpx><rte><rtept lat="51.5" lon="-0.1"><ele>10</ele></rtept><rtept lat="51.6" lon="-0.2"><ele>20</ele></rtept></rte></gpx>`;
    const points = parseGpxPoints(gpx);
    expect(points).toHaveLength(2);
  });

  it("handles points with no elevation data (altitude null)", () => {
    const gpx = gpxWithTrackPoints([{ lat: 51.5, lon: -0.1 }, { lat: 51.501, lon: -0.101 }]);
    const points = parseGpxPoints(gpx);
    expect(points![0].altitude).toBeNull();
  });

  it("returns null for a file with no points at all", () => {
    expect(parseGpxPoints("<?xml version=\"1.0\"?><gpx></gpx>")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseGpxPoints("not xml at all")).toBeNull();
  });
});

describe("computeGpxElevation", () => {
  it("sums positive elevation deltas across a real-shaped course profile", () => {
    // A rolling course: up 20m, down 10m, up 15m — net gain should be 20+15=35 (descents don't count)
    const gpx = gpxWithTrackPoints([
      { lat: 51.5, lon: -0.1, ele: 10 },
      { lat: 51.501, lon: -0.101, ele: 30 }, // +20
      { lat: 51.502, lon: -0.102, ele: 20 }, // -10 (not counted)
      { lat: 51.503, lon: -0.103, ele: 35 }, // +15
    ]);
    const result = computeGpxElevation(gpx);
    expect(result).not.toBeNull();
    expect(result!.elevationGainMeters).toBe(35);
    expect(result!.pointCount).toBe(4);
  });

  it("computes a real, non-zero distance from real coordinates", () => {
    const gpx = gpxWithTrackPoints([
      { lat: 51.5, lon: -0.1, ele: 10 },
      { lat: 51.51, lon: -0.11, ele: 10 }, // roughly 1.2km away
    ]);
    const result = computeGpxElevation(gpx);
    expect(result!.distanceMeters).toBeGreaterThan(500);
    expect(result!.distanceMeters).toBeLessThan(2000);
  });

  it("returns null when no point in the file carries elevation data", () => {
    const gpx = gpxWithTrackPoints([{ lat: 51.5, lon: -0.1 }, { lat: 51.501, lon: -0.101 }]);
    expect(computeGpxElevation(gpx)).toBeNull();
  });

  it("returns null for an unparseable file", () => {
    expect(computeGpxElevation("<gpx></gpx>")).toBeNull();
  });

  it("real-world-shaped example: a flat 10K course reads close to zero gain", () => {
    // 20 points, gently oscillating +/-1m — noise-level, not a real hill.
    const points = Array.from({ length: 20 }, (_, i) => ({
      lat: 51.5 + i * 0.001,
      lon: -0.1,
      ele: 10 + (i % 2),
    }));
    const result = computeGpxElevation(gpxWithTrackPoints(points));
    expect(result).not.toBeNull();
    // Alternating +1/-1 across 20 points -> only the "up" steps count.
    expect(result!.elevationGainMeters).toBeLessThan(15);
  });
});
