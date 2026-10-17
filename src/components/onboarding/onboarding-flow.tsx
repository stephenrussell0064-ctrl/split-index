"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Camera, Check, ChevronDown, Compass, HeartPulse, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Typewriter } from "@/components/ui/typewriter";
import { GENDERS, SCORING_BASES, SCORING_BASIS_EXPLANATION, SPORTS } from "@/lib/constants/sports";
import { PRESET_AVATARS } from "@/lib/constants/avatars";
import { createClient } from "@/lib/supabase/client";
import { supabaseErrorMessage } from "@/lib/supabase/errors";
import { validateUsernameFormat } from "@/lib/utils/username";
import { useKeyboardSafeFocus } from "@/components/activities/use-keyboard";
import { ageFromDateOfBirth, maxDobForMinAge, minDobForMaxAge } from "@/lib/utils/age";
import { useIsNativeShell } from "@/lib/native/use-is-native-shell";
import { getNativePlatform } from "@/lib/native/platform";
import { fetchHealthProfile } from "@/lib/native/health-import";
import { connectHealth } from "@/lib/health/sync-client";
import { applyHealthProfile, describePrefill } from "@/lib/health/profile-prefill";
import { impact, success } from "@/lib/native/haptics";
import { startTour } from "@/lib/tour/tour-state";
import { cn } from "@/lib/utils/cn";
import {
  LIMITS,
  buildProfilePayload,
  buildSteps,
  emptyForm,
  genderDeterminesScoringBasis,
  nextUsernameCandidate,
  pickDefaultAvatar,
  suggestUsername,
  validateAbout,
  type OnboardingForm,
  type OnboardingStepId,
} from "@/components/onboarding/onboarding-state";
import type { PostgrestError } from "@supabase/supabase-js";
import type { Gender, ScoringBasis, SportType } from "@/types";

/*
 * ONBOARDING, SECOND DESIGN.
 *
 * The first one asked for a username, date of birth, gender, height, weight
 * and a sport before it would save anything, then showed a fake "calculating"
 * spinner, a calibration form, and a paywall. Six required fields and three
 * extra screens between Sign in with Apple and the app. People bounced there.
 *
 * This one has one rule: CONTINUE ALWAYS WORKS. Every step has a default —
 * the username is suggested from the name Apple gave us, the two hybrid
 * sports are preselected, and every measurement is optional and nullable
 * (onboarding-state.ts has the reasons the engines are fine with that). On
 * the iPhone, one tap on "Fill in from Apple Health" reads date of birth,
 * sex, height, weight and resting HR instead of asking for them. Four taps of
 * Continue is a complete, working account.
 *
 * It greets the athlete by first name (typed, with a haptic click per letter)
 * because the provider already told us it, and ends by offering — not
 * imposing — a thirty-second tour of the five controls on the tab bar.
 *
 * What is NOT here any more: the calibration form and the trial paywall that
 * used to follow the save. The calibrate API still exists; the dashboard's
 * first-session guide is where the first score now comes from.
 */

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const USERNAME_ATTEMPTS = 4;

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";
type SaveState = "idle" | "saving" | "saved" | "error";

async function checkUsername(username: string): Promise<{ available: boolean; reason?: string }> {
  const res = await fetch(`/api/profile/username-check?u=${encodeURIComponent(username)}`);
  const data = (await res.json()) as { available?: boolean; reason?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not check availability");
  return { available: data.available === true, reason: data.reason };
}

export function OnboardingFlow({
  firstName,
  providerName,
  email,
}: {
  /** From the provider (Apple, Google) — null for an email signup. */
  firstName: string | null;
  providerName: string | null;
  email: string | null;
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  /*
    On iOS the software keyboard does NOT resize the layout viewport, so a
    field in the lower half of a step is typed into blind. Declared with the
    other hooks because this component has no early returns before JSX.
  */
  const formRef = useRef<HTMLDivElement>(null);
  useKeyboardSafeFocus(formRef);

  const native = useIsNativeShell();
  const healthAvailable = native && getNativePlatform() === "ios";
  const steps = useMemo(() => buildSteps({ healthAvailable }), [healthAvailable]);

  const [stepIndex, setStepIndex] = useState(0);
  const step: OnboardingStepId = steps[Math.min(stepIndex, steps.length - 1)]!;
  const visibleSteps = steps.filter((s) => s !== "done");

  const [form, setForm] = useState<OnboardingForm>(() =>
    emptyForm({ avatar_url: pickDefaultAvatar(PRESET_AVATARS, email ?? firstName ?? "")?.url ?? null })
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showMore, setShowMore] = useState(false);

  // Avatar: a preset is preselected at random so skipping leaves no blank
  // circle on the leaderboard; the big circle is still an upload target.
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState("");

  // Health step
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthNote, setHealthNote] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Username: the suggested candidate is checked on mount; edits are checked
  // after a 400 ms pause. A response is only trusted when it was issued for
  // the value still in the field.
  const [asyncCheck, setAsyncCheck] = useState<{
    forUsername: string;
    status: "available" | "taken" | "error";
    reason?: string;
  } | null>(null);
  const [suggesting, setSuggesting] = useState(true);
  const trimmedUsername = form.username.trim();
  const usernameFormat = trimmedUsername ? validateUsernameFormat(trimmedUsername) : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let candidate = suggestUsername({ name: firstName, email });
      for (let attempt = 0; attempt < USERNAME_ATTEMPTS; attempt += 1) {
        try {
          const result = await checkUsername(candidate);
          if (cancelled) return;
          if (result.available) {
            setForm((prev) => (prev.username ? prev : { ...prev, username: candidate }));
            setAsyncCheck({ forUsername: candidate, status: "available" });
            setSuggesting(false);
            return;
          }
        } catch {
          if (cancelled) return;
          break;
        }
        candidate = nextUsernameCandidate(candidate, attempt);
      }
      // Nothing free, or the check failed: show the last candidate and let the
      // ordinary debounced check below report on it.
      setForm((prev) => (prev.username ? prev : { ...prev, username: candidate }));
      setSuggesting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [firstName, email]);

  useEffect(() => {
    if (!trimmedUsername || !usernameFormat?.valid) return;
    if (asyncCheck?.forUsername === trimmedUsername) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await checkUsername(trimmedUsername);
        if (cancelled) return;
        setAsyncCheck({
          forUsername: trimmedUsername,
          status: result.available ? "available" : "taken",
          reason: result.reason,
        });
      } catch (err) {
        if (cancelled) return;
        setAsyncCheck({
          forUsername: trimmedUsername,
          status: "error",
          reason: err instanceof Error ? err.message : "Could not check availability",
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
    ? suggesting
      ? "checking"
      : "idle"
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

  const derivedAge = ageFromDateOfBirth(form.date_of_birth);

  const update = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleAvatarSelect = (file: File | null) => {
    setAvatarError("");
    if (!file) return;
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
    update("avatar_url", null);
  };

  const choosePreset = (url: string) => {
    impact("light");
    setAvatarError("");
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    update("avatar_url", url);
  };

  const toggleSport = (sport: SportType) => {
    impact("light");
    update(
      "preferred_sports",
      form.preferred_sports.includes(sport)
        ? form.preferred_sports.filter((s) => s !== sport)
        : [...form.preferred_sports, sport]
    );
  };

  /** True when this step is happy to be left. Only the welcome step can refuse. */
  const validateCurrent = (): boolean => {
    let next: Record<string, string> = {};
    if (step === "welcome") {
      if (usernameStatus !== "available") {
        next.username =
          usernameStatus === "checking"
            ? "Still checking that name…"
            : (usernameReason ?? "Pick a name for the leaderboard");
      }
      if (avatarError) next.avatar = avatarError;
    }
    if (step === "about") next = validateAbout(form);
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goTo = (index: number) => {
    setSubmitError("");
    setStepIndex(index);
  };

  const advance = () => {
    if (!validateCurrent()) return;
    impact("light");
    const nextIndex = stepIndex + 1;
    if (steps[nextIndex] === "done") {
      setSaveState("saving");
      void save();
    }
    goTo(nextIndex);
  };

  const back = () => {
    impact("light");
    goTo(Math.max(0, stepIndex - 1));
  };

  /** Apple's sheet, the server-side connection, a first workout sync, and the profile read — one tap. */
  const connectAppleHealth = async () => {
    impact("medium");
    setHealthBusy(true);
    setHealthError(null);
    try {
      await connectHealth();
      const characteristics = await fetchHealthProfile();
      const { form: filled, filled: fields } = applyHealthProfile(form, characteristics);
      setForm(filled);
      setHealthNote(describePrefill(fields) ?? "Connected. Nothing to prefill yet — fill in what you like.");
      success();
      goTo(stepIndex + 1);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : "Couldn't connect Apple Health.");
    } finally {
      setHealthBusy(false);
    }
  };

  const save = async () => {
    setSubmitError("");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const ensureRes = await fetch("/api/profile/ensure", { method: "POST" });
    if (!ensureRes.ok) {
      const body = (await ensureRes.json().catch(() => ({}))) as { error?: string; code?: string };
      setSubmitError(
        supabaseErrorMessage("Could not save your profile. Please try again.", {
          message: body.error ?? "Profile table missing",
          code: body.code ?? "",
          details: "",
          hint: "",
          name: "PostgrestError",
        } as PostgrestError)
      );
      setSaveState("error");
      return;
    }

    let avatarUrl = form.avatar_url;
    if (avatarFile) {
      const ext = avatarFile.name.split(".").pop() ?? "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
      if (uploadError) {
        setSubmitError(`Could not upload your profile icon: ${uploadError.message}`);
        setSaveState("error");
        return;
      }
      avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    const payload = buildProfilePayload({
      userId: user.id,
      form: { ...form, avatar_url: avatarUrl },
      providerName,
    });

    const { data: savedProfile, error: profileError } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select("id")
      .single();

    if (profileError?.code === "23505") {
      setAsyncCheck({
        forUsername: trimmedUsername,
        status: "taken",
        reason: "That username was just taken — try another",
      });
      setSubmitError("Someone just took that username — please pick another.");
      setSaveState("idle");
      goTo(0);
      return;
    }
    if (profileError || !savedProfile) {
      setSubmitError(
        supabaseErrorMessage(
          "Could not save your profile. Please try again.",
          profileError ?? ({ message: "No profile row was saved", code: "PGRST116", details: "", hint: "", name: "PostgrestError" } as PostgrestError)
        )
      );
      setSaveState("error");
      return;
    }

    // A weigh-in only when there was a weight. The old flow made this a hard
    // failure; a blank weight is now an ordinary outcome.
    if (payload.weight_kg !== null) {
      const { error: metricsError } = await supabase
        .from("body_metrics")
        .insert({ user_id: user.id, weight_kg: payload.weight_kg });
      if (metricsError) {
        setSubmitError(supabaseErrorMessage("Could not save your weight. Please try again.", metricsError));
        setSaveState("error");
        return;
      }
    }

    try {
      localStorage.setItem("split-index-account-created", String(Date.now()));
    } catch {
      /* storage unavailable */
    }
    success();
    setSaveState("saved");
  };

  const finish = (withTour: boolean) => {
    impact("medium");
    if (withTour) startTour();
    router.push("/dashboard");
  };

  const greeting = firstName ? `Hey ${firstName}.` : "Welcome.";
  const showScoringBasis = form.gender !== "" && !genderDeterminesScoringBasis(form.gender);

  return (
    <div ref={formRef} className="mx-auto max-w-lg">
      {step !== "done" && (
        <div className="mb-6">
          <div className="mb-5 flex gap-1.5" aria-hidden>
            {visibleSteps.map((s, i) => (
              <div
                key={s}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-300",
                  i <= stepIndex ? "bg-accent shadow-[0_0_8px_var(--accent-glow)]" : "bg-white/[0.08]"
                )}
              />
            ))}
          </div>
          <p className="sr-only">
            Step {stepIndex + 1} of {visibleSteps.length}
          </p>
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={reducedMotion ? false : { opacity: 0, x: 24, filter: "blur(4px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: -24, filter: "blur(4px)" }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          {/* ── 1. Welcome: the name they'll be known by ── */}
          {step === "welcome" && (
            <>
              <h1 className="headline-tight font-display text-3xl font-black">
                <Typewriter text={greeting} speedMs={40} />
              </h1>
              <p className="mt-2 text-sm text-muted">
                {firstName
                  ? "Good to have you. One thing to check, then you're in."
                  : "One thing to check, then you're in."}
              </p>

              <Card className="mt-6 space-y-5">
                <div>
                  <Input
                    label="Leaderboard name"
                    value={form.username}
                    error={errors.username}
                    hint="Public. Letters, numbers and underscores. Change it any time."
                    autoCapitalize="none"
                    autoCorrect="off"
                    onChange={(e) => update("username", e.target.value)}
                  />
                  {form.username.trim() && !errors.username && (
                    <p
                      className={cn(
                        "mt-1.5 flex items-center gap-1.5 text-xs",
                        usernameStatus === "available" && "text-success",
                        usernameStatus === "taken" && "text-danger",
                        usernameStatus === "checking" && "text-muted"
                      )}
                    >
                      {usernameStatus === "checking" && <Loader2 className="h-3 w-3 animate-spin" />}
                      {usernameStatus === "available" && <Check className="h-3 w-3" />}
                      {usernameStatus === "taken" && <X className="h-3 w-3" />}
                      {usernameStatus === "checking" && "Checking…"}
                      {usernameStatus === "available" && "Available"}
                      {usernameStatus === "taken" && (usernameReason ?? "Taken")}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <label className="group relative flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/[0.03]">
                    {avatarPreviewUrl || form.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarPreviewUrl ?? form.avatar_url ?? ""}
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
                  <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-1">
                    {PRESET_AVATARS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-label={`Use the ${preset.label} icon`}
                        aria-pressed={form.avatar_url === preset.url && !avatarFile}
                        onClick={() => choosePreset(preset.url)}
                        className={cn(
                          "h-11 w-11 shrink-0 overflow-hidden rounded-full border transition-all",
                          form.avatar_url === preset.url && !avatarFile
                            ? "border-accent ring-2 ring-accent/40"
                            : "border-white/15 opacity-70 hover:opacity-100"
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={preset.url} alt={preset.label} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
                {avatarError && <p className="text-xs text-danger">{avatarError}</p>}
              </Card>
            </>
          )}

          {/* ── 2. Apple Health (iPhone only): fill the next step without typing ── */}
          {step === "health" && (
            <>
              <h1 className="headline-tight text-2xl font-bold">Fill this in from Apple Health?</h1>
              <p className="mt-2 text-sm text-muted">
                One tap reads your date of birth, height, weight and resting heart rate — and brings in
                your runs and rides from Apple Watch or anything else that writes to Health. Nothing is
                written back.
              </p>
              <Card className="mt-6 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                    <HeartPulse className="h-5 w-5" aria-hidden />
                  </span>
                  <ul className="space-y-1 text-sm text-foreground/85">
                    <li>Date of birth, height and weight → your profile</li>
                    <li>Runs, rides, rows and swims → your logbook, scored</li>
                    <li>HRV, resting heart rate and sleep → your recovery score</li>
                  </ul>
                </div>
                {healthError && <p className="text-xs text-danger">{healthError}</p>}
                <Button size="lg" className="w-full" loading={healthBusy} onClick={connectAppleHealth}>
                  Fill in from Apple Health
                </Button>
                <p className="text-center text-xs text-muted">
                  Optional. Every score works without it, and you can connect later in Settings.
                </p>
              </Card>
            </>
          )}

          {/* ── 3. About you: all optional, prefilled when Health was connected ── */}
          {step === "about" && (
            <>
              <h1 className="headline-tight text-2xl font-bold">About you</h1>
              <p className="mt-2 text-sm text-muted">
                All optional. Each one makes your scores more accurate; skip any you like and add
                them later in Profile.
              </p>
              {healthNote && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-success">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  {healthNote}
                </p>
              )}
              <Card className="mt-6 space-y-4">
                <Input
                  label="Date of birth"
                  type="date"
                  min={minDobForMaxAge(LIMITS.age.max)}
                  max={maxDobForMinAge(LIMITS.age.min)}
                  value={form.date_of_birth}
                  error={errors.date_of_birth}
                  onChange={(e) => update("date_of_birth", e.target.value)}
                  hint={derivedAge !== null ? `Age ${derivedAge}` : "For age-graded pace and your max heart rate"}
                />

                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">Gender</p>
                  <div className="flex flex-wrap gap-2">
                    {GENDERS.map((g) => {
                      const selected = form.gender === g.value;
                      return (
                        <button
                          key={g.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            impact("light");
                            update("gender", selected ? "" : (g.value as Gender));
                          }}
                          className={cn(
                            "min-h-11 rounded-full border px-4 text-sm transition-colors",
                            selected
                              ? "border-accent bg-accent/15 text-foreground"
                              : "glass text-muted hover:text-foreground"
                          )}
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>
                  {showScoringBasis && (
                    <div className="mt-3">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
                        Score me against (optional)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {SCORING_BASES.map((b) => {
                          const selected = form.scoring_basis === b.value;
                          return (
                            <button
                              key={b.value}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => update("scoring_basis", selected ? "" : (b.value as ScoringBasis))}
                              className={cn(
                                "min-h-11 rounded-full border px-4 text-sm transition-colors",
                                selected
                                  ? "border-accent bg-accent/15 text-foreground"
                                  : "glass text-muted hover:text-foreground"
                              )}
                            >
                              {b.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-1.5 text-xs text-muted">{SCORING_BASIS_EXPLANATION}</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Height (cm)"
                    type="number"
                    inputMode="decimal"
                    min={LIMITS.height_cm.min}
                    max={LIMITS.height_cm.max}
                    value={form.height_cm}
                    error={errors.height_cm}
                    onChange={(e) => update("height_cm", e.target.value)}
                  />
                  <Input
                    label="Weight (kg)"
                    type="number"
                    inputMode="decimal"
                    min={LIMITS.weight_kg.min}
                    max={LIMITS.weight_kg.max}
                    value={form.weight_kg}
                    error={errors.weight_kg}
                    onChange={(e) => update("weight_kg", e.target.value)}
                  />
                </div>

                <button
                  type="button"
                  aria-expanded={showMore}
                  onClick={() => setShowMore((v) => !v)}
                  className="flex min-h-11 items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showMore && "rotate-180")} aria-hidden />
                  Heart rate {showMore ? "" : "(optional)"}
                </button>
                {showMore && (
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Max HR"
                      type="number"
                      inputMode="numeric"
                      min={LIMITS.max_hr.min}
                      max={LIMITS.max_hr.max}
                      value={form.max_hr}
                      error={errors.max_hr}
                      onChange={(e) => update("max_hr", e.target.value)}
                      hint={derivedAge ? `Suggested ${Math.round(220 - derivedAge)}` : "Suggested 220 − age"}
                    />
                    <Input
                      label="Resting HR"
                      type="number"
                      inputMode="numeric"
                      min={LIMITS.resting_hr.min}
                      max={LIMITS.resting_hr.max}
                      value={form.resting_hr}
                      error={errors.resting_hr}
                      onChange={(e) => update("resting_hr", e.target.value)}
                      hint="Scores effort, not just pace"
                    />
                  </div>
                )}
              </Card>
            </>
          )}

          {/* ── 4. Sports: the hybrid pair preselected ── */}
          {step === "sports" && (
            <>
              <h1 className="headline-tight text-2xl font-bold">What do you train?</h1>
              <p className="mt-2 text-sm text-muted">
                We&apos;ve picked the usual pair. Tap to change — it only affects what the app
                suggests, not what you can log.
              </p>
              <Card className="mt-6">
                <div className="grid grid-cols-2 gap-2">
                  {SPORTS.map((s) => {
                    const selected = form.preferred_sports.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleSport(s.id)}
                        className={cn(
                          "flex min-h-12 items-center gap-2 rounded-xl p-3 text-sm transition-colors",
                          selected
                            ? s.category === "strength"
                              ? "border border-gym-accent/40 bg-gym-accent/20 text-foreground"
                              : "border border-cardio-accent/40 bg-cardio-accent/20 text-foreground"
                            : "glass hover:bg-white/5"
                        )}
                      >
                        <span aria-hidden>{s.icon}</span>
                        {s.name}
                        {selected && <Check className="ml-auto h-4 w-4 opacity-70" aria-hidden />}
                      </button>
                    );
                  })}
                </div>
              </Card>
            </>
          )}

          {/* ── 5. Done: saved, and a tour on offer ── */}
          {step === "done" && (
            <Card className="glass-strong relative overflow-hidden px-6 py-10 text-center">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgba(61,255,110,0.08),transparent)]"
              />
              <div className="relative">
                {saveState === "saving" && (
                  <>
                    <motion.div
                      animate={reducedMotion ? undefined : { rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
                      className="mx-auto mb-5 h-12 w-12 rounded-full border-2 border-accent/30 border-t-accent"
                    />
                    <p className="headline-tight text-lg font-semibold">Setting you up…</p>
                  </>
                )}
                {saveState === "saved" && (
                  <>
                    <motion.div
                      initial={reducedMotion ? false : { scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", bounce: 0.4 }}
                      className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-success/30 bg-success/15"
                    >
                      <Sparkles className="h-7 w-7 text-success" aria-hidden />
                    </motion.div>
                    <h1 className="headline-tight font-display text-2xl font-black">
                      <Typewriter text={firstName ? `You're in, ${firstName}.` : "You're in."} speedMs={40} />
                    </h1>
                    <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
                      Log one session and your Split Index appears. Want the thirty-second tour of the
                      five buttons first?
                    </p>
                    <div className="mt-6 space-y-2.5">
                      <Button size="lg" className="w-full gap-2" onClick={() => finish(true)}>
                        <Compass className="h-5 w-5" aria-hidden />
                        Show me around
                      </Button>
                      <Button variant="secondary" size="lg" className="w-full" onClick={() => finish(false)}>
                        Straight to the app
                      </Button>
                    </div>
                  </>
                )}
                {saveState === "error" && (
                  <>
                    <p className="headline-tight text-lg font-semibold">That didn&apos;t save</p>
                    {submitError && <p className="mt-2 text-sm text-danger">{submitError}</p>}
                    <div className="mt-6 space-y-2.5">
                      <Button
                        size="lg"
                        className="w-full"
                        onClick={() => {
                          setSaveState("saving");
                          void save();
                        }}
                      >
                        Try again
                      </Button>
                      <Button variant="secondary" size="lg" className="w-full" onClick={back}>
                        Back
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}

          {step !== "done" && (
            <>
              {submitError && <p className="mt-4 text-sm text-danger">{submitError}</p>}
              <div className="mt-6 flex gap-3">
                {stepIndex > 0 && (
                  <Button variant="secondary" size="lg" onClick={back}>
                    Back
                  </Button>
                )}
                <Button size="lg" className="flex-1" onClick={advance}>
                  {step === "health" ? "Skip for now" : step === "sports" ? "Finish" : "Continue"}
                </Button>
              </div>
              {step !== "welcome" && step !== "health" && (
                <p className="mt-3 text-center text-xs text-muted">
                  Nothing here is required — Continue works as it is.
                </p>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
