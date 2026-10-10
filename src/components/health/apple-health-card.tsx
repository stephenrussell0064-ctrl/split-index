"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useIsNativeShell } from "@/lib/native/use-is-native-shell";
import { getNativePlatform } from "@/lib/native/platform";
import {
  connectHealth,
  disconnectHealth,
  getHealthImportState,
  runHealthSync,
  type HealthImportState,
  type HealthSyncResult,
} from "@/lib/health/sync-client";

/**
 * Connect Apple Health, sync now, disconnect.
 *
 * One card, three states. It renders nothing on the web unless asked to
 * explain itself (`webFallback="note"`), because a button that can only
 * fail is worse than no button; the import needs the iOS shell, where the
 * health store is.
 *
 * What is NOT here: a nag. The card sits where the numbers it feeds are shown
 * (the Recovery page) and with the other account controls (Settings), and it
 * asks once. Every input it imports is optional to the scores, so an athlete
 * who declines sees exactly the app they had — see the plan's "permission
 * rejection" risk.
 */
export function AppleHealthCard({ webFallback = "hidden" }: { webFallback?: "hidden" | "note" }) {
  const native = useIsNativeShell();
  const router = useRouter();
  const [state, setState] = useState<HealthImportState | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ios = native && getNativePlatform() === "ios";

  useEffect(() => {
    if (!ios) return;
    let cancelled = false;
    getHealthImportState()
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't check the connection. Pull to refresh.");
      });
    return () => {
      cancelled = true;
    };
  }, [ios]);

  if (!ios) {
    if (webFallback === "hidden") return null;
    return (
      <Card padding="lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Apple Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs leading-relaxed text-muted">
            Connect in the iPhone app and your runs, rides, HRV, resting heart rate, sleep and bodyweight
            arrive on their own — from Apple Watch or any watch, strap or app that writes to Apple
            Health.
          </p>
        </CardContent>
      </Card>
    );
  }

  function summarise(result: HealthSyncResult): string {
    const parts: string[] = [];
    if (result.workouts.imported > 0) parts.push(`${result.workouts.imported} session${result.workouts.imported === 1 ? "" : "s"}`);
    if (result.hrvDays > 0) parts.push(`${result.hrvDays} HRV day${result.hrvDays === 1 ? "" : "s"}`);
    if (result.restingHrDays > 0) parts.push(`${result.restingHrDays} resting HR`);
    if (result.sleepNights > 0) parts.push(`${result.sleepNights} night${result.sleepNights === 1 ? "" : "s"} of sleep`);
    if (result.bodyMass > 0) parts.push(`${result.bodyMass} weigh-in${result.bodyMass === 1 ? "" : "s"}`);
    if (parts.length === 0) {
      return result.workouts.duplicates > 0
        ? "Nothing new. Sessions you had already logged were left as they are."
        : "Nothing new since last time.";
    }
    return `Imported ${parts.join(", ")}.`;
  }

  async function run(kind: "connect" | "sync" | "disconnect") {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      if (kind === "connect") {
        const result = await connectHealth();
        setState(await getHealthImportState());
        setMessage(summarise(result));
      } else if (kind === "sync") {
        const result = await runHealthSync(state ?? undefined);
        setState(await getHealthImportState());
        setMessage(summarise(result));
      } else {
        setState(await disconnectHealth());
        setMessage("Disconnected. Everything already imported stays in your log.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(null);
    }
  }

  const connected = state?.connected === true;
  const lastSync = state?.lastSyncAt ? new Date(state.lastSyncAt) : null;

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          Apple Health
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {connected ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="h-3 w-3" aria-hidden />
              </span>
              <span className="font-medium">Connected</span>
              {lastSync && (
                <span className="text-xs text-muted">
                  · synced {lastSync.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted">
              Runs, rides, swims and rows become sessions here. HRV, resting heart rate, sleep and
              bodyweight feed your Recovery score and your plan. Syncs when you open the app; tap to
              sync now.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => run("sync")} disabled={busy !== null}>
                {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sync now
              </Button>
              <Button variant="ghost" size="sm" onClick={() => run("disconnect")} disabled={busy !== null}>
                {busy === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted">
              Your runs, rides, HRV, resting heart rate, sleep and bodyweight, read from Apple Health —
              from Apple Watch or any watch, strap or app that writes to it. Nothing is written back.
              Optional: every score works without it.
            </p>
            <Button size="sm" onClick={() => run("connect")} disabled={busy !== null || state === null}>
              {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Connect Apple Health
            </Button>
          </>
        )}
        {message && <p className="text-xs text-foreground/80">{message}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}
