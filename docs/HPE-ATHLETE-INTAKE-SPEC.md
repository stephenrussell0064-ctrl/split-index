# Hybrid Plan Engine — Athlete Intake Specification
## Every input variable the engine needs, how it is asked, and what happens when it is missing

**Purpose:** this is the contract between the onboarding UI and the plan generator. If a field is not in this document, the engine must not depend on it. If a field is here and missing at generation time, the behaviour in the *Missing* column is mandatory — the engine never silently guesses.

**Design rules for the intake flow:**
1. **Nothing is asked twice.** Anything Split Index already holds is pre-filled and shown for confirmation, never re-entered. Roughly 60% of these fields fall into that category, which is the reason this product is buildable at all.
2. **Progressive disclosure.** Section A (safety) and Section B (goal) are mandatory and short. Sections C–H are progressively revealed and can be skipped with documented degradation.
3. **No free text drives logic.** Free text is captured for the user's own notes only.
4. **Every question states why it is asked.** A one-line "why we ask" under each field measurably improves completion and is the difference between an intake and an interrogation.

---

## Section A — Safety and eligibility (mandatory, blocking)

Asked first, before goals. A user who blocks here should never see a goal-setting screen.

| Field | Question as shown | Type | Validation | Missing | Consumed by |
|---|---|---|---|---|---|
| `age` | How old are you? | int | 16–90 | **Block** | Safety, HR max, strength age factor |
| `under_18` | derived from `age` | bool | — | — | Safety (blocks) |
| `parq_positive` | Has a doctor ever said you should only do physical activity supervised by a medical professional? | bool | — | **Block** | Safety (blocks) |
| `chest_pain_on_exertion` | Do you get chest pain, dizziness or unusual breathlessness during exercise? | bool | — | **Block** | Safety (blocks) |
| `current_injury_limiting` | Do you currently have an injury or pain that changes how you train? | bool | — | **Block** | Safety (blocks + physio referral) |
| `injury_last_12_weeks` | Have you had an injury in the last 12 weeks that stopped you training for more than a week? | bool | — | Assume true (conservative) | Halves volume ramp |
| `injury_sites` | Where? (shown only if yes) | multi-select: lower back, knee, hip, hamstring, calf, achilles, foot, shoulder, elbow, wrist, other | — | — | Exercise substitution rules |
| `surgery_last_6_months` | Any surgery in the last 6 months? | bool | — | Assume true | Warning + clearance prompt |
| `pregnant_or_postpartum_12wk` | Are you pregnant or within 12 weeks of giving birth? (shown if sex = female) | bool | — | **Block** | Safety (blocks) |
| `medication_affecting_hr` | Do you take any medication that affects your heart rate (e.g. beta blockers)? | bool | — | Assume false, warn | Switches prescription from HR to RPE and pace |
| `lea_1` | In the last 3 months, have you deliberately restricted food to change your weight or performance? | bool | — | Assume true | LEA screen |
| `lea_2` | Do you often train in a fasted or under-fuelled state? | bool | — | Assume true | LEA screen |
| `lea_3` | Have you lost more than 5% of your bodyweight in the last 3 months without intending to? | bool | — | Assume true | LEA screen |
| `lea_4` | Have you had a stress fracture or bone stress injury in the last 2 years? | bool | — | Assume true | LEA screen |
| `lea_5` | (female) Have your periods been absent or irregular for 3+ months, other than from contraception? | bool | — | Assume true | LEA screen |

**LEA scoring:** 0 positives → proceed normally. 1 → proceed, bodyweight guidance suppressed, fuelling reminders shown. ≥2 → **no plan generated**, referral offered to a registered sports dietitian, and to the National Alliance for Eating Disorders helpline if the user wants support. The engine never produces calorie targets, macro splits or rate-of-loss plans under any configuration.

---

## Section B — The goal (mandatory)

| Field | Question as shown | Type | Validation | Missing | Consumed by |
|---|---|---|---|---|---|
| `event_date` | When is your event? | date | 4–52 weeks out | **Block** | Macrocycle length |
| `weeks_out` | derived | int | 4–52 | — | All stages |
| `events` | What are you competing in? | multi-select: 5k, 10k, half, marathon, 2k row, powerlifting meet, strongman, HYROX, other | ≥1 | **Block** | Which engines are loaded |
| `same_day` | Are these on the same day? | bool | shown if ≥2 events | default false | Stage F, joint taper |
| `inter_event_gap_h` | Roughly how many hours between them? | float | 0.5–14 | default 4.0 | Stage F recovery model |
| `event_order_known` | Is the order already fixed by the organisers? | bool | — | default false | Suppresses Stage F if fixed |
| `target_5k_s` | What time are you aiming for? | duration | 12:00–45:00 | Optional → domain set to *maintain* | Stage A, Stage B |
| `target_total_kg` | What total are you aiming for? | float | > current × 0.8 | Optional → domain set to *maintain* | Stage A, Stage B |
| `priority` | If you could only hit one of these, which matters more? (slider, 5 detents) | 0.0–1.0 | — | default 0.5 | Stage A allocation, Stage F order |
| `weight_class_kg` | Are you lifting in a weight class? | float or null | IPF classes | Optional | Safety (cut refusal), frontier framing |
| `intends_weight_cut` | Are you planning to cut weight for weigh-in? | bool | shown if weight class set | Assume false | **Blocks if same-day endurance race** |
| `federation` | Which federation? | select | — | Optional | Attempt rules, weigh-in timing, equipment |

**Open product decision D2 stands:** whether `priority` is a user-set slider or derived from the goal gaps. My recommendation is a slider that is *pre-set* from the goal gap and can be moved — it anchors the athlete on the honest answer while leaving them agency.

---

## Section C — Current strength (pre-filled from the SRI engine)

| Field | Question as shown | Type | Validation | Missing | Consumed by |
|---|---|---|---|---|---|
| `one_rm_squat` | Confirm your current squat 1RM | float kg | 20–500 | Estimate from logged sets via Epley; if no history, **prompt for a 3–5RM test week** | Load prescription, Stage A |
| `one_rm_bench` | Confirm your current bench 1RM | float kg | 20–350 | as above | as above |
| `one_rm_deadlift` | Confirm your current deadlift 1RM | float kg | 20–500 | as above | as above |
| `1rm_confidence` | derived from the adaptive engine | 0–1 | — | — | Widens prescribed load bands when low |
| `lift_variants` | Squat stance / bench grip / deadlift stance | select | — | default conventional | Specificity rules in the taper |
| `equipment_used` | Belt / sleeves / knee wraps / raw | multi | — | default raw + belt | Attempt selection, load prescription |
| `strength_training_years` | How long have you trained the barbell lifts consistently? | float | 0–40 | **Assume 0 → blocks peaking plan** | Safety gate, gain-rate constants |
| `current_strength_sessions_per_week` | How many lifting sessions are you doing now? | int | 0–10 | Derive from logs; else 0 | On-ramp |
| `recent_meet` | Have you competed before? Best total and date. | float + date | — | Optional | Attempt selection confidence |

---

## Section D — Current endurance (pre-filled from the prediction engine)

| Field | Question as shown | Type | Validation | Missing | Consumed by |
|---|---|---|---|---|---|
| `predicted_5k_s` | Your current predicted 5k | duration | 12:00–60:00 | Derive from logged history; if none, **prompt for a time trial or a recent race** | Stage A, all pace bands |
| `prediction_confidence` | derived | 0–1 | — | — | Widens prescribed pace bands |
| `recent_race` | Most recent race or time trial: distance, time, date | — | within 12 months | Optional | Seeds the prediction |
| `current_run_min_per_week` | How many minutes of running are you doing in a typical week right now? | int | 0–800 | Derive from 8-week log mean; else **block** | **On-ramp anchor — the most important field in this document** |
| `longest_recent_run_min` | Longest single run in the last month | int | 0–300 | default = current weekly ÷ 3 | Long-run starting length |
| `endurance_training_years` | How long have you been running consistently? | float | 0–40 | Assume 0 → halves ramp, caps targets | Gain-rate constants, ramp rate |
| `primary_modality` | Main cardio: run / row / bike / swim / ski | select | — | default run | Which prediction curve is used |
| `substitution_ok` | Happy to do some easy volume on a bike or rower to reduce impact? | bool | — | default true | Modality substitution in Stage D |
| `surface_access` | Track / treadmill / road / trail | multi | — | default road | Interval session format |

**Why `current_run_min_per_week` is called out:** it is the field that prevents the single most common injury pathway in generated plans. If it cannot be derived from logs and the user will not answer it, the engine must refuse rather than assume. That is a deliberate, defensible refusal.

---

## Section E — Heart rate and physiology

| Field | Question as shown | Type | Validation | Missing | Consumed by |
|---|---|---|---|---|---|
| `resting_hr` | Resting heart rate (measured on waking) | int | 30–100 | default 60, flagged as assumed | Karvonen zones |
| `max_hr_known` | Do you know your max heart rate from a race or hard effort? | bool | — | default false | Zone derivation |
| `max_hr` | Max heart rate | int | 140–220 | Tanaka `208 − 0.7 × age`, flagged as estimated | Karvonen zones |
| `hr_runs_high` | Does your heart rate tend to run high compared to others at the same effort? | bool | — | default false | Widens personal HR weighting sooner |
| `hrv_available` | Do you track HRV? | bool | — | default false | Optional readiness modifier, **never required** |
| `bodyweight_kg` | Current bodyweight | float | 35–200 | **Block** | Allometric strength, frontier, load prescription |
| `height_cm` | Height | int | 130–220 | **Block** | BMI floor for the LEA safeguard |
| `sex` | Sex (used for scoring curves) | select | — | **Block** | Sex factors already in the scoring engine |

Note: where `medication_affecting_hr` is true, all HR-based prescription is replaced by pace and RPE. Prescribing zones to someone on beta blockers is a straightforward way to produce a useless plan.

---

## Section F — Availability (drives the scheduler directly)

| Field | Question as shown | Type | Validation | Missing | Consumed by |
|---|---|---|---|---|---|
| `days_available` | Which days can you train? | multi-select Mon–Sun | ≥3 | **Block if <3** | Hard scheduler constraint |
| `two_a_days_possible` | Can you train twice on some days? | bool | — | default false | Enables same-day pairs |
| `two_a_day_days` | Which days? | multi-select | subset of above | default = all available | Scheduler candidates |
| `am_time`, `pm_time` | Roughly what times? | time | — | defaults 07:00 / 18:00 | **Separation rule — the 6h gap is computed from these, not assumed** |
| `max_sessions_per_week` | Most sessions you'd realistically do in a week | int | 3–12 | default 6 | Session-set cap |
| `max_hours_per_week` | Most hours per week | float | 2–20 | default 8 | Volume cap, overrides ramp |
| `max_session_min` | Longest single session you can fit | int | 20–240 | default 90 | Long-run and volume-day caps |
| `gym_access_days` | Days you can get to a barbell | multi-select | — | default = days available | Strength placement constraint |
| `travel_weeks` | Any weeks you'll be away? | multi-select of week numbers | — | none | Auto-deload or maintenance week |

The `am_time`/`pm_time` fields matter more than they look. The 6-hour separation rule is the highest-leverage scheduling constraint in the whole evidence base, and an athlete training at 06:00 and 12:00 has a 6-hour gap while one training at 12:00 and 17:00 does not. Assuming default clock times silently breaks the constraint the engine claims to enforce.

---

## Section G — Recovery and life load

| Field | Question as shown | Type | Validation | Missing | Consumed by |
|---|---|---|---|---|---|
| `sleep_hours_typical` | Typical nightly sleep | float | 3–12 | default 7 | Volume ramp modifier |
| `shift_work` | Do you work shifts or nights? | bool | — | default false | Disables fixed AM/PM assumptions |
| `job_physicality` | Is your job sedentary, on-your-feet, or physical? | select | — | default sedentary | Chronic-load seed adjustment |
| `life_stress_now` | How would you rate non-training stress right now? | 1–5 | — | default 3 | Starting ramp rate |
| `previous_max_volume` | Highest weekly running volume you've ever sustained for a month | int min | — | Optional | Ramp ceiling |

These are the "coach asks how you're doing" fields. Individually weak; collectively they are the difference between a plan that fits a life and one that fits a spreadsheet. Keep them optional and short.

---

## Section H — Preferences

| Field | Question as shown | Type | Missing | Consumed by |
|---|---|---|---|---|
| `disliked_exercises` | Anything you'd rather not do? | multi-select | none | Accessory substitution |
| `preferred_long_day` | Best day for your longest session | select | Sunday | Soft scheduler preference |
| `preferred_rest_day` | Preferred rest day | select | none | Soft scheduler preference |
| `units` | kg/lb, km/miles | select | metric | Display only |
| `notify_style` | Daily session reminder? | select | off | Adherence |

---

## Section I — Auto-derived, never asked

Populated from existing Split Index engines at generation time. Listed here so the build brief knows the interfaces.

| Field | Source | Used for |
|---|---|---|
| Adaptive per-lift 1RM + confidence | SRI engine | Load prescription |
| Predicted 5k / 2k / benchmark times | Two-tier race prediction model | Pace bands, Stage A |
| Personalised HR zones | Karvonen + learned per-type baselines | HR bands |
| Chronic load (28d rolling) | Session history | On-ramp seed, ACWR denominator |
| Current ACWR + Risk Index | Existing injury-risk engine | ACWR enforcement, QC-4 |
| Split Index / Lab / Engine scores | Scoring engine | Goal framing, tier-relative targets |
| Interference/synergy history | Interference engine | Priority pre-set, modality substitution |
| Session-type distribution (last 90d) | Log history | Validating stated current volume |

**Cross-check rule:** where a stated field contradicts the logs — the athlete says they run 200 min/week and the logs show 60 — the engine uses the *lower* value and surfaces the discrepancy. Optimistic self-report is the norm and it is the on-ramp anchor, so it must be conservative.

---

## Minimum viable intake

If you want the shortest flow that still produces a defensible plan, it is these fourteen fields. Everything else can default or derive.

Age · sex · bodyweight · height · the five LEA questions plus PAR-Q and current injury · event date · events · target(s) · priority · current 1RMs (or a test week) · current predicted 5k (or a time trial) · **current weekly running minutes** · days available and session times · max sessions and hours per week.

Anything shorter than that is not an individualised plan, it is a template with the user's name on it.
