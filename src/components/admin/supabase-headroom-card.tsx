"use client";

import { useEffect, useState } from "react";
import { Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { overallLevel, type Headroom, type HeadroomLevel } from "@/lib/admin/supabase-headroom";

/**
 * How close the project is to the Supabase free-plan limits, as three bars
 * and a pause countdown. Reads /api/admin/supabase-headroom; the arithmetic
 * lives in lib/admin/supabase-headroom.ts and is tested there.
 *
 * The pause row is the one to watch: a free project with no API traffic for
 * seven days is switched off, and a paused project is a broken App Store
 * app until someone notices. The three meters are what Supabase's own usage
 * page shows, repeated here so they sit beside the other operations numbers.
 */

const LEVEL_TEXT: Record<HeadroomLevel, string> = {
  ok: "text-success",
  warn: "text-warning",
  critical: "text-danger",
};
const LEVEL_BAR: Record<HeadroomLevel, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  critical: "bg-danger",
};
const LEVEL_WORD: Record<HeadroomLevel, string> = {
  ok: "Fine",
  warn: "Getting close",
  critical: "Act now",
};

export function SupabaseHeadroomCard() {
  const [data, setData] = useState<Headroom | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/supabase-headroom", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as Headroom & { error?: string };
        if (cancelled) return;
        if (!res.ok) setError(body.error ?? `Request failed (${res.status})`);
        else setData(body);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't read the headroom numbers.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const level = data ? overallLevel(data) : null;

  return (
    <Card padding="lg">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" aria-hidden />
          Supabase headroom · free plan
        </CardTitle>
        {level && <span className={cn("text-xs font-semibold", LEVEL_TEXT[level])}>{LEVEL_WORD[level]}</span>}
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        {!error && !data && <p className="text-sm text-muted">Reading…</p>}
        {data && (
          <>
            <div
              className={cn(
                "rounded-xl border p-3",
                data.pause.level === "ok" && "border-white/10 bg-white/[0.03]",
                data.pause.level === "warn" && "border-warning/40 bg-warning/10",
                data.pause.level === "critical" && "border-danger/40 bg-danger/10"
              )}
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">Pause risk</p>
              <p className={cn("mt-1 text-sm font-semibold", LEVEL_TEXT[data.pause.level])}>{data.pause.note}</p>
              {data.pause.lastActivityAt && (
                <p className="mt-0.5 text-xs text-muted">
                  Last sign-in or save{" "}
                  {new Date(data.pause.lastActivityAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
            </div>

            <ul className="space-y-3">
              {data.meters.map((m) => (
                <li key={m.label}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{m.label}</span>
                    <span className="text-xs text-muted tabular-nums">{m.display}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className={cn("h-full rounded-full", LEVEL_BAR[m.level])}
                      style={{ width: `${Math.min(100, Math.round(m.fraction * 100))}%` }}
                      aria-hidden
                    />
                  </div>
                  <p className={cn("mt-1 text-[11px] tabular-nums", LEVEL_TEXT[m.level])}>
                    {(m.fraction * 100).toFixed(m.fraction < 0.01 ? 2 : 1)}% used
                  </p>
                </li>
              ))}
            </ul>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-3">
              <div>
                <dt>Accounts</dt>
                <dd className="font-medium text-foreground tabular-nums">{data.counts.usersTotal.toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt>Onboarded</dt>
                <dd className="font-medium text-foreground tabular-nums">{data.counts.usersOnboarded.toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt>Active, last 30 days</dt>
                <dd className="font-medium text-foreground tabular-nums">{data.counts.usersActive30d.toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt>Sessions logged</dt>
                <dd className="font-medium text-foreground tabular-nums">{data.counts.activitiesTotal.toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt>Stored files</dt>
                <dd className="font-medium text-foreground tabular-nums">{data.counts.storageObjects.toLocaleString("en-GB")}</dd>
              </div>
            </dl>

            <p className="text-[11px] leading-relaxed text-muted">
              Limits are Supabase&apos;s published free-plan figures. Auth email sending is throttled separately and
              is not measured here; custom SMTP removes that limit. Measured{" "}
              {new Date(data.measuredAt).toLocaleTimeString("en-GB", { timeStyle: "short" })}.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
