-- Intake sections regrouped by topic, so stored progress has to be remapped.
--
-- `sections_completed` records which parts of the form the athlete has filled
-- in, and the section names changed underneath it. Left alone, every existing
-- athlete would be shown a form claiming they had completed nothing — and,
-- worse, `resolveSafetyFlags` reads whether the health section was completed to
-- decide whether an unanswered question means "no" or "not asked". A stale
-- array there would silently re-open the conservative defaults on people who
-- had already answered.
--
-- The mapping follows where each question actually went:
--
--   safety      -> health + fuelling   (one screen split into two topics)
--   strength    -> history + training + body
--   endurance   -> history + training + body
--   heart_rate  -> body
--   preferences -> availability        (folded in)
--   goal, availability, recovery       unchanged
--
-- `body` needs both of its parents, because it now holds the 1RM proposals
-- that lived in `strength` and the heart-rate ones that lived in `heart_rate`.
-- Claiming it complete on the strength of one would mark questions answered
-- that the athlete has never seen. `history` and `training` take either parent,
-- since each drew from both and neither alone leaves a gap the engine reads as
-- an answer.

UPDATE hpe_intake SET sections_completed = (
  SELECT COALESCE(ARRAY(SELECT DISTINCT unnest(mapped) ORDER BY 1), '{}')
  FROM (
    SELECT
      (CASE WHEN 'safety'      = ANY(sections_completed) THEN ARRAY['health','fuelling'] ELSE '{}' END)
      || (CASE WHEN 'goal'         = ANY(sections_completed) THEN ARRAY['goal'] ELSE '{}' END)
      || (CASE WHEN 'availability' = ANY(sections_completed)
                 OR 'preferences'  = ANY(sections_completed) THEN ARRAY['availability'] ELSE '{}' END)
      || (CASE WHEN 'recovery'     = ANY(sections_completed) THEN ARRAY['recovery'] ELSE '{}' END)
      || (CASE WHEN 'strength'     = ANY(sections_completed)
                 OR 'endurance'    = ANY(sections_completed) THEN ARRAY['history','training'] ELSE '{}' END)
      || (CASE WHEN 'strength'     = ANY(sections_completed)
                AND 'heart_rate'   = ANY(sections_completed) THEN ARRAY['body'] ELSE '{}' END)
      AS mapped
  ) AS m
)
WHERE sections_completed && ARRAY['safety','strength','endurance','heart_rate','preferences'];
