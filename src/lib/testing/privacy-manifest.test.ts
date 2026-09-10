import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/*
 * Every identifier in the privacy manifest has to be one Apple actually defines.
 *
 * This file is required since 1 May 2024 and is checked at upload — a manifest
 * Apple cannot parse is rejected as ITMS-91053 before a human sees the build.
 * But an identifier that is merely INVENTED parses fine and fails quietly:
 * Apple's own guidance is that Xcode cannot generate a correct privacy report
 * from a collected-data type you define yourself, and the App Privacy answers
 * in App Store Connect then have nothing to agree with.
 *
 * It has happened twice in this file. `NSPrivacyCollectedDataTypeHealthFitness`
 * was declared once — Apple has separate Health and Fitness types and no
 * combined one — and after that was split, `...TypeUserContent` appeared,
 * beside the `...TypeOtherUserContent` that already covered the same data.
 * Both read exactly like identifiers that ought to exist, which is why neither
 * was caught by reading.
 *
 * The list below is Apple's enumeration. If Apple adds a type, add it here —
 * that is a deliberate two-second edit, and far cheaper than the alternative.
 */

const VALID_DATA_TYPES = new Set([
  // Contact info
  "EmailAddress", "Name", "PhoneNumber", "PhysicalAddress", "OtherUserContactInfo",
  // Health and fitness
  "Health", "Fitness",
  // Financial info
  "PaymentInfo", "CreditInfo", "OtherFinancialInfo",
  // Location
  "PreciseLocation", "CoarseLocation",
  // Sensitive info and contacts
  "SensitiveInfo", "Contacts",
  // User content
  "EmailsOrTextMessages", "PhotosorVideos", "AudioData", "GameplayContent",
  "CustomerSupport", "OtherUserContent",
  // History
  "BrowsingHistory", "SearchHistory",
  // Identifiers and purchases
  "UserID", "DeviceID", "PurchaseHistory",
  // Usage data
  "ProductInteraction", "AdvertisingData", "OtherUsageData",
  // Diagnostics
  "CrashData", "PerformanceData", "OtherDiagnosticData",
  // Surroundings and body
  "EnvironmentScanning", "Hands", "Head",
  // Catch-all
  "OtherDataTypes",
]);

const VALID_PURPOSES = new Set([
  "ThirdPartyAdvertising", "DeveloperAdvertising", "AnalyticsPurpose",
  "ProductPersonalization", "AppFunctionality", "Other",
]);

/** Every manifest in the repo, so a new target cannot ship an unchecked one. */
const MANIFESTS = [
  "ios/App/App/PrivacyInfo.xcprivacy",
  "ios/App/SplitIndexWidgets/PrivacyInfo.xcprivacy",
].filter((rel) => existsSync(join(process.cwd(), rel)));

/** Strips comments, then reads the `<string>` values under a given key. */
function stringsFor(xml: string, pattern: RegExp): string[] {
  return [...xml.replace(/<!--[\s\S]*?-->/g, "").matchAll(pattern)].map((m) => m[1]);
}

describe("the privacy manifests declare identifiers Apple defines", () => {
  it("finds the manifests, and reads types out of at least one", () => {
    // A path typo, or a regex that stopped matching, would pass every
    // assertion below having read nothing at all.
    expect(MANIFESTS.length).toBeGreaterThan(0);
    const total = MANIFESTS.map((rel) =>
      stringsFor(
        readFileSync(join(process.cwd(), rel), "utf8"),
        /<string>NSPrivacyCollectedDataType([A-Za-z]+)<\/string>/g,
      ).filter((t) => !t.startsWith("Purpose")).length,
    ).reduce((a, b) => a + b, 0);
    expect(total, "no data types read from any manifest — has the format changed?").toBeGreaterThan(0);
  });

  for (const rel of MANIFESTS) {
    const xml = readFileSync(join(process.cwd(), rel), "utf8");

    it(`${rel}: every collected data type is real`, () => {
      /*
       * An empty list is legitimate. The widget extension collects nothing —
       * it reads a value the app already wrote — and asserting every manifest
       * declares something flagged a correct file. The "did the parser work"
       * check belongs at suite level, below, not per-manifest.
       */
      const declared = stringsFor(xml, /<string>NSPrivacyCollectedDataType([A-Za-z]+)<\/string>/g)
        .filter((t) => !t.startsWith("Purpose"));
      const invented = declared.filter((t) => !VALID_DATA_TYPES.has(t));
      expect(
        invented,
        `Not identifiers Apple defines: ${invented.join(", ")}. ` +
          `Check the exact spelling against Apple's NSPrivacyCollectedDataType list ` +
          `before adding it to VALID_DATA_TYPES.`,
      ).toEqual([]);
    });

    it(`${rel}: every purpose is real`, () => {
      const purposes = stringsFor(
        xml,
        /<string>NSPrivacyCollectedDataTypePurpose([A-Za-z]+)<\/string>/g,
      );
      const invented = purposes.filter((p) => !VALID_PURPOSES.has(p));
      expect(invented, `Not purposes Apple defines: ${invented.join(", ")}`).toEqual([]);
    });

    it(`${rel}: declares no type twice`, () => {
      // The invented UserContent entry sat beside OtherUserContent, covering the
      // same data. Even with valid identifiers, two dicts for one type is a
      // contradiction waiting to disagree with the App Store Connect answers.
      const declared = stringsFor(xml, /<string>NSPrivacyCollectedDataType([A-Za-z]+)<\/string>/g)
        .filter((t) => !t.startsWith("Purpose"));
      expect(declared).toEqual([...new Set(declared)]);
    });
  }
});
