import {
  AUDIT_LOG_RETENTION_DAYS,
  SECURITY_LOG_RETENTION_DAYS,
} from "@/lib/security/config";

/**
 * WP7 — structured security logging.
 *
 * WHAT WAS THERE BEFORE
 * ---------------------
 * `console.error` in a handful of route files, with no shape, no correlation
 * id, and no rule about what could go in it. None of WP7's event types was
 * recorded: auth outcomes, rate-limit trips, entitlement denials, elevated
 * queries, webhook events, 5xx. There was consequently no alert path for
 * repeated auth failure or repeated entitlement denial — the latter being the
 * signature of somebody probing the paywall.
 *
 * The audit noted one compensating fact, and it is the reason this file is
 * shaped the way it is: because there was no logger, there was no risk of
 * health values leaking into logs. That inverts the moment a logger exists. The
 * redaction rule has to be built in from the first line rather than retrofitted
 * onto a logger that already has call sites.
 *
 * SO REDACTION IS A TYPE AND A RUNTIME FILTER, NOT A CONVENTION
 * ------------------------------------------------------------
 * `LogValue` admits only primitives, so `log({ intake })` does not compile —
 * the easiest way to leak a health answer is to hand a logger an object and
 * let it serialise. On top of that, `redact()` drops any field whose NAME looks
 * like health data or a credential, because the second easiest way is to name
 * a field innocuously and put the wrong thing in it.
 *
 * The forbidden-name list is deliberately a superset of the Article 9 intake
 * fields. security-log.test.ts asserts that every field in TIER2_INTAKE_FIELDS
 * is covered, so a question added to the health screen becomes un-loggable the
 * same day rather than the day somebody notices. That check lives in the test
 * rather than here because importing the intake module would pull the whole
 * Hybrid Plan engine into the middleware bundle.
 */

/** Only primitives. An object would serialise whatever it happened to contain. */
export type LogValue = string | number | boolean | null | undefined;

export type SecurityEventType =
  | "auth.success"
  | "auth.failure"
  | "rate_limit.trip"
  | "entitlement.denied"
  | "admin.access"
  | "elevated_query"
  | "payment.webhook"
  | "server_error";

/**
 * How long an event is kept.
 *
 * Two classes, because the brief asks for health-adjacent entries to be kept
 * the longer period. An entitlement denial or an admin read touching the Hybrid
 * Plan is a record about somebody's health data even when it contains none of
 * it, and the question it answers later — "who could have seen this, and when"
 * — is asked on a longer horizon than "was there a brute-force attempt in
 * March".
 */
export type RetentionClass = "security" | "audit";

export const RETENTION_DAYS: Record<RetentionClass, number> = {
  security: SECURITY_LOG_RETENTION_DAYS,
  audit: AUDIT_LOG_RETENTION_DAYS,
};

export interface SecurityEvent {
  type: SecurityEventType;
  /** Ties the log line to the response the caller was given. */
  correlationId: string;
  /** Who, where known. An id — never an email. */
  userId?: string | null;
  /** Route or subsystem the event came from. */
  source: string;
  /** Whether the thing being attempted was allowed. */
  outcome: "allowed" | "denied" | "error";
  retention?: RetentionClass;
  /** Extra context. Primitives only, and filtered again at runtime. */
  detail?: Record<string, LogValue>;
}

/**
 * Field names that must never reach a log.
 *
 * Substring matched, lowercased. Broad on purpose: a false positive drops one
 * field from one log line, and a false negative writes a PAR-Q answer into a
 * log aggregator that may retain it beyond our control and outside the
 * athlete's consent.
 */
export const FORBIDDEN_LOG_KEYS = [
  // ── Article 9 intake. Covered as a superset; see the test. ──
  "parq",
  "chest_pain",
  "injury",
  "surgery",
  "pregnan",
  "postpartum",
  "medication",
  "lea_",
  "amenorrhoea",
  "bone_stress",
  "restricted_food",
  "trains_fasted",
  "weight_loss",
  // ── Body and physiology ──
  "bodyweight",
  "weight",
  "height",
  "heart_rate",
  "heartrate",
  "max_hr",
  "resting_hr",
  "hrv",
  "vo2",
  "sleep",
  "fatigue",
  "recovery_score",
  "readiness",
  // ── Identity and credentials ──
  "email",
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
];

/**
 * Values that are credentials whatever they are called.
 *
 * The key filter catches `{ token: "..." }`. This catches
 * `{ note: "here is my key eyJhbGciOi..." }`, which is the shape a developer
 * produces while debugging and then forgets to remove.
 */
const CREDENTIAL_VALUE = /\b(eyJ[A-Za-z0-9_-]{8,}\.|sk_(live|test)_|whsec_|Bearer\s+\S)/;

const REDACTED = "[redacted]";

/** Drop forbidden fields and mask credential-shaped values. */
export function redact(
  detail: Record<string, LogValue> | undefined
): Record<string, LogValue> {
  if (!detail) return {};
  const safe: Record<string, LogValue> = {};

  for (const [key, value] of Object.entries(detail)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_LOG_KEYS.some((forbidden) => lower.includes(forbidden))) continue;
    if (typeof value === "string" && CREDENTIAL_VALUE.test(value)) {
      safe[key] = REDACTED;
      continue;
    }
    safe[key] = value;
  }

  return safe;
}

/** The record as it is written. Exported so tests assert the real shape. */
export interface SecurityLogRecord {
  ts: string;
  event: SecurityEventType;
  correlationId: string;
  userId: string | null;
  source: string;
  outcome: "allowed" | "denied" | "error";
  retention: RetentionClass;
  detail: Record<string, LogValue>;
}

export function buildRecord(event: SecurityEvent): SecurityLogRecord {
  return {
    ts: new Date().toISOString(),
    event: event.type,
    correlationId: event.correlationId,
    userId: event.userId ?? null,
    source: event.source,
    outcome: event.outcome,
    // Anything touching the Hybrid Plan or an admin surface is a record ABOUT
    // health data even when it contains none, so it defaults to the longer
    // period rather than the shorter one.
    retention:
      event.retention ??
      (event.type === "admin.access" || event.type === "elevated_query" ? "audit" : "security"),
    detail: redact(event.detail),
  };
}

/**
 * Emit one structured line.
 *
 * A single JSON object per line, to stdout or stderr, because that is what
 * Vercel captures and what a log drain can parse without a custom format. No
 * transport, no buffering, no dependency: a logger that can fail is a logger
 * that takes the request down with it, and the events here are exactly the ones
 * that matter most when something is already going wrong.
 */
export function logSecurityEvent(event: SecurityEvent): SecurityLogRecord {
  const record = buildRecord(event);
  const line = JSON.stringify(record);

  // Denials and errors go to stderr so they surface in an error-only view;
  // allowed events are informational.
  if (record.outcome === "allowed") console.log(line);
  else console.error(line);

  return record;
}
