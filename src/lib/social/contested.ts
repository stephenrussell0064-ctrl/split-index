/**
 * When is a rank worth showing?
 *
 * WHAT WAS WRONG
 * --------------
 * Measured against production on 21 September 2026: of 22 exercises with any
 * logged score, **19 had exactly one athlete on the board**. Nine ranked
 * athletes fell into seven exact peer brackets and six of those held one
 * person. So nearly every athlete opened the Lab and was told they were #1 —
 * at bench, at squat, in their bracket — against nobody at all.
 *
 * It was not an arithmetic bug. `rank: i + 1` over a sorted list of one is
 * correctly 1. The mistake was presenting that number as a placing, in the
 * same gold type used for a real podium, when there was no contest to place
 * in. An athlete who reads "#1" and later works out they were alone does not
 * conclude the board was being literal; they conclude it was flattering them,
 * and everything else it says is worth less afterwards.
 *
 * THE RULE
 * --------
 * A placing needs somebody to be placed against. Two is not a competition
 * either — it is a comparison, and "#1 of 2" invites exactly the same
 * misreading. Three is the smallest field where a middle exists, so it is the
 * smallest field where a rank carries information.
 *
 * Below that the honest thing is to say how many athletes are on the board and
 * not to award a position. The score itself is still shown: it is the
 * athlete's own number and it means what it always did.
 */
export const MIN_CONTESTED_BOARD = 3;

/** Does this board have enough athletes for a position to mean anything? */
export function isContested(boardSize: number): boolean {
  return boardSize >= MIN_CONTESTED_BOARD;
}

/**
 * What to say instead of a rank, when there is no contest.
 *
 * Deliberately not an apology and not an exhortation. It states the size of
 * the field, which is the fact the rank was standing in for.
 */
export function uncontestedLabel(boardSize: number): string {
  if (boardSize <= 1) return "You are the only athlete here so far";
  return `Only ${boardSize} athletes here so far — too few to rank`;
}
