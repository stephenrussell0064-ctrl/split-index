"use client";

import { Select, Textarea } from "@/components/ui/input";
import { SESSION_TYPES, STROKE_TYPES } from "@/lib/constants/sports";
import type { SessionType, SportType } from "@/types";
import {
  DerivedChip,
  DurationInput,
  Field,
  GlassInput,
  MicroLabel,
  RpeScale,
  SplitInput,
  UnitInput,
  PillGroup,
} from "./fields";
import { ExpandableSection } from "./expandable-section";
import {
  bestSetRow,
  derivePacePer100m,
  derivePacePerKm,
  deriveSpeedKmh,
  deriveSplitPer500m,
  epley1RM,
  parseNum,
  totalDurationSeconds,
  SPORT_FIELDS,
  type FormErrors,
  type WorkoutFormState,
} from "./form-state";
import { GymExercises } from "./gym-form";
import { formatRelativeStrength } from "@/lib/utils/scoring-display";

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
}: {
  sport: SportType;
  state: WorkoutFormState;
  errors: FormErrors;
  onUpdate: UpdateField;
}) {
  const fields = SPORT_FIELDS[sport];
  const durationSeconds = totalDurationSeconds(state);
  const isGym = sport === "gym";

  return (
    <div className="space-y-6">
      <FormSummaryStrip sport={sport} state={state} durationSeconds={durationSeconds} />

      {/* When — minimum upfront */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 space-y-5">
        <SectionLabel>When</SectionLabel>
        <Field label="Title" hint="Optional — we'll name it after the sport if left blank">
          <GlassInput
            value={state.title}
            placeholder={titlePlaceholder(sport)}
            onChange={(e) => onUpdate("title", e.target.value)}
            className="h-12"
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Date & start time" error={errors.startedAt}>
            <GlassInput
              type="datetime-local"
              value={state.startedAt}
              invalid={!!errors.startedAt}
              onChange={(e) => onUpdate("startedAt", e.target.value)}
              className="h-12"
            />
          </Field>
          <Field label="Duration" error={errors.duration}>
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

      {/* Metrics — distance upfront for cardio; exercises for gym */}
      {isGym ? (
        <ExpandableSection title="Metrics · Strength work" defaultOpen hint="Exercises, sets, reps">
          <GymExercises state={state} errors={errors} onUpdate={onUpdate} embedded />
        </ExpandableSection>
      ) : (
        <section className="rounded-2xl border border-cardio-border/30 bg-cardio-bg-elevated/5 p-5 sm:p-6 space-y-5">
          <SectionLabel>Metrics</SectionLabel>
          <div className="grid gap-5 sm:grid-cols-2">
            {fields.distance && (
              <Field label="Distance" error={errors.distance}>
                <UnitInput
                  value={state.distance}
                  unit={fields.distance}
                  placeholder={fields.distance === "km" ? "10" : "5000"}
                  invalid={!!errors.distance}
                  onChange={(e) => onUpdate("distance", e.target.value)}
                  className="h-12"
                />
              </Field>
            )}
          </div>
        </section>
      )}

      {/* Effort — session type as primary intensity signal. Gym has no
          equivalent here: its session_type taxonomy (Tempo/Threshold/
          Interval/Race) is cardio-specific, and gym already tracks effort
          per-set via RPE inside each exercise row. Rendering this for gym
          previously showed an empty "Effort" header with no control inside
          it, since both fields.sessionType and fields.rpe are unset for
          gym (SPORT_FIELDS.gym === {}). */}
      {!isGym && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 space-y-5">
          <SectionLabel>Effort</SectionLabel>
          {fields.sessionType && (
            <Field label="Session type">
              <PillGroup
                options={SESSION_TYPES}
                value={state.sessionType}
                onChange={(value) => onUpdate("sessionType", value as SessionType)}
                layoutIdPrefix={`session-${sport}`}
              />
            </Field>
          )}
          {!fields.sessionType && fields.rpe && (
            <Field label="RPE" error={errors.rpe} hint="1 = very easy · 10 = max effort">
              <RpeScale value={state.rpe} onChange={(value) => onUpdate("rpe", value)} />
            </Field>
          )}
        </section>
      )}

      {/* Progressive: HR & RPE */}
      {!isGym && (fields.avgHr || fields.rpe) && (
        <ExpandableSection
          title="Heart rate & RPE"
          hint="Adding heart rate unlocks aerobic efficiency scoring"
          tone="cardio"
        >
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
          {fields.rpe && fields.sessionType && (
            <Field label="RPE — how hard did it feel?" error={errors.rpe}>
              <RpeScale value={state.rpe} onChange={(value) => onUpdate("rpe", value)} />
            </Field>
          )}
        </ExpandableSection>
      )}

      {/* Progressive: advanced metrics */}
      {!isGym &&
        (fields.elevation || fields.split || fields.power || fields.stroke || fields.temperature) && (
          <ExpandableSection title="Advanced metrics" hint="Splits, elevation, power" tone="cardio">
            <div className="grid gap-5 sm:grid-cols-2">
              {fields.elevation && (
                <Field label="Elevation gain" error={errors.elevation}>
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
              {fields.power && (
                <Field label="Avg power" error={errors.avgPower}>
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
              {fields.temperature && (
                <Field label="Temperature" error={errors.temperature}>
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
          </ExpandableSection>
        )}

      {/* Optional notes */}
      <ExpandableSection title="Optional" hint="Notes">
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

function FormSummaryStrip({
  sport,
  state,
  durationSeconds,
}: {
  sport: SportType;
  state: WorkoutFormState;
  durationSeconds: number;
}) {
  const chips: { label: string; value: string | null }[] = [];

  if (sport === "gym") {
    const bw = parseNum(state.bodyweight);
    let topRatio: string | null = null;
    for (const row of state.exercises) {
      const top = bestSetRow(row.sets);
      const oneRm = top ? epley1RM(parseNum(top.weight), parseNum(top.reps)) : null;
      if (!oneRm || !bw || !row.name.trim()) continue;
      const ratio = oneRm / bw;
      if (!topRatio || ratio > parseFloat(topRatio)) {
        topRatio = String(ratio);
      }
    }
    if (topRatio) {
      chips.push({ label: "Top lift", value: formatRelativeStrength(parseFloat(topRatio), true) });
    }
  } else {
    const distance = parseNum(state.distance);
    let pace: string | null = null;
    if (sport === "running" || sport === "walking") {
      pace = derivePacePerKm(distance, durationSeconds);
    } else if (sport === "swimming") {
      pace = derivePacePer100m(distance, durationSeconds);
    } else if (sport === "rowing" || sport === "ski_erg") {
      pace = deriveSplitPer500m(distance, durationSeconds);
    } else if (sport === "bike_erg") {
      pace = deriveSpeedKmh(distance, durationSeconds);
    }
    if (pace) chips.push({ label: "Pace", value: pace });
    const power = parseNum(state.avgPower);
    const bw = parseNum(state.bodyweight);
    if (power && bw) {
      chips.push({ label: "W/kg", value: `${(power / bw).toFixed(1)} W/kg` });
    }
    const hr = parseNum(state.avgHr);
    if (hr) chips.push({ label: "Avg HR", value: `${hr} bpm` });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <MicroLabel className="self-center text-muted/60 mr-1">Live</MicroLabel>
      {chips.map((c) => (
        <DerivedChip
          key={c.label}
          label={c.label}
          value={c.value}
          tone={sport === "gym" ? "strength" : "endurance"}
        />
      ))}
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
    case "gym":
      return "Lower body strength";
  }
}
