export interface SportComparisonStats {
  history: number[];
  average: number;
  percentile: number;
  deltaVsAverage: number;
  rank: number;
  total: number;
}

/** Compare a session score against prior same-sport history (apples to apples). */
export function computeSportComparison(
  currentScore: number,
  priorScores: number[],
  window = 10
): SportComparisonStats {
  const history = priorScores.slice(0, window);
  const total = history.length;

  if (total === 0) {
    return {
      history: [],
      average: currentScore,
      percentile: 50,
      deltaVsAverage: 0,
      rank: 1,
      total: 0,
    };
  }

  const average = Math.round(
    history.reduce((sum, s) => sum + s, 0) / total
  );
  const below = history.filter((s) => s < currentScore).length;
  const percentile = Math.round((below / total) * 100);
  const rank = total - below + 1;

  return {
    history: [...history].reverse(),
    average,
    percentile,
    deltaVsAverage: currentScore - average,
    rank,
    total,
  };
}
