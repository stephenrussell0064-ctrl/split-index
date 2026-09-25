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

## Script 3: "bench press not going up"

| Beat | Text |
|---|---|
| hook | bench press not going up? 👇 |
| set-up | it's almost always one of these four. fix the one that's you. |
| list | why your bench is stuck — not enough sets · aim 10–15 hard sets a week · same weight every session · add 2.5 kg or 1 rep · no back-off work · 3×8 at 70% after your top set · sleep + food |
| rule | run the fix for 6 weeks before you change anything else. |
| proof 1 | *real Adaptive 1RM screen* — split index tracks my 1RM per lift — flat line means stalled, before i feel it |
| proof 2 | *real set logging* — and every set gets scored as i type it |
| close | free on the app store · link in bio |

**Caption** bench press not going up? it's one of these 4 🔒 save it and fix yours 👇
**Hashtags** #benchpress #benchpressplateau #gymtok #strengthtraining #hybridathlete
**Pinned** the app is split index (free) — it tracks your 1RM per lift and shows whether it's climbing or flat. drop your current bench and how many sets a week you do and i'll tell you which of the 4 it is 👇
**Sound** something with a bit of grit; gym-trend audio if one is live.

## Script 4: "is running bad for gains"

| Beat | Text |
|---|---|
| hook | is running bad for gains? 👇 |
| set-up | not if you run it like this. 4 rules. |
| list | run without losing gains — keep most runs easy · lift first, or split by 6+ hours · protein 1.6–2 g per kg, don't cut hard · one hard run a week, not three |
| rule | then actually check: do your lifts drop in heavy running weeks, or not? |
| proof 1 | *real Interference Radar screen* — split index checks mine — heavy cardio weeks, strength score +3.7%. no loss. |
| proof 2 | *real run detail* — every run and every lift, scored on one timeline |
| close | free on the app store · link in bio |

**Caption** is running bad for gains? 4 rules so it isn't — and the app that checks your own numbers 👇
**Hashtags** #hybridathlete #runningandlifting #gymtok #runtok #cardioandgains
**Pinned** the app is split index (free) — its interference radar compares your strength scores in heavy vs light running weeks, from your own logs. do you lift and run the same day? 👇
**Sound** debate-style or "hot take" trending audio; this one is built for the comments.

## Script 5: "hybrid athlete training split"

| Beat | Text |
|---|---|
| hook | hybrid athlete training split 👇 |
| set-up | 3 lifts, 3 runs, 1 rest. here's the week. |
| list | mon upper lift · tue easy run 30–45 min · wed lower lift · thu intervals or tempo · fri full body lift · sat long run, easy · sun rest |
| rule | hard run and lower day never back to back. that's the only rule. |
| proof 1 | *real Hybrid Plan week view* — split index builds my week — 5 sessions, 2 rest, from my own lifts and runs |
| proof 2 | *real Targets screen* — with the targets on screen: 5k 18:22 → 18:00, squat 127 → 150 |
| close | free on the app store · link in bio |

**Caption** hybrid athlete training split 🏋️🏃 3 lifts, 3 runs, 1 rest. save the week 👇
**Hashtags** #hybridathlete #hybridtraining #hyrox #gymtok #runtok
**Pinned** the app is split index (free) — the hybrid plan builds a block toward your event from your own lifts and runs, targets on screen. what's your event? 👇
**Sound** steady, motivational; a Hyrox-trend sound if one is live.

## Script 6: "hyrox training plan"

| Beat | Text |
|---|---|
| hook | hyrox training plan 👇 |
| set-up | 8 runs, 8 stations. train running tired, not just running. |
| list | mon lower strength · tue easy run 40 min · wed station circuit · thu run + station intervals 1 km, station, ×4 · fri upper + carries · sat long run 60–75 min · sun rest |
| rule | 8 weeks out, make thursday the priority. that's the race. |
| proof 1 | *real Hybrid Plan week view* — split index builds the block toward your event date — week 1 of 5, base |
| proof 2 | *real Targets screen* — targets on screen so the gap is visible: 5k 18:22 → 18:00 |
| close | free on the app store · link in bio |

**Caption** hyrox training plan 🏁 the week, day by day, 8 weeks out. save it 👇
**Hashtags** #hyrox #hyroxtraining #hybridathlete #hyroxprep #gymtok
**Pinned** the app is split index (free) — the hybrid plan builds a block toward your event date from your own lifts and runs. when's your hyrox? 👇
**Sound** whatever is trending under #hyrox that week; this audience has its own sounds.

## More gaps worth scripting

Same shape each time. Check each phrase in Creator Search Insights first;
the list is a starting point, not a result.

| Search phrase | Angle | Where the app appears |
|---|---|---|
| how to lose belly fat gym | a compound-lift list, sets and reps | any Lab score screen |
| what is a good 5k time for my age | age-graded tables | Engine score by sex and age |
| how much should I be able to deadlift | bodyweight multiples, not absolute numbers | per-lift "×bodyweight" line |
| zone 2 running explained | HR, not pace; the app's zones chart | Engine run detail, zones |
| gym progress tracker app | what to actually track: e1RM trend, not volume | Lab session history |

## Claims

Every video: general information, not medical advice, on screen in the last
beat. No before/after, no rates ("lose X in Y"), no "burns fat" phrasing.
App claims stay to what the screen shows.
