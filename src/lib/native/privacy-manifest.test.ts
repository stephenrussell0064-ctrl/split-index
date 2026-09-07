import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/*
 * B6 — the privacy manifests.
 *
 * These are checked in a test rather than left to a reviewer because a missing
 * or malformed manifest is an AUTOMATED upload rejection (ITMS-91053) before a
 * human ever opens the build. The failure arrives hours after you press submit,
 * with an error code and no context, so it is worth catching here.
 *
 * The subtle one is the last test in this file. Creating the .xcprivacy file is
 * not enough — it has to be in the App target's Resources build phase or it
 * never gets copied into the bundle, and the upload fails exactly as if the
 * file did not exist. That is the trap this whole file exists to keep shut.
 */

const IOS = resolve(__dirname, "../../../ios/App");
const APP_MANIFEST = resolve(IOS, "App/PrivacyInfo.xcprivacy");
const WIDGET_MANIFEST = resolve(IOS, "SplitIndexWidgets/PrivacyInfo.xcprivacy");
const PBXPROJ = resolve(IOS, "App.xcodeproj/project.pbxproj");

const read = (p: string) => readFileSync(p, "utf8");

describe("privacy manifests exist", () => {
  it("ships one for the app target", () => {
    expect(existsSync(APP_MANIFEST)).toBe(true);
  });

  it("ships a separate one for the widget extension", () => {
    // An extension is not covered by the app's manifest.
    expect(existsSync(WIDGET_MANIFEST)).toBe(true);
  });
});

describe("the app manifest declares what the app actually does", () => {
  const xml = read(APP_MANIFEST);

  it.each([
    // Health and Fitness are two separate Apple values, not one. This
    // originally asserted a combined "HealthFitness" type, which Apple does not
    // define — Xcode cannot build a correct privacy report from an invented
    // data type, so it would have shipped a manifest that looked complete and
    // was not.
    ["Health", "heart rate, bodyweight, body fat, sex and age"],
    ["Fitness", "workouts, logged sessions and step cadence"],
    ["PreciseLocation", "background GPS during outdoor runs"],
    ["EmailAddress", "sign-in identity"],
    ["Name", "profiles.display_name on leaderboards"],
    ["UserID", "the Supabase auth user id every row is keyed on"],
    ["PurchaseHistory", "subscription state via RevenueCat"],
    ["ProductInteraction", "which features an athlete opens"],
  ])("declares %s — %s", (type) => {
    expect(xml).toContain(`NSPrivacyCollectedDataType${type}`);
  });

  it("does NOT declare crash or performance data", () => {
    // The app ships no analytics or crash SDK. Declaring data you do not
    // collect mismatches the App Privacy answers, which is its own rejection.
    expect(xml).not.toContain("NSPrivacyCollectedDataTypeCrashData");
    expect(xml).not.toContain("NSPrivacyCollectedDataTypePerformanceData");
  });

  it("declares UserDefaults with reason CA92.1", () => {
    // Used by RacePredictionsPlugin.swift and @capacitor/preferences, always
    // against the app's own group container.
    expect(xml).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
    expect(xml).toContain("CA92.1");
  });

  it("declares no tracking and no tracking domains", () => {
    expect(xml).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(xml).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  });
});

describe("the widget manifest", () => {
  const xml = read(WIDGET_MANIFEST);

  it("collects nothing — it only reads what the app already wrote", () => {
    expect(xml).toMatch(/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  });

  it("still declares its UserDefaults access to the shared group", () => {
    expect(xml).toContain("NSPrivacyAccessedAPICategoryUserDefaults");
    expect(xml).toContain("CA92.1");
  });
});

describe("the manifests are actually bundled", () => {
  const pbxproj = read(PBXPROJ);

  it("has the app manifest in the App target's Resources build phase", () => {
    // A file on disk that no build phase copies is invisible to the packager,
    // and the upload fails exactly as if it were missing.
    const resources = pbxproj.match(
      /504EC3021FED79650016851F \/\* Resources \*\/ = \{[\s\S]*?\};/,
    )?.[0];
    expect(resources).toBeDefined();
    expect(resources).toContain("PrivacyInfo.xcprivacy in Resources");
  });

  it("leaves the widget manifest to the synchronized group, which excludes only Info.plist", () => {
    // SplitIndexWidgets is a PBXFileSystemSynchronizedRootGroup, so files in
    // that folder are included automatically unless listed as an exception.
    // If someone adds PrivacyInfo.xcprivacy to membershipExceptions, the widget
    // silently stops shipping its manifest.
    const exceptions = pbxproj.match(/membershipExceptions = \([\s\S]*?\);/)?.[0];
    expect(exceptions).toBeDefined();
    expect(exceptions).not.toContain("PrivacyInfo.xcprivacy");
  });
});

describe("Sign in with Apple (B4)", () => {
  const authForm = read(resolve(__dirname, "../../components/auth/auth-form.tsx"));

  /*
   * There is deliberately NO applesignin entitlement, and this test guards the
   * absence rather than the presence.
   *
   * It originally asserted the opposite, which was wrong. The entitlement is
   * required only for the native AuthenticationServices sheet
   * (ASAuthorizationAppleIDProvider). This app offers Sign in with Apple
   * through Apple's *web* OAuth flow via Supabase in an in-app browser — the
   * same path Google takes — and that needs a Services ID configured in
   * Supabase, not an app entitlement.
   *
   * Adding it back is not merely redundant: it breaks code signing until Sign
   * In with Apple is also enabled on the App ID in the developer portal, so an
   * entitlement added "to be safe" stops the build.
   */
  it("does NOT carry the applesignin entitlement, which the web OAuth flow does not use", () => {
    const entitlements = read(resolve(IOS, "App/App.entitlements"));
    expect(entitlements).not.toMatch(/<key>com\.apple\.developer\.applesignin<\/key>/);
  });

  it("explains in the entitlements file why it is absent", () => {
    // Without the note, the next person reading Guideline 4.8 adds it back and
    // breaks signing. The comment is the fix for that, so it is load-bearing.
    const entitlements = read(resolve(IOS, "App/App.entitlements"));
    expect(entitlements).toMatch(/applesignin/);
    expect(entitlements).toMatch(/Services ID/i);
  });

  /*
   * The rule Guideline 4.8 actually states, expressed as a test: offering
   * Google without an equivalent login service is the rejection. So this is
   * conditional rather than absolute — if Google is ever removed, Apple stops
   * being mandatory and this test correctly stops demanding it.
   */
  it("offers Apple whenever it offers Google", () => {
    const offersGoogle = authForm.includes('handleOAuth("google")');
    const offersApple = authForm.includes('handleOAuth("apple")');
    if (offersGoogle) expect(offersApple).toBe(true);
  });

  it("puts Apple at least as prominently as Google", () => {
    // Equivalent prominence is the wording in 4.8. Rendering it first satisfies
    // that and Apple's own button guidance without needing an argument.
    const appleAt = authForm.indexOf('handleOAuth("apple")');
    const googleAt = authForm.indexOf('handleOAuth("google")');
    expect(appleAt).toBeGreaterThan(-1);
    expect(appleAt).toBeLessThan(googleAt);
  });

  it("routes both providers through one handler rather than a second copy", () => {
    // The same drift that produced B1 — one payment branch migrated, the other
    // forgotten — is available here too if the providers get separate handlers.
    expect(authForm).toContain('provider: "google" | "apple"');
    expect(authForm.match(/signInWithOAuth\(/g) ?? []).toHaveLength(1);
  });
});
