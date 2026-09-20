"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "framer-motion";
import { Activity, HeartPulse, Mountain, Timer, Trophy } from "lucide-react";
import { chartGridStroke, chartTickFill, chartTooltipStyle } from "@/components/analytics/charts";
import { designTokens } from "@/lib/design/tokens";
import type { BestEffort } from "@/lib/analysis/best-efforts";
import type { HrZone, HrZoneModel } from "@/lib/analysis/heart-rate";
import type { BestEffortStanding } from "@/lib/analysis/records";
import type { RunAnalysis } from "@/lib/analysis/run-analysis";
import type { Split } from "@/lib/analysis/splits";
import { sportVocabulary, isSpeedBased } from "@/lib/analysis/vocabulary";
import { cn } from "@/lib/utils/cn";

/**
 * The run-analysis panel: what Strava, Garmin and the rest show under a run
 * and this app could not — because until activity streams existed (migration
 * 078, lib/analysis) nothing per-sample survived the save.
 *
 * Everything here is rendered from one precomputed RunAnalysis object. No
 * maths in the component: the server computed it once from the stored
 * streams, and only for an athlete entitled to see it, so a free account's
 * page never carries these numbers in its payload (see PremiumGate on why a
 * hidden number is not a gated one).
 */
export interface RunAnalysisPanelProps {
  analysis: RunAnalysis;
  /** How this run's best efforts rank against the athlete's history; empty when unknown. */
  standings: BestEffortStanding[];
}

const HR_COLOR = "#f87171";
const ELEVATION_COLOR = designTokens.slate[400];
/** Zone 0 (below zone 1) through zone 5. */
const ZONE_COLORS = ["#64748b", "#60a5fa", "#34d399", "#fbbf24", "#fb923c", "#f87171"] as const;

/** m:ss, or h:mm:ss past an hour — the clock a split or an effort is quoted on. */
function clock(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function paceLabel(secondsPerKm: number, unit: "km" | "mi"): string {
  const perUnit = unit === "mi" ? secondsPerKm * 1.609344 : secondsPerKm;
  return `${clock(perUnit)}/${unit}`;
}

function signedSeconds(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return "±0s";
  return `${rounded > 0 ? "+" : "−"}${clock(Math.abs(rounded))}`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  return `${n}${rem10 === 1 ? "st" : rem10 === 2 ? "nd" : rem10 === 3 ? "rd" : "th"}`;
}

export function RunAnalysisPanel({ analysis, standings }: RunAnalysisPanelProps) {
  const hasAnything =
    analysis.splitsKm.length > 0 ||
    analysis.bestEfforts.length > 0 ||
    analysis.heartRate !== null ||
    analysis.elevation !== null;
  if (!hasAnything) return null;

  // A walk is not a run and a ride is not a run. The analysis always covered
  // every GPS sport; only the words were running-only.
  const words = sportVocabulary(analysis.sport);

  return (
    <section
      className="rounded-2xl border border-cardio-border/40 bg-cardio-bg-elevated/10 p-5 mb-6"
      aria-label={`${words.Noun} analysis`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="micro-label text-muted">{words.Noun} analysis</p>
        <span className="rounded-full border border-cardio-border/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cardio-accent-text">
          Premium
        </span>
      </div>

      <div className="space-y-6">
        {analysis.bestEfforts.length > 0 && (
          <BestEffortsSection efforts={analysis.bestEfforts} standings={standings} sport={analysis.sport} />
        )}
        {analysis.splitsKm.length > 0 && <SplitsSection analysis={analysis} />}
        <PaceChart analysis={analysis} />
        {analysis.heartRate && <HeartRateSection analysis={analysis} />}
        {analysis.elevation && <ElevationSection analysis={analysis} />}
      </div>
    </section>
  );
}

/* ── Best efforts ───────────────────────────────────────────────────────── */

function standingFor(effort: BestEffort, standings: BestEffortStanding[]): BestEffortStanding | null {
  return standings.find((s) => s.distanceMeters === effort.distanceMeters) ?? null;
}

function StandingBadge({ standing }: { standing: BestEffortStanding }) {
  if (standing.rank === 1) {
    const beatBy =
      standing.previousBestElapsedSeconds !== null
        ? standing.previousBestElapsedSeconds - standing.elapsedSeconds
        : null;
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-strength-accent/15 px-2 py-0.5 text-[11px] font-semibold text-strength-accent">
        <Trophy className="h-3 w-3" aria-hidden />
        {standing.attempts === 1 ? "First at this distance" : "Personal best"}
        {beatBy !== null && beatBy > 0 && (
          <span className="font-normal text-strength-accent/80"> · {clock(beatBy)} faster</span>
        )}
      </span>
    );
  }
  const behind = standing.elapsedSeconds - standing.bestElapsedSeconds;
  return (
    <span className="text-[11px] text-muted">
      {standing.rank <= 3 ? `${ordinal(standing.rank)} fastest · ` : ""}
      {signedSeconds(behind)} vs best
    </span>
  );
}

function BestEffortsSection({
  efforts,
  standings,
  sport,
}: {
  efforts: BestEffort[];
  standings: BestEffortStanding[];
  sport: RunAnalysis["sport"];
}) {
  const unit = "km";
  const isRide = isSpeedBased(sport);
  return (
    <div>
      <SectionTitle
        icon={Trophy}
        title="Best efforts"
        hint={`fastest stretch of each distance inside this ${sportVocabulary(sport).noun}`}
      />
      <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06]">
        {efforts.map((effort) => {
          const standing = standingFor(effort, standings);
          return (
            <li key={effort.distanceMeters} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{effort.label}</p>
                <p className="text-[11px] text-muted tabular-nums">
                  {isRide
                    ? `${(3600 / effort.paceSecondsPerKm).toFixed(1)} km/h`
                    : paceLabel(effort.paceSecondsPerKm, unit)}
                  {effort.avgHeartRate !== null ? ` · ${effort.avgHeartRate} bpm` : ""}
                  {` · from ${clock(effort.startSeconds)} in`}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className="font-display text-lg font-bold tabular-nums text-cardio-accent">
                  {clock(effort.elapsedSeconds)}
                </p>
                {standing && <StandingBadge standing={standing} />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Splits ─────────────────────────────────────────────────────────────── */

function SplitsSection({ analysis }: { analysis: RunAnalysis }) {
  const [unit, setUnit] = useState<"km" | "mi">("km");
  const splits = unit === "km" ? analysis.splitsKm : analysis.splitsMile;
  const complete = splits.filter((s) => !s.isPartial);
  const paces = complete.map((s) => s.paceSecondsPerKm);
  const fastest = paces.length > 0 ? Math.min(...paces) : null;
  const slowest = paces.length > 0 ? Math.max(...paces) : null;
  const hasHr = splits.some((s) => s.avgHeartRate !== null);
  const hasClimb = splits.some((s) => s.elevationGainMeters !== null);
  const isRide = isSpeedBased(analysis.sport);
  const summary = analysis.pace;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <SectionTitle icon={Timer} title="Splits" />
        <div className="flex rounded-lg border border-white/[0.08] p-0.5" role="group" aria-label="Split distance">
          {(["km", "mi"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              aria-pressed={unit === u}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors",
                unit === u ? "bg-white/[0.08] text-foreground" : "text-muted hover:text-foreground"
              )}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
              <th scope="col" className="py-1.5 pr-2 font-medium">
                {unit === "km" ? "Km" : "Mile"}
              </th>
              <th scope="col" className="py-1.5 pr-2 font-medium">
                {isRide ? "Speed" : "Pace"}
              </th>
              <th scope="col" className="py-1.5 pr-2 text-right font-medium">
                Time
              </th>
              {hasClimb && (
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">
                  Elev
                </th>
              )}
              {hasHr && (
                <th scope="col" className="py-1.5 text-right font-medium">
                  HR
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {splits.map((split) => (
              <SplitRow
                key={split.index}
                split={split}
                unit={unit}
                isRide={isRide}
                fastest={fastest}
                slowest={slowest}
                hasClimb={hasClimb}
                hasHr={hasHr}
              />
            ))}
          </tbody>
        </table>
      </div>

      {summary && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {summary.shape === "negative" && (
            <>
              <span className="font-medium text-strength-accent">Negative split.</span> The second half was{" "}
              {clock(Math.abs(summary.halfDeltaSeconds))} faster than the first.
            </>
          )}
          {summary.shape === "positive" && (
            <>
              <span className="font-medium text-foreground/80">Positive split.</span> The second half was{" "}
              {clock(summary.halfDeltaSeconds)} slower than the first.
            </>
          )}
          {summary.shape === "even" && (
            <>
              <span className="font-medium text-foreground/80">Even split.</span> Both halves within{" "}
              {clock(Math.abs(summary.halfDeltaSeconds))} of each other.
            </>
          )}
          {summary.variabilityPercent !== null && (
            <>
              {" "}
              Pace varied {summary.variabilityPercent}% between kilometres
              {summary.variabilityPercent < 3
                ? " — metronomic."
                : summary.variabilityPercent < 8
                  ? " — steady."
                  : " — surging."}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function SplitRow({
  split,
  unit,
  isRide,
  fastest,
  slowest,
  hasClimb,
  hasHr,
}: {
  split: Split;
  unit: "km" | "mi";
  isRide: boolean;
  fastest: number | null;
  slowest: number | null;
  hasClimb: boolean;
  hasHr: boolean;
}) {
  // Bar length: fastest complete split fills the track, the slowest sits at
  // 40% — a proportional bar would make a 5:00 and a 5:20 look identical.
  const range = fastest !== null && slowest !== null ? slowest - fastest : 0;
  const width =
    fastest === null || range === 0 || split.isPartial
      ? 70
      : 40 + 60 * (1 - (split.paceSecondsPerKm - fastest) / range);
  const isFastest = !split.isPartial && fastest !== null && split.paceSecondsPerKm === fastest;
  const label = split.isPartial
    ? `${(split.distanceMeters / (unit === "km" ? 1000 : 1609.344)).toFixed(2)}`
    : `${split.index}`;

  return (
    <tr className="border-t border-white/[0.05]">
      <td className="py-2 pr-2 tabular-nums text-muted">{label}</td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-2">
          <div className="relative h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-white/[0.06] sm:w-28" aria-hidden>
            <div
              className={cn("absolute inset-y-0 left-0 rounded-full", isFastest ? "bg-strength-accent" : "bg-cardio-accent")}
              style={{ width: `${width}%`, opacity: split.isPartial ? 0.5 : 1 }}
            />
          </div>
          <span className={cn("tabular-nums", isFastest ? "font-semibold text-strength-accent" : "")}>
            {isRide ? `${(3600 / split.paceSecondsPerKm).toFixed(1)} km/h` : paceLabel(split.paceSecondsPerKm, unit)}
          </span>
        </div>
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">{clock(split.elapsedSeconds)}</td>
      {hasClimb && <SplitElevationCell split={split} />}
      {hasHr && (
        <td className="py-2 text-right tabular-nums text-muted">
          {split.avgHeartRate !== null ? `${split.avgHeartRate}` : "—"}
        </td>
      )}
    </tr>
  );
}

/**
 * Climb and descent for one split. A zero is dropped rather than printed:
 * "+0 −4 m" on a flat kilometre reads as two facts where there is one, and a
 * column of "+0"s is noise. A genuinely flat split shows a dash, which is the
 * same thing the column already says for a split with no altitude at all —
 * correctly, since neither has any climb to report.
 */
function SplitElevationCell({ split }: { split: Split }) {
  const gain = split.elevationGainMeters !== null ? Math.round(split.elevationGainMeters) : null;
  const loss = split.elevationLossMeters !== null ? Math.round(split.elevationLossMeters) : null;
  const parts: React.ReactNode[] = [];
  if (gain !== null && gain > 0) {
    parts.push(
      <span key="gain" className="text-foreground/80">
        +{gain}
      </span>
    );
  }
  if (loss !== null && loss > 0) parts.push(<span key="loss"> −{loss}</span>);

  return (
    <td className="py-2 pr-2 text-right tabular-nums text-muted">
      {parts.length > 0 ? (
        <>
          {parts}
          <span className="text-[10px]"> m</span>
        </>
      ) : (
        "—"
      )}
    </td>
  );
}

/* ── Pace chart ─────────────────────────────────────────────────────────── */

function PaceChart({ analysis }: { analysis: RunAnalysis }) {
  const reducedMotion = useReducedMotion();
  const data = analysis.chart.filter((p) => p.paceSecondsPerKm !== null);
  if (data.length < 5) return null;
  const words = sportVocabulary(analysis.sport);
  const isRide = isSpeedBased(analysis.sport);
  const series = isRide
    ? data.map((p) => ({ ...p, value: Math.round((3600 / (p.paceSecondsPerKm as number)) * 10) / 10 }))
    : data.map((p) => ({ ...p, value: p.paceSecondsPerKm as number }));

  return (
    <div>
      <SectionTitle icon={Activity} title={words.rateLabel} hint="over distance" />
      <div role="img" aria-label={`${words.rateLabel} over the ${words.noun}`}>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 6" stroke={chartGridStroke} />
            <XAxis
              dataKey="distanceKm"
              type="number"
              domain={[0, "dataMax"]}
              tickFormatter={(v) => `${v}`}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: chartTickFill }}
              minTickGap={24}
              unit=" km"
            />
            <YAxis
              // Faster is up: a pace axis reads the wrong way round otherwise.
              reversed={!isRide}
              domain={["auto", "auto"]}
              tickFormatter={(v) => (isRide ? `${v}` : clock(Number(v)))}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: chartTickFill }}
              width={48}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              labelFormatter={(v) => `${Number(v).toFixed(2)} km`}
              formatter={(value) => [isRide ? `${value} km/h` : paceLabel(Number(value), "km"), isRide ? "Speed" : "Pace"]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={designTokens.cardioAccentStrong}
              strokeWidth={2}
              dot={false}
              isAnimationActive={!reducedMotion}
              animationDuration={800}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Heart rate ─────────────────────────────────────────────────────────── */

function HeartRateSection({ analysis }: { analysis: RunAnalysis }) {
  const reducedMotion = useReducedMotion();
  const hr = analysis.heartRate!;
  const data = analysis.chart.filter((p) => p.heartRate !== null);
  const zones = hr.zones;

  return (
    <div>
      <SectionTitle icon={HeartPulse} title="Heart rate" hint={`avg ${hr.avgBpm} · max ${hr.maxBpm} bpm`} />

      {data.length >= 5 && (
        <div role="img" aria-label={`Heart rate over the ${sportVocabulary(analysis.sport).noun}`}>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="runHrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={HR_COLOR} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={HR_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              {zones &&
                zones
                  .filter((z) => z.zone >= 1)
                  .map((z) => (
                    <ReferenceArea
                      key={z.zone}
                      y1={z.minBpm}
                      y2={z.maxBpm ?? Math.max(hr.maxBpm + 5, z.minBpm + 10)}
                      fill={ZONE_COLORS[z.zone]}
                      fillOpacity={0.05}
                      ifOverflow="hidden"
                    />
                  ))}
              <CartesianGrid vertical={false} strokeDasharray="3 6" stroke={chartGridStroke} />
              <XAxis
                dataKey="distanceKm"
                type="number"
                domain={[0, "dataMax"]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: chartTickFill }}
                minTickGap={24}
                unit=" km"
              />
              <YAxis
                domain={["auto", "auto"]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: chartTickFill }}
                width={40}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelFormatter={(v) => `${Number(v).toFixed(2)} km`}
                formatter={(value) => [`${value} bpm`, "Heart rate"]}
              />
              <Area
                type="monotone"
                dataKey="heartRate"
                stroke={HR_COLOR}
                strokeWidth={2}
                fill="url(#runHrGrad)"
                isAnimationActive={!reducedMotion}
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {zones ? (
        <ZoneBreakdown zones={zones} model={hr.zoneModel} />
      ) : (
        <p className="mt-2 text-xs text-muted">
          Add your max heart rate in your profile to see time in each zone.
        </p>
      )}

      {hr.driftPercent !== null && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          <span className="font-medium text-foreground/80">
            Heart-rate drift {hr.driftPercent > 0 ? "+" : ""}
            {hr.driftPercent}%.
          </span>{" "}
          {hr.driftPercent < 5
            ? "Your heart rate held steady for the pace — an aerobically comfortable effort at this distance."
            : hr.driftPercent < 10
              ? "Your heart rate climbed for the same pace over the second half: some fatigue, heat or dehydration setting in."
              : "Your heart rate rose sharply for the same pace — this effort was harder than your aerobic base could hold for the distance."}
        </p>
      )}
    </div>
  );
}

function ZoneBreakdown({ zones, model }: { zones: HrZone[]; model: HrZoneModel | null }) {
  const shown = zones.filter((z) => z.seconds > 0);
  if (shown.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label="Time in heart-rate zones">
        {shown.map((z) => (
          <div
            key={z.zone}
            style={{ width: `${Math.max(1, z.fraction * 100)}%`, background: ZONE_COLORS[z.zone] }}
            title={`${z.label}: ${clock(z.seconds)}`}
          />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {zones.map((z) => (
          <li key={z.zone} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ZONE_COLORS[z.zone] }} aria-hidden />
              {z.label}
              <span className="text-[10px] text-muted/70">
                {z.zone === 0 ? `<${zones[1]?.minBpm ?? ""}` : `${z.minBpm}${z.maxBpm !== null ? `–${z.maxBpm}` : "+"}`}
              </span>
            </span>
            <span className="tabular-nums">
              {clock(z.seconds)}
              <span className="text-muted/70"> · {Math.round(z.fraction * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10px] text-muted/70">
        {model === "reserve" ? "Zones from your resting and max heart rate (heart-rate reserve)." : "Zones as a percentage of your max heart rate."}
      </p>
    </div>
  );
}

/* ── Elevation ──────────────────────────────────────────────────────────── */

function ElevationSection({ analysis }: { analysis: RunAnalysis }) {
  const reducedMotion = useReducedMotion();
  const elevation = analysis.elevation!;
  const data = analysis.chart.filter((p) => p.altitude !== null);
  const tiles = [
    { label: "Gain", value: `${Math.round(elevation.gainMeters)} m` },
    { label: "Loss", value: `${Math.round(elevation.lossMeters)} m` },
    { label: "Highest", value: `${elevation.maxAltitudeMeters} m` },
    elevation.steepestGradePercent !== null
      ? { label: "Steepest 500m", value: `${elevation.steepestGradePercent}%` }
      : null,
  ].filter((t): t is { label: string; value: string } => t !== null);

  return (
    <div>
      <SectionTitle icon={Mountain} title="Elevation" />
      {data.length >= 5 && (
        <div role="img" aria-label="Elevation profile">
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="runElevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ELEVATION_COLOR} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={ELEVATION_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 6" stroke={chartGridStroke} />
              <XAxis
                dataKey="distanceKm"
                type="number"
                domain={[0, "dataMax"]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: chartTickFill }}
                minTickGap={24}
                unit=" km"
              />
              <YAxis
                domain={["auto", "auto"]}
                // Formatted rather than `unit="m"`: the unit is appended after
                // the axis has sized itself, so a three-digit altitude plus
                // "m" overflowed a 40px axis and the labels rendered clipped.
                tickFormatter={(v) => `${Math.round(Number(v))}m`}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: chartTickFill }}
                width={52}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelFormatter={(v) => `${Number(v).toFixed(2)} km`}
                formatter={(value) => [`${Math.round(Number(value))} m`, "Altitude"]}
              />
              <Area
                type="monotone"
                dataKey="altitude"
                stroke={ELEVATION_COLOR}
                strokeWidth={1.5}
                fill="url(#runElevGrad)"
                isAnimationActive={!reducedMotion}
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-center">
            <p className="micro-label text-muted/70">{t.label}</p>
            <p className="text-base font-bold tabular-nums text-foreground/90">{t.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Shared ─────────────────────────────────────────────────────────────── */

function SectionTitle({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Timer;
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <Icon className="h-3.5 w-3.5 translate-y-0.5 text-cardio-accent-text" aria-hidden />
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  );
}
