// @capacitor-community/background-geolocation ships a Package.swift that pins
// capacitor-swift-pm to `from: "7.0.0"` — which in SwiftPM means 7.0.0..<8.0.0.
// Every other Capacitor plugin here is on Capacitor 8, and
// @revenuecat/purchases-capacitor pins 8.0.0..<9.0.0, so SwiftPM cannot pick a
// single capacitor-swift-pm version and the whole graph fails to resolve:
//
//   error: Dependencies could not be resolved because 'background-geolocation'
//   depends on 'capacitor-swift-pm' 7.0.0..<8.0.0 and 'purchases-capacitor'
//   depends on 'capacitor-swift-pm' 8.0.0..<9.0.0.
//
// Xcode surfaces that as the far less obvious "Missing package product
// 'CapApp-SPM'" — the local package never resolves, so its product never
// exists, so the App target can't link it and the build fails before compiling
// a single file.
//
// Upstream is stuck at 1.2.26 (latest as of Aug 2026) and the pin is the only
// thing blocking Capacitor 8 — the plugin's Swift source uses CAPPlugin APIs
// that are unchanged between 7 and 8. Widening the range here lets SwiftPM
// settle on 8.5.0 for everyone. Runs from postinstall so a fresh `npm install`
// (or a teammate's clone) doesn't silently reintroduce the broken pin.
//
// Revisit if background-geolocation ever ships a Capacitor 8 release: at that
// point this file should be deleted rather than left to no-op forever.

import { readFileSync, writeFileSync } from "node:fs";

const PATCHES = [
  {
    file: "node_modules/@capacitor-community/background-geolocation/Package.swift",
    find: 'from: "7.0.0"',
    replace: '"7.0.0"..<"9.0.0"',
  },
];

for (const { file, find, replace } of PATCHES) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    // Plugin not installed (production install, or it was removed). Nothing to
    // patch, and nothing worth failing an install over.
    continue;
  }

  if (source.includes(replace)) continue;

  if (!source.includes(find)) {
    // The upstream file changed shape. Don't guess — a silently-skipped patch
    // turns into a confusing Xcode error later, so say so loudly here instead.
    console.warn(
      `[patch-capacitor-spm] ${file} no longer contains ${find} — patch skipped. ` +
        `If the plugin now supports Capacitor 8, delete scripts/patch-capacitor-spm.mjs.`,
    );
    continue;
  }

  writeFileSync(file, source.replace(find, replace));
  console.log(`[patch-capacitor-spm] widened capacitor-swift-pm range in ${file}`);
}
