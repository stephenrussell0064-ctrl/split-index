import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNativePlatform, getNativePlatform } from "./platform";
import type { HrReading } from "@/lib/scoring/gps-track";

interface HeartRateWorkoutPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  start(): Promise<{ started: boolean }>;
  stop(): Promise<{ stopped: boolean }>;
  addListener(
    eventName: "heartRate",
    listenerFunc: (data: { bpm: number; timestamp: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "error",
    listenerFunc: (data: { message: string }) => void
  ): Promise<PluginListenerHandle>;
}

/**
 * Backed by ios/App/App/HeartRateWorkoutPlugin.swift — a Split Index-local
 * native plugin (not an npm package), auto-discovered by Capacitor because
 * it's compiled directly into the app target and conforms to
 * CAPBridgedPlugin. Android has no equivalent (this is iOS/AirPods-only).
 */
const HeartRateWorkout = registerPlugin<HeartRateWorkoutPlugin>("HeartRateWorkout");

let heartRateListener: PluginListenerHandle | null = null;
let errorListener: PluginListenerHandle | null = null;

/** True only on iOS — this plugin has no Android counterpart. */
export function isAirPodsHeartRateSupported(): boolean {
  return isNativePlatform() && getNativePlatform() === "ios";
}

/**
 * Starts a real HKWorkoutSession so AirPods Pro's heart-rate sensor turns
 * on, and streams live BPM readings to `onReading` for the run's duration.
 * Throws with a user-facing message on authorization denial or a HealthKit
 * error — callers should catch and surface it, same as the BLE HR path.
 */
export async function startAirPodsHeartRate(onReading: (reading: HrReading) => void): Promise<void> {
  const { available } = await HeartRateWorkout.isAvailable();
  if (!available) {
    throw new Error("HealthKit isn't available on this device.");
  }

  heartRateListener = await HeartRateWorkout.addListener("heartRate", (data) => {
    onReading({ bpm: Math.round(data.bpm), time: data.timestamp });
  });
  errorListener = await HeartRateWorkout.addListener("error", () => {
    // Surfaced to the user via the thrown error from start() itself when
    // authorization fails; a mid-run session error just stops readings
    // rather than interrupting the run in progress.
  });

  await HeartRateWorkout.start();
}

export async function stopAirPodsHeartRate(): Promise<void> {
  await HeartRateWorkout.stop();
  await heartRateListener?.remove();
  await errorListener?.remove();
  heartRateListener = null;
  errorListener = null;
}
