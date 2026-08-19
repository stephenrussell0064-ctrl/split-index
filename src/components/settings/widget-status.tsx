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

  const report = describe(status);

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
            report.kind === "problem"
              ? "text-sm font-medium text-warning"
              : "text-sm font-medium"
          }
        >
          {report.headline}
        </p>
        {report.kind === "ok" && (
          // Both halves, named, because "the widget is empty" has two
          // completely different causes depending on which side is empty
          // and only one of them is a fault worth acting on.
          <ul className="space-y-1">
            <li className="text-sm text-muted">
              <span className="text-foreground">Races:</span> {report.race}
            </li>
            <li className="text-sm text-muted">
              <span className="text-foreground">Lifts:</span> {report.lifts}
            </li>
          </ul>
        )}
        <p className="text-sm text-muted">{report.detail}</p>
      </CardContent>
    </Card>
  );
}

type WidgetReport =
  | { kind: "problem"; headline: string; detail: string }
  | { kind: "ok"; headline: string; detail: string; race: string; lifts: string };

function describe(status: RacePredictionWidgetStatus): WidgetReport {
  if (status.state === "disconnected" || !status.containerReachable) {
    return {
      kind: "problem",
      headline: "Not connected",
      detail:
        "This build of the app can't reach the storage it shares with the widget, so nothing sent from here arrives and the widget stays empty no matter how much you log. Nothing is wrong with your training data — this is fixed by a new build of the app, not by logging more.",
    };
  }

  if (status.state === "empty") {
    return {
      kind: "problem",
      headline: "Connected, nothing sent yet",
      detail:
        "The widget can read from the app, but the app hasn't sent it anything. Open the home screen tab of Split Index once and it will fill in.",
    };
  }

  const sent = status.updatedAt ? formatSent(status.updatedAt) : "recently";

  return {
    kind: "ok",
    headline: `Connected · last sent ${sent}`,
    race: describeRace(status),
    lifts: describeLifts(status),
    detail:
      "If your home screen shows something different from this, remove the widget and add it again.",
  };
}

function describeRace(status: RacePredictionWidgetStatus): string {
  if (status.status === "ready" && status.headlineSeconds) {
    return `showing your ${status.headlineLabel ?? "5K"}, ${formatRiegelPrediction(status.headlineSeconds)}`;
  }
  if (status.status === "calibrating") {
    return "still calibrating — showing progress, not a time, which matches the app";
  }
  return "no prediction yet — the widget says so because that's genuinely what the app has";
}

function describeLifts(status: RacePredictionWidgetStatus): string {
  // Absent rather than "noData": this app version never sent a strength
  // half at all, which is a different thing from sending an empty one and
  // shouldn't be reported as "you have no lifts".
  if (!status.strength) {
    return "not sent by this version of the app — reinstall to get lifts on the widget";
  }
  if (status.strength.status === "ready" && status.strength.totalKg) {
    const logged = status.strength.liftsLogged ?? 0;
    return `showing ${Math.round(status.strength.totalKg)} kg total, ${logged}/3 lifts logged`;
  }
  return "no lifts yet — log a squat, bench, or deadlift";
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
