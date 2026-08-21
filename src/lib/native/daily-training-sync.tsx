"use client";

import { useEffect } from "react";
import { publishDailyTraining, type DailyTrainingPayload } from "./daily-training";

/**
 * Renders nothing. Its only job is to hand the hybrid-plan screen's
 * already-computed days to the native plugin, which writes them where the
 * home-screen widget can read them (see daily-training.ts).
 *
 * It lives here rather than in components/ because it is part of the native
 * bridge, not part of the UI — the same arrangement as RacePredictionsSync,
 * and for the same reason.
 *
 * Keyed on the payload's own content: the effect re-runs when the days
 * actually change and does nothing on a re-render that didn't move them. Every
 * run costs a native round-trip plus a WidgetKit timeline reload, which is a
 * metered system resource rather than something to spend per render.
 */
export function DailyTrainingSync({ payload }: { payload: DailyTrainingPayload }) {
  const serialized = JSON.stringify(payload);

  useEffect(() => {
    // Parsed from the dep rather than closing over `payload` so the effect
    // depends on the value, not on the object identity each render hands it.
    void publishDailyTraining(JSON.parse(serialized) as DailyTrainingPayload).then((result) => {
      // "unsupported" is every web and Android render — not a fault, and
      // logging it would bury the one line that matters.
      if (result.published || result.reason === "unsupported") return;
      // Everything else means the athlete's home screen is about to disagree
      // with the app they are holding. That must leave a trace: this failure
      // is otherwise completely silent on both sides.
      console.warn(
        `[daily-training] widget not updated (${result.reason}).` +
          (result.reason === "disconnected"
            ? " The App Group entitlement is not live on this build, so nothing published here can reach the widget."
            : "")
      );
    });
  }, [serialized]);

  return null;
}
