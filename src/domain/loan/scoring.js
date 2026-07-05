export function scoreLoanProduct(result, allResults) {
  if (!result.isEligible || !result.hasEnoughLimit) return 0;

  const eligibleResults = allResults.filter((item) => item.isEligible && item.hasEnoughLimit);
  const minInterest = Math.min(...eligibleResults.map((item) => item.totalInterest));
  const minMonthlyPayment = Math.min(...eligibleResults.map((item) => item.monthlyPayment));
  const minRate = Math.min(...eligibleResults.map((item) => item.estimatedRate));

  let score = 55;

  score += relativeScore(result.totalInterest, minInterest, 20);
  score += relativeScore(result.monthlyPayment, minMonthlyPayment, 10);
  score += relativeScore(result.estimatedRate, minRate, 10);
  score += ["didimdol", "didimdol_newborn", "bogeumjari"].includes(result.product.category) ? 3 : 0;
  score += result.product.prepaymentPenaltyLevel === "low" ? 2 : 0;

  return Math.round(Math.min(score, 100));
}

export function rankResults(results) {
  const scored = results.map((result) => ({ ...result }));
  const eligible = scored.filter((result) => result.isEligible && result.hasEnoughLimit);

  for (const result of scored) {
    result.score = scoreLoanProduct(result, scored);
  }

  eligible.sort((a, b) => b.score - a.score || a.totalInterest - b.totalInterest);
  eligible.forEach((result, index) => {
    const original = scored.find((item) => item.productId === result.productId);
    original.rank = index + 1;
  });

  for (const result of scored) {
    if (!result.rank) result.rank = null;
  }

  return scored.sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.rank) return -1;
    if (b.rank) return 1;
    return b.score - a.score;
  });
}

export function pickRecommendedProduct(results) {
  return results.find((result) => result.rank === 1) ?? null;
}

function relativeScore(value, bestValue, maxScore) {
  if (value <= bestValue) return maxScore;
  if (value === 0) return 0;
  const ratio = bestValue / value;
  return Math.max(0, Math.round(maxScore * ratio));
}
