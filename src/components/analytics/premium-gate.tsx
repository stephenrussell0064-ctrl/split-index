"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface PremiumGateProps {
  locked: boolean;
  children: React.ReactNode;
  className?: string;
  feature?: string;
  /** Roughly how tall the real panel is, so the locked state does not collapse the layout. */
  minHeight?: number;
}

/**
 * A premium panel the athlete cannot see yet.
 *
 * WHAT WAS WRONG
 * --------------
 * This used to render the real children and blur them:
 *
 *   <div className="pointer-events-none select-none blur-[2px] opacity-40">{children}</div>
 *
 * A CSS filter is not a gate. The value was fully present in the DOM — one
 * devtools toggle away, in the page source, and read aloud verbatim by a screen
 * reader, which does not apply `blur`. There was no `aria-hidden` either, so an
 * athlete using VoiceOver got the premium numbers announced to them while a
 * sighted athlete was being asked to pay for them.
 *
 * That is the same rule from two directions, which is why one change closes
 * both: WP6.3 says "the underlying value must be absent from the response
 * payload entirely — a blurred number present in the JSON is not gated, it is
 * decorated", and WP12.7 says "blurred premium previews must not be readable by
 * a screen reader".
 *
 * WHAT IT DOES NOW
 * ----------------
 * When locked, `children` are not rendered at all. Not blurred, not hidden, not
 * present. What renders instead is a shaped placeholder carrying no data, so
 * the layout keeps its rhythm and the athlete can see there is something there,
 * plus the lock and the route to unlock it.
 *
 * The placeholder is `aria-hidden` because it is decoration with nothing to
 * announce. The lock message is not, because it is the actual content of this
 * region for anyone who cannot see the shape.
 */
export function PremiumGate({
  locked,
  children,
  className,
  feature = "Advanced analytics",
  minHeight = 180,
}: PremiumGateProps) {
  const reducedMotion = useReducedMotion();

  if (!locked) return <>{children}</>;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]",
        className
      )}
      style={{ minHeight }}
      aria-label={`${feature} — available with Premium`}
    >
      {/*
        Shape without substance. Bars of a fixed, arbitrary height — deliberately
        NOT derived from the real data, because a placeholder whose proportions
        follow the values it is hiding is the same leak with an extra step.
      */}
      <div className="absolute inset-0 flex items-end gap-2 p-6 opacity-[0.07]" aria-hidden>
        {[40, 65, 30, 80, 55, 70, 45, 60].map((height, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-foreground"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>

      <motion.div
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative flex flex-col items-center justify-center px-6 py-10 text-center"
        style={{ minHeight }}
      >
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20">
          <Lock className="h-4 w-4 text-accent" aria-hidden />
        </div>
        <p className="text-sm font-medium">{feature}</p>
        <p className="mt-1 max-w-[260px] text-xs text-muted">
          Unlock historical comparisons, projections and deep performance insights.
        </p>
        <Link
          href="/settings/billing"
          className="mt-4 rounded-lg px-3 py-2 text-sm font-medium text-accent transition-colors hover:text-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Upgrade to Premium
          <span className="sr-only"> — unlock {feature}</span>
        </Link>
      </motion.div>
    </section>
  );
}
