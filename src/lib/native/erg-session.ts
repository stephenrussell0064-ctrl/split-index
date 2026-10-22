/**
 * The one record of a live erg session in progress, kept outside React.
 *
 * Same reason gps-tracking.ts persists fixes: iOS re-creates the WKWebView
 * behind a backgrounded app, the component remounts with its state gone,
 * and a forty-minute row would be over without anything having been saved.
 * Written on every heart-rate reading and every pause, read back on mount,
 * cleared only once the server has the session or the athlete discards it.
 *
 * Preferences on a native build — it survives an app kill — and
 * localStorage in a browser, where the same record keeps a reloaded tab
 * from losing the session.
 */
import { Preferences } from "@capacitor/preferences";
import { isNativePlatform } from "./platform";
import type { HrReading, PauseInterval } from "@/lib/scoring/gps-track";
import type { SessionType } from "@/types";
import type { LiveSport } from "@/lib/scoring/energy";

const KEY = "live-erg-session";

export interface ErgSessionRecord {
  sport: LiveSport;
  sessionType: SessionType;
  startedAt: number;
  pauses: PauseInterval[];
  hrReadings: HrReading[];
  hrSource: "ble" | null;
  /** The plan session this was started from, when it was. */
  hpeSessionId: string | null;
}

async function read(): Promise<string | null> {
  if (isNativePlatform()) {
    const { value } = await Preferences.get({ key: KEY });
    return value;
  }
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

async function write(value: string | null): Promise<void> {
  if (isNativePlatform()) {
    if (value == null) await Preferences.remove({ key: KEY });
    else await Preferences.set({ key: KEY, value });
    return;
  }
  try {
    if (value == null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, value);
  } catch {
    // A full or disabled store must not stop the session.
  }
}

export async function saveErgSession(record: ErgSessionRecord): Promise<void> {
  await write(JSON.stringify(record));
}

export async function loadErgSession(): Promise<ErgSessionRecord | null> {
  const raw = await read();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ErgSessionRecord>;
    if (typeof parsed.startedAt !== "number" || (parsed.sport !== "rowing" && parsed.sport !== "bike_erg")) return null;
    return {
      sport: parsed.sport,
      sessionType: (parsed.sessionType as SessionType) ?? "easy",
      startedAt: parsed.startedAt,
      pauses: Array.isArray(parsed.pauses) ? parsed.pauses : [],
      hrReadings: Array.isArray(parsed.hrReadings) ? parsed.hrReadings : [],
      hrSource: parsed.hrSource === "ble" ? "ble" : null,
      hpeSessionId: typeof parsed.hpeSessionId === "string" ? parsed.hpeSessionId : null,
    };
  } catch {
    return null;
  }
}

export async function clearErgSession(): Promise<void> {
  await write(null);
}
