import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Writing a row to `notifications` without writing the same row twice.
 *
 * The table has existed since migration 001 and the bell has read it the
 * whole time, but only `seedRetentionNotifications` in rank.ts ever wrote to
 * it — so in practice an athlete saw a welcome message and a streak warning
 * and nothing else, however much the app actually did for them.
 *
 * The reason to centralise the insert rather than copy rank.ts's shape into
 * each new producer is the deduplication. Every producer added here runs on a
 * schedule or on a render, and both repeat: the leaderboard cron runs against
 * the same week until the week ends, and a server component re-runs on every
 * navigation. A producer without a dedupe window is a producer that fills the
 * bell with the same sentence, which is worse than the silence it replaced —
 * a bell that cries wolf gets permanently ignored, and then the one
 * notification that mattered is ignored with it.
 *
 * THIS IS NOT A UNIQUE CONSTRAINT. Two concurrent callers can both read
 * "nothing there" and both insert; the check narrows a common case, it does
 * not close the race. That is deliberate rather than overlooked — the table
 * has no natural key to enforce (the same type legitimately recurs next
 * week), and a duplicate row in a notification list is a cosmetic annoyance
 * rather than a correctness failure. If a producer ever needs a real
 * guarantee, it needs a real constraint, not a longer window here.
 */
export interface NotifyOnceOptions {
  /** Stable machine key: "hybrid_report_ready". Grouped on for deduplication, so it must not embed varying data. */
  type: string;
  title: string;
  body: string;
  /**
   * Suppress if a row of this `type` already exists for this user at or after
   * this instant. Omit to suppress if one has EVER existed — the right window
   * for a once-per-account message like the welcome.
   */
  since?: Date;
  /** Anything the client needs to act on the row — a period key, a rank, a link target. Never deduplicated on. */
  metadata?: Record<string, unknown>;
}

export type NotifyResult =
  | { inserted: true }
  /** A row of this type already existed inside the window. The common outcome on a repeated cron run. */
  | { inserted: false; reason: "duplicate" }
  /** The insert or the lookup failed. Never thrown: see below. */
  | { inserted: false; reason: "error"; message: string };

/**
 * Best-effort by design, like the native bridges.
 *
 * Every caller is doing something more important than this — generating a
 * report, computing a leaderboard, rendering a dashboard. A notification is a
 * courtesy attached to that work, and a courtesy must never be able to fail
 * the work it is attached to. So this resolves a result instead of throwing,
 * and the caller decides whether a failure is worth reporting.
 *
 * It is still not silent. The reason comes back because "already sent" and
 * "the insert was rejected" are different facts, and only one of them is a
 * bug worth looking at.
 */
export async function notifyOnce(
  supabase: SupabaseClient,
  userId: string,
  options: NotifyOnceOptions
): Promise<NotifyResult> {
  try {
    let query = supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", options.type)
      .limit(1);

    if (options.since) {
      query = query.gte("created_at", options.since.toISOString());
    }

    const { data: existing, error: lookupError } = await query;
    if (lookupError) {
      return { inserted: false, reason: "error", message: lookupError.message };
    }
    if (existing?.length) {
      return { inserted: false, reason: "duplicate" };
    }

    const { error: insertError } = await supabase.from("notifications").insert({
      user_id: userId,
      type: options.type,
      title: options.title,
      body: options.body,
      read: false,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    });

    if (insertError) {
      return { inserted: false, reason: "error", message: insertError.message };
    }
    return { inserted: true };
  } catch (err) {
    return {
      inserted: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Midnight this morning, in the server's zone. The window for "once today". */
export function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
