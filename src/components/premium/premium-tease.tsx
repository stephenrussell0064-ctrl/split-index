"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface PremiumTeaseProps {
  /**
   * Kept in the signature so the many call sites do not all have to change at
   * once, and DELIBERATELY NOT RENDERED. See the note below.
   */
  children?: React.ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
  /** Reserve the panel's height so a locked section does not collapse the layout. */
  minHeight?: number;
  ctaLabel?: string;
}

/**
 * A locked premium panel.
 *
 * `children` used to be rendered blurred behind the lock. It was `aria-hidden`,
 * which was better than PremiumGate managed, but `aria-hidden` only stops a
 * screen reader announcing it — the value was still in the DOM, in the page
 * source, and one devtools toggle from being read.
 *
 * WP6.3: "a blurred number present in the JSON is not gated, it is decorated."
 * The same is true of one present in the markup. So nothing is rendered now,
 * and the prop stays only so that the ten-odd call sites passing a preview do
 * not all have to be edited in the same commit as the fix. A call site can drop
 * its children whenever it is next touched.
 *
 * premium-gating.test.ts fails the build if this component starts rendering
 * them again.
 */

export function PremiumTease({
  children: _unrenderedPreview,
  title,
  subtitle,
  className,
  minHeight = 160,
  ctaLabel = "Unlock with Premium",
}: PremiumTeaseProps) {
  const reducedMotion = useReducedMotion();

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]",
        className
      )}
      style={{ minHeight }}
      aria-label={`${title} — available with Premium`}
    >
      <motion.div
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center px-6 py-8 text-center"
        style={{ minHeight }}
      >
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 ring-1 ring-accent/30">
          <Lock className="h-4 w-4 text-accent" aria-hidden />
        </div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {subtitle && (
          <p className="mt-1.5 max-w-[280px] text-xs leading-relaxed text-muted">
            {subtitle}
          </p>
        )}
        <p className="mt-2 max-w-[300px] text-[10px] leading-relaxed text-muted">
          Scores are training estimates only — not medical advice.
        </p>
        <Link
          href="/settings/billing"
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {ctaLabel}
          <span className="sr-only"> — unlock {title}</span>
        </Link>
      </motion.div>
    </section>
  );
}
