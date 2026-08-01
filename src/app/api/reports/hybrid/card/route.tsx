import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import { fetchLatestHybridReport } from "@/lib/scoring/hybrid-report-data";
import { isPremiumUser } from "@/lib/retention/trial";

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

  if (!profile || !isPremiumUser(profile.subscription_tier, profile.subscription_status)) {
    return new Response("Premium required", { status: 403 });
  }

  const report = await fetchLatestHybridReport(supabase, user.id, "monthly");
  if (!report) {
    return new Response("No report generated yet", { status: 404 });
  }

  const name = profile.display_name ?? profile.username ?? "This athlete";
  const scoreLine =
    report.scoreTrend.startIndex !== null && report.scoreTrend.endIndex !== null
      ? `Split Index ${report.scoreTrend.startIndex} → ${report.scoreTrend.endIndex} (${
          report.scoreTrend.deltaPct !== null && report.scoreTrend.deltaPct >= 0 ? "+" : ""
        }${report.scoreTrend.deltaPct ?? "—"}%)`
      : "Split Index — building history this period";
  const readinessLine = `Readiness ${report.readinessTrend.start} → ${report.readinessTrend.end}`;

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
          <div style={{ fontSize: 28, color: "#b8b8c8" }}>{readinessLine}</div>
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
