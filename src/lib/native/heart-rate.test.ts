import { describe, expect, it } from "vitest";
import { parseHeartRateMeasurement } from "./heart-rate";

function dataView(bytes: number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

describe("parseHeartRateMeasurement", () => {
  it("reads an 8-bit BPM value when flag bit 0 is unset", () => {
    // flags = 0b00000000 (8-bit format), BPM = 72
    expect(parseHeartRateMeasurement(dataView([0x00, 72]))).toBe(72);
  });

  it("reads a little-endian 16-bit BPM value when flag bit 0 is set", () => {
    // flags = 0b00000001 (16-bit format), BPM = 300 (0x012C little-endian: 0x2C, 0x01)
    expect(parseHeartRateMeasurement(dataView([0x01, 0x2c, 0x01]))).toBe(300);
  });

  it("ignores other flag bits (sensor contact, energy expended, RR-interval)", () => {
    // flags = 0b00001110 (8-bit format, sensor contact + energy expended set), BPM = 145
    expect(parseHeartRateMeasurement(dataView([0x0e, 145]))).toBe(145);
  });
});
