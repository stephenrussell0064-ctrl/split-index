import { NextResponse } from "next/server";
import { parseBody } from "@/lib/validation/boundary";
import { createClient } from "@/lib/supabase/server";
import { databaseError } from "@/lib/api/errors";
import { computeRecentLoads } from "@/lib/scoring/service";
import { calculateACWR, calculateFatigueScore, calculateRecoveryScore } from "@/lib/scoring/engine";
import { scoreAndPersist } from "@/lib/activities/score-and-persist";
import {
  BODYWEIGHT_BOUND_KG,
  HRV_BOUND_MS,
  RESTING_HR_BOUND,
  dailyMean,
  healthImportBatchSchema,
  nightlySleepHours,
  utcDayStart,
  withinBound,
  workoutToActivity,
  type HealthImportBatch,
} from "@/lib/health/samples";
import type { Profile } from "@/types";

/**
 * Apple Health read import (logging-effort plan, phase 1).
 *
 *   GET     — whether this athlete has connected, and when they last synced.
 *   PUT     — connect: the athlete has been through Apple's permission sheet.
 *   POST    — a batch of samples the iOS shell read from the health store.
 *   DELETE  — disconnect. The state row stays (so the cursor does); nothing
 *             imported is removed. The data is the athlete's and leaves with
 *             the account, not with the connection.
 *
 * EVERY SAMPLE ONCE. The client syncs from a few days before the newest
 * sample it has seen, deliberately, because the health store back-fills —
 * a watch syncs to the phone hours later. `health_imports` (migration 089)
 * is keyed by sample uuid and is what stops the overlap writing a workout or
 * a reading twice. A sample that was read and deliberately not written (a
 * strength workout with no sets; a run already logged by hand) is recorded
 * too, with no target, so it is not reconsidered on every sync either.
 *
 * WHAT LANDS WHERE, and the two rules that keep it honest:
 *
 *   - Workouts become `activities` rows with source 'apple_health' and the
 *     sample uuid as external_id, scored through the same scoreAndPersist
 *     the edit and merge paths use, so an imported run and a typed one get
 *     the same number. A workout whose start is within ten minutes of a
 *     session the athlete already logged for the same sport is treated as
 *     that session, not a second one.
 *   - HRV, resting heart rate and sleep go onto the day's
 *     `recovery_snapshots` row; bodyweight into `body_metrics`. An HRV
 *     reading the athlete TYPED for a day is never overwritten by an import
 *     — Apple's SDNN and the manual rMSSD are different instruments, the row
 *     says which it holds, and the recovery baseline is built per source.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const MANUAL_MATCH_WINDOW_MS = 10 * 60 * 1000;
const DAY_MS = 86_400_000;

async function loadState(supabase: SupabaseServerClient, userId: string) {
  const { data } = await supabase
    .from("health_import_state")
    .select("connected_at, disconnected_at, last_sync_at, last_sample_at")
    .eq("user_id", userId)
    .maybeSingle();
  const connected = !!data && data.disconnected_at == null;
  return {
    connected,
    connectedAt: connected ? (data?.connected_at as string) : null,
    lastSyncAt: (data?.last_sync_at as string | null) ?? null,
    lastSampleAt: (data?.last_sample_at as string | null) ?? null,
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await loadState(supabase, user.id));
}

export async function PUT() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("health_import_state").upsert(
    {
      user_id: user.id,
      provider: "apple_health",
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return databaseError(error, { operation: "PUT /api/health/import" });
  return NextResponse.json(await loadState(supabase, user.id));
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("health_import_state")
    .update({ disconnected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (error) return databaseError(error, { operation: "DELETE /api/health/import" });
  return NextResponse.json(await loadState(supabase, user.id));
}

interface ImportRecord {
  user_id: string;
  sample_uuid: string;
  kind: "workout" | "hrv" | "resting_hr" | "body_mass" | "sleep";
  recorded_at: string;
  target_table: string | null;
  target_id: string | null;
}

/** The uuids this athlete has already imported, out of the ones in this batch. Chunked: a first sync can carry thousands. */
async function alreadyImported(
  supabase: SupabaseServerClient,
  userId: string,
  uuids: string[]
): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < uuids.length; i += 400) {
    const chunk = uuids.slice(i, i + 400);
    const { data } = await supabase
      .from("health_imports")
      .select("sample_uuid")
      .eq("user_id", userId)
      .in("sample_uuid", chunk);
    for (const row of data ?? []) seen.add(row.sample_uuid as string);
  }
  return seen;
}

/**
 * The recovery_snapshots row for one UTC day, created if there is none.
 *
 * The same shape and the same UTC-day bucket as POST /api/recovery/hrv, so
 * an import and a typed reading land on the same row. recovery_score and
 * fatigue_score are NOT NULL and nothing reads them back (that route says
 * so); they are computed once per request to satisfy the columns.
 */
class SnapshotDays {
  private cache = new Map<string, { id: string; hrv_ms: number | null; source: string }>();

  constructor(
    private supabase: SupabaseServerClient,
    private userId: string,
    private filler: { recovery_score: number; fatigue_score: number }
  ) {}

  async forDay(day: string, recordedAt: string) {
    const cached = this.cache.get(day);
    if (cached) return cached;
    const start = utcDayStart(day);
    const end = new Date(Date.parse(start) + DAY_MS).toISOString();
    const { data: existing } = await this.supabase
      .from("recovery_snapshots")
      .select("id, hrv_ms, source")
      .eq("user_id", this.userId)
      .gte("recorded_at", start)
      .lt("recorded_at", end)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      const row = {
        id: existing.id as string,
        hrv_ms: existing.hrv_ms != null ? Number(existing.hrv_ms) : null,
        source: (existing.source as string | null) ?? "manual",
      };
      this.cache.set(day, row);
      return row;
    }
    const { data: created, error } = await this.supabase
      .from("recovery_snapshots")
      .insert({
        user_id: this.userId,
        recorded_at: recordedAt,
        source: "apple_health",
        ...this.filler,
      })
      .select("id")
      .single();
    if (error || !created) return null;
    const row = { id: created.id as string, hrv_ms: null, source: "apple_health" };
    this.cache.set(day, row);
    return row;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseBody(request, healthImportBatchSchema);
  if (parsed.response) return parsed.response;
  const batch: HealthImportBatch = parsed.data;

  const state = await loadState(supabase, user.id);
  if (!state.connected) {
    return NextResponse.json({ error: "Apple Health is not connected" }, { status: 409 });
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const allUuids = [
    ...batch.workouts.map((w) => w.uuid),
    ...batch.hrv.map((s) => s.uuid),
    ...batch.restingHr.map((s) => s.uuid),
    ...batch.bodyMass.map((s) => s.uuid),
    ...batch.sleep.map((s) => s.uuid),
  ];
  const seen = await alreadyImported(supabase, user.id, allUuids);
  const records: ImportRecord[] = [];
  const record = (r: Omit<ImportRecord, "user_id">) => records.push({ user_id: user.id, ...r });

  const counts = {
    workouts: { imported: 0, skipped: 0, duplicates: 0, failed: 0 },
    hrvDays: 0,
    restingHrDays: 0,
    sleepNights: 0,
    bodyMass: 0,
  };

  // ── Workouts ────────────────────────────────────────────────────────────
  for (const workout of batch.workouts) {
    if (seen.has(workout.uuid)) continue;
    const fields = workoutToActivity(workout);
    if (!fields) {
      counts.workouts.skipped += 1;
      record({ sample_uuid: workout.uuid, kind: "workout", recorded_at: workout.start, target_table: null, target_id: null });
      continue;
    }

    // Already logged by hand (or by the GPS run) for the same sport around the same minute?
    const startMs = Date.parse(fields.started_at);
    const { data: nearby } = await supabase
      .from("activities")
      .select("id")
      .eq("user_id", user.id)
      .eq("sport", fields.sport)
      .eq("is_draft", false)
      .neq("source", "apple_health")
      .gte("started_at", new Date(startMs - MANUAL_MATCH_WINDOW_MS).toISOString())
      .lte("started_at", new Date(startMs + MANUAL_MATCH_WINDOW_MS).toISOString())
      .limit(1)
      .maybeSingle();
    if (nearby) {
      counts.workouts.duplicates += 1;
      record({ sample_uuid: workout.uuid, kind: "workout", recorded_at: workout.start, target_table: "activities", target_id: nearby.id as string });
      continue;
    }

    const { data: activity, error: insertError } = await supabase
      .from("activities")
      .insert({
        user_id: user.id,
        ...fields,
        source: "apple_health",
        external_id: workout.uuid,
        is_draft: false,
        metadata: {
          health: {
            activityType: workout.activityType,
            sourceName: workout.sourceName ?? null,
            deviceName: workout.deviceName ?? null,
            ...(workout.energyKcal != null ? { energyKcal: Math.round(workout.energyKcal) } : {}),
          },
        },
      })
      .select("id")
      .single();

    if (insertError || !activity) {
      // 23505: the UNIQUE(user_id, source, external_id) from 001 already holds it — same outcome as `seen`.
      if (insertError?.code === "23505") {
        record({ sample_uuid: workout.uuid, kind: "workout", recorded_at: workout.start, target_table: null, target_id: null });
      } else {
        counts.workouts.failed += 1;
        console.error("[health/import] activity insert failed:", insertError?.message);
      }
      continue;
    }

    const scored = await scoreAndPersist(supabase, user.id, profile as Profile, fields, activity.id as string);
    if (scored.workoutScoreError) {
      // The row exists and nothing scores it; scoreAndPersist has logged why.
      // Leave it: an unscored imported run is still the athlete's run, and
      // the recompute path can score it later.
      console.error("[health/import] imported activity has no score:", activity.id, scored.workoutScoreError.message);
    }
    counts.workouts.imported += 1;
    record({ sample_uuid: workout.uuid, kind: "workout", recorded_at: workout.start, target_table: "activities", target_id: activity.id as string });
  }

  // ── Daily vitals onto recovery_snapshots ────────────────────────────────
  const { data: recentScores } = await supabase
    .from("workout_scores")
    .select("load_score, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const { acute, chronic } = computeRecentLoads(recentScores ?? []);
  const acwr = calculateACWR(acute, chronic);
  const fatigueScore = calculateFatigueScore(acwr, acute);
  const recoveryScore = calculateRecoveryScore(fatigueScore, acwr, 1);
  const days = new SnapshotDays(supabase, user.id, { recovery_score: recoveryScore, fatigue_score: fatigueScore });

  const newHrv = batch.hrv.filter((s) => !seen.has(s.uuid));
  for (const [day, agg] of dailyMean(newHrv)) {
    const value = Math.round(agg.value * 10) / 10;
    const row = withinBound(value, HRV_BOUND_MS) ? await days.forDay(day, agg.latestAt) : null;
    let targetId: string | null = null;
    if (row) {
      targetId = row.id;
      // A typed reading for the day stands; only an empty day or an earlier import is written.
      const typedByAthlete = row.source === "manual" && row.hrv_ms != null;
      if (!typedByAthlete) {
        const { error } = await supabase
          .from("recovery_snapshots")
          .update({ hrv_ms: value, source: "apple_health" })
          .eq("id", row.id);
        if (!error) counts.hrvDays += 1;
      }
    }
    for (const uuid of agg.uuids) {
      record({ sample_uuid: uuid, kind: "hrv", recorded_at: agg.latestAt, target_table: targetId ? "recovery_snapshots" : null, target_id: targetId });
    }
  }

  const newResting = batch.restingHr.filter((s) => !seen.has(s.uuid));
  let newestResting: { at: string; bpm: number } | null = null;
  for (const [day, agg] of dailyMean(newResting)) {
    const bpm = Math.round(agg.value);
    const row = withinBound(bpm, RESTING_HR_BOUND) ? await days.forDay(day, agg.latestAt) : null;
    let targetId: string | null = null;
    if (row) {
      const { error } = await supabase.from("recovery_snapshots").update({ resting_hr: bpm }).eq("id", row.id);
      if (!error) {
        counts.restingHrDays += 1;
        targetId = row.id;
        if (!newestResting || agg.latestAt > newestResting.at) newestResting = { at: agg.latestAt, bpm };
      }
    }
    for (const uuid of agg.uuids) {
      record({ sample_uuid: uuid, kind: "resting_hr", recorded_at: agg.latestAt, target_table: targetId ? "recovery_snapshots" : null, target_id: targetId });
    }
  }

  const newSleep = batch.sleep.filter((s) => !seen.has(s.uuid));
  for (const [night, agg] of nightlySleepHours(newSleep)) {
    const row = agg.hours > 0 && agg.hours <= 24 ? await days.forDay(night, utcDayStart(night)) : null;
    let targetId: string | null = null;
    if (row) {
      const { error } = await supabase.from("recovery_snapshots").update({ sleep_hours: agg.hours }).eq("id", row.id);
      if (!error) {
        counts.sleepNights += 1;
        targetId = row.id;
      }
    }
    for (const uuid of agg.uuids) {
      record({ sample_uuid: uuid, kind: "sleep", recorded_at: utcDayStart(night), target_table: targetId ? "recovery_snapshots" : null, target_id: targetId });
    }
  }
  // Sleep samples that were in bed or awake were never candidates; mark them seen so they are not re-read.
  for (const s of newSleep) {
    if (!records.some((r) => r.sample_uuid === s.uuid)) {
      record({ sample_uuid: s.uuid, kind: "sleep", recorded_at: s.end, target_table: null, target_id: null });
    }
  }

  // ── Bodyweight ──────────────────────────────────────────────────────────
  let newestWeight: { at: string; kg: number } | null = null;
  for (const sample of batch.bodyMass) {
    if (seen.has(sample.uuid)) continue;
    const kg = Math.round(sample.value * 10) / 10;
    if (!withinBound(kg, BODYWEIGHT_BOUND_KG)) {
      record({ sample_uuid: sample.uuid, kind: "body_mass", recorded_at: sample.date, target_table: null, target_id: null });
      continue;
    }
    const { data: metric, error } = await supabase
      .from("body_metrics")
      .insert({ user_id: user.id, weight_kg: kg, recorded_at: sample.date })
      .select("id")
      .single();
    if (error || !metric) continue;
    counts.bodyMass += 1;
    if (!newestWeight || sample.date > newestWeight.at) newestWeight = { at: sample.date, kg };
    record({ sample_uuid: sample.uuid, kind: "body_mass", recorded_at: sample.date, target_table: "body_metrics", target_id: metric.id as string });
  }

  /*
    The profile's resting HR and bodyweight are what the plan engine and the
    strength denominator read. A measured value from the last few days beats
    whatever was typed at signup, so the newest imported one is copied there —
    but only when it is newer than anything already imported, so a sync of old
    history cannot drag the profile backwards.
  */
  const profileUpdate: Record<string, number> = {};
  const cursor = state.lastSampleAt ? Date.parse(state.lastSampleAt) : 0;
  if (newestResting && Date.parse(newestResting.at) >= cursor) profileUpdate.resting_hr = newestResting.bpm;
  if (newestWeight && Date.parse(newestWeight.at) >= cursor) profileUpdate.weight_kg = newestWeight.kg;
  if (Object.keys(profileUpdate).length > 0) {
    await supabase.from("profiles").update(profileUpdate).eq("user_id", user.id);
  }

  // ── Bookkeeping ─────────────────────────────────────────────────────────
  for (let i = 0; i < records.length; i += 400) {
    const { error } = await supabase
      .from("health_imports")
      .upsert(records.slice(i, i + 400), { onConflict: "user_id,sample_uuid", ignoreDuplicates: true });
    if (error) console.error("[health/import] could not record imported samples:", error.message);
  }

  const newestSeen = [batch.newestSampleAt, state.lastSampleAt].filter((v): v is string => !!v).sort().at(-1) ?? null;
  await supabase
    .from("health_import_state")
    .update({
      last_sync_at: new Date().toISOString(),
      ...(newestSeen ? { last_sample_at: newestSeen } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  return NextResponse.json({ ...counts, lastSampleAt: newestSeen });
}
