import { Capacitor } from "@capacitor/core";

/**
 * Capacitor-conversion brief: single source of truth for "are we running
 * inside the native shell right now" — used to switch billing (Stripe web
 * checkout vs native StoreKit/Play Billing) and GPS tracking (native
 * background-geolocation plugin vs the browser's foreground-only
 * Geolocation API) without scattering `Capacitor.isNativePlatform()` calls
 * across the app. Safe to import from server components too — Capacitor's
 * web fallback returns "web"/false with no native module loaded.
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export type NativePlatform = "ios" | "android" | "web";

export function getNativePlatform(): NativePlatform {
  return Capacitor.getPlatform() as NativePlatform;
}
