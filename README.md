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
2. Run the migrations in order (via `supabase db push` or the SQL editor):
   - `supabase/migrations/001_initial_schema.sql` — core schema
   - `supabase/migrations/002_scoring_reference_and_leaderboards.sql` — sports reference, strength scores, leaderboards
   - `supabase/migrations/003_integrations.sql` — OAuth connections and import jobs
   - `supabase/migrations/004_split_weighting.sql` — user-configurable Split Index endurance/strength weights
   - `supabase/migrations/005_session_templates.sql` — session templates + `file` activity source for GPX/TCX import
3. Enable Google and Apple OAuth in Authentication → Providers
4. Add your site URL to redirect allowlist: `http://localhost:3000/auth/callback`

**Onboarding “Could not save your profile”**

If onboarding fails at the final step, the database is usually missing migrations or the signup trigger:

1. In the Supabase SQL editor, run `001_initial_schema.sql` then `002_scoring_reference_and_leaderboards.sql` (in order).
2. `001` creates the `profiles` table and `handle_new_user` trigger (auto-creates a profile row on OAuth signup).
3. `002` adds a client-side INSERT policy on `profiles` so upserts work when the trigger did not run (e.g. user signed up before migrations were applied).

In development, the onboarding error message includes the Supabase error text to make this obvious (e.g. `relation "profiles" does not exist` or RLS violations). The app also calls `/api/profile/ensure` before saving, which creates a missing profile row via the service role when `SUPABASE_SERVICE_ROLE_KEY` is set.

### 4. Set up Stripe

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
