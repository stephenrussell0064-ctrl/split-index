"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, HeartPulse, Wine } from "lucide-react";
import { Card } from "@/components/ui/card";
import { RecoveryGauge } from "@/components/dashboard/recovery-gauge";
import { BAND_COLORS } from "@/components/recovery/band-colors";
import { BAND_BLURBS, BAND_LABELS, type RecoveryScoreResult } from "@/lib/recovery/score";
import { cn } from "@/lib/utils/cn";

/**
 * The dashboard's Recovery block.
 *
 * It replaces the Readiness card that used to sit here. Readiness has not been
 * deleted — it is the largest single input to this number and is named in the
 * breakdown — but it is no longer shown as a rival headline, because two
 * differently-named numbers both claiming to answer "can I train hard today"
 * is a question the athlete has to arbitrate and should never have been asked
 * to.
 *
 * Deliberately a link, not a panel. Everything this card summarises has a
 * fuller version on /recovery, and the one thing an athlete most often wants
 * to do from here — log last night's drinks — is a tap away rather than four.
 */
export function RecoveryScoreCard({
  result,
  className,
}: {
  result: RecoveryScoreResult;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const color = BAND_COLORS[result.band];

  const contributing = result.components.filter((c) => c.present && c.key !== "alcohol");
  const alcohol = result.components.find((c) => c.key === "alcohol");

  return (
    <Card padding="lg" className={cn("relative overflow-hidden", className)}>
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col gap-5 sm:flex-row sm:items-center"
      >
        <RecoveryGauge
          score={result.score}
          color={color}
          bandLabel={BAND_LABELS[result.band]}
          bandBlurb={BAND_BLURBS[result.band]}
          className="shrink-0 self-center"
        />

        <div className="min-w-0 flex-1">
          <p className="micro-label mb-1 flex items-center gap-1.5 text-muted">
            <HeartPulse className="h-3.5 w-3.5" />
            Today&apos;s Recovery
          </p>
          <p className="text-sm leading-relaxed text-foreground/90">{result.headline}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {contributing.map((c) => (
              <span
                key={c.key}
                className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-muted"
              >
                {c.label} <span className="tabular-nums text-foreground">{c.value}</span>
              </span>
            ))}
            {alcohol?.present && (
              <span className="flex items-center gap-1 rounded-full border border-danger/25 bg-danger/10 px-2.5 py-1 text-[11px] text-danger">
                <Wine className="h-3 w-3" />
                Alcohol <span className="tabular-nums">{alcohol.value}</span>
              </span>
            )}
          </div>

          {result.thin && (
            <p className="mt-3 text-xs text-muted">
              Built from training load alone so far. Log a morning HRV reading, or any drinks, and
              this gets sharper.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/recovery"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-white/20 hover:bg-white/5"
            >
              Full breakdown
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            {/*
              Filled, not a muted outline. This is the action the card exists
              to prompt — "log last night" is the one thing an athlete does
              from the dashboard that the rest of the page cannot do for them,
              and it was styled quieter than the "Full breakdown" link beside
              it, which only leads to more reading.
            */}
            <Link
              href="/recovery#log-a-drink"
              className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground shadow-lg shadow-accent/25 transition-all hover:bg-accent/90 hover:shadow-accent/35"
            >
              <Wine className="h-4 w-4" />
              Log a drink
            </Link>
          </div>
        </div>
      </motion.div>
    </Card>
  );
}
