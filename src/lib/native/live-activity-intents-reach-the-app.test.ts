import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The Live Activity's buttons need their intents compiled into the APP.
 *
 * `ios/App/SplitIndexWidgets/` is a file-system-synchronized group owned by
 * SplitIndexWidgetsExtension. Every file dropped in it joins the extension
 * automatically and NOTHING joins the app unless someone adds it by hand. That
 * asymmetry is invisible in the source tree and it shipped a broken feature:
 * GymTimerIntents.swift was in the extension only, so on a released build the
 * lock-screen Pause and "Rest 90s" buttons rendered and did nothing.
 *
 * They fail silently, which is why this is a test rather than a code review
 * note. A `LiveActivityIntent` is performed in the app's process and
 * `Activity<T>.activities` is only populated there; in the extension the list
 * is empty, `gymTimerActivity()` returns nil, and the guard returns a
 * successful empty result. No crash, no log, no error on screen — the button
 * just doesn't do anything, and nothing short of a device catches it.
 */

const PBXPROJ = resolve(__dirname, "../../../ios/App/App.xcodeproj/project.pbxproj");
const project = readFileSync(PBXPROJ, "utf8");

/** The App target's Sources phase, by the uuid Xcode gave it. */
function appSourcesPhase(): string {
  const m = /504EC3001FED79650016851F \/\* Sources \*\/ = \{([\s\S]*?)\};/.exec(project);
  if (!m) throw new Error("App target's Sources build phase not found — did the project change?");
  return m[1];
}

/**
 * Files that live under the widget's synchronized folder but must ALSO be
 * compiled into the app. Adding one to the folder is not enough.
 */
const SHARED_WITH_APP = [
  // The intents behind the lock-screen buttons. The reason this file exists.
  "GymTimerIntents.swift",
  // The Activity's own attributes — the app starts the activity, so it needs them.
  "SplitIndexActivityAttributes.swift",
  // Both stores are written by the app and read by the widget.
  "DailyTrainingStore.swift",
  "RacePredictionStore.swift",
];

describe("the guard is reading the project it thinks it is", () => {
  it("finds the App target's Sources phase", () => {
    expect(appSourcesPhase().length).toBeGreaterThan(0);
  });

  it("confirms the widget folder really is synchronized", () => {
    // If this stops being true, membership is explicit for both targets and
    // the trap this file guards no longer exists.
    expect(project).toContain("PBXFileSystemSynchronizedRootGroup");
    const group = /isa = PBXFileSystemSynchronizedRootGroup;[\s\S]*?sourceTree/.exec(project)?.[0] ?? "";
    expect(group).toContain("path = SplitIndexWidgets;");
  });
});

describe("every shared widget file is compiled into the app", () => {
  it.each(SHARED_WITH_APP)("%s is in the App target's Sources phase", (file) => {
    expect(appSourcesPhase()).toContain(`SplitIndexWidgets/${file} in Sources`);
  });

  it.each(SHARED_WITH_APP)("%s has a file reference to build against", (file) => {
    expect(project).toMatch(
      new RegExp(`isa = PBXFileReference;[^}]*path = SplitIndexWidgets/${file.replace(".", "\\.")};`),
    );
  });
});

describe("the intents the buttons call are the ones shared", () => {
  const intents = readFileSync(
    resolve(__dirname, "../../../ios/App/SplitIndexWidgets/GymTimerIntents.swift"),
    "utf8",
  );
  const view = readFileSync(
    resolve(__dirname, "../../../ios/App/SplitIndexWidgets/SplitIndexWidgetsLiveActivity.swift"),
    "utf8",
  );

  it.each(["ToggleGymTimerIntent", "AddRestIntent", "DismissRestIntent"])(
    "%s is declared and used by a button",
    (name) => {
      expect(intents).toContain(`struct ${name}: LiveActivityIntent`);
      expect(view).toContain(`Button(intent: ${name}(`);
    },
  );
});
