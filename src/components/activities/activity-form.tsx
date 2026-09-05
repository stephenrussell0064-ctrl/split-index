"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeft, Check, CloudUpload, RotateCcw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SPORTS, SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { derivePaceSecPerKm, isEnduranceSport } from "@/lib/scoring/engine";
import {
  formatPaceBenchmarkContext,
  formatPowerBenchmarkContext,
  formatStrengthHeadline,
} from "@/lib/utils/scoring-display";
import { cn } from "@/lib/utils/cn";
import type { ExperienceLevel, Gender, SportType } from "@/types";
import { DeleteActivityModal } from "./delete-activity-modal";
import {
  createDefaultState,
  isStateDirty,
  restoreDraftState,
  validateAndBuildPayload,
  totalDurationSeconds,
  splitSecondsFromState,
  parseNum,
  summarizeErrors,
  SPORT_FIELDS,
  type FormErrors,
  type WorkoutFormState,
} from "./form-state";
import { SportPicker } from "./sport-picker";
import { CardioSportPicker } from "./cardio-sport-picker";
import { SportForm, type UpdateField } from "./sport-form";
import { SuccessScreen, type ScoreResultSummary } from "./success-screen";
import { useDraftAutosave, type DraftStatus } from "./use-autosave";
import { useKeyboardInset, useKeyboardSafeFocus } from "./use-keyboard";
import { LogQuickActions } from "./log-quick-actions";
import { submitActivityRequest } from "@/lib/activities/submit-activity";
import type { CardioEnrichment } from "@/lib/scoring/cardio";
import { useSetModeOverride } from "@/components/layout/mode-override-context";
import { endLiveActivity } from "@/lib/native/live-activity";
import { clearPersistedGymTimerState } from "./gym-workout-timer";

type View = "picker" | "form" | "success";

/**
 * Which submit-time error key a state field maps to, for clearing on edit.
 *
 * Every field that can raise an error has to appear here, or its error outlives
 * the fix: the athlete corrects the number, the red text stays, and the form
 * looks broken. The whole interval and fartlek block was missing — those
 * fields raise errors under their own names in validateAndBuildPayload, so
 * "Reps is required" survived typing the reps.
 */
const ERROR_KEY_MAP: Partial<Record<keyof WorkoutFormState, string>> = {
  hours: "duration",
  minutes: "duration",
  seconds: "duration",
  splitMinutes: "split",
  splitSeconds: "split",
  startedAt: "startedAt",
  distance: "distance",
  elevation: "elevation",
  avgHr: "avgHr",
  avgPower: "avgPower",
  temperature: "temperature",
  rpe: "rpe",
  bodyweight: "bodyweight",
  intervalReps: "intervalReps",
  intervalWorkDistance: "intervalWorkDistance",
  intervalWorkSeconds: "intervalWorkSeconds",
  intervalRestSeconds: "intervalRestSeconds",
  intervalWorkHr: "intervalWorkHr",
  fartlekOnDistance: "fartlekOnDistance",
  fartlekOnSeconds: "fartlekOnSeconds",
  fartlekOnHr: "fartlekOnHr",
};

const sportIndexOf = (sport: SportType) => SPORTS.findIndex((s) => s.id === sport);

function distanceMetersFromState(state: WorkoutFormState, sport: SportType): number | null {
  const raw = parseNum(state.distance);
  if (raw === null) return null;
  const unit = SPORT_FIELDS[sport].distance;
  return unit === "km" ? Math.round(raw * 1000) : Math.round(raw);
}

const slideVariants = {
  enter: (direction: number) => ({ opacity: 0, x: 64 * direction }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: -64 * direction }),
};

export function ActivityForm({
  profileWeightKg,
  initialDrafts,
  isPremium = false,
  initialSport = null,
  initialRepeatState,
  mode = "create",
  activityId,
  initialEditState,
  editActivityTitle,
  profileScoringSex = null,
  profileExperience = null,
  zoneMode = "generic",
  enduranceOnly = false,
  successRedirect,
}: {
  profileWeightKg?: number | null;
  initialDrafts?: Partial<Record<SportType, unknown>>;
  isPremium?: boolean;
  initialSport?: SportType | null;
  initialRepeatState?: WorkoutFormState;
  mode?: "create" | "edit";
  activityId?: string;
  initialEditState?: WorkoutFormState;
  editActivityTitle?: string;
  profileScoringSex?: Gender | null;
  profileExperience?: ExperienceLevel | null;
  zoneMode?: "gym" | "cardio" | "generic";
  enduranceOnly?: boolean;
  successRedirect?: string;
}) {
  const isEdit = mode === "edit";
  const editSport = isEdit && initialEditState ? initialSport : null;
  const openFormInitially = isEdit || Boolean(initialSport);

  const [view, setView] = useState<View>(openFormInitially ? "form" : "picker");
  const [sport, setSport] = useState<SportType | null>(editSport ?? initialSport ?? null);
  // The generic log/edit pages (/activities/new, /activities/[id]/edit)
  // host both gym and cardio sports on one pathname, so app-shell.tsx's
  // pathname-based theming can't tell them apart — this registers an
  // override so the shell themes off whatever's actually selected instead
  // (user-reported: cardio sports stayed on the dark gym theme here).
  // zoneMode !== "generic" means the pathname already encodes the mode
  // (/gym/log, /cardio/log), so no override is needed there.
  useSetModeOverride(
    zoneMode === "generic" ? (sport === "gym" ? "gym" : sport ? "cardio" : null) : null
  );
  const [direction, setDirection] = useState(1);
  const [stateMap, setStateMap] = useState<Partial<Record<SportType, WorkoutFormState>>>(() => {
    if (initialSport && initialRepeatState) {
      return { [initialSport]: initialRepeatState };
    }
    return {};
  });
  const [serverDrafts, setServerDrafts] = useState<Partial<Record<SportType, unknown>>>(
    initialDrafts ?? {}
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [restoredSport, setRestoredSport] = useState<SportType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResultSummary | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const initialSportApplied = useRef(false);
  const editStateApplied = useRef(false);

  useEffect(() => {
    if (!isEdit || !editSport || !initialEditState || editStateApplied.current) return;
    editStateApplied.current = true;
    setStateMap((prev) => ({ ...prev, [editSport]: initialEditState }));
  }, [isEdit, editSport, initialEditState]);

  const currentState = sport ? stateMap[sport] ?? null : null;
  const {
    status: draftStatus,
    lastSavedAt,
    flush,
    retry: retryDraft,
  } = useDraftAutosave(sport, currentState, view === "form" && !isEdit);

  // User complaint: "loses my place... keyboard covering fields." See
  // use-keyboard.ts — on iOS the keyboard shrinks only the visual viewport, so
  // neither the sticky submit bar nor the browser's own scroll-into-view
  // knows anything has happened.
  const formRef = useRef<HTMLDivElement | null>(null);
  const keyboardInset = useKeyboardInset();
  useKeyboardSafeFocus(formRef);

  // User feedback: "if you click off the lab onto another tab within split
  // index when u are logging an exercise it stops the timer and resets all
  // your logged details." The autosave above is debounced (900ms) — any
  // edit made less than 900ms before navigating away used to be lost,
  // since the pending timer is simply cancelled (not fired) on unmount.
  // Flushing on unmount (a same-tab route change to another part of the
  // app unmounts this component) and on visibilitychange/pagehide (the
  // app being backgrounded or the tab switched, which doesn't unmount
  // anything) closes that window — the very last keystroke is saved
  // before the page can go away, not just whatever was already debounced.
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden") flush();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const selectSport = useCallback(
    (next: SportType) => {
      flush();
      setDirection(sport ? (sportIndexOf(next) >= sportIndexOf(sport) ? 1 : -1) : 1);
      if (!stateMap[next]) {
        const draft = serverDrafts[next];
        const hydrated = draft
          ? restoreDraftState(next, draft, profileWeightKg)
          : createDefaultState(next, profileWeightKg);
        setStateMap((prev) => ({ ...prev, [next]: hydrated }));
        if (draft) setRestoredSport(next);
      }
      setErrors({});
      setSubmitError(null);
      setSport(next);
      setView("form");
    },
    [flush, sport, stateMap, serverDrafts, profileWeightKg]
  );

  useEffect(() => {
    if (!restoredSport) return;
    const timer = setTimeout(() => setRestoredSport(null), 2600);
    return () => clearTimeout(timer);
  }, [restoredSport]);

  useEffect(() => {
    if (isEdit || !initialSport || initialSportApplied.current || initialRepeatState) return;
    initialSportApplied.current = true;
    selectSport(initialSport);
  }, [initialSport, initialRepeatState, selectSport, isEdit]);

  function buildScoreSummary(
    data: Record<string, unknown>,
    currentSport: SportType,
    formState: WorkoutFormState
  ): ScoreResultSummary {
    const sportIndex = (data.sportIndex ??
      (data.score as { sport_index?: number } | undefined)?.sport_index ??
      0) as number;
    const exerciseScores = data.exerciseScores as
      | Array<{ name: string; estimated1RM: number; relativeStrength: number }>
      | undefined;

    let benchmarkContext: string | null = null;
    let strengthContext: string | null = null;

    if (currentSport === "gym" && exerciseScores?.length) {
      const dots = data.dotsScore as number | undefined;
      const gl = data.glPoints as number | undefined;
      const useGL = (data.useGL as boolean | undefined) ?? false;
      if (dots) {
        strengthContext = formatStrengthHeadline(dots, useGL, gl);
      }
    } else if (isEnduranceSport(currentSport)) {
      const pace = derivePaceSecPerKm(
        currentSport,
        totalDurationSeconds(formState),
        distanceMetersFromState(formState, currentSport),
        null,
        splitSecondsFromState(formState)
      );
      if (pace > 0) {
        benchmarkContext = formatPaceBenchmarkContext(
          currentSport,
          pace,
          profileScoringSex,
          profileExperience
        );
      }
      const power = parseNum(formState.avgPower);
      const bw = parseNum(formState.bodyweight) ?? profileWeightKg;
      if (
        (currentSport === "bike_erg" ||
          currentSport === "indoor_cycling" ||
          currentSport === "outdoor_cycling") &&
        power &&
        bw
      ) {
        benchmarkContext = formatPowerBenchmarkContext(power / bw);
      }
    }

    return {
      sport: currentSport,
      sportLabel: SPORT_INDEX_LABELS[currentSport],
      sportIndex,
      splitIndex: (data.splitIndex ?? 0) as number,
      previousSplitIndex: (data.previousSplitIndex ?? data.splitIndex ?? 0) as number,
      splitIndexDelta: (data.splitIndexDelta ?? 0) as number,
      enduranceIndex: (data.enduranceIndex ?? 0) as number,
      strengthIndex: (data.strengthIndex ?? 0) as number,
      sportComparison: (data.sportComparison ?? {
        history: [],
        average: sportIndex,
        percentile: 50,
        deltaVsAverage: 0,
        rank: 1,
        total: 0,
      }) as ScoreResultSummary["sportComparison"],
      isFirstSportSession: (data.isFirstSportSession ?? true) as boolean,
      benchmarkContext,
      strengthContext,
      splitBreakdownLabel: (data.splitBreakdownLabel as string | undefined) ?? null,
      dotsScore: (data.dotsScore as number | undefined) ?? null,
      glPoints: (data.glPoints as number | undefined) ?? null,
      useGL: (data.useGL as boolean | undefined) ?? false,
      scoreBreakdown: data.scoreBreakdown as ScoreResultSummary["scoreBreakdown"],
      cardioEnrichment: data.cardioEnrichment as CardioEnrichment | undefined,
      tier1Prediction: data.tier1Prediction as ScoreResultSummary["tier1Prediction"],
      predictedBenchmarkAfterSession:
        data.predictedBenchmarkAfterSession as ScoreResultSummary["predictedBenchmarkAfterSession"],
      sessionType: formState.sessionType,
    };
  }

  const updateField: UpdateField = useCallback(
    (key, value) => {
      if (!sport) return;
      setStateMap((prev) => {
        const current = prev[sport];
        if (!current) return prev;
        return { ...prev, [sport]: { ...current, [key]: value } };
      });
      setErrors((prev) => {
        if (Object.keys(prev).length === 0) return prev;
        const next = { ...prev };
        delete next.form;
        if (key === "exercises") {
          for (const k of Object.keys(next)) {
            if (k.startsWith("ex.") || k === "exercises") delete next[k];
          }
        } else if (key === "intervalBlocks") {
          // Block errors are keyed by block id (`ivl.<id>.<field>`), so there
          // is no single mapped name to delete — any edit to the structure
          // clears them all and lets the next submit re-derive.
          for (const k of Object.keys(next)) {
            if (k.startsWith("ivl.")) delete next[k];
          }
        } else {
          const mapped = ERROR_KEY_MAP[key];
          if (mapped) delete next[mapped];
        }
        return next;
      });
    },
    [sport]
  );

  const applyFormState = useCallback(
    (nextState: WorkoutFormState) => {
      if (!sport) return;
      setStateMap((prev) => ({ ...prev, [sport]: nextState }));
      setErrors({});
    },
    [sport]
  );

  const saveAsTemplate = async (name: string) => {
    if (!sport || !currentState) return;
    setSavingTemplate(true);
    try {
      await fetch("/api/session-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sport,
          template_data: currentState,
        }),
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSubmit = async () => {
    if (!sport || !currentState || submitting) return;
    setSubmitError(null);

    const { errors: validationErrors, payload } = validateAndBuildPayload(
      sport,
      currentState
    );
    if (!payload) {
      setErrors(validationErrors);
      setSubmitError("A few fields need attention before we can score this.");
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const url = isEdit && activityId ? `/api/activities/${activityId}` : "/api/activities";
      const method = isEdit ? "PATCH" : "POST";
      const result = await submitActivityRequest(url, method, payload);

      if (!result.ok) {
        throw new Error(result.error);
      }

      if (result.queued) {
        setSubmitError(result.message);
        return;
      }

      const data = result.data;
      setResult(buildScoreSummary(data, sport, currentState));
      // Server deletes the draft on successful submit; mirror that locally.
      setStateMap((prev) => {
        const next = { ...prev };
        delete next[sport];
        return next;
      });
      setServerDrafts((prev) => {
        const next = { ...prev };
        delete next[sport];
        return next;
      });
      // User feedback: "the widget timer for the lab does not stop when
      // the timer is stopped in app, i want the widget to be removed once
      // it's finished being used in app" — a gym workout just got
      // successfully saved, so any lingering Live Activity is done with,
      // regardless of whether the timer component itself is still mounted
      // or thinks one is running. Safe no-op for every other sport/when
      // none is active (see live-activity.ts).
      if (sport === "gym") {
        void endLiveActivity();
        clearPersistedGymTimerState();
      }
      setView("success");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save workout");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    if (!sport) return;
    setStateMap((prev) => ({
      ...prev,
      [sport]: createDefaultState(sport, profileWeightKg),
    }));
    setServerDrafts((prev) => {
      const next = { ...prev };
      delete next[sport];
      return next;
    });
    setErrors({});
    setSubmitError(null);
    void fetch(`/api/activities/draft?sport=${sport}`, { method: "DELETE" });
  };

  const backToPicker = () => {
    flush();
    setErrors({});
    setSubmitError(null);
    setView("picker");
  };

  const logAnother = () => {
    setResult(null);
    setSport(null);
    setView("picker");
  };

  const draftSports = SPORTS.map((s) => s.id).filter(
    (id) =>
      serverDrafts[id] !== undefined ||
      (stateMap[id] !== undefined && isStateDirty(stateMap[id]!))
  );

  const activeSportMeta = sport ? SPORTS[sportIndexOf(sport)] : null;

  return (
    <div
      className={cn(
        "mx-auto max-w-3xl",
        sport === "gym" && view === "form" && "rounded-3xl",
        sport !== "gym" && sport && view === "form" && "rounded-3xl"
      )}
    >
      <AnimatePresence mode="wait">
        {view === "picker" && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
          >
            {enduranceOnly ? (
              <CardioSportPicker onSelect={selectSport} draftSports={draftSports} />
            ) : (
              <SportPicker onSelect={selectSport} draftSports={draftSports} />
            )}
          </motion.div>
        )}

        {view === "form" && sport && currentState && (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
          >
            {/* Header */}
            <div className="mb-6">
              {!isEdit && zoneMode === "generic" ? (
                <button
                  type="button"
                  onClick={backToPicker}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground min-h-[44px]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  All sports
                </button>
              ) : !isEdit && enduranceOnly ? (
                <button
                  type="button"
                  onClick={backToPicker}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground min-h-[44px]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Change sport
                </button>
              ) : !isEdit ? (
                <Link
                  href={zoneMode === "gym" ? "/gym" : "/cardio"}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground min-h-[44px]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to {zoneMode === "gym" ? "The Lab" : "The Engine"}
                </Link>
              ) : (
                <Link
                  href={activityId ? `/activities/${activityId}` : "/activities"}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground min-h-[44px]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to activity
                </Link>
              )}

              <div
                className={cn(
                  "rounded-2xl p-4 mb-4",
                  activeSportMeta?.category === "strength"
                    ? "bg-gym-zone/40 border border-gym-border"
                    : "bg-cardio-zone/20 border border-cardio-border"
                )}
              >
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p
                      className={cn(
                        "micro-label mb-1",
                        activeSportMeta?.category === "strength"
                          ? "text-gym-accent"
                          : "text-cardio-accent"
                      )}
                    >
                      {activeSportMeta?.category === "strength" ? "The Lab" : "The Engine"}
                    </p>
                    <h1 className="headline-tight text-2xl font-bold tracking-tight sm:text-3xl">
                      {activeSportMeta?.icon}{" "}
                      <span className="ml-1">{activeSportMeta?.name}</span>
                    </h1>
                  </div>
                <div className="flex flex-col items-end gap-1.5">
                  {/* The live save state lives in the sticky submit bar now
                      (SaveState there) — pinned to the bottom of the screen,
                      it stays visible while the athlete is thirty set rows
                      down, which is exactly when "did that save?" gets asked.
                      This header keeps only the one-off restore notice. */}
                  {restoredSport === sport && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
                      <CloudUpload className="h-3.5 w-3.5 text-accent" />
                      Draft restored
                    </span>
                  )}
                  {isStateDirty(currentState) && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted/70 transition-colors hover:text-foreground"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset
                    </button>
                  )}
                </div>
                </div>
              </div>
            </div>

            {!isEdit && (
              <LogQuickActions
                sport={sport}
                onApplyState={applyFormState}
                onSaveTemplate={saveAsTemplate}
                savingTemplate={savingTemplate}
                dirty={isStateDirty(currentState)}
              />
            )}

            {/* Sport switcher strip — generic create mode only */}
            {!isEdit && zoneMode === "generic" && (
            <div className="mb-6 flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {SPORTS.map((s) => {
                const active = s.id === sport;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => selectSport(s.id)}
                    aria-label={s.name}
                    title={s.name}
                    className={cn(
                      "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg transition-colors",
                      active ? "" : "opacity-50 hover:opacity-90 hover:bg-white/5"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="sport-switcher-active"
                        className="absolute inset-0 rounded-xl glass border border-accent/40 shadow-[0_0_24px_-6px_var(--accent-glow)]"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                      />
                    )}
                    <span className="relative">{s.icon}</span>
                  </button>
                );
              })}
            </div>
            )}

            {/* Sport-specific form with directional transition */}
            <div ref={formRef} className="relative overflow-x-clip">
              <AnimatePresence mode="popLayout" custom={direction} initial={false}>
                <motion.div
                  key={sport}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                >
                  <SportForm
                    sport={sport}
                    state={currentState}
                    errors={errors}
                    onUpdate={updateField}
                    profileScoringSex={profileScoringSex}
                  />
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Submit — sticky on mobile, and it has to STAY reachable while
                the keyboard is up. `bottom` is resolved against the layout
                viewport, which iOS does not shrink for the keyboard, so the
                class below would leave this bar buried underneath it. Lifting
                it by the measured inset (0 on Android, where the layout
                viewport already shrank) puts it just above the keys, where
                "Score workout" and the save state are both still tappable and
                readable mid-typing. */}
            <div
              style={keyboardInset > 0 ? { bottom: keyboardInset + 8 } : undefined}
              className="mode-surface-elevated sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4 z-20 -mx-1 mt-6 space-y-3 rounded-2xl border border-white/[0.08] p-4 backdrop-blur-md lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <AnimatePresence initial={false}>
                {submitError && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={{ opacity: 0, y: 6, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                      <div className="flex items-center gap-2.5">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {submitError}
                      </div>
                      <ErrorSummary errors={errors} state={currentState} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <Button
                className="w-full min-h-[52px] text-base"
                size="lg"
                loading={submitting}
                onClick={handleSubmit}
              >
                <Zap className="h-4 w-4" />
                {isEdit ? "Save changes" : "Score workout"}
              </Button>
              {!isEdit && (
                <SaveState
                  status={draftStatus}
                  lastSavedAt={lastSavedAt}
                  dirty={isStateDirty(currentState)}
                  onRetry={retryDraft}
                />
              )}
              {isEdit && activityId && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-danger hover:text-danger hover:bg-danger/10"
                  onClick={() => setShowDeleteModal(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete activity
                </Button>
              )}
            </div>
            {isEdit && activityId && (
              <DeleteActivityModal
                activityId={activityId}
                activityTitle={editActivityTitle ?? sport ?? "Activity"}
                open={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
              />
            )}
          </motion.div>
        )}

        {view === "success" && result && (
          <motion.div
            key="success"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <SuccessScreen
              result={result}
              onLogAnother={logAnother}
              isPremium={isPremium}
              skipRedirect={isEdit}
              redirectPath={successRedirect ?? (zoneMode === "gym" ? "/gym" : zoneMode === "cardio" ? "/cardio" : "/dashboard")}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * What is actually wrong, and where it is.
 *
 * User-reported: "a validation error blocks saving a gym activity" — with the
 * only feedback being "A few fields need attention before we can score this."
 * On a workout long enough to need scrolling, that sentence is unactionable:
 * the field it means may be six screens up, and the red border marking it is
 * off screen with it. This lists each problem by name, and tapping one takes
 * the athlete to the field, focused and ready to type.
 *
 * Anchoring is generic on purpose — it finds the first `[aria-invalid="true"]`
 * rather than needing every field in two zones to register an id — so a field
 * added later is covered automatically as long as it marks itself invalid.
 */
function ErrorSummary({
  errors,
  state,
}: {
  errors: FormErrors;
  state: WorkoutFormState;
}) {
  const items = summarizeErrors(errors, state);
  if (items.length === 0) return null;

  const goToFirstInvalid = () => {
    const target = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!target) return;
    target.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    // Focus after the scroll settles, so the keyboard opening doesn't fight
    // the scroll for the same screen.
    setTimeout(() => target.focus({ preventScroll: true }), 320);
  };

  return (
    <div className="mt-2 border-t border-danger/20 pt-2">
      <ul className="space-y-0.5 text-[12px]">
        {items.slice(0, 5).map((item) => (
          <li key={item.key} className="flex flex-wrap gap-x-1.5">
            <span className="font-semibold">{item.label}</span>
            <span className="text-danger/80">{item.message}</span>
          </li>
        ))}
        {items.length > 5 && (
          <li className="text-danger/70">and {items.length - 5} more</li>
        )}
      </ul>
      <button
        type="button"
        onClick={goToFirstInvalid}
        className="mt-1.5 min-h-[36px] text-[12px] font-semibold underline underline-offset-2"
      >
        Take me to the first one
      </button>
    </div>
  );
}

/**
 * Whether the work on screen is safe, said continuously.
 *
 * User complaint: "unclear whether it saved." The old indicator lit up
 * "Draft saved" for 2.2 seconds and then deleted itself, so the honest reading
 * of the screen for the other 57 seconds of every minute was "nothing has been
 * saved". It also lived in the page header, which is off screen the moment you
 * scroll into the sets — precisely when the doubt arrives. This sits in the
 * sticky bar and keeps counting ("Saved · 40s ago"), never blanks itself while
 * there is something to report, and a failure offers a way back instead of
 * quietly showing nothing.
 */
function SaveState({
  status,
  lastSavedAt,
  dirty,
  onRetry,
}: {
  status: DraftStatus;
  lastSavedAt: number | null;
  dirty: boolean;
  onRetry: () => void;
}) {
  // Re-render on a slow tick so "just now" becomes "1m ago" on its own rather
  // than freezing at whatever it said when the last keystroke landed.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== "saved") return;
    const timer = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(timer);
  }, [status]);

  if (status === "error") {
    return (
      <div className="flex items-center justify-center gap-2 text-[11px] font-medium text-danger">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Couldn&apos;t save your draft</span>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[32px] rounded-md px-2 font-semibold underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (status === "saving") {
    return (
      <p
        aria-live="polite"
        className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        Saving your draft…
      </p>
    );
  }

  if (status === "saved" && lastSavedAt) {
    return (
      <p
        aria-live="polite"
        className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted"
      >
        <Check className="h-3.5 w-3.5 text-success" aria-hidden />
        Draft saved {formatAgo(lastSavedAt)} — safe to close the app
      </p>
    );
  }

  if (dirty) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted/70">
        <CloudUpload className="h-3.5 w-3.5" aria-hidden />
        Saving automatically as you type
      </p>
    );
  }

  return null;
}

function formatAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 20) return "just now";
  if (seconds < 90) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}
