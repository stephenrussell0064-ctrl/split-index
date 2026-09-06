import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    /*
      The application's own tests, and nothing else.

      Vitest's default glob is unscoped, so it walked into `.claude/skills/`
      and picked up a marketing skill's `match.test.mjs` — a file with its own
      unrelated harness that fails here and red-lined `npm test`, and with it
      the CI gate. Tests that ship alongside a Claude skill are that skill's
      business; this suite is the app's.
    */
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
