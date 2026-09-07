import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Helpers for tests that assert things about the source code itself.
 *
 * WHY THIS EXISTS — a mistake that recurred five times
 * ----------------------------------------------------
 * Several gates in this repository work by scanning source for a pattern: the
 * client-bundle secret scanner, the WP5 raw-error-message guard, the WP12
 * premium-blur guard, the elevated-credential inventory, and the JSON-LD
 * escaping guard.
 *
 * Every single one of them, on first write, flagged its own documentation. The
 * comment explaining the forbidden pattern contains the forbidden pattern —
 * necessarily, because that is what explaining it means. Each was fixed
 * separately by stripping comments, which is the correct fix and was rewritten
 * from scratch each time.
 *
 * So it lives here now. `stripComments` before matching, always. Prose
 * describing a pattern is not the pattern, and a detector that cannot tell the
 * difference gets weakened until it detects nothing.
 *
 * The tests that predate this file have their own local copies and pass; they
 * are not churned for the sake of it. New scanners should import from here.
 */

/**
 * Remove `//` line comments and block comments from TypeScript or JavaScript.
 *
 * Deliberately not a parser. A regex cannot tell a comment from the same
 * characters inside a string literal, so a line like
 * `const s = "http://example.com"` loses its tail. That is acceptable for these
 * scanners — they look for code shapes, and a truncated URL is not one — and a
 * real parser would be a dependency and a maintenance surface for a test
 * helper. Worth knowing before reaching for it in a context where string
 * contents matter.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Remove `--` line comments from SQL. Block comments are not used in this repo's migrations. */
export function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Every file under `dir` matching `pattern`, recursively. */
export function walkSource(
  dir: string,
  pattern = /\.tsx?$/,
  out: string[] = []
): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSource(full, pattern, out);
    else if (pattern.test(full)) out.push(full);
  }
  return out;
}

/** Source files under `dir`, excluding tests, with comments already stripped. */
export function readNonTestSources(dir: string): { file: string; code: string }[] {
  return walkSource(dir)
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((file) => ({ file, code: stripComments(readFileSync(file, "utf8")) }));
}
