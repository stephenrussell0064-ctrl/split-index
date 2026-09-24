# Posting kit — Split Index TikTok launch

Five hooks, one body. Every number in every cut comes from the app's own scoring
engines run over the demo profile in `demo-profile.ts` (see `src/data/demo.json`
for the exact values and `README.md` for how they are produced). The numbers
you may quote in captions or comments are the ones below and no others.

| Number | Value | Where it comes from |
|---|---|---|
| Bench set | 145 kg × 3 | `demo-profile.ts` |
| Bench score / tier | 89.9 · Elite | `scoreStrength` |
| 5k time / tier | 40:45 · Beginner (22.3) | `scoreCardioActivity` + `tierForScore` |
| Split Index / tier | 55.6 · Semi-Pro | `computeIndexes` |
| Lab / Engine | 83.7 / 27.5 | `computeIndexes` |
| Radar finding | −8.8 % efficiency, +9 bpm, next day, recovering by day 3 | `computeInterferenceReport` (14 paired sessions) |
| Rank | #16 of 24 · Male · 25-34 · 80-90kg | sort + `leaderboard-brackets.ts` |

Files: `out/ad-<X>-<slug>.mp4` (silent master), `out/ad-<X>-<slug>-sfx.mp4`
(sound design), `out/cover-<X>-<slug>.png`, plus `out/short-A-…mp4`.

Character counts below exclude hashtags. Hashtags: 3–5 relevant, no walls.

---

## A · "Your bench says Elite. Your 5k says Beginner."

**Files** `ad-A-bench-elite-5k-beginner(-sfx).mp4` · `cover-A-…png` · `short-A-…mp4`

**Caption** (109 chars)
> 145 kg bench, 40:45 5k. Same person. One app scores both — and tells you what the gap is costing you.

**Hashtags** `#hybridathlete #hyrox #benchpress #5k #gymtok`

**Pinned comment**
> Drop your bench and your 5k time. I'll tell you which tier each one lands in 👇

**Sound to pair** Hard-hitting phonk or drill-style trap with a clean drop around 4 s — the odometer count-up wants the drop to land as the tier badge slams. Search TikTok's Commercial Music Library for "phonk drop" / "gym phonk"; 120 or 240 BPM sits on the cuts.

---

## B · "Your lifting is slowing down your running. Here's proof."

**Files** `ad-B-lifting-slowing-running(-sfx).mp4` · `cover-B-…png`

**Caption** (127 chars)
> Strength sessions cost this runner 8.8% efficiency and +9 bpm the day after leg day. Recovered by day 3. Now you can see yours.

**Hashtags** `#runtok #hybridtraining #interference #runningtips #strengthtraining`

**Pinned comment**
> Do you run the day after lifting, or leave a gap? Tell me your split and I'll tell you what the data usually shows.

**Sound to pair** Tense, minimal — a ticking hi-hat build or a cinematic pulse (think trailer-style riser) that peaks at 10 s when the radar headline lands. Avoid vocals; the finding is typed on screen and needs the eye.

---

## C · "I built an app that scores you out of 100."

**Files** `ad-C-built-an-app(-sfx).mp4` · `cover-C-…png`

**Caption** (118 chars)
> Built this because no app scored my lifting AND my running together. One number, 0–100, ranked against your bracket.

**Hashtags** `#buildinpublic #indieapp #hybridathlete #fitnessapp #gymtok`

**Pinned comment**
> Founder here. Ask me anything about how the score is calculated — I'll answer every question in this thread.

**Sound to pair** Lo-fi / "build in public" storytelling beats — warm, mid-tempo, no drop. Founder-voice hooks perform on trending storytime sounds; check what's rising under #buildinpublic that week and pick one at 120 BPM.

---

## D · "Strong or fit? Pick one." → "Why not both, measured."

**Files** `ad-D-strong-or-fit(-sfx).mp4` · `cover-D-…png`

**Caption** (101 chars)
> Everyone says you can't be both. Split Index measures both, then shows you exactly where the gap is.

**Hashtags** `#strongandfit #hybridathlete #hyrox #gymandrun #fitnesstok`

**Pinned comment**
> Strong or fit — which one are you honestly better at right now? Vote in the replies: 🏋️ or 🏃

**Sound to pair** A "versus" / debate-style sound with a beat switch — something with a clear two-part structure so the switch lands on "Why not both". Trending audio with a spoken "pick one…" intro would be ideal if one exists that week.

---

## E · "Rate me out of 100 based on my gym AND my 5k."

**Files** `ad-E-rate-me(-sfx).mp4` · `cover-E-…png`

**Caption** (123 chars)
> Rate-me format, but the app does the rating. 145 kg bench, 40:45 5k, 84 kg, 29 — the score is 55.6. Fair or harsh? 👀

**Hashtags** `#rateme #gymtok #5k #hybridathlete #fitnesscheck`

**Pinned comment**
> Post your bench, your 5k, your bodyweight and age. I'll run you through it and reply with your tier.

**Sound to pair** Whatever the current "rate me" / "rate my…" trend sound is — this hook only works if it rides the format. Otherwise a clean, upbeat pop-trap at 120 BPM.

---

## The six formats (`out/formats/`)

Same numbers, different shapes. Use them to test *format* against the film's
*hook* — post one film variant and one format per day for a fortnight and you
have both axes.

| File | Caption (≤150) | Hashtags | Pinned comment | Sound |
|---|---|---|---|---|
| `stat-card(-sfx).mp4` | 145 kg bench. 203 kg deadlift. 40:45 5k. Every number scored, then one number for all of it. Beat these. | `#hybridathlete #gymtok #5k #statcard` | Post your bench, deadlift and 5k under this and I'll reply with your tiers. | Slow, heavy trap or phonk with a drop at 3.5 s for the reveal. |
| `guess-the-tier(-sfx).mp4` | Three numbers, three tiers. Guess before the reveal. Most people get the 5k wrong. | `#guessthetier #gymtok #runtok #hybridathlete` | Comment your guesses BEFORE watching to the end 👀 | Quiz-show ticking / countdown sound; the pause before each answer needs silence or a riser. |
| `the-gap(-sfx).mp4` | 83.7 strength, 27.5 endurance. Same body. 56.2 points apart. How wide is your gap? | `#hybridathlete #strongandfit #gymandrun #hyrox` | How big is your gap, honestly? Strength-heavy or engine-heavy? | Tense minimal beat; a bass hit at 3.5 s and 5 s. |
| `radar-explainer(-sfx).mp4` | Leg day cost this runner 8.8% efficiency and +9 bpm the next morning. Back to normal by day 3. The app worked it out from his own log. | `#runtok #interference #hybridtraining #runningtips` | Do you run the day after legs or leave a gap? | Documentary-style pulse, no vocals. |
| `text-story(-sfx).mp4` | I bench 145. I run a 40-minute 5k. One app scored both. Out of 100: 55.6. | `#pov #gymtok #hybridathlete #fitnesstok` | Rate my 55.6. Be honest. | Whatever deadpan storytime sound is trending; this one is built to ride audio. |
| `micro-loop(-sfx).mp4` | What's your Split Index? | `#splitindex #hybridathlete` | Pin this to the profile. Comment your score when you have one. | A 5 s loop — pick a sound that loops cleanly, or none. |

## Testing order and times (one week, UK)

Post one variant per day, same account, same time band, so each gets a
clean 24 h read. Peak UK fitness engagement is early morning (pre-work
scroll) and 7–9 pm.

| Day | Variant | Post time (UK) | Why this slot |
|---|---|---|---|
| Mon | **A** | 18:30 | Strongest, most self-contained hook — sets the baseline. |
| Tue | **C** | 07:15 | Founder voice suits the morning scroll and builds a comment thread over the day. |
| Wed | **B** | 18:30 | Mid-week is running-heavy; the proof angle needs an evening audience with time to read. |
| Thu | **E** | 20:00 | Rate-me formats are late-evening, high-comment. |
| Fri | **D** | 12:30 | Lunch scroll; debate hooks pick up replies through the weekend. |
| Sat | **short-A** | 10:00 | The 8 s cut-down — test completion rate against Monday's full A. |
| Sun | — | — | Read the numbers. Repost the winner Sun 18:30 with a new sound. |

**What to compare** 3 s hold rate (hook), completion rate, rewatches (loop
seam working?), comments per view (pinned comment doing its job?), profile
visits → App Store taps. Kill anything under the account's median 3 s hold by
Wednesday and reallocate its slot to a second sound on the current leader.

**Covers** Use the matching `cover-<X>-…png` as the TikTok cover so the grid
shows the hook text over the score. Do not use the safe-zone overlay renders
for anything public.

**Claims discipline (UK CAP Code)** Every figure above is computed from the
named demo profile and is described as such on screen ("Computed from 14 paired
sessions in Sam's own log"). Do not generalise them into population claims
("lifting costs runners 8.8%") in captions or replies — say "this profile" or
"in Sam's data". "Free on the App Store" is true of the download; the app has
optional in-app subscriptions, so if a reply asks, say so plainly.
