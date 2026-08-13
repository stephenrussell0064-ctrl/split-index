import type { ActivityZone } from "@/lib/activities/logbook-query";

/**
 * The logbook is one component rendered onto three different backdrops: the
 * neutral app shell (/activities), The Lab's near-black panel, and The
 * Engine's white one. Zone identity therefore cannot be carried by the row's
 * *background* — that's what the old two-panel split did, and it's why a
 * combined chronological view was impossible to build.
 *
 * So the split here is deliberate:
 *   • the SURFACE decides text, dividers, hover and sticky backgrounds,
 *   • the ZONE decides only the accent — a left rail, a badge, and the index
 *     number — which reads identically on any of the three surfaces.
 *
 * The one contrast trap: the Lab's neon green (#3dff6e) is unreadable as
 * text on The Engine's white. In practice a gym row never renders on the
 * cardio surface, but `zoneScoreClass`/`zoneBadgeClass` handle it anyway
 * rather than leaving a landmine for whoever mixes them later.
 */

export type LogbookSurface = "neutral" | "gym" | "cardio";

export interface SurfaceTheme {
  /** Primary copy — titles. */
  text: string;
  /** Secondary copy — metric strips, dates. */
  muted: string;
  /** Tertiary copy — separators, unit suffixes. */
  faint: string;
  /** Row separators inside a group. */
  divider: string;
  /** Panel border for the feed container and toolbar fields. */
  border: string;
  /** Low-contrast raised fill (toolbar fields, empty states). */
  fill: string;
  /** Row hover/press feedback. */
  rowHover: string;
  /** Opaque backdrop for sticky month headers — must match the page behind it. */
  sticky: string;
  /** Idle filter chip. */
  chip: string;
  /** Chip hover, idle state only. */
  chipHover: string;
}

const SURFACES: Record<LogbookSurface, SurfaceTheme> = {
  neutral: {
    text: "text-foreground",
    muted: "text-muted",
    faint: "text-muted/50",
    divider: "divide-white/[0.06]",
    border: "border-white/[0.08]",
    fill: "bg-white/[0.03]",
    rowHover: "hover:bg-white/[0.04] active:bg-white/[0.06]",
    sticky: "bg-background/95 backdrop-blur-sm",
    chip: "border-white/10 text-muted",
    chipHover: "hover:border-white/25 hover:text-foreground",
  },
  gym: {
    text: "text-gym-text",
    muted: "text-gym-muted",
    faint: "text-gym-muted/60",
    divider: "divide-gym-border/25",
    border: "border-gym-border/40",
    fill: "bg-gym-accent/[0.04]",
    rowHover: "hover:bg-gym-accent/[0.07] active:bg-gym-accent/10",
    sticky: "bg-gym-bg/95 backdrop-blur-sm",
    chip: "border-gym-border/50 text-gym-muted",
    chipHover: "hover:border-gym-accent/50 hover:text-gym-text",
  },
  cardio: {
    text: "text-cardio-text",
    muted: "text-cardio-muted",
    faint: "text-cardio-muted/60",
    divider: "divide-cardio-border/40",
    border: "border-cardio-border/50",
    fill: "bg-cardio-accent/[0.05]",
    rowHover: "hover:bg-cardio-accent/[0.07] active:bg-cardio-accent/10",
    sticky: "bg-cardio-bg/95 backdrop-blur-sm",
    chip: "border-cardio-border/60 text-cardio-muted",
    chipHover: "hover:border-cardio-accent/60 hover:text-cardio-text",
  },
};

export function surfaceTheme(surface: LogbookSurface): SurfaceTheme {
  return SURFACES[surface];
}

/** The 2px identity rail down the leading edge of every row. */
export function zoneRailClass(zone: ActivityZone): string {
  return zone === "gym" ? "bg-gym-accent/70" : "bg-cardio-accent/70";
}

/** The session index. Green-on-white would fail contrast, so a gym row on the light surface falls back to body colour. */
export function zoneScoreClass(zone: ActivityZone, surface: LogbookSurface): string {
  if (zone === "cardio") return "text-cardio-accent";
  return surface === "cardio" ? "text-cardio-text" : "text-gym-accent";
}

/** "LAB" / "ENG" pill and the sport-icon tile behind it. */
export function zoneBadgeClass(zone: ActivityZone, surface: LogbookSurface): string {
  if (zone === "cardio") return "border-cardio-accent/30 bg-cardio-accent/10 text-cardio-accent";
  return surface === "cardio"
    ? "border-gym-accent/50 bg-gym-accent/25 text-cardio-text"
    : "border-gym-accent/30 bg-gym-accent/10 text-gym-accent";
}

/** Active filter chip — matches the existing .logbook-filter-chip-active* pair in globals.css. */
export function zoneChipActiveClass(zone: ActivityZone | "all"): string {
  if (zone === "gym") return "logbook-filter-chip-active";
  if (zone === "cardio") return "logbook-filter-chip-active-eng";
  return "logbook-filter-chip-active-all";
}

export const ZONE_LABELS: Record<ActivityZone, string> = {
  gym: "The Lab",
  cardio: "The Engine",
};

export const ZONE_SHORT_LABELS: Record<ActivityZone, string> = {
  gym: "Lab",
  cardio: "Eng",
};
