"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface PremiumGateProps {
  locked: boolean;
  children: React.ReactNode;
  className?: string;
  feature?: string;
}

export function PremiumGate({
  locked,
  children,
  className,
  feature = "Advanced analytics",
}: PremiumGateProps) {
  if (!locked) return <>{children}</>;

  return (
    <div className={cn("relative", className)}>
      <div className="pointer-events-none select-none blur-[2px] opacity-40">{children}</div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-white/[0.06] bg-gradient-to-b from-transparent via-background/60 to-background/90 px-6 text-center backdrop-blur-[2px]"
      >
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20">
          <Lock className="h-4 w-4 text-accent" />
        </div>
        <p className="text-sm font-medium">{feature}</p>
        <p className="mt-1 max-w-[220px] text-xs text-muted">
          Unlock historical comparisons, projections, and deep performance insights.
        </p>
        <Link
          href="/settings/billing"
          className="mt-4 text-sm font-medium text-accent transition-colors hover:text-accent/80"
        >
          Upgrade to Premium →
        </Link>
      </motion.div>
    </div>
  );
}
