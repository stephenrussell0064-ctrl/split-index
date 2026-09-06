import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /*
      The application's own code, and nothing else — the same scoping the test
      suite needed, for the same reason (see vitest.config.ts).

      Bare `eslint` walks the whole repo, and this project carries nineteen
      hidden directories of AI-assistant skills and prompts (.claude, .cursor,
      .windsurf, .github/prompts, and fifteen more), many shipping their own
      .mjs helpers. Linting those reported 285 errors in code this repo does
      not own and cannot fix, which made `npm run lint` useless as a gate:
      it always exited 1, so a real error in src/ was indistinguishable from
      the permanent noise.

      Ignoring hidden directories wholesale rather than listing them, because
      the list only ever grows — a new assistant drops in a new dot-directory
      and an enumerated ignore silently breaks the gate again.
    */
    ".*/**",
  ]),
]);

export default eslintConfig;
