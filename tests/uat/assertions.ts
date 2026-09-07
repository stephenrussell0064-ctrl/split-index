import type { SimulationResult } from "./simulator";

/**
 * The questions an athlete would ask, expressed as checks.
 *
 * Deliberately not unit assertions. A unit test asks "does `sideIndex` return
 * 712 for this input"; these ask "after ten weeks of honest training, did this
 * person get anything worth £29.99 a year". Those come apart: every function in
 * the scoring tree can be individually correct while a swimmer still sees a
 * number that never moves.
 *
 * Checks return findings rather than throwing, so one run reports everything
 * wrong for an athlete instead of stopping at the first thing. The test file
 * turns blocking findings into failures.
 */

export type Severity =
  /** The app is broken or lying for this athlete. Fails the suite. */
  | "blocking"
  /** Works, but this athlete is being short-changed. Reported, does not fail. */
  | "degraded"
  /** Worth a human look. Never fails. */
  | "note";

export interface Finding {
  persona: string;
  severity: Severity;
  check: string;
  /** What the athlete would experience, not what the assertion compared. */
  detail: string;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Every user-visible number on the dashboard, per session. */
function visibleNumbers(s: SimulationResult["sessions"][number]) {
  return {
    sportIndex: s.output.sportIndex,
    splitIndex: s.splitIndex,
    enduranceIndex: s.output.enduranceIndex,
    strengthIndex: s.output.strengthIndex,
    loadScore: s.output.loadScore,
    fatigueScore: s.output.fatigueScore,
    recoveryScore: s.output.recoveryScore,
    activityConfidence: s.output.activityConfidence,
    acwr: s.acwr,
  };
}

export function checkAthlete(result: SimulationResult): Finding[] {
  const { persona, sessions, failures } = result;
  const out: Finding[] = [];
  const add = (severity: Severity, check: string, detail: string) =>
    out.push({ persona: persona.id, severity, check, detail });

  // ── 1. Did anything crash? ────────────────────────────────────────────────
  for (const f of failures) {
    add(
      "blocking",
      "logging a session works",
      `Session ${f.sessionIndex} (${f.sport}) threw: ${f.error}. The athlete taps Save and the app fails.`
    );
  }

  if (sessions.length === 0) {
    add("blocking", "the athlete can train at all", "No session was scored. Nothing else can be checked.");
    return out;
  }

  // ── 2. Is every number they can see a real number? ────────────────────────
  // NaN reaches the screen as "NaN" and Infinity as "∞". Either destroys trust
  // instantly and permanently, and neither is caught by the type checker.
  for (const s of sessions) {
    for (const [name, value] of Object.entries(visibleNumbers(s))) {
      if (!finite(value)) {
        add(
          "blocking",
          "no broken numbers reach the screen",
          `${name} was ${String(value)} after session ${s.index} (${s.sport}, week ${s.week}). This renders on the dashboard.`
        );
      }
    }
  }

  // ── 3. Did they get a score at all, from their very first session? ────────
  const first = sessions[0];
  if (first.splitIndex <= 0) {
    add(
      "blocking",
      "the first session produces a number",
      `First session (${first.sport}) left the Split Index at ${first.splitIndex}. A new athlete sees zero and has no reason to log a second.`
    );
  }

  // ── 4. Are the numbers in the range the product claims? ───────────────────
  // The indexes are documented as 0–1000. A number outside that is not a
  // rounding problem, it is a number the UI has no design for.
  for (const s of sessions) {
    if (s.splitIndex < 0 || s.splitIndex > 1000) {
      add(
        "blocking",
        "indexes stay inside 0–1000",
        `Split Index was ${s.splitIndex} after session ${s.index} (${s.sport}). Outside the documented scale.`
      );
      break;
    }
  }

  // ── 5. Does their own sport actually count? ───────────────────────────────
  // The calibration risk, and the one that loses whole sports quietly: a
  // swimmer whose swims all score near zero concludes the app is not for them.
  const bySport = new Map<string, number[]>();
  for (const s of sessions) {
    bySport.set(s.sport, [...(bySport.get(s.sport) ?? []), s.output.sportIndex]);
  }
  for (const [sport, scores] of bySport) {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (mean <= 1) {
      add(
        "blocking",
        "their sport is scored",
        `${sport} averaged ${mean.toFixed(1)} across ${scores.length} sessions. This athlete's main sport reads as nothing.`
      );
    } else if (mean < 50) {
      add(
        "degraded",
        "their sport is scored fairly",
        `${sport} averaged only ${mean.toFixed(0)} across ${scores.length} sessions, against a 0–1000 scale. Likely a calibration gap rather than a weak athlete.`
      );
    }

    const spread = Math.max(...scores) - Math.min(...scores);
    if (scores.length >= 5 && spread === 0) {
      add(
        "degraded",
        "the score responds to the session",
        `Every ${sport} session scored identically (${scores[0]}). The athlete gets the same number whatever they do, so the score tells them nothing.`
      );
    }
  }

  // ── 6. Does improving show up as improvement? ─────────────────────────────
  // The core promise. If twelve weeks of genuine progress does not move the
  // number, the product does not work, however elegant the internals are.
  if (persona.trajectory === "improving" && sessions.length >= 10) {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    /*
     * Measured per sport, not on the blended headline.
     *
     * The headline is a weighted blend of the Lab and Engine sides, so it moves
     * for reasons that have nothing to do with getting fitter — most obviously
     * when an athlete TAKES UP a second discipline they are worse at. The
     * swimmer does exactly that (five swims a week, plus two gym sessions for
     * shoulder health), and her headline dips as the gym side enters the blend
     * while both of her sports are genuinely improving. Asserting on the
     * headline called that "the app did not notice", which was wrong.
     */
    const bySportScores = new Map<string, number[]>();
    for (const s of sessions) {
      bySportScores.set(s.sport, [...(bySportScores.get(s.sport) ?? []), s.output.sportIndex]);
    }

    for (const [sport, scores] of bySportScores) {
      if (scores.length < 6) continue; // too few to read a trend from
      const early = mean(scores.slice(0, 3));
      const late = mean(scores.slice(-3));
      if (late < early) {
        add(
          "blocking",
          "improvement is visible",
          `${sport} scores went ${early.toFixed(0)} → ${late.toFixed(0)} over ${persona.weeks} weeks of real improvement. The athlete got better at this sport and the app scored them lower.`
        );
      } else if (late - early < 3) {
        add(
          "degraded",
          "improvement is visible enough to feel",
          `${sport} moved only ${(late - early).toFixed(1)} points over ${persona.weeks} weeks. Technically up, invisible to someone checking weekly.`
        );
      }
    }

    // The blended headline falling while every discipline rises is a real
    // product finding rather than a defect, and worth surfacing on its own
    // terms: an athlete who takes up a second sport is told they got worse.
    const headlineEarly = mean(sessions.slice(0, 5).map((s) => s.splitIndex));
    const headlineLate = mean(sessions.slice(-5).map((s) => s.splitIndex));
    const everySportImproved = [...bySportScores.values()]
      .filter((s) => s.length >= 6)
      .every((s) => mean(s.slice(-3)) >= mean(s.slice(0, 3)));

    if (headlineLate < headlineEarly && everySportImproved) {
      add(
        "note",
        "adding a discipline lowers the headline",
        `Every sport improved, but the headline index went ${headlineEarly.toFixed(0)} → ${headlineLate.toFixed(0)} because a weaker second discipline entered the blend. Arithmetically correct; reads to the athlete as "I got worse".`
      );
    }
  }

  // ── 7. Does the risk index fire when it must? ─────────────────────────────
  // The one safety-shaped claim in the product. A risk index that never fires
  // is worse than no risk index, because it is believed.
  if (persona.trajectory === "overreaching") {
    /*
     * Only sessions after day 28 count.
     *
     * ACWR is acute load over chronic load, and chronic is a 28-day average.
     * Before that window fills, every athlete — including a sensible one —
     * shows a wild ratio simply because the denominator started at nothing.
     * Asserting across the whole history let this check pass on the warm-up
     * spike rather than on the thing it is meant to detect, which would have
     * made it useless while looking green.
     */
    const firstAt = Date.parse(sessions[0].date);
    const settled = sessions.filter((s) => Date.parse(s.date) - firstAt >= 28 * 86_400_000);
    const window = settled.length >= 5 ? settled : sessions;
    const everWarned = window.some((s) => s.risk.zone === "Caution" || s.risk.zone === "Danger");
    if (!everWarned) {
      add(
        "blocking",
        "overtraining is warned about",
        `Volume more than doubled in ${persona.weeks} weeks and ACWR peaked at ${result.peakAcwr.toFixed(2)} without ever leaving the optimal band. The athlete is told they are fine while running into an injury.`
      );
    }
  }

  // ── 8. Is a cautious returner left alone? ─────────────────────────────────
  // The inverse failure. Screaming at someone rebuilding from a low base is how
  // a safety feature gets ignored, and then it is worth nothing when it matters.
  if (persona.trajectory === "detrained-returning") {
    const dangerCount = sessions.filter((s) => s.risk.zone === "Danger").length;
    if (dangerCount > sessions.length * 0.3) {
      add(
        "degraded",
        "a careful return is not alarmed at",
        `${dangerCount} of ${sessions.length} sessions read Danger while deliberately rebuilding from a low base. Warnings this frequent get dismissed, and then the real one is dismissed too.`
      );
    }
  }

  // ── 9. Is the number stable enough to trust? ──────────────────────────────
  // An index that lurches 200 points on a normal session reads as broken, even
  // when each individual computation is defensible.
  let worstJump = 0;
  let worstAt = -1;
  for (let i = 1; i < sessions.length; i++) {
    const jump = Math.abs(sessions[i].splitIndex - sessions[i - 1].splitIndex);
    if (jump > worstJump) {
      worstJump = jump;
      worstAt = i;
    }
  }
  if (worstJump > 150 && sessions.length > 5) {
    const s = sessions[worstAt];
    add(
      "degraded",
      "the index does not lurch",
      `Index moved ${worstJump.toFixed(0)} points on one ordinary ${s.sport} session (week ${s.week}). An athlete seeing that assumes the number is made up.`
    );
  }

  // ── 10. Sparse loggers must not be punished ───────────────────────────────
  if (persona.id === "sporadic") {
    const zeroes = sessions.filter((s) => s.splitIndex <= 0).length;
    if (zeroes > 0) {
      add(
        "blocking",
        "irregular training still produces a score",
        `${zeroes} sessions produced a zero index. The largest group of real users trains irregularly, and this is the group most likely to cancel.`
      );
    }
  }

  return out;
}

/** A short human summary of one athlete's run, for the report. */
export function summarise(result: SimulationResult, findings: Finding[]): string {
  const blocking = findings.filter((f) => f.severity === "blocking").length;
  const degraded = findings.filter((f) => f.severity === "degraded").length;
  const verdict = blocking > 0 ? "BROKEN" : degraded > 0 ? "SHORT-CHANGED" : "SERVED";

  // Per-sport means, because a mixed athlete's headline index hides which of
  // their sports is the one misbehaving — which is the whole question for the
  // swimmer, the cyclist and the erg athlete.
  const bySport = new Map<string, number[]>();
  for (const s of result.sessions) {
    bySport.set(s.sport, [...(bySport.get(s.sport) ?? []), s.output.sportIndex]);
  }
  const sportLines = [...bySport.entries()].map(([sport, scores]) => {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const firstThree = scores.slice(0, 3);
    const lastThree = scores.slice(-3);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return `    ${sport.padEnd(17)} n=${String(scores.length).padStart(3)}  mean ${mean.toFixed(0).padStart(4)}  first3 ${avg(firstThree).toFixed(0).padStart(4)} → last3 ${avg(lastThree).toFixed(0).padStart(4)}`;
  });

  return [
    `${result.persona.id} — ${verdict}`,
    `  ${result.sessions.length} sessions over ${result.persona.weeks} weeks · index ${result.firstIndex} → ${result.finalIndex} · ACWR ${result.minAcwr.toFixed(2)}–${result.peakAcwr.toFixed(2)}`,
    ...sportLines,
    `  ${blocking} blocking, ${degraded} degraded`,
  ].join("\n");
}
