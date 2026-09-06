"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Check, User, Ruler, Dumbbell, Compass } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { validateDisplayText } from "@/lib/utils/username";
import {
  EXPERIENCE_LEVELS,
  GENDERS,
  SCORING_BASES,
  SCORING_BASIS_EXPLANATION,
  TRAINING_GOALS,
} from "@/lib/constants/sports";
import { createClient } from "@/lib/supabase/client";
import { ageFromDateOfBirth, maxDobForMinAge, minDobForMaxAge } from "@/lib/utils/age";
import { cn } from "@/lib/utils/cn";
import type {
  ExperienceLevel,
  Gender,
  PrimaryMotivation,
  Profile,
  ScoringBasis,
  TrainingGoal,
} from "@/types";

/** See the same helper in onboarding-flow.tsx — identity answers the scoring question whenever it can. */
function genderDeterminesScoringBasis(gender: string): boolean {
  return gender === "male" || gender === "female";
}

const MOTIVATIONS: Array<{ value: PrimaryMotivation; label: string }> = [
  { value: "leaderboard", label: "Climb the leaderboard" },
  { value: "beat_pr", label: "Beat my PR" },
  { value: "predict_race", label: "Predict my next race" },
  { value: "just_track", label: "Just track my training" },
];

interface ProfileFormProps {
  profile: Profile;
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    display_name: profile.display_name ?? "",
    username: profile.username ?? "",
    bio: profile.bio ?? "",
    country: profile.country ?? "",
    date_of_birth: profile.date_of_birth ?? "",
    gender: profile.gender ?? "",
    scoring_basis: profile.scoring_basis ?? "",
    height_cm: profile.height_cm?.toString() ?? "",
    weight_kg: profile.weight_kg?.toString() ?? "",
    max_hr: profile.max_hr?.toString() ?? "",
    resting_hr: profile.resting_hr?.toString() ?? "",
    experience: profile.experience ?? "",
    training_history_years: profile.training_history_years?.toString() ?? "",
  });
  const [goals, setGoals] = useState<TrainingGoal[]>(profile.goals ?? []);
  const [primaryMotivation, setPrimaryMotivation] = useState<PrimaryMotivation | "">(
    profile.primary_motivation ?? ""
  );

  const update = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const toggleGoal = (goal: TrainingGoal) => {
    setGoals((prev) => (prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]));
    setSaved(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    /*
      A display name is read by every other athlete — on the feed, on
      leaderboards, in squads and duels — and it went through no content check
      at all, while the username right beside it did. App Store Guideline 1.2
      asks for a filter on objectionable material posted to the app, and half a
      filter is the same as none when the unfiltered field is the one shown
      largest.

      Client-side here because this component writes to Supabase directly rather
      than through an API route; the blocked-term list itself lives in
      lib/utils/username.ts alongside the username check, so the two cannot
      drift apart.
    */
    const displayName = form.display_name.trim();
    if (displayName) {
      const check = validateDisplayText(displayName, { label: "Display name" });
      if (!check.valid) {
        setError(check.reason ?? "That display name isn't available");
        setSaving(false);
        return;
      }
    }

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        display_name: form.display_name.trim() || null,
        username: form.username.trim().toLowerCase() || null,
        bio: form.bio.trim() || null,
        country: form.country.trim() || null,
        date_of_birth: form.date_of_birth || null,
        age: ageFromDateOfBirth(form.date_of_birth),
        gender: (form.gender as Gender) || null,
        // Kept in lockstep with identity when identity settles it, so the two
        // can never silently disagree; otherwise it is whatever the athlete
        // chose in the question below (null = not told, scoring falls back).
        scoring_basis: genderDeterminesScoringBasis(form.gender)
          ? (form.gender as ScoringBasis)
          : (form.scoring_basis as ScoringBasis) || null,
        height_cm: form.height_cm ? Number(form.height_cm) : null,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        max_hr: form.max_hr ? Number(form.max_hr) : null,
        resting_hr: form.resting_hr ? Number(form.resting_hr) : null,
        experience: (form.experience as ExperienceLevel) || null,
        training_history_years: form.training_history_years
          ? Number(form.training_history_years)
          : null,
        goals,
        primary_motivation: primaryMotivation || null,
      })
      .eq("user_id", profile.user_id);

    if (updateError) {
      setError(
        updateError.code === "23505"
          ? "That username is already taken."
          : updateError.message
      );
    } else {
      setSaved(true);
      router.refresh();
    }
    setSaving(false);
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-accent" />
            <CardTitle>Identity</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Display Name"
              value={form.display_name}
              onChange={(e) => update("display_name", e.target.value)}
              placeholder="Alex Carter"
            />
            <Input
              label="Username"
              value={form.username}
              onChange={(e) => update("username", e.target.value)}
              placeholder="alexcarter"
              hint="Public handle for leaderboards"
              pattern="[a-zA-Z0-9_]{3,24}"
              title="3–24 characters: letters, numbers, underscores"
            />
          </div>
          <Textarea
            label="Bio"
            value={form.bio}
            onChange={(e) => update("bio", e.target.value)}
            placeholder="Hybrid athlete chasing a 700+ index."
            maxLength={280}
          />
          <Input
            label="Country"
            value={form.country}
            onChange={(e) => update("country", e.target.value)}
            placeholder="United Kingdom"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-endurance" />
            <CardTitle>Body Metrics</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input
              label="Date of Birth"
              type="date"
              min={minDobForMaxAge(120)}
              max={maxDobForMinAge(13)}
              value={form.date_of_birth}
              onChange={(e) => update("date_of_birth", e.target.value)}
              hint={
                ageFromDateOfBirth(form.date_of_birth) !== null
                  ? `Age ${ageFromDateOfBirth(form.date_of_birth)} — used to calculate your age automatically`
                  : "We use this to calculate your age"
              }
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Input
              label="Height (cm)"
              type="number"
              min={1}
              step="0.1"
              value={form.height_cm}
              onChange={(e) => update("height_cm", e.target.value)}
            />
            <Input
              label="Weight (kg)"
              type="number"
              min={1}
              step="0.1"
              value={form.weight_kg}
              onChange={(e) => update("weight_kg", e.target.value)}
            />
            <Input
              label="Max HR"
              type="number"
              min={100}
              max={230}
              value={form.max_hr}
              onChange={(e) => update("max_hr", e.target.value)}
            />
            <Input
              label="Resting HR"
              type="number"
              min={30}
              max={120}
              value={form.resting_hr}
              onChange={(e) => update("resting_hr", e.target.value)}
              hint="Optional — calibrates cardio scoring to your own heart rate range instead of a fixed average"
            />
          </div>
          <div className="mt-4 space-y-4">
            <Select
              label="Gender"
              value={form.gender}
              onChange={(e) => update("gender", e.target.value)}
              options={[{ value: "", label: "Select…" }, ...GENDERS]}
            />
            {/*
              Shown only when the gender answer above cannot settle which
              comparison tables to use — for everyone else it would be the
              same question a second time. This is where an athlete already
              logging workouts on the fallback comes to correct it.
            */}
            {!genderDeterminesScoringBasis(form.gender) && (
              <div>
                <Select
                  label="Score me against"
                  value={form.scoring_basis}
                  onChange={(e) => update("scoring_basis", e.target.value)}
                  options={[
                    { value: "", label: "Not set — using the default" },
                    ...SCORING_BASES,
                  ]}
                />
                <p className="mt-1.5 text-xs text-muted">{SCORING_BASIS_EXPLANATION}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Dumbbell className="h-4 w-4 text-strength" />
            <CardTitle>Training Background</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-4">
            <Select
              label="Experience Level"
              value={form.experience}
              onChange={(e) => update("experience", e.target.value)}
              options={[{ value: "", label: "Select…" }, ...EXPERIENCE_LEVELS]}
            />
            <Input
              label="Years Training"
              type="number"
              min={0}
              step="0.5"
              value={form.training_history_years}
              onChange={(e) => update("training_history_years", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-accent" />
            <CardTitle>Goals &amp; Motivation</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium text-muted mb-2">Training Goals</p>
            <div className="flex flex-wrap gap-2">
              {TRAINING_GOALS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => toggleGoal(g.value as TrainingGoal)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    goals.includes(g.value as TrainingGoal)
                      ? "bg-accent text-accent-foreground"
                      : "glass text-muted hover:text-foreground"
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-muted mb-2">What brings you here?</p>
            <div className="flex flex-wrap gap-2">
              {MOTIVATIONS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setPrimaryMotivation(m.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    primaryMotivation === m.value
                      ? "bg-accent text-accent-foreground"
                      : "glass text-muted hover:text-foreground"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving}>
          Save Changes
        </Button>
        <AnimatePresence>
          {saved && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-sm text-success"
            >
              <Check className="h-4 w-4" />
              Saved
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
