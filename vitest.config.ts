import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";

/**
 * Cores left free for everything that is not this test run.
 *
 * Two, because that is what the 9 Sep 2026 audit found was needed: see the
 * note on `maxWorkers` below for the mechanism.
 */
const RESERVED_CORES = 2;

/**
 * `os.cpus()` returns an empty array on some container runtimes rather than
 * throwing, which would otherwise compute a worker count of 1 by accident
 * rather than on purpose. One is the right answer there either way.
 */
const AVAILABLE_CORES = os.cpus().length || 1;

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
      DERIVED from the core count, not hardcoded to one machine's.

      This was `maxWorkers: 8` — two below the 10 cores of the box the fix was
      written on, which is the right *rule* expressed as the wrong *number*.
      CI runners have 4 cores, so 8 asked for two workers per core: the exact
      oversubscription this setting exists to prevent, on the one host where
      nobody is watching the run. `scripts/check-test-pool-headroom.test.ts`
      caught it and had been failing every CI run since — which is worse than
      the saturation itself, because a suite that is always red stops being
      read at all.

      Capped below the machine's core count rather than left at
      Vitest's default of "one worker per core". Uncapped, the full suite
      saturates every core at once, and leaves zero scheduling headroom for
      anything else running on the same box — including another Claude
      session working in a sibling repo, or this one's own tooling. That is
      what turned the single heaviest test in the suite — the HPE scheduler's
      randomised safety-property check, engine.test.ts, ~1.3M penalty
      evaluations per seed across up to 47 weeks — into an intermittent
      timeout: identical input took 383ms run alone, but ~930s inside a fully
      saturated 10/10-core run (audited 9 Sep 2026, reproduced twice). The
      computation itself is not the defect — confirmed by running the exact
      failing seed standalone, and by running its whole file (all 88 tests)
      alone, both well under a second either way. Leaving two cores free is
      the fix that matches the actual mechanism, rather than papering over it
      with a timeout large enough to hide a real future hang.

      `maxWorkers` is the Vitest 4 option. An earlier version of this fix set
      `poolOptions.forks.maxForks`, which Vitest 4 removed in favour of this
      top-level setting — the old key is silently ignored rather than
      rejected, so that first attempt capped nothing and the timeout kept
      reproducing. `scripts/check-test-pool-headroom.test.ts` pins the
      resolved value so a future edit can't reintroduce either mistake
      unnoticed.
    */
    maxWorkers: Math.max(1, AVAILABLE_CORES - RESERVED_CORES),
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
      /*
        `tests/uat/` holds the user-acceptance personas — simulated athletes
        driven through the real scoring engines. They belong in the same gate as
        everything else: their whole purpose is to fail when a change makes the
        app worse for a kind of athlete nobody happened to think about, and a
        suite CI does not run cannot do that.

        Safe against the problem above for the same two reasons the scripts
        entry is: the skill tests that caused it are `.mjs`, and they live under
        `.claude/`. Neither matches.
      */
      "tests/**/*.{test,spec}.{ts,tsx}",
    ],
  },
});
