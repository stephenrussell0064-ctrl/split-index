import os from "node:os";
import { describe, expect, it } from "vitest";
import config from "../vitest.config";

/**
 * Guards the fix for the 9 Sep 2026 `tests-green` audit: an uncapped worker
 * pool gives Vitest one worker per core, which saturates every core on this
 * machine at once and leaves zero scheduling headroom for anything else
 * running alongside it (another Claude session, this one's own tooling, or —
 * on the shared box this was diagnosed on — other tenants entirely). That
 * turned the HPE scheduler's randomised safety-property test in
 * `src/lib/scoring/hpe/engine.test.ts` — identical input, 383ms run alone —
 * into an intermittent ~930s timeout under a fully saturated run.
 *
 * This does not re-test that scheduler property; it only pins the config
 * property whose absence caused the saturation, so a future edit to
 * `vitest.config.ts` cannot silently remove the headroom without this test
 * noticing. `resolve()` mirrors how Vitest itself reads a config that may be
 * a plain object or a `defineConfig`-wrapped function.
 *
 * Checks the top-level `maxWorkers`, not `poolOptions.forks.maxForks` —
 * Vitest 4 removed the nested `poolOptions` shape in favour of this single
 * option, silently, so a config still setting the old key caps nothing. The
 * first attempt at this fix made exactly that mistake, and this file exists
 * so the same mistake fails a test instead of quietly doing nothing.
 */
async function resolve<T>(value: T | ((...args: unknown[]) => T)): Promise<T> {
  return typeof value === "function" ? await (value as (...args: unknown[]) => T)() : value;
}

describe("vitest worker pool leaves headroom on the host", () => {
  it("caps maxWorkers below the machine's core count", async () => {
    const resolved = await resolve(config as unknown);
    const maxWorkers = (resolved as { test?: { maxWorkers?: number } }).test?.maxWorkers;
    expect(maxWorkers, "vitest.config.ts must set test.maxWorkers").toBeTypeOf("number");
    expect(maxWorkers!).toBeGreaterThan(0);
    expect(maxWorkers!).toBeLessThan(os.cpus().length);
  });

  it("does not use the Vitest-4-removed poolOptions.forks.maxForks shape", async () => {
    const resolved = await resolve(config as unknown);
    const poolOptions = (resolved as { test?: { poolOptions?: unknown } }).test?.poolOptions;
    expect(poolOptions, "poolOptions was removed in Vitest 4 and is silently ignored — use maxWorkers").toBeUndefined();
  });
});
