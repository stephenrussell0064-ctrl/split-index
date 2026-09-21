# Hybrid Plan Engine — Evidence Review, September 2026
## What was audited, what the evidence said, what changed, and what main had already fixed

**The question.** Does the Hybrid Plan get an athlete most of the way to a stated hybrid goal in a set time? Is it realistic, adjusted to the individual's pace and circumstances, and built on data from athletes who have actually improved on those timelines? Do the accepted principles of training-plan design apply?

**Method.** Four research agents compiled evidence briefs — concurrent training, endurance plan design, strength plan design, and goal feasibility and adherence — from primary sources, 111 named studies each graded high, moderate or low confidence. A fifth agent audited every engine module against them, line-cited. Six persona plans were generated and read against the coach rubric in `HPE-COACH-ASSURANCE-REVIEW.md`.

**An important correction to how this was done.** The audit ran against a branch that had diverged from `main` by 201 commits, and `main` had 24 commits of its own touching this engine. Several defects the audit found had already been fixed there, independently and well. This document reports only what was genuinely missing from `main`, and names what `main` had already solved, because a review that takes credit for someone else's fixes is worse than no review.

---

## 1. What `main` had already fixed

These were real defects and they were already closed before this branch existed. They are listed so the record is straight.

| Defect | Fixed on main by |
|---|---|
| The athlete was permanently in week one — every visit regenerated the block and re-anchored it to that Monday | `savePlan` reuses the current plan row when the diagnostic, constants, goal and constraints all match, so `generated_at` stays put and the athlete advances through the block |
| Weeks prescribed less running than they advertised — a median week spent 84% of its budget, the worst 55 minutes under a heading of 468 | The budget is reconciled against what the sessions contain, and the gap is reported with the intake answer that caused it |
| The ACWR cap moved the label and not the training | Capped weeks have their sessions refitted |
| `maxHoursPerWeek` was collected and never read — 22% of weeks exceeded the hours the athlete said they had | The stated hours bind the whole week, endurance flexing first |
| The projection promised times the plan's own volume could not deliver | `volumeSupport` scales the endurance gain by the peak volume the block actually reaches, measured against what the target time is historically built on |
| The session feedback table had no writer and the autoregulation loop had no input | `api/hpe/session-feedback` and `loadFeedbackByWeek` |

---

## 2. What this branch adds

Six commits. Every one is additive: no function `main` rewrote was overwritten, and the full suite of 2,543 tests passes.

### 2.1 HYROX is programmed as a running race — **Critical**

HYROX is offered in the intake and had no distance, so it was filtered out of endurance-event resolution entirely. `enduranceEventKm` came back null, `classifyDomains` never saw a race, and the athlete was put in endurance *maintain*: two sessions a week, for an event that is about half running by time.

Brandt & Ebel 2025 timed a recreational field at 51.2 minutes running against 32.8 on the stations. The finish-time correlates were VO2max (rho −0.71) and weekly endurance volume (rho −0.68); grip strength and resistance-training volume did not predict it.

It is an 8 km running event now, with the long run sized by the race's 85-to-120-minute duration rather than by its 8 km. The intake states plainly that the stations are not programmed — sled, wall balls, burpee broad jumps, carries and lunges are muscular-endurance work this engine does not write. Implying coverage it does not have would be the same failure as prescribing a barbell to someone training in a bedroom.

*Confidence: moderate for the classification, low for any specific HYROX programme. No training trials exist.*

### 2.2 The long run builds in steps, on the rule the evidence supports — **Major**

The engine's progression controls were the weekly ramp and the acute:chronic workload ratio. The best-supported injury control in the running literature was not among them.

Frandsen, Hulme, Parner and Nielsen 2025 (*BJSM*), 5,205 runners across 588,071 sessions: a run more than 10% longer than the longest of the previous 30 days raised the overuse-injury hazard by 64% (10–30% over), 52% (30–100%) and 128% beyond that. In the same cohort the week-to-week ratio predicted nothing, and the acute:chronic ratio ran the *wrong way* — large spikes by that measure went with fewer injuries.

The long run is now held to 10% past the longest of the last four weeks. Race-distance sizing could previously ask for a step the athlete had never taken. The deload also stops leaving the long run alone, which had the most fatiguing session of the week surviving the week meant to recover from it.

`longest_recent_run_min` had been asked for since the intake was written and read by nothing; it is the week-one anchor, and where it is missing the rule does not fire rather than firing on a guess.

*Confidence: moderate-to-high. One very large prospective cohort, not yet replicated.*

### 2.3 The taper follows the event — **Major**

The block tapered for one week whatever the athlete was training for: right for a 5 km, wrong for a marathon by a fortnight.

Bosquet 2007 and Wang 2023, both meta-analyses, put the best time-trial effect at 8–14 days of a 41–60% progressive volume cut with intensity and frequency held. Spilsbury 2015 timed elite British runners at a median six days for 3 km–10 km and fourteen for the marathon. Smyth & Lawlor 2021, across 158,117 Strava marathons, found strict monotone two- and three-week tapers fastest, worth 2–3% on finish time.

One week for a 5 km, 10 km or HYROX; two for a half; three for a marathon. Only a real event date earns the longer taper. The taper is also monotone now — it was a flat 55% of peak for however many weeks it ran, so a three-week taper would have been three identical weeks.

*Confidence: high for the magnitude and the intensity rule, moderate for the event-specific lengths.*

### 2.4 The projection says the odds, not just the verdict — **Major**

The projection answered one question: does a point estimate clear the target. That has no room for "probably not, but worth training for", which describes most ambitious goals, and no room for the fact that two athletes of the same training age on the same plan get visibly different results. Ahtiainen 2016 (n = 287) measured strength gains of 21 ± 11.5% with a range from −8% to +60%; HERITAGE found VO2max responses from about −2% to over +40% on one identical twenty-week programme.

Each side now returns an expected outcome, an 80% interval, and the probability of the target with the chance of finishing the block folded in. A target more than one standard deviation past the expected outcome is named a stretch and the athlete is given a primary goal to measure against; beyond two, it is named as the multi-block goal it is. The stretch is kept — it is no longer the only number on the page. Bar-Eli 1997 found difficult-but-realistic goals beat improbable ones; Locke & Latham find commitment collapses once a goal reads as a threat.

Adherence is part of the quoted probability because finishing is part of the outcome. STRRIDE loses about 30%; Relph 2023 saw 27% of a Couch-to-5k cohort finish, with prior injury carrying an odds ratio of 7.6.

*Confidence: high that the spread is real and large; moderate for the specific SDs.*

### 2.5 Interference applied where the meta-analyses find it — **Major**

The flat 18% penalty is Wilson 2012, whose sample was largely untrained and whose figure is a ratio of within-group effect sizes. It has not survived: Schumann 2022 (43 studies) puts the pooled effect on maximal strength at SMD −0.06, indistinguishable from zero. What replicates is narrower — Petré 2021 finds ES −0.35 in *trained* lifters, −0.66 same-session against −0.10 separated; Huiberts 2024 finds SMD −0.43 in men against +0.08 in women. Upper body is unaffected throughout.

It now lands on the lower-body share of the target, for men, once running is a real weekly load, and nowhere else. A woman's projection is no longer discounted for running, and bench never is.

Strength training age is also floored by relative strength, as the 5 km already floors the endurance one: an unanswered training-age question resolves to zero years and the novice rate, so somebody squatting twice bodyweight who skipped the history section was being promised a beginner's progress.

*Confidence: high.*

### 2.6 Age moves the baseline, not the rate — **Minor**

Trainability is preserved into the sixties. Peterson 2010 found adults over 50 gaining 24–33% on compound lifts over 12–18 weeks, indistinguishable from young novices; Huang 2016 found the same relative VO2max gain in over-60s; Skinner 2001 found age explained very little of the response variance. So there is no age term on the rate until about sixty and a gentle one after it. What age really moves is the starting point, which is the athlete's own measured performance and already in the arithmetic.

### 2.7 A travel week is a lighter week — **Minor**

`travel_weeks` was collected, stored and carried into `Constraints`, and read by nothing. Each declared week is now a reduced week rather than a hole.

---

## 3. What remains open

1. **The stations are still not programmed for HYROX.** The running half is, and it is the half the finish time tracks. Station programming is a build, not a constant.
2. **The response model is not built.** The projection still uses population rates throughout. Learning the athlete's own rate from their logged history — blended at a weight that reflects how much of a single block's deviation is noise (Renwick 2024) — is the natural next step and is designed but not shipped here.
3. **No dataset ties goal ambition to plan abandonment.** The stretch and multi-block grading rests on Bar-Eli and Swann, which are about performance in short supervised experiments rather than about who quietly stops opening the app. Recording the required-gain z-score at generation time would let this be measured; it is the single most valuable number this product could collect and it is not yet being collected.
4. **The RPE threshold rule is consensus, not evidence.** HRV-guided placement of hard sessions is the evidence-backed version (Vesterinen 2016; Düking 2021: fewer non-responders rather than a larger mean) and needs an HRV feed.
5. **Deload cadence has no outcome evidence in either sport.** Every-fourth-week is kept because the injury literature favours planned recovery and no trial shows harm from a reduced week. Bell 2022–2024 is survey and Delphi work; Coleman 2024 found a full week off cost strength.
6. **A named, qualified reviewer still has to countersign.** This document, like the assurance review before it, is the substance of a coach's review without the accountability of one.

**What no generator can honestly promise** is that a stated target will be reached. The engine now says what is expected, how wide the band is, what the probability is once dropout is included, and what its own volume can support — and it builds toward the milestone it expects rather than the number the athlete typed.

---

## 4. Test coverage added

Three new files, 24 tests, each naming the finding it closes:

- `session-spike.test.ts` — the long run never steps past 10% of its four-week anchor, still builds toward the race, comes down on a deload, and does not fire without an anchor.
- `taper-by-event.test.ts` — one week for a 5 km, two for a half, three for a marathon; one with no race; never most of a short block; monotone and inside the 41–60% cut.
- `feasibility-probability.test.ts` — intervals bracket the expectation, probabilities include adherence, goal levels order by distance, interference costs men under load and women nothing, training age is floored by performance, age is neutral to sixty.

Full suite on this branch: **2,543 tests across 193 files, all passing.**
