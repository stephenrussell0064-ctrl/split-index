"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, ArrowRight, BarChart3, Dumbbell, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const spring = { type: "spring" as const, stiffness: 280, damping: 26 };

function GymBars() {
  const bars = [38, 52, 44, 68, 58, 82, 74, 94, 88, 100];
  return (
    <div className="flex h-48 items-end gap-1.5 sm:h-56">
      {bars.map((h, i) => (
        <motion.div
          key={i}
          initial={{ height: 0 }}
          whileInView={{ height: `${h}%` }}
          viewport={{ once: true }}
          transition={{ ...spring, delay: i * 0.05 }}
          className="flex-1 rounded-t-sm bg-gradient-to-t from-[#00e65f]/10 via-[#00e65f]/60 to-[#00e65f]"
          style={{ boxShadow: "0 0 20px -4px rgba(0,230,95,0.6)" }}
        />
      ))}
    </div>
  );
}

function CardioWave() {
  const d =
    "M0,80 C50,72 80,20 130,28 C180,36 200,88 250,72 C300,56 330,12 400,24";
  return (
    <svg viewBox="0 0 400 100" className="h-48 w-full sm:h-56" fill="none" aria-hidden>
      <defs>
        <linearGradient id="wave-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L400,100 L0,100 Z`} fill="url(#wave-fill)" />
      <motion.path
        d={d}
        stroke="#0ea5e9"
        strokeWidth="3"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.6, ease: "easeInOut" }}
      />
    </svg>
  );
}

function RadarChart({ color }: { color: string }) {
  const points = "50,8 88,32 78,72 50,88 22,72 12,32";
  return (
    <svg viewBox="0 0 100 100" className="h-32 w-32" aria-hidden>
      {[20, 35, 50].map((r) => (
        <polygon
          key={r}
          points={points}
          fill="none"
          stroke={color}
          strokeOpacity={0.12}
          transform={`scale(${r / 50})`}
          style={{ transformOrigin: "50px 50px" }}
        />
      ))}
      <motion.polygon
        points="50,18 82,38 70,68 50,78 30,68 18,38"
        fill={color}
        fillOpacity={0.2}
        stroke={color}
        strokeWidth="1.5"
        initial={{ scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        transition={spring}
        style={{ transformOrigin: "50px 50px" }}
      />
    </svg>
  );
}

function IndexRing({
  value,
  label,
  color,
  bg,
}: {
  value: number;
  label: string;
  color: string;
  bg: string;
}) {
  const pct = value / 1000;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex h-36 w-36 items-center justify-center">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} stroke={`${color}22`} strokeWidth="6" fill={bg} />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c * (1 - pct) }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      </svg>
      <div className="text-center">
        <p className="index-display text-3xl font-bold" style={{ color }}>
          {value}
        </p>
        <p className="micro-label mt-0.5 opacity-50">{label}</p>
      </div>
    </div>
  );
}

function DataGrid({ accent }: { accent: string }) {
  const cells = Array.from({ length: 28 }, (_, i) => 0.15 + ((i * 7) % 10) / 10);
  return (
    <div className="grid grid-cols-7 gap-1">
      {cells.map((v, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.02 }}
          className="aspect-square rounded-[3px]"
          style={{ background: accent, opacity: 0.1 + v * 0.8 }}
        />
      ))}
    </div>
  );
}

export default function LandingPage() {
  const reducedMotion = useReducedMotion();

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#050505] text-foreground">
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.06] bg-[#050505]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#00e65f]/15">
              <Zap className="h-4 w-4 text-[#00e65f]" />
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
              <Button size="sm" className="bg-[#00e65f] text-[#04120a] hover:bg-[#00e65f]/90">
                Start
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero — full split visual */}
      <section className="relative min-h-screen pt-20">
        <div className="grid min-h-[calc(100vh-5rem)] md:grid-cols-2">
          {/* Gym half */}
          <div className="grid-dark relative flex flex-col justify-between bg-[#050505] p-8 sm:p-12 lg:p-16">
            <div className="absolute inset-0 bg-gradient-to-br from-[#00e65f]/8 via-transparent to-transparent" />
            <div className="relative">
              <div className="mb-6 flex items-center gap-3">
                <Dumbbell className="h-5 w-5 text-[#00e65f]" />
                <p className="micro-label text-[#00e65f]">The Lab</p>
              </div>
              <motion.p
                initial={reducedMotion ? false : { opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="index-display text-7xl font-bold text-[#00e65f] sm:text-8xl lg:text-9xl"
              >
                724
              </motion.p>
              <IndexRing value={724} label="Strength" color="#00e65f" bg="#050505" />
            </div>
            <div className="relative mt-8">
              <GymBars />
              <div className="mt-6 flex items-center gap-4">
                <RadarChart color="#00e65f" />
                <DataGrid accent="#00e65f" />
              </div>
            </div>
          </div>

          {/* Cardio half */}
          <div className="grid-light relative flex flex-col justify-between bg-white p-8 sm:p-12 lg:p-16">
            <div className="absolute inset-0 bg-gradient-to-bl from-[#0ea5e9]/10 via-transparent to-transparent" />
            <div className="relative">
              <div className="mb-6 flex items-center gap-3">
                <Activity className="h-5 w-5 text-[#0ea5e9]" />
                <p className="micro-label text-[#0ea5e9]">The Engine</p>
              </div>
              <motion.p
                initial={reducedMotion ? false : { opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="index-display text-7xl font-bold text-[#0ea5e9] sm:text-8xl lg:text-9xl"
              >
                691
              </motion.p>
              <IndexRing value={691} label="Endurance" color="#0ea5e9" bg="#ffffff" />
            </div>
            <div className="relative mt-8">
              <CardioWave />
              <div className="mt-6 flex items-center gap-4">
                <RadarChart color="#0ea5e9" />
                <DataGrid accent="#0ea5e9" />
              </div>
            </div>
          </div>
        </div>

        {/* Center composite */}
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, scale: 0.85 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 hidden md:block"
        >
          <div className="rounded-full border border-white/10 bg-[#0a0a0a]/95 p-6 shadow-2xl backdrop-blur-xl">
            <p className="index-display text-center text-5xl font-bold bg-gradient-to-r from-[#00e65f] to-[#0ea5e9] bg-clip-text text-transparent">
              708
            </p>
            <p className="micro-label mt-1 text-center text-white/40">Split Index</p>
          </div>
        </motion.div>

        <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-4 px-6 z-30">
          <Link href="/signup">
            <Button size="lg" className="bg-[#00e65f] text-[#04120a] hover:bg-[#00e65f]/90 shadow-[0_0_40px_-10px_rgba(0,230,95,0.5)]">
              Start free
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Data analysis strip — graphics only */}
      <section className="border-t border-white/[0.06] bg-[#050505] px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 flex items-center justify-center gap-3">
            <BarChart3 className="h-5 w-5 text-[#00e65f]" />
            <p className="micro-label text-muted">Analytics</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-3xl border border-[#00e65f]/25 bg-[#0a0e0a] p-8">
              <GymBars />
              <p className="index-display mt-6 text-4xl font-bold text-[#00e65f]">+12%</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#0a0e0a] to-[#081018] p-8 flex flex-col items-center justify-center">
              <div className="flex h-4 w-full overflow-hidden rounded-full">
                <div className="w-1/2 bg-[#00e65f]" />
                <div className="w-1/2 bg-[#0ea5e9]" />
              </div>
              <p className="index-display mt-8 text-5xl font-bold text-white">50/50</p>
            </div>
            <div className="rounded-3xl border border-[#0ea5e9]/25 bg-white p-8">
              <CardioWave />
              <p className="index-display mt-6 text-4xl font-bold text-[#0ea5e9]">−14s</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing — minimal */}
      <section className="border-t border-white/[0.06] px-6 py-20">
        <div className="mx-auto flex max-w-lg flex-col items-center gap-6 text-center">
          <p className="index-display text-5xl font-bold">
            £0 <span className="text-lg text-muted font-normal">→ £5</span>
          </p>
          <Link href="/signup">
            <Button size="lg" className="w-full max-w-xs">
              14-day trial
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] px-6 py-8 text-center text-sm text-muted">
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <p className="mt-2">© {new Date().getFullYear()} Split Index</p>
      </footer>
    </div>
  );
}
