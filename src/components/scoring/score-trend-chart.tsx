"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ChartFigure } from "@/components/analytics/chart-figure";
import { describeSeries } from "@/lib/a11y/describe-series";
import { formatIndex } from "@/lib/utils/format";
import type { ScoreTrendPoint } from "@/lib/scoring/score-trend";

/**
 * One score, over the athlete's recent sessions. Shared by all three sheets so
 * they cannot drift into three slightly different charts of the same thing.
 *
 * FEWER THAN TWO POINTS DRAWS NOTHING. One dot is a reading, not a trend, and a
 * chart carrying one dot implies a shape that is not there.
 *
 * A FAILED FETCH DRAWS NOTHING EITHER, silently. The sentences above it explain
 * the score perfectly well on their own, and an error banner inside an
 * explanation sheet teaches the athlete nothing about their training.
 */
export function ScoreTrendChart({
  kind,
  seriesKey,
  metric,
  heading,
  seriesName,
  referenceAt,
  footnote,
}: {
  kind: "cardio" | "strength";
  /** A sport for cardio, an exercise name for strength. */
  seriesKey?: string | null;
  metric: "personal" | "population";
  heading: string;
  /** Names the series in the screen-reader summary. */
  seriesName: string;
  /** Displayed-scale value for the dashed horizontal, when one means something. */
  referenceAt?: number;
  footnote?: string;
}) {
  const [points, setPoints] = useState<ScoreTrendPoint[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!seriesKey) return;
    const controller = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams({ kind, key: seriesKey, metric });
        const res = await fetch(`/api/scores/trend?${params}`, { signal: controller.signal });
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const body: { points?: ScoreTrendPoint[] } = await res.json();
        setPoints(body.points ?? []);
      } catch (err) {
        // An aborted fetch is the sheet closing, not a failure to report.
        if ((err as Error)?.name !== "AbortError") setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [kind, seriesKey, metric]);

  if (!seriesKey || failed || points === null || points.length < 2) return null;

  const data = points.map((p) => ({
    shown: Number(formatIndex(p.score)),
    label: new Date(p.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  }));

  return (
    <div className="mt-4 border-t border-white/5 pt-4">
      <p className="text-[10px] uppercase tracking-wider text-muted">
        {heading.replace("{n}", String(data.length))}
      </p>
      <div className="mt-2 h-32">
        <ChartFigure
          label={`${seriesName}, over recent sessions`}
          summary={describeSeries(
            seriesName,
            data.map((d) => ({ at: d.label, value: d.shown }))
          )}
          columns={[
            { header: "Session", cell: (d: (typeof data)[number]) => d.label },
            { header: "Score", cell: (d: (typeof data)[number]) => d.shown.toFixed(1) },
          ]}
          rows={data}
        >
          <ResponsiveContainer width="100%" height={128}>
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9 }}
                stroke="rgba(255,255,255,0.35)"
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                tick={{ fontSize: 9 }}
                stroke="rgba(255,255,255,0.35)"
                width={28}
              />
              {referenceAt !== undefined && (
                <ReferenceLine y={referenceAt} stroke="rgba(255,255,255,0.45)" strokeDasharray="4 4" />
              )}
              <Line
                type="monotone"
                dataKey="shown"
                stroke="currentColor"
                strokeWidth={2}
                dot={{ r: 2 }}
                isAnimationActive={false}
                className="text-cardio-accent"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartFigure>
      </div>
      {footnote && <p className="mt-1 text-[10px] text-muted">{footnote}</p>}
    </div>
  );
}
