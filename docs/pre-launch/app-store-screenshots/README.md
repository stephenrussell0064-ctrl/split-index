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
| 3 | `3-lab.png` | Every lift scored, bodyweight-adjusted |

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
- **No Hybrid Plan capture exists.** The intended third screenshot was a
  populated Hybrid Plan week, captioned "A week built so they stop fighting each
  other". There is no such capture in `source/`, and the dashboard's plan card
  reads "No plan yet". Slot 3 falls back to The Lab until someone captures a
  generated plan week; when that exists, it is a better slot 3 than the Lab and
  the original caption goes back.
- **Demo account visible in the raw dashboard.** `source/01dashboard.png` opens
  on a greeting row reading `Hi, demo_masters_hybrid` with a truncated subtitle.
  The crop starts below it deliberately.
