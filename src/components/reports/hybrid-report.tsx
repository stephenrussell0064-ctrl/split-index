import Link from "next/link";
import { format } from "date-fns";
import {
  Activity,
  ArrowRight,
  CalendarCheck,
  Dumbbell,
  Flag,
  HeartPulse,
  Lightbulb,
  Lock,
  Radar,
  Scale,
  Trophy,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { CollapsibleSection, SummaryPills } from "@/components/ui/collapsible-section";
import { PremiumTease } from "@/components/premium/premium-tease";
import { ShareImageButton } from "@/components/analytics/share-image-button";
import { ScoreDisclaimer } from "@/components/legal/score-disclaimer";
import { SPORTS } from "@/lib/constants/sports";
import { cn } from "@/lib/utils/cn";
import { formatDistance, formatDuration, formatIndex, formatTrend } from "@/lib/utils/format";
import { formatRiegelPrediction } from "@/lib/scoring/presentation";
import { formatDOTS, formatGL } from "@/lib/utils/scoring-display";
import type { FullHybridReport, ScoreLine } from "@/lib/scoring/hybrid-report-full";
import type { DirectionVerdict, InterferenceVerdict } from "@/lib/scoring/interference-advice";
import type { PersonalRecord } from "@/types";

/**
 * The Hybrid Athlete Report, rendered.
 *
 * Nine sections, in the order a coach reads: where you stand, what I would
 * say first, how your time split, how consistent you were, strength,
 * endurance, recovery and load, how the two sides interact, records. Every
 * number has a word beside it saying what it is, and every section opens
 * with one line saying what it is for — the report is meant to be handed to
 * someone who has never opened the app.
 *
 * A server component: it has no state of its own. The two client pieces it
 * renders — the collapsible lift list and the share button — bring their own.
 */

const VERDICT_PILL: Record<InterferenceVerdict, string> = {
  learning: "bg-white/[0.06] text-muted",
  none: "bg-success/15 text-success",
  helps: "bg-success/15 text-success",
  small: "bg-warning/15 text-warning",
  real: "bg-danger/15 text-danger",
};

function Section({
  id,
  icon,
  title,
  intro,
  action,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  intro: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} padding="md" className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {icon}
            {title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">{intro}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "neutral" | "accent" | "endurance" | "strength" | "success" | "warning" | "danger";
  size?: "md" | "lg";
}) {
  const color = {
    neutral: "text-foreground",
    accent: "text-accent",
    endurance: "text-endurance",
    strength: "text-strength",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  }[tone];
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="micro-label text-muted">{label}</p>
      <p className={cn("index-display mt-1 font-bold tabular-nums", size === "lg" ? "text-4xl" : "text-2xl", color)}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] leading-snug text-muted">{sub}</p>}
    </div>
  );
}

/** "+2.4 over the period" in green, "−1.1" in red, "no change" in grey. */
function Change({ line, suffix = "over the period" }: { line: ScoreLine; suffix?: string }) {
  if (line.delta === null) return <span>No earlier reading to compare with</span>;
  if (line.delta === 0) return <span>No change {suffix}</span>;
  return (
    <span className={cn("font-medium", line.delta > 0 ? "text-success" : "text-danger")}>
      {formatTrend(line.delta)} {suffix}
    </span>
  );
}

function hoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function clock(seconds: number): string {
  return formatRiegelPrediction(seconds);
}

function pace(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

function sportName(sport: string): string {
  return SPORTS.find((s) => s.id === sport)?.name ?? sport.replace(/_/g, " ");
}

function recordValue(pr: PersonalRecord): string {
  if (pr.unit === "seconds") return formatDuration(pr.value);
  if (pr.unit === "meters") return formatDistance(pr.value);
  return `${pr.value.toLocaleString()} ${pr.unit}`;
}

function VerdictRow({ icon, question, verdict }: { icon: React.ReactNode; question: string; verdict: DirectionVerdict }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {question}
        </p>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider", VERDICT_PILL[verdict.verdict])}>
          {verdict.deltaPct !== null && verdict.verdict !== "learning"
            ? `${verdict.label} · ${verdict.deltaPct > 0 ? "+" : ""}${verdict.deltaPct}%`
            : verdict.label}
        </span>
      </div>
      <p className="mt-2 text-sm leading-snug text-foreground/90">{verdict.sentence}</p>
      <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
        <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden />
        {verdict.advice}
      </p>
    </div>
  );
}

function ReportBody({ report, hasStoredReport }: { report: FullHybridReport; hasStoredReport: boolean }) {
  const { headline, balance, consistency, strength, endurance, recovery, interference } = report;
  const nothingYet = balance.sessions === 0 && headline.split.now === null;
  const strengthPct = balance.strengthShare === null ? null : Math.round(balance.strengthShare * 100);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Last {report.periodDays} days · {format(new Date(report.periodStart), "d MMM")} –{" "}
          {format(new Date(report.generatedAt), "d MMM yyyy")} · rebuilt every visit
        </p>
        {hasStoredReport && (
          <ShareImageButton
            href="/api/reports/hybrid/card"
            filename="hybrid-athlete-report.png"
            shareTitle="My Split Index Hybrid Athlete Report"
            shareText="My hybrid training, tracked with Split Index."
            contentSummary="Your display name, your Split Index for this period, your interference finding and your target pace. No readiness, recovery or health answers."
          />
        )}
      </div>

      {nothingYet && (
        <Card padding="md" className="border-accent/20 bg-accent/[0.04]">
          <p className="text-sm font-medium">Nothing to report yet</p>
          <p className="mt-1 text-xs text-muted">
            Every section below fills in from the sessions you log. Log your first gym session and
            your first run, ride, row or swim and come back.
          </p>
          <Link href="/activities/new" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent">
            Log a workout <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Card>
      )}

      {/* 1 ── Where you stand */}
      <Section
        id="standing"
        icon={<Scale className="h-4 w-4 text-accent" aria-hidden />}
        title="Where you stand"
        intro="Your three scores, all out of 100, and how each moved over the period. The Split Index is strength and endurance combined."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label={headline.tier ? `Split Index · ${headline.tier}` : "Split Index"}
            value={headline.split.now === null ? "TBC" : formatIndex(headline.split.now)}
            sub={<Change line={headline.split} />}
            tone="accent"
            size="lg"
          />
          <Stat
            label="Endurance · The Engine"
            value={headline.endurance.now === null ? "TBC" : formatIndex(headline.endurance.now)}
            sub={<Change line={headline.endurance} />}
            tone="endurance"
          />
          <Stat
            label="Strength · The Lab"
            value={headline.strength.now === null ? "TBC" : formatIndex(headline.strength.now)}
            sub={<Change line={headline.strength} />}
            tone="strength"
          />
        </div>
        {headline.bestEver && headline.split.now !== null && (
          <p className="mt-3 text-xs text-muted">
            {headline.atBestNow
              ? "This is your best-ever Split Index."
              : `Best ever: ${formatIndex(headline.bestEver.value)} on ${format(new Date(headline.bestEver.at), "d MMM yyyy")}.`}
            {headline.weakerSide === "balanced" && " Your two sides are within a point or two of each other."}
            {headline.weakerSide === "endurance" && " Endurance is the lower of your two sides."}
            {headline.weakerSide === "strength" && " Strength is the lower of your two sides."}
          </p>
        )}
      </Section>

      {/* 2 ── Coach's notes */}
      {report.notes.length > 0 && (
        <Section
          id="notes"
          icon={<Lightbulb className="h-4 w-4 text-warning" aria-hidden />}
          title="What a coach would say first"
          intro="Written from the numbers in this report. Each line points at something in the sections below."
        >
          <ol className="space-y-2">
            {report.notes.map((note, i) => (
              <li key={i} className="flex items-start gap-3 text-sm leading-snug text-foreground/90">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
                  {i + 1}
                </span>
                {note}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* 3 ── Balance */}
      <Section
        id="balance"
        icon={<Activity className="h-4 w-4 text-accent" aria-hidden />}
        title="How your training split"
        intro="Where your time went. A hybrid athlete's numbers only move together when both halves get worked."
      >
        {strengthPct !== null ? (
          <>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-strength">Strength {strengthPct}%</span>
              <span className="font-medium text-endurance">Endurance {100 - strengthPct}%</span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
              <div className="h-full bg-strength" style={{ width: `${strengthPct}%` }} />
              <div className="h-full bg-endurance" style={{ width: `${100 - strengthPct}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-muted">By time spent training, over the period.</p>
          </>
        ) : (
          <p className="text-sm text-muted">No sessions logged in the period.</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Sessions" value={balance.sessions} sub={`${balance.strengthSessions} gym · ${balance.cardioSessions} endurance`} />
          <Stat
            label="Time training"
            value={hoursMinutes(balance.strengthMinutes + balance.cardioMinutes)}
            sub={`${hoursMinutes(balance.strengthMinutes)} gym · ${hoursMinutes(balance.cardioMinutes)} endurance`}
          />
          <Stat label="Distance" value={`${balance.distanceKm} km`} sub="Across every endurance session" />
          <Stat
            label="Training load"
            value={balance.totalLoad}
            sub={`${balance.strengthLoad} from gym · ${balance.cardioLoad} from endurance`}
          />
        </div>

        {balance.bySport.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-3 font-medium">Sport</th>
                  <th className="pb-2 pr-3 text-right font-medium">Sessions</th>
                  <th className="pb-2 pr-3 text-right font-medium">Time</th>
                  <th className="pb-2 pr-3 text-right font-medium">Distance</th>
                  <th className="pb-2 text-right font-medium">Avg score</th>
                </tr>
              </thead>
              <tbody>
                {balance.bySport.map((s) => (
                  <tr key={s.sport} className="border-b border-white/[0.03] last:border-0">
                    <td className="py-2 pr-3">{s.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.sessions}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">{hoursMinutes(s.minutes)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">{s.distanceKm > 0 ? `${s.distanceKm} km` : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{s.avgIndex === null ? "—" : formatIndex(s.avgIndex)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 4 ── Consistency */}
      <Section
        id="consistency"
        icon={<CalendarCheck className="h-4 w-4 text-accent" aria-hidden />}
        title="Consistency"
        intro={`Against a target of ${consistency.targetPerWeek} sessions a week. Showing up is what moves every other number here.`}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Sessions a week"
            value={consistency.sessionsPerWeek}
            sub={`Target ${consistency.targetPerWeek}`}
            tone={consistency.sessionsPerWeek >= consistency.targetPerWeek ? "success" : "neutral"}
          />
          <Stat
            label="Weeks on target"
            value={`${consistency.weeksHit} of ${consistency.weeksCounted}`}
            sub={`Hit ${consistency.targetPerWeek}+ sessions`}
            tone={consistency.weeksHit === consistency.weeksCounted && consistency.weeksCounted > 0 ? "success" : "neutral"}
          />
          <Stat
            label="Current streak"
            value={consistency.streak}
            sub={consistency.streak === 1 ? "day in a row" : "days in a row"}
          />
          <Stat
            label="Longest break"
            value={consistency.longestGapDays === null ? "—" : `${consistency.longestGapDays}d`}
            sub="Days between sessions"
            tone={consistency.longestGapDays !== null && consistency.longestGapDays >= 7 ? "warning" : "neutral"}
          />
        </div>
        {consistency.weekly.length > 0 && (
          <div className="mt-4">
            <p className="micro-label mb-2 text-muted">Sessions per week, oldest first</p>
            <div className="flex items-end gap-1.5" aria-hidden>
              {consistency.weekly.map((n, i) => {
                const max = Math.max(consistency.targetPerWeek, ...consistency.weekly, 1);
                return (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-16 w-full items-end rounded-md bg-white/[0.04]">
                      <div
                        className={cn("w-full rounded-md", n >= consistency.targetPerWeek ? "bg-success" : "bg-accent/60")}
                        style={{ height: `${Math.round((n / max) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums text-muted">{n}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* 5 ── Strength */}
      <Section
        id="strength"
        icon={<Dumbbell className="h-4 w-4 text-strength" aria-hidden />}
        title="Strength"
        intro="Your best-ever squat, bench and deadlift, what recent training says you could lift today, and how that compares with lifters of your bodyweight."
      >
        {strength.sbd && strength.liftsLogged > 0 ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Squat" value={strength.sbd.squat > 0 ? `${strength.sbd.squat.toFixed(1)} kg` : "—"} sub="Best ever" tone="strength" />
            <Stat label="Bench" value={strength.sbd.bench > 0 ? `${strength.sbd.bench.toFixed(1)} kg` : "—"} sub="Best ever" tone="strength" />
            <Stat label="Deadlift" value={strength.sbd.deadlift > 0 ? `${strength.sbd.deadlift.toFixed(1)} kg` : "—"} sub="Best ever" tone="strength" />
            <Stat
              label="Total"
              value={strength.total === null ? "—" : `${strength.total.toFixed(0)} kg`}
              sub={`${strength.liftsLogged} of 3 lifts logged`}
              tone="strength"
            />
          </div>
        ) : (
          <p className="text-sm text-muted">Log a gym session with a squat, bench or deadlift to fill this in.</p>
        )}

        {strength.sbd && strength.liftsLogged > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {strength.dotsLocked ? (
              <div className="col-span-2 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-muted">
                <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                DOTS and IPF GL — your total adjusted for bodyweight, so it compares fairly with any lifter — are part of Premium.
              </div>
            ) : (
              <>
                <Stat label="DOTS" value={strength.dots === null ? "—" : formatDOTS(strength.dots)} sub="Bodyweight-adjusted total" />
                <Stat label="IPF GL" value={strength.gl === null ? "—" : formatGL(strength.gl)} sub="Same idea, IPF's formula" />
              </>
            )}
          </div>
        )}

        {strength.lifts.length > 0 && (
          <CollapsibleSection
            className="mt-4"
            title="Every lift"
            count={`${strength.lifts.length} lift${strength.lifts.length === 1 ? "" : "s"}`}
            description={`What you could lift today against your best ever. ${strength.rising} rising, ${strength.falling} falling.`}
            summary={
              <SummaryPills
                items={strength.lifts.slice(0, 3).map((l) => ({ label: l.exerciseName, value: `${l.current1RmKg.toFixed(1)} kg` }))}
                more={Math.max(0, strength.lifts.length - 3)}
              />
            }
          >
            <ul className="divide-y divide-white/[0.04]">
              {strength.lifts.map((l) => {
                const best = Math.max(l.allTime1RmKg, l.current1RmKg);
                const pct = best > 0 ? Math.round((l.current1RmKg / best) * 100) : null;
                return (
                  <li key={l.exerciseName} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{l.exerciseName}</span>
                    <span
                      className={cn(
                        "shrink-0 text-[11px] font-medium",
                        l.trend === "up" ? "text-success" : l.trend === "down" ? "text-danger" : "text-muted"
                      )}
                    >
                      {l.trend === "up" ? "rising" : l.trend === "down" ? "falling" : "steady"}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted">best {best.toFixed(1)}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {l.current1RmKg.toFixed(1)} kg
                      {pct !== null && pct < 100 && <span className="ml-1 text-[11px] font-normal text-muted">({pct}%)</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CollapsibleSection>
        )}
      </Section>

      {/* 6 ── Endurance */}
      <Section
        id="endurance"
        icon={<Flag className="h-4 w-4 text-endurance" aria-hidden />}
        title="Endurance"
        intro="What the app predicts you could do right now, and the best you have actually done."
      >
        {endurance.benchmarks.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {endurance.benchmarks.map((b) => (
              <Stat
                key={b.sport}
                label={`Predicted ${b.label}`}
                value={b.seconds === null ? "Calibrating" : b.sport === "walk" ? `${clock(b.seconds)}/km` : clock(b.seconds)}
                sub={
                  b.calibrating
                    ? `${b.sampleCount} of ${b.samplesNeeded} sessions needed`
                    : `From ${b.sampleCount} session${b.sampleCount === 1 ? "" : "s"}`
                }
                tone="endurance"
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Log a few runs, rides, rows or swims and predictions appear here.</p>
        )}

        {endurance.runLadder.length > 0 && (
          <div className="mt-4">
            <p className="micro-label mb-2 text-muted">Predicted race times, from your running</p>
            <SummaryPills items={endurance.runLadder.map((r) => ({ label: r.label, value: clock(r.seconds) }))} />
          </div>
        )}

        {endurance.raceRecords.length > 0 && (
          <div className="mt-4">
            <p className="micro-label mb-2 text-muted">Your actual bests</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {endurance.raceRecords.map((r) => (
                <Stat
                  key={r.label}
                  label={r.label}
                  value={clock(r.bestSeconds)}
                  sub={`${format(new Date(r.achievedAt), "d MMM yyyy")}${r.isRace ? " · race" : ""}`}
                />
              ))}
            </div>
          </div>
        )}

        {(endurance.vo2max !== null || endurance.lactateThreshold) && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {endurance.vo2max !== null && (
              <Stat label="Estimated VO₂max" value={endurance.vo2max} sub="ml/kg/min, from your race-pace efforts" />
            )}
            {endurance.lactateThreshold && (
              <Stat
                label="Lactate threshold"
                value={`${endurance.lactateThreshold.hrBpm} bpm`}
                sub={`About ${pace(endurance.lactateThreshold.paceSecondsPerKm)} when ${sportName(endurance.lactateThreshold.sport).toLowerCase()}`}
              />
            )}
          </div>
        )}
      </Section>

      {/* 7 ── Recovery & load */}
      <Section
        id="recovery"
        icon={<HeartPulse className="h-4 w-4 text-accent" aria-hidden />}
        title="Recovery and training load"
        intro="How ready you are to train hard right now, and whether the last week's load is a spike or your normal."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label={recovery.band ? `Recovery · ${recovery.band}` : "Recovery"}
            value={recovery.score === null ? "—" : recovery.score}
            sub={recovery.headline ?? "Log a session to start this"}
            tone={recovery.score === null ? "neutral" : recovery.score >= 70 ? "success" : recovery.score >= 50 ? "warning" : "danger"}
          />
          <Stat
            label="Readiness"
            value={recovery.readiness === null ? "—" : recovery.readiness}
            sub="From training load alone, out of 100"
          />
          <Stat
            label="This week's load"
            value={recovery.weekLoad}
            sub={`Your 4-week average is ${recovery.avgWeekLoad}`}
            tone={recovery.avgWeekLoad > 0 && recovery.weekLoad > recovery.avgWeekLoad * 1.3 ? "warning" : "neutral"}
          />
          {recovery.injuryHidden ? (
            <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="micro-label text-muted">Injury risk</p>
              <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-muted">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                Needs your permission to read your health data. Turn it on from Analytics.
              </p>
            </div>
          ) : (
            <Stat
              label="Injury risk"
              value={recovery.injury ? recovery.injury.zone : "—"}
              sub={recovery.acwr === null ? "Needs recent sessions" : `Load ratio ${recovery.acwr} — 0.8 to 1.3 is the safe band`}
              tone={
                !recovery.injury
                  ? "neutral"
                  : recovery.injury.zone === "Optimal"
                    ? "success"
                    : recovery.injury.zone === "Caution"
                      ? "warning"
                      : recovery.injury.zone === "Danger"
                        ? "danger"
                        : "neutral"
              }
            />
          )}
        </div>
        {recovery.hrvToday !== null && (
          <p className="mt-3 text-xs text-muted">
            Heart-rate variability: {Math.round(recovery.hrvToday)} ms today
            {recovery.hrvBaseline !== null && ` against your ${recovery.hrvBaseline} ms baseline`}.
          </p>
        )}
        {recovery.thin && recovery.score !== null && (
          <p className="mt-3 text-xs text-muted">
            This recovery score uses training load only. Log a morning HRV reading on the Recovery page and it gets sharper.
          </p>
        )}
      </Section>

      {/* 8 ── Interference */}
      <Section
        id="interference"
        icon={<Radar className="h-4 w-4 text-accent" aria-hidden />}
        title="How your two sides affect each other"
        intro="Whether lifting is costing you endurance, and whether endurance is costing you strength — from your own paired sessions."
        action={
          <Link href="/interference" className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-accent">
            Full breakdown <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <VerdictRow
            icon={<Dumbbell className="h-4 w-4 text-strength" aria-hidden />}
            question="Does lifting slow your cardio?"
            verdict={interference.strengthToCardio}
          />
          <VerdictRow
            icon={<HeartPulse className="h-4 w-4 text-endurance" aria-hidden />}
            question="Does cardio weaken your lifting?"
            verdict={interference.cardioToStrength}
          />
        </div>
      </Section>

      {/* 9 ── Records */}
      <Section
        id="records"
        icon={<Trophy className="h-4 w-4 text-warning" aria-hidden />}
        title="Records set in the period"
        intro="Personal bests the app logged while you trained."
      >
        {report.recordsThisPeriod.length === 0 ? (
          <p className="text-sm text-muted">No new records in the last {report.periodDays} days.</p>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {report.recordsThisPeriod.map((pr) => (
              <li key={pr.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{sportName(pr.sport)}</span>
                  <span className="text-muted"> · {pr.metric.replace(/_/g, " ")}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">{format(new Date(pr.achieved_at), "d MMM")}</span>
                <span className="shrink-0 font-semibold tabular-nums text-accent">{recordValue(pr)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ScoreDisclaimer />
    </div>
  );
}

export function HybridReport({
  report,
  isPremium,
  hasStoredReport,
}: {
  report: FullHybridReport | null;
  isPremium: boolean;
  hasStoredReport: boolean;
}) {
  if (!isPremium || !report) {
    return (
      <PremiumTease
        title="Your Hybrid Athlete Report"
        subtitle="Scores and how they moved, your strength-to-endurance split, consistency, best lifts, predicted race times, recovery, and how each side of your training affects the other — in one document. Unlock with Premium."
        minHeight={320}
      />
    );
  }
  return <ReportBody report={report} hasStoredReport={hasStoredReport} />;
}
