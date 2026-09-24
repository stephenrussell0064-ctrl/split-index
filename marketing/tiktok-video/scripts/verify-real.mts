/**
 * Read-only check that the numbers in the real screenshots still match the
 * account they were taken from. Never resolves the account by email — the git
 * email's account is near-empty; the screenshots come from the id below.
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the repo's .env.local.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeIndexes } from "../../../src/lib/scoring/index-engine";
import { tierForScore } from "../../../src/lib/scoring/split-strength-engine";
import { formatIndex } from "../../../src/lib/utils/format";

for (const line of readFileSync("../../.env.local", "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const USER_PREFIX = "f0c63c26";

const { data: profs, error } = await sb.from("profiles").select("user_id, username, age, weight_kg, gender, max_hr, resting_hr").eq("username", "split_index_ceo");
if (profs?.length && !profs[0].user_id.startsWith(USER_PREFIX)) throw new Error("username resolved to a different account than the screenshots");
if (error || !profs?.length) throw new Error(`profile lookup failed: ${error?.message}`);
const p = profs[0];
console.log("profile:", JSON.stringify({ ...p, user_id: p.user_id.slice(0, 8) + "…" }));

const { data: acts } = await sb.from("activities").select("*").eq("user_id", p.user_id).order("started_at", { ascending: false }).limit(60);
console.log("columns:", Object.keys(acts![0]).join(", "));
console.log("breakdown keys:", Object.keys(acts![0].score_breakdown ?? {}).join(", "));
const rows = acts!.map((a) => ({ sport: a.sport, started: a.started_at?.slice(0, 10), idx: a.sport_index, dist: a.distance_meters, dur: a.duration_seconds, type: a.session_type, conf: a.score_breakdown?.cardio_activity?.confidence ?? a.score_breakdown?.activityConfidence ?? null }));
console.table(rows.slice(0, 40));
writeFileSync("/private/tmp/claude-501/-Users-stephenrussell-Projects-split-index/2c614834-851b-4abb-ad0f-a3a4f74a29af/scratchpad/real-acts.json", JSON.stringify(acts, null, 1));
const activities = acts!.filter((a) => a.sport_index != null).map((a) => ({ side: a.sport === "gym" ? ("lab" as const) : ("engine" as const), score: a.sport_index, confidence: 0.8, date: a.started_at, sport: a.sport === "gym" ? undefined : ("run" as const) }));
const ix = computeIndexes(activities, "hybrid", 0.5);
console.log("computeIndexes:", { lab: ix.labIndex && formatIndex(ix.labIndex), engine: ix.engineIndex && formatIndex(ix.engineIndex), split: ix.splitIndex && formatIndex(ix.splitIndex), tier: ix.splitIndex && tierForScore(ix.splitIndex) });
