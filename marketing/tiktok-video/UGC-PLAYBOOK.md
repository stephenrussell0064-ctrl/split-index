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
2. **Decide the honest answer.** Most gaps exist because the honest answer is
   less exciting than the myth. The honest version is the angle: it stands
   out, it survives the comments, and it is the only version that passes the
   CAP Code. Never promise a result, a rate or a timeline.
3. **Write the script** as a file in `src/ugc/scripts/` (copy `arm-fat.ts`).
   Six to nine beats, 22–28 s. Shape: hook with the search phrase → the
   correction → the actual method (a list) → the proof → the app as the way
   to see the proof → soft close. Register it in `src/ugc/index.ts`.
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

## First script: "arm fat loss exercises"

The gap promises spot reduction. The honest version:

| Beat | Text |
|---|---|
| hook | arm fat loss exercises 👇 the honest version |
| correction | you can't pick where fat comes off. no exercise burns arm fat specifically. |
| step 1 | so step 1 isn't an exercise. it's eating a bit less than you burn, and enough protein. |
| step 2 | step 2 is building the arm, so it looks tight as the fat drops: |
| list | 3× a week, 3 sets each — tricep pushdown 10–12 · overhead tricep extension 10–12 · close-grip bench or dips 6–8 · curls 10–12 (yes, biceps too) |
| step 3 | step 3 is the only proof it's working: the weight goes up over weeks. |
| proof | *real Lab recording: Preacher Curl, Dumbbell Curl, Cable Lateral Raise scored, 1RM per lift* — "i log mine in split index — every lift gets a score and a 1RM that climbs" |
| close | free on the app store · link in bio · general information, not medical advice |

**Caption** arm fat loss exercises — the honest version. you can't spot reduce, but you can make the arm look tight while the fat comes off. saved this? 👇
**Hashtags** #armfat #armworkout #fatloss #gymtok #hybridathlete
**Pinned** the app in the video is split index (free). it scores every set and shows your 1RM climbing — which is the only proof step 2 is working. ask me anything about the exercises 👇
**Sound** a calm trending "storytime" or lo-fi beat; this format is read, not watched, so nothing with a drop.

## Ten more gaps worth scripting

Same shape each time. Check each phrase in Creator Search Insights first;
the list is a starting point, not a result.

| Search phrase | Honest angle | Where the app appears |
|---|---|---|
| how to run faster 5k | it's mostly easy volume, one hard session, and a tempo; not sprints | predicted race times card, 18:52 |
| bench press not going up | plateaus are usually volume or recovery, not technique | adaptive 1RM "Steady" vs "Best" |
| is running bad for gains | interference is real but small and mostly about the day after | Interference Radar, +3.7 % |
| hybrid athlete training split | 3 lift / 3 run, the running easy, one hard | Hybrid Plan week view |
| how to lose belly fat gym | same spot-reduction correction, different body part | any Lab score screen |
| what is a good 5k time for my age | age-graded tables, honestly | Engine score by sex and age |
| how much should I be able to deadlift | bodyweight multiples, not absolute numbers | per-lift "×bodyweight" line |
| zone 2 running explained | HR, not pace; the app's zones chart | Engine run detail, zones |
| gym progress tracker app | what to actually track: e1RM trend, not volume | Lab session history |
| hyrox training plan | strength and running on one calendar | Hybrid Plan block |

## Claims

Every video: general information, not medical advice, on screen in the last
beat. No before/after, no rates ("lose X in Y"), no "burns fat" phrasing.
App claims stay to what the screen shows.
