-- Stop a dropped response turning into a duplicate workout.
--
-- THE FAILURE. It is ordinary, not exotic. A POST reaches the server, the
-- server writes the activity and its scores, and the response never makes it
-- back over a mobile connection that is already dropping — which is the exact
-- condition under which the app queues a retry. `fetch` rejects, the offline
-- queue records "never sent", and the next flush files the same run again.
-- The athlete ends up with two identical sessions, two sets of scores, and a
-- Split Index computed over a week they did not train twice.
--
-- Nothing in the schema could recognise the repeat, because nothing about the
-- second request differs from the first.
--
-- THE KEY. The client generates one id when it first queues a submit and sends
-- the same one on every retry (see QueuedActivitySubmit.clientRequestId). The
-- unique index below is what makes it mean something: a second insert carrying
-- an id this athlete has already used cannot be written, and the route answers
-- with the activity that already exists instead of an error.
--
-- Nullable, and unique only WHERE NOT NULL: the overwhelming majority of
-- submits are made online and never queued, and requiring an id for those would
-- be ceremony for no benefit. Scoped per user so two athletes' clients can
-- never collide on a locally generated value.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_client_request
  ON activities (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMENT ON COLUMN activities.client_request_id IS
  'Client-generated idempotency key for retried offline submits. Set only when the submit was queued; unique per user where present.';
