# UGC playbook — content gaps → faceless videos

The film sells the app. This format does something different: it answers a
question people are already typing into TikTok search, in TikTok's own
un-produced caption style, and lets the app appear once, as the proof at the
end. Search-led videos keep getting served for weeks after posting, which is
where the compounding comes from.

## The loop

1. **Find the gap.** TikTok → Creator tools → Creator Search Insights → filter
   by *Content gap* and your niche (gym, running, hybrid). Write down the exact
   phrase people search. That phrase is the title of the video and must appear
   in the hook and the caption, spelt the way they search it.
2. **Decide the answer.** Give the search exactly what it asked for — a
   saveable list with sets, reps or a weekly shape — and keep the wording to
   what people search ("for arm fat", "faster 5k") rather than result claims
   ("burns fat", "lose X in Y"). No rates, no timelines, no before/after.
3. **Write the script** as a file in `src/ugc/scripts/` (copy `arm-fat.ts`).
   Six to nine beats, 22–28 s. Shape: hook with the search phrase → set-up
   → the list → one rule for progressing → the app as the proof → soft close. Register it in `src/ugc/index.ts`.
4. **Render.** `npm run render -- --ugc` → `out/ugc/ugc-<slug>(-sfx).mp4`.
5. **Post** with the caption and pinned comment from the script file, 3–5
   hashtags, and a trending sound under the silent master. Reply to every
   comment in the first hour; the pinned comment should ask a question.
6. **Read it after 48 h.** Search-led videos are slow burners: judge on
   7-day views and saves, not the first-hour hold rate the film is judged on.

## What the format looks like

- TikTok's caption style: heavy sans (Inter 800), white, thick black outline,
  lowercase, centred — the same look as text typed in the TikTok editor.
- Words pop in one at a time; the frame drifts by a few pixels like a hand
  holding a phone. No grade, no whip transitions, no bloom.
- Behind the words: the real app, blurred and dimmed. In the proof beat the
  real app is sharp and full-bleed with "real screen recording" in the corner.
- The close is the wordmark, Apple's badge, one line, and the disclaimer.

## Script 1: "arm fat loss exercises"

Straight list. Hook carries the search phrase, then four moves with sets and
reps, the one progression rule, the app as the way to see the weight climb.

| Beat | Text |
|---|---|
| hook | best arm exercises for arm fat 👇 |
| set-up | save this. 4 moves, 3× a week, 3 sets each. |
| list | the arm fat workout — tricep pushdown 12–15 · overhead tricep extension 10–12 · close-grip bench or dips 8–10 · hammer curls 10–12 |
| rule | hit the top of the rep range? add weight next time. that's what changes your arms. |
| proof | *real Lab recording* — i log every set in split index — it scores the lift and shows my 1RM going up |
| close | free on the app store · link in bio |

**Caption** arm fat loss exercises 💪 4 moves, sets and reps. save it for your next session 👇
**Hashtags** #armfat #armworkout #tonedarms #gymtok #fitnesstok
**Pinned** the app is split index (free) — it scores every set and tracks your 1RM so you can see the weight going up week to week. which move do you want a form video on? 👇
**Sound** calm trending lo-fi or storytime beat; the video is read, not watched.

## Script 2: "how to run faster 5k"

| Beat | Text |
|---|---|
| hook | how to run a faster 5k 👇 |
| principle | most of your running should feel easy. that's where the engine gets built. |
| list | the week that drops your 5k — 3× easy runs 30–45 min · 1× intervals 6 × 800 m hard, 2 min jog · 1× tempo 20 min comfortably hard · 1× long run 60 min easy |
| rule | then race it every 4–6 weeks. same route, all out. the time is your feedback. |
| proof 1 | *real dashboard, predicted race times* — split index predicts my 5k from the runs i log — 18:52 right now |
| proof 2 | *real run detail* — every run gets splits, heart rate and a score |
| close | free on the app store · link in bio |

**Caption** how to run a faster 5k 🏃 the week that actually drops your time. save it 👇
**Hashtags** #5k #runfaster #runtok #runningtips #hybridathlete
**Pinned** the app is split index (free) — it predicts your 5k from your logged runs and scores every run. drop your current 5k time and i'll tell you which session to add 👇
**Sound** upbeat but steady; a running-trend sound if one is live that week.

## Ten more gaps worth scripting

Same shape each time. Check each phrase in Creator Search Insights first;
the list is a starting point, not a result.

| Search phrase | Angle | Where the app appears |
|---|---|---|
| bench press not going up | plateaus are usually volume or recovery, not technique | adaptive 1RM "Steady" vs "Best" |
| is running bad for gains | interference is real but small and mostly about the day after | Interference Radar, +3.7 % |
| hybrid athlete training split | 3 lift / 3 run, the running easy, one hard | Hybrid Plan week view |
| how to lose belly fat gym | a compound-lift list, sets and reps | any Lab score screen |
| what is a good 5k time for my age | age-graded tables | Engine score by sex and age |
| how much should I be able to deadlift | bodyweight multiples, not absolute numbers | per-lift "×bodyweight" line |
| zone 2 running explained | HR, not pace; the app's zones chart | Engine run detail, zones |
| gym progress tracker app | what to actually track: e1RM trend, not volume | Lab session history |
| hyrox training plan | strength and running on one calendar | Hybrid Plan block |

## Claims

Every video: general information, not medical advice, on screen in the last
beat. No before/after, no rates ("lose X in Y"), no "burns fat" phrasing.
App claims stay to what the screen shows.
