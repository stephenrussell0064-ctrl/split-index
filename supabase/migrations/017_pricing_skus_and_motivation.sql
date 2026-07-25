-- Multi-SKU pricing + onboarding "main goal" question.
--
-- subscription_sku records which Stripe SKU a premium user is on (monthly/
-- annual/lifetime). Needed because lifetime is a one-time payment with no
-- Stripe subscription object behind it — subscription_status alone can't
-- distinguish "this will renew" from "this is permanent" for display/billing
-- page purposes.
--
-- primary_motivation is the new onboarding question ("What's your main
-- goal?") — distinct from the existing `goals training_goal[]` field, which
-- covers training focus (strength/endurance/etc), not the personalization
-- angle this question is used for (leaderboard framing vs PR framing vs
-- race prediction vs plain tracking).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS subscription_sku TEXT
    CHECK (subscription_sku IS NULL OR subscription_sku IN ('monthly', 'annual', 'lifetime'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS primary_motivation TEXT
    CHECK (
      primary_motivation IS NULL
      OR primary_motivation IN ('leaderboard', 'beat_pr', 'predict_race', 'just_track')
    );
