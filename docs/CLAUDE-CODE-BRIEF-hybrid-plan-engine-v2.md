# CLAUDE CODE BRIEF — Hybrid Plan Engine (HPE) — **Rev 2**
## Supersedes `CLAUDE-CODE-BRIEF-hybrid-plan-engine.md`. Ten work packages.

**What changed in Rev 2 and why.** Rev 1 built a plan generator that was individualised by *questionnaire* — it asked the athlete their goals and availability and produced a structurally correct plan. It was not individualised by *history*. Two athletes with the same 5k time, the same goal and the same free days got the same plan, which is not what this product is for and is not what Split Index's data advantage buys.

Rev 2 inserts **WP0 — the Athlete Diagnostic** ahead of everything else. It reads logged Split Index history, derives what the athlete's aerobic base and strength profile actually *are*, decides what they specifically need to work on, and emits an **emphasis vector** that drives session selection. Every downstream prescription — distance, split, heart rate, load, rep range — is then resolved from that athlete's own data rather than from population multipliers.

**Read the current Split Index codebase before writing anything.** This feature consumes four engines that already exist (adaptive 1RM, two-tier race prediction, personalised Karvonen HR, ACWR Risk Index) plus the raw session logs. Do not reimplement, refactor or revert any of them.

**Normative companion artefacts:**
- `hpe_diagnostics.py` — reference implementation of WP0. **New in Rev 2.**
- `hybrid_plan_engine_v2.py` — reference implementation of WP3–WP6.
- `HPE-ATHLETE-INTAKE-SPEC.md` — input fields, validation, missing-data behaviour.
- `HPE-COACH-ASSURANCE-REVIEW.md` — findings F1–F18; F15–F18 are open and in scope for WP8.

Where a brief and a reference implementation disagree, **the reference implementation wins** and the discrepancy is raised as an issue.

**Non-negotiables, unchanged from Rev 1 plus two additions:**
1. Every training-logic constant lives in one versioned module, `hpe/constants.ts`. No numeric literal governing training logic elsewhere.
2. Plan generation is deterministic and stamped with the constants version.
3. The safety screen runs first, can block, and is not bypassable.
4. Zero hard-rule violations, asserted by property tests over randomised inputs.
5. No calorie, macro or rate-of-loss output under any configuration.
6. **New:** every derived metric carries a confidence and a data-sufficiency tier. Nothing is prescribed from an extrapolation outside the range the athlete's own data covers.
7. **New:** every session in a generated plan is traceable to a named diagnostic finding. If the engine cannot say *why* this athlete is doing this session, it does not prescribe it.

---

## WP0 — Athlete Diagnostic (NEW, build this first)

Port `hpe_diagnostics.py`. This is the module that makes the product individual.

### 0a. Ingest
Read from existing tables: run/row/bike sessions (date, distance, duration, avg and max HR, per-km splits, per-km HR, cadence, elevation), lift sets (date, lift, load, reps, RIR/RPE), bodyweight history, resting HR history. Flag maximal efforts (races and time trials) either from user tagging or from a pace-outlier rule.

### 0b. Derive — aerobic
| Metric | Method | What it tells you |
|---|---|---|
| Weekly volume (km and min) | 8–12 week mean | The on-ramp anchor |
| Longest run | 12-week max | Long-run starting length |
| **Personal Riegel exponent `k`** | log-log regression across all maximal efforts | Fatigue resistance. **This is the single highest-value derived metric in the module** |
| Aerobic decoupling | pace:HR ratio, 2nd half vs 1st half of long runs | Whether the base supports the duration attempted |
| **HR-vs-pace regression** | linear fit of HR against speed on submaximal runs, **with its valid speed range stored** | Lets you prescribe an actual bpm band instead of a percentage |
| Easy-running fraction | share of logged time **below the easy HR ceiling**, pace only as fallback | Detects the grey-zone trap |
| **Easy-pace band** | slowest of three independent anchors (see note 1 below) | The single most-used number in the whole plan |
| Runs inside the easy band | count of logged runs below the easy HR ceiling | Zero means easy pace cannot be confirmed from their own data |
| Quality exposure | count of logged sessions faster than the threshold cutoff | Detects the "all easy, no quality" pattern |
| Volume adequacy | actual weekly minutes ÷ typical requirement for that 5k level | Whether volume or intensity is the lever |
| Speed reserve | **anaerobic speed reserve: maximal sprint speed − maximal aerobic speed.** Returns null when no short maximal effort is logged | Neuromuscular headroom above aerobic ceiling |

**Critical implementation note 0 — `speed_reserve` was a tautology in the Rev 2 reference and must be rebuilt.** The reference computed it from `threshold_pace` and `vo2_pace`, both fixed multiples of predicted 5k pace (1.07 and 1.09/0.96). It therefore evaluated to 0.1146 for every athlete, below `SPEED_RESERVE_LOW`, so the low-speed-reserve finding and its ×1.6 neuromuscular and ×1.3 vo2max multipliers fired universally. On the reference athlete this inflated `neuromuscular` from 0.077 to 0.116 — a 50% relative distortion — and pulled `aerobic_base` down from 0.532 to 0.500, taking emphasis away from precisely the quality that athlete was diagnosed as lacking.

Rebuild it as genuine **anaerobic speed reserve**: maximal sprint speed (from the fastest logged short maximal segment — a flat-out 200m or 400m, or peak GPS speed) minus maximal aerobic speed (from a maximal aerobic effort). Where no short maximal effort exists in the history, `speed_reserve` returns **null**, the finding does not fire, no multiplier is applied, and the gap is added to `data_gaps` as an unlock prompt: *"a flat-out 400m unlocks your speed-reserve diagnosis."* This is the third application of the same rule as the bodyweight frontier and the HR regression — **bound every derived metric to the data that supports it, or refuse to derive it.**

Note that the athlete's own `k` already carries the speed-versus-endurance balance. Anaerobic speed reserve is genuinely different information — neuromuscular top end rather than fatigue resistance — so the two must not be allowed to double-count. Where both are available, `k` governs the aerobic/threshold split and speed reserve governs only the `neuromuscular` weight.

**Critical implementation note 1 — easy pace must not be derived from 5k pace.** The standard multiplier (5k pace × 1.24–1.34) assumes the 5k time is supported by a matching aerobic base. For an athlete whose own diagnostic says it is not — high fatigue-resistance exponent, low volume adequacy — that assumption inflates easy pace by 25–35 s/km, which is precisely the grey-zone error the diagnostic elsewhere warns about. The module was contradicting itself.

`easy_pace_band()` therefore computes three independent anchors and prescribes **the slowest**:
1. 5k pace × 1.24–1.34 (the naive anchor, kept for comparison only)
2. A 90-minute maximal effort derived using the athlete's **own** `k`, × 1.16–1.28
3. The athlete's own HR-vs-pace regression **inverted at a physiological easy heart rate** (62–72% HR reserve)

On the reference athlete these give 4:35–4:57, 4:59–5:30 and 4:57–5:28 respectively. Anchors 2 and 3 are derived by completely different routes and land 2 s/km apart; anchor 1 is 23 s/km faster than both and is the one to distrust. Where the anchors disagree by more than 15 s/km the engine must emit a finding explaining which governs and why.

**The easy heart-rate ceiling comes from HR reserve, never from observed behaviour.** Fitting the ceiling to how hard the athlete currently runs launders an existing bad habit into a prescription.

**Critical implementation note 2 — classify intensity by heart rate, not pace.** Pace-based classification reported the reference athlete as 100% easy and "well polarised" while their logged heart rates put only 31% of running inside the easy band. Pace cannot see the grey zone, which is a large part of why the grey zone persists. `hr_intensity_distribution()` is HR-primary with pace as fallback, and where the two disagree by more than 25 percentage points the engine emits a finding naming the discrepancy.

**Critical implementation note 3 — the HR-vs-pace regression is valid only across the speed range it was fitted on.** My first run of the reference implementation extrapolated an easy-run fit to interval pace and prescribed a heart rate of 205–214 for an athlete with a measured max of 201. `predict_hr_at_pace()` must return null outside the fitted range and fall back to HR reserve, labelling the source honestly in the prescription string. This is the same class of error as an unbounded bodyweight frontier: **bound every extrapolation or refuse to make it.**

### 0c. Derive — strength
| Metric | Method | What it tells you |
|---|---|---|
| Adaptive 1RM per lift | existing SRI engine | Load prescription base |
| **Rep-profile gap** | e1RM implied by 6–12 rep sets vs e1RM implied by 1–3 rep sets | Whether they need heavy singles or more volume. Positive gap = the muscle is there but the neural expression is not → heavy low-rep work. Negative = neurally efficient but under-built → hypertrophy accumulation |
| Lift ratios vs norms | bench and deadlift as multiples of squat | Which lift limits the total |
| Progression rate per lift | e1RM trend over 12 weeks | Stalled lifts get a variation block before returning to the competition lift |
| Volume-load trend | weekly tonnage | Cross-check on stated current training |

### 0d. Synthesise — the emphasis vector
Seven weights summing to 1.0: `aerobic_base`, `threshold`, `vo2max_speed`, `neuromuscular`, `maximal_strength`, `strength_endurance`, `weak_lift`. Each diagnostic finding applies a named multiplier; the goal priority tilts the whole vector; a floor of 0.03 ensures nothing is fully abandoned.

Every multiplier must emit a plain-English finding string. Those strings are the product — they are what the athlete reads, and they are what makes the plan defensible.

### 0e. Data-sufficiency tiers
| Tier | Requires | Behaviour |
|---|---|---|
| 3 | 24+ runs, 12+ weeks, 2+ maximal efforts, 40+ lift sets | Full diagnosis, 90% confidence, narrow prescribed bands |
| 2 | 12+ runs, 8+ weeks, 1 maximal effort, 20+ sets | Personal `k` unavailable, population 1.06 used, wider bands |
| 1 | 4+ runs, 3+ weeks, 6+ sets | Volume anchor only, conservative on-ramp, prescribe by pace and RPE |
| 0 | anything less | **No plan.** Offer a two-week baseline block plus a time trial and a 3–5RM test, then re-run |

The engine must surface the specific gap: *"a second maximal effort at a different distance unlocks your personal fatigue-resistance model"* is a data-collection prompt that also happens to be a retention mechanic.

**Accept when:** running the reference data reproduces tier 2, `k = 1.103`, volume adequacy 42%, limiter = endurance, an easy band of 4:59–5:30/km at HR 141–155 governed by the long-effort anchor, and **seven** findings (the eighth in `diagnostics_output.txt` is the spurious speed-reserve finding and must no longer fire — the reference athlete has no logged short maximal effort, so speed reserve is null). Property test: 500 randomised histories produce emphasis vectors summing to 1.0 ± 0.001 with no weight below the floor, and **no prescribed heart rate exceeds the athlete's max HR**.

---

## WP1–WP5 — unchanged from Rev 1
Constants and schema; intake flow; safety screen; feasibility and develop/maintain; macrocycle with on-ramp, deloads and ACWR enforcement. See Rev 1 for acceptance criteria.

Two schema additions for Rev 2: `hpe_athlete_profile` (one row per diagnostic run, storing every derived metric, the emphasis vector, tier, confidence and findings) and a `finding_id` foreign key on `hpe_sessions`.

---

## WP6 — Session selection driven by the emphasis vector (REWRITTEN)

Rev 1 chose sessions from fixed per-phase counts. Rev 2 allocates the week's available sessions **proportionally to the emphasis vector**, then applies the phase's intensity-distribution targets and the hard interference constraints as filters.

Allocation order:
1. Reserve the mandatory minimums — one long run, the minimum maintenance dose for any domain in maintain mode.
2. Allocate remaining slots proportionally to emphasis, largest remainder first.
3. Apply hard caps: ≤3 quality endurance sessions, one heavy lower-body day once loads exceed 82% 1RM.
4. Reconcile against the phase TID targets; where emphasis and phase conflict, **phase wins in specific/peak/taper, emphasis wins in base/build**.

Worked example from the reference data — an endurance-limited athlete on 42% of typical volume with no logged quality work gets `aerobic_base` 0.36, `threshold` 0.20, `neuromuscular` 0.15, and therefore a week weighted toward easy volume plus one threshold session and strides, *not* the interval-heavy week a speed-limited athlete with the same 5k time would receive. That difference is the entire product claim.

**Accept when:** two synthetic athletes with identical 5k times, goals and availability but opposite `k` values receive materially different weekly session sets, demonstrated in a test.

---

## WP7 — Prescription resolution (REWRITTEN)

Every session emits distance, split and heart rate, all resolved from the athlete's own data.

- **Distance and duration:** both, always. `9.4km in 45min` beats either alone.
- **Split:** a band in mm:ss/km derived from the athlete's predicted 5k pace using their own `k`, plus per-rep target times for interval sessions (`6 x 1000m in 3:38 each`).
- **Heart rate:** from the athlete's own HR-vs-pace regression where the pace falls inside the fitted range; from HR reserve otherwise; **always clamped to their measured or estimated max**; and the source is stated in the prescription string so the athlete knows how much to trust it.
- **Easy runs carry an upper HR bound stated as the primary instruction**, because the diagnostic's most common finding is easy running done too hard.
- **Lifts:** load in kg and %1RM, sets, rep range, RIR, plus the variation where a lift is stalled.
- **Cadence:** captured and reported as a trend, never prescribed. The evidence for imposing a cadence target is weak and individual optima vary widely; a step change in cadence is a plausible injury pathway. Report it; do not coach it.

**Accept when:** every session string contains a distance, a pace band and either an HR band with a stated source or an explicit "HR not the target" note. Regression test: no prescribed HR exceeds max HR.

---

## WP8 — Close assurance findings F15–F18
Unchanged from Rev 1's WP7. Quality-session progression across the block; autoregulation from logged feedback; low-capacity day flagging; attempt selection and race pacing.

**Rev 2 addition:** the diagnostic re-runs every four weeks against accumulating data. If the emphasis vector shifts by more than 0.10 on any dimension, the remaining macrocycle is regenerated and the athlete is shown what changed and why. This is what closes the loop between "the plan adapts" and "the plan adapts *for a reason you can read*."

---

## WP9 — Plan UI, explainer, event day
Unchanged, plus a **diagnostic report screen**: the derived metrics, the emphasis vector as a bar chart, and the findings list. This screen is the strongest single artefact in the product — it is the thing no competitor can produce without both data streams, and it is the natural share and screenshot moment.

---

## WP10 — Monitoring, kill switch, rollout
Unchanged from Rev 1's WP9, plus: distribution of data-sufficiency tiers across the user base (tells you whether the diagnostic is reaching anyone), and emphasis-vector drift over time.

---

## Test matrix additions for Rev 2

| Class | Test | Threshold |
|---|---|---|
| Diagnostic | Reference data reproduces k=1.103, tier 2, endurance limiter | exact |
| Diagnostic | Emphasis vectors sum to 1.0, no weight below floor, 500 histories | 100% |
| Safety | **No prescribed HR exceeds max HR**, 500 histories | 0 breaches |
| Prescription | Easy pace is never faster than the slowest of the three anchors | 100% |
| Prescription | Easy HR ceiling never exceeds 72% HR reserve | 100% |
| Individualisation | `speed_reserve` varies across 500 randomised histories and is null where no short maximal effort exists | no constant value |
| Individualisation | No finding fires for 100% of randomised athletes | 0 universal findings |
| Safety | No HR prescribed from outside the fitted regression range without fallback labelling | 100% |
| Individualisation | Opposite-`k` athletes get different session sets | pass |
| Sufficiency | Tier 0 returns no plan and offers a baseline block | pass |
| Traceability | Every session maps to a finding_id | 100% |

---

## Paste-ready Claude Code line

```
Read the current Split Index codebase first, then build the Hybrid Plan Engine per
CLAUDE-CODE-BRIEF-hybrid-plan-engine-v2.md. Behaviour is defined by the reference
implementations hpe_diagnostics.py (WP0) and hybrid_plan_engine_v2.py (WP1-WP7);
where a reference file and the brief disagree, the reference wins and you raise the
discrepancy rather than choosing.

This commit: WP0 only - the Athlete Diagnostic. Ingest logged run and lift history,
derive the aerobic and strength metrics listed in the brief, emit the seven-weight
emphasis vector with a plain-English finding string behind every multiplier, and
assign a data-sufficiency tier. Store the result in a new hpe_athlete_profile table.

Hard requirements across this whole project: every training-logic constant lives in a
single versioned module with provenance tags and no numeric literal governing training
logic appears anywhere else; generation is deterministic and stamped with the constants
version; the safety screen runs first and is not bypassable; no prescribed heart rate
may exceed the athlete's max HR and no metric may be extrapolated outside the range the
athlete's own data covers - return null and fall back with a labelled source instead;
every prescribed session must be traceable to a named diagnostic finding; no calorie,
macro or rate-of-loss output under any configuration.

Consume the existing SRI adaptive-1RM, race-prediction, personalised-HR and ACWR Risk
Index engines through thin adapters. Do not reimplement, refactor or revert them.
```

Then one commit per work package, WP1 through WP10, swapping the second paragraph for that package's scope and acceptance criteria.
