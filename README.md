# Split Index

Premium analytics platform for hybrid athletes. Objective fitness scoring that updates after every workout.

**Split Index = 50% Endurance + 50% Strength**

## Tech Stack

- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS 4** + Framer Motion
- **Supabase** (Auth, PostgreSQL, RLS)
- **Stripe** (Subscriptions)
- **OpenAI** (AI Coach)
- **Recharts** (Analytics)

## Getting Started

### 1. Clone and install

```bash
cd split-index
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the migrations **in filename order** — `supabase db push` does this for you, or paste each into the SQL
   editor in turn. Several later migrations `ALTER` tables that earlier ones create, so the order is load-bearing.

   | # | File | What it adds |
   |---|---|---|
   | 001 | `001_initial_schema.sql` | Core schema: profiles, activities, gym exercises, workout scores, the `handle_new_user` signup trigger |
   | 002 | `002_scoring_reference_and_leaderboards.sql` | Sports reference, strength scores, leaderboards |
   | 002b | `002b_apply_missing.sql` | Backfill for databases created between 001 and 002 |
   | 003 | `003_integrations.sql` | OAuth connections and import jobs |
   | 004 | `004_split_weighting.sql` | User-configurable Split Index endurance/strength weights |
   | 005 | `005_session_templates.sql` | Session templates + `file` activity source for GPX/TCX import |
   | 006 | `006_fix_handle_new_user_trigger.sql` | Signup trigger fix |
   | 007 | `007_signup_trigger_bulletproof.sql` | Signup trigger hardening — see the onboarding troubleshooting below |
   | 008 | `008_timezone.sql` | Per-user timezone |
   | 009 | `009_gym_set_details.sql` | Per-set weight/reps breakdown (`set_details`) |
   | 010 | `010_avatars_storage.sql` | Avatar storage bucket and policies |
   | 011 | `011_predicted_benchmarks.sql` | Memory-based cardio benchmark predictions |
   | 012 | `012_public_read_strength_scores.sql` | Public read on strength reference scores |
   | 013 | `013_predicted_benchmark_quality.sql` | Prediction confidence/quality |
   | 014 | `014_personalized_hr.sql` | `resting_hr` for personalised Karvonen zones |
   | 015 | `015_interval_fartlek_scoring.sql` | Interval and fartlek segment fields |
   | 016 | `016_date_of_birth.sql` | Date of birth (age-graded scoring, HR max) |
   | 017 | `017_pricing_skus_and_motivation.sql` | Pricing SKUs and motivation copy |
   | 018 | `018_race_prediction_riegel_k.sql` | Per-user Riegel exponent on predictions |
   | 019 | `019_latest_strength_scores_per_exercise.sql` | Latest strength score per exercise |
   | 020 | `020_friend_duels.sql` | Friend duels |
   | 021 | `021_outdoor_cycling.sql` | Outdoor cycling support |
   | 022 | `022_outdoor_cycling_sports_row.sql` | Outdoor cycling sports reference row |
   | 023 | `023_duel_speed_strength_metrics.sql` | Duel speed/strength metrics |
   | 024 | `024_squads.sql` | Squads |
   | 025 | `025_hybrid_athlete_reports.sql` | Hybrid athlete reports |
   | 026 | `026_native_billing_source.sql` | Native (App Store / Play) billing source |
   | 027 | `027_gps_tracking.sql` | Background GPS run tracking, `is_partial_track` |
   | 028 | `028_exercise_attachment.sql` | Exercise attachment/implement |
   | 029 | `029_planned_races.sql` | Planned races |
   | 030 | `030_planned_race_elevation_source.sql` | Race elevation source |
   | 031 | `031_social_activity_feed.sql` | Social activity feed |
   | 032 | `032_share_activities_default_true.sql` | Default activity sharing to on |
   | 033 | `033_training_goals.sql` | Training goals |
   | 034 | `034_training_goal_target_date.sql` | Goal target dates (tapering, feasibility) |
   | 035 | `035_training_goal_custom_distance.sql` | Custom goal distances |
   | 036 | `036_training_goal_target_reps.sql` | Rep-based strength goals |
   | 037 | `037_planned_race_known_elevation_source.sql` | Known race elevation profiles |
   | 038 | `038_training_goal_progress.sql` | Daily goal-progress snapshots for trend estimates |
   | 039 | `039_hpe_athlete_profile.sql` | Hybrid Plan Engine: diagnostic runs, findings, plans, sessions |
   | 040 | `040_hpe_monitoring_and_rollout.sql` | HPE monitoring, feature flags (kill switch), adherence and injury reporting |
   | 041 | `041_admin_roles_and_fleet_review.sql` | `admin_users`, the fleet-review gate and the rollout audit log |
   | 042 | `042_hpe_intake.sql` | HPE athlete intake: safety screen answers, goal, availability and preferences |
   | 043 | `043_hpe_intake_plan_flexibility.sql` | Plan flexibility on the intake |
   | 044 | `044_hpe_training_split.sql` | Preferred training split |
   | 045 | `045_scoring_basis.sql` | Explicit scoring basis for athletes who are not male or female |
   | 046 | `046_hpe_safety_capped_outcome.sql` | The health screen caps plans instead of refusing them |
   | 047 | `047_hpe_intake_overrides.sql` | Manual overrides for engine-proposed 1RM and heart rates |
   | 048 | `048_hpe_intake_section_regroup.sql` | Remaps stored intake progress onto the regrouped sections |
   | 049 | `049_private_account_visibility.sql` | "Private account" switch and the activity-visibility predicate behind it |

   **Skipping the tail of this list breaks the social feed.** `031` adds
   `profiles.share_activities_with_friends` and the `activities` policy that lets a friend's workout be read at
   all; `049` hardens both. Without them the Settings privacy switch reports it cannot load and the feed stays
   permanently empty, because RLS returns zero rows rather than an error. Run the whole list.

   **After 041:** the Hybrid Plan Engine ships disabled at 0% rollout and grants no admin roles. `admin_users` has no
   INSERT policy by design, so the first operator has to be granted directly:

   ```sql
   insert into admin_users (user_id, role, note)
   values ((select id from auth.users where email = 'you@example.com'), 'operator', 'Initial grant');
   ```

   That account can then open `/admin/hpe-fleet` and work the rollout from there. `SUPABASE_SERVICE_ROLE_KEY` must be
   set in the deployed environment or the fleet view fails closed and 404s for everyone.
3. Enable Email and Google OAuth in Authentication → Providers
4. Add your site URL to redirect allowlist: `http://localhost:3000/auth/callback`

**Onboarding “Could not save your profile”**

If onboarding fails at the final step, the database is usually missing migrations or the signup trigger:

1. In the Supabase SQL editor, run `001_initial_schema.sql` then `002_scoring_reference_and_leaderboards.sql` (in order).
2. `001` creates the `profiles` table and `handle_new_user` trigger (auto-creates a profile row on OAuth signup).
3. `002` adds a client-side INSERT policy on `profiles` so upserts work when the trigger did not run (e.g. user signed up before migrations were applied).

In development, the onboarding error message includes the Supabase error text to make this obvious (e.g. `relation "profiles" does not exist` or RLS violations). The app also calls `/api/profile/ensure` before saving, which creates a missing profile row via the service role when `SUPABASE_SERVICE_ROLE_KEY` is set.

**Signup returns “Something went wrong on our side” (HTTP 500)**

Two common causes after migrations are applied:

1. **Database trigger** — `handle_new_user` fails during `INSERT INTO auth.users` (rolls back signup). Run `supabase/diagnostics/signup_full_diagnostic.sql` in the SQL Editor; section **D3** prints the exact Postgres error. Fix: re-run `007_signup_trigger_bulletproof.sql`.
2. **SMTP / confirmation email** — user row is created but Auth returns 500 when sending the confirm email. Check Dashboard → Logs → Auth for `gomail` or `Error sending confirmation email`. Fix SMTP (host, port, TLS, sender domain) or temporarily disable **Confirm email** under Authentication → Providers → Email to isolate.

Before retrying with the same email, delete any stuck row from `auth.users` (see section **F** in the diagnostic SQL). Add `https://splitindex.co.uk/auth/callback` to Authentication → URL Configuration → Redirect URLs.

Required in `.env.local` for checkout to work:

- `STRIPE_SECRET_KEY` — secret key from [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys) (use `sk_test_…` locally)
- `STRIPE_PRICE_ID` — recurring price ID for the £5/month Premium product (starts with `price_…`)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — publishable key (for future client-side Stripe.js)
- `STRIPE_WEBHOOK_SECRET` — signing secret from your webhook endpoint (production)
- `NEXT_PUBLIC_APP_URL` — e.g. `http://localhost:3000` (used for checkout success/cancel redirects)

Setup steps:

1. In Stripe, create a **Product** with a **£5/month recurring Price**
2. Copy the Price ID into `STRIPE_PRICE_ID` in `.env.local`
3. Copy your test Secret key into `STRIPE_SECRET_KEY`
4. Restart the dev server after changing env vars
5. For production, set up webhook endpoint: `https://your-domain.com/api/stripe/webhook`
6. Listen for `customer.subscription.created`, `updated`, `deleted`

If Stripe is not configured, `/settings/billing` shows a friendly error instead of crashing.

**Manual premium for testing (skip Stripe)**

In the Supabase SQL editor, grant Premium to your account:

```sql
UPDATE profiles
SET subscription_tier = 'premium',
    subscription_status = 'active'
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'your@email.com');
```

Use `'trialing'` instead of `'active'` if you want to mimic a trial. Premium gating requires `subscription_tier = 'premium'` and `subscription_status` in (`'active'`, `'trialing'`).

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/                    # Next.js App Router pages & API routes
│   ├── api/activities/     # Workout logging & scoring
│   ├── api/stripe/         # Checkout & webhooks
│   ├── dashboard/          # Main dashboard
│   ├── activities/         # Workout forms
│   ├── analytics/          # Charts & insights
│   ├── social/             # Leaderboards & challenges
│   ├── profile/            # User profile & stats
│   └── settings/           # Account & billing
├── components/             # Reusable UI components
├── lib/
│   ├── scoring/            # Core scoring engine
│   ├── supabase/           # Database clients
│   ├── openai/             # AI Coach
│   └── stripe/             # Payments
└── types/                  # TypeScript definitions
supabase/migrations/        # PostgreSQL schema + RLS
```

## Database Schema

All tables live in Postgres (Supabase) with Row Level Security enabled. Users are Supabase `auth.users`; every user-owned table references it with `ON DELETE CASCADE` and owner-based RLS policies (`auth.uid()`).

**Core** (`001_initial_schema.sql`)

- `profiles` — one per user (auto-created on signup), onboarding data, subscription state, and denormalized current index columns for fast leaderboards
- `activities` + `gym_exercises` — every logged workout; composite index on `(user_id, started_at)`
- `workout_scores` — per-activity sport index and breakdown
- `split_index_history` — the overall Split Index over time
- `personal_records`, `goals`, `body_metrics` (bodyweight history), `recovery_snapshots`
- `ai_feedback` — AI Coach output per activity
- `friends` (friend requests: pending/accepted/blocked), `challenges` + `challenge_participants`, `achievements` + `user_achievements`, `notifications`, `workout_drafts`

**Scoring reference & leaderboards** (`002_scoring_reference_and_leaderboards.sql`)

- `sports` — reference table for the 8 supported sports (name, endurance/strength category, metadata); public read
- `strength_scores` — per-exercise strength scoring (estimated 1RM, relative strength, volume load)
- `reference_values` — scoring-engine benchmark standards (e.g. 5k paces, big-3 1RM/bodyweight ratios) per sport × gender × experience; seeded, public read
- `sleep_logs` — nightly sleep hours, quality, bed/wake times
- `leaderboard_entries` — precomputed weekly/monthly/all-time rankings (refreshed by a scheduled job with the service role); public read
- Adds `current_split_index` (and endurance/strength) to `profiles`, kept in sync by trigger on `split_index_history`, plus missing indexes and tightened RLS for friend requests

Run the migrations in numeric order on a fresh project; `002` is purely additive on top of `001`.

**Re-running migrations (e.g. `type "sport_category" already exists`)**

Migrations are not idempotent — do not paste the same file twice. If you see `42710: type "sport_category" already exists`, migration `002` was already applied (at least partially). Run the verification queries below in the Supabase SQL editor, then:

- **All 002 objects present** → skip `002`, run `003_integrations.sql` only if you need integrations.
- **002 incomplete** → do not re-run the full file; paste `supabase/migrations/002b_apply_missing.sql` in the SQL editor instead (idempotent remainder of `002`).
- **003 fails similarly** (`integration_provider already exists`) → skip `003`; objects already exist.

```sql
-- Enums (001: sport_type; 002: sport_category, leaderboard_period; 003: integration_*)
SELECT typname FROM pg_type
WHERE typname IN ('sport_type','sport_category','leaderboard_period','integration_provider','import_job_status','sync_status')
  AND typtype = 'e' ORDER BY typname;

-- Key tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('profiles','sports','goals','strength_scores','reference_values','sleep_logs','leaderboard_entries','integration_connections','import_jobs')
ORDER BY table_name;

-- 002 profile columns (leaderboard denormalization)
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('current_split_index','current_endurance_index','current_strength_index','index_updated_at');
```

## Scoring Engine

Located in `src/lib/scoring/engine.ts`. Key formulas:

- **Endurance Index**: pace × distance × duration × elevation × HR efficiency × temperature × fatigue
- **Strength Index**: Epley 1RM × relative strength × volume × fatigue
- **Split Index**: `0.5 × endurance + 0.5 × strength`
- **Fatigue**: Acute:Chronic Workload Ratio (ACWR)
- **Recovery**: Derived from fatigue, ACWR, and rest days

## Integrations & background sync

OAuth and CSV import live under **Settings → Integrations**. GPX/TCX file upload uses `POST /api/integrations/import/file`.

**Free tier:** manual logging + CSV import. **Premium:** Strava, Garmin, and all OAuth providers with background auto-sync.

For production cron jobs, set `CRON_SECRET` and configure Vercel cron (daily):

```bash
# Integration auto-sync
GET /api/integrations/sync?cron=1
Authorization: Bearer $CRON_SECRET

# Leaderboard rank refresh (weekly / monthly / all-time)
GET /api/cron/leaderboard
Authorization: Bearer $CRON_SECRET
```

**Data export (Premium):** `GET /api/export/activities?format=csv` or `?format=json`

## Premium feature gating

Central flags live in `src/lib/premium/features.ts` (`canAccess`, `PREMIUM_FEATURES`).

| Feature | Free | Premium |
|--------|------|---------|
| Full logging (manual, CSV, GPX/TCX) | ✓ | ✓ |
| Current Split Index | ✓ | ✓ |
| Per-workout cardio index | ✓ | ✓ |
| Dashboard 7-day history | ✓ | ✓ |
| Rules-based coach snippet | ✓ | ✓ |
| Country leaderboard | ✓ | ✓ |
| DOTS / GL / ExRx tiers | — | ✓ |
| Cardio HR accountability (TRIMP, EF, decoupling) | — | ✓ |
| GPT AI Coach (4 sections) | — | ✓ |
| 90-day trends & projections | — | ✓ |
| Period comparison analytics | — | ✓ |
| Global leaderboards & rank percentile | — | ✓ |
| Data export | — | ✓ |
| OAuth integrations & auto-sync | — | ✓ |

## Deploy to Vercel

1. Push to GitHub
2. Import in Vercel
3. Add environment variables
4. Deploy

## Premium Features (£5/month)

See `src/lib/premium/features.ts` for the canonical gate list. Highlights:

- Full Strength Index with DOTS / IPF GL + ExRx tiers
- Cardio HR accountability (TRIMP, EF, decoupling, VO2max confidence)
- GPT AI Coach after every workout
- 90-day analytics, projections & period comparison
- Global leaderboards, rank percentile & data export
- Strava, Garmin & all OAuth auto-sync

14-day free trial included.
