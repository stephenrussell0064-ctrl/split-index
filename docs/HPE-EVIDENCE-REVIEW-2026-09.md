# Hybrid Plan Engine — Evidence Review and Rebuild (constants 3.0.0)
## The question, the verdict, what changed, and what each change rests on

**The question asked.** Does the Hybrid Plan get an athlete most of the way to a stated hybrid goal in a set time? Is it realistic, adjusted to the individual's pace and circumstances, and built on data from athletes who have actually improved on those timelines? Do all the accepted principles of training-plan design apply?

**The verdict on constants 2.1.0: no, on five of the six counts.** The engine was structurally sound (safety screen, diagnostic, emphasis vector, hard-rule scheduler) and its constants were mostly defensible, but the plan an athlete lived through was not the plan the engine designed, its progression rules were the ones the evidence has since rejected, and its feasibility statement was a point estimate with no basis for its width. Section 2 lists the twenty-one findings. Section 3 gives the evidence each change rests on, with confidence grades. Section 4 is what remains open and honest limits on what any generator can promise.

**Method.** Four research agents compiled evidence briefs (concurrent training, endurance plan design, strength plan design, goal feasibility and adherence) from primary sources — 111 named studies, each graded high/moderate/low. A fifth agent audited every engine module against the briefs, line-cited. Six persona plans were generated and read against the coach rubric in `HPE-COACH-ASSURANCE-REVIEW.md` before and after. The briefs are the evidence register; this document is the decision record.

---

## 1. Verdict by criterion

| Criterion | 2.1.0 | 3.0.0 |
|---|---|---|
| Gets the athlete most of the way to the goal | **No.** Every visit regenerated the block from week one and anchored it to that Monday. The athlete was permanently in week one; no deload, ramp step or phase change ever arrived. | Block continuity: the lived weeks carry through, the remaining weeks regenerate from real logged volume, the calendar keeps its original Monday. |
| Realistic | **Partly.** Gain rates were plausible but the projection had no variance, no dose term, no adherence term, and an infeasible target made the intervals *faster*. | Probabilistic model: expected outcome, 80% interval, probability of the target, goal graded within-reach / stretch / multi-block, dose warnings stated before the goal verdict. |
| Adjusted to the individual's pace | **Partly.** Week one was the athlete's current volume (F3), but the ramp compounded three halvings to 1–2%/week for anyone who skipped the history section, and the reported minutes were 30–55% above what the sessions added up to for a race athlete. | One combined, floored ramp. Reported minutes are the sessions' minutes. Ramp restarts from real logged volume on continuation. Previous maximum volume caps the block. |
| Adjusted to personal circumstances | **No.** Sleep, life stress, job, previous max volume, longest recent run, travel weeks, disliked exercises, hours cap, per-day windows — all collected, none read. | Sleep and stress slow the ramp and cap quality; hours cap binds the whole week; travel weeks are maintenance weeks; disliked exercises filtered; longest recent run anchors the spike rule. |
| Based on data from athletes who improved on those timelines | **Partly.** Rates were practitioner estimates tagged [EST], and they never moved for the individual. | Rates and SDs from cohorts: Ahtiainen 2016 (n=287), Latella 2020/2024 (n=1,897 / 9,259 powerlifters), HERITAGE, Muñoz 2014, Festa 2020, Filipas 2022. Concurrent penalty from Petré 2021 and Huiberts 2024 rather than a flat 18%. Then measured on the athlete: their own logged rate is blended in as the history accumulates. |
| All principles of plan design | **Partly.** Progressive overload existed for endurance volume only; strength was identical week to week inside a phase; the taper's hardest session was the block's hardest; ACWR was the control despite the evidence against it. | Within-phase strength progression, working max walking up with the projection, taper by event with intensity kept and volume cut, single-session spike rule as the injury control, ACWR demoted to backstop, hard/easy spacing enforced. |

---

## 2. Findings (F-3.x), with what closed each

Graded as in the assurance review. **Critical** = the plan would not get the athlete toward the goal or could hurt them. **Major** = a coach would not prescribe it. **Minor** = wrong but survivable.

| ID | Finding | Grade | Closed by |
|---|---|---|---|
| F-3.1 | Plan regenerated from week one on every visit; periodisation never executed | **Critical** | `engine.ts` `continueFrom`; `persistence.ts` `loadCurrentPlan`, `starts_on`, `generated_for_week`; migration 076; route continuity logic; screen anchors to `startsOn` |
| F-3.2 | Infeasible target made quality sessions faster, not the plan more conservative | **Critical** | `progression.ts` `qualityEndAnchor5kS`: paces progress toward the *expected* outcome; the target may only slow the anchor |
| F-3.3 | No quality session possible under 200 min/week (fixed 15% budget share) — most hybrid athletes | **Critical** | Quality session is a session size (`QUALITY_SESSION_MINUTE_SHARE` with floor/ceiling); quality floor in every non-deload week |
| F-3.4 | Feedback loop had no input: `feedbackByWeek` never passed, feedback table had no writer, low-capacity swap uncalled | **Critical** | `feedback.ts` derives completion, RPE and met-prescription from the activity log; `POST /api/hpe/feedback` writes explicit feedback; route passes both |
| F-3.5 | Feasibility had no variance, no dose, no adherence, no sex/age; unanswered training age defaulted to the highest gain rate; strength training age never performance-inferred | **Major** | `feasibility.ts` rewritten: means + SDs by training age, dose gates, adherence prior, noise floor, `inferredStrengthTrainingAge` |
| F-3.6 | Novice ramp halved twice (safety screen and macrocycle) and compounded with the provisional halving to 1–2%/week | **Major** | `effectiveRamp` applies each factor once and floors the product at 0.5 |
| F-3.7 | Reported weekly minutes were the budget, not the sessions; diverged 30–55% for race athletes | **Major** | `PlanWeek.enduranceMin` is the delivered minutes; `delivered` block on every week |
| F-3.8 | ACWR chronic seed in the wrong units (minutes × 4 vs stress); weeks 1–4 mislabelled "on-ramp"; cap scaled a number beside the sessions and left them untouched | **Major** | `chronicLoadFromRuns` in stress units; capped weeks are rebuilt; on-ramp note only when volume is genuinely below current |
| F-3.9 | No within-phase strength progression; tied rep profile shifted every peaking athlete a rung heavier for the whole block, so the base-phase spec was never used | **Major** | `subBandFor` walks the load band across the phase; the ladder shift applies only when a rep-profile finding exists; working max advances with the projection |
| F-3.10 | Heavy-lower spacing flag read the unshifted phase table, so 85% sessions in base were not spaced from quality runs | **Major** | Flag set from the loads actually prescribed |
| F-3.11 | Squat and deadlift each met once a fortnight on three gym days (under the 3–6 sets/lift/week floor) | **Major** | Lower days carry both lower lifts (primary + secondary at reduced sets and load) |
| F-3.12 | Taper: one week for every event; hardest interval session of the block three days before the race; no lift-specific final-week ceilings | **Major** | `TAPER_WEEKS_BY_EVENT`, progressive monotone taper shares, `TAPER_QUALITY_REP_MULTIPLIER`, `TAPER_FINAL_WEEK_INTENSITY_CEILING` |
| F-3.13 | Deload cut endurance 40% but left the long run untouched and cut strength sets by one | **Major** | Deload 30% volume, long run to 75% of the last full one, strength sets to 60% with +1 RIR |
| F-3.14 | `maxHoursPerWeek` never read | **Major** | Cap binds the whole week: slots trimmed on both sides, then easy runs, then the long run |
| F-3.15 | Priority slider moved at most one session, only at 7+ sessions/week | **Major** | `domainSessionTargets`: strong lean moves two sessions, down to the maintenance dose |
| F-3.16 | Flat 18% concurrent attenuation applied to all strength regardless of sex, lift or running load; running-economy bonus added even with no heavy work | **Minor** | Interference on lower-body, men, ≥150 min/week running; economy bonus only when two heavy sessions are delivered |
| F-3.17 | Sleep, life stress, previous max volume, longest recent run, travel weeks, disliked exercises unread | **Minor** | All wired; see Section 3 |
| F-3.18 | No hard/easy spacing rule for consecutive quality endurance days | **Minor** | `quality_endurance_consecutive` hard penalty |
| F-3.19 | Interval sessions did not contain their own reps plus a warm-up ("6 x 1000m … inside a 30min session") | **Minor** | Session grows to its ceiling, then reps come down; warm-up stated |
| F-3.20 | Novice runners given an interval session in week one; novice lifters given 3x3-5 at 80–85% with no 1RM | **Minor** | Novice endurance: no quality in base, one thereafter; novice strength maintenance uses the first general block scheme |
| F-3.21 | Riegel 1.06 marathon projection unconditioned on volume | **Minor** | `eventRiegelK` conditioned on weekly minutes |
| F-3.22 | The projection never learned the athlete's own rate. The engine's own message promised "the projection is recomputed from your logged sessions", and it recomputed from an updated *starting point* while the *rate* stayed at the population prior forever | **Major** | `response.ts` `estimateObservedResponse` + `blendRate`; `loadProfileHistory`; blended in `feasibilityScreen` and reported in words |
| F-3.23 | F17's low-capacity swap was library code with no caller; the flag had a writer but no reader | **Minor** | `easySwapFor` in `session-set.ts`; applied to the scheduled week in `engine.ts`; route reads flags for the current week and later |
| F-3.24 | HYROX was offered in the intake and given no distance, so it was filtered out of endurance-event resolution entirely: no long-run target, and endurance classified **maintain** — two sessions a week for an event that is half running by time | **Critical** | `EVENT_DISTANCE_KM.hyrox = 8`; `LONG_RUN_PEAK_FRACTION_OF_RACE.hyrox = 2.0` (sized by the race's 85–120 min duration, not its 8km); `modalityForEvent` returns run; an intake assumption states plainly that the stations are not programmed |
| F-3.25 | The ambition-versus-abandonment curve — named in this document as the most valuable unmeasured number — was not being recorded, so it could never start accumulating | **Minor** | Migration 080 adds goal z-score, goal level, quoted probability, adherence prior, delivered dose and continuation flag to `hpe_generation_events`; the plan route records them on every generation |

---

## 3. The evidence behind each rule

Confidence: **H** replicated / meta-analytic; **M** one good study or consistent smaller ones; **L** single small study or practitioner consensus. Full citations are in the four briefs under `scratchpad/research-*.md` of the session that produced this document; the key ones are named here.

### 3.1 Progression and injury control

| Rule | Constant | Evidence | Conf. |
|---|---|---|---|
| A single run may not exceed 1.1× the longest run of the last 30 days | `SESSION_SPIKE_MAX_MULTIPLE` | Frandsen, Hulme, Parner … Nielsen 2025, *BJSM*, 5,205 runners, 588,071 sessions: HRR 1.64 (10–30% over), 1.52 (30–100%), 2.28 (>100%). Week-to-week ratio: no association. ACWR: inverse association. | M–H |
| Weekly ramp ≤8%, one combined multiplier, floored at 0.5 | `MAX_WEEKLY_VOLUME_RAMP`, `MIN_COMBINED_RAMP_MULTIPLIER` | Buist 2008 RCT: the 10% rule is not protective (20.8% vs 20.3% injured). Nielsen 2014: only >30% jumps show a signal. So 8% is a safe default, not a law, and stacking halvings below it produces a block that does nothing. | H (10% not protective) |
| ACWR is a backstop, not a control | `ACWR_WARN`, `ACWR_BLOCK` retained | Impellizzeri 2020: no causal evidence, unsound statistics. Frandsen 2025: inverse in runners. | H |
| Previous maximum volume caps the block at 1.25× | `PREVIOUS_MAX_VOLUME_HEADROOM` | Emig & Peltonen 2020: endurance index falls beyond the individual's seasonal load peak. Practitioner translation. | L–M |
| Novice runners: no quality in base, one per week after; 2.3× injury rate | novice quality cap | Videbæk 2015 meta-analysis: 17.8 vs 7.7 injuries per 1,000 h. | H |
| Previous injury doubles the adherence risk | `ADHERENCE_PRIOR_INJURY_MULTIPLIER` | Kemler 2021 HRR 1.9; Relph 2023 Couch-to-5k dropout OR 7.6. | H |
| No two hard endurance sessions on consecutive days | `QUALITY_ENDURANCE_SPACING_H` | Casado 2022 elite practice; Kluitenberg 2016 intensity density in novices. | L–M |

### 3.2 Intensity distribution and session design

| Rule | Evidence | Conf. |
|---|---|---|
| ≥75–80% of time easy; 1–2 hard sessions/week under 6 h/week, 3 only with volume and >2 years | Seiler 2010; Silva Oliveira 2024 (polarised vs pyramidal SMD 0.08 in trained/developmental); Muniz-Pumares 2025 (119,452 marathoners: the fastest ran more easy km, not more hard km). | M–H |
| Threshold-weighted weeks are acceptable at 3 h/week | Festa 2020, Muñoz 2014: no performance loss, less time. | L–M |
| Heavy (≥80%) lifting improves running economy 2–8%; light circuits do not | Llanos-Lagos 2024; Blagrove 2018; Berryman 2018. | H |
| Strides and hill sprints from the base phase | Barnes 2013 (RE +2.4%, 5k +2%). Strides themselves: consensus. | M / L |

### 3.3 Strength programming

| Rule | Constant | Evidence | Conf. |
|---|---|---|---|
| 3–6 hard sets per lift per week is the floor; 6–12 the working range | `STRENGTH_DOSE_*` | Androulakis-Korakakis 2020/2021; Ralston 2017 (≥10 vs ≤5 sets: +20–25% rate); Pelland 2026 (diminishing returns on strength). | M–H |
| Each lift ≥2×/week; secondary exposures at half weight | `SECONDARY_LIFT_*` | Grgic 2018 (frequency ES 0.74→1.08, volume-equated no effect); Pelland 2026 fractional sets. | H / M |
| 1–4 RIR, no failure on squat/deadlift | phase specs | Robinson 2024 (RIR slope on strength: CI contains zero); Grgic 2022; Refalo 2023. | H |
| Load band walks up within a phase; intensity rises ≤15% across a block | `STRENGTH_SUBBAND_WIDTH` | Moesgaard 2022 (undulation vs fixed: ES 0.31–0.61 in trained); Travis 2020. | H / M |
| Working max advances with the projection, capped at 8% | `WORKING_MAX_PROGRESSION_CAP` | Latella 2024 first-year rates; the SRI adaptive 1RM re-anchors on each regeneration. | M |
| Deload: sets −40%, +1 RIR, frequency kept; never a week off | `DELOAD_STRENGTH_*` | Bell 2023 Delphi / Bell 2024 survey (n=246, every 5.6 ± 2.3 weeks); Coleman 2024 (a week off cost strength). | L (cadence) / M (not a week off) |
| Taper: −41–60% volume, intensity held; last heavy deadlift 7–10 d out, squat ~7, bench 3–5 | `TAPER_FINAL_WEEK_INTENSITY_CEILING` | Travis 2020 review; Travis 2021 survey (n=364); Burke 2023. | H (practice) / M (prescription) |

### 3.4 Concurrent training

| Rule | Evidence | Conf. |
|---|---|---|
| Interference on lower-body strength in trained men with real running load; none on bench; none in women | Petré 2021 (trained ES −0.35; same-session −0.66; separated −0.10); Huiberts 2024 (men SMD −0.43, women +0.08); Schumann 2022 (pooled max-strength SMD −0.06, so no flat penalty). | H |
| Strength:endurance session ratio ≥2:1 in a strength-priority block; whole sessions move with the slider | Jones 2013 (3:1 matched strength-only, 1:1 did not); Wilson 2012 moderators. | M |
| Separation ≥6 h same day, ≥24 h heavy-lower before quality endurance (unchanged) | Robineau 2016; Sporer & Wenger 2003; Sale 1990. | M |
| Strength maintenance: 1 session/week, intensity held; endurance: 2/week, intensity held | Spiering 2021; Rønnestad 2011; Hickson 1985. | M–H |

### 3.5 Feasibility, response variability, adherence

| Rule | Constant | Evidence | Conf. |
|---|---|---|---|
| 12-week gain priors, mean ± SD by training age | `*_GAIN_PER_BLOCK`, `*_GAIN_SD_PER_BLOCK` | Strength: Ahtiainen 2016 (+21 ± 11.5%/21 wk untrained), Helms 2018 / Dorrell 2020 (trained, 8–14% squat), Latella 2020/2024 (7.5–12.5% first year competing, ≤4%/yr after). Endurance: HERITAGE (+15–19% VO2max ≈ 8–10% pace), Muñoz 2014, Festa 2020, Filipas 2022. | M–H |
| Observed SD, not noise-free SD, because the athlete experiences the total | — | Renwick 2024; Bonafiglia 2021. | H |
| Dose gate: non-response 69% at 60 min/wk, 40% at 120, 29% at 180, 0% at 240 | `ENDURANCE_DOSE_*` | Montero & Lundby 2017. | H (pattern) / M (numbers) |
| Noise floor: 5k TT 1–2%, 1RM 2–3% | `*_TEST_NOISE_FRACTION` | Zourdos 2016 daily-max series (2.4 ± 1.7%); 5k TT reliability studies. | M |
| Adherence ≈0.7 structured, lower for novices, prior injury, life load | `ADHERENCE_*` | STRRIDE (31% dropout, concentrated in ramp-in); Relph 2023; Conti 2026 (389,481 app users). | H / M |
| Stretch beyond +1 SD, multi-block beyond +2 SD, primary goal at the mean | `STRETCH_GOAL_SD`, `MULTI_BLOCK_GOAL_SD` | Locke & Latham; Bar-Eli 1997 (+20% beat +40%); Swann 2021 (open goals for novices); Kivetz 2006 goal gradient. | M |
| Multi-block gains flatten (exponent 0.85) | `MULTI_BLOCK_GAIN_EXPONENT` | Emig & Peltonen 2020 saturation; Latella first-year vs later rates. | M |
| Marathon exponent 1.10–1.15 unless >330 min/week | `EVENT_RIEGEL_K_*` | Vickers & Vertosick 2016 (Riegel under-predicts marathon by ≥10 min for half of recreational runners); Blythe & Király 2016 (164,746 runners, median exponent 1.12). | H |
| Trainability preserved to ~60; small penalty after | `AGE_GAIN_PENALTY_*` | Peterson 2010; Huang 2016; Skinner 2001. | H |
| The athlete's own measured rate is blended in at ≤0.3 weight, clamped to 0.5–2× the prior | `RESPONSE_*` | Individual response is real and large (HERITAGE: −2% to +40% on one programme; Hubal 2005: 0% to +250% 1RM across 585 people), so a prior that never updates ignores the best evidence about this person. But a single block's deviation is mostly noise (Renwick 2024; Bonafiglia 2021), and a 5k repeats to 1–2% against an expected trained gain of the same size — hence the small weight and the clamp. Weight 0.3 is the feasibility brief's rule 9. | H (response is real) / M (weight) |
| No menstrual-phase load multipliers | — | McNulty 2020 (trivial effects, 8% high-quality studies); Colenso-Semple 2023/2025. | H |
| Life stress and short sleep slow recovery | `LIFE_LOAD_*` | Bartholomew 2008; Stults-Kolehmainen 2014. Translation to a ramp multiplier is practitioner. | M / L |

---

## 4. What remains open, and what a generator cannot promise

1. **The individual response model measures the endpoints, not the whole curve.** `response.ts` takes a two-point slope across the athlete's stored diagnostic runs, because the series is short and unevenly spaced and a regression over four noisy points would imply a precision this data does not have. Submaximal markers — pace at a fixed heart rate, e1RM from logged working sets — are lower-noise than the 5k estimate and would let the weight rise above 0.3 sooner. That is the next refinement, not a gap in the rule.
2. **The RPE threshold rule ("2 above expected → reduce") is consensus, not evidence.** It is kept as a modifier. HRV-guided placement of hard sessions (Vesterinen 2016; Düking 2021: fewer non-responders, not a bigger mean) is the evidence-backed version and needs an HRV feed.
3. **No dataset ties goal ambition to plan abandonment — but this one is now being collected.** Migration 080 records the required-gain z-score, the goal level, the quoted probability and the delivered dose on every generation; the abandonment side is already derivable from the feedback and activity tables. No analysis ships with it, because an analysis over zero rows is worse than none. Revisit once a few hundred blocks have accumulated. Until then the stretch / multi-block grading rests on Bar-Eli 1997 and Swann 2021, which are about performance in short supervised experiments rather than about who quietly stops opening the app.
4. **"Both improved" evidence for lifters adding running is thin.** Prieto-González 2022 (runners adding lifting: squat +4.4% vs +8.7%) is the closest; the model says so in the joint-probability line.
5. **Deload cadence has no outcome evidence in either sport.** Every-fourth-week is kept because the injury literature favours planned recovery and no trial shows harm from a reduced week; the plan notes tag it as coaching consensus.
6. **HYROX's stations are still not programmed.** The running half now is, and it is the half the finish time tracks (Brandt & Ebel 2025: 51.2 min running against 32.8 min on stations; VO2max rho −0.71 and weekly endurance volume rho −0.68 predict the finish, grip and resistance-training volume do not). The sled, wall balls, burpee broad jumps, carries and lunges are muscular-endurance work this engine's barbell programming does not write, and the intake now says so in those words rather than implying coverage it does not have. Station programming is a build, not a constant.
7. **A named, qualified reviewer still has to countersign.** This document, like the assurance review before it, is the substance of a coach's review without the accountability of one. Condition 4 of the original sign-off stands.

**What no generator can honestly promise:** that a stated target will be reached. The model now says what is *expected*, how *wide* the band is, what the *probability* of the target is once dropout is included, and what the plan's own *dose* limits — and it builds toward the milestone it expects rather than the number the athlete typed. That is the most a plan can do, and it is more than most do.

---

## 5. Test coverage added

`src/lib/scoring/hpe/evidence-rules.test.ts` asserts each closed finding against the engine's own output: probabilistic feasibility with dose and interference; pace anchoring to the expected outcome; interval sessions containing their own reps; quality in every non-deload week at low volume; hard-rule zero including the new spacing rule; taper by event, monotone, with lift ceilings; spike rule and deload long run; single novice halving with a floor; previous-max cap; hours cap on the whole week; travel weeks; delivered minutes equal reported; within-phase strength progression; two-week lift frequency; deload sets and RIR; heavy flag from prescribed loads; slider moves whole sessions; feedback derived from the activity log; block continuation carrying lived weeks; the observed-response estimator refusing short, single-point and stale histories, reporting sub-noise movement as no signal, weighting a long observation above a short one and never past the ceiling, and blending without being taken over; the low-capacity swap replacing the day's hardest session at the same length and doing nothing on an easy day; HYROX resolving to an 8km running event, developing rather than maintaining endurance, building a duration-sized long run, earning quality work every non-deload week, and stating that the stations are not covered. All 479 tests across the HPE, component and API suites pass.
