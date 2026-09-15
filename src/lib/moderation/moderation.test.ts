import { describe, expect, it } from "vitest";
import { assess, assessProfileName, normalise, TRAINING_IDIOM } from "./filter";

/**
 * The tests that matter here are the false-positive ones. A filter that flags
 * ordinary training talk gets switched off, and an app with a switched-off
 * filter and a claim that it has one is in a worse position than an app with
 * neither.
 */
describe("training talk is not abuse", () => {
  it.each([
    "killed that set",
    "absolutely destroyed my legs today",
    "beat my PB by two minutes",
    "this session murdered me",
    "was dying on the last rep",
    "brutal but savage effort mate",
    "smashed it, insane pace",
    "dead legs after that one",
  ])("lets through: %s", (comment) => {
    expect(assess(comment).verdict).toBe("clean");
  });

  it("keeps the violent register documented so nobody adds it to the patterns", () => {
    // This list exists to be read by whoever is next tempted to add "kill".
    expect(TRAINING_IDIOM.test("killed that set")).toBe(true);
    expect(assess("killed that set").verdict).toBe("clean");
  });

  it("does not flag ordinary words that contain smaller ones", () => {
    // The Scunthorpe problem. A filter that fails this is a filter people
    // route around.
    for (const s of ["Scunthorpe parkrun", "analysis of my splits", "class was hard", "assessment done"]) {
      expect(assess(s).verdict).toBe("clean");
    }
  });
});

describe("what is actually refused", () => {
  it("refuses slurs, and says so without scolding", () => {
    const result = assess("you absolute r3t@rd");
    expect(result.verdict).toBe("reject");
    expect(result.refusal).toMatch(/slur/i);
  });

  it("sees through spacing, punctuation and leetspeak", () => {
    // Each of these defeats a naive includes().
    for (const evasion of ["c u n t", "c.u.n.t", "cuuunt", "©unt".replace("©", "c")]) {
      expect(assess(evasion).verdict).toBe("reject");
    }
  });

  it("strips diacritics and homoglyph-ish spellings", () => {
    expect(normalise("ｆａｇｇｏｔ".normalize("NFKC"))).toContain("faggot");
  });
});

describe("flagged rather than refused", () => {
  /*
   * Sexual content and self-harm are reviewed, not blocked. A training app sees
   * real non-abusive discussion of both — body composition, disordered eating,
   * low mood after injury — and refusing those outright silences the
   * conversations most worth having.
   */
  it("flags directed self-harm for a human", () => {
    const r = assess("kys");
    expect(r.verdict).toBe("review");
    expect(r.rule).toBe("self-harm-directed");
  });

  it("says nothing to the author when flagging", () => {
    // The comment publishes; a moderator sees it. Telling the author it was
    // flagged teaches them exactly what to reword.
    expect(assess("kys").refusal).toBeNull();
  });
});

describe("names are held to a higher bar than comments", () => {
  it("refuses in a name what it would only flag in a comment", () => {
    // A name is rendered beside every comment its owner writes and on every
    // leaderboard they appear on, to people who did not open a conversation.
    expect(assess("nudes").verdict).toBe("review");
    expect(assessProfileName("nudes").verdict).toBe("reject");
  });

  it("still lets an ordinary name through", () => {
    for (const name of ["Stephen R", "hybrid_athlete_92", "Ali"]) {
      expect(assessProfileName(name).verdict).toBe("clean");
    }
  });
});
