"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface PremiumTeaseProps {
  children?: React.ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
  /** When true, children are still visible but blurred. When false, only the CTA shows. */
  showPreview?: boolean;
}

export function PremiumTease({
  children,
  title,
  subtitle,
  className,
  showPreview = true,
}: PremiumTeaseProps) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl", className)}>
      {showPreview && (
        <div
          className="pointer-events-none select-none blur-md opacity-50"
          aria-hidden
        >
          {children}
        </div>
      )}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(
          "flex flex-col items-center justify-center px-6 py-8 text-center",
          showPreview
            ? "absolute inset-0 bg-gradient-to-b from-transparent via-background/70 to-background/95 backdrop-blur-sm"
            : "border border-white/[0.06] bg-white/[0.02]"
        )}
      >
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 ring-1 ring-accent/30">
          <Lock className="h-4 w-4 text-accent" />
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
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25"
        >
          Unlock with Premium →
        </Link>
      </motion.div>
    </div>
  );
}
