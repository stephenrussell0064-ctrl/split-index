"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

/**
 * The six numbers the logging-effort plan said it would be judged on, one
 * table each, week by week, with the plan's own target beside them.
 *
 * Nothing is computed here that the views do not already hold; the page is
 * a reading of migration 090, not a second model of it. Weeks start on
 * Monday (date_trunc('week')). "Measured" is how many sessions in the group
 * carried the per-session numbers at all — everything saved before the
 * instrumentation shipped is counted in "sessions" but has no median.
 */

interface EffortRow {
  week_start: string;
  domain: "gym" | "cardio";
  source: string;
  entry: string;
  activities: number;
  athletes: number;
  measured: number;
  median_fields_touched: number | null;
  median_seconds_to_save: number | null;
  prescribed_sets_accepted: number;
  prescribed_sets_edited: number;
}

interface RecoveryRow {
  week_start: string;
  hrv_source: string;
  hrv_days: number;
  hrv_athletes: number;
  resting_hr_days: number;
  sleep_nights: number;
}

interface LoggersRow {
  week_start: string;
  loggers: number;
  gym_loggers: number;
  cardio_loggers: number;
  recorded_or_imported_loggers: number;
  activities: number;
}

interface Response {
  windowDays: number;
  since: string;
  effort: EffortRow[];
  recovery: RecoveryRow[];
  loggers: LoggersRow[];
  targets: {
    gymFieldsTouched: { typedBaseline: number; target: number; note: string };
    cardioSecondsToSave: { target: number; note: string };
    appleHealthShare: { target: number; note: string };
    prescribedAccepted: { target: number; note: string };
    weeklyActiveLoggers: { note: string };
  };
}

const ENTRY_LABEL: Record<string, string> = {
  typed: "Typed from nothing",
  template: "Saved template",
  plan_preset: "Preset plan",
  recommended: "Recommended split",
  prescribed_form: "Plan, edited in form",
  prescribed_one_tap: "Plan, one tap",
  gps: "GPS run",
  file: "File import",
  apple_health: "Apple Health",
  untracked: "Before measurement",
};

const n = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "—");

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <Card>
      <p className="text-sm font-semibold">{caption}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted">Nothing in this window yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted">
                {head.map((h) => (
                  <th key={h} className="pb-2 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-white/[0.06]">
                  {r.map((c, j) => (
                    <td key={j} className={cn("py-1.5 pr-3 tabular-nums", j === 0 && "whitespace-nowrap")}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function LoggingEffortDashboard() {
  const [data, setData] = useState<Response | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "unavailable">("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/logging-effort");
        if (cancelled) return;
        if (res.status === 404 || res.status === 401) return setState("forbidden");
        if (res.status === 503) return setState("unavailable");
        if (!res.ok) return setState("unavailable");
        setData((await res.json()) as Response);
        setState("ok");
      } catch {
        if (!cancelled) setState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") return <p className="text-sm text-muted">Loading…</p>;
  if (state === "forbidden") return <p className="text-sm text-muted">Not available.</p>;
  if (state === "unavailable" || !data) {
    return <p className="text-sm text-danger">The measurement views are not available. Apply migration 090.</p>;
  }

  const weeks = [...new Set([...data.effort, ...data.loggers].map((r) => r.week_start))].sort();
  const gym = data.effort.filter((r) => r.domain === "gym");
  const cardio = data.effort.filter((r) => r.domain === "cardio");

  // 1. Fields touched per saved gym session, by door.
  const fieldsRows = gym
    .filter((r) => r.measured > 0)
    .map((r) => [r.week_start, ENTRY_LABEL[r.entry] ?? r.entry, r.measured, n(r.median_fields_touched), n(r.median_seconds_to_save)]);

  // 2. Seconds to save per cardio session, by door.
  const secondsRows = cardio
    .filter((r) => r.measured > 0)
    .map((r) => [r.week_start, ENTRY_LABEL[r.entry] ?? r.entry, r.measured, n(r.median_seconds_to_save), n(r.median_fields_touched)]);

  // 3. Share of cardio sessions by source.
  const shareRows = weeks.map((w) => {
    const rows = cardio.filter((r) => r.week_start === w);
    const total = rows.reduce((s, r) => s + r.activities, 0);
    const by = (src: string) => rows.filter((r) => r.source === src).reduce((s, r) => s + r.activities, 0);
    return [w, total, pct(by("apple_health"), total), pct(by("gps"), total), pct(by("file"), total), pct(by("manual"), total)];
  });

  // 4. Recovery inputs.
  const recoveryRows = data.recovery.map((r) => [
    r.week_start,
    r.hrv_source,
    r.hrv_days,
    r.hrv_athletes,
    r.resting_hr_days,
    r.sleep_nights,
  ]);

  // 5. Prescribed sets accepted vs edited.
  const prescribedRows = weeks
    .map((w) => {
      const rows = gym.filter((r) => r.week_start === w);
      const accepted = rows.reduce((s, r) => s + r.prescribed_sets_accepted, 0);
      const edited = rows.reduce((s, r) => s + r.prescribed_sets_edited, 0);
      return accepted + edited > 0 ? [w, accepted, edited, pct(accepted, accepted + edited)] : null;
    })
    .filter((r): r is (string | number)[] => r !== null);

  // 6. Weekly active loggers.
  const loggerRows = data.loggers.map((r) => [
    r.week_start,
    r.loggers,
    r.gym_loggers,
    r.cardio_loggers,
    r.recorded_or_imported_loggers,
    r.activities,
  ]);

  const t = data.targets;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Last {data.windowDays} days, from {data.since}. Weeks start on Monday. Sessions saved before the
        measurement shipped count in totals but carry no median.
      </p>
      <Table
        caption={`Gym: fields filled by hand per session. Target under ${t.gymFieldsTouched.target}; typed from nothing was about ${t.gymFieldsTouched.typedBaseline}.`}
        head={["Week", "Door", "Measured", "Median fields", "Median seconds"]}
        rows={fieldsRows}
      />
      <Table
        caption={`Cardio: seconds from open to save per session. Target under ${t.cardioSecondsToSave.target} s for an import.`}
        head={["Week", "Door", "Measured", "Median seconds", "Median fields"]}
        rows={secondsRows}
      />
      <Table
        caption={`Cardio sessions by source. Target: over ${Math.round(t.appleHealthShare.target * 100)}% Apple Health within a month of phase 1 reaching phones.`}
        head={["Week", "Sessions", "Apple Health", "GPS", "File", "Typed"]}
        rows={shareRows}
      />
      <Table
        caption="Recovery inputs on the day rows. Target: HRV from near zero to daily for watch users."
        head={["Week", "HRV source", "HRV days", "Athletes with HRV", "Resting HR days", "Sleep nights"]}
        rows={recoveryRows}
      />
      <Table
        caption={`Prescribed sets logged untouched vs edited. Target: over ${Math.round(t.prescribedAccepted.target * 100)}% accepted on plan days.`}
        head={["Week", "Accepted", "Edited", "Accepted share"]}
        rows={prescribedRows}
      />
      <Table
        caption={`Weekly active loggers. ${t.weeklyActiveLoggers.note}.`}
        head={["Week", "Loggers", "Gym", "Cardio", "Recorded or imported", "Sessions"]}
        rows={loggerRows}
      />
    </div>
  );
}
