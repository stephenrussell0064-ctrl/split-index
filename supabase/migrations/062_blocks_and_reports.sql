-- B5 — the moderation controls App Store guideline 1.2 requires, and which
-- this app has been shipping user-generated content without.
--
-- WHAT IS ACTUALLY USER-GENERATED HERE
-- ------------------------------------
-- Two surfaces, both visible to other athletes:
--
--   · `activity_comments.body` — free text, up to 1000 characters, written by
--     one athlete on another's activity.
--   · `public_profiles` — username, display_name and avatar_url, rendered on
--     the leaderboards, the dimension boards and beside every comment.
--
-- Guideline 1.2 asks for four things from an app carrying that: a way to filter
-- objectionable content, a way to report it, a way to block the person who
-- posted it, and published contact details. The fourth exists (`/support`).
-- This migration is the storage for the middle two, and the filtering that
-- makes blocking mean something.
--
-- WHY THIS WAS NOT NOTICED
-- ------------------------
-- The dashboard reported B5 as done. Its check greps for
-- /blockUser|reportContent|block_user/ case-insensitively, and matched:
--
--     function ReportContent({ report }: { report: HybridAthleteReport })
--
-- a component that renders the body of an analytics report. Nothing in the
-- codebase reported or blocked anything. The check has been rewritten to look
-- for this migration and the moderation module rather than for a word.
--
-- BLOCKING HAS TO BE SYMMETRIC
-- ----------------------------
-- If A blocks B, then A stops seeing B *and B stops seeing A*. Making it
-- one-way would let a blocked person keep reading and commenting on the
-- blocker's activities, which is not what anyone means by "block" and is not
-- what Apple means either. `is_blocked_pair` is written so both directions
-- resolve from one row, and every read path uses it.

create table if not exists public.user_blocks (
  blocker_id  uuid not null references auth.users (id) on delete cascade,
  blocked_id  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  -- Blocking yourself is always a mistake, and one that would hide your own
  -- content from you.
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

comment on table public.user_blocks is
  'One row per block. Enforced symmetrically at read time by is_blocked_pair: a block hides content in both directions.';

-- Reports are kept even after the reported content is deleted, because the
-- pattern of reports about one account is the thing worth seeing, and because
-- "we acted on it" needs a record that outlives the comment.
create table if not exists public.content_reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid not null references auth.users (id) on delete cascade,
  -- What was reported. `profile` covers a display name, username or avatar.
  subject_type     text not null check (subject_type in ('comment', 'profile')),
  subject_id       uuid,
  -- Who posted it, kept independently of subject_id so a deleted comment does
  -- not orphan the report.
  subject_user_id  uuid not null references auth.users (id) on delete cascade,
  reason           text not null check (reason in (
                     'spam', 'harassment', 'hate', 'sexual', 'violence',
                     'self_harm', 'impersonation', 'other'
                   )),
  detail           text check (detail is null or length(detail) <= 1000),
  status           text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  constraint content_reports_not_self check (reporter_id <> subject_user_id)
);

create index if not exists content_reports_open_idx
  on public.content_reports (created_at desc) where status = 'open';
create index if not exists content_reports_subject_idx
  on public.content_reports (subject_user_id, created_at desc);

comment on table public.content_reports is
  'Guideline 1.2 reports. Retained after the reported content is gone: the pattern per account is what matters.';

-- One report per person per thing. Without this, a reload or a double tap
-- inflates the count for an account and makes the pattern useless.
create unique index if not exists content_reports_one_per_subject
  on public.content_reports (reporter_id, subject_type, subject_id)
  where subject_id is not null;

alter table public.user_blocks enable row level security;
alter table public.content_reports enable row level security;

-- A person manages their own blocks and sees nobody else's.
create policy user_blocks_select_own on public.user_blocks
  for select using (auth.uid() = blocker_id);
create policy user_blocks_insert_own on public.user_blocks
  for insert with check (auth.uid() = blocker_id);
create policy user_blocks_delete_own on public.user_blocks
  for delete using (auth.uid() = blocker_id);

-- Reports are write-mostly: a reporter may file one and see their own, and
-- nobody may see reports filed against them. Review happens through the
-- service role, not through a client.
create policy content_reports_insert_own on public.content_reports
  for insert with check (auth.uid() = reporter_id);
create policy content_reports_select_own on public.content_reports
  for select using (auth.uid() = reporter_id);

/*
 * Is there a block between these two, in either direction?
 *
 * SECURITY DEFINER so it can read user_blocks past the select policy above,
 * which deliberately shows a person only their own rows. Without that, the
 * symmetric half cannot work: B has no permission to see that A blocked them,
 * which is exactly the row that must hide A from B.
 *
 * search_path is pinned — a SECURITY DEFINER function without it can be made to
 * resolve `user_blocks` to something an attacker controls.
 */
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

comment on function public.is_blocked_pair is
  'True when either has blocked the other. Blocking is symmetric: a one-way block would let the blocked person keep reading and commenting.';

revoke all on function public.is_blocked_pair(uuid, uuid) from public;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

-- Comments from someone in a block pair with the reader stop being selectable
-- at all, rather than being filtered by whichever query remembers to. A
-- guideline-1.2 control that depends on every future read path remembering is
-- one that will be forgotten.
drop policy if exists activity_comments_hide_blocked on public.activity_comments;
create policy activity_comments_hide_blocked on public.activity_comments
  for select using (not public.is_blocked_pair(auth.uid(), user_id));
