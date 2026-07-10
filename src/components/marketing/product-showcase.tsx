"use client";

import { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

function Sparkline({ color, points }: { color: string; points: string }) {
  return (
    <svg width="72" height="28" viewBox="0 0 72 28" aria-hidden className="opacity-80">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function ProductShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [6, -6]), { stiffness: 120, damping: 20 });
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), { stiffness: 120, damping: 20 });

  return (
    <section className="relative overflow-hidden border-t border-white/[0.06] bg-[#070908] px-6 py-24 md:px-[6vw]">
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1fr_1.1fr]">
        <div className="min-w-0">
          <p className="landing-eyebrow text-cardio-accent">The product</p>
          <h2 className="font-display text-3xl font-black text-white md:text-[42px]">
            One logbook.
            <br />
            Two engines.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/50">
            Gym sessions and cardio runs live in the same timeline — each scored in its own
            language, unified into your Split Index.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/55">
            {[
              "Per-exercise strength scores on every set",
              "Pace, HR and splits fused for endurance",
              "Filter The Lab vs The Engine instantly",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gym-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div
          ref={ref}
          className="relative min-w-0 perspective-[1200px]"
          onPointerMove={(e) => {
            const el = ref.current;
            if (!el) return;
            const r = el.getBoundingClientRect();
            mx.set((e.clientX - r.left) / r.width - 0.5);
            my.set((e.clientY - r.top) / r.height - 0.5);
          }}
          onPointerLeave={() => {
            mx.set(0);
            my.set(0);
          }}
        >
          <motion.div
            style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
            className="relative"
          >
            {/* Browser mock */}
            <div className="landing-browser-mock">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                <span className="ml-3 text-[10px] text-white/30">splitindex.co.uk/dashboard</span>
              </div>
              <div className="grid grid-cols-2 gap-3 p-4">
                <div className="rounded-xl border border-gym-accent/20 bg-gym-bg p-4">
                  <p className="text-[9px] uppercase tracking-widest text-gym-accent">The Lab</p>
                  <p className="font-display mt-2 text-2xl font-bold text-gym-accent">724</p>
                  <Sparkline color="#3DFF6E" points="0,22 12,18 24,14 36,10 48,8 60,6 72,4" />
                </div>
                <div className="rounded-xl border border-cardio-accent/25 bg-cardio-bg p-4">
                  <p className="text-[9px] uppercase tracking-widest text-[#0B69C7]">The Engine</p>
                  <p className="font-display mt-2 text-2xl font-bold text-cardio-accent">691</p>
                  <Sparkline color="#3BA6FF" points="0,20 12,16 24,18 36,12 48,14 60,8 72,10" />
                </div>
              </div>
            </div>

            {/* Phone mock */}
            <div className="landing-phone-mock">
              <p className="text-[9px] uppercase tracking-widest text-white/40">Logbook</p>
              <div className="mt-3 space-y-2">
                {[
                  { zone: "lab", title: "Push Day", score: "718", pts: "0,18 18,14 36,10 54,8 72,6" },
                  { zone: "eng", title: "5K Run", score: "684", pts: "0,20 18,16 36,12 54,14 72,8" },
                  { zone: "lab", title: "Pull Day", score: "731", pts: "0,22 18,20 36,16 54,12 72,10" },
                ].map((row) => (
                  <div
                    key={row.title}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                      row.zone === "lab"
                        ? "border border-gym-accent/15 bg-gym-bg/80"
                        : "border border-cardio-accent/20 bg-cardio-bg/90"
                    }`}
                  >
                    <div>
                      <p className="text-[11px] font-medium">{row.title}</p>
                      <Sparkline
                        color={row.zone === "lab" ? "#3DFF6E" : "#3BA6FF"}
                        points={row.pts}
                      />
                    </div>
                    <span
                      className={`font-display text-sm font-bold ${
                        row.zone === "lab" ? "text-gym-accent" : "text-cardio-accent"
                      }`}
                    >
                      {row.score}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
