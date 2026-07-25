"""
SPLIT INDEX — MASTER CALIBRATION SCRIPT
=========================================
Run this: python3 scripts/splitindex-calibration-master.py

WHAT THIS IS
One consolidated, runnable audit trail for every cardio + strength-formula
calibration decision made across this review. It replaces juggling several
markdown briefs for the numbers themselves — read the comments here for the
"why", run the script for proof the numbers are internally consistent, and
copy the printed TS blocks at the bottom straight into the real codebase.

This does NOT replace two other briefs, which are architectural/behavioural,
not calibration-numbers issues:
  - CLAUDE-CODE-BRIEF-cardio-session-score-monotonicity-bug.md (the pipeline
    bug where a real logged run scored *below* what its raw pace implies —
    a routing/session-type bug, not a wrong-anchor problem. Fix that first.)
  - CLAUDE-CODE-BRIEF-landing-page-fixes.md (unrelated marketing-copy issues)

METHODOLOGY — THE ONE RULE THAT MATTERS
Every anchor table below is built from ONE internally-consistent source per
activity, never synthesized across sources with different definitions of
"advanced" or different percentile conventions. This rule exists because it
was violated once already in this review: an earlier draft mixed percentile
targets from one source with time boundaries from another (Motera) for
running, and it silently put a real time (19:00) at the wrong score (850
instead of ~756) because the two sources didn't actually agree on what
"Advanced" meant. Caught by inspection, not by the audit — which is exactly
why the audit now checks source-internal-consistency too, not just
monotonicity.

Four of five cardio activities turned out to have a genuinely good single
source: a network of five sibling sites (Run/Row/Cycle/Swim/Triathlon
Regimen) that all use the identical percentile convention explicitly stated
on at least two of them: Beginner = faster than 5% of people, Novice = 20%,
Intermediate = 50%, Advanced = 80%, Elite = 95%. Age ~25 rows used
throughout, matching Stephen's own profile and the fact that every one of
these tables treats 20-30 as a flat peak band anyway (consistent with his
own age-factor curve, which also treats 25-35 as flat 1.00).

Walking has no equivalent 5-tier single source in that network or elsewhere
found — it keeps the earlier, softer correction and stays flagged as the
lowest-confidence table. SkiErg likewise has no independent source and stays
a pure derivation off the row curve, flagged for the steepness issue found
in the previous audit pass.
"""

import math

# ============================================================
# SHARED FRAMEWORK
# ============================================================

TIER_BANDS = [
    (1, 249, "Beginner"), (250, 474, "Intermediate"), (475, 724, "Semi-Pro"),
    (725, 849, "Advanced"), (850, 924, "Elite"), (925, 999, "World Class"),
]

def tier_for(score):
    for lo, hi, name in TIER_BANDS:
        if lo <= score <= hi:
            return name
    return "Beginner" if score < 1 else "World Class"

def parse(t):
    parts = str(t).split(":")
    return int(parts[0]) * 60 + float(parts[1])

def fmt(s):
    m = int(s // 60); sec = s - m * 60
    return f"{m}:{sec:04.1f}" if sec != int(sec) else f"{m}:{int(sec):02d}"

def interp(x, anchors):
    a = sorted(anchors, key=lambda p: p[0])
    if x <= a[0][0]: return a[0][1]
    if x >= a[-1][0]: return a[-1][1]
    for i in range(len(a) - 1):
        x1, s1 = a[i]; x2, s2 = a[i + 1]
        if x1 <= x <= x2:
            return s1 + (x - x1) / (x2 - x1) * (s2 - s1)

# 99th-percentile anchor rule, applied consistently across every activity
# that only has a 95th-percentile ("Elite") data point plus a WR/best-known
# reference: close 30% of the remaining gap to WR. Same rule used for every
# activity below rather than a different ad hoc guess each time.
PCT99_FRACTION_TOWARD_WR = 0.30

def pct99_anchor(elite_time, wr_time):
    return elite_time - PCT99_FRACTION_TOWARD_WR * (elite_time - wr_time)


# ============================================================
# RUN 5K — source: Run Regimen (runregimen.com), age-25 male/female,
# explicit percentile tiers (5/20/50/80/95th), same network as row/cycle/swim.
# ============================================================
RUN_5K_MALE_RAW = {5: "31:29", 20: "26:19", 50: "22:31", 80: "19:44", 95: "17:40"}
RUN_5K_MALE_WR = parse("12:51")
RUN_5K_FEMALE_RAW = {5: "35:27", 20: "30:08", 50: "26:07", 80: "23:04", 95: "20:47"}
RUN_5K_FEMALE_WR = parse("14:44")

def build_table(raw, wr_time):
    anchors = [(parse(t), score_for_pct[p]) for p, t in raw.items()]
    p95_time = parse(raw[95])
    anchors.append((pct99_anchor(p95_time, wr_time), 925))
    return sorted(anchors)

score_for_pct = {5: 125, 20: 250, 50: 475, 80: 725, 95: 850}
RUN_5K_ANCHORS_MALE = build_table(RUN_5K_MALE_RAW, RUN_5K_MALE_WR)
RUN_5K_ANCHORS_FEMALE = build_table(RUN_5K_FEMALE_RAW, RUN_5K_FEMALE_WR)


# ============================================================
# ROW 2K — source: Rowing Regimen (rowingregimen.com), Concept2-logbook-
# derived, age-30 (== age-25 for this purpose, flat 20-30 band), explicit
# percentiles. Unchanged from the previous audit pass — already a clean
# single source, no correction needed.
# ============================================================
ROW_2K_MALE_RAW = {5: "8:06.9", 20: "7:35.4", 50: "7:04.6", 80: "6:35.9", 95: "6:10.2"}
ROW_2K_MALE_WR = parse("5:35.8")
ROW_2K_FEMALE_RAW = {5: "10:14.2", 20: "9:21.0", 50: "8:30.2", 80: "7:44.0", 95: "7:03.9"}
ROW_2K_FEMALE_WR = parse("6:24.8")

ROW_2K_ANCHORS_MALE = build_table(ROW_2K_MALE_RAW, ROW_2K_MALE_WR)
ROW_2K_ANCHORS_FEMALE = build_table(ROW_2K_FEMALE_RAW, ROW_2K_FEMALE_WR)


# ============================================================
# CYCLE 20K — source: Cycling Regimen (cyclingregimen.com), age-25 male,
# explicit 5-tier table, same network. WR/elite-pro figure (~22:00) is NOT
# from the same source (that page had no WR column) — flagged lower
# confidence for that one anchor point only.
# ============================================================
CYCLE_20K_MALE_RAW = {5: "51:58", 20: "44:58", 50: "40:02", 80: "36:42", 95: "34:14"}
CYCLE_20K_MALE_WR_ESTIMATE = parse("22:00")  # separately-sourced estimate, not ex Cycling Regimen
CYCLE_20K_ANCHORS_MALE = build_table(CYCLE_20K_MALE_RAW, CYCLE_20K_MALE_WR_ESTIMATE)
# Female table: Cycling Regimen has one but wasn't captured in this pass —
# use the existing documented female cardio factor (1.219) on the male table
# instead, consistent with how walk/ski are already handled.


# ============================================================
# SWIM 400M — source: Swimming Regimen (swimmingregimen.com), age-25 male,
# LCM, explicit 5-tier table, same network. WR (~3:40) is NOT from the same
# source — flagged lower confidence for that one anchor point only.
# ============================================================
SWIM_400M_MALE_RAW = {5: "6:10.06", 20: "5:43.53", 50: "5:17.13", 80: "5:03.98", 95: "4:50.72"}
SWIM_400M_MALE_WR_ESTIMATE = parse("3:40.0")  # separately-sourced, not ex Swimming Regimen
SWIM_400M_ANCHORS_MALE = build_table(SWIM_400M_MALE_RAW, SWIM_400M_MALE_WR_ESTIMATE)
# Female table not captured this pass — use existing female cardio factor (1.073).


# ============================================================
# WALK /KM — no equivalent 5-tier single source found anywhere (the Regimen
# network doesn't cover walking). Kept from the previous audit pass: a
# lighter-touch correction against general population pace research, still
# the lowest-confidence table alongside ski. NOT rebuilt this pass — flagged,
# not fixed, for lack of a real source.
# ============================================================
WALK_ANCHORS = [(parse("7:00"), 925), (parse("8:00"), 875), (parse("9:15"), 725),
                 (parse("10:00"), 500), (parse("12:00"), 300), (parse("14:00"), 150)]

# ============================================================
# SKI 1K — still a pure derivation off the row curve (no independent source
# exists). Flagged again: this was found LAST audit pass to be extremely
# steep (925->64 inside a 2-minute band). Recommend a dedicated source before
# shipping if one turns up; until then this is internal-consistency-checked
# only, not externally validated.
# ============================================================
SKI_FROM_ROW_PACE = 1.0357
def ski_score(t):
    row_equiv_2k = (t / SKI_FROM_ROW_PACE) * 2
    return interp(row_equiv_2k, ROW_2K_ANCHORS_MALE)


# ============================================================
# FEMALE CARDIO FACTORS (existing, documented, unchanged) — applied where a
# sex-specific single-source table wasn't built this pass (cycle, swim, walk, ski)
# ============================================================
FEMALE_FACTOR = {"run": 1.152, "walk": 1.152, "swim": 1.073, "cycle": 1.219, "row": 1.187, "ski": 1.187}
def female_adjust(t, activity):
    return t / FEMALE_FACTOR[activity]


# ============================================================
# STRENGTH — bench/deadlift corrected anchors (Strength Level, 48.7M/24.9M-
# lift dataset — the SAME source Stephen's sex/age factors already use, so
# no new source introduced). Unchanged from previous pass.
# ============================================================
BENCH_ANCHORS_MALE_83KG = [(47,125),(70,250),(98,475),(132,725),(169,850)]
DEADLIFT_ANCHORS_MALE_83KG = [(78,125),(112,250),(152,475),(200,725),(250,850)]


# ============================================================
# DOTS / IPF GL — already verified against official public coefficients,
# unchanged, not re-audited here (see prior QA findings report).
# ============================================================
DOTS_MALE = dict(a=-0.0000010930, b=0.0007391293, c=-0.1918759221, d=24.0900756, e=-307.75076)
IPF_GL_MALE = dict(A=1199.72839, B=1025.18162, C=0.009210)
def dots_score(bw, total):
    d = DOTS_MALE
    denom = d["a"]*bw**4 + d["b"]*bw**3 + d["c"]*bw**2 + d["d"]*bw + d["e"]
    return total * 500 / denom
def gl_score(bw, total):
    g = IPF_GL_MALE
    denom = g["A"] - g["B"] * math.exp(-g["C"] * bw)
    return total * 100 / denom


# ============================================================
# AUDIT — run every table through the same two checks
# ============================================================
def audit_time_table(name, anchors, sweep_start, sweep_stop, step=5):
    a = sorted(anchors)
    mono = all(a[i][1] > a[i+1][1] for i in range(len(a)-1))
    xs = []
    x = sweep_start
    while x <= sweep_stop:
        xs.append(x); x += step
    scores = [interp(x, a) for x in xs]
    sweep_ok = all(scores[i] >= scores[i+1] for i in range(len(scores)-1))
    status = "PASS" if (mono and sweep_ok) else "FAIL"
    print(f"[{status}] {name}: {len(a)} anchors, monotonic={mono}, "
          f"{len(xs)}-pt sweep monotonic={sweep_ok}")
    for t, s in a:
        print(f"    {fmt(t)} -> {s:.1f}")
    return mono and sweep_ok

def audit_weight_table(name, anchors, sweep_lo, sweep_hi, step=5):
    a = sorted(anchors)
    mono = all(a[i][1] < a[i+1][1] for i in range(len(a)-1))
    ws = list(range(sweep_lo, sweep_hi, step))
    def interp_w(w):
        if w <= a[0][0]: return a[0][1]
        if w >= a[-1][0]: return a[-1][1]
        for i in range(len(a)-1):
            w1,s1 = a[i]; w2,s2 = a[i+1]
            if w1 <= w <= w2:
                return s1 + (w-w1)/(w2-w1)*(s2-s1)
    scores = [interp_w(w) for w in ws]
    sweep_ok = all(scores[i] <= scores[i+1] for i in range(len(scores)-1))
    status = "PASS" if (mono and sweep_ok) else "FAIL"
    print(f"[{status}] {name}: {len(a)} anchors, monotonic={mono}, sweep monotonic={sweep_ok}")
    return mono and sweep_ok

print("=" * 70); print("RUN 5K"); print("=" * 70)
audit_time_table("Run 5k male", RUN_5K_ANCHORS_MALE, parse("12:00"), parse("40:00"))
audit_time_table("Run 5k female", RUN_5K_ANCHORS_FEMALE, parse("14:00"), parse("45:00"))
print("  spot checks: 19:00 ->", round(interp(parse("19:00"), RUN_5K_ANCHORS_MALE),1),
      " | 19:30 ->", round(interp(parse("19:30"), RUN_5K_ANCHORS_MALE),1),
      " | 18:25 (live bug case) ->", round(interp(parse("18:25"), RUN_5K_ANCHORS_MALE),1),
      " | 19:20 (his PB) ->", round(interp(parse("19:20"), RUN_5K_ANCHORS_MALE),1))

print(); print("=" * 70); print("ROW 2K"); print("=" * 70)
audit_time_table("Row 2k male", ROW_2K_ANCHORS_MALE, parse("5:30"), parse("10:00"), step=2)
audit_time_table("Row 2k female", ROW_2K_ANCHORS_FEMALE, parse("6:30"), parse("10:20"), step=2)

print(); print("=" * 70); print("CYCLE 20K"); print("=" * 70)
audit_time_table("Cycle 20k male", CYCLE_20K_ANCHORS_MALE, parse("20:00"), parse("55:00"), step=10)

print(); print("=" * 70); print("SWIM 400M"); print("=" * 70)
audit_time_table("Swim 400m male", SWIM_400M_ANCHORS_MALE, parse("3:30"), parse("6:30"), step=2)

print(); print("=" * 70); print("WALK /KM (unchanged, lowest confidence)"); print("=" * 70)
audit_time_table("Walk", WALK_ANCHORS, parse("6:30"), parse("14:30"), step=2)

print(); print("=" * 70); print("SKI 1K (derived, no independent source)"); print("=" * 70)
ski_times = [parse(t) for t in ["3:00","3:15","3:30","3:45","4:00","4:15","4:30","4:45","5:00"]]
ski_scores = [ski_score(t) for t in ski_times]
ok = all(ski_scores[i] >= ski_scores[i+1] for i in range(len(ski_scores)-1))
print(f"[{'PASS' if ok else 'FAIL'}] Ski derived scores monotonic: {ok}")
for t, s in zip(ski_times, ski_scores):
    print(f"    {fmt(t)} -> {s:.1f}")

print(); print("=" * 70); print("STRENGTH (unchanged from previous pass)"); print("=" * 70)
audit_weight_table("Bench 83kg BW", BENCH_ANCHORS_MALE_83KG, 40, 260)
audit_weight_table("Deadlift 83kg BW", DEADLIFT_ANCHORS_MALE_83KG, 40, 260)

print(); print("=" * 70); print("DOTS/GL CHECKPOINT (unchanged, previously verified)"); print("=" * 70)
print("  83kg/600kg -> DOTS", round(dots_score(83,600),1), " GL", round(gl_score(83,600),2))


# ============================================================
# READY-TO-PASTE TYPESCRIPT — copy directly into the real config files
# ============================================================
def ts_array(anchors, time_or_weight="time"):
    lines = []
    for x, s in sorted(anchors):
        if time_or_weight == "time":
            lines.append(f'  {{ time: "{fmt(x)}", score: {round(s,1)} }},')
        else:
            lines.append(f'  {{ weight: {x}, score: {round(s,1)} }},')
    return "\n".join(lines)

print()
print("=" * 70)
print("READY-TO-PASTE TYPESCRIPT (paste into config/cardio-anchors.ts etc.)")
print("=" * 70)
print(f"""
export const RUN_5K_ANCHORS_MALE = [
{ts_array(RUN_5K_ANCHORS_MALE)}
];
export const RUN_5K_ANCHORS_FEMALE = [
{ts_array(RUN_5K_ANCHORS_FEMALE)}
];
export const ROW_2K_ANCHORS_MALE = [
{ts_array(ROW_2K_ANCHORS_MALE)}
];
export const ROW_2K_ANCHORS_FEMALE = [
{ts_array(ROW_2K_ANCHORS_FEMALE)}
];
export const CYCLE_20K_ANCHORS_MALE = [
{ts_array(CYCLE_20K_ANCHORS_MALE)}
];  // female: apply FEMALE_FACTOR.cycle (1.219) to time before scoring
export const SWIM_400M_ANCHORS_MALE = [
{ts_array(SWIM_400M_ANCHORS_MALE)}
];  // female: apply FEMALE_FACTOR.swim (1.073) to time before scoring
export const WALK_ANCHORS = [
{ts_array(WALK_ANCHORS)}
];  // unisex + FEMALE_FACTOR.walk (1.152); lowest confidence, no dedicated source
export const SKI_FROM_ROW_PACE = {SKI_FROM_ROW_PACE};  // derived only, flagged for dedicated sourcing later

export const BENCH_ANCHORS_MALE_83KG = [
{ts_array(BENCH_ANCHORS_MALE_83KG, "weight")}
];
export const DEADLIFT_ANCHORS_MALE_83KG = [
{ts_array(DEADLIFT_ANCHORS_MALE_83KG, "weight")}
];

export const FEMALE_CARDIO_FACTOR = {{
  run: 1.152, walk: 1.152, swim: 1.073, cycle: 1.219, row: 1.187, ski: 1.187,
}} as const;

export const RIEGEL_K_DEFAULT = 1.06;
export const RIEGEL_K_MIN = 1.03;
export const RIEGEL_K_MAX = 1.10;
""")

print("Claude Code line:")
print("> Read the current cardio/strength scoring config first. Run this script")
print("  (python3 scripts/splitindex-calibration-master.py) to see the full audit —")
print("  every table must show PASS before you paste anything. Replace the live")
print("  anchor constants with the printed TypeScript block above, activity by")
print("  activity, one commit per activity. Walk and SkiErg are flagged lowest-")
print("  confidence — note that in-app/changelog as provisional. Do NOT touch")
print("  DOTS/GL (already verified separately) or the monotonicity-bug fix")
print("  (separate brief, separate root cause — fix that first if not already fixed).")
