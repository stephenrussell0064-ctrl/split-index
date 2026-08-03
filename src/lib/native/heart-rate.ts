import { BleClient, numberToUUID } from "@capacitor-community/bluetooth-le";
import { isNativePlatform } from "./platform";
import type { HrReading } from "@/lib/scoring/gps-track";

/**
 * Standard Bluetooth SIG Heart Rate Service/Measurement UUIDs (0x180D/0x2A37)
 * — the vendor-neutral GATT profile Garmin watches and Polar/Wahoo-style
 * chest straps broadcast to any listener, not a vendor SDK. This is a
 * deliberate scope boundary: AirPods have no heart-rate sensor in any
 * shipped model, and Whoop is a closed ecosystem that doesn't expose this
 * standard service to third-party apps — neither can ever appear in the
 * device picker this module drives, no matter how the plugin is configured.
 */
const HEART_RATE_SERVICE = numberToUUID(0x180d);
const HEART_RATE_MEASUREMENT_CHARACTERISTIC = numberToUUID(0x2a37);

export interface HeartRateDevice {
  deviceId: string;
  name: string;
}

/**
 * Parses the Heart Rate Measurement characteristic payload per the
 * Bluetooth SIG spec: byte 0 is a flags bitfield whose bit 0 selects
 * whether the BPM value is a following UINT8 or UINT16 (little-endian).
 * Pure and device-independent on purpose, so it's testable without a BLE
 * stack or a physical monitor.
 */
export function parseHeartRateMeasurement(value: DataView): number {
  const flags = value.getUint8(0);
  const is16Bit = (flags & 0x01) === 1;
  return is16Bit ? value.getUint16(1, true) : value.getUint8(1);
}

let connectedDeviceId: string | null = null;

export function isHeartRateMonitorConnected(): boolean {
  return connectedDeviceId !== null;
}

/**
 * Opens the OS device picker filtered to standard-HR broadcasters, connects,
 * and starts live BPM notifications. `onReading` fires for every parsed
 * measurement so the caller can both show a live number and buffer
 * timestamped readings for post-run segment scoring (see
 * gps-track.ts's summarizeIntervalSegments/summarizeFartlekSegments).
 */
export async function connectHeartRateMonitor(
  onReading: (reading: HrReading) => void
): Promise<HeartRateDevice> {
  if (!isNativePlatform()) {
    throw new Error("Heart-rate pairing needs the Split Index app, not the website.");
  }

  await BleClient.initialize();
  const device = await BleClient.requestDevice({ services: [HEART_RATE_SERVICE] });

  await BleClient.connect(device.deviceId, () => {
    connectedDeviceId = null;
  });
  connectedDeviceId = device.deviceId;

  await BleClient.startNotifications(
    device.deviceId,
    HEART_RATE_SERVICE,
    HEART_RATE_MEASUREMENT_CHARACTERISTIC,
    (value) => {
      onReading({ bpm: parseHeartRateMeasurement(value), time: Date.now() });
    }
  );

  return { deviceId: device.deviceId, name: device.name || "Heart rate monitor" };
}

/** Safe to call even if nothing is connected — a no-op in that case. */
export async function disconnectHeartRateMonitor(): Promise<void> {
  if (!connectedDeviceId) return;
  const deviceId = connectedDeviceId;
  connectedDeviceId = null;
  try {
    await BleClient.stopNotifications(deviceId, HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT_CHARACTERISTIC);
  } catch {
    // Device may have already disconnected on its own (out of range, powered off).
  }
  try {
    await BleClient.disconnect(deviceId);
  } catch {
    // Already disconnected.
  }
}
