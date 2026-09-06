import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FORBIDDEN_LOG_KEYS,
  RETENTION_DAYS,
  buildRecord,
  logSecurityEvent,
  redact,
  type SecurityEventType,
} from "./security-log";
import { TIER2_INTAKE_FIELDS } from "@/lib/consent/article9";
import {
  AUDIT_LOG_RETENTION_DAYS,
  SECURITY_LOG_RETENTION_DAYS,
} from "@/lib/security/config";

/**
 * WP7 — structured security logging.
 *
 * Two acceptance criteria: "each event type produces exactly one structured
 * record with the expected fields", and "a test asserting no log line contains
 * a value drawn from a health table".
 *
 * The second is the one that matters, and it is why this file couples the
 * redaction list to the Article 9 field list. The audit's own note on H6 was
 * that the absence of a logger was the only thing keeping health values out of
 * logs — so the moment a logger exists, the rule has to be enforced rather than
 * remembered.
 */

const MIGRATION = fileURLToPath(
  new URL("../../../supabase/migrations/060_security_events.sql", import.meta.url)
);

const ALL_EVENT_TYPES: SecurityEventType[] = [
  "auth.success",
  "auth.failure",
  "rate_limit.trip",
  "entitlement.denied",
  "admin.access",
  "elevated_query",
  "payment.webhook",
  "server_error",
];

describe("no log line can carry a value from a health table", () => {
  /**
   * The coupling that makes this survive.
   *
   * TIER2_INTAKE_FIELDS is the Article 9 definition from WP11 — the literal
   * column list of the health and fuelling screens. Every one of them must be
   * caught by the redaction filter, so a question added to that screen becomes
   * un-loggable on the day it is added rather than the day somebody notices.
   *
   * The list is not imported into the logger itself: that would pull the whole
   * Hybrid Plan engine into the middleware bundle. Coupling it here means the
   * build fails instead.
   */
  it.each([...TIER2_INTAKE_FIELDS])("redacts %s", (field) => {
    const result = redact({ [field]: "yes", requestId: "abc" });
    expect(result).not.toHaveProperty(field);
    expect(result).toHaveProperty("requestId");
  });

  it.each([
    "bodyweight_kg",
    "avg_heart_rate",
    "max_heart_rate",
    "resting_hr",
    "hrv_ms",
    "sleep_hours",
    "fatigue_score",
    "recovery_score",
    "vo2max",
    "readiness",
    "weight_kg",
    "height_cm",
  ])("redacts the derived physiological field %s", (field) => {
    expect(redact({ [field]: 82.5 })).toEqual({});
  });

  it.each(["email", "password", "access_token", "refresh_token", "api_key", "cookie", "authorization"])(
    "redacts the credential field %s",
    (field) => {
      expect(redact({ [field]: "value" })).toEqual({});
    }
  );

  /**
   * The key filter catches `{ token: "..." }`. This catches
   * `{ note: "debugging with eyJhbGciOi..." }` — the shape a developer produces
   * while debugging and forgets to remove.
   */
  it.each([
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.payloadpayload.sig"],
    ["a Stripe secret", "sk_live_" + "0".repeat(24)],
    ["a webhook secret", "whsec_" + "a".repeat(30)],
    ["a bearer header", "Bearer abc123def456"],
  ])("masks %s hiding in an innocently named field", (_label, value) => {
    expect(redact({ note: value })).toEqual({ note: "[redacted]" });
  });

  it("keeps the fields an alert actually needs", () => {
    // Over-redaction would make the log useless, which is its own failure.
    expect(
      redact({ route: "/api/export", status: 403, plan: "free", attempt: 4, degraded: false })
    ).toEqual({ route: "/api/export", status: 403, plan: "free", attempt: 4, degraded: false });
  });

  it("survives an empty or missing detail", () => {
    expect(redact(undefined)).toEqual({});
    expect(redact({})).toEqual({});
  });
});

describe("each event type produces one structured record", () => {
  const logSpy = vi.fn();
  const errSpy = vi.fn();

  beforeEach(() => {
    logSpy.mockReset();
    errSpy.mockReset();
    vi.spyOn(console, "log").mockImplementation(logSpy);
    vi.spyOn(console, "error").mockImplementation(errSpy);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(ALL_EVENT_TYPES)("%s emits exactly one line with the expected fields", (type) => {
    logSecurityEvent({
      type,
      correlationId: "abc12345",
      userId: "user-1",
      source: "/api/example",
      outcome: "denied",
      detail: { note: "context" },
    });

    // Exactly one. Not zero, and not one per sink.
    expect(logSpy.mock.calls.length + errSpy.mock.calls.length).toBe(1);

    const line = (errSpy.mock.calls[0] ?? logSpy.mock.calls[0])[0] as string;
    const record = JSON.parse(line);

    expect(record).toMatchObject({
      event: type,
      correlationId: "abc12345",
      userId: "user-1",
      source: "/api/example",
      outcome: "denied",
    });
    expect(typeof record.ts).toBe("string");
    expect(record.retention).toMatch(/^(security|audit)$/);
  });

  it("writes one parseable JSON object per line", () => {
    // A log drain parses lines. An unparseable one is a dropped event.
    logSecurityEvent({
      type: "server_error",
      correlationId: "x",
      source: "s",
      outcome: "error",
    });
    const line = errSpy.mock.calls[0][0] as string;
    expect(line).not.toContain("\n");
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it("sends allowed events to stdout and denials to stderr", () => {
    // So an error-only view shows the events worth looking at, and an
    // "allowed" audit trail does not drown it.
    logSecurityEvent({ type: "auth.success", correlationId: "a", source: "s", outcome: "allowed" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();

    logSecurityEvent({ type: "auth.failure", correlationId: "b", source: "s", outcome: "denied" });
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("never logs an email even when one is handed to it", () => {
    logSecurityEvent({
      type: "auth.failure",
      correlationId: "c",
      source: "/auth/callback",
      outcome: "denied",
      detail: { email: "athlete@example.com", reason: "invalid_credentials" },
    });
    const line = errSpy.mock.calls[0][0] as string;
    expect(line).not.toContain("athlete@example.com");
    expect(line).toContain("invalid_credentials");
  });
});

describe("retention", () => {
  it("keeps health-adjacent events for the longer period by default", () => {
    // "Who could have seen this, and when" is asked on a longer horizon than
    // "was there a brute-force attempt in March".
    expect(buildRecord({ type: "admin.access", correlationId: "a", source: "s", outcome: "allowed" }).retention).toBe("audit");
    expect(buildRecord({ type: "elevated_query", correlationId: "a", source: "s", outcome: "allowed" }).retention).toBe("audit");
    expect(buildRecord({ type: "auth.failure", correlationId: "a", source: "s", outcome: "denied" }).retention).toBe("security");
  });

  it("uses the periods from the config module", () => {
    expect(RETENTION_DAYS.security).toBe(SECURITY_LOG_RETENTION_DAYS);
    expect(RETENTION_DAYS.audit).toBe(AUDIT_LOG_RETENTION_DAYS);
  });

  /**
   * SQL cannot import a TypeScript constant, so the intervals in migration 060
   * are duplicated by necessity. This is the thing that stops them drifting.
   */
  it("keeps the SQL intervals in step with the config", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain(`INTERVAL '${SECURITY_LOG_RETENTION_DAYS} days'`);
    expect(sql).toContain(`INTERVAL '${AUDIT_LOG_RETENTION_DAYS} days'`);
  });

  it("does not let any signed-in user run the prune", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION prune_security_events\(\) FROM PUBLIC/i);
    // A function any authenticated user can call to delete audit rows is not a
    // retention policy.
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION prune_security_events\(\) TO authenticated/i);
  });

  it("keeps the events table unreadable by the people it records", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/ALTER TABLE security_events ENABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]+ON security_events/i);
  });

  it("indexes the denial query the alert path depends on", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/WHERE outcome = 'denied'/);
  });
});

describe("the forbidden-key list", () => {
  it("is lowercase, so the substring match cannot miss on case", () => {
    for (const key of FORBIDDEN_LOG_KEYS) {
      expect(key, `${key} is not lowercase`).toBe(key.toLowerCase());
    }
  });

  it("matches case-insensitively at the call site", () => {
    expect(redact({ BodyWeight: 82, PARQ_positive: true })).toEqual({});
  });
});
