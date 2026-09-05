-- Injury status on the social profile — user feedback: "I want this to be a
-- status available to put on your social profile to inform others that you
-- are injured."
--
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
-- ---------------------------------------------
-- It is a SOCIAL SIGNAL: two coarse words that explain a quiet training week
-- to the people who follow your training. "Injured" or "Returning from
-- injury", and nothing else.
--
-- It is NOT a health record, and this column must never be allowed to drift
-- into becoming one. There is deliberately no body region, no diagnosis, no
-- severity, no date of onset, no expected return, no free text. Every one of
-- those is a reasonable-sounding follow-up request and every one of them
-- turns a status chip into a medical disclosure attached to a real name. If
-- a future change wants that detail, it wants a different table with a
-- different access model, not another column here.
--
-- INDEPENDENT OF THE HYBRID PLAN'S INJURY INPUT, ON PURPOSE
-- --------------------------------------------------------
-- The Hybrid Plan engine collects its own injury information (niggle / small
-- / significant, with a body region) so it can program around it. That data
-- is training input, it is fine-grained, and it lives in the athlete's own
-- private plan state. NOTHING may copy it here.
--
-- Publishing a plan-reported injury to a profile that other people read would
-- turn a private answer given to a coach-like tool into a public health
-- disclosure the athlete never agreed to. The two are separate by design:
--   * the plan's injury input is never read by anything that writes this
--     column,
--   * this column is set only by the athlete, in Settings on their own
--     Profile page, in a control that exists for no other purpose,
--   * and clearing it is one tap in that same control.
-- If you are here to wire the two together: don't. Ask the athlete instead.
--
-- WHO CAN SEE IT
-- --------------
-- Everything on `profiles` is governed by "Public profiles readable"
-- (migration 001): `FOR SELECT USING (username IS NOT NULL)`. That policy has
-- no auth check, so for any athlete who has claimed a username this row is
-- readable by anyone — the same reach the bio, country and display name have
-- had since 001.
--
-- That reach is WIDER than the activity feed's, which is accepted-friends-only
-- via activity_is_visible_to() (031/049). The two must not be confused: an
-- athlete with a private account still has a readable profile row. This is
-- why the control that writes this column states the reach in plain words at
-- the point of opting in ("anyone who can see your profile"), rather than
-- implying the friends-only model that governs activities. Health-adjacent
-- information is not somewhere to be vague about audience.
--
-- SAFE ON A LIVE TABLE
-- --------------------
-- Nullable, no default, no backfill, no UPDATE. Every existing row keeps
-- exactly the behaviour it has today: NULL means "said nothing", which is
-- what every athlete has said so far and what the UI renders as no badge at
-- all. There is no value of this column that an athlete did not deliberately
-- choose.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS injury_status TEXT;

-- The vocabulary is closed at the database edge, not just in TypeScript, so a
-- future writer cannot smuggle a free-text description ("torn left hamstring")
-- into a column whose whole point is that it cannot hold one.
--
-- NOT VALID first, then VALIDATE, rather than a plain ADD CONSTRAINT: the
-- plain form takes ACCESS EXCLUSIVE on `profiles` for the length of a full
-- table scan, which blocks every read of every profile — including the ones
-- the login path makes — while it runs. VALIDATE takes only SHARE UPDATE
-- EXCLUSIVE and lets that traffic through. The column is 100% NULL at this
-- point so validation cannot fail; the split is about the lock, not the risk.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_injury_status_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_injury_status_check
      CHECK (injury_status IN ('injured', 'returning')) NOT VALID;

    ALTER TABLE profiles VALIDATE CONSTRAINT profiles_injury_status_check;
  END IF;
END $$;

COMMENT ON COLUMN profiles.injury_status IS
  'OPT-IN social status, set only by the athlete on their own Profile page. '
  'NULL = not saying anything (the value for every athlete who has not chosen), '
  '''injured'' = currently injured, ''returning'' = returning from injury. '
  'A coarse social signal that explains a quiet training week — NOT a health '
  'record: never add body region, diagnosis, severity, dates or free text here. '
  'Must never be written from the Hybrid Plan''s injury input or any other '
  'source than the athlete''s own explicit choice in that one control. '
  'Readable by anyone who can read the profile row ("Public profiles readable", '
  'migration 001) — a wider audience than the friends-only activity feed, which '
  'is why the control says so before the athlete sets it. '
  'Do not blanket-UPDATE this column: every non-null value is a deliberate choice.';
