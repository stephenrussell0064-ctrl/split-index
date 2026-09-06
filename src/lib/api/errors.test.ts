import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_ERROR_MESSAGE,
  correlationId,
  databaseError,
  safeDatabaseMessage,
  serverError,
} from "./errors";
import { AUTH_ERROR_MESSAGES_FOR_TEST } from "@/lib/supabase/auth-errors";

/**
 * WP5 — error handling and information disclosure.
 *
 * The brief's acceptance criterion: "a test asserting no production response
 * body contains `at `, `node_modules`, `pg`, `supabase`, or a filesystem
 * path."
 *
 * Taken literally that list has a trap in it, and the trap is worth naming
 * because it bit the WP2 scanner in the same way. A bare `at ` matches "must
 * be at least 25" — a perfectly good field message — and `pg` matches
 * "upgrade". A test that fires on those gets weakened until it fires on
 * nothing. So the assertions below look for the SHAPES that leak: a stack
 * frame, a filesystem path, a driver name as a word, a Postgres SQLSTATE, a
 * constraint or column name.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const API_DIR = join(ROOT, "src/app/api");

/**
 * Error types this repository defines, whose `.message` is a sentence we wrote
 * and is safe to return.
 *
 * Named explicitly rather than pattern-matched on "*Error", so adding one is a
 * deliberate act. That mattered: RecomputeError looked app-authored and had a
 * second construction site wrapping a raw Postgres message, which travelled
 * out through the recompute route. Fixed at the source before adding it here.
 */
const APP_ERROR_TYPES = ["ScoringInputError", "RecomputeError"];

/** Things that must never appear in a response body. */
function disclosures(text: string): string[] {
  const hits: string[] = [];
  // A stack frame, not the English word "at".
  if (/\n\s+at\s+\S/.test(text)) hits.push("stack frame");
  if (/node_modules/.test(text)) hits.push("node_modules path");
  if (/(?:\/[\w.-]+){2,}\.(?:ts|tsx|js|mjs)/.test(text)) hits.push("source file path");
  if (/\b(?:postgres|postgrest|PostgrestError|supabase)\b/i.test(text)) hits.push("driver or platform name");
  // SQLSTATE, e.g. 23505 / 42P01.
  if (/\b\d{2}[A-Z0-9]{3}\b/.test(text)) hits.push("SQLSTATE code");
  if (/_(?:key|pkey|fkey|check)\b/.test(text)) hits.push("constraint name");
  if (/relation "|column "|violates .* constraint/i.test(text)) hits.push("Postgres error text");
  return hits;
}

describe("the disclosure detector itself", () => {
  // If this is wrong, everything below it is decoration.
  it("catches the shapes that actually leak", () => {
    expect(disclosures('Error\n    at Object.foo (/src/x.ts:1:1)')).toContain("stack frame");
    expect(disclosures("/Users/x/app/node_modules/pg/index.js")).toContain("node_modules path");
    expect(disclosures('duplicate key value violates unique constraint "profiles_username_key"')).toContain(
      "constraint name"
    );
    expect(disclosures('relation "activities" does not exist')).toContain("Postgres error text");
    expect(disclosures("code 23505")).toContain("SQLSTATE code");
    expect(disclosures("PostgrestError: nope")).toContain("driver or platform name");
  });

  it("does not fire on ordinary user-facing copy", () => {
    // The false positives that would get this test deleted.
    for (const safe of [
      "bodyweight must be at least 25.",
      "Please upgrade to Premium to see this.",
      "That username is taken.",
      "Something went wrong on our side. Please try again in a moment. (ref a3f9c2e1)",
      "You can't comment on that activity.",
    ]) {
      expect(disclosures(safe), safe).toEqual([]);
    }
  });
});

describe("serverError", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("returns a generic message and a correlation id, and nothing else", async () => {
    const res = serverError({
      operation: "POST /api/activities",
      cause: new Error("duplicate key value violates unique constraint \"activities_pkey\""),
      context: { table: "activities" },
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; ref: string };
    expect(body.error).toContain(GENERIC_ERROR_MESSAGE);
    expect(body.ref).toMatch(/^[0-9a-f]{8}$/);
    expect(disclosures(JSON.stringify(body))).toEqual([]);
  });

  it("puts the detail in the log, against the same id", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = serverError({ operation: "x", cause: new Error("boom") });
    const logged = JSON.stringify(spy.mock.calls);
    // The whole trade: detail kept, just moved.
    expect(logged).toContain("boom");
    expect(res).toBeDefined();
  });

  it("gives a different id per failure, so two reports are distinguishable", () => {
    const ids = new Set(Array.from({ length: 200 }, () => correlationId()));
    expect(ids.size).toBeGreaterThan(190);
  });
});

describe("databaseError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("turns a known unique violation into a sentence, not a constraint name", async () => {
    const res = databaseError(
      {
        code: "23505",
        message: 'duplicate key value violates unique constraint "profiles_username_key"',
      },
      { operation: "PATCH /api/profile" }
    );

    // A conflict the caller can fix is a 409, not a 500. Reporting it as 5xx
    // makes every error dashboard lie about the health of the service.
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("That username is taken.");
    expect(disclosures(JSON.stringify(body))).toEqual([]);
  });

  it("falls back to generic for an unrecognised failure", async () => {
    const res = databaseError(
      { code: "XX000", message: "internal error: something about /var/lib/postgresql" },
      { operation: "POST /api/goals" }
    );
    expect(res.status).toBe(500);
    expect(disclosures(JSON.stringify(await res.json()))).toEqual([]);
  });

  it("never returns any part of the database message", async () => {
    const nasty =
      'relation "hpe_intake" does not exist at character 15\n    at Parser.parseErrorMessage (/app/node_modules/pg-protocol/dist/parser.js:369:69)';
    for (const code of ["23505", "23503", "42P01", "XX000", undefined]) {
      const res = databaseError({ code, message: nasty }, { operation: "op" });
      const text = JSON.stringify(await res.json());
      expect(text, `code=${code}`).not.toContain("hpe_intake");
      expect(disclosures(text), `code=${code}`).toEqual([]);
    }
  });

  it("maps the SQLSTATEs worth distinguishing", () => {
    expect(safeDatabaseMessage({ code: "23503" })).toMatch(/no longer exists/i);
    expect(safeDatabaseMessage({ code: "42501" })).toMatch(/do not have access/i);
    expect(safeDatabaseMessage({ code: "XX000" })).toBeNull();
  });
});

describe("no route hands a database message to a client", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/route\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  /**
   * The regression guard. Twenty-eight sites across 26 route files used to
   * return a raw `.message` to the caller; this fails the build if one comes
   * back.
   *
   * Scanned line by line rather than across the whole file. The first version
   * used a dot-matches-newline regex over the file and matched across
   * unrelated regions, flagging routes that were already fine — a detector
   * with false positives gets deleted, which is the same lesson the WP2
   * scanner taught.
   *
   * TWO DELIBERATE EXCEPTIONS, both narrow:
   *
   *   * `err.message` inside an `instanceof ScoringInputError` branch. That is
   *     OUR error type carrying OUR sentence — "bodyweight is implausible" —
   *     which is exactly the field-level message WP5 asks for. Returning it is
   *     the right behaviour, not a leak.
   *   * Reading `.message` to CLASSIFY a failure without returning it.
   *     `src/app/api/races/route.ts` does this to spot a check-constraint
   *     violation on a column it knows the name of.
   */
  it("never puts a raw error message in a NextResponse body", () => {
    const offenders: string[] = [];

    for (const file of walk(API_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const returnsMessage =
          /\berror:\s*[A-Za-z_$][\w$]*\??\.message\b/.test(line) ||
          /\berror:\s*`[^`]*\$\{[^}]*\.message[^}]*\}/.test(line);
        if (!returnsMessage) return;

        // Look back a few lines for the app-error narrowing.
        const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
        if (APP_ERROR_TYPES.some((t) => context.includes(`instanceof ${t}`))) return;

        offenders.push(`${relative(ROOT, file)}:${i + 1}`);
      });
    }

    expect(
      offenders,
      `these return a raw error message to the client — use databaseError() or ` +
        `serverError() from @/lib/api/errors instead:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });
});

describe("auth failures do not enumerate accounts", () => {
  it("says the same thing for a wrong password and a missing account", () => {
    // Two different sentences here is an oracle: submit an address, read which
    // one comes back, learn whether that person has an account on a health app.
    expect(AUTH_ERROR_MESSAGES_FOR_TEST.invalid_credentials).toBe(
      AUTH_ERROR_MESSAGES_FOR_TEST.user_not_found
    );
  });

  it("keeps that message free of anything about which half was wrong", () => {
    const message = AUTH_ERROR_MESSAGES_FOR_TEST.invalid_credentials.toLowerCase();
    expect(message).not.toMatch(/no account|not found|does not exist|unknown email/);
  });
});

describe("the auth callback does not put provider error text in a URL", () => {
  const CALLBACK = join(ROOT, "src/app/auth/callback/route.ts");

  it("gates the detail parameter on development", () => {
    const src = readFileSync(CALLBACK, "utf8");
    /*
     * The rendered message was already safe — resolveAuthPageError only shows
     * `detail` in development. The value was in the URL regardless, which means
     * browser history, the Referer header on the next outbound request, and any
     * proxy or analytics log in between. A safe render over an unsafe URL is
     * half a fix.
     */
    expect(src).toMatch(
      /if \(detail && process\.env\.NODE_ENV === "development"\) \{\s*params\.set\("detail"/
    );
  });

  it("never sets it unconditionally", () => {
    const src = readFileSync(CALLBACK, "utf8");
    const unconditional = /^\s*if \(detail\) params\.set\("detail"/m.test(src);
    expect(unconditional, "detail is set without an environment guard").toBe(false);
  });
});
