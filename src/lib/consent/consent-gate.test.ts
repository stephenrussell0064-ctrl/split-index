import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARTICLE9_CONSENT_KEY,
  ARTICLE9_CONSENT_TEXT,
  ARTICLE9_CONSENT_VERSION,
  TIER2_INTAKE_FIELDS,
  TIER2_INTAKE_SECTIONS,
  getArticle9Consent,
  hasArticle9Consent,
  isTier2Section,
  recordArticle9Event,
  stripTier2Fields,
} from "./article9";
import { SECTION_FIELDS } from "@/lib/scoring/hpe/intake-record";

/**
 * The boundary `article9.ts` says is asserted here.
 *
 * Its docblock: "Refusing this disables the Hybrid Plan Engine and the injury
 * Risk Index. It must not touch anything else: logging, scoring, the Split
 * Index, the leaderboard, the analytics page, social, and the subscription all
 * work exactly as before. That is not a courtesy — a consent that costs you the
 * product you paid for is not freely given, and would not be valid.
 * consent-gate.test.ts asserts that boundary in both directions."
 *
 * There was no such file, which left the legal claim resting on nobody having
 * wired the gate anywhere new.
 *
 * BOTH DIRECTIONS, and the second one is the awkward half to test: proving a
 * refusal does NOT affect logging means proving an absence across the whole
 * app, which no unit test of this module can see. So that direction is checked
 * where it is actually decidable — over the source, by enumerating every place
 * the gate is consulted and holding that list to the surfaces the consent
 * covers. A gate added to the logbook would fail it on the next run.
 */

/** No trailing separator, so a sliced path keeps its leading "/". */
const SRC = fileURLToPath(new URL("../..", import.meta.url)).replace(/[/\\]$/, "");

/** Files that consult the consent, whatever they do with the answer. */
function callSites(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
        const src = readFileSync(full, "utf8");
        if (/hasArticle9Consent|getArticle9Consent|stripTier2Fields|isTier2Section/.test(src)) {
          found.push(full.slice(SRC.length).replace(/\\/g, "/"));
        }
      }
    }
  };
  walk(SRC);
  return found.filter((f) => f !== "/lib/consent/article9.ts").sort();
}

/**
 * Where the gate is allowed to be, and why.
 *
 * Anything else appearing here is either the gate spreading into a surface the
 * consent does not cover — which makes the consent unfree, and invalid — or a
 * new HPE surface that belongs on this list. Both need a person to decide,
 * which is why this is a list and not a prefix match on "/api/hpe/".
 */
const GATED_SURFACES: Record<string, string> = {
  "/app/(app)/analytics/page.tsx":
    "The injury Risk Index. The ACWR ratio underneath it is a training-load figure and stays; the risk framing built on it is what the consent covers.",
  "/app/api/hpe/plan/route.ts": "The Hybrid Plan Engine itself.",
  "/app/api/hpe/intake/route.ts": "The health and fuelling screens that collect the data.",
  "/app/api/hpe/monitoring/route.ts": "HPE monitoring, which reads the same answers.",
  "/app/api/consent/article9/route.ts": "The consent screen reading and recording the decision.",
  "/components/hybrid-plan/intake-wizard.tsx":
    "The wizard showing the refusal state instead of the Tier 2 questions.",
};

describe("the gate reaches the Hybrid Plan and the Risk Index, and nothing else", () => {
  it("is consulted only on surfaces the consent covers", () => {
    const unexpected = callSites().filter((f) => !GATED_SURFACES[f]);
    expect(unexpected).toEqual([]);
  });

  it("is still consulted on every one of them", () => {
    // The other way this goes wrong: a refactor that drops the check. An
    // ungated HPE route processes health answers without permission.
    const sites = callSites();
    const missing = Object.keys(GATED_SURFACES).filter((f) => !sites.includes(f));
    expect(missing).toEqual([]);
  });

  it("does not reach logging, scoring, the leaderboard, social or billing", () => {
    // The named surfaces from the docblock, stated as themselves rather than
    // left implicit in the list above — these are the ones a consent may not
    // cost you.
    const forbidden = callSites().filter((f) =>
      /activities|logbook|scoring|leaderboard|social|billing|subscription|stripe|revenuecat/i.test(f)
    );
    expect(forbidden).toEqual([]);
  });
});

describe("what the consent covers", () => {
  it("is derived from the intake sections, not copied", () => {
    // A hand-copied list goes stale in exactly the direction that matters: a
    // health question added later would sit outside the gate.
    const expected = TIER2_INTAKE_SECTIONS.flatMap((s) => SECTION_FIELDS[s]);
    expect([...TIER2_INTAKE_FIELDS].sort()).toEqual([...expected].sort());
    expect(TIER2_INTAKE_FIELDS).toContain("parq_positive");
    expect(TIER2_INTAKE_FIELDS).toContain("lea_amenorrhoea");
  });

  it("knows which sections are inside it", () => {
    expect(isTier2Section("health")).toBe(true);
    expect(isTier2Section("fuelling")).toBe(true);
    expect(isTier2Section("goal")).toBe(false);
    expect(isTier2Section("not-a-section")).toBe(false);
  });

  it("strips every covered field and leaves the rest alone", () => {
    /*
      The write path's backstop: a client that has not been told about the gate
      — an old app build, a replayed request — cannot land health answers by
      sending them inside a section that is otherwise allowed.
    */
    const stripped = stripTier2Fields({
      parq_positive: true,
      injury_sites: ["knee"],
      lea_trains_fasted: true,
      target_squat_kg: 180,
      max_sessions_per_week: 5,
    });
    expect(stripped).toEqual({ target_squat_kg: 180, max_sessions_per_week: 5 });
  });

  it("strips nothing from a payload that carries none", () => {
    const values = { target_squat_kg: 180, notes: "knees felt fine" };
    expect(stripTier2Fields(values)).toEqual(values);
  });
});

/** The Supabase surface these functions touch, and nothing more. */
function fakeSupabase(result: { data?: unknown; error?: unknown } | Error) {
  const inserted: unknown[] = [];
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
    insert: async (row: unknown) => {
      inserted.push(row);
      return { error: result instanceof Error ? { message: "boom" } : (result.error ?? null) };
    },
  };
  return { client: { from: () => builder } as never, inserted };
}

describe("the consent state fails closed", () => {
  it("is not granted when the table is unreachable", () => {
    // Migration 057 not applied, a dropped connection. The failure mode has to
    // be a Hybrid Plan that declines to generate, never a health screen
    // processed without permission.
    return expect(
      hasArticle9Consent(fakeSupabase(new Error("relation does not exist")).client, "u1")
    ).resolves.toBe(false);
  });

  it("is not granted when the query errors", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "permission denied" } });
    expect(await hasArticle9Consent(client, "u1")).toBe(false);
  });

  it("is not granted when nobody has decided yet", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    const state = await getArticle9Consent(client, "u1");
    expect(state).toEqual({ granted: false, decidedAt: null, version: null });
  });

  it("reads a grant, with what was agreed to and when", async () => {
    const { client } = fakeSupabase({
      data: {
        action: "granted",
        wording_version: "2026-09-06.1",
        created_at: "2026-09-06T10:00:00.000Z",
      },
      error: null,
    });
    expect(await getArticle9Consent(client, "u1")).toEqual({
      granted: true,
      decidedAt: "2026-09-06T10:00:00.000Z",
      version: "2026-09-06.1",
    });
  });

  it("treats a withdrawal as not granted", async () => {
    // The newest event wins, and this is what makes refusal reversible in
    // both directions — the point of an append-only record.
    const { client } = fakeSupabase({
      data: {
        action: "withdrawn",
        wording_version: "2026-09-06.1",
        created_at: "2026-09-07T10:00:00.000Z",
      },
      error: null,
    });
    expect(await hasArticle9Consent(client, "u1")).toBe(false);
  });
});

describe("recording a decision", () => {
  it("stores the wording as shown, not a reference to it", async () => {
    // So the row still answers "what did they agree to" after the constant
    // changes.
    const { client, inserted } = fakeSupabase({ error: null });
    const { error } = await recordArticle9Event(client, "u1", "granted");
    expect(error).toBeNull();
    expect(inserted[0]).toEqual({
      user_id: "u1",
      action: "granted",
      consent_key: ARTICLE9_CONSENT_KEY,
      wording_version: ARTICLE9_CONSENT_VERSION,
      wording_text: ARTICLE9_CONSENT_TEXT,
    });
  });

  it("records a withdrawal the same way", async () => {
    const { client, inserted } = fakeSupabase({ error: null });
    await recordArticle9Event(client, "u1", "withdrawn");
    expect((inserted[0] as { action: string }).action).toBe("withdrawn");
  });

  it("says something an athlete can act on when the insert fails", async () => {
    const { client } = fakeSupabase({ error: { message: "23505" } });
    const { error } = await recordArticle9Event(client, "u1", "granted");
    expect(error).toBe("Could not record your choice. Please try again.");
  });
});
