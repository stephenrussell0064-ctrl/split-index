import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import { fetchInterferenceReport } from "@/lib/scoring/interference-data";
import { hasShareableFinding, pickInterferenceHeadline } from "@/lib/scoring/interference";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

/**
 * Shareable Interference Report card (interference-engine brief, Part 4) —
 * a genuinely novel piece of shareable content built directly from Part 1's
 * real per-user output ("here's what leg day does to my running"), not a
 * generic stat card. Nothing else on the market can produce this because
 * nothing else has both halves of a hybrid athlete's training on one
 * timeline. Framed as a growth asset, not just a feature.
 */
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
    .select("username, display_name")
    .eq("user_id", user.id)
    .single();

  const report = await fetchInterferenceReport(supabase, user.id);

  // Next-stage report Section D: never generate a shareable card for a
  // placeholder or population-average-disguised-as-personal result — only
  // once a real, non-"gathering data" finding exists in at least one
  // direction (including the coarser weekly fallback). The UI already
  // hides the share entry point below this threshold; this is the same
  // gate enforced server-side too.
  if (!hasShareableFinding(report)) {
    return new Response("Not enough paired training data yet", { status: 404 });
  }

  const name = profile?.display_name ?? profile?.username ?? "This athlete";
  const headline = pickInterferenceHeadline(report);
  const secondary =
    !report.strengthToCardio.calibrating && !report.cardioToStrength.calibrating
      ? report.cardioToStrength.summary
      : null;

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
          <div style={{ fontSize: 28, color: "#8b8b9e", letterSpacing: 2 }}>
            SPLIT INDEX · INTERFERENCE REPORT
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, marginTop: 12 }}>{name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 46, fontWeight: 600, lineHeight: 1.3, maxWidth: 1000 }}>
            {headline}
          </div>
          {secondary && (
            <div style={{ fontSize: 28, color: "#b8b8c8", maxWidth: 1000 }}>{secondary}</div>
          )}
        </div>

        <div style={{ fontSize: 22, color: "#6b6b7e" }}>splitindex.app/interference</div>
      </div>
    ),
    { width: CARD_WIDTH, height: CARD_HEIGHT }
  );
}
