"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeft, Check, CloudUpload, RotateCcw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SPORTS, SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { derivePaceSecPerKm, isEnduranceSport } from "@/lib/scoring/engine";
import {
  buildExerciseScoreDisplays,
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
  SPORT_FIELDS,
  type FormErrors,
  type WorkoutFormState,
} from "./form-state";
import { SportPicker } from "./sport-picker";
import { CardioSportPicker } from "./cardio-sport-picker";
import { SportForm, type UpdateField } from "./sport-form";
import { SuccessScreen, type ScoreResultSummary } from "./success-screen";
import { useDraftAutosave, type DraftStatus } from "./use-autosave";
import { LogQuickActions } from "./log-quick-actions";
import { FileImportDropzone } from "./file-import-dropzone";
import type { CardioEnrichment } from "@/lib/scoring/cardio";

type View = "picker" | "form" | "success";

/** Which submit-time error key a state field maps to, for clearing on edit. */
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
  profileGender = null,
  profileExperience = null,
  zoneMode = "generic",
  enduranceOnly = false,
  showFileImport = false,
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
  profileGender?: Gender | null;
  profileExperience?: ExperienceLevel | null;
  zoneMode?: "gym" | "cardio" | "generic";
  enduranceOnly?: boolean;
  showFileImport?: boolean;
  successRedirect?: string;
}) {
  const isEdit = mode === "edit";
  const editSport = isEdit && initialEditState ? initialSport : null;
  const openFormInitially = isEdit || Boolean(initialSport);

  const [view, setView] = useState<View>(openFormInitially ? "form" : "picker");
  const [sport, setSport] = useState<SportType | null>(editSport ?? initialSport ?? null);
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
  const { status: draftStatus, flush } = useDraftAutosave(
    sport,
    currentState,
    view === "form" && !isEdit
  );

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
    const exerciseBreakdown = exerciseScores
      ? buildExerciseScoreDisplays(exerciseScores, profileGender, profileExperience)
      : undefined;

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
          profileGender,
          profileExperience
        );
      }
      const power = parseNum(formState.avgPower);
      const bw = parseNum(formState.bodyweight) ?? profileWeightKg;
      if (
        (currentSport === "bike_erg" || currentSport === "indoor_cycling") &&
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
      exerciseBreakdown,
      scoreBreakdown: data.scoreBreakdown as ScoreResultSummary["scoreBreakdown"],
      cardioEnrichment: data.cardioEnrichment as CardioEnrichment | undefined,
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
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save workout");

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
            {showFileImport && (
              <div className="mt-8 rounded-2xl border border-cardio-border/30 p-5">
                <p className="micro-label text-cardio-muted mb-3">Import file</p>
                <FileImportDropzone compact />
              </div>
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
                <a
                  href={zoneMode === "gym" ? "/gym" : "/cardio"}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground min-h-[44px]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to {zoneMode === "gym" ? "The Lab" : "The Engine"}
                </a>
              ) : (
                <a
                  href={activityId ? `/activities/${activityId}` : "/activities"}
                  className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground min-h-[44px]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to activity
                </a>
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
                  <DraftIndicator
                    status={draftStatus}
                    restored={restoredSport === sport}
                  />
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
              />
            )}

            {showFileImport && !isEdit && (
              <div className="mb-6">
                <FileImportDropzone sport={sport} compact />
              </div>
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
            <div className="relative overflow-x-clip">
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
                  />
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Submit — sticky on mobile */}
            <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4 z-20 -mx-1 mt-6 space-y-3 rounded-2xl border border-white/[0.08] bg-background/95 p-4 backdrop-blur-md lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <AnimatePresence initial={false}>
                {submitError && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={{ opacity: 0, y: 6, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-2.5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {submitError}
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

function DraftIndicator({
  status,
  restored,
}: {
  status: DraftStatus;
  restored: boolean;
}) {
  let content: React.ReactNode = null;
  let key = "none";

  if (restored) {
    key = "restored";
    content = (
      <>
        <CloudUpload className="h-3.5 w-3.5 text-accent" />
        <span>Draft restored</span>
      </>
    );
  } else if (status === "saving") {
    key = "saving";
    content = (
      <>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        <span>Saving…</span>
      </>
    );
  } else if (status === "saved") {
    key = "saved";
    content = (
      <>
        <Check className="h-3.5 w-3.5 text-success" />
        <span>Draft saved</span>
      </>
    );
  }

  return (
    <div className="flex h-6 items-center">
      <AnimatePresence mode="wait">
        {content && (
          <motion.span
            key={key}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted"
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
