"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Minus, Plus, Wine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DRINK_PRESETS,
  gramsOfEthanol,
  gramsToUnits,
  type DrinkPreset,
} from "@/lib/recovery/alcohol";
import { cn } from "@/lib/utils/cn";

/**
 * Logging a drink.
 *
 * DESIGNED AROUND WHEN IT IS ACTUALLY USED, which is the morning after, not
 * during. That drives three decisions:
 *
 *   - The time field defaults to a sensible PAST time, not to now. "Last night"
 *     is one tap, because the overwhelming majority of entries are for an
 *     evening that has already happened, and an entry logged at 9am with a 9am
 *     timestamp would tell the model the athlete is drinking at breakfast.
 *   - Quantity is a stepper on the preset, so four pints is one preset and
 *     three taps rather than four separate submissions.
 *   - The unit total updates as you build the entry, because the number the
 *     athlete is about to commit to is the one piece of feedback that makes
 *     this honest rather than punitive.
 *
 * Grams are never sent. The API recomputes them from the preset or the custom
 * volume/ABV — see api/recovery/drinks.
 */

const CATEGORIES: { key: DrinkPreset["category"]; label: string }[] = [
  { key: "beer", label: "Beer & cider" },
  { key: "wine", label: "Wine" },
  { key: "spirits", label: "Spirits" },
  { key: "other", label: "Other" },
];

type Tab = DrinkPreset["category"] | "custom";

/** `datetime-local` wants local wall-clock time with no zone suffix. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/** 21:00 on the most recent evening that has already happened. */
function lastNight(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(21, 0, 0, 0);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
  return d;
}

function hoursAgo(h: number, now = new Date()): Date {
  return new Date(now.getTime() - h * 3_600_000);
}

export function DrinkLogger() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("beer");
  const [presetId, setPresetId] = useState<string>(DRINK_PRESETS[0].id);
  const [quantity, setQuantity] = useState(1);
  const [when, setWhen] = useState(() => toLocalInputValue(lastNight()));
  const [customLabel, setCustomLabel] = useState("");
  const [customVolume, setCustomVolume] = useState("330");
  const [customAbv, setCustomAbv] = useState("5");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const preset = DRINK_PRESETS.find((p) => p.id === presetId);
  const visiblePresets = DRINK_PRESETS.filter((p) => p.category === tab);

  const previewUnits = useMemo(() => {
    if (tab === "custom") {
      const volume = Number(customVolume);
      const abv = Number(customAbv);
      if (!Number.isFinite(volume) || !Number.isFinite(abv)) return 0;
      return gramsToUnits(gramsOfEthanol(volume, abv, quantity));
    }
    if (!preset) return 0;
    return gramsToUnits(gramsOfEthanol(preset.volumeMl, preset.abvPercent, quantity));
  }, [tab, preset, quantity, customVolume, customAbv]);

  async function submit() {
    setStatus("saving");
    setError(null);

    const drankAt = new Date(when);
    if (Number.isNaN(drankAt.getTime())) {
      setStatus("error");
      setError("That time isn't valid.");
      return;
    }

    const body =
      tab === "custom"
        ? {
            presetId: "custom",
            label: customLabel.trim() || "Custom drink",
            volumeMl: Number(customVolume),
            abvPercent: Number(customAbv),
            quantity,
            drankAt: drankAt.toISOString(),
          }
        : { presetId, quantity, drankAt: drankAt.toISOString() };

    try {
      const res = await fetch("/api/recovery/drinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? "That couldn't be saved.");
      }
      setStatus("saved");
      setQuantity(1);
      router.refresh();
      window.setTimeout(() => setStatus("idle"), 2200);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "That couldn't be saved.");
    }
  }

  return (
    /*
      Lit, and titled like a heading rather than a micro-label.
      This is the page's primary action and it was dressed as one panel among
      six — an 11px uppercase caption over a grid of small tiles. The glow and
      the real heading are what make it findable at a glance on a phone, which
      is where it is actually used.
    */
    <Card glow="accent" padding="lg" id="log-a-drink" className="scroll-mt-20">
      <CardHeader className="mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15">
            <Wine className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Log a drink</h3>
            <p className="text-xs text-muted">Takes about five seconds</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/*
          Said at the point of entry, not buried in a policy page.
          This is the transparency the lawful basis for holding this data rests
          on (see lib/consent/article9.ts): what it is used for, who can see
          it, and that it can be removed — in front of the athlete at the
          moment they decide whether to type anything at all.
        */}
        <p className="text-xs leading-relaxed text-muted">
          Used only to estimate your recovery and your next session. Private to you —
          never shown to other athletes, never on a leaderboard or a share card. Delete
          any entry, or all of it, whenever you like.
        </p>

        {/* Category */}
        <div className="flex flex-wrap gap-2">
          {[...CATEGORIES, { key: "custom" as const, label: "Custom" }].map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => {
                setTab(c.key as Tab);
                const first = DRINK_PRESETS.find((p) => p.category === c.key);
                if (first) setPresetId(first.id);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                tab === c.key
                  ? "border-accent/40 bg-accent/15 text-foreground"
                  : "border-white/10 text-muted hover:border-white/20 hover:text-foreground"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Presets, or the custom form */}
        {tab === "custom" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="What was it"
              placeholder="e.g. Negroni"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
            />
            <Input
              label="Volume (ml)"
              type="number"
              inputMode="decimal"
              value={customVolume}
              onChange={(e) => setCustomVolume(e.target.value)}
            />
            <Input
              label="ABV (%)"
              type="number"
              inputMode="decimal"
              value={customAbv}
              onChange={(e) => setCustomAbv(e.target.value)}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {visiblePresets.map((p) => {
              const selected = p.id === presetId;
              const units = gramsToUnits(gramsOfEthanol(p.volumeMl, p.abvPercent));
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPresetId(p.id)}
                  aria-pressed={selected}
                  /*
                   * 96px rather than 72, and a 2px ring on the selected tile
                   * rather than a 1px border. These are thumb targets on a
                   * phone, tapped quickly and often not entirely sober — the
                   * old tiles cleared the 44pt minimum and nothing more, and
                   * the selected state was a border shade most people would
                   * not notice they had missed.
                   */
                  className={cn(
                    "flex min-h-[96px] flex-col items-start justify-center rounded-2xl border px-4 py-3 text-left transition-colors",
                    selected
                      ? "border-accent/60 bg-accent/15 ring-2 ring-accent/40"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]"
                  )}
                >
                  <span className="text-base font-semibold leading-tight">{p.label}</span>
                  <span className="mt-1 text-xs text-muted">{p.detail}</span>
                  <span className="mt-0.5 text-xs font-medium tabular-nums text-accent">
                    {units.toFixed(1)} units
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* How many */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="micro-label text-muted">How many</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="One fewer"
                onClick={() => setQuantity((q) => Math.max(0.5, Math.round((q - 0.5) * 2) / 2))}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-muted transition-colors hover:border-white/25 hover:text-foreground"
              >
                <Minus className="h-5 w-5" />
              </button>
              <span className="w-12 text-center text-xl font-bold tabular-nums">
                {quantity % 1 === 0 ? quantity : quantity.toFixed(1)}
              </span>
              <button
                type="button"
                aria-label="One more"
                onClick={() => setQuantity((q) => Math.min(50, q + 1))}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-muted transition-colors hover:border-white/25 hover:text-foreground"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* The number being committed to, at the size of a number that matters. */}
          <p className="text-sm text-muted">
            <span className="index-display text-3xl font-bold tabular-nums text-accent">
              {previewUnits.toFixed(1)}
            </span>{" "}
            units
          </p>
        </div>

        {/* When */}
        <div className="space-y-2">
          <span className="micro-label text-muted">When</span>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Last night", value: () => lastNight() },
              { label: "1h ago", value: () => hoursAgo(1) },
              { label: "3h ago", value: () => hoursAgo(3) },
              { label: "Now", value: () => new Date() },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setWhen(toLocalInputValue(option.value()))}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-muted transition-colors hover:border-white/20 hover:text-foreground"
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="h-11 w-full rounded-xl glass border border-white/10 px-4 text-base text-foreground focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/30 sm:w-auto"
          />
          <p className="text-xs text-muted">
            The time matters as much as the amount — the same drinks three hours before bed and six
            hours before bed cost different amounts of recovery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Full width on a phone: the commit action should not be a small
              target sitting next to the reset of the form. */}
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={submit}
            disabled={status === "saving" || previewUnits <= 0}
          >
            {status === "saving" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving
              </>
            ) : status === "saved" ? (
              <>
                <Check className="h-4 w-4" />
                Logged
              </>
            ) : (
              "Log it"
            )}
          </Button>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
