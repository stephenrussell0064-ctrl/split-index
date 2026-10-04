import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_NAV,
  APP_NAV,
  COMMUNITY_NAV,
  LOG_WORKOUT,
  PROGRESS_NAV,
  TRAIN_ZONES,
} from "@/lib/navigation/app-nav";

/**
 * The Progress hub replaced the "More" sheet, and it is the page a new athlete
 * is told to go to in order to find anything. Two things would quietly ruin
 * that, and neither shows up as a failing render:
 *
 *   1. The hub growing its own copy of the destination list. The old More
 *      sheet's whole problem was that the app described itself in several
 *      places at once; a hub with a hardcoded list would put the labels and
 *      descriptions back out of step with the tab bar and the guide.
 *
 *   2. The page losing its onboarding redirect. Every page under (app) sends a
 *      half-onboarded athlete to /onboarding, because the scores this page is
 *      built around cannot be computed without the profile that flow collects.
 *
 * Source assertions, in the style of app-nav.test.ts and for the same reason:
 * this suite has no DOM, and what matters is not what the markup looks like
 * but where its content comes from.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const HUB = "src/components/progress/progress-hub.tsx";
const PAGE = "src/app/(app)/progress/page.tsx";

const hub = read(HUB);
const page = read(PAGE);

/** Source with comments removed, so prose in a comment cannot satisfy an assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const hubCode = stripComments(hub);

describe("the hub renders from the shared navigation list", () => {
  for (const name of ["PROGRESS_NAV", "COMMUNITY_NAV", "ACCOUNT_NAV"] as const) {
    it(`imports ${name} and maps over it rather than listing destinations itself`, () => {
      expect(hubCode).toMatch(new RegExp(`\\b${name}\\b`));
      // Handed to the section renderer, which is what turns it into rows.
      expect(hubCode).toMatch(new RegExp(`items=\\{${name}\\}`));
    });
  }

  it("imports them from app-nav, not from a local copy", () => {
    expect(hubCode).toMatch(/from "@\/lib\/navigation\/app-nav"/);
  });

  it("holds none of the labels or descriptions as literals of its own", () => {
    /*
     * The drift this prevents: a row whose wording was tidied up here while
     * the tab bar and /help kept saying something else. A destination's words
     * live in app-nav.ts and nowhere else.
     */
    const offenders: string[] = [];
    for (const item of [...PROGRESS_NAV, ...COMMUNITY_NAV, ...ACCOUNT_NAV]) {
      if (hubCode.includes(item.description)) offenders.push(`${item.href}: description`);
      if (hubCode.includes(`"${item.label}"`)) offenders.push(`${item.href}: label`);
    }
    expect(offenders).toEqual([]);
  });

  it("renders a stat against real destinations only", () => {
    /*
     * The stats are keyed by href. A typo'd or renamed key is the one failure
     * mode that is completely invisible: the row still renders, just without
     * the live number that is this page's entire reason to exist.
     */
    const known = new Set([
      ...APP_NAV.map((i) => i.href),
      ...TRAIN_ZONES.map((i) => i.href),
      LOG_WORKOUT.href,
    ]);
    const paths = [...hubCode.matchAll(/"(\/[^"]*)"/g)]
      .map((m) => m[1].split("#")[0])
      .filter((p) => p.length > 1);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => !known.has(p))).toEqual([]);
  });

  it("offers the + button to an athlete with nothing logged yet", () => {
    // The empty case is this same page, not a separate screen — so the one
    // thing that fills it in has to be reachable from it.
    expect(hubCode).toMatch(/LOG_WORKOUT\.href/);
    expect(hubCode).toMatch(/buttonVariants\(\{\s*size:\s*"sm"\s*\}\)/);
  });
});

describe("the page guards itself like every other page under (app)", () => {
  const pageCode = stripComments(page);

  it("sends a half-onboarded athlete to /onboarding", () => {
    expect(pageCode).toMatch(/if\s*\(!profile\?\.onboarding_completed\)\s*redirect\("\/onboarding"\)/);
  });

  it("sends a signed-out visitor to /login", () => {
    expect(pageCode).toMatch(/if\s*\(!user\)\s*redirect\("\/login"\)/);
  });

  it("names itself in the browser tab", () => {
    expect(pageCode).toMatch(/title:\s*"Progress"/);
  });

  it("reads the index the same way the dashboard does", () => {
    /*
     * `is_provisional` ascending FIRST, matching migration 059's
     * sync_profile_current_index(). Drop that term and an athlete holding both
     * the onboarding estimate and a scored session sees one number here and a
     * different one on Home.
     */
    expect(pageCode).toMatch(/order\("is_provisional",\s*\{\s*ascending:\s*true\s*\}\)/);
    expect(pageCode).toMatch(/order\("recorded_at",\s*\{\s*ascending:\s*false\s*\}\)/);
  });

  it("hands the rendering to the hub rather than building rows itself", () => {
    expect(pageCode).toMatch(/<ProgressHub\b/);
    expect(pageCode).not.toMatch(/\bPROGRESS_NAV\b/);
  });
});
