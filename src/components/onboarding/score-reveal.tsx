"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { SkuPicker } from "@/components/pricing/sku-picker";
import { tierForScore } from "@/lib/scoring/split-strength-engine";
import { PRICING } from "@/lib/pricing/config";
import { formatIndex } from "@/lib/utils/format";
import type { SportType } from "@/types";

const QUICK_LIFTS = [
  { name: "Squat", muscle: "Quads" },
  { name: "Bench Press", muscle: "Chest" },
  { name: "Deadlift", muscle: "Back" },
];

type Phase = "calculating" | "quick-input" | "revealing" | "trial-offer";

interface ScoreRevealSequenceProps {
  hasGym: boolean;
  cardioSport: SportType | null;
  onDone: () => void;
}

export function ScoreRevealSequence({
  hasGym,
  cardioSport,
  onDone,
}: ScoreRevealSequenceProps) {
  const [phase, setPhase] = useState<Phase>("calculating");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [headline, setHeadline] = useState<number | null>(null);
  const [displayValue, setDisplayValue] = useState(0);

  const [lift, setLift] = useState(QUICK_LIFTS[0].name);
  const [weightKg, setWeightKg] = useState("");
  const [reps, setReps] = useState("5");

  const [distanceKm, setDistanceKm] = useState("5");
  const [minutes, setMinutes] = useState("25");
  const [seconds, setSeconds] = useState("0");

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

  const canSubmitQuickInput = hasGym
    ? Number(weightKg) > 0 && Number(reps) > 0
    : Number(distanceKm) > 0 && Number(minutes) * 60 + Number(seconds) > 0;

  const submitQuickInput = async () => {
    setSubmitting(true);
    setError("");

    const payload = hasGym
      ? {
          sport: "gym" as const,
          started_at: new Date().toISOString(),
          duration_seconds: 600,
          exercises: [
            {
              exercise_name: lift,
              muscle_group:
                QUICK_LIFTS.find((l) => l.name === lift)?.muscle ?? "Quads",
              sets: [{ weight_kg: Number(weightKg), reps: Number(reps) }],
              order_index: 0,
            },
          ],
        }
      : {
          sport: cardioSport ?? "running",
          started_at: new Date().toISOString(),
          duration_seconds: Number(minutes) * 60 + Number(seconds),
          distance_meters: Number(distanceKm) * 1000,
        };

    try {
      const res = await fetch("/api/activities", {
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
      <Card className="space-y-4 mb-6">
        <p className="text-sm font-semibold">
          Enter {hasGym ? "one lift" : "one recent run time"} to see your score
        </p>
        <p className="text-xs text-muted">
          Your Split Index needs at least one real result to compute against.
        </p>

        {hasGym ? (
          <>
            <Select
              label="Exercise"
              options={QUICK_LIFTS.map((l) => ({ value: l.name, label: l.name }))}
              value={lift}
              onChange={(e) => setLift(e.target.value)}
            />
            <Input
              label="Weight (kg)"
              type="number"
              min={0}
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
            />
            <Input
              label="Reps"
              type="number"
              min={1}
              value={reps}
              onChange={(e) => setReps(e.target.value)}
            />
          </>
        ) : (
          <>
            <Input
              label="Distance (km)"
              type="number"
              min={0}
              step={0.1}
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
            />
            <div className="flex gap-3">
              <Input
                label="Minutes"
                type="number"
                min={0}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
              <Input
                label="Seconds"
                type="number"
                min={0}
                max={59}
                value={seconds}
                onChange={(e) => setSeconds(e.target.value)}
              />
            </div>
          </>
        )}

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
