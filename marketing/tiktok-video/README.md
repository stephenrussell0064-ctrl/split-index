# Split Index — TikTok launch ad

A 22 s, 1080×1920, 30 fps, loopable launch film for the Split Index iOS app,
built in [Remotion](https://remotion.dev) 4.0.528. One composition, five hook
variants, an 8 s cut-down, a cover still per variant, and a posting kit.

This is a **separate project** from the Next.js app: its own `package.json`,
its own React, its own `tsconfig.json`. It reads the app's scoring engines at
build time (see *Numbers*) and modifies nothing in `src/`.

```bash
cd marketing/tiktok-video
npm install
npm run studio          # Remotion Studio — pick SplitIndexAd, change `hook` in the props panel
npm run render          # everything into ./out at full quality (H.264, CRF 16)
```

## Deliverables (`out/`)

| File | What |
|---|---|
| `ad-A-bench-elite-5k-beginner.mp4` … `ad-E-rate-me.mp4` | five silent masters — add the sound natively in TikTok |
| `ad-<X>-<slug>-sfx.mp4` | the same five with the sound-design track |
| `short-A-bench-elite-5k-beginner(-sfx).mp4` | 8 s cut-down of A: hook → score reveal → CTA |
| `cover-<X>-<slug>.png` | 1080×1920 cover: the score-reveal moment with the hook text |
| `formats/<format>(-sfx).mp4` | six alternative formats, same numbers, different shape — see *Formats* |
| `split-index-tiktok-pack.zip` | everything above in one download (`npm run pack`) |

The `.mp4` files are not committed (`.gitignore`); the covers are. Regenerate
with `npm run render`, or one variant with `npm run render -- --only B`, or
quarter-resolution drafts of everything with `npm run render:drafts`.

## UGC (`src/ugc/`) — search-led faceless videos

A different job from the film: answer a question people already type into
TikTok search (Creator Search Insights → content gaps), in TikTok's own
caption style, with the real app appearing once as the proof. Each gap is a
script file in `src/ugc/scripts/`; `Ugc.tsx` renders any of them.
`npm run render -- --ugc` → `out/ugc/`. The workflow, the first script
("arm fat loss exercises", the honest version) and ten more gaps to try are in
**UGC-PLAYBOOK.md**.

## Real-footage film (`src/real/`) — the one to post

The synthetic film and formats above redraw the app's screens from tokens.
`RealAd` does not: every frame inside the phone is the actual app — screen
recordings (`public/real/clips/`, untouched apart from a drawn bar over the iOS
status bar, which carried the red recording pill) and unedited screenshots the
camera pans across (`public/real/screens/`). Same beat grid, hooks, grade and
end-card; different footage. Rendered by `npm run render -- --real` into
`out/real/`.

| Beat | What is on screen | Source |
|---|---|---|
| TENSION | bench sets typed and scored live · run splits / HR trace · a Pull session's per-lift scores · collision | `set-scoring.mp4`, `engine.mp4`, `lab.mp4` |
| REVEAL | logging a set → the app's own "SESSION SCORED" counter running 0 → 77.7 → the real dashboard: **75.9 Advanced**, Engine 70.1, Lab 81.7, predicted 5k **18:52**, bench **133 kg**, deadlift **200 kg** | `set-scoring.mp4`, `session-done.mp4`, `the-dashboard-3.png` |
| USP | the real Interference Radar page: "Does cardio weaken your lifting?" **+3.7 %**, 777 vs 806, 13 gym sessions | `interference-radar-1.png` |
| STATUS | the bracket leaderboard (Male · 20-24 · 80-90kg · #3 of 6) → race records: 5k **18:25**, 10k 49:39, DOTS 319.8 | `first-finding.mp4` frame, `data-analytics-2.png` |

**Whose numbers.** The screenshots are @split_index_ceo's real account
(profile verified read-only against the database on 24 Sep 2026: male, 78 kg,
id prefix `f0c63c26`; `scripts/verify-real.mts`). The *recordings* are of a
second, near-empty test account and show that account's session scores
(77.5, 79.4, 77.7); they are used for motion, and no caption quotes a number
from them. `src/real/data.ts` lists every figure with the file it is read off.
A caption only quotes a number while that file is on screen.

**Why the radar says "+3.7 %" and not a cost.** That is what the real account's
radar shows: 13 gym sessions, heavy-cardio weeks slightly *up*. The upper
half of the page (cardio efficiency after lifting) has two sessions and is
flagged EARLY DATA by the app, so the film leads with the finding that has the
data. "Mine: no. Yours might differ." is the honest version of the pitch.

**Hooks** (`src/real/hooks.ts`): A "133 kg bench. 18:25 5k. One score." ·
B "Is 75.9 good for a hybrid athlete?" · C "I built an app that scores hybrid
athletes." · D "Strong or fit? Pick one." · E "Rate my bench AND my 5k."

**To make it better, record these** (portrait, screen-record on the phone,
the real account, no email or password on screen):
1. Dashboard: open the app cold and let the 75.9 count up, then scroll slowly
   to the predicted race times and 1RM. 10 s.
2. The Lab: log one real bench set and tap Score workout, all the way to the
   "SESSION SCORED" counter. 15 s.
3. Interference page: open it from More, scroll top to bottom. 10 s.
4. Leaderboard → My Bracket, scroll. 8 s.
5. A GPS run finishing: the Finish tap and the score screen. 10 s.
Drop them in `public/real/clips/`, add a line to `CLIPS` in `src/real/data.ts`
with a frame-accurate note of what is on screen when, and swap them in.

## Formats (`src/formats/`)

The film is one shape. These are the same computed numbers in five other
TikTok-native shapes plus a teaser, rendered by `npm run render -- --formats`:

| id | file | length | what it is |
|---|---|---|---|
| `Fmt-StatCard` | `formats/stat-card.mp4` | 12 s | the stat-card format that circulates in hybrid TikTok — lifts, 5k, Lab/Engine reveal a line at a time, then the one number only this app adds |
| `Fmt-Quiz` | `formats/guess-the-tier.mp4` | 14 s | "guess the tier" — three questions, the engine answers each; the pause is the comment bait |
| `Fmt-TugOfWar` | `formats/the-gap.mp4` | 10 s | Lab bar from the left, Engine bar from the right, the 56.2-point gap between them, then the Split Index |
| `Fmt-RadarExplainer` | `formats/radar-explainer.mp4` | 13 s | the Interference Radar finding as a mini-explainer: question, −8.8 %, per-day bars, the engine's sentence, sample size |
| `Fmt-TextStory` | `formats/text-story.mp4` | 11 s | POV / confession meme — type only, one line at a time, then the number |
| `Fmt-MicroLoop` | `formats/micro-loop.mp4` | 5 s | odometer 0 → 55.6, tier slam, "What's yours?", resets — a rewatch loop and profile-pin teaser |

Each has a `FmtSfx-*` twin with the sound track and a `-sfx.mp4` render.
Every format ends on the same end-card (wordmark, Apple badge, "Free on the
App Store") and carries the line "Sam · male · 29 · 84 kg · demo profile" so
nobody mistakes the numbers for a population claim. Shared furniture is in
`src/formats/shared.tsx`; each format exports its own `*_CUES` list, which is
the whole sound design for that piece.

## Numbers — where every figure comes from

Nothing on screen is typed in. The pipeline is:

```
demo-profile.ts   →   scripts/compute-demo.ts   →   src/data/demo.json   →   the compositions
 (inputs only)        (the app's real engines)        (generated, committed)
```

`demo-profile.ts` defines a fictional athlete — **Sam (@sam_benches), male, 29,
84 kg** — as *inputs*: an 11-week block of Monday push / Saturday legs & pull
sessions with set weights and reps, Tuesday and Friday easy 5 km runs with heart
rates, an all-out 5k time trial, plus 23 fictional bracket-mates as lifts and 5k
times. `npm run compute` runs those inputs through the app's own pure modules:

| Function | File in the app | Produces |
|---|---|---|
| `scoreStrength`, `labIndex`, `tierForScore` | `src/lib/scoring/split-strength-engine.ts` | per-lift score and tier (bench 145×3 → **89.9 Elite**), Lab session index |
| `scoreCardioActivity` | `src/lib/scoring/cardio-activity.ts` | run scores, efficiency factor, TRIMP (5k 40:45 → **22.3 Beginner**) |
| `computeIndexes` | `src/lib/scoring/index-engine.ts` | Lab **83.7**, Engine **27.5**, Split Index **55.6 → Semi-Pro** |
| `computeInterferenceReport`, `pickHeadlineBucket` | `src/lib/scoring/interference.ts` | the radar finding: *"Strength sessions cost you roughly 8.8% efficiency and +9bpm on running the next day, recovering by day 3."* (14 paired sessions, confident) |
| `formatIndex` | `src/lib/utils/format.ts` | the /100 display strings |
| `ageBandFor`, `weightBandFor`, `formatExactBracketLabel`, `resolveBracket` | `src/lib/social/leaderboard-brackets.ts` | **Male · 25-34 · 80-90kg**, 24 peers, exact bracket |

Ranks are a sort of the 24 computed Split Index values; Sam is **#16 of 24**.

The compute step **asserts the hook claims** (`claims` in `demo.json`: bench is
Elite, the 5k is Beginner, the interference finding is a real cost with full
confidence) and exits non-zero otherwise — `npm run render` runs it first, so a
render cannot ship a claim the engine did not make. If you want a different
story, change the inputs in `demo-profile.ts` and recompute; never edit
`demo.json` by hand.

The compute script is run with `tsx --tsconfig ../../tsconfig.json` because the
engines import each other through the app's `@/` alias.

## Structure and timing

Every timing is a named constant in `src/timing.ts`. The edit is quantised to
**120 BPM** — one beat = 15 frames at 30 fps — so every cut lands on an integer
frame and a 120/240 BPM track laid over the top in TikTok sits on the cuts.

| Beat | Frames | Scene | File |
|---|---|---|---|
| 0–3 | 0–45 | HOOK — words slam in, motion on frame 1, no logo | `scenes/Hook.tsx` |
| 3–8 | 45–120 | TENSION — Lab vs Engine, a cut per beat, collision on beat 7 | `scenes/Tension.tsx` |
| 8–18 | 120–270 | REVEAL — 3D phone, set logged, Save, riser, odometer 0→55.6, tier slam | `scenes/Reveal.tsx` |
| 18–28 | 270–420 | USP — Interference Radar opens, −8.8% lands, finding types on | `scenes/Usp.tsx` |
| 28–36 | 420–540 | STATUS — bracket leaderboard scrolls, Sam's row climbs to #16 | `scenes/Status.tsx` |
| 36–42 | 540–630 | CTA — "What's your Split Index?", Apple badge, "Free on the App Store" | `scenes/Cta.tsx` |
| 42–44 | 630–660 | LOOP — everything pulled into black; last frame = frame 0 | `scenes/Cta.tsx` (`exitAt`) |

Sub-beats (`REVEAL.countStart`, `USP.headline`, `STATUS.climbEnd`…) live in the
same file and drive both picture and sound.

**Compositions** (`src/Root.tsx`): `SplitIndexAd` (parametrised: `hook`,
`safeZone`, `sfx`), `Ad-A…E` (silent masters), `AdSfx-A…E`, `Short-A`,
`ShortSfx-A`, and stills `Cover-A…E`.

**Hooks** are in `src/hooks.ts`. `*word*` renders Lab green, `_word_` Engine
blue. Variant D carries a `subvert` line that lands at the top of TENSION.

**Safe zone**: `safeZone: true` draws TikTok's covered areas (top 160, bottom
420, right 140) as hatching and the 900×1340 readable rectangle as a dashed
outline. Captions live in a fixed slot ending at y = 1452; everything that has
to be read is laid out inside `SAFE_RECT`. Never render the overlay into a
deliverable.

## Treatment

- **Spring physics** on every move (`fx/index.tsx`: `SPRING_SLAM`, `SPRING_SETTLE`,
  `SPRING_CAMERA`, `SPRING_POP`); exponential speed ramps into reveals.
- **Motion blur**: `@remotion/motion-blur` — `Trail` on the slamming hook words
  and the leaderboard scroll, `CameraMotionBlur` on the six-frame whip into each
  scene (`WhipIn` in `Ad.tsx`).
- **Flash frames** (3 f) on every cut, harder on impacts; **screen shake** and
  **chromatic aberration** (an RGB split rendered only on impact frames) on the
  tension collision, the tier slam and the radar headline.
- **Grain** re-seeded per frame, **vignette**, **anamorphic light streaks** in
  brand colours, **bloom** that grows with the score, **defocused** background
  layers for depth.
- Palette: strictly the app's tokens (`src/theme.ts`, copied from
  `src/app/globals.css` / `src/lib/design/tokens.ts`) — `#3dff6e` Lab green,
  `#3ba6ff` Engine blue (+ soft variants), black `#060606`, white `#fafafa`,
  the Engine surface `#f7fbff`. Fonts are the app's: Unbounded (display),
  Space Grotesk (body), Geist Mono (data), via `@remotion/google-fonts`.

## Sound design (`public/sfx/`)

The master is **silent**. The `-sfx` renders carry a track built from these
eight files, all **synthesised from oscillators and filtered noise by
`scripts/gen-sfx.mjs`** (`npm run sfx`). There are no samples, no downloads and
nothing to attribute — the licence is: made here, owned here.

| File | What | Where it plays |
|---|---|---|
| `bass-hit.wav` | 140→38 Hz sine drop + click | each hook line, radar headline, leaderboard landing |
| `slam.wav` | bass + crushed noise burst | collision, tier badge |
| `whoosh.wav` / `whoosh-rev.wav` | band-pass swept noise, L→R and R→L | tension cuts, scene whips |
| `whip.wav` | 160 ms high-passed noise | flash frames |
| `riser.wav` | 1.6 s rising tone + noise | into the score count |
| `tick.wav` | 35 ms 2.2 kHz burst | one per ones-digit change on the odometer (`score-curve.ts` — the same curve the picture uses) |
| `shimmer.wav` | soft detuned pad | CTA hold |

## Apple badge

`public/app-store-badge-en-gb.svg` is Apple's own "Download on the App Store"
badge (black, en-GB), downloaded unaltered from Apple's badge service at
`tools.applemediaservices.com` on 24 Sep 2026. It is rendered with `<Img>` at
136 px tall with a quarter-height clear space, never redrawn or recoloured.
Apple's licence for the badge applies (App Store Marketing Guidelines); the app
is live at `https://apps.apple.com/gb/app/split-index/id6809234984`
(`src/lib/app-store.ts`).

## Claims (UK CAP Code)

- Every score, tier, delta and rank is computed by the app's engines from the
  named profile and is labelled as such on screen ("Computed from 14 paired
  sessions in Sam's own log"). Nothing is a population statistic; no
  "X% of users" claims appear because none could be derived from real data.
- "Ranked against your age, sex and bodyweight" describes the bracket feature
  (`leaderboard-brackets.ts`). The app widens a bracket below 20 peers
  (`MIN_BRACKET_SIZE`); the demo bracket has 24, so what is shown is the exact
  bracket, as the app would show it.
- "Free on the App Store" — the download is free; the app has optional in-app
  subscriptions. The posting kit tells you to say so if asked.
- "One score" / "out of 100" — the app's own copy ("Strength + endurance, out of
  100", `index-hero.tsx`).

## Why the synthetic demo athlete runs a 40:45 5k

Because the brief's default hook was "Your bench says Elite. Your 5k says
Beginner", and the compute step refuses to render a hook the engine cannot
substantiate. Beginner on the 5k table means slower than 38:30, so the
fictional Sam had to run 40:45. It is a true statement about a fictional
profile, and it is not a hybrid athlete's number. The real-footage film is
the answer to that: 18:25 and 133 kg, both the account's own. If you want
the synthetic films to carry a faster runner, change `FIVE_K_TIME_TRIAL`
in `demo-profile.ts` and drop hook A (its assertion will fail, by design).

## What could not be done, honestly

- **No footage.** `/assets/footage` does not exist in the repo, so TENSION is
  abstract kinetic graphics (spinning plate, pace line, heart-rate trace) with
  no numbers in them. There is real screen-recorded footage of the app in the
  sibling project `marketing/video/public/clips/` — it was not used here
  because the brief asked for a self-contained folder and for numbers driven by
  the demo profile, and a recording shows someone else's numbers.
- **The app's React components do not render outside Next.js.** `IndexHero`,
  `LeaderboardPanel`, `InterferenceRadarCard` depend on `next/link`, Tailwind
  classes compiled by the app's PostCSS pipeline, framer-motion and app-shell
  context. The phone screens in `src/components/AppScreens.tsx` are
  **recreations** built from the same tokens, copy and layout — every string
  and number on them is the app's, the JSX is not.
- **"Out of 1000" → "out of 100".** The brief describes a 0–1000 score and
  hooks C and E said "out of 1000". The app computes on 0–1000 but displays
  every score out of 100 (`formatIndex`, "out of 100" on the dashboard). The
  hooks were changed to "out of 100" so the promise matches the number that
  appears a second later (55.6). Change them back in `src/hooks.ts` if you
  disagree, but the on-screen score will still read 55.6.
- **The leaderboard cohort is fictional inputs.** The 23 other rows are
  invented handles with invented lifts and 5k times, scored by the real
  engines. Their *scores* are real engine output; the *people* are not. The
  bracket is described as Sam's on screen and nothing claims they are real
  users.
- **The 3D phone is CSS 3D, not `@remotion/three`.** A perspective-transformed
  slab with a bezel, Dynamic Island and rim light does the job at this scale;
  the Three.js dependency was installed, found unnecessary, and removed.
- **Root typecheck.** The repo's `tsconfig.json` excludes `marketing/video` but
  not this folder, and its `include` is `**/*.tsx`. The root `npx tsc` will now
  also type-check `marketing/tiktok-video/src` against the app's config and
  fail on Remotion imports the app has not installed. The fix is one line —
  add `"marketing/tiktok-video"` to the root `exclude` — but that file is app
  config with uncommitted changes from another session, so it was left alone.
  Do it in the app's next commit.
- **Remotion licence.** Remotion is free for individuals and companies of up
  to three people; beyond that a company licence is required
  (`remotion.pro/license`). Nothing here enforces it.
- **Renders are slow-ish.** `CameraMotionBlur` samples each whip frame six
  times and `Trail` layers the hook words and the scroll; a full-quality
  master takes a few minutes on a laptop. `npm run render:drafts` for review.
- **Music is not included** — by design. TikTok's Commercial Music Library is
  the licensed route; the posting kit says what kind of sound to pick per hook.

## Files

```
demo-profile.ts          the named demo profile — INPUTS only
scripts/compute-demo.ts  runs the app's engines → src/data/demo.json, asserts the claims
scripts/gen-sfx.mjs      synthesises public/sfx/*.wav
scripts/render-all.mjs   npm run render
src/timing.ts            BPM, beat map, scene and sub-beat constants, safe zone
src/hooks.ts             the five hook variants
src/theme.ts             brand tokens and fonts, copied from the app
src/data.ts              typed view of demo.json
src/score-curve.ts       the count-up curve shared by odometer and SFX ticks
src/fx/                  grain, vignette, flash, shake, aberration, streaks, bloom, springs
src/components/          KineticText, Captions, Odometer, Phone, AppScreens, Radar, Leaderboard, Brand, SafeZone
src/scenes/              Hook, Tension, Reveal, Usp, Status, Cta
src/Ad.tsx               the film (and the 8 s cut-down)
src/Cover.tsx            the cover still
src/Sfx.tsx              the sound-design track
src/Root.tsx             compositions
```
