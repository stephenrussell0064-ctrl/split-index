"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Plus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { SkuPicker } from "@/components/pricing/sku-picker";
import { tierForScore } from "@/lib/scoring/split-strength-engine";
import { PRICING } from "@/lib/pricing/config";
import { formatIndex } from "@/lib/utils/format";
import { SPORTS } from "@/lib/constants/sports";
import type { SportType } from "@/types";

const SBD_LIFTS: { key: "squat" | "bench" | "deadlift"; label: string }[] = [
  { key: "squat", label: "Squat" },
  { key: "bench", label: "Bench Press" },
  { key: "deadlift", label: "Deadlift" },
];

const CARDIO_SPORT_OPTIONS = SPORTS.filter((s) => s.category === "endurance").map((s) => ({
  value: s.id,
  label: s.name,
}));

interface CardioEntry {
  id: string;
  sport: SportType;
  distanceKm: string;
  minutes: string;
  seconds: string;
}

let cardioEntryCounter = 0;
function newCardioEntry(sport: SportType = "running"): CardioEntry {
  cardioEntryCounter += 1;
  return { id: `cardio-${cardioEntryCounter}`, sport, distanceKm: "5", minutes: "25", seconds: "0" };
}

type Phase = "calculating" | "quick-input" | "revealing" | "trial-offer";

interface ScoreRevealSequenceProps {
  onDone: () => void;
}

/**
 * User feedback (Slice 13): "When entering an exercise to finish
 * onboarding, allow this to be a cardio or SBD as some users may only use
 * the app for cardio. Also do not log this as an activity just log it as a
 * stat for the user and calibrate a rough first score based off of it.
 * Allow the user to enter multiple stats as well such as all three of
 * their SBD and 5km run, 10km bike, 1km swim etc."
 *
 * This used to be forced entirely by `hasGym` (derived from the preferred
 * sports picked earlier in onboarding) — a hybrid athlete who'd picked both
 * gym AND running got shown ONLY the single gym-lift form, with no way to
 * also enter a cardio result. Both sections are now always offered, each
 * lift and each cardio entry independently optional, and any combination
 * (or all of them) can be submitted together. Submits to
 * /api/onboarding/calibrate — a stat, not a logged activity (see that
 * route's own doc comment for why).
 */
export function ScoreRevealSequence({ onDone }: ScoreRevealSequenceProps) {
  const [phase, setPhase] = useState<Phase>("calculating");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [headline, setHeadline] = useState<number | null>(null);
  const [displayValue, setDisplayValue] = useState(0);

  const [sbd, setSbd] = useState<Record<"squat" | "bench" | "deadlift", { weightKg: string; reps: string }>>({
    squat: { weightKg: "", reps: "5" },
    bench: { weightKg: "", reps: "5" },
    deadlift: { weightKg: "", reps: "5" },
  });
  const [cardioEntries, setCardioEntries] = useState<CardioEntry[]>([newCardioEntry()]);

  useEffect(() => {
    if (phase !== "calculating") return;
    const t = setTimeout(() => setPhase("quick-input"), 2400);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "revealing" || headline === null) return;
    const duration = 1200;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      setDisplayValue(Math.round(progress * headline));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, headline]);

  const filledLifts = SBD_LIFTS.filter(
    ({ key }) => Number(sbd[key].weightKg) > 0 && Number(sbd[key].reps) > 0
  );
  const completeCardioEntries = cardioEntries.filter(
    (c) => Number(c.distanceKm) > 0 && Number(c.minutes) * 60 + Number(c.seconds) > 0
  );
  const canSubmitQuickInput = filledLifts.length > 0 || completeCardioEntries.length > 0;

  const updateSbd = (key: "squat" | "bench" | "deadlift", field: "weightKg" | "reps", value: string) => {
    setSbd((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const updateCardioEntry = (id: string, patch: Partial<CardioEntry>) => {
    setCardioEntries((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const submitQuickInput = async () => {
    setSubmitting(true);
    setError("");

    const sbdPayload: Record<string, { weightKg: number; reps: number }> = {};
    for (const { key } of filledLifts) {
      sbdPayload[key] = { weightKg: Number(sbd[key].weightKg), reps: Number(sbd[key].reps) };
    }

    const payload = {
      sbd: sbdPayload,
      cardio: completeCardioEntries.map((c) => ({
        sport: c.sport,
        distanceMeters: Number(c.distanceKm) * 1000,
        durationSeconds: Number(c.minutes) * 60 + Number(c.seconds),
      })),
    };

    try {
      const res = await fetch("/api/onboarding/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not compute your score. Please try again.");
        setSubmitting(false);
        return;
      }
      setHeadline(Math.round(data.headline ?? data.splitIndex ?? 0));
      setPhase("revealing");
    } catch {
      setError("Could not compute your score. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === "calculating") {
    return (
      <Card className="glass-strong text-center py-16 px-6 mb-6">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
          className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border-2 border-accent/30 border-t-accent"
        />
        <p className="headline-tight text-xl font-semibold">
          Calculating your Split Index…
        </p>
      </Card>
    );
  }

  if (phase === "quick-input") {
    return (
      <Card className="space-y-5 mb-6">
        <div>
          <p className="text-sm font-semibold">Enter a result to see your score</p>
          <p className="mt-1 text-xs text-muted">
            Any combination works — a lift, a run, or several of each. This is stored as a
            personal stat, not a logged workout, so it won&apos;t show up in your activity history.
          </p>
        </div>

        <div>
          <p className="micro-label mb-2 text-muted">Strength (SBD) — optional</p>
          <div className="space-y-3">
            {SBD_LIFTS.map(({ key, label }) => (
              <div key={key} className="flex items-end gap-2">
                <Input
                  label={label}
                  type="number"
                  min={0}
                  placeholder="Weight (kg)"
                  value={sbd[key].weightKg}
                  onChange={(e) => updateSbd(key, "weightKg", e.target.value)}
                  className="flex-[2]"
                />
                <Input
                  label="Reps"
                  type="number"
                  min={1}
                  value={sbd[key].reps}
                  onChange={(e) => updateSbd(key, "reps", e.target.value)}
                  className="flex-1"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="micro-label mb-2 text-muted">Cardio — optional</p>
          <div className="space-y-4">
            {cardioEntries.map((entry, i) => (
              <div key={entry.id} className="rounded-xl border border-white/10 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Select
                    label="Sport"
                    options={CARDIO_SPORT_OPTIONS}
                    value={entry.sport}
                    onChange={(e) => updateCardioEntry(entry.id, { sport: e.target.value as SportType })}
                    className="max-w-[200px]"
                  />
                  {cardioEntries.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove this cardio entry"
                      onClick={() =>
                        setCardioEntries((prev) => prev.filter((c) => c.id !== entry.id))
                      }
                      className="text-muted hover:text-danger"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    label="Distance (km)"
                    type="number"
                    min={0}
                    step={0.1}
                    value={entry.distanceKm}
                    onChange={(e) => updateCardioEntry(entry.id, { distanceKm: e.target.value })}
                    className="flex-[1.3]"
                  />
                  <Input
                    label="Minutes"
                    type="number"
                    min={0}
                    value={entry.minutes}
                    onChange={(e) => updateCardioEntry(entry.id, { minutes: e.target.value })}
                  />
                  <Input
                    label="Seconds"
                    type="number"
                    min={0}
                    max={59}
                    value={entry.seconds}
                    onChange={(e) => updateCardioEntry(entry.id, { seconds: e.target.value })}
                  />
                </div>
                {i === cardioEntries.length - 1 && (
                  <button
                    type="button"
                    onClick={() => setCardioEntries((prev) => [...prev, newCardioEntry()])}
                    className="mt-3 flex items-center gap-1 text-xs text-accent hover:text-accent/80"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add another sport (e.g. 10K bike, 1K swim)
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button
          className="w-full"
          loading={submitting}
          disabled={!canSubmitQuickInput}
          onClick={submitQuickInput}
        >
          See your score
        </Button>
      </Card>
    );
  }

  if (phase === "revealing") {
    const tier = headline !== null ? tierForScore(headline) : null;
    return (
      <Card className="glass-strong holographic-border text-center py-12 px-6 mb-6 overflow-hidden relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgba(99,102,241,0.12),transparent)]"
        />
        <div className="relative">
          <p className="micro-label text-muted mb-4">Your Split Index</p>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", bounce: 0.4 }}
            className="mb-2 flex items-center justify-center gap-2"
          >
            <Sparkles className="h-6 w-6 text-accent" />
            <span className="font-display text-6xl font-black tabular-nums">
              {formatIndex(displayValue)}
            </span>
          </motion.div>
          {tier && (
            <p className="text-sm font-semibold text-accent">{tier}</p>
          )}
          <p className="mx-auto mt-6 max-w-sm text-xs leading-relaxed text-muted">
            Keep logging both sides of your training and we&apos;ll show you something no other
            app can: how your lifting and running actually affect each other.
          </p>
          <Button
            className="mt-8"
            onClick={() => setPhase("trial-offer")}
          >
            Continue
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="glass-strong text-center py-10 px-6 mb-6">
      <h2 className="headline-tight text-2xl font-bold mb-2">
        Start your {PRICING.TRIAL_DAYS}-day free trial
      </h2>
      <p className="text-sm text-muted mb-6 max-w-sm mx-auto">
        Full Split Index, AI coaching, and analytics — free for {PRICING.TRIAL_DAYS} days.
        Cancel anytime.
      </p>
      <SkuPicker className="text-left" onError={setError} />
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <button
        type="button"
        onClick={onDone}
        className="mt-4 text-sm text-muted hover:text-foreground underline underline-offset-2"
      >
        Skip for now
      </button>
    </Card>
  );
}
