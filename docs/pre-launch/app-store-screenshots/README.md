# App Store screenshots

Two sets live here. **The designed marketing set below is the one to upload.**
The captioned set further down predates it and is kept because it covers
screens the marketing set does not.

## The designed set — `marketing-6.7-1284x2778/` and `marketing-6.9-1320x2868/`

```bash
node docs/pre-launch/app-store-screenshots/resize-marketing.mjs
```

Five device-frame renders with marketing captions. The originals are 1152x2048
— a 9:16 design-tool canvas, which **App Store Connect does not accept**;
iPhone screenshots are 19.5:9 at exact pixel sizes. Since the target is taller
relative to its width, conforming them is pure vertical padding and no pixel of
the artwork is cropped. Both accepted iPhone sizes are generated: 6.7" is what
this listing already has approved, 6.9" is what a new submission is asked for.

The padding is not a bar. Each edge is mirrored, stretched across the new band
and faded into that edge's average colour, so the extension continues the
existing gradient instead of butting against it. Two of the five sit on
near-white backgrounds and three on near-black, so a single fill colour could
never have worked for all of them. Measured seam discontinuity after the fix is
under 6/255 on every image, and under 2.6 on eight of the ten.

Three things the script had to learn the hard way, all still true if you re-run
it against different artwork:

- **Stretching the single outermost row banded the dashboard render**, because
  its last row is lighter than the rows above it, so a flat smear of it sat at
  the wrong level.
- **Mirroring the full band height printed the headline upside down** at the top
  of that same render — the band is 247px and the headline starts at 240. The
  mirror now samples 96px, which stays inside the margin on all five.
- **The alpha ramp is easy to get backwards.** The opaque end must be the one
  touching the artwork; inverted, it puts the flat colour at the seam and the
  discontinuity jumps to 117/255.

## The captioned set — built from live captures

Captioned 1284x2778 assets for the iPhone 6.7" display size, plus the raw
captures they are built from and the script that builds them.

```bash
node docs/pre-launch/app-store-screenshots/make-shots.mjs
```

Needs `sharp`, which is already a dependency. Output lands next to the script.

## Upload these in slot order

| Slot | File | Caption |
| --- | --- | --- |
| 1 | `1-index.png` | Your lifting and your running in one number |
| 2 | `2-interference.png` | See what leg day does to your running |
| 3 | `3-plan.png` | A week built so they stop fighting each other |
| 4 | `4-lab.png` | Every lift scored, bodyweight-adjusted |

Slots 1-3 are the set that has to work, because search shows only three: the
score, the insight that is unique to this app, and the week it produces. The
Lab is the depth behind slot 1 and can sit fourth.

## The order matters more than the artwork

App Store search results render only the **first three** screenshots. The
product page shows all of them, which is why the existing set looks fine when
you open the listing and shows nothing useful when you search for the app.

As uploaded for 1.0, the live order was:

| Slot | Asset | Seen in search |
| --- | --- | --- |
| 1 | `source/03analytics.png` | yes |
| 2 | `source/04lab.png` | yes |
| 3 | `source/05engine.png` | yes |
| 4 | `source/01dashboard.png` | no |
| 5 | `source/02interference.png` | no |

The source filenames say the intended order was dashboard first, interference
second. Both ended up past the cut, so the three on display were the three
densest analytics screens — the ones that look most like every other training
app. The composite score and the interference radar are the two screens that
say something nothing else says, and neither was visible from search.

Reordering needs no new build and no new binary.

## Known limitations of the source captures

- **Status bar overlap.** Every capture has page content scrolled underneath the
  status bar. The crops in `make-shots.mjs` step around it; a clean re-capture
  would remove the need to.
- **Guideline 2.3 currency.** These are built from the pixels shipped with
  1.0 (5). `../submission-runbook.html` flags four screens that have changed
  since. Re-capture before the next submission or the screenshots will no longer
  match the build.
- **The Hybrid Plan capture was rendered, not photographed.** That screen needs
  an account that has generated a block, so there was no way to reach it in the
  running app. `source/06hybridplan.png` instead comes from a throwaway route
  (`src/app/shotlab`, deleted after capture) that mounted the shipping
  `<PlanView />` against a plan from the real engine — the "Hybrid athlete, dual
  event" persona out of `src/lib/scoring/hpe/personas.test.ts`. Every number in
  it, down to the deadlift percentages and the load ratio, is engine output. It
  was captured in an iPhone 14 Plus simulator, whose 428pt at 3x is 1284x2778
  natively, so nothing in that image is upscaled.

  To redo it: restore the route from this commit's history, run the dev server,
  and open it in a booted iPhone 14 Plus. Note that simulator Safari will not
  apply Turbopack's dev stylesheet, whose chunk name contains `%5B`-encoded
  brackets — inline the CSS into a static copy under `public/` and open that
  instead.
- **Demo account visible in the raw dashboard.** `source/01dashboard.png` opens
  on a greeting row reading `Hi, demo_masters_hybrid` with a truncated subtitle.
  The crop starts below it deliberately.
