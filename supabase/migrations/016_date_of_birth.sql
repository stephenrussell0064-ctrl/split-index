-- Date of birth for age.
--
-- Onboarding previously asked for a raw age number, which silently goes stale
-- (a 29-year-old stays "29" forever). We now capture date_of_birth and derive
-- age from it at scoring time (see src/lib/utils/age.ts), so age stays correct
-- without the user re-entering it every birthday. The existing `age` column is
-- kept as a snapshot for legacy profiles and display; it's still written on
-- save, but date_of_birth is the source of truth when present.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS date_of_birth DATE
    CHECK (
      date_of_birth IS NULL
      OR (date_of_birth > '1900-01-01' AND date_of_birth <= CURRENT_DATE)
    );
