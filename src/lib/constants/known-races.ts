/**
 * Curated well-known races with real, sourced elevation/terrain data — user
 * feedback: "For upcoming races, this should have a dropdown of races which
 * you know the elevation and terrain and difficulty... I don't want the
 * user to have to enter the elevation of gpx." Consulted the user first:
 * Split Index has no integrated race-course database, and fabricating
 * elevation numbers for real races would just be guessing dressed up as
 * automation. Agreed approach — a hand-researched dropdown of races people
 * actually enter, sourced from official course guides and published race
 * analyses, alongside (not replacing) the existing manual-entry/GPX-upload
 * path for anything not on this list.
 *
 * elevationGainMeters is total climb over the course, not net gain —
 * matches what computeGpxElevation() already reports for an uploaded GPX,
 * so the two sources are directly comparable. Sourced August 2026;
 * course routes do occasionally change year to year, so treat these as a
 * strong estimate the same way a runner would treat any published course
 * elevation figure, not a guaranteed-exact number.
 */

export type RaceTerrain = "flat" | "rolling" | "hilly" | "mountainous";

export interface KnownRace {
  name: string;
  location: string;
  distanceMeters: number;
  elevationGainMeters: number;
  terrain: RaceTerrain;
  note: string;
}

// Deliberately matches upcoming-races-panel.tsx's COMMON_DISTANCES exactly
// (whole meters, not the more precise 21097.5/16093.4) — that <select> is a
// controlled component with a fixed option list; picking a known race that
// set an unlisted value would silently show as unselected even though the
// underlying value was technically correct.
const MARATHON_METERS = 42195;
const HALF_MARATHON_METERS = 21097;
const TEN_MILE_METERS = 16093;

export const KNOWN_RACES: KnownRace[] = [
  {
    name: "London Marathon",
    location: "London, UK",
    distanceMeters: MARATHON_METERS,
    elevationGainMeters: 127,
    terrain: "flat",
    note: "One of the flattest World Marathon Majors courses — a strong pick for a personal best.",
  },
  {
    name: "Berlin Marathon",
    location: "Berlin, Germany",
    distanceMeters: MARATHON_METERS,
    elevationGainMeters: 73,
    terrain: "flat",
    note: "Nearly pancake-flat — where most marathon world records have been set.",
  },
  {
    name: "Chicago Marathon",
    location: "Chicago, USA",
    distanceMeters: MARATHON_METERS,
    elevationGainMeters: 74,
    terrain: "flat",
    note: "Wide, flat streets built for even, fast pacing.",
  },
  {
    name: "Tokyo Marathon",
    location: "Tokyo, Japan",
    distanceMeters: MARATHON_METERS,
    elevationGainMeters: 60,
    terrain: "flat",
    note: "Low overall elevation, but plenty of turns that reward tight cornering more than raw climbing.",
  },
  {
    name: "New York City Marathon",
    location: "New York, USA",
    distanceMeters: MARATHON_METERS,
    elevationGainMeters: 246,
    terrain: "hilly",
    note: "Five boroughs, five bridges — constant short climbs and descents rather than one big hill.",
  },
  {
    name: "Boston Marathon",
    location: "Boston, USA",
    distanceMeters: MARATHON_METERS,
    elevationGainMeters: 248,
    terrain: "hilly",
    note: "The Newton Hills and Heartbreak Hill (around mile 20-21) make late-race pacing the real challenge.",
  },
  {
    name: "Sydney Marathon",
    location: "Sydney, Australia",
    distanceMeters: MARATHON_METERS,
    elevationGainMeters: 317,
    terrain: "hilly",
    note: "The most demanding of the World Marathon Majors courses — real hill strength required.",
  },
  {
    name: "Paris Marathon",
    location: "Paris, France",
    distanceMeters: MARATHON_METERS,
    elevationGainMeters: 270,
    terrain: "rolling",
    note: "Reputation as flat is a bit generous — rolling undulations through the Bois de Vincennes/Boulogne and a few sharp riverside tunnels.",
  },
  {
    name: "Great North Run",
    location: "Newcastle to South Shields, UK",
    distanceMeters: HALF_MARATHON_METERS,
    elevationGainMeters: 130,
    terrain: "rolling",
    note: "The world's largest half marathon — undulating rather than hilly, net downhill to the coast.",
  },
  {
    name: "Great South Run",
    location: "Portsmouth, UK",
    distanceMeters: TEN_MILE_METERS,
    elevationGainMeters: 20,
    terrain: "flat",
    note: "Barely any elevation change at all along the Southsea seafront — a genuine PB course.",
  },
  {
    name: "Snowdonia Marathon",
    location: "Llanberis, Wales, UK",
    distanceMeters: MARATHON_METERS,
    elevationGainMeters: 880,
    terrain: "mountainous",
    note: "A full circuit of Snowdon with three major climbs — regularly ranked among the toughest road marathons in the UK.",
  },
];
