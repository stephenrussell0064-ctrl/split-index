import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      /*
        `server-only` is a marker package whose main entry is a bare `throw`.
        That is exactly what makes it useful — importing a server module from a
        client bundle fails the build — and it is also why the tests could not
        import `lib/supabase/admin.ts` or `lib/auth/admin-role.ts` once the
        marker was added: vitest resolves the default condition, gets the
        throwing file, and the suite dies at import time.

        The package ships an empty file behind the `react-server` export
        condition for precisely this. Aliasing to it here is narrower than
        setting `resolve.conditions: ["react-server"]` globally, which would
        change how React itself resolves.

        This does NOT weaken the guard. The guard's job is done by Next's
        bundler at build time; vitest never builds a client bundle, so there is
        nothing here for it to protect.
      */
      "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
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
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      /*
        `scripts/` holds the build-time gates — the client-bundle secret
        scanner most importantly — and those need covering by the same suite
        that CI runs. Still narrow enough to keep the problem above out: the
        skill tests that caused it are `.mjs` under `.claude/skills/`, and
        neither the extension nor the path matches.
      */
      "scripts/**/*.{test,spec}.{ts,tsx}",
    ],
  },
});
