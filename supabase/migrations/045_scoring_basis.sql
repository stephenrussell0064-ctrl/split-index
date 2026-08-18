-- Scoring basis — which sex-segregated comparison table an athlete is scored
-- against, stored separately from who they are.
--
-- `profiles.gender` offers four options (male, female, other,
-- prefer_not_to_say) and always has. The scoring code required one of the
-- first two and threw otherwise, so every athlete who answered honestly with
-- "Other" or "Prefer not to say" could not log a single workout: the throw sat
-- in assertScoringInput, which runs on EVERY sport and EVERY submit. Signup to
-- dead end.
--
-- The fix is not to delete the options. It is to stop conflating two different
-- questions. Identity is the athlete's own; the scoring basis is a statement
-- about which population table their numbers are compared against. DOTS,
-- Glossbrenner, the age-graded pace tables and the HR references are all built
-- from sex-segregated data — that is a property of the reference data, not a
-- product opinion — so the honest thing is to ask which one to use and say
-- why, rather than to guess in silence or to refuse the workout.
--
-- NULL means "not told yet". Scoring degrades to a documented default and
-- flags reduced confidence rather than blocking the log; the athlete is
-- prompted for the real answer in onboarding and on their profile.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS scoring_basis TEXT
    CHECK (scoring_basis IS NULL OR scoring_basis IN ('male', 'female'));

COMMENT ON COLUMN profiles.scoring_basis IS
  'Which sex-segregated standards to score against (male/female). Separate from gender, which is identity. NULL = not set; scoring falls back to a documented default with reduced confidence.';

-- Backfill only where identity already answers the question, so nobody is
-- asked the same thing twice. Rows whose gender is other/prefer_not_to_say
-- (or NULL) are deliberately left NULL — they are the ones we genuinely do
-- not know for, and they are unblocked by the code-side fallback rather than
-- by a guess written into their profile.
--
-- Safe against a live table: adding a nullable column with no default does not
-- rewrite the heap, the CHECK only constrains the new column, and this UPDATE
-- touches no row it does not set.
UPDATE profiles
   SET scoring_basis = gender::TEXT
 WHERE scoring_basis IS NULL
   AND gender IN ('male', 'female');
