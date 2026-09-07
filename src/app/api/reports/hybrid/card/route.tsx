import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import { fetchLatestHybridReport } from "@/lib/scoring/hybrid-report-data";
import { getEntitlements } from "@/lib/premium/entitlements";
import { formatIndex } from "@/lib/utils/format";
import { shareableAthleteName } from "@/lib/social/shareable-name";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

/** Shareable export of the Hybrid Athlete Report (Part 5) — same reasoning as the Part 4 Interference Report card: a real, per-user document rendered as a PNG, gated to premium since the report itself is. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, subscription_tier, subscription_status")
    .eq("user_id", user.id)
    .single();

  const entitlements = await getEntitlements(supabase, user.id);
  if (!profile || !entitlements.premium) {
    return new Response("Premium required", { status: 403 });
  }

  const report = await fetchLatestHybridReport(supabase, user.id, "monthly");
  if (!report) {
    return new Response("No report generated yet", { status: 404 });
  }

  const name = shareableAthleteName(profile.display_name, profile.username);
  const scoreLine =
    report.scoreTrend.startIndex !== null && report.scoreTrend.endIndex !== null
      ? `Split Index ${formatIndex(report.scoreTrend.startIndex)} → ${formatIndex(report.scoreTrend.endIndex)} (${
          report.scoreTrend.deltaPct !== null && report.scoreTrend.deltaPct >= 0 ? "+" : ""
        }${report.scoreTrend.deltaPct ?? "—"}%)`
      : "Split Index — building history this period";
  /*
    NO READINESS ON THE CARD (M10).

    This rendered `Readiness <start> → <end>`. D4 permits a shared card to carry
    the username, the score, the tier and the interference finding — and nothing
    else. Readiness is outside that list.

    Being precise about WHY, because the audit finding that raised this was
    wrong about it and the wrong reason would send the next person hunting the
    wrong thing: readiness here is NOT Article 9 health data. `computeReadiness`
    takes `sessions` and derives an acute:chronic workload ratio from training
    load. It reads no health table, no PAR-Q answer, no HRV and no sleep row.
    The audit called it "a Tier 2-derived value"; measured, it is Tier 1
    training data held on contract necessity.

    It comes off the card anyway, for the reason that survives the correction:
    a readiness figure printed next to somebody's name on an image built to be
    posted publicly is an inference about their physical condition, and D4's
    allowlist exists precisely so that judgement is not made per-field by
    whoever is adding a line to a PNG.
  */

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          background: "linear-gradient(135deg, #0a0a0f 0%, #14141f 100%)",
          color: "#f5f5f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 26, color: "#8b8b9e", letterSpacing: 2 }}>
            SPLIT INDEX · HYBRID ATHLETE REPORT
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, marginTop: 12 }}>{name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 32, fontWeight: 600 }}>{scoreLine}</div>
          <div style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.3, maxWidth: 1000, marginTop: 8 }}>
            {report.interferenceHeadline}
          </div>
          {report.targetPaceLabel && (
            <div style={{ fontSize: 26, color: "#b8b8c8" }}>{report.targetPaceLabel}</div>
          )}
        </div>

        <div style={{ fontSize: 22, color: "#6b6b7e" }}>splitindex.app/reports</div>
      </div>
    ),
    { width: CARD_WIDTH, height: CARD_HEIGHT }
  );
}
