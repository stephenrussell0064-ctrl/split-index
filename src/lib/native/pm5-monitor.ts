import { BleClient } from "@capacitor-community/bluetooth-le";
import { isNativePlatform } from "./platform";

/**
 * Concept2 PM5 rowing monitor, over Concept2's proprietary "C2 Rowing" BLE
 * service (not a Bluetooth SIG-assigned profile like heart-rate.ts's Heart
 * Rate Service). UUIDs and byte layout below are per Concept2's "PM5
 * Bluetooth Smart Communication Interface Definition" spec (base pattern
 * CE06####-43E5-11E4-916C-0800200C9A66, #### identifying the service/
 * characteristic): the Rowing General Status characteristic (0x0031) packs
 * elapsed time + distance in one 19-byte notification, while pace and
 * stroke rate live on the separate Additional Status characteristic
 * (0x0032) — hence subscribing to both and merging readings below.
 *
 * The connection shape (initialize → requestDevice → connect →
 * startNotifications) mirrors heart-rate.ts's proven pattern.
 */
const PM5_SERVICE = "ce060030-43e5-11e4-916c-0800200c9a66";
const PM5_GENERAL_STATUS_CHARACTERISTIC = "ce060031-43e5-11e4-916c-0800200c9a66";
const PM5_ADDITIONAL_STATUS_CHARACTERISTIC = "ce060032-43e5-11e4-916c-0800200c9a66";

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

/** Little-endian 3-byte unsigned int — how the PM5 packs elapsed time and distance. */
function readUint24LE(value: DataView, offset: number): number {
  return value.getUint8(offset) + (value.getUint8(offset + 1) << 8) + (value.getUint8(offset + 2) << 16);
}

/** Little-endian 2-byte unsigned int — how the PM5 packs pace and stroke rate. */
function readUint16LE(value: DataView, offset: number): number {
  return value.getUint8(offset) + (value.getUint8(offset + 1) << 8);
}

/**
 * Rowing General Status (characteristic 0x0031): elapsed time and distance,
 * bytes 0-5 of the 19-byte payload. Elapsed time is 0.01s units, distance is
 * 0.1m units.
 */
export function parseGeneralStatus(value: DataView): Pick<Pm5Reading, "elapsedSeconds" | "distanceMeters"> {
  return {
    elapsedSeconds: readUint24LE(value, 0) * 0.01,
    distanceMeters: readUint24LE(value, 3) * 0.1,
  };
}

/**
 * Additional Status (characteristic 0x0032): current pace and stroke rate,
 * bytes 5-8 of the payload (elapsed time again occupies bytes 0-2, unused
 * here since General Status already supplies it). Pace is 0.01s/500m units.
 */
export function parseAdditionalStatus(value: DataView): Pick<Pm5Reading, "strokeRate" | "splitSecondsPer500m"> {
  return {
    strokeRate: value.getUint8(5),
    splitSecondsPer500m: readUint16LE(value, 7) * 0.01,
  };
}

let connectedDeviceId: string | null = null;

export function isPm5Connected(): boolean {
  return connectedDeviceId !== null;
}

/**
 * Opens the OS device picker filtered to the PM5's rowing service, connects,
 * and subscribes to both General Status (elapsed time/distance) and
 * Additional Status (pace/stroke rate) — the PM5 splits live telemetry
 * across the two characteristics, so readings are merged before being
 * handed to `onReading` rather than each characteristic reporting a
 * partial, momentarily-stale-looking reading on its own.
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

  const latest: Pm5Reading = {
    elapsedSeconds: null,
    distanceMeters: null,
    splitSecondsPer500m: null,
    strokeRate: null,
  };

  await BleClient.startNotifications(device.deviceId, PM5_SERVICE, PM5_GENERAL_STATUS_CHARACTERISTIC, (value) => {
    Object.assign(latest, parseGeneralStatus(value));
    onReading({ ...latest });
  });

  await BleClient.startNotifications(device.deviceId, PM5_SERVICE, PM5_ADDITIONAL_STATUS_CHARACTERISTIC, (value) => {
    Object.assign(latest, parseAdditionalStatus(value));
    onReading({ ...latest });
  });

  return { deviceId: device.deviceId, name: device.name || "PM5" };
}

/** Safe to call even if nothing is connected — a no-op in that case. */
export async function disconnectPm5(): Promise<void> {
  if (!connectedDeviceId) return;
  const deviceId = connectedDeviceId;
  connectedDeviceId = null;
  for (const characteristic of [PM5_GENERAL_STATUS_CHARACTERISTIC, PM5_ADDITIONAL_STATUS_CHARACTERISTIC]) {
    try {
      await BleClient.stopNotifications(deviceId, PM5_SERVICE, characteristic);
    } catch {
      // Device may have already disconnected on its own.
    }
  }
  try {
    await BleClient.disconnect(deviceId);
  } catch {
    // Already disconnected.
  }
}
