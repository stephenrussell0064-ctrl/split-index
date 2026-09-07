import { describe, expect, it } from "vitest";
import { shareableAthleteName } from "./shareable-name";

/**
 * THE NAME THAT USED TO BE AN EMAIL ADDRESS.
 *
 * Onboarding set `display_name` to `user.email` whenever the identity provider
 * gave no name — which is every ordinary email/password signup. That field is
 * not private: the leaderboard renders `displayName ?? username`, and both
 * share-card routes print it onto a PNG built to be posted. Signing up and
 * tapping through onboarding put the athlete's email address on a public
 * leaderboard and into a shareable image, silently.
 *
 * Onboarding no longer writes one. Rows created before that still hold them,
 * and this guard is what stands between those rows and a public image.
 */

describe("a name on a shareable card", () => {
  it("is never an email address", () => {
    expect(shareableAthleteName("sam@example.com", "samruns")).toBe("samruns");
  });

  it("falls back to the athlete's own username, not to nothing", () => {
    // The username is the name they chose to be known by.
    expect(shareableAthleteName(null, "samruns")).toBe("samruns");
    expect(shareableAthleteName("   ", "samruns")).toBe("samruns");
  });

  it("says something when there is no name at all", () => {
    expect(shareableAthleteName(null, null)).toBe("This athlete");
    expect(shareableAthleteName("nobody@example.com", null)).toBe("This athlete");
  });

  it("cannot overflow the image", () => {
    // `display_name` has no database constraint and its only length check is
    // client-side, so a row written any other way arrives unbounded.
    const long = shareableAthleteName("a".repeat(500), "samruns");
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long.endsWith("…")).toBe(true);
  });

  it("leaves an ordinary name exactly as written", () => {
    expect(shareableAthleteName("Sam Fitzgerald", "samruns")).toBe("Sam Fitzgerald");
    expect(shareableAthleteName("Åsa Öberg-Nyström", null)).toBe("Åsa Öberg-Nyström");
  });
});
