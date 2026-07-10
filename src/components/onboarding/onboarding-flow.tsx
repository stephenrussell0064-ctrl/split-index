"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Sparkles, Target, TrendingUp, Dumbbell, Activity, Check, X, Loader2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  EXPERIENCE_LEVELS,
  TRAINING_GOALS,
  GENDERS,
  SPORTS,
} from "@/lib/constants/sports";
import { createClient } from "@/lib/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase/errors";
import { formatIndex } from "@/lib/utils/format";
import { validateUsernameFormat } from "@/lib/utils/username";
import { cn } from "@/lib/utils/cn";
import type { PostgrestError } from "@supabase/supabase-js";
import type { Gender, ExperienceLevel, TrainingGoal, SportType } from "@/types";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

const STEPS = ["Basics", "Body", "Training", "Sports", "Your Goal", "Ready"];

const DEFAULT_GOAL_TARGET = 650;

const LIMITS = {
  age: { min: 13, max: 120 },
  height_cm: { min: 100, max: 250 },
  weight_kg: { min: 30, max: 300 },
  max_hr: { min: 100, max: 230 },
  training_history_years: { min: 0, max: 80 },
};

function inRange(value: string, { min, max }: { min: number; max: number }) {
  const n = Number(value);
  return value !== "" && !Number.isNaN(n) && n >= min && n <= max;
}

export function OnboardingFlow() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [targetIndex, setTargetIndex] = useState(DEFAULT_GOAL_TARGET);
  const [username, setUsername] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState("");
  // Result of the debounced availability fetch, tagged with the username it
  // was issued for — only trusted when it matches the *current* value, so a
  // stale response for a since-edited username can't flash "available".
  const [asyncCheck, setAsyncCheck] = useState<{
    forUsername: string;
    status: "available" | "taken" | "error";
    reason?: string;
  } | null>(null);
  const [form, setForm] = useState({
    age: "",
    gender: "" as Gender | "",
    height_cm: "",
    weight_kg: "",
    max_hr: "",
    experience: "" as ExperienceLevel | "",
    training_history_years: "",
    goals: [] as TrainingGoal[],
    preferred_sports: [] as SportType[],
  });

  const trimmedUsername = username.trim();
  const usernameFormat = trimmedUsername ? validateUsernameFormat(trimmedUsername) : null;

  useEffect(() => {
    if (!trimmedUsername || !usernameFormat?.valid) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/profile/username-check?u=${encodeURIComponent(trimmedUsername)}`
        );
        const data = await res.json();
        if (cancelled) return;
        setAsyncCheck({
          forUsername: trimmedUsername,
          status: res.ok ? (data.available ? "available" : "taken") : "error",
          reason: data.reason ?? data.error,
        });
      } catch {
        if (cancelled) return;
        setAsyncCheck({
          forUsername: trimmedUsername,
          status: "error",
          reason: "Could not check availability",
        });
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- usernameFormat is derived from trimmedUsername each render
  }, [trimmedUsername]);

  const usernameStatus: UsernameStatus = !trimmedUsername
    ? "idle"
    : !usernameFormat!.valid
      ? "invalid"
      : asyncCheck?.forUsername === trimmedUsername
        ? asyncCheck.status === "error"
          ? "invalid"
          : asyncCheck.status
        : "checking";
  const usernameReason = !trimmedUsername
    ? undefined
    : !usernameFormat!.valid
      ? usernameFormat!.reason
      : asyncCheck?.forUsername === trimmedUsername
        ? asyncCheck.reason
        : undefined;

  const handleAvatarSelect = (file: File | null) => {
    setAvatarError("");
    if (!file) {
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      return;
    }
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError("Use a PNG, JPEG, WebP, or GIF image");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("Image must be under 2MB");
      return;
    }
    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
  };

  const update = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validateStep = (current: number): boolean => {
    const next: Record<string, string> = {};

    if (current === 0) {
      if (!inRange(form.age, LIMITS.age))
        next.age = `Enter an age between ${LIMITS.age.min} and ${LIMITS.age.max}`;
      if (!form.gender) next.gender = "Select a gender";
      if (usernameStatus !== "available") {
        next.username =
          usernameStatus === "checking"
            ? "Still checking availability…"
            : (usernameReason ?? "Choose a username for the leaderboard");
      }
      if (avatarError) next.avatar = avatarError;
    }

    if (current === 1) {
      if (!inRange(form.height_cm, LIMITS.height_cm))
        next.height_cm = `Enter a height between ${LIMITS.height_cm.min} and ${LIMITS.height_cm.max} cm`;
      if (!inRange(form.weight_kg, LIMITS.weight_kg))
        next.weight_kg = `Enter a weight between ${LIMITS.weight_kg.min} and ${LIMITS.weight_kg.max} kg`;
      if (form.max_hr !== "" && !inRange(form.max_hr, LIMITS.max_hr))
        next.max_hr = `Max heart rate must be between ${LIMITS.max_hr.min} and ${LIMITS.max_hr.max}`;
    }

    if (current === 2) {
      if (!form.experience) next.experience = "Select an experience level";
      if (
        form.training_history_years !== "" &&
        !inRange(form.training_history_years, LIMITS.training_history_years)
      )
        next.training_history_years = "Enter a value between 0 and 80";
      if (form.goals.length === 0) next.goals = "Pick at least one goal";
    }

    if (current === 3 && form.preferred_sports.length === 0) {
      next.preferred_sports = "Pick at least one sport";
    }

    if (current === 4) {
      if (targetIndex < 350 || targetIndex > 999) {
        next.target = "Target must be between 350 and 999";
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleContinue = () => {
    if (validateStep(step)) setStep(step + 1);
  };

  const toggleGoal = (goal: TrainingGoal) => {
    update(
      "goals",
      form.goals.includes(goal)
        ? form.goals.filter((g) => g !== goal)
        : [...form.goals, goal]
    );
  };

  const toggleSport = (sport: SportType) => {
    update(
      "preferred_sports",
      form.preferred_sports.includes(sport)
        ? form.preferred_sports.filter((s) => s !== sport)
        : [...form.preferred_sports, sport]
    );
  };

  const handleComplete = async () => {
    if (!validateStep(step)) return;

    setLoading(true);
    setSubmitError("");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    if (!form.gender || !form.experience) {
      setSubmitError("Please go back and complete all required fields.");
      setLoading(false);
      return;
    }

    const ensureRes = await fetch("/api/profile/ensure", { method: "POST" });
    if (!ensureRes.ok) {
      const body = (await ensureRes.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      setSubmitError(
        supabaseErrorMessage("Could not save your profile. Please try again.", {
          message:
            body.error ??
            "Profile table missing — run supabase/migrations in the Supabase SQL editor.",
          code: body.code ?? "",
          details: "",
          hint: "",
          name: "PostgrestError",
        } as PostgrestError)
      );
      setLoading(false);
      return;
    }

    let avatarUrl: string | null = null;
    if (avatarFile) {
      const ext = avatarFile.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });

      if (uploadError) {
        setSubmitError(`Could not upload your profile icon: ${uploadError.message}`);
        setLoading(false);
        return;
      }

      avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    const profilePayload = {
      user_id: user.id,
      display_name:
        (user.user_metadata?.full_name as string | undefined) ??
        user.email ??
        null,
      username: username.trim(),
      avatar_url: avatarUrl,
      age: Number(form.age),
      gender: form.gender as Gender,
      height_cm: Number(form.height_cm),
      weight_kg: Number(form.weight_kg),
      max_hr: Number(form.max_hr) || Math.round(220 - Number(form.age)),
      experience: form.experience as ExperienceLevel,
      training_history_years: Number(form.training_history_years) || 0,
      goals: form.goals,
      preferred_sports: form.preferred_sports,
      onboarding_completed: true,
    };

    const { data: savedProfile, error: profileError } = await supabase
      .from("profiles")
      .upsert(profilePayload, { onConflict: "user_id" })
      .select("id")
      .single();

    if (profileError?.code === "23505") {
      setAsyncCheck({
        forUsername: trimmedUsername,
        status: "taken",
        reason: "That username was just taken — try another",
      });
      setStep(0);
      setSubmitError("Someone just took that username — please pick another.");
      setLoading(false);
      return;
    }

    if (profileError || !savedProfile) {
      setSubmitError(
        supabaseErrorMessage(
          "Could not save your profile. Please try again.",
          profileError ?? {
            message: "No profile row was saved",
            code: "PGRST116",
            details: "",
            hint: "",
            name: "PostgrestError",
          }
        )
      );
      setLoading(false);
      return;
    }

    const { error: metricsError } = await supabase.from("body_metrics").insert({
      user_id: user.id,
      weight_kg: Number(form.weight_kg),
    });

    if (metricsError) {
      setSubmitError(
        supabaseErrorMessage("Could not save your weight. Please try again.", metricsError)
      );
      setLoading(false);
      return;
    }

    const deadline = new Date();
    deadline.setMonth(deadline.getMonth() + 3);

    const { error: goalError } = await supabase.from("goals").insert({
      user_id: user.id,
      title: `Reach Split Index ${formatIndex(targetIndex)}`,
      target_split_index: targetIndex,
      deadline: deadline.toISOString().slice(0, 10),
    });

    if (goalError) {
      setSubmitError(
        supabaseErrorMessage("Could not save your goal. Please try again.", goalError)
      );
      setLoading(false);
      return;
    }

    localStorage.setItem("split-index-account-created", String(Date.now()));
    router.push("/dashboard");
  };

  const hasGym = form.preferred_sports.includes("gym");
  const hasCardio = form.preferred_sports.some((s) => s !== "gym");

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-8">
        <div className="mb-4 flex gap-2">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i <= step ? "bg-accent shadow-[0_0_8px_var(--accent-glow)]" : "bg-white/[0.08]"
              }`}
            />
          ))}
        </div>
        <p className="mb-1.5 micro-label text-muted">Onboarding</p>
        <h1 className="headline-tight text-2xl font-semibold md:text-3xl">
          {STEPS[step]}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Step {step + 1} of {STEPS.length}
        </p>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={reducedMotion ? false : { opacity: 0, x: 24, filter: "blur(4px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: -24, filter: "blur(4px)" }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          {step < 4 && (
            <Card className="space-y-4 mb-6">
              {step === 0 && (
                <>
                  <div className="flex items-center gap-4">
                    <label className="group relative flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/[0.03]">
                      {avatarPreviewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarPreviewUrl}
                          alt="Profile icon preview"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Camera className="h-5 w-5 text-muted" />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                        <Camera className="h-5 w-5 text-white" />
                      </div>
                      <input
                        type="file"
                        accept={ACCEPTED_AVATAR_TYPES.join(",")}
                        className="hidden"
                        onChange={(e) => handleAvatarSelect(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <div>
                      <p className="text-sm font-medium text-foreground">Profile icon</p>
                      <p className="text-xs text-muted">Optional — shown on the leaderboard</p>
                      {avatarError && <p className="mt-1 text-xs text-danger">{avatarError}</p>}
                    </div>
                  </div>

                  <div>
                    <Input
                      label="Username"
                      value={username}
                      hint="Public — shown on the leaderboard. Letters, numbers, underscore."
                      error={errors.username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                    {username.trim() && !errors.username && (
                      <p
                        className={cn(
                          "mt-1.5 flex items-center gap-1.5 text-xs",
                          usernameStatus === "available" && "text-success",
                          usernameStatus === "taken" && "text-danger",
                          usernameStatus === "checking" && "text-muted"
                        )}
                      >
                        {usernameStatus === "checking" && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        {usernameStatus === "available" && <Check className="h-3 w-3" />}
                        {usernameStatus === "taken" && <X className="h-3 w-3" />}
                        {usernameStatus === "checking" && "Checking availability…"}
                        {usernameStatus === "available" && "Available"}
                        {usernameStatus === "taken" && (usernameReason ?? "Taken")}
                      </p>
                    )}
                  </div>

                  <Input
                    label="Age"
                    type="number"
                    min={LIMITS.age.min}
                    max={LIMITS.age.max}
                    value={form.age}
                    error={errors.age}
                    onChange={(e) => update("age", e.target.value)}
                  />
                  <Select
                    label="Gender"
                    options={[{ value: "", label: "Select…" }, ...GENDERS]}
                    value={form.gender}
                    error={errors.gender}
                    onChange={(e) => update("gender", e.target.value)}
                  />
                </>
              )}

              {step === 1 && (
                <>
                  <Input
                    label="Height (cm)"
                    type="number"
                    min={LIMITS.height_cm.min}
                    max={LIMITS.height_cm.max}
                    value={form.height_cm}
                    error={errors.height_cm}
                    onChange={(e) => update("height_cm", e.target.value)}
                  />
                  <Input
                    label="Weight (kg)"
                    type="number"
                    min={LIMITS.weight_kg.min}
                    max={LIMITS.weight_kg.max}
                    value={form.weight_kg}
                    error={errors.weight_kg}
                    onChange={(e) => update("weight_kg", e.target.value)}
                  />
                  <Input
                    label="Max Heart Rate"
                    type="number"
                    min={LIMITS.max_hr.min}
                    max={LIMITS.max_hr.max}
                    value={form.max_hr}
                    error={errors.max_hr}
                    onChange={(e) => update("max_hr", e.target.value)}
                    hint={`Optional — suggested: ${form.age ? Math.round(220 - Number(form.age)) : "220 - age"}`}
                  />
                </>
              )}

              {step === 2 && (
                <>
                  <Select
                    label="Experience Level"
                    options={[{ value: "", label: "Select…" }, ...EXPERIENCE_LEVELS]}
                    value={form.experience}
                    error={errors.experience}
                    onChange={(e) => update("experience", e.target.value)}
                  />
                  <Input
                    label="Years Training"
                    type="number"
                    step={0.5}
                    min={LIMITS.training_history_years.min}
                    max={LIMITS.training_history_years.max}
                    value={form.training_history_years}
                    error={errors.training_history_years}
                    onChange={(e) => update("training_history_years", e.target.value)}
                  />
                  <div>
                    <p className="text-sm font-medium text-muted mb-2">Goals</p>
                    <div className="flex flex-wrap gap-2">
                      {TRAINING_GOALS.map((g) => (
                        <button
                          key={g.value}
                          type="button"
                          onClick={() => toggleGoal(g.value as TrainingGoal)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                            form.goals.includes(g.value as TrainingGoal)
                              ? "bg-accent text-accent-foreground"
                              : "glass text-muted hover:text-foreground"
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                    {errors.goals && (
                      <p className="text-xs text-danger mt-2">{errors.goals}</p>
                    )}
                  </div>
                </>
              )}

              {step === 3 && (
                <div>
                  <p className="text-sm font-medium text-muted mb-3">
                    Preferred Sports
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {SPORTS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSport(s.id)}
                        className={`flex items-center gap-2 rounded-xl p-3 text-sm transition-colors ${
                          form.preferred_sports.includes(s.id)
                            ? s.category === "strength"
                              ? "bg-gym-accent/20 border border-gym-accent/40 text-foreground"
                              : "bg-cardio-accent/20 border border-cardio-accent/40 text-foreground"
                            : "glass hover:bg-white/5"
                        }`}
                      >
                        <span>{s.icon}</span>
                        {s.name}
                      </button>
                    ))}
                  </div>
                  {errors.preferred_sports && (
                    <p className="text-xs text-danger mt-3">
                      {errors.preferred_sports}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          {step === 4 && (
            <div className="space-y-6 mb-6">
              <Card className="glass-strong holographic-border text-center py-10 px-6 overflow-hidden relative">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgba(99,102,241,0.1),transparent)]"
                />
                <div className="relative">
                  <p className="micro-label text-muted mb-4">Your Split Index</p>
                  <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-white/15 bg-white/[0.03]">
                    <span className="text-3xl font-bold text-muted/40">—</span>
                  </div>
                  <p className="text-lg font-semibold tracking-tight">
                    Earned from your first workout
                  </p>
                  <p className="mt-2 text-sm text-muted max-w-sm mx-auto">
                    No baseline guess. Each sport builds its own index — running vs
                    running, gym vs gym — then blends into your hybrid score.
                  </p>
                  <div className="mt-6 flex justify-center gap-4">
                    {hasGym && (
                      <div className="flex items-center gap-2 text-xs text-gym-accent">
                        <Dumbbell className="h-4 w-4" />
                        Gym Strength Index
                      </div>
                    )}
                    {hasCardio && (
                      <div className="flex items-center gap-2 text-xs text-cardio-accent">
                        <Activity className="h-4 w-4" />
                        Sport-specific endurance
                      </div>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="space-y-4">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-accent" />
                  <p className="text-sm font-semibold">Set your first goal</p>
                </div>
                <Input
                  label="Target Split Index"
                  type="number"
                  min={350}
                  max={999}
                  value={String(targetIndex)}
                  error={errors.target}
                  onChange={(e) => setTargetIndex(Number(e.target.value))}
                  hint="Aspirational target — your composite index builds from logged workouts"
                />
              </Card>
            </div>
          )}

          {step === 5 && (
            <Card className="glass-strong text-center py-12 px-6 mb-6">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", bounce: 0.4 }}
                className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-success/15 border border-success/30"
              >
                <Sparkles className="h-8 w-8 text-success" />
              </motion.div>
              <h2 className="headline-tight text-2xl font-bold">You&apos;re set</h2>
              <p className="mt-2 text-sm text-muted max-w-sm mx-auto">
                Profile locked in · Goal {formatIndex(targetIndex)}. Log your first
                workout to unlock your sport-specific index and start building your
                hybrid score.
              </p>
              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted">
                <TrendingUp className="h-4 w-4 text-accent" />
                Scores update after every session
              </div>
            </Card>
          )}

          {submitError && (
            <p className="text-sm text-danger mb-4">{submitError}</p>
          )}

          <div className="flex gap-3">
            {step > 0 && step < 5 && (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {step < 5 ? (
              <Button className="flex-1" onClick={handleContinue}>
                Continue
              </Button>
            ) : (
              <Button className="flex-1" loading={loading} onClick={handleComplete}>
                Go to Dashboard
              </Button>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
