import { describe, expect, it } from "vitest";
import { Encoder, Profile } from "@garmin/fitsdk";
import { elevationGainMeters } from "@/lib/scoring/gps-track";
import {
  detectImportFileKind,
  parseFitWorkout,
  parseGpxWorkout,
  parseTcxWorkout,
  sportFromHint,
  toImportPreview,
} from "./parsers";

/** The SDK's Mesg type names no fields; the encoder reads them by name from the profile. */
const mesg = (fields: Record<string, unknown>) => fields as never;

/** A small activity FIT file written with Garmin's own encoder: one session, four records with GPS, HR and distance. */
function fitFixture(): Uint8Array {
  const start = new Date("2026-10-07T06:30:00.000Z");
  const DEG = 2 ** 31 / 180;
  const encoder = new Encoder();
  encoder.onMesg(
    Profile.MesgNum.FILE_ID,
    mesg({
      manufacturer: "garmin",
      product: 1,
      timeCreated: start,
      type: "activity",
    })
  );
  const points = [
    [51.5, -0.12, 0, 140, 20],
    [51.5004, -0.1194, 60, 150, 22],
    [51.5008, -0.1188, 120, 160, 21],
    [51.5012, -0.1182, 180, 170, 25],
  ] as const;
  points.forEach(([lat, lon, distance, hr, alt], i) => {
    encoder.onMesg(
      Profile.MesgNum.RECORD,
      mesg({
        timestamp: new Date(start.getTime() + i * 10_000),
        positionLat: Math.round(lat * DEG),
        positionLong: Math.round(lon * DEG),
        distance,
        altitude: alt,
        heartRate: hr,
        cadence: 86,
      })
    );
  });
  encoder.onMesg(
    Profile.MesgNum.SESSION,
    mesg({
      timestamp: new Date(start.getTime() + 30_000),
      startTime: start,
      sport: "running",
      subSport: "generic",
      totalElapsedTime: 32,
      totalTimerTime: 30,
      totalDistance: 180,
      avgHeartRate: 155,
      maxHeartRate: 170,
      totalAscent: 6,
      avgRunningCadence: 86,
    })
  );
  return encoder.close();
}

describe("parseFitWorkout", () => {
  it("reads the session summary and the record track from a file Garmin's own encoder wrote", () => {
    const bytes = fitFixture();
    expect(detectImportFileKind("run.fit", bytes)).toBe("fit");
    const w = parseFitWorkout(bytes)!;
    expect(w).not.toBeNull();
    expect(w.kind).toBe("fit");
    expect(w.sport).toBe("running");
    expect(w.startedAt).toBe("2026-10-07T06:30:00.000Z");
    // Moving time, not elapsed.
    expect(w.durationSeconds).toBe(30);
    expect(w.distanceMeters).toBe(180);
    expect(w.avgHr).toBe(155);
    expect(w.maxHr).toBe(170);
    expect(w.elevationGainMeters).toBe(6);
    expect(w.avgCadence).toBe(86);
    expect(w.points).toHaveLength(4);
    // Semicircles back to degrees, to GPS precision.
    expect(w.points[0].latitude).toBeCloseTo(51.5, 5);
    expect(w.points[0].longitude).toBeCloseTo(-0.12, 5);
    expect(w.hrReadings.map((r) => r.bpm)).toEqual([140, 150, 160, 170]);
  });

  it("returns null for bytes that are not a FIT file", () => {
    expect(parseFitWorkout(new TextEncoder().encode("<gpx></gpx>"))).toBeNull();
  });
});

/**
 * Four points of a real-shaped track, ten seconds apart, heading roughly
 * north-east across central London with a strap and a footpod.
 */
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>Morning Run</name>
    <type>running</type>
    <trkseg>
      <trkpt lat="51.5000" lon="-0.1200"><ele>20.0</ele><time>2026-10-09T07:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="51.5004" lon="-0.1194"><ele>22.0</ele><time>2026-10-09T07:00:10Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr><gpxtpx:cad>86</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="51.5008" lon="-0.1188"><ele>21.0</ele><time>2026-10-09T07:00:20Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>160</gpxtpx:hr><gpxtpx:cad>87</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="51.5012" lon="-0.1182"><ele>25.0</ele><time>2026-10-09T07:00:30Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>170</gpxtpx:hr><gpxtpx:cad>88</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-10-08T17:30:00Z</Id>
      <Lap StartTime="2026-10-08T17:30:00Z">
        <TotalTimeSeconds>1800</TotalTimeSeconds>
        <DistanceMeters>12000</DistanceMeters>
        <AverageHeartRateBpm><Value>138</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>162</Value></MaximumHeartRateBpm>
        <Track>
          <Trackpoint><Time>2026-10-08T17:30:00Z</Time><Position><LatitudeDegrees>51.5</LatitudeDegrees><LongitudeDegrees>-0.12</LongitudeDegrees></Position><AltitudeMeters>30</AltitudeMeters><DistanceMeters>0</DistanceMeters><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
          <Trackpoint><Time>2026-10-08T17:30:30Z</Time><Position><LatitudeDegrees>51.502</LatitudeDegrees><LongitudeDegrees>-0.118</LongitudeDegrees></Position><AltitudeMeters>34</AltitudeMeters><DistanceMeters>300</DistanceMeters><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint>
          <Trackpoint><Time>2026-10-08T17:31:00Z</Time><Position><LatitudeDegrees>51.504</LatitudeDegrees><LongitudeDegrees>-0.116</LongitudeDegrees></Position><AltitudeMeters>33</AltitudeMeters><DistanceMeters>600</DistanceMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
        </Track>
      </Lap>
      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>Wahoo ELEMNT</Name></Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

describe("detectImportFileKind", () => {
  it("reads the content before the name", () => {
    expect(detectImportFileKind("whatever.txt", new TextEncoder().encode(GPX))).toBe("gpx");
    expect(detectImportFileKind("ride.xml", new TextEncoder().encode(TCX))).toBe("tcx");
  });

  it("recognises a FIT header by its magic bytes", () => {
    const header = new Uint8Array([0x0e, 0x10, 0xd9, 0x07, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 0, 0]);
    expect(detectImportFileKind("x.bin", header)).toBe("fit");
  });

  it("falls back to the extension, and gives up on anything else", () => {
    expect(detectImportFileKind("run.fit", new Uint8Array(4))).toBe("fit");
    expect(detectImportFileKind("notes.txt", new TextEncoder().encode("hello"))).toBeNull();
  });
});

describe("sportFromHint", () => {
  it("reads words, Strava's numbers and TCX's three values", () => {
    expect(sportFromHint("running")).toBe("running");
    expect(sportFromHint("9")).toBe("running");
    expect(sportFromHint("Biking")).toBe("outdoor_cycling");
    expect(sportFromHint("cycling", "indoorCycling")).toBe("indoor_cycling");
    expect(sportFromHint("virtual_ride")).toBe("indoor_cycling");
    expect(sportFromHint("hiking")).toBe("walking");
    expect(sportFromHint("swimming")).toBe("swimming");
    expect(sportFromHint("Other")).toBeNull();
    expect(sportFromHint(null)).toBeNull();
  });
});

describe("parseGpxWorkout", () => {
  it("reads the track, the strap and the footpod", () => {
    const w = parseGpxWorkout(GPX)!;
    expect(w.kind).toBe("gpx");
    expect(w.sport).toBe("running");
    expect(w.startedAt).toBe("2026-10-09T07:00:00.000Z");
    expect(w.durationSeconds).toBe(30);
    expect(w.points).toHaveLength(4);
    expect(w.hrReadings.map((r) => r.bpm)).toEqual([140, 150, 160, 170]);
    expect(w.avgHr).toBe(155);
    expect(w.maxHr).toBe(170);
    expect(w.avgCadence).toBe(86.5);
    expect(w.deviceName).toBe("Garmin Connect");
    // Four legs of ~60 m each.
    expect(w.distanceMeters).toBeGreaterThan(150);
    expect(w.distanceMeters).toBeLessThan(250);
    // The app's one definition of elevation gain, not a second one here.
    expect(w.elevationGainMeters).toBe(elevationGainMeters(w.points));
    expect(w.elevationGainMeters).toBeGreaterThan(0);
  });

  it("returns null for a file with no timed points", () => {
    expect(parseGpxWorkout('<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>')).toBeNull();
  });
});

describe("parseTcxWorkout", () => {
  it("takes the totals from the lap and the track from the points", () => {
    const w = parseTcxWorkout(TCX)!;
    expect(w.kind).toBe("tcx");
    expect(w.sport).toBe("outdoor_cycling");
    expect(w.sportHint).toBe("Biking");
    expect(w.startedAt).toBe("2026-10-08T17:30:00.000Z");
    expect(w.durationSeconds).toBe(1800);
    expect(w.distanceMeters).toBe(12000);
    expect(w.avgHr).toBe(138);
    expect(w.maxHr).toBe(162);
    expect(w.points).toHaveLength(3);
    expect(w.deviceName).toBe("Wahoo ELEMNT");
  });
});

describe("toImportPreview", () => {
  it("derives pace, keeps the track, and names the session after the device", () => {
    const preview = toImportPreview(parseTcxWorkout(TCX)!, "ride.tcx");
    expect(preview.fields).toMatchObject({
      sport: "outdoor_cycling",
      title: "Ride from Wahoo ELEMNT",
      duration_seconds: 1800,
      distance_meters: 12000,
      avg_heart_rate: 138,
      max_heart_rate: 162,
      avg_pace_seconds_per_km: 150,
    });
    expect(preview.route).not.toBeNull();
    expect(preview.streams).not.toBeNull();
    expect(preview.streams!.time).toHaveLength(3);
    expect(preview.pointCount).toBe(3);
  });

  it("asks for the sport when the file did not say, and names the file", () => {
    const w = parseGpxWorkout(GPX.replace("<type>running</type>", ""))!;
    const preview = toImportPreview(w, "mystery.gpx");
    expect(preview.fields.sport).toBeNull();
    expect(preview.fields.title).toBe("Imported from Garmin Connect");
  });

  it("gives a trackless file fields and nothing else", () => {
    const noTrack = parseTcxWorkout(TCX.replace(/<Track>[\s\S]*<\/Track>/, ""))!;
    const preview = toImportPreview(noTrack, "turbo.tcx");
    expect(preview.fields.duration_seconds).toBe(1800);
    expect(preview.route).toBeNull();
    expect(preview.streams).toBeNull();
    expect(preview.pointCount).toBe(0);
  });
});
