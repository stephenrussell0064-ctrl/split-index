import { Share2, TrendingUp, TrendingDown, Gauge } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { PremiumTease } from "@/components/premium/premium-tease";
import type { HybridAthleteReport } from "@/lib/scoring/hybrid-report";

const SAMPLE_REPORT: HybridAthleteReport = {
  period: "monthly",
  periodStart: new Date().toISOString(),
  generatedAt: new Date().toISOString(),
  scoreTrend: { startIndex: 612, endIndex: 648, deltaPct: 5.9 },
  readinessTrend: { start: 58, end: 71, delta: 13 },
  interferenceHeadline:
    "Heavy leg sessions cost you roughly 8s/km on runs the next day, recovering by day 3.",
  targetPaceLabel: "Target: 20:33 for your next 5K attempt",
};

function ReportContent({ report }: { report: HybridAthleteReport }) {
  const scoreUp = (report.scoreTrend.deltaPct ?? 0) >= 0;
  const readinessUp = report.readinessTrend.delta >= 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="micro-label mb-1 text-muted">Split Index trend</p>
          {report.scoreTrend.startIndex !== null && report.scoreTrend.endIndex !== null ? (
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold tabular-nums">{report.scoreTrend.endIndex}</p>
              <span
                className={`flex items-center gap-1 text-xs font-medium ${scoreUp ? "text-success" : "text-danger"}`}
              >
                {scoreUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {report.scoreTrend.deltaPct !== null ? `${report.scoreTrend.deltaPct}%` : "—"}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted">Not enough history yet this period.</p>
          )}
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="micro-label mb-1 flex items-center gap-1.5 text-muted">
            <Gauge className="h-3 w-3" /> Readiness trend
          </p>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-bold tabular-nums">{report.readinessTrend.end}</p>
            <span
              className={`flex items-center gap-1 text-xs font-medium ${readinessUp ? "text-success" : "text-danger"}`}
            >
              {readinessUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {report.readinessTrend.delta > 0 ? "+" : ""}
              {report.readinessTrend.delta}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="micro-label mb-1 text-muted">Cross-training finding</p>
        <p className="text-sm font-medium text-foreground/90">{report.interferenceHeadline}</p>
      </div>

      {report.targetPaceLabel && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="micro-label mb-1 text-muted">Race prediction</p>
          <p className="text-sm font-medium text-foreground/90">{report.targetPaceLabel}</p>
        </div>
      )}
    </div>
  );
}

export function HybridReportView({
  report,
  isPremium,
}: {
  report: HybridAthleteReport | null;
  isPremium: boolean;
}) {
  return (
    <Card>
      <CardHeader className="mb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Hybrid Athlete Report</CardTitle>
          {isPremium && report && (
            <a
              href="/api/reports/hybrid/card"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </a>
          )}
        </div>
        <p className="text-xs text-muted">
          Score trend, cross-training interference, readiness trend, and race prediction —
          synthesized monthly into one document, the kind that currently takes three apps and a
          spreadsheet to approximate by hand.
        </p>
      </CardHeader>
      <CardContent>
        {!isPremium ? (
          <PremiumTease
            title="Your monthly Hybrid Athlete Report"
            subtitle="Score trend, interference findings, readiness trend, and race prediction — synthesized into one exportable document. Unlock with Premium."
          >
            <ReportContent report={SAMPLE_REPORT} />
          </PremiumTease>
        ) : report ? (
          <ReportContent report={report} />
        ) : (
          <p className="py-8 text-center text-sm text-muted">
            Your first report generates at the start of next month — keep logging both sides of
            your training in the meantime.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
