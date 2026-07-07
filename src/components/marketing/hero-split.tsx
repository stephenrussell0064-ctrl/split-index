"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";

function GaugeRing({
  value,
  max,
  color,
  track,
  label,
  side,
}: {
  value: number;
  max: number;
  color: string;
  track: string;
  label: string;
  side: "lab" | "eng";
}) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / max);
  return (
    <div
      className={`mt-10 flex items-center gap-5 ${side === "eng" ? "flex-row-reverse" : ""}`}
    >
      <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden>
        <circle cx="46" cy="46" r={r} fill="none" stroke={track} strokeWidth="7" />
        <motion.circle
          cx="46"
          cy="46"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: offset }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          transform="rotate(-90 46 46)"
        />
      </svg>
      <div className={side === "eng" ? "text-right" : ""}>
        <p
          className="font-display text-[44px] font-bold leading-none"
          style={{
            color,
            textShadow: side === "lab" ? "0 0 34px rgba(61,255,110,0.45)" : undefined,
          }}
        >
          {value}
        </p>
        <p className="mt-1.5 text-[11px] uppercase tracking-[0.2em] opacity-60">{label}</p>
      </div>
    </div>
  );
}

export function HeroSplit() {
  const reducedMotion = useReducedMotion();
  const heroRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(50);
  const dragging = useRef(false);

  const setSplitFromX = useCallback((clientX: number) => {
    const el = heroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pct = Math.min(82, Math.max(18, ((clientX - r.left) / r.width) * 100));
    setSplit(pct);
  }, []);

  useEffect(() => {
    if (reducedMotion || typeof window === "undefined") return;
    const onMove = (e: PointerEvent) => {
      if (dragging.current) setSplitFromX(e.clientX);
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [reducedMotion, setSplitFromX]);

  return (
    <section
      ref={heroRef}
      className="relative min-h-[660px] h-[calc(100vh-4rem)] overflow-hidden md:cursor-col-resize"
      onPointerDown={(e) => {
        if (window.innerWidth < 901) return;
        dragging.current = true;
        setSplitFromX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current || reducedMotion || window.innerWidth < 901) return;
        const el = heroRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setSplit(50 + ((e.clientX - r.left) / r.width - 0.5) * 8);
      }}
    >
      {/* Lab side */}
      <div
        className="absolute inset-0 flex flex-col justify-center px-[6vw] bg-[radial-gradient(1200px_800px_at_20%_60%,#0C1410_0%,var(--gym-bg)_55%)]"
        style={{ color: "var(--gym-text)" }}
      >
        <div className="landing-orb landing-orb-gym" />
        <div className="landing-hero-grid landing-hero-grid-lab" />
        <div className="relative z-[1] max-w-lg">
          <p className="landing-eyebrow text-gym-accent">The Lab · Strength</p>
          <h1 className="font-display text-[clamp(34px,4.6vw,64px)] font-black leading-[1.02]">
            LIFT
            <br />
            HEAVY.
          </h1>
          <p className="mt-4 max-w-[34ch] text-sm leading-relaxed text-gym-muted">
            Every set scored against your history and international strength standards.
          </p>
          <GaugeRing
            value={724}
            max={1000}
            color="#3DFF6E"
            track="#1B241D"
            label="Strength Index"
            side="lab"
          />
        </div>
      </div>

      {/* Engine side — clipped by split */}
      <div
        className="absolute inset-0 flex flex-col justify-center px-[6vw] bg-[radial-gradient(1200px_800px_at_80%_40%,#EAF4FF_0%,var(--cardio-bg)_55%)] text-cardio-text"
        style={{ clipPath: `inset(0 0 0 ${split}%)` }}
      >
        <div className="landing-orb landing-orb-cardio" />
        <div className="landing-hero-grid landing-hero-grid-cardio" />
        <div className="relative z-[1] ml-auto max-w-lg text-right">
          <p className="landing-eyebrow landing-eyebrow-right text-[#0B69C7]">
            The Engine · Cardio
          </p>
          <h1 className="font-display text-[clamp(34px,4.6vw,64px)] font-black leading-[1.02]">
            RUN
            <br />
            FAR.
          </h1>
          <p className="mt-4 ml-auto max-w-[34ch] text-sm leading-relaxed text-cardio-muted">
            Pace, heart rate and splits fused into one honest endurance score.
          </p>
          <GaugeRing
            value={691}
            max={1000}
            color="#3BA6FF"
            track="#DCEAF7"
            label="Running Index"
            side="eng"
          />
        </div>
      </div>

      {/* Seam */}
      <div
        className="pointer-events-none absolute top-0 bottom-0 z-[5] w-0.5 -translate-x-px bg-gradient-to-b from-transparent via-white/90 to-transparent hidden md:block"
        style={{ left: `${split}%` }}
      />

      {/* Composite ring */}
      <div
        className="pointer-events-none absolute top-1/2 z-[6] hidden -translate-x-1/2 -translate-y-1/2 md:block"
        style={{ left: `${split}%` }}
      >
        <div className="composite-ring">
          <p className="font-display text-[52px] font-black text-white">708</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-white/60">
            Split Index
          </p>
        </div>
      </div>

      <p className="pointer-events-none absolute bottom-6 left-1/2 z-[6] hidden -translate-x-1/2 items-center gap-2.5 text-[11px] uppercase tracking-[0.24em] text-white/45 md:flex">
        <span className="h-px w-[26px] bg-current" />
        Drag the divide
        <span className="h-px w-[26px] bg-current" />
      </p>

      <div className="absolute bottom-6 left-0 right-0 z-[7] flex justify-center px-6 md:hidden">
        <Link href="/signup">
          <Button className="bg-gym-accent text-[#04120a] hover:bg-gym-accent/90 font-bold">
            Start free
          </Button>
        </Link>
      </div>
    </section>
  );
}
