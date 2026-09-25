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

## Script 7: "zone 2 running explained"

| Beat | Text |
|---|---|
| hook | zone 2 running explained 👇 |
| set-up | zone 2 = easy. the pace where your body builds the engine instead of just surviving the run. |
| list | heart rate roughly 60–70% of max · talk test: full sentences · it will feel too slow, that's correct · 3–4 runs a week, 30–60 min · watch for same pace, lower heart rate |
| rule | one hard run a week is plenty. the rest stays in zone 2. |
| proof 1 | *real run detail, HR trace + zones* — split index shows my heart-rate trace and zones on every run |
| proof 2 | *real run summary* — pace, avg HR and a score, so i can see the drift week to week |
| close | free on the app store · link in bio |

**Caption** zone 2 running explained 🫀 how to find it, how much to do, what to watch for. save it 👇
**Hashtags** #zone2 #zone2running #runtok #runningtips #hybridathlete
**Pinned** the app is split index (free) — every run gets a heart-rate trace, zones and a score. what's your easy pace? drop it and your avg HR 👇
**Sound** calm, steady; this is a read-along.

## Script 8: "how much should I deadlift"

| Beat | Text |
|---|---|
| hook | how much should you deadlift? 👇 |
| set-up | forget the number. it's a multiple of your bodyweight. rough guide, men: |
| list | beginner 1× · intermediate 1.5× · advanced 2× · elite 2.5×+ · women roughly 0.75 / 1 / 1.5 / 2× |
| rule | 80 kg? 1.5× is 120 kg. that's the target, not what the guy next to you pulls. |
| proof 1 | *real Adaptive 1RM screen* — split index tracks my deadlift 1RM — 200 kg at 78 kg bodyweight |
| proof 2 | *real Lab recording, × bodyweight line* — and scores every lift as × bodyweight against your sex and age |
| close | free on the app store · link in bio |

**Caption** how much should you deadlift? it's a bodyweight multiple, not a number. find yours 👇
**Hashtags** #deadlift #howmuchshouldilift #gymtok #strengthtraining #hybridathlete
**Pinned** the app is split index (free) — every lift is scored as × bodyweight against your sex and age, with a tier. drop your deadlift and bodyweight and i'll tell you your multiple 👇
**Sound** gym-trend audio with a bit of weight to it.

## Script 9: "gym progress tracker app"

The format flips here: the app is the answer, so the list is what a tracker
should show and the proof beats are the app doing each one.

| Beat | Text |
|---|---|
| hook | gym progress tracker app 👇 what it should actually show you |
| list | a score per set, as you log it · a 1RM per lift that moves when you beat it · a session score · strength AND running on one dashboard |
| set-up | this is the one i use. real screens: |
| proof 1 | *set logging* — 1 · type a set, it's scored on the spot |
| proof 2 | *session scored count-up* — 2 · finish, and the session gets a score |
| proof 3 | *Adaptive 1RM* — 3 · a 1RM per lift, steady or climbing |
| proof 4 | *dashboard* — 4 · lifting and running, one score out of 100 |
| close | split index · free on the app store |

**Caption** gym progress tracker app — the 4 things it should show you, on real screens 👇
**Hashtags** #gymprogress #workouttracker #gymapp #gymtok #hybridathlete
**Pinned** it's split index (free on the app store). scores every set as you log it, 1RM per lift, session score, and it does running too. what app are you using now? 👇
**Sound** clean, upbeat; this one reads as a product demo and can carry a brighter track.

## Script 10: "how to lose belly fat gym"

| Beat | Text |
|---|---|
| hook | how to lose belly fat at the gym 👇 |
| set-up | save this. big lifts, one hard cardio session, walk a lot. |
| list | squat or leg press 3×8 · deadlift or RDL 3×6 · bench or push-up 3×10 · row or pulldown 3×10 · 1× a week 20 min intervals · 8–10k steps daily |
| rule | 3 lifts a week, add weight when you hit the top of the range. that's it. |
| proof 1 | *set logging* — i log every set in split index — it scores it as i type |
| proof 2 | *run summary* — and the cardio session too, with a score |
| close | free on the app store · link in bio |

**Caption** how to lose belly fat at the gym 🔥 the plan: 4 lifts, 1 cardio, steps. save it 👇
**Hashtags** #bellyfat #gymplan #fatloss #gymtok #hybridathlete
**Pinned** the app is split index (free) — scores every set and every run so you can see the weight going up. how many days a week can you train? i'll split it for you 👇

## Script 11: "what is a good 5k time for my age"

| Beat | Text |
|---|---|
| hook | what's a good 5k time for your age? 👇 |
| set-up | rough guide for regular runners. men first, women add about 3 min. |
| list | 20s 22–25 · 30s 23–26 · 40s 24–27 · 50s 26–29 · 60+ 28–32 · under 20 min at any age: fast |
| rule | the only time that matters is your last one. beat that. |
| proof 1 | *dashboard, predicted race times* — split index predicts my 5k from my runs — 18:52 — and grades it by sex and age |
| proof 2 | *run session score* — every run gets a score against people your age |
| close | free on the app store · link in bio |

**Caption** what's a good 5k time for your age? rough guide by decade — where are you? 👇
**Hashtags** #5k #5ktime #runtok #runningtips #hybridathlete
**Pinned** the app is split index (free) — it predicts your 5k from your logged runs and scores every run against your sex and age. drop your age and 5k time 👇

## Script 12: "how to start running"

| Beat | Text |
|---|---|
| hook | how to start running 👇 |
| set-up | 3× a week, 20–30 min. walk and run. slower than you think. |
| list | wk 1 run 1 / walk 2 ×8 · wk 2 run 2 / walk 2 ×6 · wk 3 run 4 / walk 1 ×5 · wk 4 run 8 / walk 1 ×3 · then 20 min without stopping |
| rule | if you can't talk while running, slow down. every run, until it feels easy. |
| proof 1 | *run summary* — i log every run in split index — distance, pace, heart rate |
| proof 2 | *run session score* — and a score from your very first run, so you can watch it climb |
| close | free on the app store · link in bio |

**Caption** how to start running 🏃 the first 4 weeks, walk/run, 3× a week. save it 👇
**Hashtags** #howtostartrunning #beginnerrunner #runtok #couchto5k #runningtips
**Pinned** the app is split index (free) — every run gets distance, pace, heart rate and a score from day one. which week are you on? 👇

## Script 13: "push pull legs split"

| Beat | Text |
|---|---|
| hook | push pull legs split 👇 |
| set-up | 3 days, repeat. the whole thing on one screen. |
| list | push: bench 6–8, OHP 8–10, incline db 10, pushdown 12 · pull: deadlift or row 6, pull-up 8–10, face pull 15, curl 12 · legs: squat 6–8, RDL 8–10, leg press 10–12, calf raise 15 |
| rule | run it 6 days a week, or 3. never 4 — you'll always miss a day. |
| proof 1 | *real Pull session* — my pull day in split index — every lift scored, 1RM per exercise |
| proof 2 | *Adaptive 1RM list* — and a 1RM list that tells you which lift is stalling |
| close | free on the app store · link in bio |

**Caption** push pull legs split 🏋️ all 3 days with the lifts, sets and reps. save it 👇
**Hashtags** #pushpulllegs #ppl #gymsplit #gymtok #hybridathlete
**Pinned** the app is split index (free) — scores every set and gives every lift its own 1RM, so you can see which day is moving. 6 days or 3? 👇

## Next gaps to check in Creator Search Insights

The first ten are scripted. Candidates for the next batch, same shape:
"how long to see gym
results", "running for weight loss", "how to increase squat", "how to
train for a half marathon", "beginner gym plan", "hyrox stations
explained", "protein how much", "how to run without getting tired".

## Claims

Every video: general information, not medical advice, on screen in the last
beat. No before/after, no rates ("lose X in Y"), no "burns fat" phrasing.
App claims stay to what the screen shows.
