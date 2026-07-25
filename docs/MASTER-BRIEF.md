# Split Index — Master Build Brief

**One document for Claude Code.** This consolidates the full scoring, prediction, analytics, monetization, and product spec for splitindex.co.uk. It supersedes all earlier draft docs. Where a real code file exists, it's named — use that file rather than reimplementing.

> **Guiding identity:** Split Index is a **number-focused data-analytics platform for gym and cardio**. Everything is precise, optimisable numbers. Free logging; the intelligence (analytics, predictions, breakdowns, extra scores) is premium. Male standards are calibrated; female and age factors are estimates to refine.

---

## 0. Canonical files (use these, ignore superseded drafts)

**Use:**
- `split-strength-engine.ts` — the complete, calibrated strength engine (SRI + adaptive 1RM + sex/age factors). This is the single source of truth for strength.
- The cardio + analytics + product specs in this brief (Sections 4–9).

**Ignore (superseded drafts):** `strength-relative-index.ts`, `-v2.ts`, `-v3.ts`, `strength.ts`, `one-rep-max.ts`, `adaptive-1rm-model.ts`, `strength-scoring-integration.ts`, and the various `SRI-*.md` calibration logs. Their content is already folded into `split-strength-engine.ts` and this brief. (Keep them for reference/audit trail, but don't wire them in.)

---

## 1. Architecture overview

Three scores, one platform:
- **Lab Index** — strength (from per-exercise SRI scores)
- **Engine Index** — cardio (from per-activity predicted-benchmark scores)
- **Split Index** — the hybrid headline (weighted blend; the leaderboard ranks by this)

Onboarding sets a **profile** (gym / cardio / hybrid) that picks which is the user's headline, and a **required public username** for the leaderboard.

**Universal tier bands** (both strength and cardio):
| Score | Tier |
|---|---|
| 1–249 | Beginner |
| 250–474 | Intermediate |
| 475–724 | Semi-Pro |
| 725–849 | Advanced |
| 850–924 | Elite |
| 925+ | World Class |

---

## 2. Strength scoring (`split-strength-engine.ts`)

The engine is built and calibrated. Key facts for wiring it in:

- **Entry point:** `scoreStrength(input)` scores one lift end-to-end. Pass the lift key, the user's **full logged history of that lift** (not just the latest set), **bodyweight-at-time-of-lift**, sex, age, and premium status.
- **Method:** each lift scored 0–1000 via the **Split Relative Index** — allometric bodyweight adjustment (`bodyweight^0.67`, so a heavier lifter at equal ratio scores higher), four calibration tiers, asymptotic world-record ceiling (999 ≈ unreachable).
- **Adaptive 1RM (premium):** estimates the user's 1RM from their whole history — quick to raise on a heavy PR, slow to lower on an easy set, HR of the estimate exposed as confidence. Free users get a single-set blended estimate.
- **Sex factor:** female standards derived from Legion/Henriques data (lower body 0.78, upper 0.60, pull 0.65 of male). A woman scores comparably to a man of equivalent relative strength. **Estimate — mark female scores beta until calibrated with real data.**
- **Age factor:** gentle Masters-style curve, flat 20–35, barely moving under 40, declining after. **Estimate — refine with published Masters coefficients later.**
- **Roll-up:** `labIndex()` blends per-lift scores weighted by confidence.
- **Calibration:** ~22 lifts calibrated to a real 83kg male lifter. Fixtures for the test suite are in the engine's implementation notes; assert each returns its pinned score ±3.
- **DOTS & IPF GL:** these are SEPARATE scores — see Section 3. Do not conflate.

Keep all constants (`PRIMARY_ANCHORS`, `ACCESSORY_MAP`, `SEX_FACTORS`, `ageFactor`, `ALLOMETRIC_EXP`) editable at the top of the file. Scoring + display only — don't change set-logging forms.

---

## 3. DOTS vs IPF GL — they are DIFFERENT (bug fix)

These must produce different numbers on different scales. If they currently match, it's a bug (both calling the same function, or GL never implemented).

- **DOTS** — polynomial, `Total × 500 / (a·bw⁴ + b·bw³ + c·bw² + d·bw + e)`. Elite ≈ 500+.
- **IPF GL** — exponential, `Total × 100 / (A − B·e^(−C·bw))`. National level ≈ 70–79. **Different scale by design.**

Verified: an 83kg male, 600kg total → ~405 DOTS but ~83 IPF GL.

```typescript
function dots(totalKg: number, bw: number, sex: 'male'|'female'): number {
  const c = sex === 'male'
    ? [-0.000001093, 0.0007391293, -0.1918759221, 24.0900756, -307.75076]
    : [-0.0000010706, 0.0005158568, -0.1126655495, 13.6175032, -57.96288];
  return totalKg * 500 / (c[0]*bw**4 + c[1]*bw**3 + c[2]*bw**2 + c[3]*bw + c[4]);
}
function ipfGL(totalKg: number, bw: number, sex: 'male'|'female'): number {
  // ⚠️ VERIFY against current IPF technical rules (powerlifting.sport) before ship;
  // equipment/event-specific and revised ~every 4 years.
  const p = sex === 'male'
    ? { A: 1199.72839, B: 1025.18162, C: 0.00921 }
    : { A: 610.32796,  B: 1045.59282, C: 0.03048 };
  return totalKg * 100 / (p.A - p.B * Math.exp(-p.C * bw));
}
```
UI: present as two distinct numbers with a tooltip — "DOTS and IPF GL use different scales; don't compare them to each other, only track each over time."

---

## 4. Cardio scoring — ported from the validated spreadsheet, amended

The user's spreadsheet method is preserved (it ranks sessions accurately). Two changes applied to run, row, and swim: the HR-efficiency exponent drops 2.5 → 1.8 and is **gated by pace** (`× (paceRef/pace)^SLOW_RUN_FACTOR`), so a slow effort at low HR no longer earns an unearned efficiency bonus.

Validated: a hard fast 5k barely moves; an easy low-HR jog drops from 9.18 → 7.54; a genuinely fast run at low HR (real fitness) stays high. `SLOW_RUN_FACTOR = 0.5` is the tunable severity dial (raise → harsher on slow runs).

The five weighted components (speed, HR-gated efficiency, endurance, hill, conditions) and the activity-specific references/weights are unchanged from the spreadsheet. The full amended TypeScript is in the cardio spec; keep references and weights as editable constants.

---

## 5. Memory-based predictions (the core cardio mechanism)

Each cardio activity keeps a **stored predicted benchmark time** per user, updated by every session **asymmetrically**:
- A faster-predicting session pulls the stored prediction down ~55% of the gap (proven fitness, trusted).
- A slower-predicting session nudges it only ~4% (easy days hold, never crater it).

**Riegel equivalent:** `predicted = time × (benchmarkDist / sessionDist)^1.06`, then HR-adjusted (`× (1 − clamp((refHR − avgHR)/450, −0.10, 0.10))`) so a lower-HR session yields a faster equivalent — **every session can contribute, even easy ones, if HR improved.**

**Validated (running):** hard 5k @18:00, then easy 10k @55:00 → prediction holds at **18:18**, not 26:00. Same 10k at 165 vs 170 HR → 24s faster prediction (lower HR rewarded).

**Benchmark per activity:** run → 5k, row → 2k, swim → 400m, cycle → 40k, ski → 1k. Each predicts a full **Riegel race ladder** (1.5k → marathon for running) for the Data Analytics tab.

### Score anchor tables (time → 0–1000)

**Methodology (splitindex_calibration_master.py):** run/row/cycle/swim are each calibrated against ONE internally-consistent source per activity — the Run/Row/Cycle/Swim Regimen sibling-site network, which all explicitly use the same percentile convention (Beginner=5th, Novice=20th, Intermediate=50th, Advanced=80th, Elite=95th). Never synthesized across sources with different definitions of "advanced" — an earlier draft did that and silently mis-scored a real time by mixing percentile targets from one source with time boundaries from another that didn't actually agree on what "Advanced" meant. The 99th-percentile anchor is 30% of the remaining gap from the 95th-percentile time toward the world record (or a separately-sourced elite/pro estimate for cycle/swim, which lack a WR column on the same source page — flagged lower confidence for that one anchor only). Every table below passes an automated monotonicity + internal-consistency audit (run the script to verify).

**Running (5k time) — Run Regimen, sex-specific, high confidence:**
| 5k (male) | Score (percentile) | | 5k (female) | Score (percentile) |
|---|---|---|---|---|
| 16:13.3 | 925 (99th) | | 18:58.1 | 925 (99th) |
| 17:40 | 850 (95th) | | 20:47 | 850 (95th) |
| 19:44 | 725 (80th) | | 23:04 | 725 (80th) |
| 22:31 | 475 (50th) | | 26:07 | 475 (50th) |
| 26:19 | 250 (20th) | | 30:08 | 250 (20th) |
| 31:29 | 125 (5th) | | 35:27 | 125 (5th) |

**Rowing (2k time) — Rowing Regimen, sex-specific, high confidence:**
| 2k (male) | Score (percentile) | | 2k (female) | Score (percentile) |
|---|---|---|---|---|
| 5:59.9 | 925 (99th) | | 6:52.2 | 925 (99th) |
| 6:10.2 | 850 (95th) | | 7:03.9 | 850 (95th) |
| 6:35.9 | 725 (80th) | | 7:44.0 | 725 (80th) |
| 7:04.6 | 475 (50th) | | 8:30.2 | 475 (50th) |
| 7:35.4 | 250 (20th) | | 9:21.0 | 250 (20th) |
| 8:06.9 | 125 (5th) | | 10:14.2 | 125 (5th) |

**Cycling (20k time) — Cycling Regimen, male only, female uses the 1.219 multiplier:**
| 20k | Score (percentile) |
|---|---|
| 30:33.8 | 925 (99th, separately-sourced elite/pro estimate) |
| 34:14 | 850 (95th) |
| 36:42 | 725 (80th) |
| 40:02 | 475 (50th) |
| 44:58 | 250 (20th) |
| 51:58 | 125 (5th) |

**Swimming (400m LCM) — Swimming Regimen, male only, female uses the 1.073 multiplier:**
| 400m | Score (percentile) |
|---|---|
| 4:29.5 | 925 (99th, separately-sourced WR estimate) |
| 4:50.7 | 850 (95th) |
| 5:04.0 | 725 (80th) |
| 5:17.1 | 475 (50th) |
| 5:43.5 | 250 (20th) |
| 6:10.1 | 125 (5th) |

**Walking (per-km pace)** — no equivalent 5-tier single source exists in that network or elsewhere found; kept as the earlier lighter-touch correction, lowest confidence alongside ski. **SkiErg** — no independent source either; still a pure derivation off the row curve, flagged for its steepness (925→~64 inside a 2-minute band, see PR notes).

Keep `RIEGEL_K`, `SLOW_RUN_FACTOR`, benchmark distances, HR ratios, and all anchor tables as editable constants.

---

## 5a. Structured interval/fartlek scoring — work-piece pace, not whole-session average

A logged **Interval** or **Fartlek** session previously scored identically to a steady run of the same total distance/duration — the whole-session average pace dilutes the hard reps down toward an easy effort and erases the very thing that makes it a quality session. `session_type` was captured but had zero effect on the score.

The log form now accepts an **optional** work/rest breakdown:
- **Interval:** reps × work distance × work time/rep + rest between reps (+ optional work-only avg HR).
- **Fartlek:** total "on" (hard-effort) distance + time for the session (+ optional on-effort avg HR).

When supplied, the benchmark-equivalent time is computed from the **work-piece pace**, rest-ratio converted to a race-equivalent, instead of the raw session average — then fed through the *same* Riegel + HR-bonus + personalization pipeline as every other session (§4–5), so it lands on the same anchor tables and the same memory system. Leaving the breakdown blank falls back to the original whole-session-average scoring exactly as before — this is additive, not a replacement.

**Rest-ratio conversion** (`lib/scoring/cardio/interval-scoring.ts`):
```typescript
equivPace = workPaceSecPerKm × (1 + BASE_OFFSET + REST_COEF × min(restSec/workSec, REST_CAP))
// BASE_OFFSET = 0.03, REST_COEF = 0.02, REST_CAP = 1.5
```
Harder rest (more recovery per unit of work) means the work pace alone overstates fitness relative to a continuous effort, so the conversion scales the equivalent pace slower to compensate. Fartlek resolves the same way once "on" distance/time are known, treating the remainder of the session as rest.

Work-only avg HR (when supplied) drives the HR bonus instead of the whole-session average, which blends work and rest and is a poor efficiency signal for structured intervals — this mirrors why TRIMP/volume bonuses still use the whole-session duration (real training load, not efficiency).

Keep `INTERVAL_BASE_OFFSET`, `INTERVAL_REST_COEF`, `INTERVAL_REST_CAP` as editable constants; recalibrate against real logged interval sessions the same way the anchor tables were calibrated.

---

## 6. Monetization — free logging, paywalled intelligence

Do **not** cap logging (that blocks the habit that creates value). Cap insight instead.

| Feature | Free | Premium |
|---|---|---|
| Logging (all activities/lifts) | ✅ | ✅ |
| Current headline scores | ✅ | ✅ |
| Leaderboard view + own rank/detail | ✅ | ✅ |
| Data Analytics page | 🔒 | ✅ |
| Trends over time (all graphs) | 🔒 | ✅ |
| Predictions & projections | 🔒 | ✅ |
| DOTS / IPF GL / breakdowns / extra scores | 🔒 | ✅ |
| Recovery / training load / PRs timeline | 🔒 | ✅ |
| Other users' leaderboard detail | 🔒 | ✅ |

Every 🔒 renders as a **blurred preview with a lock badge and upgrade CTA** — seeing the locked insight converts far better than hiding it. Gate at the API (never compute-and-hide on the client). Test levers: premium free-trial after ~10 logged sessions (experience trends on own data), annual discount, early "founder" lifetime tier.

---

## 7. Data Analytics page — numbers-first, champion-grade, beginner-safe

Everything premium. Design law: **anything that can be a number, is a number** — optimisable and trackable. Colour/words are garnish; the number is the dish. Every graph has an **ⓘ info button** with a plain-English explanation (What it is → Why it matters → How to read it → What to do), so beginners are guided without dumbing down the numbers.

**Panels:**
1. **Recovery / injury risk (numeric).** ACWR-based (7-day acute vs 28-day chronic load). Show: **Injury Risk Index /100**, **relative-risk ×**, raw **ACWR**, and an **optimal-load target** in the user's units. Model (tunable):
   ```typescript
   function injuryRisk(acwr: number) {
     let rr: number;
     if (acwr < 0.8) rr = 1.0 + (0.8 - acwr) * 0.6;
     else if (acwr <= 1.3) rr = 1.0;
     else if (acwr <= 1.5) rr = 1.0 + (acwr - 1.3) * 3.0;
     else rr = 1.6 + (acwr - 1.5) * 2.5;
     return { index: Math.min(95, Math.round(15 * rr)),
              relativeRisk: Math.round(rr*100)/100,
              zone: acwr<0.8?'Undertraining':acwr<=1.3?'Optimal':acwr<=1.5?'Caution':'Danger' };
   }
   ```
   Example readout: **"Injury Risk 32/100 · 2.1× baseline · ACWR 1.70 — keep this week under ~450 TRIMP (currently 610) to return to optimal."** Frame as "relative to your baseline," not an absolute medical probability.
2. **Score compilation + trends.** Every score (per-lift SRI, estimated 1RM, DOTS, IPF GL, Engine Index, race predictions, Split Index) with current value, 30/90-day trend arrow, all-time best, and a labelled sparkline.
3. **Projections.** Regression on last 30 days per score → 4–8 week projection with a numeric confidence band ("18:05 ±0:12, 82%"). "Log more to unlock" when data is thin.
4. **Training load & distance trends.** Weekly load (stacked by activity) with acute vs chronic overlay; weekly volume per activity. **Labelled axes + units throughout.**
5. **Consistency / streak / targets.** Adherence % vs target, sessions/week, streak (current + longest) as a calendar heatmap, user-set targets with % complete and projected days-to-target.
6. **Personal records.** Auto-detected PRs (fastest per distance, best 1RM per lift, best DOTS/GL, top SRI) on a timeline showing the exact margin each beat the previous by.
7. **Stored predictions.** Race ladder (1.5k→marathon) + adaptive 1RM predictions for core lifts, with each prediction's update history ("your 5k improved 12s after Tuesday's tempo run").

Real charting, labelled unit-bearing axes everywhere.

---

## 8. Optional HRV — precise, never required

Let users **optionally** add HRV data (from a wearable) to sharpen the load/recovery estimates — but **never make it essential**, since most users won't have it. The whole recovery system works fully without it (load-based). HRV is an accuracy upgrade layered on top.

- **UI:** an optional "Connect HRV / enter morning HRV" field in the recovery section, clearly marked optional. No onboarding step, no nag. Users without it see the full load-based numbers with no degraded experience.
- **When present:** blend HRV into the readiness number. A suppressed HRV (below the user's rolling baseline) raises the Injury Risk Index and lowers a "Readiness %"; a normal/high HRV confirms recovery. Show it as a second numeric input to the same readout:
  ```typescript
  // Optional HRV modifier on the load-based risk. hrvToday & hrvBaseline in ms (rMSSD).
  function hrvAdjustedRisk(loadRiskIndex: number, hrvToday?: number, hrvBaseline?: number): number {
    if (hrvToday == null || hrvBaseline == null) return loadRiskIndex; // no HRV: unchanged
    const ratio = hrvToday / hrvBaseline;            // <1 = suppressed = less recovered
    const modifier = ratio >= 1 ? -5 * (ratio - 1)   // above baseline: slightly safer
                                : 25 * (1 - ratio);   // below baseline: riskier, scaled
    return Math.max(0, Math.min(95, Math.round(loadRiskIndex + modifier)));
  }
  ```
- **Display:** when HRV is present, label the recovery readout "load + HRV (high precision)"; when absent, "load-based (add HRV for precision)". So users see exactly what they gain, without being blocked.
- Keep HRV constants editable; treat manual entry and future wearable import identically.

---

## 9. Onboarding, leaderboard, and removals

**Onboarding:**
- Profile: gym / cardio / hybrid (sets the headline score).
- **Required username** — unique, live-validated ("taken/available"), shown as publicly visible on the leaderboard. Profanity filter, max length, no real-name requirement. Optional leaderboard-visibility toggle in settings (default visible).
- No "connect watch" / social steps.

**Leaderboard:**
- Ranks by Split Index (toggle to Lab / Engine). Each row: rank, username, score, tier.
- **Free:** view all rows + own full detail. **Premium:** hover/tap another user → card with their main strength scores, core-lift 1RMs, and race predictions (blurred + lock badge for free users).
- Only usernames + scores are public; never raw data, bodyweight, or personal details. Compute/store ranks server-side (anti-tamper).

**Remove entirely (from UI + onboarding):** all Strava, Apple Health, Garmin, Google Fit integrations and "connect your watch" steps. Logging is **manual + file import only** for now. Keep the architecture clean so integrations can return later, but nothing about them is visible currently.

---

## 10. Build sequencing

1. Wire `split-strength-engine.ts`; fix DOTS/IPF GL (§3); verify strength fixtures.
2. Cardio scoring + memory predictions (§4–5); calibrate run + row (done), mark swim/cycle/ski provisional.
3. Onboarding (profile + username), remove social integrations (§9).
4. Monetization gating (§6) — API-level, blurred previews.
5. Data Analytics page (§7) numbers-first, with ⓘ explanations; optional HRV (§8).
6. Leaderboard (§9) with premium hover detail.

Throughout: keep all scoring/factor constants editable and named; scoring + display only, don't disturb logging forms; mark female, age, and non-run/row cardio scores as provisional until calibrated with real data.
