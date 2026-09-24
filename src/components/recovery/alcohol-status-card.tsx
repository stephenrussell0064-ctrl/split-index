import { AlertTriangle, Wine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BacCurveChart, type BacChartPoint } from "@/components/recovery/bac-curve-chart";
import { UK_WEEKLY_UNIT_GUIDELINE, type AlcoholImpact } from "@/lib/recovery/alcohol";
import { cn } from "@/lib/utils/cn";

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "warning" | "default";
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <p className="micro-label text-muted">{label}</p>
      <p
        className={cn(
          "index-display mt-1 text-xl font-bold tabular-nums",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning"
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Where the athlete stands on alcohol right now.
 *
 * The four numbers are the ones that change a decision: what the last episode
 * was, whether it is still in the blood, when it will not be, and what the
 * week looks like against the public-health guideline. Everything else is on
 * the curve.
 */
export function AlcoholStatusCard({
  impact,
  curvePoints,
  nowMs,
  sessionMs,
}: {
  impact: AlcoholImpact;
  curvePoints: BacChartPoint[];
  nowMs: number;
  sessionMs?: number | null;
}) {
  const stillProcessing = impact.currentBacGPerL > 0.01;
  const overGuideline = impact.weeklyUnits > UK_WEEKLY_UNIT_GUIDELINE;

  return (
    <Card padding="lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Wine className="h-3.5 w-3.5" />
          Alcohol right now
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        <p className="text-sm leading-relaxed text-foreground/90">{impact.explanation}</p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Last episode"
            value={impact.episodeUnits > 0 ? `${impact.episodeUnits} units` : "—"}
          />
          <Stat
            label="Hours since"
            value={impact.hoursSinceLastDrink != null ? `${Math.round(impact.hoursSinceLastDrink)}h` : "—"}
          />
          <Stat
            label="Estimated now"
            value={stillProcessing ? `${impact.currentBacGPerL.toFixed(2)} g/L` : "Clear"}
            tone={stillProcessing ? "danger" : "default"}
          />
          <Stat
            label="This week"
            value={`${impact.weeklyUnits} units`}
            tone={overGuideline ? "warning" : "default"}
          />
        </div>

        {stillProcessing && impact.soberAt && (
          <p className="text-xs text-muted">
            Estimated clear at around <span className="text-foreground">{formatTime(impact.soberAt)}</span>.
          </p>
        )}

        {overGuideline && (
          <p className="text-xs text-warning">
            {impact.weeklyUnits} units in the last 7 days is above the UK Chief Medical Officers&apos;
            low-risk guideline of {UK_WEEKLY_UNIT_GUIDELINE} units a week.
          </p>
        )}

        <div>
          <p className="micro-label mb-2 text-muted">Estimated blood alcohol</p>
          <BacCurveChart points={curvePoints} nowMs={nowMs} sessionMs={sessionMs} />
        </div>

        {/*
          Non-negotiable. Widmark is a population model with individual
          variation wide enough to straddle a legal limit, and a training app
          is the last place anyone should be looking for this answer.
        */}
        <div className="flex gap-2 rounded-2xl border border-warning/20 bg-warning/[0.06] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-muted">
            This is an estimate for training decisions only. It is{" "}
            <span className="text-foreground">not a measure of whether you are fit to drive</span>,
            and it cannot be — individual clearance rates vary by a factor of two, and nothing here
            is measured. Never use this figure to decide about driving or operating anything.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
