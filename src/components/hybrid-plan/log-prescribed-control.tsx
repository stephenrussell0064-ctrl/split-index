"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ClipboardCheck, PenLine } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";
import { getExerciseTracking } from "@/lib/constants/sports";
import {
  canLogAsPrescribed,
  isBodyweightMovement,
  parsePrescribedExercises,
  prescribedSetValues,
} from "@/lib/scoring/hpe/prescribed-sets";
import { submitActivityRequest } from "@/lib/activities/submit-activity";
import type { ActivityFormData } from "@/types";

/**
 * Log a prescribed strength session in one tap.
 *
 * The plan already knows every exercise, set, load and rep target for today.
 * Before this, the athlete read those off the screen and typed them into the
 * gym form, about three fields per set — the heaviest surface in the app, and
 * the one no wearable import can ever fill. Logging should be confirmation,
 * not transcription: this posts the prescription itself as the session and
 * marks every set as accepted, so the usual case costs one tap and the
 * exception (a set that differed) costs opening the form with everything
 * already filled in.
 *
 * TWO ROUTES, SAME DATA. "Log as prescribed" posts straight to /api/activities
 * through the same submit helper the form uses (idempotency key, offline
 * queue, twelve-second timeout). "Open in Lab" sends the athlete to
 * /gym/log?hpeSession=<id>, where the loader fills the form from the same
 * parser and the athlete edits what differed. The one-tap button is only
 * offered when every line carries a number the form can take — a prescription
 * that says "80-90% 1RM (no logged 1RM yet)" has no load to log, and logging
 * it at 0 kg would be invented data; that session goes to the form.
 *
 * The server records the plan feedback row for a linked activity (completed,
 * met_prescription = nothing edited), so the three-button control below it
 * reads "Nailed it" after this without a second tap. It does NOT work the
 * other way round: "Nailed it" on its own never creates an activity, because
 * an athlete who has logged the session by hand without the link would get it
 * twice.
 */

type Phase = "idle" | "saving" | "queued" | "failed";

/**
 * The activity the prescription describes, as the form would have built it.
 * Pure, so the test can hold it against the parser: every exercise, every set,
 * and the counts that say nothing was changed.
 */
export function buildPrescribedActivityPayload(input: {
  sessionId: string;
  prescriptionText: string;
  title: string;
  startedAt: Date;
  minutes: number;
}): ActivityFormData | null {
  const exercises = parsePrescribedExercises(input.prescriptionText);
  if (!canLogAsPrescribed(exercises)) return null;

  let totalSets = 0;
  const payloadExercises = exercises.map((ex, index) => {
    const values = prescribedSetValues(ex);
    const tracking = getExerciseTracking(ex.name);
    const timed = tracking === "time" || values.holdSeconds != null;
    const bodyweightOnly = isBodyweightMovement(ex.name);
    totalSets += ex.sets;
    return {
      exercise_name: ex.name,
      muscle_group: ex.muscleGroup,
      order_index: index,
      weight_entry_mode: bodyweightOnly ? ("added" as const) : defaultWeightEntryMode(ex.name),
      attachment: null,
      sets: Array.from({ length: ex.sets }, () => ({
        weight_kg: values.weightKg ?? 0,
        // A timed hold is one performed effort with the measurement in
        // duration_seconds — the same shape the form submits for a plank.
        reps: timed ? 1 : (values.reps ?? 1),
        rpe: null,
        reps_in_reserve: null,
        duration_seconds: timed ? values.holdSeconds : null,
        distance_meters: null,
      })),
    };
  });

  return {
    sport: "gym",
    title: input.title,
    started_at: input.startedAt.toISOString(),
    // The engine's own estimate of the session; a zero would fail the schema.
    duration_seconds: Math.max(60, Math.round(input.minutes * 60)),
    session_type: "easy",
    exercises: payloadExercises,
    hpe_session_id: input.sessionId,
    prescribed_sets: { accepted: totalSets, edited: 0 },
  };
}

/** When a session logged from the plan is said to have started: now for today, midday on the day it was scheduled otherwise. */
export function prescribedStartedAt(sessionDate: Date, offsetDays: number): Date {
  if (offsetDays === 0) return new Date();
  const at = new Date(sessionDate);
  at.setHours(12, 0, 0, 0);
  return at;
}

export function LogPrescribedControl({
  sessionId,
  prescriptionText,
  title,
  sessionDate,
  offsetDays,
  minutes,
  activityId,
  onLogged,
  className,
}: {
  sessionId: string;
  prescriptionText: string;
  title: string;
  sessionDate: Date;
  offsetDays: number;
  minutes: number;
  /** Already logged from this prescription — show where, offer nothing else. */
  activityId: string | null;
  onLogged: (activityId: string) => void;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const exercises = parsePrescribedExercises(prescriptionText);
  const oneTap = canLogAsPrescribed(exercises);
  const formHref = `/gym/log?hpeSession=${encodeURIComponent(sessionId)}`;

  if (activityId) {
    return (
      <div className={cn("mt-4 flex flex-wrap items-center gap-2", className)}>
        <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gym-accent/30 bg-gym-accent/10 px-2.5 text-xs font-medium text-gym-accent">
          <Check className="h-3 w-3" aria-hidden />
          Logged
        </span>
        <Link
          href={`/activities/${activityId}`}
          className="inline-flex min-h-[36px] items-center text-xs font-medium text-accent hover:text-accent/80"
        >
          See the session
        </Link>
      </div>
    );
  }

  if (phase === "queued") {
    return (
      <p className={cn("mt-4 text-xs text-muted", className)}>
        {message ?? "Saved on this phone. It will be sent when you are back online."}
      </p>
    );
  }

  async function logAsPrescribed() {
    const payload = buildPrescribedActivityPayload({
      sessionId,
      prescriptionText,
      title,
      startedAt: prescribedStartedAt(sessionDate, offsetDays),
      minutes,
    });
    if (!payload) return;
    setPhase("saving");
    setMessage(null);
    try {
      const result = await submitActivityRequest("/api/activities", "POST", payload);
      if (!result.ok) {
        setPhase("failed");
        setMessage(result.error);
        return;
      }
      if (result.queued) {
        setPhase("queued");
        setMessage(result.message);
        return;
      }
      const activity = result.data.activity as { id?: string } | undefined;
      const id = activity?.id ?? (result.data.activity_id as string | undefined);
      if (id) onLogged(id);
      setPhase("idle");
    } catch (err) {
      setPhase("failed");
      setMessage(err instanceof Error ? err.message : "That didn't save.");
    }
  }

  return (
    <div className={cn("mt-4", className)}>
      <div className="flex flex-wrap gap-2">
        {oneTap && (
          <button
            type="button"
            disabled={phase === "saving"}
            onClick={logAsPrescribed}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-gym-accent px-4 text-sm font-semibold text-background transition-opacity",
              phase === "saving" && "opacity-60"
            )}
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden />
            {phase === "saving" ? "Logging…" : "Log as prescribed"}
          </button>
        )}
        <Link
          href={formHref}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition-colors",
            oneTap
              ? "border-white/10 text-foreground/90 hover:border-white/20"
              : "border-gym-accent/40 bg-gym-accent/10 text-gym-accent hover:bg-gym-accent/15"
          )}
        >
          <PenLine className="h-4 w-4" aria-hidden />
          {oneTap ? "Edit, then log" : "Open in Lab"}
        </Link>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {oneTap
          ? "One tap logs every set as written. Edit instead if anything differed."
          : "Some loads need your number — the form opens with the reps filled in."}
      </p>
      {phase === "failed" && (
        <p className="mt-1.5 text-xs text-danger">{message ?? "That didn't save. Try again when you have signal."}</p>
      )}
    </div>
  );
}
