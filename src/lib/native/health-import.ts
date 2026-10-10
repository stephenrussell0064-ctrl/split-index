import { registerPlugin } from "@capacitor/core";
import { isNativePlatform, getNativePlatform } from "./platform";
import type { HealthImportBatch } from "@/lib/health/samples";

/**
 * Apple Health read import — the bridge to `HealthImportPlugin.swift`.
 *
 * The plugin is registered explicitly in MainViewController.swift (the
 * linker dead-strips a Swift class nothing references, and a plugin that is
 * not registered answers "not implemented on ios" — see that file). This
 * side only names it.
 *
 * iOS only. On the web and on Android every call here is refused before it
 * reaches Capacitor, so the UI can ask `isHealthImportSupported()` and show
 * nothing rather than a button that fails.
 */

export interface HealthImportSamples extends Omit<HealthImportBatch, "newestSampleAt"> {
  /** The newest sample date in this fetch, ISO 8601, or null when nothing came back. */
  newestSampleAt: string | null;
}

interface HealthImportPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  /** Shows Apple's permission sheet for the read types. HealthKit never reveals what was granted; the fetch simply returns nothing for a refused type. */
  requestAuthorization(): Promise<{ requested: boolean }>;
  fetchSamples(options: { since: string; limit: number }): Promise<HealthImportSamples>;
}

const HealthImport = registerPlugin<HealthImportPlugin>("HealthImport");

export function isHealthImportSupported(): boolean {
  return isNativePlatform() && getNativePlatform() === "ios";
}

export async function isHealthDataAvailable(): Promise<boolean> {
  if (!isHealthImportSupported()) return false;
  try {
    const { available } = await HealthImport.isAvailable();
    return available;
  } catch {
    return false;
  }
}

export async function requestHealthAccess(): Promise<void> {
  if (!isHealthImportSupported()) {
    throw new Error("Apple Health is only available in the iOS app.");
  }
  await HealthImport.requestAuthorization();
}

/** Every supported sample on or after `since`, newest last, at most `limit` per type. */
export async function fetchHealthSamples(since: Date, limit = 500): Promise<HealthImportSamples> {
  if (!isHealthImportSupported()) {
    throw new Error("Apple Health is only available in the iOS app.");
  }
  return HealthImport.fetchSamples({ since: since.toISOString(), limit });
}
