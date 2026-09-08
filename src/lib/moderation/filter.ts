/**
 * Filtering objectionable content — the first of the four things App Store
 * guideline 1.2 asks of an app carrying user-generated content.
 *
 * ## The problem specific to this app
 *
 * Training talk is saturated with violent metaphor. "Killed that set",
 * "destroyed my legs", "beat my PB by two minutes", "this session murdered me",
 * "dying on the last rep". A wordlist assembled without looking at the corpus
 * flags a large share of ordinary comments, and a filter that cries wolf gets
 * switched off — which leaves the app with no filter and a claim that it has
 * one, the worst of the three available states.
 *
 * So the violent register is deliberately *not* matched. What is matched is the
 * category of content Apple actually means: slurs, sexual content, and targeted
 * abuse. Those do not overlap with athletics vocabulary, which makes the filter
 * both safer and quieter.
 *
 * ## What it does and does not decide
 *
 * `assess()` returns a verdict, never a punishment. Blocking a comment outright
 * on a wordlist is how you end up refusing "Scunthorpe" and every legitimate
 * discussion of a hard session. `reject` is reserved for the unambiguous;
 * `review` flags for a human and lets the content through, because the human
 * side of guideline 1.2 is a report queue, not an oracle.
 */

export type Verdict = 'clean' | 'review' | 'reject';

export interface Assessment {
  verdict: Verdict;
  /** Which rule fired, for the audit trail and for tuning it later. */
  rule: string | null;
  /**
   * Shown to the author when their comment is refused. Never scolding.
   *
   * Named `refusal` rather than `message` for two reasons: it says what it is,
   * and the repo's raw-error-leak guard reads `error: x.message` in a route as
   * a database message escaping to a client. It cannot tell this apart from
   * one by static inspection, and it is right not to try.
   */
  refusal: string | null;
}

const CLEAN: Assessment = { verdict: 'clean', rule: null, refusal: null };

/**
 * Normalise the tricks people use to get past a wordlist.
 *
 * Leet substitution, inserted punctuation and repeated characters are the three
 * that matter; each is cheap to apply and each defeats a naive `includes()`.
 * Diacritics are stripped too, because "ｎｉｇｇｅｒ"-style homoglyphs and
 * accented spellings are the same evasion wearing a different hat.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[4@]/g, 'a')
    .replace(/[3€]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    // Punctuation and spacing between letters: "f u c k", "f.u.c.k".
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(.)\1{2,}/g, '$1$1')
    .trim();
}

/** With inner spacing removed, so "s h i t" collapses to "shit". */
function collapsed(normalised: string): string {
  return normalised.replace(/\s+/g, '');
}

/**
 * Unambiguous content. Kept deliberately short: every entry here refuses a
 * comment outright, so it may only contain terms with no innocent reading in a
 * training log. Slurs are represented by stems that do not collide with
 * ordinary words.
 */
const REJECT_PATTERNS: Array<[RegExp, string, string]> = [
  [/\bn[ i]*g+[ e3]*r\b|\bn[ i]*g+a\b/, 'racial-slur', 'That comment contains a slur.'],
  [/\bf[ a]*g+[o0]*t\b/, 'homophobic-slur', 'That comment contains a slur.'],
  [/\br[ e]*t[ a]*rd(ed)?\b/, 'ableist-slur', 'That comment contains a slur.'],
  [/\bk[ i]*ke\b|\bsp[ i]*c\b(?!\s*(y|es))/, 'ethnic-slur', 'That comment contains a slur.'],
  [/\btr[ a]*nn(y|ie)\b/, 'transphobic-slur', 'That comment contains a slur.'],
  [/\bc[ u]*nt\b/, 'sexual-abuse', 'That comment contains abusive language.'],
];

/**
 * Worth a human's attention, not a refusal.
 *
 * Sexual content and self-harm both belong here rather than in the list above.
 * A training app sees real, non-abusive discussion of both — body composition,
 * disordered eating, low mood after injury — and refusing those outright would
 * silence the conversations most worth having, which is a worse outcome than a
 * moderator reading one comment.
 */
const REVIEW_PATTERNS: Array<[RegExp, string]> = [
  [/\b(kill|hurt|harm)\s+(your|yr)\s*self\b|\bkys\b/, 'self-harm-directed'],
  [/\b(porn|xxx|nudes?)\b/, 'sexual'],
  [/\byou\s+(should|deserve\s+to)\s+die\b/, 'targeted-abuse'],
  [/\b(whore|slut)\b/, 'sexual-abuse'],
];

/**
 * Violent-sounding training idiom, matched only to be explicitly allowed.
 *
 * This list exists to be read by the next person who is tempted to add "kill"
 * or "destroy" to the patterns above. Every phrase here is an ordinary thing an
 * athlete writes on a friend's session.
 */
export const TRAINING_IDIOM =
  /\b(kill(ed|ing)?|murder(ed)?|destroy(ed)?|smash(ed)?|crush(ed)?|beat|dying|dead|savage|brutal|insane)\b/;

export function assess(text: string): Assessment {
  if (!text || !text.trim()) return CLEAN;

  const n = normalise(text);
  const c = collapsed(n);

  for (const [pattern, rule, refusal] of REJECT_PATTERNS) {
    if (pattern.test(n) || pattern.test(c)) return { verdict: 'reject', rule, refusal };
  }

  for (const [pattern, rule] of REVIEW_PATTERNS) {
    if (pattern.test(n)) {
      return {
        verdict: 'review',
        rule,
        // Published, not hidden: the athlete sees nothing, a moderator does.
        refusal: null,
      };
    }
  }

  return CLEAN;
}

/**
 * The same assessment applied to a display name or username.
 *
 * Stricter than comments on purpose: a name is rendered beside every comment
 * its owner writes and on every leaderboard they appear on, so it is seen far
 * more often and by people who did not choose to open a conversation. Anything
 * that would merely be flagged in a comment is refused in a name.
 */
export function assessProfileName(name: string): Assessment {
  const result = assess(name);
  if (result.verdict === 'review') {
    return { verdict: 'reject', rule: result.rule, refusal: 'Please choose a different name.' };
  }
  return result;
}
