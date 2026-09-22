import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canViewAthlete, fetchSharedActivity } from "./shared-activity";

/**
 * One athlete reading another's training diary. Every test here is about who is
 * refused, because the failure mode is not a broken page — it is a stranger
 * reading somebody's gym log, and it looks exactly like the feature working.
 */

type Rows = Record<string, { data?: unknown; error?: { message: string } | null }>;

function fake(rows: Rows) {
  return {
    from(table: string) {
      const r = rows[table] ?? { data: [] };
      const settled = Promise.resolve({ data: r.data ?? [], error: r.error ?? null });
      const b: Record<string, unknown> = {};
      const chain = () => b;
      b.select = chain;
      b.eq = chain;
      b.in = chain;
      b.or = chain;
      b.order = chain;
      b.limit = () => settled;
      b.maybeSingle = () =>
        Promise.resolve({
          data: Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? null),
          error: r.error ?? null,
        });
      b.then = (res: (v: unknown) => unknown) => settled.then(res);
      return b;
    },
  } as unknown as SupabaseClient;
}

const ACTIVITY = {
  id: "act1",
  user_id: "owner",
  sport: "gym",
  title: "Push day",
  started_at: "2026-09-20T07:00:00Z",
  duration_seconds: 3600,
  distance_meters: null,
  avg_heart_rate: null,
  is_draft: false,
};

describe("who may read a session", () => {
  it("lets an athlete read their own", async () => {
    expect(await canViewAthlete(fake({}), "me", "me")).toBe(true);
  });

  it("lets an accepted friend read it", async () => {
    const ok = await canViewAthlete(
      fake({ blocked_users: { data: [] }, friends: { data: [{ status: "accepted" }] } }),
      "me",
      "owner"
    );
    expect(ok).toBe(true);
  });

  it("refuses a stranger", async () => {
    expect(
      await canViewAthlete(fake({ blocked_users: { data: [] }, friends: { data: [] } }), "me", "owner")
    ).toBe(false);
  });

  it("refuses when either side has blocked the other", async () => {
    // The block is checked before the friendship, because a block between two
    // people who are still nominally friends must win.
    expect(
      await canViewAthlete(
        fake({ blocked_users: { data: [{ blocker_id: "owner" }] }, friends: { data: [{ status: "accepted" }] } }),
        "me",
        "owner"
      )
    ).toBe(false);
  });

  it("refuses when the block list cannot be read", async () => {
    // The only safe direction. A false refusal costs a missing page; a false
    // allow costs somebody reading the training of a person who blocked them.
    expect(
      await canViewAthlete(
        fake({ blocked_users: { error: { message: "down" } }, friends: { data: [{ status: "accepted" }] } }),
        "me",
        "owner"
      )
    ).toBe(false);
  });

  it("refuses when the friendship cannot be read", async () => {
    expect(
      await canViewAthlete(
        fake({ blocked_users: { data: [] }, friends: { error: { message: "down" } } }),
        "me",
        "owner"
      )
    ).toBe(false);
  });
});

describe("fetching a shared session", () => {
  it("returns the lifts to a friend", async () => {
    const { activity } = await fetchSharedActivity(
      fake({
        activities: { data: [ACTIVITY] },
        blocked_users: { data: [] },
        friends: { data: [{ status: "accepted" }] },
        public_profiles: { data: [{ user_id: "owner", username: "ow", display_name: "Ow", avatar_url: null }] },
        public_workout_scores: { data: [{ sport_index: 712 }] },
        public_activity_strength_scores: {
          data: [
            { exercise_name: "Bench Press", muscle_group: "Chest", estimated_1rm_kg: 100, strength_index: 712 },
            { exercise_name: "Cable Fly", muscle_group: "Chest", estimated_1rm_kg: 30, strength_index: 520 },
          ],
        },
      }),
      "me",
      "act1"
    );
    expect(activity?.exercises.map((e) => e.exerciseName)).toEqual(["Bench Press", "Cable Fly"]);
    expect(activity?.isOwn).toBe(false);
  });

  it("refuses a stranger, and says the same thing as a missing activity", async () => {
    const { activity, denial } = await fetchSharedActivity(
      fake({ activities: { data: [ACTIVITY] }, blocked_users: { data: [] }, friends: { data: [] } }),
      "me",
      "act1"
    );
    expect(activity).toBeNull();
    expect(denial).toBe("not_visible");
  });

  it("hides a draft from a friend, and shows it to its owner", async () => {
    // A draft is a session its owner has not finished writing, not a published
    // one with a flag on it.
    const draft = { ...ACTIVITY, is_draft: true };
    const asFriend = await fetchSharedActivity(
      fake({ activities: { data: [draft] }, blocked_users: { data: [] }, friends: { data: [{ status: "accepted" }] } }),
      "me",
      "act1"
    );
    expect(asFriend.activity).toBeNull();

    const asOwner = await fetchSharedActivity(
      fake({
        activities: { data: [{ ...draft, user_id: "me" }] },
        public_profiles: { data: [] },
        public_workout_scores: { data: [] },
        public_activity_strength_scores: { data: [] },
      }),
      "me",
      "act1"
    );
    expect(asOwner.activity?.isOwn).toBe(true);
  });

  it("answers a missing activity without saying whether the id exists", async () => {
    const { denial } = await fetchSharedActivity(fake({ activities: { data: [] } }), "me", "nope");
    expect(denial).toBe("not_found");
  });
});

describe("the page and the view agree on the rule", () => {
  const root = process.cwd();

  it("the page cannot distinguish 'no such session' from 'not yours to see'", () => {
    // Two different answers would confirm that an id exists and belongs to
    // somebody who has not shared it. Small leak, real one.
    const page = readFileSync(
      join(root, "src/app/(app)/social/activity/[id]/page.tsx"),
      "utf8"
    );
    expect(page).toContain("notFound()");
    expect(page).not.toMatch(/denial\s*===\s*["']not_visible["']/);
  });

  it("the view refuses both directions of a block, not just the viewer's own", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/083_friend_activity_strength_scores.sql"),
      "utf8"
    );
    expect(sql).toContain("b.blocker_id = auth.uid() AND b.blocked_id = s.user_id");
    expect(sql).toContain("b.blocker_id = s.user_id AND b.blocked_id = auth.uid()");
    // security_invoker off is what makes the predicate the whole access rule.
    expect(sql).toContain("security_invoker = off");
    expect(sql).toMatch(/REVOKE ALL ON public_activity_strength_scores FROM PUBLIC, anon/);
  });

  it("the view exposes no notes and no score breakdown", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/083_friend_activity_strength_scores.sql"),
      "utf8"
    );
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE VIEW"));
    expect(body).not.toMatch(/\bs\.notes\b/);
    expect(body).not.toMatch(/\bscore_breakdown\b/);
  });
});
