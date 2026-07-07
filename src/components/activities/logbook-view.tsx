"use client";

import { useState } from "react";
import Link from "next/link";
import { ActivityListSection } from "@/components/activities/activity-list-section";

type Filter = "all" | "gym" | "cardio";

interface ActivityRow {
  id: string;
  sport: string;
  title: string | null;
  started_at: string;
  duration_seconds: number | null;
  distance_meters: number | null;
}

export function LogbookView({
  gymRows,
  cardioRows,
  scoreMap,
}: {
  gymRows: ActivityRow[];
  cardioRows: ActivityRow[];
  scoreMap: Record<string, number>;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "gym", label: "The Lab" },
    { id: "cardio", label: "The Engine" },
  ];

  const showGym = filter === "all" || filter === "gym";
  const showCardio = filter === "all" || filter === "cardio";
  const singleColumn = filter !== "all";

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setFilter(chip.id)}
            className={`logbook-filter-chip ${
              filter === chip.id
                ? chip.id === "cardio"
                  ? "logbook-filter-chip-active-eng"
                  : "logbook-filter-chip-active"
                : ""
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className={`grid gap-6 ${singleColumn ? "max-w-2xl" : "lg:grid-cols-2"}`}>
        {showGym && (
          <div className="bg-gym-zone rounded-2xl border border-gym-border/40 overflow-hidden">
            <div className="px-5 py-4 border-b border-gym-border/30 flex items-center justify-between">
              <p className="micro-label text-gym-accent">The Lab</p>
              <Link href="/gym" className="text-xs text-gym-accent hover:text-gym-accent/80">
                Gym HQ →
              </Link>
            </div>
            <ActivityListSection items={gymRows} zone="gym" scoreMap={scoreMap} />
          </div>
        )}
        {showCardio && (
          <div className="bg-cardio-zone rounded-2xl border border-cardio-border/40 overflow-hidden">
            <div className="px-5 py-4 border-b border-cardio-border/30 flex items-center justify-between">
              <p className="micro-label text-cardio-accent">The Engine</p>
              <Link href="/cardio" className="text-xs text-cardio-accent hover:text-cardio-accent/80">
                Cardio HQ →
              </Link>
            </div>
            <ActivityListSection items={cardioRows} zone="cardio" scoreMap={scoreMap} />
          </div>
        )}
      </div>
    </>
  );
}
