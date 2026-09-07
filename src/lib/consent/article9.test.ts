import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARTICLE9_CONSENT_KEY,
  ARTICLE9_CONSENT_TEXT,
  ARTICLE9_CONSENT_VERSION,
  TIER2_INTAKE_FIELDS,
  getArticle9Consent,
  isTier2Section,
  recordArticle9Event,
  stripTier2Fields,
} from "./article9";
import { SECTION_FIELDS } from "@/lib/scoring/hpe/intake-record";

/**
 * WP11 — what makes this consent valid rather than decorative.
 *
 * Three separate claims are under test here, and they fail in different ways:
 *
 *   1. The gate covers every Article 9 field, and keeps covering them when
 *      somebody adds a question to the health screen next month.
 *   2. The consent can be evidenced — the wording and its version are stored
 *      with the event, not referenced. A consent you cannot produce the text
 *      of is a consent you do not have.
 *   3. Withdrawal deletes rather than hides, and the record of it cannot be
 *      rewritten.
 */

const MIGRATION = fileURLToPath(
  new URL("../../../supabase/migrations/060_article9_consent.sql", import.meta.url)
);

function migrationSql(): string {
  return readFileSync(MIGRATION, "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Minimal Supabase stand-in for the consent lookup and the insert. */
function fakeSupabase(
  latest: { action: string; wording_version: string; created_at: string } | null,
  opts: { error?: boolean } = {}
) {
  const inserts: Record<string, unknown>[] = [];
  const chain: Record<string, unknown> = {
    then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
      return Promise.resolve(
        resolve({ data: opts.error ? null : latest, error: opts.error ? { message: "boom" } : null })
      );
    },
    insert: (values: Record<string, unknown>) => {
      inserts.push(values);
      return chain;
    },
  };
  for (const m of ["select", "eq", "order", "limit", "maybeSingle", "single"]) {
    chain[m] = () => chain;
  }
  return { client: { from: () => chain } as never, inserts };
}

describe("what the gate covers", () => {
  it("covers every question on the health and fuelling screens", () => {
    for (const field of [...SECTION_FIELDS.health, ...SECTION_FIELDS.fuelling]) {
      expect(TIER2_INTAKE_FIELDS, `${field} is not gated`).toContain(field);
    }
  });

  it("names the specific questions that put this in Article 9", () => {
    // Spelled out rather than derived, so that removing one of these from the
    // intake is a deliberate act with a failing test attached, not a silent
    // narrowing of what we treat as health data.
    for (const field of [
      "parq_positive",
      "chest_pain_on_exertion",
      "surgery_last_6_months",
      "pregnant_or_postpartum_12wk",
      "medication_affecting_hr",
      "injury_sites",
      "lea_amenorrhoea",
      "lea_bone_stress_injury",
    ]) {
      expect(TIER2_INTAKE_FIELDS).toContain(field);
    }
  });

  it("leaves the Tier 1 training questions outside the gate", () => {
    // Contract necessity, not consent. Gating these would make refusal cost
    // the athlete the product, which is what makes a consent unfree.
    for (const field of [
      ...SECTION_FIELDS.goal,
      ...SECTION_FIELDS.availability,
      ...SECTION_FIELDS.training,
    ]) {
      expect(TIER2_INTAKE_FIELDS, `${field} should not be gated`).not.toContain(field);
    }
  });

  it("treats health and fuelling as Tier 2 sections and nothing else", () => {
    expect(isTier2Section("health")).toBe(true);
    expect(isTier2Section("fuelling")).toBe(true);
    for (const s of ["goal", "history", "body", "training", "availability", "recovery"]) {
      expect(isTier2Section(s)).toBe(false);
    }
  });

  it("strips every Tier 2 key and keeps the rest", () => {
    const out = stripTier2Fields({
      parq_positive: true,
      lea_amenorrhoea: true,
      max_sessions_per_week: 5,
    });
    expect(out).toEqual({ max_sessions_per_week: 5 });
  });
});

describe("consent state", () => {
  it("reads the newest event, so a withdrawal overrides an earlier grant", async () => {
    const { client } = fakeSupabase({
      action: "withdrawn",
      wording_version: ARTICLE9_CONSENT_VERSION,
      created_at: "2026-09-01T00:00:00.000Z",
    });
    expect((await getArticle9Consent(client, "u1")).granted).toBe(false);
  });

  it("reports not-granted when the athlete has never been asked", async () => {
    const { client } = fakeSupabase(null);
    const state = await getArticle9Consent(client, "u1");
    expect(state).toEqual({ granted: false, decidedAt: null, version: null });
  });

  it("fails closed when the consent table cannot be read", async () => {
    // An unapplied migration or a dropped connection must produce "no consent",
    // never "carry on". The failure mode of this function is a Hybrid Plan that
    // declines to generate, not a health screen processed without permission.
    const { client } = fakeSupabase(null, { error: true });
    expect((await getArticle9Consent(client, "u1")).granted).toBe(false);
  });
});

describe("the consent can be evidenced", () => {
  it("stores the exact wording and its version with the event", async () => {
    const { client, inserts } = fakeSupabase(null);
    await recordArticle9Event(client, "u1", "granted");

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      user_id: "u1",
      action: "granted",
      consent_key: ARTICLE9_CONSENT_KEY,
      wording_version: ARTICLE9_CONSENT_VERSION,
      wording_text: ARTICLE9_CONSENT_TEXT,
    });
  });

  it("records a withdrawal as its own event rather than removing the grant", async () => {
    const { client, inserts } = fakeSupabase(null);
    await recordArticle9Event(client, "u1", "withdrawn");
    expect(inserts[0]).toMatchObject({ action: "withdrawn" });
  });

  it("says what it is asking for in words an athlete can act on", () => {
    const text = ARTICLE9_CONSENT_TEXT.toLowerCase();
    // Explicit means the subject cannot be left to inference.
    expect(text).toContain("health data");
    // Refusable, and the cost of refusing stated honestly.
    expect(text).toContain("you do not have to");
    // Withdrawable, and withdrawal means deletion.
    expect(text).toContain("delete");
  });
});

describe("migration 057 — the guarantees the code cannot make on its own", () => {
  const sql = migrationSql();

  it("keeps the consent log append-only by granting no UPDATE or DELETE", () => {
    expect(sql).toMatch(/CREATE POLICY[^;]+article9_consent_events\s+FOR SELECT/i);
    expect(sql).toMatch(/CREATE POLICY[^;]+article9_consent_events\s+FOR INSERT/i);
    // The absence IS the enforcement — RLS denies whatever no policy permits.
    // A consent record that can be edited is not evidence.
    expect(sql).not.toMatch(/ON article9_consent_events\s+FOR UPDATE/i);
    expect(sql).not.toMatch(/ON article9_consent_events\s+FOR DELETE/i);
  });

  it("scopes both policies to the owner", () => {
    expect(sql).toMatch(/USING \(auth\.uid\(\) = user_id\)/);
    expect(sql).toMatch(/WITH CHECK \(auth\.uid\(\) = user_id\)/);
  });

  it("enables RLS on the consent log", () => {
    expect(sql).toMatch(/ALTER TABLE article9_consent_events ENABLE ROW LEVEL SECURITY/i);
  });

  it("clears every Article 9 column on withdrawal", () => {
    const fn = sql.split(/CREATE OR REPLACE FUNCTION withdraw_article9_health_data/i)[1] ?? "";
    for (const field of TIER2_INTAKE_FIELDS) {
      // injury_sites is an array column, reset to '{}' rather than NULL.
      const cleared =
        new RegExp(`${field}\\s*=\\s*NULL`).test(fn) ||
        new RegExp(`${field}\\s*=\\s*'\\{\\}'`).test(fn);
      expect(cleared, `withdrawal does not clear ${field}`).toBe(true);
    }
  });

  it("deletes the injury history and the findings derived from it", () => {
    const fn = sql.split(/CREATE OR REPLACE FUNCTION withdraw_article9_health_data/i)[1] ?? "";
    expect(fn).toMatch(/DELETE FROM hpe_injury_reports WHERE user_id = auth\.uid\(\)/i);
    expect(fn).toMatch(/DELETE FROM hpe_findings WHERE user_id = auth\.uid\(\)/i);
  });

  it("cannot be aimed at another athlete", () => {
    // Takes no argument and acts on auth.uid() only. A SECURITY DEFINER
    // function that accepts a user id is an oracle waiting to be called with
    // somebody else's — the same reasoning as activity_is_visible_to() in 049.
    expect(sql).toMatch(/FUNCTION withdraw_article9_health_data\(\)/);
    expect(sql).not.toMatch(/FUNCTION withdraw_article9_health_data\(\s*[a-z_]+\s+UUID/i);
  });

  it("does not delete the training plan as a side effect of a privacy choice", () => {
    const fn = sql.split(/CREATE OR REPLACE FUNCTION withdraw_article9_health_data/i)[1] ?? "";
    expect(fn).not.toMatch(/DELETE FROM hpe_plans/i);
    expect(fn).not.toMatch(/DELETE FROM hpe_sessions/i);
  });
});
