# Hybrid Plan Engine — Project Assurance Review
## Stage 1 / Stage 2 gate | Independent S&C review of the evidence register, constants register and generated plans

**Scope of engagement (2 days):** Day 1 — evidence register and constants register. Day 2 — blind review of generated plans against a prescribing rubric, plus safety and contraindication pathways.
**Verdict:** **Conditional pass.** 25 findings. 7 graded Critical, 11 Major, 7 Minor. F19-F25 were raised during Rev C implementation review, not at the original gate — see section 8. Rev A of the engine satisfied its own constraint model but was **not a coachable plan**. Rev B closes 14 of the 18. The remaining 4 are conditions of sign-off and must be closed before Stage 3 build begins.

> **A necessary caveat.** What follows is the substance of a coach's review — the findings a competent S&C coach with powerlifting and distance-running experience would raise, and they are real findings that changed the engine. What it is not is the *other* half of what £300–600 buys you: a named professional with a qualification, an insurer, and personal accountability for the sign-off. If a user is injured, "the algorithm was reviewed by an AI" is not a defence. Use this document to arrive at the coach's engagement with the obvious problems already fixed, so their two days are spent on judgement rather than on catching absences. It shortens their job; it does not replace it.

---

## 1. Findings summary

| ID | Finding | Grade | Status |
|---|---|---|---|
| F1 | No safety or eligibility screen of any kind | **Critical** | Closed in Rev B |
| F2 | Engine actively suggests weight loss with no LEA safeguards | **Critical** | Closed in Rev B |
| F3 | Plan starts from an idealised base week, not the athlete's actual current load | **Critical** | Closed in Rev B |
| F4 | No deload weeks anywhere in a 24-week macrocycle | **Critical** | Closed in Rev B |
| F5 | No progressive overload — weekly load was effectively flat | **Critical** | Closed in Rev B |
| F6 | The stated ACWR quality criterion (QC-4) was never implemented | **Critical** | Closed in Rev B |
| F7 | Bodyweight frontier extrapolated to nonsense (14:10 5k at 60 kg) | Major | Closed in Rev B |
| F8 | "Lower/upper" days instead of lift-specific programming | Major | Closed in Rev B |
| F8b | Same lift programmed on consecutive days | Minor | Closed in Rev B |
| F9 | Sessions had no duration, pace, HR or load — not a prescription | Major | Closed in Rev B |
| F10 | Long runs never counted as quality for spacing purposes | Major | Closed in Rev B |
| F11 | Maximal deadlifting after a maximal 5k treated as a performance cost, not a safety issue | **Critical** | Closed in Rev B |
| F12 | Taper prescribed a marathon-scale carbohydrate load before a 5k | Major | Closed in Rev B |
| F13 | No strides, drills or plyometric exposure | Minor | Closed in Rev B |
| F14 | No event-day plan; weigh-in and re-warm-up unmodelled | Major | Closed in Rev B |
| F15 | Quality sessions do not progress across the block | Major | **Open — condition of sign-off** |
| F16 | No autoregulation from actual session feedback | Major | **Open — condition of sign-off** |
| F17 | No female-specific handling | Minor | **Open — condition of sign-off** |
| F18 | Attempt selection and race pacing unspecified | Minor | **Open — condition of sign-off** |
| F19 | Strength sessions truncated out of the week entirely for endurance-tilted athletes | **Critical** | Closed in Rev C |
| F20 | Base weeks received more quality work than specific weeks | Major | Closed in Rev C |
| F21 | Quality sessions prescribed at 17 minutes including warm-up | Major | Closed in Rev C |
| F22 | Rep range taken from emphasis, load from phase — incoherent prescriptions | Major | Closed in Rev C |
| F23 | The long run dropped entirely on deload weeks | Major | Closed in Rev C |
| F24 | Weak-lift session prescribed for an athlete with no weak lift | Minor | Closed in Rev C |
| F25 | The weight-cut refusal offered no next step | Minor | Closed in Rev C |

---

## 2. Critical findings in detail

### F1 — There was no safety screen (Critical)

Rev A would generate a peaking block for anyone: a 16-year-old, someone six weeks post-surgery, someone with exertional chest pain, someone with eight weeks of lifting experience. A coach's first hour with any athlete is screening, and no amount of downstream sophistication compensates for its absence.

**Required and implemented:** a blocking screen that runs before anything else. PAR-Q+ positives, exertional chest pain, current limiting injury, pregnancy or first 12 weeks postpartum, and under-18 all block plan generation outright. Recent surgery warns. Under 12 months of structured strength training blocks a *competition peaking* plan specifically — a general preparation plan is offered instead, because a novice does not need peaking, they need consistent exposure. Under 6 months of running halves the volume ramp rate.

The screen must produce referrals, not just refusals. A refusal with no next step is a churn event; a refusal with "here is who to see, come back after" is a retained user.

### F2 — The engine was pushing weight loss (Critical)

This is the finding I would put first in any conversation with you. Rev A's headline feature was a table showing that losing 8 kg buys 108 seconds off a 5k. That table is analytically correct and, presented to the wrong user, actively harmful. Hybrid athletes chasing a weight class *and* a run time are one of the higher-risk populations for low energy availability, and a paid app telling someone their goal becomes reachable at a lower bodyweight is a meaningful push.

**Required and implemented:**
- A five-question LEA screen. Two or more positives blocks plan generation and suppresses all bodyweight guidance; one positive suppresses bodyweight guidance and proceeds with fuelling reminders only.
- A hard BMI floor of 19.0 below which no bodyweight-reduction pathway is offered at all.
- The frontier is bounded to ±8% of current bodyweight, so it can no longer be read as an invitation to keep going.
- Every frontier row now carries the minimum number of weeks the change would take at a ≤0.6%/week ceiling, which reframes it from "lose 8 kg" to "this would take 11 weeks and here is what it costs you in kilos on the bar."
- A declared intent to water-cut alongside a same-day endurance race is refused outright.

The engine must never produce calorie targets, macro splits or rate-of-loss plans. That is a dietitian's job and the referral path should say so.

### F3 — The plan began in the wrong place (Critical)

Rev A's week 1 prescribed four to five endurance sessions to an athlete currently running twice a week, and did so at full base-phase volume. The `chronic_load` field existed on the athlete record and was never read by a single line of code. This is the single most common way generated plans injure people: the plan is internally coherent and starts 60% above where the athlete actually is.

**Required and implemented:** week 1 volume is anchored to the athlete's stated current weekly running minutes, and the ramp is capped at 8% per week (halved for athletes with under 6 months of running). For the calibration athlete this changes week 1 from an unanchored base week to 75 minutes — exactly what they are already doing — reaching 175 minutes by week 15.

### F4 — No deloads (Critical)

Twenty-four weeks of uninterrupted progression appears in no credible programme in either sport. Rev B inserts a deload every fourth week at 60% volume with intensity held — the standard 3:1 pattern, and the intensity-held detail matters because dropping both is detraining, not deloading.

The deload weeks are visible in the macrocycle table as weeks 4, 8, 12, 16 and 20, and their effect on the ACWR series is exactly what you would want to see: the ratio drops to 0.86–0.94 in those weeks, which is the recovery window that lets the next three weeks be productive.

### F5 — There was no progressive overload (Critical)

Rev A's weekly stress ran 505 in base week 1 and 540 in specific week 17 — a 7% increase across sixteen weeks. That is not a training plan, it is the same week repeated with different labels. The phase structure was cosmetic.

Rev B produces a genuine progression: 338 → 483 stress units, endurance volume 75 → 175 minutes, with volume held flat in the specific and peak phases while intensity rises (which is the correct shape — you do not add volume and intensity simultaneously in the specific phase).

### F6 — The quality criterion was never implemented (Critical)

The project document specified an ACWR ceiling as QC-4 and as a sustainability tolerance with zero allowance. No code computed ACWR. This is the exact failure mode of governance-on-paper, and it is worth naming plainly because it is the pattern the whole PRINCE2 structure exists to catch: **a control that is specified but not implemented is worse than no control, because it is reported as present.**

Rev B computes acute:chronic weekly load, seeded from the athlete's real chronic load so week 1 is measured against reality rather than zero, and iteratively caps any breaching week. Peak ACWR on the calibration plan is 1.19 against a 1.50 block ceiling and a 1.30 warning line. Week 1 sits at 0.79, marginally under the 0.80 detraining floor, which is acceptable for an on-ramp week but should be surfaced to the user as "this week is deliberately easy."

### F11 — Deadlifting after a 5k is a safety issue, not a cost (Critical)

Rev A modelled a maximal 5k followed by a powerlifting meet as an 8% decrement on the deadlift and weighed it against the athlete's priority slider. That framing is wrong. Maximal deadlift attempts with fatigued erectors, compromised bracing and depleted glycogen are not merely lighter — they are the highest-risk lumbar loading scenario in the sport, attempted in the worst possible state. A coach does not let an athlete trade that off against a priority weighting.

**Required and implemented:** the race-first order is now a safety block requiring explicit user override, not a costed option. The engine recommends meet-first even where the cost model prefers race-first, and labels the recommendation as safety-constrained. If a user overrides, the event-day plan instructs conservative deadlift attempts.

There is a second-order point here you will hit in practice: federation weigh-in timing often forces the meet-first order anyway. That is now noted in the event-day plan.

---

## 3. Major findings

**F7 — Bounded the frontier.** Rev A's linear pace-cost model predicted a 14:10 5k at 60 kg for an athlete currently running 19:20. Any extrapolation model needs bounds; this one now refuses to report beyond ±8% bodyweight or below BMI 19.

**F8 — Lift-specific days.** "Lower" and "upper" is not powerlifting programming. Rev B runs a squat/bench/deadlift/bench rotation with deadlift at the lowest frequency, which is correct for a concurrent athlete: the deadlift carries the highest systemic fatigue cost and competes most directly with running. **F8b:** a penalty now prevents the same lift landing on consecutive days.

**F9 — Sessions are now prescriptions.** Rev A output the string `easy_run`. A plan that does not say how far, how fast, and at what heart rate is not a plan. Rev B produces, for the calibration athlete's week 17: *"5x1000m @ 5k pace, 90s jog | 3:45–3:54/km | HR 182–192 | ~26min"* and *"squat 4x2-4 @ 130–145kg (82%–90% 1RM), RIR 1–2"*. Paces derive from the existing prediction engine, heart rates from the existing personalised Karvonen model, loads from the adaptive 1RMs. All three already exist in Split Index, which is the whole argument for building this.

**F10 — Long runs count.** A 90-minute long run 37 hours after heavy squats passed Rev A's checks because `long_run` was not flagged as quality. Any long run over 75 minutes is now treated as quality for spacing purposes.

**F12 — The carbohydrate guidance was wrong.** Rev A prescribed 8–10 g/kg the day before — a marathon load. For a 5k that is unnecessary, and the associated glycogen-bound water adds 1.5–2 kg, which costs 5k time *and* moves weigh-in mass for the same-day meet. Corrected to 6–7 g/kg framed as normal high-carbohydrate eating rather than a loading protocol.

**F14 — Event day is now planned.** Weigh-in timing, inter-event fuelling, and — importantly — a re-warm-up before the second event. Going from four hours of sitting between attempts straight into 5k race pace is a hamstring or calf strain waiting to happen.

---

## 4. Open findings — conditions of sign-off

These four must be closed before Stage 3 build. I would not sign off a build brief without them.

**F15 — Quality sessions must progress.** The engine currently prescribes 5x1000m at 5k pace in week 5 and in week 21. Interval sessions must progress in volume, density or pace across the block — for example 4x1000m at current 5k pace with 90s recovery in early specific, progressing to 6x1000m at target 5k pace with 75s recovery. Build a session-progression table per phase, indexed by week within phase.

**F16 — There is no feedback loop.** The plan is written once and never adapts. A real coach adjusts on Monday based on what happened at the weekend. Minimum viable version: after each session the athlete records completion, session RPE, and whether the prescribed load or pace was achieved. Three consecutive sessions below prescription, or a session RPE more than two points above the expected value, triggers a reduction in the following week. This is also where the 4BEAT work eventually plugs in — auto-captured RPE removes the compliance problem entirely.

**F17 — Female athletes need at least a minimum accommodation.** The evidence for menstrual-cycle-based periodisation is genuinely weak and I would not build prescription around it. But a symptom-flagging option that lets an athlete mark a day as low-capacity and have the engine swap a quality session for an easy one costs almost nothing and is a meaningful quality difference. Note also that the existing female cardio and strength factors already in Split Index feed the prediction inputs here, so the scoring side is covered — this is about the plan, not the score.

**F18 — Attempt selection and race pacing.** These are core coach deliverables and currently absent. Openers at roughly 91–93% of expected best, second attempts at 96–98%, thirds at 100–103%, with the caveat that a hybrid athlete on a dual-event day should open more conservatively than usual. Race pacing for the 5k: even splits or a marginally negative split, with the first kilometre 3–5 s/km slower than target when it follows a meet.

---

## 5. Plan review rubric

For Stage 4's blind coach panel. Each generated plan scored 1–5 on eight dimensions by three independent reviewers. QC-13 threshold: ≥80% of plans scoring "would prescribe" or "would prescribe with minor edits."

| # | Dimension | What a 5 looks like | What a 1 looks like |
|---|---|---|---|
| 1 | Starting point | Week 1 matches what the athlete is already doing | Week 1 is a step change from current load |
| 2 | Progression | Clear, bounded ramp with planned recovery weeks | Flat, or ramping without down weeks |
| 3 | Specificity | Sessions match the demands of both target events | Generic conditioning |
| 4 | Fatigue management | Hard sessions appropriately spaced; deadlift frequency sane | Heavy lower work stacked, no clearance before quality runs |
| 5 | Prescription quality | Every session has load/pace/HR/duration and is executable | Session labels only |
| 6 | Taper | Volume cut, intensity held, last heavy work correctly timed | Detraining, or heavy work too close in |
| 7 | Safety | Screening honoured; no contraindicated prescription | Would prescribe to someone who should be referred |
| 8 | Coachability | I could hand this to an athlete unmodified | I would rewrite it |

A plan scoring 1 or 2 on dimension 7 is an automatic fail regardless of other scores, and triggers QC-14 (zero unsafe plans, no tolerance).

---

## 6. Sign-off conditions

1. F15–F18 closed and re-reviewed.
2. The safety screen exercised against a test matrix covering every blocking path, with evidence.
3. Liability position confirmed before build, not after.
4. A named, qualified reviewer countersigns this document. **This condition cannot be met by this document itself.**

---

## 7. What Rev B changed, in numbers

| Measure | Rev A | Rev B |
|---|---|---|
| Safety screen | absent | 11 blocking/warning paths |
| Week 1 endurance volume | unanchored base week | 75 min (= athlete's current) |
| Endurance volume progression | none | 75 → 175 min |
| Weekly stress progression | 505 → 540 (flat) | 338 → 483 |
| Deload weeks | 0 | 5 |
| ACWR computed | no | yes, peak 1.19 vs 1.50 ceiling |
| Frontier bounds | unbounded (14:10 at 60 kg) | ±8% BW, BMI floor 19.0 |
| Session prescription detail | session label only | load, %1RM, RIR, pace, HR, duration |
| Deadlift-after-race | costed trade-off | safety block with override |
| Hard-rule violations | 0 | 0 |

The last row is the one to be careful about. Both revisions score zero hard-rule violations, and Rev A was not safe to ship. **Constraint satisfaction is a necessary condition and a poor proxy for quality.** Whatever dashboard you build for this, do not let "0 violations" become the metric anyone watches.

**All seven of F19–F25 passed constraint satisfaction before being caught.** Every one of them was found by reading generated plans, not by any check the engine runs on itself. A week with zero strength sessions, a 17-minute interval session and a prescription reading `4x1-3 @ 65-75% 1RM` scored exactly the same zero hard-rule violations as the corrected week that replaced it. This is the warning in the paragraph above stopping being a caution and becoming a measurement: the metric was green for a plan no coach would hand to an athlete. Treat plan review as the control and constraint satisfaction as the smoke test, not the other way round.

---

## 8. Rev C findings — raised during implementation review

These seven were found by reading generated plans against the prescribing rubric in section 5, after the engine was already passing every automated check it had. They are recorded here in the same format as F1–F18 because they are the same class of finding: internally coherent output that a coach would not prescribe.

### F19 — Strength work was being deleted from the week (Critical)

Graded Critical because it breaches the minimum maintenance dose, which is an evidence-register rule rather than a preference. Spiering 2021 is the basis for `MMD_STRENGTH_SESSIONS_PER_WEEK = 1`, and the engine was producing weeks with zero.

The cause was allocating the week's session slots as a single seven-way split across the whole emphasis vector. For an endurance-tilted athlete — the exact athlete this engine is built to serve — `maximal_strength`, `strength_endurance` and `weak_lift` each rounded to zero, and the per-week session cap then truncated away whatever survived, because strength sessions were constructed after endurance ones. A hybrid engine that silently drops one half of the hybrid is not a hybrid engine.

**Correction applied:** the emphasis vector is now allocated *within* each domain rather than across both. Domain slot counts come from the phase and the develop/maintain mode first; the vector then decides the mix inside each. A domain in maintain mode has its minimum dose reserved before any allocation runs, and the reserved intensity is held at 80% 1RM rather than dropped, because dropping intensity as well is detraining, not maintenance. Regression test asserts every week of a plan generated at priority 0.1 contains both strength and endurance work.

### F20 — Base weeks were harder than specific weeks (Major)

The brief specifies that emphasis wins over the phase TID target in base and build, and the phase wins in specific, peak and taper. Implemented literally, that gave a base week three quality sessions — interval, rep and threshold — while the specific week that followed got one. The progression ran backwards.

The underlying error was treating `neuromuscular` as a dimension that buys a standalone track session at any point in the block. It does not. Strides are how running economy is trained while the aerobic base is still being built; a separate rep session that early buys fatigue the athlete cannot yet absorb.

**Correction applied:** `neuromuscular` is delivered as strides appended to easy runs during base and build, and only claims a session of its own in specific and peak. Its weight is not discarded when it cannot claim a session — it folds into `aerobic_base`, where the strides actually happen. The brief's own worked example describes the result correctly: "easy volume plus one threshold session and strides."

### F21 — Seventeen-minute interval sessions (Major)

A low-volume athlete's weekly minutes divided across five session slots produced quality sessions shorter than their own warm-up. The arithmetic was consistent and the output was not a session. `4 x 1000m ... inside a 17min session` also contained an internal contradiction: 4km at the prescribed pace is 14.5 minutes of work, which does not fit inside 17 minutes with recovery.

**Correction applied:** minimum session durations are now constants (25 minutes endurance, 30 minutes quality) and the week's session *count* flexes down to respect them rather than the duration flexing down to preserve the count. Where that happens the athlete is told why: "Fewer, longer runs this week — 112 minutes split any further would be sessions too short to be worth doing."

### F22 — Rep range from emphasis, load from phase (Major)

The diagnostic's rep-profile verdict was setting the rep range while the macrocycle phase set the load, independently. In a base-phase week for an under-expressed athlete this produced `4x1-3 @ 65-75% 1RM` — neither a heavy single nor a volume set, and an RIR target that is unreachable at that load. A prescription in which the two halves contradict each other is worse than a generic one, because it looks specific.

**Correction applied:** load and rep range move together or neither moves. The strength emphasis now shifts the athlete one rung along the phase ladder (base → build → specific → peak) rather than setting reps independently, so an under-expressed athlete in base gets build-phase loading *and* build-phase reps. The shift is bounded by the ladder, so a base week can never reach peak-phase singles. Regression test asserts no prescription pairs a 1-3 rep target with a load below 80% 1RM, or a 6+ rep target with a load above 85%.

### F23 — The long run vanished on deload weeks (Major)

Deload weeks reduce volume to 60%, which dropped the affordable session count below the threshold that gated the long run, so the one session the entire aerobic block is built around disappeared roughly every fourth week. A deload reduces load; it does not remove the week's primary aerobic stimulus.

**Correction applied:** the long run is reserved whenever there is any running at all outside the taper. In weeks with few enough sessions that the long one is most of the week, it takes a proportional share of the minutes rather than a fixed 28%, so a two-session deload week no longer prescribes a "long run" shorter than its easy run.

### F24 — A weak-lift session for an athlete with no weak lift (Minor)

The `weak_lift` dimension carries a floor like every other dimension, so it could claim a session slot even when `find_weak_lift` had returned null. The session then fell back to the first lift in the rotation and was attributed to `hybrid-baseline` — a session with no finding behind it, which breaches non-negotiable #7. It also duplicated a lift the athlete was already training twice that week.

**Correction applied:** the `weak_lift` dimension only participates in allocation when the diagnostic actually named a weak lift. Otherwise its weight folds into `maximal_strength` and no orphan session is created.

### F25 — A refusal with no next step (Minor)

The safety screen blocks a declared acute weight cut alongside a same-day endurance race, correctly. It did so with no referral and no alternative, which is the churn event section 2 warns about under F1: "A refusal with no next step is a churn event; a refusal with 'here is who to see, come back after' is a retained user."

**Correction applied:** the block now names two concrete alternatives — lift in the class you already make on the day, or drop the same-day race and have the plan built around either goal alone — and offers a registered sports dietitian for reaching a class without cutting water in the event week. A test now asserts that *every* blocking path in the screen carries either a referral or a concrete alternative.
