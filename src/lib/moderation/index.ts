/**
 * Blocking and reporting — the second and third of guideline 1.2's four
 * requirements. The first is `filter.ts`; the fourth is `/support`.
 *
 * The pure decisions live here so they can be tested without a database, and so
 * the rules are readable in one place rather than inferred from three route
 * handlers.
 */

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'sexual',
  'violence',
  'self_harm',
  'impersonation',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
export type SubjectType = 'comment' | 'profile';

export interface ReportInput {
  reporterId: string;
  subjectType: SubjectType;
  subjectId: string | null;
  subjectUserId: string;
  reason: string;
  detail?: string | null;
}

export type Refusal =
  | 'self-report'
  | 'self-block'
  | 'unknown-reason'
  | 'detail-too-long'
  | 'missing-subject';

export type Decision<T> = { ok: true; value: T } | { ok: false; reason: Refusal };

const MAX_DETAIL = 1000;

/**
 * Is this report well-formed and honest?
 *
 * Reporting yourself is refused not because it is harmful but because it is the
 * signature of a mistake — usually a subject id that resolved to the wrong
 * person — and letting it through would put noise in the one place the pattern
 * per account is supposed to be legible.
 */
export function validateReport(input: ReportInput): Decision<ReportInput & { reason: ReportReason }> {
  if (input.reporterId === input.subjectUserId) return { ok: false, reason: 'self-report' };
  if (!REPORT_REASONS.includes(input.reason as ReportReason)) {
    return { ok: false, reason: 'unknown-reason' };
  }
  if (input.subjectType === 'comment' && !input.subjectId) {
    return { ok: false, reason: 'missing-subject' };
  }
  if ((input.detail ?? '').length > MAX_DETAIL) return { ok: false, reason: 'detail-too-long' };

  return {
    ok: true,
    value: { ...input, reason: input.reason as ReportReason, detail: input.detail?.trim() || null },
  };
}

export function validateBlock(blockerId: string, blockedId: string): Decision<{ blockerId: string; blockedId: string }> {
  if (blockerId === blockedId) return { ok: false, reason: 'self-block' };
  return { ok: true, value: { blockerId, blockedId } };
}

/**
 * Blocking is symmetric, and this is the function that says so.
 *
 * If A blocks B, A stops seeing B and B stops seeing A. A one-way block would
 * leave the blocked person free to keep reading and commenting on the blocker's
 * activities, which is not what anyone means by the word and not what guideline
 * 1.2 is asking for. The database enforces it too — `viewer_is_blocked_with`
 * in migration 084 — because a control that depends on every future read path
 * remembering to call this is one that will eventually be forgotten.
 *
 * That last sentence was true as an argument and false as a statement of fact
 * for as long as it named `is_blocked_pair` in migration 062: that function was
 * never in this schema, so nothing in the database checked a block, and the
 * comment was why nobody looked. It is accurate as of 084 — which found a
 * blocked athlete's comments still reaching the person who blocked them, on any
 * activity belonging to a friend they had in common.
 */
export function isBlockedPair(
  blocks: ReadonlyArray<{ blocker_id: string; blocked_id: string }>,
  a: string,
  b: string,
): boolean {
  return blocks.some(
    (row) =>
      (row.blocker_id === a && row.blocked_id === b) ||
      (row.blocker_id === b && row.blocked_id === a),
  );
}

/** Everyone the viewer must not see, in either direction, as a lookup set. */
export function hiddenFrom(
  blocks: ReadonlyArray<{ blocker_id: string; blocked_id: string }>,
  viewerId: string,
): Set<string> {
  const hidden = new Set<string>();
  for (const row of blocks) {
    if (row.blocker_id === viewerId) hidden.add(row.blocked_id);
    if (row.blocked_id === viewerId) hidden.add(row.blocker_id);
  }
  return hidden;
}

/**
 * Drop anything authored by someone in a block pair with the viewer.
 *
 * Used for the leaderboard and any other list assembled outside the comment
 * table's own policy. Generic over the row so it cannot drift from the shape it
 * filters.
 */
export function withoutBlocked<T>(
  rows: readonly T[],
  authorOf: (row: T) => string,
  hidden: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !hidden.has(authorOf(row)));
}

export const REFUSAL_MESSAGES: Record<Refusal, string> = {
  'self-report': 'You cannot report your own content.',
  'self-block': 'You cannot block yourself.',
  'unknown-reason': 'Choose one of the listed reasons.',
  'detail-too-long': `Keep the detail under ${MAX_DETAIL} characters.`,
  'missing-subject': 'That report is missing the thing it refers to.',
};
