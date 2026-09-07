import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  BLOCKED_TERMS,
  RESERVED_NAMES,
  containsReservedName,
  isReservedName,
  validateDisplayText,
  validateUsernameFormat,
} from "./username";

/**
 * M14 / WP3.3 — reserved words and lookalikes.
 *
 * One list used to hold profanity and impersonation terms together, substring
 * matched. That is right for profanity and wrong for impersonation, and the
 * wrongness was live rather than theoretical.
 *
 * Control characters and homoglyphs are built from char codes rather than
 * written literally: a literal control character in a source file is invisible
 * in every diff and review tool it passes through, which is the same property
 * that makes it worth rejecting in a display name.
 */

const ok = (n: string) => validateUsernameFormat(n).valid;
const okDisplay = (n: string) => validateDisplayText(n).valid;

const CYRILLIC_A = String.fromCharCode(0x0410); // reads as Latin "A"
const CYRILLIC_DZE = String.fromCharCode(0x0405); // reads as Latin "S"
/** A PostgrestError, minus the parts nothing under test reads. */
function pgError(fields: {
  code: string;
  message: string;
  details?: string;
}): PostgrestError {
  return {
    name: "PostgrestError",
    hint: "",
    details: "",
    ...fields,
    toJSON() {
      return { ...this };
    },
  } as PostgrestError;
}

const NUL = String.fromCharCode(0x00);
const BELL = String.fromCharCode(0x07);

describe("names that were refused and should not have been", () => {
  /**
   * THE FAILING-BEFORE TEST. Every one of these was rejected by the old
   * substring rule: `badminton` and `Rapetti` contain "admin" and "rape",
   * `scunthorpe` contains "cunt", `grapes` contains "rape".
   */
  it.each([
    "badminton",
    "Badminton_Ben",
    "grapes",
    "scunthorpe",
    "shitake",
    "Rapetti",
    "therapist",
  ])("accepts %s", (name) => {
    expect(ok(name), `${name} was refused`).toBe(true);
  });

  /**
   * And these would have been refused the moment WP3.3's additions went into a
   * substring test, which is why the matching had to change before the list grew.
   */
  it.each(["rapid", "capital", "Rooney", "Systema", "staffs"])(
    "accepts %s, which naming the new reserved words would have broken",
    (name) => {
      expect(ok(name), `${name} was refused`).toBe(true);
    }
  );
});

describe("names nobody may take", () => {
  it.each(RESERVED_NAMES.filter((n) => n.length >= 3))("refuses %s", (name) => {
    expect(ok(name), `${name} was allowed`).toBe(false);
  });

  it("refuses the obvious variations", () => {
    for (const name of ["admin7", "ad_min", "adm1n", "4dm1n", "Admin", "ADMIN", "r00t"]) {
      expect(ok(name), `${name} was allowed`).toBe(false);
    }
  });

  /**
   * The interaction that broke the first version of this, and the reason the
   * implementation generates candidate spellings instead of one canonical form.
   *
   * `admin1` is a reserved word plus a digit and needs the digit REMOVED.
   * `adm1n` is a reserved word with a digit standing in for a letter and needs
   * it TRANSLATED. Applying one rule and then the other produces neither
   * answer: folding 7 to t first turned `admin7` into `admint`, which matches
   * nothing, so every case the trailing-digit strip existed to catch started
   * slipping through instead.
   */
  it("handles a trailing digit and a substituted digit, which need opposite rules", () => {
    expect(isReservedName("admin1"), "admin1").toBe(true);
    expect(isReservedName("adm1n"), "adm1n").toBe(true);
    expect(isReservedName("admin7"), "admin7").toBe(true);
  });

  it("does not refuse a word that merely contains one", () => {
    for (const name of ["badminton", "therapist", "rooted", "staffordshire"]) {
      expect(isReservedName(name), name).toBe(false);
    }
  });
});

describe("display names are the impersonation surface", () => {
  /**
   * Usernames are ASCII-only by pattern, so a homoglyph cannot reach one.
   * Display names permit unicode and are what appears beside a score on a
   * leaderboard — and before this, a Cyrillic spelling matched nothing at all.
   */
  it("refuses a lookalike spelled in Cyrillic", () => {
    expect(okDisplay(`${CYRILLIC_A}dmin`), "Cyrillic Admin was allowed").toBe(false);
    expect(okDisplay(`${CYRILLIC_DZE}upport`), "Cyrillic Support was allowed").toBe(false);
  });

  it("refuses a reserved word used as one word of a phrase", () => {
    for (const name of ["Split Index Support", "Official Team", "The Admin"]) {
      expect(okDisplay(name), `${name} was allowed`).toBe(false);
    }
  });

  /**
   * The other half, and the reason display names match by WORD rather than by
   * substring: a phrase containing a reserved word inside a longer word is an
   * ordinary name.
   */
  it("allows ordinary names", () => {
    for (const name of ["Badminton Ben", "Rachel Runs", "Kate O'Neill", "Grapes"]) {
      expect(okDisplay(name), `${name} was refused`).toBe(true);
    }
  });

  it("still refuses control characters", () => {
    expect(okDisplay(`Rachel${NUL}Runs`), "NUL was allowed").toBe(false);
    expect(okDisplay(`Rachel${BELL}Runs`), "BELL was allowed").toBe(false);
  });

  it("still refuses profanity, separators and all", () => {
    expect(okDisplay("f-u-c-k")).toBe(false);
    expect(okDisplay("f u c k")).toBe(false);
  });
});

describe("the two lists stay separate", () => {
  /**
   * The regression that would undo this: folding the reserved words back into
   * the substring-matched list. It would look like consolidation and would
   * reinstate every false positive above.
   */
  it("keeps impersonation terms out of the substring-matched list", () => {
    const leaked = RESERVED_NAMES.filter((r) => BLOCKED_TERMS.includes(r));
    expect(
      leaked,
      "these are substring-matched again, so any word containing them is " +
        "refused — 'badminton' for 'admin', 'therapist' for 'api':\n  " +
        leaked.join("\n  ")
    ).toEqual([]);
  });

  it("covers what WP3.3 asked for", () => {
    for (const term of [
      "root",
      "system",
      "official",
      "staff",
      "help",
      "billing",
      "security",
      "api",
      "null",
    ]) {
      expect(RESERVED_NAMES, `${term} is not reserved`).toContain(term);
    }
  });

  it("finds a reserved word in a phrase but not inside a longer word", () => {
    expect(containsReservedName("contact support please")).toBe(true);
    expect(containsReservedName("badminton and therapy")).toBe(false);
  });
});

describe("the uniqueness race tells the athlete something useful", () => {
  /**
   * M14's third part. `username-check` reads, the athlete submits, the write
   * happens later — so two people can pass the check and one loses at the
   * unique constraint. The race cannot be closed by checking harder; it closes
   * AT the constraint, and the only question is what the loser is told.
   *
   * Onboarding writes with the browser client, so this never reached the
   * server's mapping and surfaced as the caller's fallback.
   */
  it("names the username as the problem, on the browser path", async () => {
    const { supabaseErrorMessage } = await import("@/lib/supabase/errors");
    const message = supabaseErrorMessage("Could not save your profile. Please try again.", pgError({ code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_key"', details: "Key (username)=(rachel) already exists." }));
    expect(message).toBe("That username is taken.");
  });

  it("never repeats the conflicting value, which may be another person's", async () => {
    const { supabaseErrorMessage } = await import("@/lib/supabase/errors");
    const message = supabaseErrorMessage("fallback", pgError({ code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_key"', details: "Key (username)=(rachel) already exists." }));
    expect(message).not.toContain("rachel");
    expect(message).not.toContain("constraint");
  });

  it("still falls back for anything an athlete cannot act on", async () => {
    const { supabaseErrorMessage } = await import("@/lib/supabase/errors");
    const message = supabaseErrorMessage("Could not save your profile.", pgError({ code: "42P01", message: 'relation "profiles" does not exist', details: "" }));
    expect(message).toBe("Could not save your profile.");
    expect(message).not.toContain("profiles");
  });

  it("uses one map for both paths, so they cannot drift", async () => {
    const shared = await import("@/lib/api/unique-violations");
    expect(shared.UNIQUE_VIOLATION_MESSAGES.profiles_username_key).toBe(
      "That username is taken."
    );
    // The server's safeDatabaseMessage reads the same module rather than a copy.
    const server = readFileSync(
      fileURLToPath(new URL("../api/errors.ts", import.meta.url)),
      "utf8"
    );
    expect(server).toContain("uniqueViolationMessage");
    expect(server).not.toContain("const UNIQUE_VIOLATION_MESSAGES");
  });
});
