"use client";

import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Brain,
  TrendingUp,
  Zap,
  Activity,
  Shield,
  Dumbbell,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { FREE_TIER_FEATURES, PREMIUM_TIER_FEATURES } from "@/lib/premium/features";

const features = [
  {
    icon: TrendingUp,
    title: "Per-Sport Scoring",
    description:
      "Your bench press score vs your bench press history. Your 5K vs your last 10 runs. Apples to apples — never run vs gym.",
  },
  {
    icon: Activity,
    title: "Hybrid 50/50 Index",
    description:
      "A composite Split Index for athletes who train everything. 50% endurance blend + 50% strength blend — earned session by session.",
  },
  {
    icon: Brain,
    title: "AI Coach on Breakdown",
    description:
      "Data-driven analysis tied to actual score factors. No generic motivation — precise insights from your workout data.",
  },
  {
    icon: BarChart3,
    title: "Session Deltas",
    description:
      "Percentile bars, sport history sparklines, and delta vs your sport average after every log. Not calories — performance.",
  },
];

const spring = { type: "spring" as const, stiffness: 400, damping: 30 };

export default function LandingPage() {
  const reducedMotion = useReducedMotion();
  const heroRef = useRef<HTMLElement>(null);
  const [activeZone, setActiveZone] = useState<"gym" | "cardio">("gym");
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroScale = useTransform(scrollYProgress, [0, 1], [1, reducedMotion ? 1 : 0.96]);
  const heroY = useTransform(scrollYProgress, [0, 1], [0, reducedMotion ? 0 : 40]);

  return (
    <div className="min-h-screen bg-[#050508] text-foreground overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] glass-strong film-grain">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20">
              <Zap className="h-4 w-4 text-accent" />
            </div>
            <span className="font-semibold tracking-tight">Split Index</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Cinematic split hero */}
      <section ref={heroRef} className="relative min-h-screen pt-28 pb-20">
        <div className="absolute inset-0 film-grain pointer-events-none" />
        <div className="absolute inset-0 light-rays pointer-events-none opacity-60" />

        <div className="relative mx-auto max-w-6xl px-6">
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
            className="text-center mb-12"
          >
            <p className="micro-label text-accent mb-4">Hybrid Athlete Analytics</p>
            <h1 className="headline-tight text-4xl font-bold sm:text-6xl md:text-7xl max-w-4xl mx-auto">
              Two worlds.{" "}
              <span className="text-gradient-accent">One index.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted leading-relaxed">
              The Lab for strength. The Engine for endurance. Per-sport scoring that
              compares you to you — then blends into a hybrid index no other app builds.
            </p>
          </motion.div>

          {/* Zone toggle */}
          <div className="flex justify-center gap-2 mb-8">
            {(["gym", "cardio"] as const).map((zone) => (
              <button
                key={zone}
                type="button"
                onClick={() => setActiveZone(zone)}
                className={cn(
                  "micro-label rounded-full px-5 py-2 transition-all duration-500",
                  activeZone === zone
                    ? zone === "gym"
                      ? "bg-gym-accent/20 text-gym-accent border border-gym-accent/40 shadow-[0_0_24px_-6px_var(--gym-glow)]"
                      : "bg-cardio-accent/20 text-cardio-accent border border-cardio-accent/40 shadow-[0_0_24px_-6px_var(--cardio-glow)]"
                    : "text-muted border border-white/10 hover:border-white/20"
                )}
              >
                {zone === "gym" ? "The Lab · Gym" : "The Engine · Cardio"}
              </button>
            ))}
          </div>

          <motion.div style={{ scale: heroScale, y: heroY }} className="relative">
            <div className="grid md:grid-cols-2 gap-4 md:gap-0 min-h-[420px]">
              {/* Gym half */}
              <motion.div
                animate={{
                  opacity: activeZone === "gym" ? 1 : 0.35,
                  scale: activeZone === "gym" ? 1 : 0.97,
                  filter: activeZone === "gym" ? "blur(0px)" : "blur(2px)",
                }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "relative rounded-3xl md:rounded-r-none md:rounded-l-3xl overflow-hidden",
                  "bg-gym-zone border border-gym-border/50 p-8 sm:p-10"
                )}
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-gym-accent/10 rounded-full blur-3xl" />
                <Dumbbell className="h-8 w-8 text-gym-accent mb-4" />
                <p className="micro-label text-gym-accent/70 mb-2">The Lab</p>
                <h2 className="headline-tight text-2xl font-bold text-gym-text mb-4">
                  Strength Index
                </h2>
                <p className="text-sm text-gym-muted mb-8 max-w-xs">
                  Near-black steel. Purple rim light. Your gym score vs your gym history.
                </p>
                <div className="glass-gym holographic-border rounded-2xl p-6 glow-gym">
                  <p className="micro-label text-gym-muted mb-2">Gym Strength Index</p>
                  <p className="index-display text-5xl font-bold text-gradient-gym">724</p>
                  <p className="mt-2 text-xs text-gym-muted">Top 18% of your last 10 sessions</p>
                </div>
              </motion.div>

              {/* Cardio half */}
              <motion.div
                animate={{
                  opacity: activeZone === "cardio" ? 1 : 0.35,
                  scale: activeZone === "cardio" ? 1 : 0.97,
                  filter: activeZone === "cardio" ? "blur(0px)" : "blur(2px)",
                }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "relative rounded-3xl md:rounded-l-none md:rounded-r-3xl overflow-hidden",
                  "bg-cardio-zone border border-cardio-border p-8 sm:p-10"
                )}
              >
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-cardio-accent/10 rounded-full blur-3xl" />
                <Activity className="h-8 w-8 text-cardio-accent mb-4" />
                <p className="micro-label text-cardio-accent mb-2">The Engine</p>
                <h2 className="headline-tight text-2xl font-bold text-cardio-text mb-4">
                  Running Index
                </h2>
                <p className="text-sm text-cardio-muted mb-8 max-w-xs">
                  Sunlit glass. Cyan glow. Your pace score vs your run history.
                </p>
                <div className="glass-cardio rounded-2xl p-6 glow-cardio">
                  <p className="micro-label text-cardio-muted mb-2">Running Index</p>
                  <p className="index-display text-5xl font-bold text-gradient-cardio">691</p>
                  <p className="mt-2 text-xs text-cardio-muted">+12 vs your sport average</p>
                </div>
              </motion.div>
            </div>

            {/* Composite bridge */}
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.2 }}
              className="mx-auto -mt-6 md:-mt-8 relative z-10 max-w-md"
            >
              <div className="glass-strong holographic-border glow-accent rounded-2xl px-6 py-4 text-center scan-line">
                <p className="micro-label text-muted mb-1">Composite Split Index</p>
                <p className="index-display text-4xl font-bold">708</p>
                <p className="text-xs text-muted mt-1">50% endurance + 50% strength · earned</p>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="flex flex-col sm:flex-row gap-4 justify-center mt-14"
          >
            <Link href="/signup">
              <Button size="lg">
                Start Free Trial
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="secondary" size="lg">
                Sign In
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-24 border-t border-white/[0.06] bg-ambient">
        <div className="mx-auto max-w-6xl">
          <p className="micro-label text-center text-muted mb-3">What others don&apos;t do</p>
          <h2 className="headline-tight mb-14 text-center text-3xl font-semibold">
            Built for athletes who train everything
          </h2>
          <div className="grid gap-4 md:grid-cols-2 md:gap-5">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial={reducedMotion ? false : { opacity: 0, x: i % 2 === 0 ? -24 : 24, filter: "blur(4px)" }}
                whileInView={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ ...spring, delay: i * 0.06 }}
                className="glass card-interactive holographic-border rounded-2xl border border-white/[0.06] p-6 md:p-7"
              >
                <feature.icon className="mb-4 h-5 w-5 text-accent" strokeWidth={2} />
                <h3 className="headline-tight mb-2 text-lg font-semibold">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="headline-tight mb-3 text-center text-3xl font-semibold">
            Free to start. Premium to compete.
          </h2>
          <p className="mx-auto mb-10 max-w-lg text-center text-sm text-muted">
            Log workouts and earn sport-specific scores free. Unlock AI coaching, full
            analytics, and leaderboards for £5/month.
          </p>
          <div className="grid gap-5 md:grid-cols-2">
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={spring}
              className="glass rounded-3xl border border-white/[0.06] p-8"
            >
              <h3 className="mb-1 text-xl font-semibold">Free</h3>
              <p className="metric-value mb-4 text-3xl font-bold">
                £0<span className="text-lg font-normal text-muted">/forever</span>
              </p>
              <ul className="mb-6 space-y-2 text-sm text-muted">
                {FREE_TIER_FEATURES.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="text-success">✓</span> {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                <Button variant="secondary" className="w-full">
                  Get started free
                </Button>
              </Link>
            </motion.div>
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ ...spring, delay: 0.08 }}
              className="glass-strong glow-accent rounded-3xl border border-white/[0.08] p-8"
            >
              <Shield className="mb-4 h-7 w-7 text-accent" strokeWidth={1.75} />
              <h3 className="mb-1 text-xl font-semibold">Premium</h3>
              <p className="metric-value mb-1 text-3xl font-bold">
                £5<span className="text-lg font-normal text-muted">/month</span>
              </p>
              <p className="mb-6 text-sm text-muted">14-day free trial</p>
              <ul className="mb-8 space-y-2 text-sm">
                {PREMIUM_TIER_FEATURES.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="text-success">✓</span> {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                <Button className="w-full" size="lg">
                  Start Free Trial
                </Button>
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] px-6 py-10 text-center text-sm text-muted">
        <div className="mb-3 flex items-center justify-center gap-4">
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
        </div>
        <p>© {new Date().getFullYear()} Split Index. All rights reserved.</p>
      </footer>
    </div>
  );
}
