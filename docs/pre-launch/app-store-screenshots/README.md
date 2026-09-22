# App Store screenshots

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
