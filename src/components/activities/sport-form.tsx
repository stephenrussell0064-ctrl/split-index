"use client";

import { Select, Textarea } from "@/components/ui/input";
import { SESSION_TYPES, STROKE_TYPES } from "@/lib/constants/sports";
import { cn } from "@/lib/utils/cn";
import type { SessionType, SportType } from "@/types";
import {
  DurationInput,
  Field,
  GlassInput,
  HeroInput,
  HeroReadout,
  RpeScale,
  SplitInput,
  UnitInput,
  PillGroup,
} from "./fields";
import { ExpandableSection } from "./expandable-section";
import {
  derivePacePer100m,
  derivePacePerKm,
  deriveDistanceFromDurationAndSplit,
  deriveDurationFromDistanceAndSplit,
  deriveSpeedKmh,
  deriveSplitPer500m,
  formatClock,
  parseNum,
  splitSecondsFromState,
  totalDurationSeconds,
  SPORT_FIELDS,
  type FormErrors,
  type WorkoutFormState,
} from "./form-state";
import { GymExercises } from "./gym-form";
import { GymWorkoutTimer } from "./gym-workout-timer";

export type UpdateField = <K extends keyof WorkoutFormState>(
  key: K,
  value: WorkoutFormState[K]
) => void;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-widest text-muted/80 mb-4">
      {children}
    </h2>
  );
}

export function SportForm({
  sport,
  state,
  errors,
  onUpdate,
  profileScoringSex = null,
}: {
  sport: SportType;
  state: WorkoutFormState;
  errors: FormErrors;
  onUpdate: UpdateField;
  profileScoringSex?: import("@/types").Gender | null;
}) {
  const fields = SPORT_FIELDS[sport];
  const durationSeconds = totalDurationSeconds(state);
  const isGym = sport === "gym";

  const logsByDistance = fields.derivableDistance && state.rowInputMode === "distance";
  const logsByTime = fields.derivableDistance && state.rowInputMode === "time";
  const splitSeconds = splitSecondsFromState(state);
  const distanceMeters = fields.distance
    ? (() => {
        const raw = parseNum(state.distance);
        return raw ? (fields.distance === "km" ? raw * 1000 : raw) : null;
      })()
    : null;
  const derivedDurationSeconds = logsByDistance
    ? deriveDurationFromDistanceAndSplit(distanceMeters, splitSeconds)
    : null;
  const derivedDistanceMeters = logsByTime
    ? deriveDistanceFromDurationAndSplit(durationSeconds, splitSeconds)
    : null;

  // The headline number of the session, derived from what's typed above it.
  // Rowing/ski erg enter their split directly, so for those the useful
  // readout is whichever of distance/duration is being derived from it.
  const paceReadout: { label: string; value: string | null; placeholder: string } | null = (() => {
    if (isGym) return null;
    if (logsByDistance) {
      return {
        label: "Duration",
        value: derivedDurationSeconds ? formatClock(derivedDurationSeconds) : null,
        placeholder: "Enter distance & split",
      };
    }
    if (logsByTime) {
      return {
        label: "Distance",
        value: derivedDistanceMeters
          ? `${Math.round(derivedDistanceMeters).toLocaleString()} m`
          : null,
        placeholder: "Enter time & split",
      };
    }
    const distance = parseNum(state.distance);
    switch (sport) {
      case "running":
      case "walking":
        return { label: "Pace", value: derivePacePerKm(distance, durationSeconds), placeholder: "—" };
      case "swimming":
        return { label: "Pace", value: derivePacePer100m(distance, durationSeconds), placeholder: "—" };
      case "rowing":
      case "ski_erg":
        return { label: "Split", value: deriveSplitPer500m(distance, durationSeconds), placeholder: "—" };
      case "bike_erg":
        return { label: "Speed", value: deriveSpeedKmh(distance, durationSeconds), placeholder: "—" };
      case "outdoor_cycling":
        // distance is in km here (unlike bike_erg's raw meters) — convert
        // before deriveSpeedKmh, which expects meters.
        return {
          label: "Speed",
          value: deriveSpeedKmh(distance ? distance * 1000 : null, durationSeconds),
          placeholder: "—",
        };
      default:
        return null;
    }
  })();

  const powerWatts = parseNum(state.avgPower);
  const bodyweightKg = parseNum(state.bodyweight);
  const wattsPerKg =
    fields.power && powerWatts && bodyweightKg
      ? `${(powerWatts / bodyweightKg).toFixed(1)} W/kg`
      : null;
  const readouts = [
    paceReadout,
    fields.power ? { label: "W/kg", value: wattsPerKg, placeholder: "—" } : null,
  ].filter((r): r is { label: string; value: string | null; placeholder: string } => r !== null);

  return (
    <div className="space-y-4">
      {isGym ? (
        <>
          {/* Sticky so it's reachable however far you've scrolled through the
              exercise list, matching the sticky submit bar's own offset in
              activity-form.tsx so the two don't collide. */}
          <div className="sticky top-[max(0.75rem,env(safe-area-inset-top))] z-30 lg:static">
            <GymWorkoutTimer
              onUseDuration={(totalSeconds) => {
                const h = Math.floor(totalSeconds / 3600);
                const m = Math.floor((totalSeconds % 3600) / 60);
                const s = Math.round(totalSeconds % 60);
                onUpdate("hours", h > 0 ? String(h) : "");
                onUpdate("minutes", String(m));
                onUpdate("seconds", String(s));
              }}
            />
          </div>

          {/* Date and total duration, on one line above the workout. Kept
              above the exercise list (not tucked in with the notes at the
              bottom) because duration is required at submit and the timer
              directly above fills it — an athlete who didn't run the timer
              should meet the field before scrolling past forty set rows. */}
          <section className="rounded-2xl border border-gym-border/30 bg-gym-bg-elevated/60 p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date & start time" error={errors.startedAt}>
                <GlassInput
                  type="datetime-local"
                  value={state.startedAt}
                  invalid={!!errors.startedAt}
                  onChange={(e) => onUpdate("startedAt", e.target.value)}
                  className="h-11"
                />
              </Field>
              <Field label="Total duration" error={errors.duration}>
                <DurationInput
                  hours={state.hours}
                  minutes={state.minutes}
                  seconds={state.seconds}
                  invalid={!!errors.duration}
                  onChange={(part, value) => onUpdate(part, value)}
                />
              </Field>
            </div>
          </section>

          {/* No section wrapper and no accordion — the exercise cards are the
              content of this screen, not a subsection of it. */}
          <GymExercises
            state={state}
            errors={errors}
            onUpdate={onUpdate}
            profileScoringSex={profileScoringSex}
          />
        </>
      ) : (
        <>
          {/* The session — the numbers the athlete opened the app to type,
              at the size that says so, and grouped together.
              Distance and duration used to live in different cards ("Metrics"
              and "When") with the title and date between them, and pace only
              ever appeared as a small chip above the whole form. Split lives
              here too for rowing/ski erg: it's the third leg of the
              distance/time/split triangle and was previously a card away from
              the two values it derives. */}
          <section className="rounded-2xl border border-cardio-border/30 bg-cardio-bg-elevated/5 p-4 sm:p-6 space-y-4">
            <SectionLabel>The session</SectionLabel>

            {fields.derivableDistance && (
              <Field label="Log by">
                <PillGroup
                  options={[
                    { value: "distance", label: "Distance" },
                    { value: "time", label: "Time" },
                  ]}
                  value={state.rowInputMode}
                  onChange={(value) => onUpdate("rowInputMode", value as "distance" | "time")}
                  layoutIdPrefix={`row-input-mode-${sport}`}
                />
              </Field>
            )}

            {fields.distance && !logsByTime && (
              <Field label="Distance" error={errors.distance}>
                <HeroInput
                  value={state.distance}
                  unit={fields.distance}
                  placeholder={fields.distance === "km" ? "10" : "5000"}
                  invalid={!!errors.distance}
                  onChange={(e) => onUpdate("distance", e.target.value)}
                />
              </Field>
            )}

            {!logsByDistance && (
              <Field label="Duration" error={errors.duration}>
                <DurationInput
                  size="hero"
                  hours={state.hours}
                  minutes={state.minutes}
                  seconds={state.seconds}
                  invalid={!!errors.duration}
                  onChange={(part, value) => onUpdate(part, value)}
                />
              </Field>
            )}

            {/* Every split-tracking sport, not just the derivable ones —
                this is the only place split is rendered now, so gating it on
                derivableDistance (as the old Metrics card did, with a second
                copy inside "Advanced metrics" for the rest) would silently
                drop the field for any sport configured with split alone. */}
            {fields.split && (
              <Field label="Avg split / 500m" error={errors.split}>
                <SplitInput
                  minutes={state.splitMinutes}
                  seconds={state.splitSeconds}
                  invalid={!!errors.split}
                  onChange={(part, value) => onUpdate(part, value)}
                />
              </Field>
            )}

            {/* Power was in the collapsed "Advanced metrics" section, which
                made it a two-tap hunt on indoor cycling — the one sport where
                it is the ONLY performance number there is. */}
            {fields.power && (
              <Field label="Avg power" error={errors.avgPower} hint="Optional">
                <UnitInput
                  value={state.avgPower}
                  unit="W"
                  placeholder="185"
                  invalid={!!errors.avgPower}
                  onChange={(e) => onUpdate("avgPower", e.target.value)}
                  className="h-12"
                />
              </Field>
            )}

            {fields.stroke && (
              <Field label="Stroke">
                <Select
                  options={STROKE_TYPES}
                  value={state.strokeType}
                  onChange={(e) => onUpdate("strokeType", e.target.value)}
                />
              </Field>
            )}

            {readouts.length > 0 && (
              <div className={cn("grid gap-2", readouts.length > 1 && "grid-cols-2")}>
                {readouts.map((r) => (
                  <HeroReadout
                    key={r.label}
                    label={r.label}
                    value={r.value}
                    placeholder={r.placeholder}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Effort & conditions — heart rate, RPE, elevation gain and
          temperature, plainly visible rather than behind a disclosure.
          User-reported: these were spread across two collapsed sections
          ("Heart rate & RPE" / "Advanced metrics"), so logging or editing a
          run meant hunting through accordions for the four fields most
          runners actually fill in every session. They stay optional — the
          form is still "distance, time, done" — they're just no longer
          hidden behind extra taps. Gym is excluded: SPORT_FIELDS.gym is
          empty (its effort lives per-set inside each exercise row), so this
          would render as an empty header. */}
      {!isGym && (fields.avgHr || fields.rpe || fields.elevation || fields.temperature) && (
        <section className="rounded-2xl border border-cardio-border/30 bg-cardio-bg-elevated/5 p-5 sm:p-6 space-y-5">
          <SectionLabel>Effort &amp; conditions</SectionLabel>
          {(fields.avgHr || fields.elevation || fields.temperature) && (
            <div className="grid gap-5 sm:grid-cols-2">
              {fields.avgHr && (
                <Field
                  label="Avg heart rate"
                  error={errors.avgHr}
                  hint="Optional — improves aerobic efficiency scoring"
                >
                  <UnitInput
                    value={state.avgHr}
                    unit="bpm"
                    placeholder="152 — skip if not tracked"
                    invalid={!!errors.avgHr}
                    onChange={(e) => onUpdate("avgHr", e.target.value)}
                    className="h-12"
                  />
                </Field>
              )}
              {fields.elevation && (
                <Field label="Elevation gain" error={errors.elevation} hint="Optional">
                  <UnitInput
                    value={state.elevation}
                    unit="m"
                    placeholder="120"
                    invalid={!!errors.elevation}
                    onChange={(e) => onUpdate("elevation", e.target.value)}
                    className="h-12"
                  />
                </Field>
              )}
              {fields.temperature && (
                <Field label="Temperature" error={errors.temperature} hint="Optional">
                  <UnitInput
                    value={state.temperature}
                    unit="°C"
                    placeholder="15"
                    invalid={!!errors.temperature}
                    onChange={(e) => onUpdate("temperature", e.target.value)}
                    className="h-12"
                  />
                </Field>
              )}
            </div>
          )}
          {fields.rpe && (
            <Field
              label="RPE — how hard did it feel?"
              error={errors.rpe}
              hint="1 = very easy · 10 = max effort"
            >
              <RpeScale value={state.rpe} onChange={(value) => onUpdate("rpe", value)} />
            </Field>
          )}
        </section>
      )}

      {/* Session type — the intensity classifier, plus its optional
          interval/fartlek rep breakdown. Gym has no equivalent: its
          session_type taxonomy (Tempo/Threshold/Interval/Race) is
          cardio-specific, and gym already tracks effort per-set via RPE
          inside each exercise row.

          Still collapsed by default (and now only rendered for sports that
          actually have a session type — walking et al. previously opened
          this to find only the RPE scale, which is inline above now):
          session type already defaults to "easy", so a first-time casual
          logger isn't presented with a classifier they feel obligated to
          fill in (Slice D: "distance, time, done"). */}
      {!isGym && fields.sessionType && (
        <ExpandableSection title="Session type" hint="Defaults to Easy — optional" tone="cardio">
          <Field label="Session type">
            <PillGroup
              options={SESSION_TYPES}
              value={state.sessionType}
              onChange={(value) => onUpdate("sessionType", value as SessionType)}
              layoutIdPrefix={`session-${sport}`}
            />
          </Field>
          {state.sessionType === "interval" && (
            <IntervalSubForm state={state} errors={errors} onUpdate={onUpdate} />
          )}
          {state.sessionType === "fartlek" && (
            <FartlekSubForm state={state} errors={errors} onUpdate={onUpdate} />
          )}
        </ExpandableSection>
      )}

      {/* When it happened. Below the metrics rather than above them: it's a
          required field that already defaults to now, so for the common case
          (logging the session you just finished) it needs to be visible and
          correct, not first. The old layout spent the entire first screen on
          Title + Date before the athlete reached "Distance".
          The "Advanced metrics" accordion that used to sit around here is
          gone — split, power and stroke are all in the session card above,
          where they belong with the numbers they relate to. */}
      {!isGym && (
        <section className="rounded-2xl border border-cardio-border/30 bg-cardio-bg-elevated/5 p-4 sm:p-6">
          <Field label="Date & start time" error={errors.startedAt}>
            <GlassInput
              type="datetime-local"
              value={state.startedAt}
              invalid={!!errors.startedAt}
              onChange={(e) => onUpdate("startedAt", e.target.value)}
              className="h-12 sm:max-w-sm"
            />
          </Field>
        </section>
      )}

      {/* Name and notes — the only two genuinely skippable fields, together.
          Title was previously the very first input on the form despite being
          explicitly optional and auto-filled from the sport. */}
      <ExpandableSection title="Name & notes" hint="Optional" tone={isGym ? "gym" : "cardio"}>
        <Field label="Title" hint="We'll name it after the sport if left blank">
          <GlassInput
            value={state.title}
            placeholder={titlePlaceholder(sport)}
            onChange={(e) => onUpdate("title", e.target.value)}
            className="h-12"
          />
        </Field>
        <Field label="Notes">
          <Textarea
            value={state.notes}
            placeholder="How did it feel? Anything worth remembering?"
            onChange={(e) => onUpdate("notes", e.target.value)}
          />
        </Field>
      </ExpandableSection>
    </div>
  );
}

/**
 * Structured work-piece breakdown for an interval session — reps × work
 * distance/time + rest between reps. Entirely optional: leaving it blank
 * scores the session off the whole-session average, same as before this
 * existed. Filling it in scores off the work-piece pace instead, so the
 * hard reps aren't diluted by the recovery jogs in between (see
 * cardio/interval-scoring.ts).
 */
function IntervalSubForm({
  state,
  errors,
  onUpdate,
}: {
  state: WorkoutFormState;
  errors: FormErrors;
  onUpdate: UpdateField;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <p className="text-xs text-muted/70">
        Optional — add your rep breakdown to score off work-piece pace instead of the whole-session average (recovery jogs won&apos;t dilute the hard reps).
      </p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Reps" error={errors.intervalReps}>
          <GlassInput
            type="text"
            inputMode="numeric"
            placeholder="6"
            value={state.intervalReps}
            invalid={!!errors.intervalReps}
            onChange={(e) => onUpdate("intervalReps", e.target.value)}
            className="h-11"
          />
        </Field>
        <Field label="Work distance" error={errors.intervalWorkDistance}>
          <UnitInput
            value={state.intervalWorkDistance}
            unit="m"
            placeholder="400"
            invalid={!!errors.intervalWorkDistance}
            onChange={(e) => onUpdate("intervalWorkDistance", e.target.value)}
            className="h-11"
          />
        </Field>
        <Field label="Work time /rep" error={errors.intervalWorkSeconds}>
          <UnitInput
            value={state.intervalWorkSeconds}
            unit="sec"
            placeholder="75"
            invalid={!!errors.intervalWorkSeconds}
            onChange={(e) => onUpdate("intervalWorkSeconds", e.target.value)}
            className="h-11"
          />
        </Field>
        <Field label="Rest between reps" error={errors.intervalRestSeconds}>
          <UnitInput
            value={state.intervalRestSeconds}
            unit="sec"
            placeholder="90"
            invalid={!!errors.intervalRestSeconds}
            onChange={(e) => onUpdate("intervalRestSeconds", e.target.value)}
            className="h-11"
          />
        </Field>
      </div>
      <Field
        label="Avg HR during reps"
        error={errors.intervalWorkHr}
        hint="Optional — work-only, not whole-session average"
      >
        <UnitInput
          value={state.intervalWorkHr}
          unit="bpm"
          placeholder="172 — skip if not tracked"
          invalid={!!errors.intervalWorkHr}
          onChange={(e) => onUpdate("intervalWorkHr", e.target.value)}
          className="h-11 max-w-[220px]"
        />
      </Field>
    </div>
  );
}

/**
 * Fartlek's unstructured "on/off" speed play, resolved to the same
 * work-piece treatment as structured intervals once the total "on"
 * distance/time are known. Optional — same graceful fallback as intervals.
 */
function FartlekSubForm({
  state,
  errors,
  onUpdate,
}: {
  state: WorkoutFormState;
  errors: FormErrors;
  onUpdate: UpdateField;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <p className="text-xs text-muted/70">
        Optional — total up your hard (&quot;on&quot;) pieces to score off that work-piece pace instead of the whole-session average.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Total &quot;on&quot; distance" error={errors.fartlekOnDistance}>
          <UnitInput
            value={state.fartlekOnDistance}
            unit="m"
            placeholder="2400"
            invalid={!!errors.fartlekOnDistance}
            onChange={(e) => onUpdate("fartlekOnDistance", e.target.value)}
            className="h-11"
          />
        </Field>
        <Field label="Total &quot;on&quot; time" error={errors.fartlekOnSeconds}>
          <UnitInput
            value={state.fartlekOnSeconds}
            unit="sec"
            placeholder="600"
            invalid={!!errors.fartlekOnSeconds}
            onChange={(e) => onUpdate("fartlekOnSeconds", e.target.value)}
            className="h-11"
          />
        </Field>
      </div>
      <Field
        label="Avg HR during &quot;on&quot; pieces"
        error={errors.fartlekOnHr}
        hint="Optional — on-effort only, not whole-session average"
      >
        <UnitInput
          value={state.fartlekOnHr}
          unit="bpm"
          placeholder="170 — skip if not tracked"
          invalid={!!errors.fartlekOnHr}
          onChange={(e) => onUpdate("fartlekOnHr", e.target.value)}
          className="h-11 max-w-[220px]"
        />
      </Field>
    </div>
  );
}

function titlePlaceholder(sport: SportType): string {
  switch (sport) {
    case "running":
      return "Morning tempo run";
    case "walking":
      return "Lunchtime walk";
    case "swimming":
      return "Endurance swim";
    case "rowing":
      return "Steady state row";
    case "ski_erg":
      return "SkiErg intervals";
    case "bike_erg":
      return "BikeErg threshold";
    case "indoor_cycling":
      return "Trainer session";
    case "outdoor_cycling":
      return "Afternoon road ride";
    case "gym":
      return "Lower body strength";
  }
}
