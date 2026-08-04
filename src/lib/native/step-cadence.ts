import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNativePlatform, getNativePlatform } from "./platform";

interface StepCadencePlugin {
  isAvailable(): Promise<{ available: boolean }>;
  start(): Promise<{ started: boolean }>;
  stop(): Promise<{ stopped: boolean }>;
  addListener(
    eventName: "cadence",
    listenerFunc: (data: { spm: number }) => void
  ): Promise<PluginListenerHandle>;
}

/**
 * Backed by ios/App/App/StepCadencePlugin.swift — same local-plugin pattern
 * as airpods-heart-rate.ts (registered explicitly in MainViewController's
 * capacitorDidLoad(), not relying on Capacitor's auto-discovery). Android
 * has no equivalent yet.
 */
const StepCadence = registerPlugin<StepCadencePlugin>("StepCadence");

let cadenceListener: PluginListenerHandle | null = null;

/** True only on iOS — no Android implementation yet. */
export function isStepCadenceSupported(): boolean {
  return isNativePlatform() && getNativePlatform() === "ios";
}

/** Streams a running-average cadence (steps/min) for the duration of a run/walk. */
export async function startStepCadence(onCadence: (spm: number) => void): Promise<void> {
  const { available } = await StepCadence.isAvailable();
  if (!available) {
    throw new Error("Step counting isn't available on this device.");
  }

  cadenceListener = await StepCadence.addListener("cadence", (data) => {
    onCadence(Math.round(data.spm));
  });

  await StepCadence.start();
}

export async function stopStepCadence(): Promise<void> {
  await StepCadence.stop();
  await cadenceListener?.remove();
  cadenceListener = null;
}
