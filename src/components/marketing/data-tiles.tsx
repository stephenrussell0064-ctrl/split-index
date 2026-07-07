"use client";

import { motion, useReducedMotion } from "framer-motion";

const tiles = [
  {
    zone: "lab" as const,
    title: "Strength percentile",
    metric: "412.6",
    unit: "DOTS",
    sub: "Top 21% · Male · 82.5 kg",
    bars: [0.72, 0.58, 0.84, 0.61, 0.79],
    accent: "#3DFF6E",
    track: "#1B241D",
  },
  {
    zone: "eng" as const,
    title: "Pace & heart rate",
    metric: "4:42",
    unit: "/km",
    sub: "Avg HR 158 · EF 0.84",
    bars: [0.55, 0.62, 0.71, 0.68, 0.74],
    accent: "#3BA6FF",
    track: "#DCEAF7",
  },
  {
    zone: "lab" as const,
    title: "Session delta",
    metric: "+31",
    unit: "pts",
    sub: "8 sessions · Squat trend",
    bars: [0.45, 0.52, 0.58, 0.71, 0.84],
    accent: "#3DFF6E",
    track: "#1B241D",
  },
  {
    zone: "eng" as const,
    title: "HR zones",
    metric: "Z2",
    unit: "dominant",
    sub: "68% aerobic · 22% threshold",
    bars: [0.68, 0.22, 0.07, 0.03, 0],
    accent: "#3BA6FF",
    track: "#DCEAF7",
  },
];

export function DataTiles() {
  const reducedMotion = useReducedMotion();

  return (
    <section className="border-t border-white/[0.06] bg-[#050605] px-6 py-20 md:px-[6vw]">
      <div className="mx-auto max-w-6xl">
        <p className="landing-eyebrow text-gym-accent">Live analytics</p>
        <h2 className="font-display text-3xl font-black text-white md:text-4xl">
          Data that actually means something
        </h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile, i) => (
            <motion.article
              key={tile.title}
              initial={reducedMotion ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className={`landing-data-tile ${
                tile.zone === "lab" ? "landing-data-tile-lab" : "landing-data-tile-eng"
              }`}
            >
              <p className="text-[10px] uppercase tracking-[0.22em] opacity-55">{tile.title}</p>
              <p className="mt-3 font-display text-3xl font-bold" style={{ color: tile.accent }}>
                {tile.metric}
                <span className="ml-1 text-sm font-medium opacity-60">{tile.unit}</span>
              </p>
              <p className="mt-1 text-xs opacity-50">{tile.sub}</p>
              <div className="mt-5 flex h-12 items-end gap-1">
                {tile.bars.map((h, j) => (
                  <motion.div
                    key={j}
                    className="flex-1 rounded-sm"
                    style={{ background: tile.accent, opacity: 0.85 }}
                    initial={{ height: reducedMotion ? `${h * 48}px` : 0 }}
                    whileInView={{ height: `${h * 48}px` }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 + j * 0.05 }}
                  />
                ))}
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
