import { BleClient } from "@capacitor-community/bluetooth-le";
import { isNativePlatform } from "./platform";

/**
 * Concept2 PM5 rowing monitor — SCAFFOLD ONLY, not yet usable against a real
 * device. Unlike heart-rate.ts (a standard Bluetooth SIG profile, publicly
 * fixed and simple to parse), the PM5 broadcasts over Concept2's own
 * proprietary "C2 Rowing" BLE service — multiple characteristics, each
 * carrying a packed multi-field binary struct (elapsed time + distance +
 * pace + stroke rate bundled together per notification) rather than one
 * clean characteristic per metric. Concept2 does publish a BLE spec for
 * this ("PM5 Bluetooth Smart Communication Interface Definition"), but the
 * exact byte offsets/scaling factors below are NOT verified against that
 * spec or a real device — they're deliberately left as TODOs rather than
 * invented, so this module fails loudly/obviously instead of silently
 * returning plausible-looking garbage numbers.
 *
 * The connection shape (initialize → requestDevice → connect →
 * startNotifications) is proven and correct — it's the same pattern
 * heart-rate.ts already uses successfully in this app. What's NOT done yet:
 * confirming the actual service/characteristic UUIDs and writing a real
 * parser for the returned bytes. Do this before shipping:
 *   1. Get Concept2's PM5 BLE spec PDF (concept2.com developer resources)
 *      or a PM5 to test against directly.
 *   2. Replace PM5_SERVICE/PM5_ROWING_GENERAL_STATUS_CHARACTERISTIC below
 *      with the confirmed UUIDs.
 *   3. Replace parseGeneralStatus with a real byte-offset parser, verified
 *      against actual notification payloads (log raw bytes from a real
 *      device first, per logRawPm5Bytes below, before writing the parser).
 */

// TODO — UNVERIFIED. Concept2's PM5 uses a custom base UUID
// (documented in their BLE spec as a variant of the pattern
// CE06####-43E5-11E4-916C-0800200C9A66, with #### identifying the specific
// service/characteristic) rather than a Bluetooth SIG-assigned UUID. Confirm
// the exact values against the spec before relying on these.
const PM5_SERVICE = "ce060030-43e5-11e4-916c-0800200c9a66";
const PM5_ROWING_GENERAL_STATUS_CHARACTERISTIC = "ce060031-43e5-11e4-916c-0800200c9a66";

export interface Pm5Reading {
  /** Elapsed session time in seconds, if the parser below is confirmed correct. */
  elapsedSeconds: number | null;
  /** Total distance in meters, if the parser below is confirmed correct. */
  distanceMeters: number | null;
  /** Current split pace in seconds per 500m, if the parser below is confirmed correct. */
  splitSecondsPer500m: number | null;
  /** Strokes per minute, if the parser below is confirmed correct. */
  strokeRate: number | null;
}

export interface Pm5Device {
  deviceId: string;
  name: string;
}

/**
 * NOT VERIFIED — placeholder byte layout, do not trust these offsets. Real
 * PM5 "General Status" notifications reportedly pack elapsed time, distance,
 * pace, and stroke rate into a single fixed-length payload, but the actual
 * byte positions/scaling factors need confirming against Concept2's spec
 * before this returns real numbers. Currently returns nulls for everything
 * except logging the raw byte length, so a caller can't accidentally treat
 * garbage as real telemetry.
 */
export function parseGeneralStatus(value: DataView): Pm5Reading {
  console.warn(
    `[pm5-monitor] parseGeneralStatus is unverified — received ${value.byteLength} raw bytes, not decoded. ` +
      "See pm5-monitor.ts's file-level doc comment before using this in production."
  );
  return {
    elapsedSeconds: null,
    distanceMeters: null,
    splitSecondsPer500m: null,
    strokeRate: null,
  };
}

let connectedDeviceId: string | null = null;

export function isPm5Connected(): boolean {
  return connectedDeviceId !== null;
}

/**
 * Opens the OS device picker filtered to the PM5's (unverified) custom
 * service UUID, connects, and starts notifications. Until parseGeneralStatus
 * is filled in for real, every reading will come back all-null — this
 * exists to prove the connection/subscribe plumbing works, not as a
 * ready-to-ship feature.
 */
export async function connectPm5(onReading: (reading: Pm5Reading) => void): Promise<Pm5Device> {
  if (!isNativePlatform()) {
    throw new Error("PM5 pairing needs the Split Index app, not the website.");
  }

  await BleClient.initialize();
  const device = await BleClient.requestDevice({ services: [PM5_SERVICE] });

  await BleClient.connect(device.deviceId, () => {
    connectedDeviceId = null;
  });
  connectedDeviceId = device.deviceId;

  await BleClient.startNotifications(
    device.deviceId,
    PM5_SERVICE,
    PM5_ROWING_GENERAL_STATUS_CHARACTERISTIC,
    (value) => {
      onReading(parseGeneralStatus(value));
    }
  );

  return { deviceId: device.deviceId, name: device.name || "PM5" };
}

/** Safe to call even if nothing is connected — a no-op in that case. */
export async function disconnectPm5(): Promise<void> {
  if (!connectedDeviceId) return;
  const deviceId = connectedDeviceId;
  connectedDeviceId = null;
  try {
    await BleClient.stopNotifications(deviceId, PM5_SERVICE, PM5_ROWING_GENERAL_STATUS_CHARACTERISTIC);
  } catch {
    // Device may have already disconnected on its own.
  }
  try {
    await BleClient.disconnect(deviceId);
  } catch {
    // Already disconnected.
  }
}
