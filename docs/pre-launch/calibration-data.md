# Split Index — Anchor Table Calibration Data

**Compiled:** 2026-09-06. **Status:** raw sourced research. No scoring decisions made here.

**Purpose.** Supply sourced percentile data so someone else can build [benchmark-time, score]
anchor tables for swim, cycle and SkiErg that are compatible with the two already-calibrated
sports:

| Sport | 99th | 95th | 80th | 50th | 20th | 5th |
|---|---|---|---|---|---|---|
| Run 5 km (existing) | 17:00 | 19:00 | 21:45 | 30:00 | 38:30 | 49:00 |
| Row 2000 m men (existing) | 6:23.5 | 6:41.0 | 7:03.4 | 8:03.1 | 8:56.9 | 9:57.4 |
| Row 2000 m women (existing) | 7:19.2 | 7:39.1 | 8:16.3 | 9:40.5 | 11:01.4 | 12:33.6 |
| Existing row F:M ratio | 1.145 | 1.145 | 1.172 | 1.202 | 1.232 | 1.261 |

**Percentile convention used throughout this document:** higher percentile = better performance
(99th = fast). Several sources use the opposite convention; every conversion is stated inline.

**A note on what "general population" can mean.** No source below samples people who do not do
the sport. Every dataset is a population of people who *chose to record a result*. The self-selection
ladder, weakest to strongest, is roughly:

`parkrun / mass road races  <  Concept2 logbook  <  IRONMAN 70.3 finishers  <  Cycling Analytics power-meter users  <  USMS meet swimmers  <  national rankings`

Where a section's population sits high on that ladder, the resulting percentiles are compressed
toward the fast end and must be shifted before use as general-population anchors. Each section
says explicitly where it sits.

---

## 1. Swimming — 400 m freestyle

### 1a. Elite / world record

| Item | Men | Women | F:M time ratio | Source |
|---|---|---|---|---|
| 400 m freestyle LCM world record | 3:39.96 (Lukas Märtens, GER, Apr 2025) | 3:54.18 (Summer McIntosh, CAN) | **1.0647** | World Aquatics current LCM world records, as of 13 Jan 2026 — https://resources.fina.org/fina/document/2026/01/14/a25b5e30-9f7a-4a38-b162-539036a85bc6/CurrentWorldRecords-Individual-LCM-1-.pdf ; corroborated at https://myswimsplits.com/mens-400m-freestyle-long-course/ and https://myswimsplits.com/womens-400m-freestyle-long-course/ |
| 10 km open-water, fastest swimmers | 1.45 ± 0.10 m/s | 1.35 ± 0.09 m/s | 1.068 (speed-derived) | Zingg et al., *SpringerPlus* 2013; 2,591 finishers (1,471 M / 1,120 F) of 47 10 km OW races 2008–2012 — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3853191/ |
| Youth elite, 1st vs 100th place | — | — | gap rises 2.4% (1st place) → 4.3% (100th place) | Clayburn et al., *FASEB J* 2020 / *Physiology* 2024 — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6874329/ |

### 1b. Competitive masters distribution (USMS season rankings)

U.S. Masters Swimming season-best rankings, rendered as percentile tiers. **These are tiers within
USMS meet swimmers, i.e. "Top 2%" means top 2% of people who entered a sanctioned masters meet.**
Event shown is 500 yd freestyle SCY (the closest USMS-standard distance to 400 m; USMS does not
list 400 free in the default SCY view). Age group 18–24, 2025 season.

| USMS tier | = SI percentile *of this population* | Women (n = 83) | Men (n = 99) | F:M ratio |
|---|---|---|---|---|
| AAAA / Top 2% | 98th | 5:06.32 | 4:40.56 | **1.092** |
| AAA / Top 6% | 94th | 5:29.62 | 4:47.49 | **1.147** |
| AA / Top 8% | 92nd | 5:30.31 | 4:50.18 | **1.138** |
| A / Top 15% | 85th | 5:46.81 | 4:57.79 | **1.165** |
| BB / Top 35% | 65th | 6:03.01 | 5:17.36 | **1.144** |
| B / Top 55% | 45th | 6:21.11 | 5:36.37 | **1.133** |

Source: USMS percentile-based time standards, reproduced with times at
https://www.tryopenlane.com/percentile-times (tier→percentile mapping stated on that page:
AAAA = top 2%, AAA = top 6%, AA = top 8%, A = top 15%, BB = top 35%, B = top 55%). Read from the
live page 2026-09-06. Same table, 400 IM SCY 18–24, for cross-reference: women AAAA 4:44.80,
men AAAA 3:58.24.

Course conversion, if 500 yd SCY is used to estimate 400 m LCM: 500 yd = 457.2 m, so distance
scaling alone is ×0.875; short-course yards is faster per metre than long-course metres because of
the extra turns and push-offs, worth roughly +10–12% on a 400 m LCM basis. Net approximate factor
**400 m LCM ≈ 500 yd SCY × 0.97**. This is a rough figure, and it is *not* needed for the F:M ratio,
which is close to course-invariant.

### 1c. Large recreational population (IRONMAN 70.3 swim split)

The largest sex-split adult swimming dataset found. 1.9 km open-water swim, wetsuit-legal in most
races, mass start with drafting, and a hard cut-off that truncates the slow tail.

| Metric | Men (n = 625,393) | Women (n = 198,066) | F:M ratio |
|---|---|---|---|
| Mean swim split | 38:42 (SD 7:52) | 40:55 (SD 8:08) | **1.0573** |
| Implied mean pace | 2:02 /100 m | 2:09 /100 m | — |
| Sex diff by age (paper's own figure) | 3.66% at 18–24, rising to ~11–12% at 65–74; U-shaped | | |

Source: Cuk, Nikolaidis, Villiger, Knechtle et al., "Comparing the Performance Gap Between Males and
Females in the Older Age Groups in IRONMAN® 70.3", *Sports Medicine – Open* 9:74 (2023). All official
IRONMAN 70.3 races worldwide 2004–2020, 823,459 finisher records.
https://pmc.ncbi.nlm.nih.gov/articles/PMC10514017/

Full-distance IRONMAN (3.8 km swim), same research group: swim sex difference **~7–8%**, from
687,696 finishers (553,608 M / 134,088 F), 2002–2022. Knechtle et al., *PLOS ONE* 19(10):e0311202.
https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0311202

A review of triathlon sex differences puts the swim gap for **non-elite** IRONMAN triathletes at
**~12%** — materially larger than either figure above. Lepers et al., "Sex Difference in Triathlon
Performance", https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6668549/

### 1d. Confidence and caveats — swimming

- **The single biggest gap in this whole document.** There is no published percentile distribution of
  400 m pool freestyle times for a general adult swimming population, split by sex. It does not appear
  to exist. Everything above is either a competitive-meet population (USMS) or an open-water
  triathlon split (IRONMAN).
- **USMS is not general population.** USMS itself says so: its own article notes the data represents
  "swimmers who actually race", and cites a Red Cross survey that only ~50% of Americans can pass a
  basic swim safety test. https://www.usms.org/fitness-and-training/articles-and-videos/articles/what-times-are-normal-for-swimmers-my-age
  Sample sizes per event/age-group/sex in the percentile tables are also small — **83 women and 99 men**
  for 500 free 18–24. Treat the individual times as noisy; the tier *shape* is more reliable than any
  one cell.
- **USMS covers no part of the lower half.** Its slowest published tier is "Top 55%", i.e. the 45th
  percentile *of meet swimmers*. For a general-population 20th or 5th percentile there is no data at all.
- **The two families of source disagree badly on the sex gap.** IRONMAN 70.3 says 5.7%; USMS pool
  swimming says 13–17%. Both are probably right about their own population: wetsuits, drafting and a
  cut-off compress the 70.3 gap, and buoyancy aids women's typically-better relative body composition
  less once neoprene equalises it. **For a 400 m pool event, the USMS-family ratios are the relevant
  ones and the 70.3 ratio should not be used.**
- The elite 400 free gap (6.5%) is genuinely one of the smallest elite sex gaps in endurance sport, so
  a swim anchor table will show an unusually large *spread* between its 99th-percentile ratio and its
  mid-pack ratio.

---

## 2. Cycling — 20 km time trial

### 2a. Elite

| Item | Men | Women | Ratio | Source |
|---|---|---|---|---|
| UCI Hour Record | 56.792 km (Filippo Ganna, 8 Oct 2022, Grenchen) | 50.455 km (Vittoria Bussi, 10 May 2025, Aguascalientes) | speed 1.1256 → **time ratio 1.1256** | https://www.uci.org/pressrelease/filippo-ganna-breaks-the-uci-hour-record-timed-by-tissot/82aysypXuU0sdkVD69YVI and https://www.uci.org/pressrelease/vittoria-bussi-beats-her-own-uci-hour-record-presented-by-tissot/2dYSL7grkEfmPb8JQ6qg8V |
| 20 km at hour-record pace (arithmetic) | 21:07.8 | 23:47.0 | 1.1256 | derived from the two rows above |

Note the hour records were set on different tracks at different altitudes (Grenchen ~450 m,
Aguascalientes ~1,890 m), so the ratio is not a clean like-for-like physiological comparison.

### 2b. Power distribution by sex (Cycling Analytics)

| Duration | Percentile | Men | Women | Source |
|---|---|---|---|---|
| 20 min, W | 99th | 432 W | — | https://www.cyclinganalytics.com/blog/2018/06/how-does-your-cycling-power-output-compare |
| 20 min, W | 50th | 286 W | — | same |
| 20 min, W | 10th | 222 W | — | same |
| 20 min, W/kg | 99th | 5.80 | — | same |
| 20 min, W/kg | 50th | **3.80** | **3.80** | same — the post states these are "exactly the same" |
| 20 min, W/kg | 10th | 2.71 | — | same |
| 1 hour, W/kg | 95th | 4.42 | 4.19 | https://www.cyclinganalytics.com/blog/2016/10/comparative-statistics-for-females |
| 1 hour, W/kg | 50th | 3.29 | 3.24 | same |
| 5 s, W | 95th | 1,344 W | 924 W | same |
| 5 s, W | 50th | 947 W | 658 W | same |

**This is the single most important finding in the cycling section: median W/kg is essentially
identical between the sexes in this dataset** (3.80 vs 3.80 at 20 min; 3.29 vs 3.24 at 1 hour), while
absolute watts differ by ~30%. Flat-TT speed is set by absolute power against aerodynamic drag, not
by W/kg, so the sex gap in a 20 km TT comes from the power-to-CdA ratio, not from W/kg.

### 2c. Large recreational cycling population (IRONMAN 70.3 bike split)

90 km non-drafting bike leg.

| Metric | Men (n = 625,393) | Women (n = 198,066) | F:M ratio |
|---|---|---|---|
| Mean bike split | 2:54:29 (SD 21:18) | 3:11:34 (SD 23:06) | **1.0979** |
| Implied mean speed | 30.95 km/h | 28.19 km/h | — |

Source: as §1c, *Sports Medicine – Open* 9:74 (2023), https://pmc.ncbi.nlm.nih.gov/articles/PMC10514017/

Full-distance IRONMAN (180 km bike): the paper reports a cycling sex difference of **~15%**, the
largest of the three disciplines. https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0311202

### 2d. Power → 20 km TT time conversion (worked, with assumptions stated)

Model: `P_wheel = ½ · ρ · CdA · v³ + Crr · m · g · v`, flat, windless, steady state.

Assumptions (all chosen, none sourced from the dataset):
ρ = 1.225 kg/m³ (sea level, 15 °C); Crr = 0.004 (good clinchers, decent road surface);
drivetrain efficiency 0.975; male rider 75 kg + 8 kg bike/kit = 83 kg total, CdA = 0.32 m²
(road bike, on the drops, no TT equipment); female rider 62 kg + 8 kg = 70 kg total, CdA = 0.28 m².
Power for a ~30 min effort taken as equal to 1-hour power (a real 20 km TT would be ridden slightly
above FTP; ignoring that shifts both sexes equally and does not affect the ratio).

| Input | Men | Women |
|---|---|---|
| 1-hour power, 50th pct (Cycling Analytics) | 3.29 W/kg × 75 kg = 247 W | 3.24 W/kg × 62 kg = 201 W |
| Solved speed | 10.19 m/s = 36.7 km/h | 9.94 m/s = 35.8 km/h |
| **20 km time** | **32:43** | **33:33** |
| Implied F:M ratio | | **1.025** |

Sensitivity: raising female CdA from 0.28 to 0.30 m² (a less aggressive position, arguably more
typical) gives 34:18 and a ratio of **1.048**. Both are far below the 1.098 actually observed in the
IRONMAN 70.3 bike leg, and far below the 1.126 elite hour-record ratio.

### 2e. Confidence and caveats — cycling

- **No UK CTT distribution was found.** Repeated searches for an aggregated distribution of CTT 10-mile
  or 25-mile results (histogram, percentiles, medians across the whole field) returned nothing published.
  CTT hosts the raw results — https://www.cyclingtimetrials.org.uk/results-finder — but has not
  published a distribution, and no academic analysis of it surfaced. One secondary claim was found that
  time-trial finishing times are approximately Gaussian across five events, but with no supporting numbers.
  **This is a real gap. Extracting a distribution would require scraping CTT event results directly.**
- **Cycling Analytics users are a heavily self-selected population**: cyclists who own a power meter and
  pay for analytics software; the post states roughly half race regularly. It is the most self-selected
  cycling source here.
- **The female Cycling Analytics sample is small and more selected than the male one.** The 2016 post
  says the female power curve "looks particularly rough because of the lower number of people it's
  based on", and the 2018 tables stop at the 95th percentile for women because of it. This is the most
  likely explanation for the conversion in §2d under-predicting the observed race gap by a factor of
  two to four: if the women in that dataset are further up their own sport's distribution than the men
  are up theirs, the near-equal median W/kg is an artefact of unequal selection, not a real finding
  about the population. **Do not use the §2d conversion as the basis for a cycling anchor table.**
- **Prefer the IRONMAN 70.3 bike ratio (1.098) as the recreational anchor** and the hour record (1.126)
  as the elite anchor. Both are large-sample and directly measured. Note that a 20 km solo TT would
  plausibly show a slightly *larger* gap than a 90 km IRONMAN bike leg, because the IRONMAN leg is
  paced conservatively to protect the run and the shorter effort loads absolute power harder.
- No Zwift or TrainerRoad FTP distribution split by sex was found. The one Zwift distribution located
  (https://forums.zwift.com/t/distribution-of-zwifters-by-20min-w-kg/588299) is 1,616 finishers of a
  single 2020 event, is **not split by sex**, and shows visible category-gaming spikes at 2.6 and
  3.3 W/kg. Not usable.

---

## 3. SkiErg (Concept2) — 1000 m and 2000 m

### 3a. Concept2 logbook season rankings, 2025 season, 1000 m — the core dataset

All values read live from `log.concept2.com` on 2026-09-06. Rows marked *(C2 stat)* are Concept2's own
published percentile figures from the ranking header; rows marked *(rank N)* were read by paging to the
rank position corresponding to that percentile and reading the time there.

**Men, 1000 m SkiErg, 2025 season — n = 988, mean 4:12.8**
(https://log.concept2.com/rankings/2025/skierg/1000?gender=M)

| SI percentile | Rank used | Time | Method |
|---|---|---|---|
| 99th | 10 / 988 | **2:59.1** | rank |
| 95th | 49 / 988 | **3:12.6** | rank |
| 90th | — | **3:19.9** | C2 stat |
| 80th | 196–199 / 988 | **~3:29.0** (3:28.9 @196, 3:29.2 @199) | rank |
| 75th | — | **3:33.8** | C2 stat |
| 50th | — | **3:52.7** | C2 stat |
| 25th | — | **4:19.8** | C2 stat |
| 20th | 790 / 988 | **4:28.6** | rank |
| 5th | 939 / 988 | **5:31.9** | rank |
| rank 1 | 1 / 988 | 2:48.6 | rank |

**Women, 1000 m SkiErg, 2025 season — n = 340, mean 5:06.2**
(https://log.concept2.com/rankings/2025/skierg/1000?gender=F)

| SI percentile | Rank used | Time | Method |
|---|---|---|---|
| 99th | 3 / 340 | **3:38.7** | rank |
| 95th | 17 / 340 | **3:54.8** | rank |
| 90th | — | **4:02.3** | C2 stat |
| 80th | 67–69 / 340 | **~4:14.2** (4:13.7 @67, 4:14.8 @69) | rank |
| 75th | — | **4:18.4** | C2 stat |
| 50th | — | **4:50.0** | C2 stat |
| 25th | — | **5:29.6** | C2 stat |
| 20th | 272 / 340 | **5:42.0** | rank |
| 5th | 323 / 340 | **7:18.6** | rank |
| rank 1 | 1 / 340 | 3:23.5 | rank |
| rank 340 (last) | 340 / 340 | 12:15.0 | rank |

**Resulting F:M time ratios, 1000 m SkiErg — all SOURCED**

| Percentile | 99th | 95th | 90th | 80th | 75th | 50th | 25th | 20th | 5th |
|---|---|---|---|---|---|---|---|---|---|
| F:M ratio | **1.221** | **1.219** | **1.212** | **1.216** | **1.209** | **1.246** | **1.269** | **1.273** | **1.322** |

The gap is flat at ~1.21 across the top quintile and then widens steadily below the median — the same
qualitative shape as the existing rowing table, but the SkiErg gap is larger at every point
(1.21–1.32 vs rowing's 1.145–1.261). That is consistent with the SkiErg loading upper body and trunk
more heavily than the RowErg.

### 3b. Concept2 logbook, 2025 season, 2000 m

| Percentile | Men (n = 731, mean 8:26.4) | Women (n = 129, mean 9:59.4) | F:M ratio |
|---|---|---|---|
| 90th | 6:59.8 | 8:18.6 | 1.188 |
| 75th | 7:33.0 | 8:50.4 | 1.171 |
| 50th | 8:14.5 | 9:35.8 | 1.164 |
| 25th | 9:00.6 | 10:30.0 | 1.165 |
| rank 1 | 4:44.4 — **implausible, flagged "unverified"** | 7:02.0 | — |

Sources: https://log.concept2.com/rankings/2025/skierg/2000?gender=M and `?gender=F`

### 3c. RowErg 2000 m, same season, same logbook — control group

| Percentile | Men (n = 9,561, mean 8:00.1) | Women (n = 2,545, mean 9:12.2) | F:M ratio |
|---|---|---|---|
| 90th | 6:48.4 | 7:42.0 | 1.131 |
| 75th | 7:13.6 | 8:08.7 | 1.127 |
| 50th | 7:46.8 | 8:50.7 | 1.137 |
| 25th | 8:31.1 | 9:49.0 | 1.152 |
| rank 1 | 5:43.0 | 6:40.5 | — |

Sources: https://log.concept2.com/rankings/2025/rower/2000?gender=M and `?gender=F`

**Note the discrepancy with the existing calibration.** The existing rowing anchor table uses F:M
ratios of 1.145 / 1.145 / 1.172 / 1.202 / 1.232 / 1.261. The 2025 Concept2 logbook gives 1.13–1.15
over the equivalent range — consistently *narrower*. Whoever calibrates should decide which population
the existing rowing table was built from before importing SkiErg ratios from the logbook alongside it,
or the two sports will be internally inconsistent.

### 3d. RowErg : SkiErg pace equivalence

The app currently assumes `ski pace = row pace × 1.0357`. Measured against the same logbook, same
season, same distance, at matched percentiles:

| Percentile | Ski:Row ratio, men | Ski:Row ratio, women |
|---|---|---|
| 90th | 1.028 | 1.079 |
| 75th | 1.045 | 1.085 |
| 50th | **1.059** | **1.085** |
| 25th | 1.058 | 1.070 |

Derived from §3b and §3c. **The 1.0357 assumption looks too low — roughly 1.06 for men and roughly
1.085 for women is what the logbook shows at the median, and the ratio is sex-dependent, which a single
scalar cannot represent.**

Two supporting facts:
- **The two machines share an identical pace↔watts formula.** The PM5 uses the same power equation and
  the same nominal 500 m split basis on both, so a given split is the same wattage on both machines and
  any pace difference is purely physiological, not a units artefact. Reported at
  https://c2forum.com/viewtopic.php?t=209712 and consistent with Concept2's own pace calculator,
  https://www.concept2.com/training/pace-calculator
- **Anecdotal user reports** on the Concept2 forum span +5 to +15 s per 500 m on the SkiErg at matched
  effort/heart rate. At a 2:00/500 m row pace, +5 s = ratio 1.042 and +15 s = ratio 1.125; the
  logbook-derived 1.06 (≈ +7 s) sits comfortably inside that range, while 1.0357 (≈ +4.3 s) sits at its
  very edge. https://www.c2forum.com/viewtopic.php?t=209712

**No official Concept2 statement of a row:ski equivalence factor was found.** It may not exist.

### 3e. SkiErg world records

| Distance | Men | Women | Source and status |
|---|---|---|---|
| 1000 m | 2:59.7 (2011) — **superseded** | 3:44.2 (2011) | Concept2 announcement, https://fasterskier.com/2011/06/concept2-announces-current-skierg-world-records/ |
| 1000 m | 2:41.7 (James Hall, 2020 SkiErg World Sprints) | not found | http://www.concept2southafrica.com/news/results-and-records-2020-skierg-sprints |
| 2000 m | 6:30.9 (2011) — status unverified | 7:56.0 (2011) | https://fasterskier.com/2011/06/concept2-announces-current-skierg-world-records/ |

**This is a gap.** Concept2's canonical world-record page could not be retrieved
(https://www.concept2.com/service/concept2-world-records returns 404), and no current, authoritative,
sex-split SkiErg record list was located. The 2011 figures are certainly stale — the 2025 logbook alone
contains a men's 1000 m of 2:48.6, faster than the 2011 "record". Do not use the 2011 numbers as an
elite anchor without verification directly from Concept2.

### 3f. HYROX 1000 m SkiErg station splits

| Source | Men | Women | F:M ratio | Notes |
|---|---|---|---|---|
| Rox Lyfe, elite | 3:47 | 4:12 | 1.110 | "15 of the best HYROX performances ever" per sex, Pro division. n = 15 per sex. |
| Rox Lyfe, average | 4:17 | 4:51 | 1.132 | Athletes finishing near HYROX's stated ~90 min Pro average |
| HyroxDataLab, elite | 3:15–3:30 | 3:30–3:50 | ~1.08–1.10 | ranges only |
| HyroxDataLab, competitive | 3:45–4:15 | 4:00–4:30 | ~1.06–1.07 | ranges only |
| HyroxDataLab, recreational | 4:30–5:30+ | 4:45–5:45+ | ~1.04–1.06 | ranges only |

Sources: https://roxlyfe.com/hyrox-from-average-to-elite/ and
https://hyroxdatalab.com/articles/ski-erg-strategy (the latter cites "700,000+ HYROX results" but
publishes only ranges, no medians or percentiles).

### 3g. Confidence and caveats — SkiErg

- **The Concept2 logbook percentiles in §3a are the strongest data in this document for any of the three
  new sports.** They are a real distribution, sex-split, with known n, read at known rank positions.
- **But n is small and shrinking with distance.** Men's 1000 m n = 988; women's 1000 m n = 340; women's
  2000 m n = **129**. At n = 129 the 90th and 25th percentiles rest on a handful of individuals. The
  1000 m tables should be preferred over the 2000 m tables, and the 2000 m women's ratios (1.164–1.188,
  showing *no* widening) should be treated as too noisy to contradict the 1000 m pattern.
- **Logbook entries are self-reported and largely unverified.** The 2025 men's 2000 m top entry of
  4:44.4 (a ~1:11/500 m pace) is physically impossible and is flagged "unverified" on the page itself.
  Bad entries at the fast end will bias the 99th and 95th percentiles optimistically. Rank-1 times should
  never be used as anchors.
- **The logbook population is fitness-enthusiast, not general.** These are people who own or have access
  to a SkiErg, have a Concept2 logbook account, and chose to submit a ranked piece. Expect the whole
  distribution to sit well above a genuine general population. The slow tail is real, though: the last
  woman ranked is 12:15.0 for 1000 m, so the logbook does capture some genuinely recreational entries.
- **HYROX is not a substitute.** The distribution chart on https://www.hyresult.com/hyrox/ski-erg loads
  its data through a server action that returns no numbers to a page reader; the axis runs 3:30–7:00 but
  no percentile values are exposed. Every published HYROX SkiErg figure found is either a range or a
  small hand-picked sample. Also, a HYROX SkiErg split is run *after* a 1 km run, mid-race, so it is not
  comparable to a fresh time trial — note that the HYROX "average" (4:17 M) is *slower* than the
  Concept2 logbook median (3:52.7 M) despite HYROX athletes being a fitter population.

---

## 4. Sex difference as a function of ability

### 4a. Running — the largest and cleanest evidence

**Recreational: RunRepeat 5 km percentiles by sex.** Stated basis: "35 million results collected in the
last 20 years from more than 28,000 races". Read live from
https://runrepeat.com/how-do-you-masure-up-the-runners-percentile-calculator on 2026-09-06.
RunRepeat labels percentiles the opposite way round (their "1st percentile" = fastest 1%); converted here.

| SI percentile | RunRepeat label | Men | Women | F:M ratio |
|---|---|---|---|---|
| 99th | 1st | 17:30 | 21:39 | **1.237** |
| 90th | 10th | 23:26 | 28:24 | **1.212** |
| 80th | 20th | 26:04 | 31:09 | **1.195** |
| 70th | 30th | 27:58 | 33:19 | **1.191** |
| 60th | 40th | 29:41 | 35:21 | **1.191** |
| 50th | 50th | 31:28 | 37:28 | **1.191** |
| 40th | 60th | 33:28 | 39:47 | **1.189** |
| 30th | 70th | 35:55 | 42:36 | **1.186** |
| 20th | 80th | 39:21 | 46:23 | **1.179** |
| 10th | 90th | 45:43 | 52:24 | **1.146** |

All-runner 5 km 50th percentile: 34:37. Cross-check from a separate dataset: 736,928 race results give
a men's mean of 33:08 and women's mean of 35:50 (https://runbundle.com/articles/good-5k-time).

**parkrun.** parkrun UK's published average 5 km finisher was **30:37 in 2025** and **29:34 in early
2026**; the USA average was 34:17 at end-August 2025. Secondary reporting puts parkrun median finishers
at roughly 35 min (men) and 41–42 min (women), a ratio of ~1.19 — consistent with the RunRepeat 50th
percentile ratio of 1.191. Sources: https://therunningchannel.com/average-parkrun-time/ and
https://runabc.co.uk/what-is-the-average-5k-time-in-2026. **Caveat: parkrun's own primary statistics
pages, split by sex, were not successfully retrieved; the sex-split parkrun medians above are secondary
reporting and should be verified against parkrun directly before use.**

**Elite: World Athletics.** Nuell / Millet et al., "Expanding the Gap: An Updated Look Into Sex
Differences in Running Performance", *Front. Physiol.* 2021, analysing annual top-20 world performances
2001–2020 plus world records as of Feb 2021.
https://pmc.ncbi.nlm.nih.gov/articles/PMC8764368/

| Event | WR sex gap | Top-20 mean gap | 1st → 20th widening |
|---|---|---|---|
| 5,000 m | 12.1% | ~13.8% early 2000s, ~1–2% lower recently | 1.3–2.1% (long distances) |
| 10,000 m | 11.9% | 12.8–16.2% | 1.3–2.1% |
| Marathon | 10.2% | always > 12% | 1.3–2.1% |
| 1,500 m | 11.7% | > 13% most years | < 1% (short distances) |
| 100 m | 9.5% | 9.75–11% | < 1% |

**Running summary: elite 5 km gap ≈ 12% (ratio 1.121); recreational 5 km gap ≈ 19% (ratio 1.191).**

### 4b. Rowing / SkiErg

| Level | Row 2000 m F:M | Ski 1000 m F:M | Source |
|---|---|---|---|
| Existing app calibration, 99th | 1.145 | — | given in brief |
| Existing app calibration, 5th | 1.261 | — | given in brief |
| C2 logbook 2025, 90th | 1.131 | 1.212 | §3a, §3c |
| C2 logbook 2025, 50th | 1.137 | 1.246 | §3a, §3c |
| C2 logbook 2025, 25th | 1.152 | 1.269 | §3a, §3c |
| C2 logbook 2025, 5th | not read for row | 1.322 | §3a |

Both erg disciplines show the gap widening as ability falls. SkiErg widens more (1.21 → 1.32, +11 pts)
than RowErg does over the equivalent span (1.131 → 1.152, +2 pts over 90th→25th; the existing app table
implies +12 pts over 99th→5th).

### 4c. Swimming

| Level | Sex gap | Source |
|---|---|---|
| Elite, 400 m free WR | 6.5% | §1a |
| Elite, 10 km open water, fastest | 6.8 ± 2.5% | Zingg et al. 2013, https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3853191/ |
| Youth elite, 1st place | 2.4% | https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6874329/ |
| Youth elite, 100th place | 4.3% | same |
| USMS masters, Top 2% | 9.2% | §1b |
| USMS masters, Top 15%–55% | 13.3–16.5% | §1b |
| IRONMAN 70.3, all finishers (wetsuit OW) | 5.7% | §1c |
| Full IRONMAN, all finishers | 7–8% | §1c |
| Non-elite IRONMAN (review) | ~12% | https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6668549/ |

**Swimming summary: elite gap ≈ 6.5%; recreational pool gap ≈ 13–16%.** The direction is the same as
running — the gap widens as ability falls — and the *relative* widening (roughly doubling) is the
largest of any sport here.

### 4d. Cycling

| Level | Sex gap | Source |
|---|---|---|
| Elite, UCI Hour Record | 12.6% | §2a |
| IRONMAN 70.3, 90 km bike, all finishers | 9.8% | §2c |
| Full IRONMAN, 180 km bike | ~15% | §2c |
| Cycling Analytics, median 20 min W/kg | 0% (3.80 vs 3.80) | §2b |
| Cycling Analytics, median 1 h W/kg | 1.5% (3.29 vs 3.24) | §2b |

**Cycling is the one sport where the evidence does not line up.** The elite gap (12.6%) is *larger* than
the recreational one measured in IRONMAN 70.3 (9.8%), which is the opposite of running and swimming. The
Cycling Analytics W/kg data implies almost no gap at all. The most likely explanation is selection: the
women in the Cycling Analytics sample and in IRONMAN 70.3 are further up their own sport's distribution
than the men are up theirs, because far fewer women enter. **Cycling is the weakest of the four topics
and the one most in need of a real, unselected TT distribution.**

### 4e. Confidence and caveats — sex difference vs ability

- **The widening pattern is real and replicated** in running (elite 12% → recreational 19%), swimming
  (elite 6.5% → recreational 13–16%), and both ergs (logbook data, §4b). This supports the existing
  rowing table's design decision to widen the ratio as ability falls.
- **But the widening is not monotonic all the way down, and running actually reverses at the very
  bottom.** The RunRepeat table peaks at 1.237 at the 99th percentile, sits flat at ~1.19 through the
  whole middle, and then *narrows* to 1.146 at the 10th percentile. The most plausible reason is that
  the slow tail of a mass road race is dominated by walkers of both sexes, and walking speed differs
  between the sexes far less than running speed does. Any anchor table that assumes monotonic widening
  from the 50th to the 5th percentile is making an assumption that the largest running dataset available
  contradicts. **The Concept2 SkiErg data, by contrast, does widen monotonically to the 5th percentile
  (1.246 → 1.322) — because an erg piece has no walking equivalent.**
- **Race-entry datasets truncate the slow tail.** IRONMAN has cut-offs; road races have sweep vehicles.
  Percentiles below about the 10th are systematically missing from all of them.
- **Data-quality flag on RunRepeat.** Its men's half-marathon table is internally inconsistent
  (50th percentile 1:59:48 is *faster* than 40th percentile 1:58:16 would require — the two rows are out
  of order). The 5 km tables used above are internally monotonic and appear sound, but the source is a
  commercial aggregator with no published methodology and should be treated as one good estimate, not
  as ground truth.

---

## 5. Summary — best available female:male time ratios

Each cell marked **SOURCED** (read directly from a dataset at that percentile) or **DERIVED** (with the
derivation stated). Where nothing supports a cell, it says so.

### Swimming, 400 m freestyle

| Percentile | F:M ratio | Status |
|---|---|---|
| 99th | **1.065** | SOURCED — 400 m LCM world records, World Aquatics (§1a) |
| 95th | **1.09** | SOURCED — USMS 500 free SCY "Top 2%" tier (1.092), used at 95th as the nearest available tier (§1b) |
| 80th | **1.15** | DERIVED — interpolated between USMS Top 15% (1.165) and Top 35% (1.144) (§1b) |
| 50th | **1.14** | DERIVED — USMS Top 55% tier is the 45th percentile *of meet swimmers*, ratio 1.133; carried across on the assumption the ratio is flat through the middle of the pool-swimming distribution (§1b) |
| 20th | **no data** | Nothing exists. Extrapolating the running pattern (flat then narrowing) would give ~1.13; extrapolating the SkiErg pattern (widening) would give ~1.19. **These disagree by 6 points and the choice is unsupported.** |
| 5th | **no data** | As above. |

### Cycling, 20 km time trial

| Percentile | F:M ratio | Status |
|---|---|---|
| 99th | **1.126** | SOURCED — UCI Hour Record, both sexes (§2a) |
| 95th | **no data** | No elite-depth ITT distribution was retrieved |
| 80th | **1.10** | DERIVED — IRONMAN 70.3 90 km bike pooled mean ratio 1.0979, which is a *mean*, not an 80th percentile (§2c) |
| 50th | **1.10** | DERIVED — same single figure; the 70.3 paper publishes mean and SD only, not percentiles (§2c) |
| 20th | **no data** | — |
| 5th | **no data** | — |

**Cycling has exactly two independent sourced numbers (1.126 elite, 1.098 recreational-mean) and no
percentile structure at all. It is by far the least calibratable of the three.**

### SkiErg, 1000 m

| Percentile | F:M ratio | Status |
|---|---|---|
| 99th | **1.221** | SOURCED — C2 logbook 2025, rank 3/340 F vs rank 10/988 M (§3a) |
| 95th | **1.219** | SOURCED — C2 logbook 2025, rank 17/340 F vs rank 49/988 M (§3a) |
| 80th | **1.216** | SOURCED — C2 logbook 2025, rank ~68/340 F vs rank ~198/988 M (§3a) |
| 50th | **1.246** | SOURCED — Concept2's own published 50th-percentile figures (§3a) |
| 20th | **1.273** | SOURCED — C2 logbook 2025, rank 272/340 F vs rank 790/988 M (§3a) |
| 5th | **1.322** | SOURCED — C2 logbook 2025, rank 323/340 F vs rank 939/988 M (§3a) |

**SkiErg is fully sourced at every requested percentile. Swimming is sourced only in its top half.
Cycling is sourced at two points and neither of them is a percentile.**

### Cross-sport reference (for sanity-checking a finished table)

| Sport | Elite F:M | Recreational-median F:M | Ratio of gaps |
|---|---|---|---|
| Running 5 km | 1.121 (WR/top-20) | 1.191 (RunRepeat 50th) | 1.6× |
| Swimming 400 free | 1.065 (WR) | ~1.14 (USMS mid) | 2.1× |
| Cycling flat TT | 1.126 (Hour Record) | 1.098 (IM 70.3 bike mean) | **0.8× — inverted, unexplained** |
| RowErg 2000 m | 1.145 (existing app) / 1.131 (C2 logbook 90th) | 1.202 (existing app) / 1.137 (C2 logbook 50th) | 1.4× / 1.05× |
| SkiErg 1000 m | 1.221 (C2 logbook 99th) | 1.246 (C2 logbook 50th) | 1.2× |

---

## 6. Explicit list of what could not be found

1. **Any general-population percentile distribution of 400 m pool freestyle by sex.** Does not appear to
   be published anywhere.
2. **Any aggregated distribution of UK CTT time trial results.** CTT holds the raw results but publishes
   no distribution; no third-party analysis found. This would require scraping
   https://www.cyclingtimetrials.org.uk/results-finder directly.
3. **Zwift or TrainerRoad FTP W/kg distributions split by sex.** The only Zwift distribution found is a
   single 1,616-rider event, not sex-split.
4. **Current authoritative Concept2 SkiErg world records.** The canonical page 404s; only 2011 figures
   and one 2020 press mention were located, and the 2011 figures are demonstrably stale.
5. **HYROX SkiErg percentile distributions by division.** hyresult.com renders its distribution through a
   server call that exposes no numbers; every other HYROX source publishes ranges or tiny samples.
6. **parkrun's own sex-split median 5 km times from a primary parkrun source.** Only aggregate all-finisher
   averages (30:37 UK 2025, 29:34 UK early 2026, 34:17 USA Aug 2025) came from parkrun-attributed
   reporting; the sex-split medians are secondary.
7. **Any official Concept2 statement of a RowErg:SkiErg pace equivalence factor.**
8. **Cycling Analytics female percentile tables below the median or above the 95th.** The published tables
   stop there because the female sample is too small.
