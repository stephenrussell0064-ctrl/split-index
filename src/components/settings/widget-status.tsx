"use client";

import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  getRacePredictionWidgetStatus,
  isRacePredictionWidgetSupported,
  type RacePredictionWidgetStatus,
} from "@/lib/native/race-predictions";
import { formatRiegelPrediction } from "@/lib/scoring/presentation";

/**
 * "I have many activities logged yet [the widget] says no race predictions."
 *
 * The widget lives in another process reading a shared App Group container,
 * and every way that link can break — entitlement not live on the build, app
 * never opened since install, payload genuinely empty — used to render as the
 * same sentence on the home screen: "Log a run to see predictions". An
 * athlete with a full training history was told they had no training history,
 * and nobody, including the person who wrote it, could tell which failure it
 * was without attaching a debugger.
 *
 * This card is that missing answer, in words, on the device. It reads the
 * container from the app's side of the same group, so what it reports is what
 * the widget sees. iOS-only and self-hiding: it renders nothing on web,
 * nothing on Android, and nothing on a native build too old to answer — so it
 * never becomes a debug panel in front of someone who has no widget.
 */
export function WidgetStatus() {
  const [status, setStatus] = useState<RacePredictionWidgetStatus | null>(null);

  useEffect(() => {
    if (!isRacePredictionWidgetSupported()) return;
    let cancelled = false;
    void getRacePredictionWidgetStatus().then((result) => {
      if (!cancelled) setStatus(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  const { headline, detail, tone } = describe(status);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-muted" />
          <CardTitle>Home screen widget</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p
          className={
            tone === "bad"
              ? "text-sm font-medium text-warning"
              : "text-sm font-medium"
          }
        >
          {headline}
        </p>
        <p className="text-sm text-muted">{detail}</p>
      </CardContent>
    </Card>
  );
}

function describe(status: RacePredictionWidgetStatus): {
  headline: string;
  detail: string;
  tone: "ok" | "bad";
} {
  if (status.state === "disconnected" || !status.containerReachable) {
    return {
      tone: "bad",
      headline: "Not connected",
      detail:
        "This build of the app can't reach the storage it shares with the widget, so nothing sent from here arrives and the widget stays empty no matter how much you log. Nothing is wrong with your training data — this is fixed by a new build of the app, not by logging more.",
    };
  }

  if (status.state === "empty") {
    return {
      tone: "bad",
      headline: "Connected, nothing sent yet",
      detail:
        "The widget can read from the app, but the app hasn't sent it anything. Open the home screen tab of Split Index once and it will fill in.",
    };
  }

  const sent = status.updatedAt ? formatSent(status.updatedAt) : "recently";

  if (status.status === "ready" && status.headlineSeconds) {
    return {
      tone: "ok",
      headline: `Showing your ${status.headlineLabel ?? "5K"}: ${formatRiegelPrediction(status.headlineSeconds)}`,
      detail: `Sent to the widget ${sent}. If your home screen shows something different, remove the widget and add it again.`,
    };
  }

  if (status.status === "calibrating") {
    return {
      tone: "ok",
      headline: "Showing: still calibrating",
      detail: `The widget is up to date as of ${sent}. It's showing your progress towards a prediction rather than a time, which matches the app.`,
    };
  }

  return {
    tone: "ok",
    headline: "Showing: no prediction yet",
    detail: `The widget is up to date as of ${sent}. It's showing the empty state because that's genuinely what the app has — not because the connection is broken.`,
  };
}

/** Deliberately coarse. The exact second the payload was handed over is noise; whether it was minutes or weeks ago is the whole signal. */
function formatSent(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "recently";
  const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
