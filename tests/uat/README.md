# UAT bots

Ten simulated athletes, driven through the real scoring engines for eight to
twelve weeks each, asking one question the unit suite cannot: **did this person
get something worth paying for?**

```bash
npx vitest run tests/uat        # run them; rewrites docs/pre-launch/uat-bot-report.md
```

## What these are for

Every function under `src/lib/scoring` can pass its own tests while a swimmer
sees a number that never moves. Unit tests ask "does this function return the
value it returned last time"; these ask "after two months of honest training,
did the app notice". Those come apart, and the gap between them is where users
are lost — silently, because an athlete who concludes the app is not for them
does not file a bug.

Several personas exist specifically to cover the sports and bodies the scoring
was **not** primarily built around: swimming, cycling, the SkiErg, female
athletes and masters athletes. Those are the readings most likely to be wrong
and least likely to be noticed.

## How it works

| File | What it holds |
| --- | --- |
| `personas.ts` | The athletes. A training behaviour, a trajectory, and what they would count as value. |
| `simulator.ts` | Turns a persona into sessions and runs them through the real engines. |
| `assertions.ts` | The athlete's questions, as checks. Returns findings; does not throw. |
| `journeys.test.ts` | The suite, and the report writer. |

`simulator.ts` reproduces what `api/activities/route.ts` does before it calls
the scorer — the same helpers, in the same order, with the same accumulating
state. It does **not** re-implement any scoring. A bot that computes its own
expected values only tests the bot.

Nothing here touches Supabase, the network or a browser. A UAT suite that needs
a seeded database and a running dev server does not run unattended at 3am, and
a suite that never runs finds nothing.

Randomness is seeded from the persona id, so any failure reproduces exactly.

## Severities

- **blocking** — the app is broken or lying for this athlete. Fails the build.
- **degraded** — works, but this athlete is short-changed. Recorded, does not fail;
  where to spend effort is a product decision, not a release gate.
- **note** — arithmetically correct and still worth a human look.

## Adding a persona

Add to `PERSONAS` and fill in `covers` honestly — if you cannot say what risk
the persona covers that no existing one does, it is a fixture rather than an
athlete, and it will cost more in maintenance than it finds.

Two fields are easy to get silently wrong, and both have already caused a false
finding here:

- **`split_endurance_weight`** is how much the *endurance* side counts. The app
  derives the Lab weight as `1 - split_endurance_weight`, so a swimmer wants a
  high value and a powerlifter a low one. Backwards, it produces a headline
  index dominated by the athlete's minor discipline.
- **Gym history shape.** `exerciseHistory` values are `LoggedSet` — camelCase
  `weightKg`, and a required `performedAt`, because the adaptive 1RM model
  decays by recency. Passing the logging form's snake_case `GymExerciseSet`
  instead type-checks through `Record<string, ...>` and quietly hands the model
  undefined weights.

## Reading the report

`docs/pre-launch/uat-bot-report.md` is regenerated on every run and committed,
so changes to it show up in review — a sport whose mean drops forty points
between two commits is visible in the diff without anyone having to look for it.
