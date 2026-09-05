"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { LIFT_RATIO_NORM } from "@/lib/scoring/hpe";
import type { AthleteProfile, EmphasisKey } from "@/lib/scoring/hpe";

/**
 * WP9 — the diagnostic report screen.
 *
 * The brief: "This screen is the strongest single artefact in the product —
 * it is the thing no competitor can produce without both data streams, and it
 * is the natural share and screenshot moment."
 *
 * Three things it must do and one it must not. It must show the derived
 * metrics, the emphasis vector as a bar chart, and the findings list. It must
 * not present a null as a zero: an athlete who has never logged a sprint has
 * not been measured as slow, and the two must look different on this screen
 * or the whole "bound every metric to the data behind it" discipline is
 * undone at the last step.
 */

const EMPHASIS_LABEL: Record<EmphasisKey, string> = {
  aerobic_base: "Aerobic base",
  threshold: "Threshold",
  vo2max_speed: "VO₂max speed",
  neuromuscular: "Neuromuscular",
  maximal_strength: "Maximal strength",
  strength_endurance: "Strength endurance",
  weak_lift: "Weak lift",
};

const ENDURANCE_KEYS: EmphasisKey[] = ["aerobic_base", "threshold", "vo2max_speed", "neuromuscular"];

function mmss(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A metric row that distinguishes "not measured" from a value. */
function Metric({
  label,
  value,
  verdict,
  unmeasured,
}: {
  label: string;
  value: string | null;
  verdict?: string | null;
  unmeasured?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.04] py-2.5 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right">
        {value == null ? (
          <span className="text-sm italic text-muted/70">{unmeasured ?? "not measured"}</span>
        ) : (
          <>
            <span className="text-sm font-semibold tabular-nums">{value}</span>
            {verdict && <span className="ml-2 text-xs text-muted">{verdict}</span>}
          </>
        )}
      </span>
    </div>
  );
}

export function DiagnosticReport({
  profile,
  assumptions = [],
  cardio = null,
}: {
  profile: AthleteProfile;
  assumptions?: string[];
  /**
   * Which cardio modalities this plan is written in.
   *
   * Everything in the "Aerobic base" card below is a RUNNING measurement —
   * predicted 5k, longest run, easy-pace band, fatigue resistance, decoupling.
   * Showing them to an athlete who has told the intake they row and do not run
   * breaks this screen's own rule: an athlete who has never logged a sprint
   * has not been measured as slow, and an athlete who does not run has not
   * been measured as a slow runner either. When running is not one of their
   * modalities the 5k is replaced by their own sport's benchmark rather than
   * shown as a number about a sport they do not do.
   */
  cardio?: {
    suppressRunningDiagnostics: boolean;
    benchmark: { label: string; seconds: number | null; source: string; unmeasured: string; thresholdPace: string | null };
  } | null;
}) {
  const emphasis = (Object.entries(profile.emphasis) as [EmphasisKey, number][]).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...emphasis.map(([, v]) => v), 0.001);

  return (
    <div className="space-y-5">
      <Card glow={profile.limiter === "endurance" ? "endurance" : "strength"}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted">Your limiter</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {profile.limiter === "endurance" ? "Endurance" : "Strength"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-widest text-muted">Data tier</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {profile.tier}
              <span className="text-base text-muted">/3</span>
            </p>
            <p className="text-xs text-muted">{Math.round(profile.confidence * 100)}% confidence</p>
          </div>
        </div>
        {profile.dataGaps.length > 0 && (
          <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">Unlock more</p>
            <ul className="mt-2 space-y-1.5">
              {profile.dataGaps.map((gap) => (
                <li key={gap} className="text-sm leading-relaxed text-foreground/90">
                  {gap.charAt(0).toUpperCase() + gap.slice(1)}.
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* The emphasis vector as a bar chart — the brief's own words. */}
      <Card>
        <h2 className="text-lg font-semibold tracking-tight">What your week is weighted toward</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Seven weights summing to 100%. Every session in your plan is allocated against these, and every one of them
          moved because of something in your own logged history — the findings below say which.
        </p>
        <div className="mt-5 space-y-2.5">
          {emphasis.map(([key, value]) => {
            const isEndurance = ENDURANCE_KEYS.includes(key);
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-xs text-muted">{EMPHASIS_LABEL[key]}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className={cn("h-full rounded-full", isEndurance ? "bg-endurance" : "bg-strength")}
                    style={{ width: `${(value / max) * 100}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums">
                  {(value * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold tracking-tight">Aerobic base</h2>
        <div className="mt-3">
          <Metric
            label="Weekly volume"
            value={
              profile.weeklyVolumeMin > 0
                ? `${profile.weeklyVolumeKm.toFixed(1)}km / ${Math.round(profile.weeklyVolumeMin)}min`
                : null
            }
            // Rowing, cycling and the ski erg count toward this. They cannot
            // inform pace, but they are unambiguously aerobic training, and
            // reporting a rower's base as zero was simply wrong.
            verdict={
              profile.runningVolumeMin < profile.weeklyVolumeMin - 1
                ? `${Math.round(profile.runningVolumeMin)}min of it running`
                : undefined
            }
            unmeasured="no logged endurance sessions yet"
          />
          <Metric
            label="Longest run"
            value={profile.longestRunKm > 0 ? `${profile.longestRunKm.toFixed(1)}km` : null}
            unmeasured="no logged runs yet"
          />
          <Metric
            label="Volume adequacy"
            value={
              profile.predicted5kSource === "unknown"
                ? null
                : `${Math.round(profile.volumeAdequacy * 100)}%`
            }
            verdict="of the running volume typical for this 5k level"
            unmeasured="needs a 5k to measure against"
          />
          <Metric
            label="Fatigue resistance (k)"
            value={profile.riegelK != null ? profile.riegelK.toFixed(3) : null}
            verdict={profile.riegelVerdict}
            unmeasured="needs a second maximal effort"
          />
          <Metric
            label="Aerobic decoupling"
            value={profile.decoupling != null ? `${(profile.decoupling * 100).toFixed(1)}%` : null}
            verdict={profile.decoupling != null ? profile.decouplingVerdict : undefined}
            unmeasured="needs a long run with per-km HR"
          />
          <Metric
            label="Easy-running fraction"
            value={profile.easyFraction != null ? `${Math.round(profile.easyFraction * 100)}%` : null}
            verdict={
              profile.easyFraction != null
                ? `${profile.intensityVerdict}, by ${profile.easyFractionSource === "heart-rate" ? "heart rate" : "pace"}`
                : undefined
            }
          />
          {/*
            Speed reserve is the one metric on this screen most likely to be
            null, and showing it as a dash with the reason is the entire point
            of critical implementation note 0. A number here that was really a
            constant is what this replaced.
          */}
          <Metric
            label="Anaerobic speed reserve"
            value={profile.speedReserveMs != null ? `${profile.speedReserveMs.toFixed(1)} m/s` : null}
            unmeasured="log a flat-out 400m"
          />
          {/* A placeholder must never be shown as a prediction, and "using your
              own k" is false whenever riegelK is null. Both halves of the old
              string could be untrue at once: an athlete who had never raced
              saw a flat 25:00 described as their own. */}
          {cardio?.suppressRunningDiagnostics ? (
            // Their sport's benchmark, in their sport's units — never a 5k for
            // someone who does not run.
            <Metric
              label={`Projected ${cardio.benchmark.label}`}
              value={cardio.benchmark.seconds != null ? mmss(cardio.benchmark.seconds) : null}
              verdict={
                cardio.benchmark.source === "maximal_effort"
                  ? "from your own maximal effort"
                  : cardio.benchmark.source === "projected"
                    ? "projected from your logged sessions, not a benchmark you have done"
                    : cardio.benchmark.source === "typical_pace"
                      ? "your own typical pace"
                      : undefined
              }
              unmeasured={cardio.benchmark.unmeasured}
            />
          ) : (
            /*
              The label changes with the source, because the sources are not
              all the same QUANTITY and one of them is not a prediction at all.

              `sustained_pace_bound` is a ceiling: the engine had no maximal
              effort, and pulled an implausible fallback back to the fastest
              pace the athlete has actually held past 5km. That is a bound on
              the answer, not the answer. Shown under the same "Predicted 5k"
              heading with no verdict beside it, it read as a race prediction
              and disagreed with the number the rest of the app shows — an
              athlete saw 17:30 here and something else on their dashboard and
              could not tell which one the app believed. Two different
              quantities under one label is the defect; naming them apart is
              the fix, and the one that IS the app's prediction now says so.
            */
            <Metric
              label={profile.predicted5kSource === "sustained_pace_bound" ? "5k ceiling" : "Predicted 5k"}
              value={profile.predicted5kSource === "unknown" ? null : mmss(profile.predicted5kS)}
              verdict={
                profile.predicted5kSource === "maximal_effort"
                  ? profile.riegelK != null
                    ? "from your own maximal effort, using your own k"
                    : "from your own maximal effort"
                  : profile.predicted5kSource === "prediction_engine"
                    ? "from your logged sessions, not a race — the same prediction the rest of the app shows"
                    : profile.predicted5kSource === "sustained_pace_bound"
                      ? "the fastest pace you have held past 5km, so you are at least this quick — a ceiling, not a prediction"
                      : undefined
              }
              unmeasured="log a race or time trial"
            />
          )}
          {profile.predicted5kSource === "sustained_pace_bound" && (
            <p className="pt-2 text-xs leading-relaxed text-muted">
              You have not logged a maximal effort near 5k, so there is no prediction to make. Every pace band below is
              built from this ceiling, which means they are conservative by design — race one and they tighten to your
              real number.
            </p>
          )}
          {cardio?.suppressRunningDiagnostics && cardio.benchmark.thresholdPace && (
            <Metric
              label="Pace you could hold for an hour"
              value={cardio.benchmark.thresholdPace}
              verdict="every band in your plan is a fraction of this"
            />
          )}
          <Metric
            label="Max heart rate"
            value={`${profile.hrMax} bpm`}
            verdict={profile.hrMaxSource === "measured" ? "measured" : "age-estimated"}
          />
        </div>
        {profile.easyBand && (
          <div className="mt-4 rounded-2xl border border-endurance/20 bg-endurance/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-endurance">Your easy pace</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums">
              {mmss(profile.easyBand.lo)}–{mmss(profile.easyBand.hi)}/km
            </p>
            <p className="text-sm text-muted">
              at HR {profile.easyBand.hrLo}–{profile.easyBand.hrHi}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Taken from the slowest of three independent anchors ({profile.easyBand.governing.replace(/_/g, " ")}{" "}
              governs). Deliberately not a multiple of your 5k time — that anchor assumes your 5k is already supported
              by aerobic volume, and for most athletes reading this it is not.
            </p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold tracking-tight">Strength profile</h2>
        {Object.entries(profile.oneRms).length > 0 && (
          /*
            An athlete read "Bench 100kg · 0.72× squat" and asked "why is my
            deadlift and bench logged as a multiple of my squat?" — a fair
            reading of a bare "0.72× squat" sitting where a derivation would
            sit. Nothing here is derived: each kg figure is that lift's own
            best logged estimate, and the ratio is a comparison drawn AFTER the
            fact against the balance norm. Saying so is cheaper than being
            misread, and the norm gives the ratio something to mean.
          */
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Each weight is that lift&apos;s own best estimate from your logged sets. The ratio beside it compares the
            lift to your squat against the usual balance — it is a comparison, not how the weight was worked out.
          </p>
        )}
        <div className="mt-3">
          {Object.entries(profile.oneRms).length > 0 ? (
            Object.entries(profile.oneRms).map(([lift, kg]) => (
              <Metric
                key={lift}
                label={lift.charAt(0).toUpperCase() + lift.slice(1)}
                value={`${Math.round(kg)}kg`}
                // A ratio to squat is only meaningful when there IS a squat to
                // be a ratio of. Shown otherwise, it was arithmetic on a
                // number that did not exist.
                verdict={
                  profile.liftRatiosAssessed && profile.liftRatios[lift] && LIFT_RATIO_NORM[lift] != null
                    ? `${profile.liftRatios[lift].toFixed(2)}× your squat (typical ${LIFT_RATIO_NORM[lift]!.toFixed(2)}×)`
                    : profile.liftRatiosAssessed && profile.liftRatios[lift]
                      ? `${profile.liftRatios[lift].toFixed(2)}× your squat`
                      : undefined
                }
              />
            ))
          ) : (
            <Metric label="1RMs" value={null} unmeasured="log a 3-5RM test" />
          )}
          <Metric
            label="Rep-profile gap"
            value={profile.repProfileGap != null ? `${profile.repProfileGap > 0 ? "+" : ""}${(profile.repProfileGap * 100).toFixed(1)}%` : null}
            verdict={profile.repProfileGap != null ? profile.repProfileVerdict : undefined}
            unmeasured="needs both heavy and high-rep sets"
          />
          {/* "No weak lift" and "never looked for one" must not read the
              same. Both were rendering as "none flagged", which told athletes
              their lifts were balanced when the engine had never seen a lift. */}
          <Metric
            label="Weak lift"
            value={profile.weakLiftAssessed ? (profile.weakLift ?? "none — your lifts are in proportion") : null}
            unmeasured="needs a squat plus one other lift"
          />
          {/* "Get rid of stalled lifts or ensure there is a value here."
              Kept, because a stall is the one strength finding that changes
              what the plan prescribes — a stalled lift gets a variation block
              in place of the competition lift. What it shows when it cannot
              reach a verdict is now how far off THIS athlete is rather than a
              restatement of its own threshold, so the row always carries
              something about the person reading it. */}
          <Metric
            label="Stalled lifts"
            value={profile.stallAssessed ? (profile.stalledLifts.join(", ") || "none — everything is still moving") : null}
            unmeasured={profile.stallShortfall ?? "needs 6+ sets of a lift across 4+ weeks"}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold tracking-tight">
          What your data actually says
          <span className="ml-2 text-sm font-normal text-muted">{profile.findings.length} findings</span>
        </h2>
        <ol className="mt-4 space-y-4">
          {profile.findings.map((finding, i) => (
            <li key={finding.id} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-semibold tabular-nums">
                {i + 1}
              </span>
              <div>
                <p className="text-sm leading-relaxed text-foreground/90">{finding.text}</p>
                <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-wider text-muted/60">{finding.id}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {assumptions.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold tracking-tight">What we assumed</h2>
          <p className="mt-1 text-sm text-muted">
            Everything here is a number the engine had to fill in rather than read. Each one widens a band somewhere.
          </p>
          <ul className="mt-3 space-y-2.5">
            {assumptions.map((note) => (
              <li key={note} className="text-sm leading-relaxed text-muted">
                {note}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="px-1 text-xs text-muted/60">
        Diagnostic constants v{profile.constantsVersion}. Every number above is derived from your logged history —
        change the history and the plan changes with it.
      </p>
    </div>
  );
}
