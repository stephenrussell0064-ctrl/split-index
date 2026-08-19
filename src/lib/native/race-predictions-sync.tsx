"use client";

import { useEffect } from "react";
import { publishRacePredictions, type RacePredictionPayload } from "./race-predictions";

/**
 * Renders nothing. Its only job is to carry the dashboard's already-computed
 * race predictions across the server/client boundary and hand them to the
 * native plugin, which writes them where the home-screen widget can read
 * them (see race-predictions.ts).
 *
 * It lives here rather than in components/ because it is part of the native
 * bridge, not part of the UI — it has no visual output and nothing else
 * would ever compose it.
 *
 * A client component is required because the plugin call touches Capacitor,
 * which only exists in the WebView at runtime; the dashboard itself is a
 * server component and can't call it. The payload is plain JSON, so it
 * serializes across the boundary cleanly.
 *
 * Keyed on the payload's own content: the effect re-runs when the numbers
 * actually change, and does nothing on a re-render that didn't move them —
 * every run costs a native round-trip plus a WidgetKit timeline reload,
 * which is a metered system resource, not something to spend per render.
 */
export function RacePredictionsSync({ payload }: { payload: RacePredictionPayload }) {
  const serialized = JSON.stringify(payload);

  useEffect(() => {
    // Parsed from the dep rather than closing over `payload` so the effect
    // depends on the value, not on the object identity a fresh server
    // render hands it every time.
    void publishRacePredictions(JSON.parse(serialized) as RacePredictionPayload);
  }, [serialized]);

  return null;
}
