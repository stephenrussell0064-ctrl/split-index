"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Check, User, Ruler, Dumbbell } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { EXPERIENCE_LEVELS, GENDERS } from "@/lib/constants/sports";
import { createClient } from "@/lib/supabase/client";
import { ageFromDateOfBirth, maxDobForMinAge, minDobForMaxAge } from "@/lib/utils/age";
import type { ExperienceLevel, Gender, Profile } from "@/types";

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
    height_cm: profile.height_cm?.toString() ?? "",
    weight_kg: profile.weight_kg?.toString() ?? "",
    max_hr: profile.max_hr?.toString() ?? "",
    resting_hr: profile.resting_hr?.toString() ?? "",
    experience: profile.experience ?? "",
    training_history_years: profile.training_history_years?.toString() ?? "",
  });

  const update = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

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
        height_cm: form.height_cm ? Number(form.height_cm) : null,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        max_hr: form.max_hr ? Number(form.max_hr) : null,
        resting_hr: form.resting_hr ? Number(form.resting_hr) : null,
        experience: (form.experience as ExperienceLevel) || null,
        training_history_years: form.training_history_years
          ? Number(form.training_history_years)
          : null,
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
          <div className="mt-4">
            <Select
              label="Gender"
              value={form.gender}
              onChange={(e) => update("gender", e.target.value)}
              options={[{ value: "", label: "Select…" }, ...GENDERS]}
            />
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
