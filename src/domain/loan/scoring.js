export function scoreLoanProduct(result, allResults) {
  if (result.product.category === "general") {
    return scoreGeneralMortgage(result, allResults);
  }

  if (!result.isEligible || !result.hasEnoughLimit) return 0;

  const eligibleResults = allResults.filter((item) => item.isEligible && item.hasEnoughLimit && item.product.category !== "general");
  if (!eligibleResults.length) return 0;
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

function scoreGeneralMortgage(result, allResults) {
  if (!result.isEligible) return 0;

  const eligibleGenerals = allResults.filter((item) => item.isEligible && item.product.category === "general");
  if (!eligibleGenerals.length) return 0;

  // 일반 주담대 점수는 금리 범위 기반
  const rate = result.estimatedRate || result.rateRange?.min || 99;
  const minRate = Math.min(...eligibleGenerals.map((item) => item.estimatedRate || item.rateRange?.min || 99));

  let score = 40; // 정책대출보다 기본 점수 낮음

  // 금리 경쟁력 (30점)
  score += relativeScore(rate, minRate, 30);

  // 데이터 최신성 (5점)
  score += result.product.comparisonEligible ? 5 : 0;

  // 한도 충족도 (5점) - hasEnoughLimit이 null이면 판단 불가이므로 부분 점수
  if (result.hasEnoughLimit === true) score += 5;
  else if (result.hasEnoughLimit === null) score += 2;

  // 미확인 조건 수 (적을수록 높은 점수, 5점)
  const unconfirmedCount = result.unconfirmedDiscounts?.length || 0;
  score += Math.max(0, 5 - unconfirmedCount);

  return Math.round(Math.min(score, 100));
}

export function rankResults(results) {
  const scored = results.map((result) => ({ ...result }));

  for (const result of scored) {
    result.score = scoreLoanProduct(result, scored);
  }

  // 정책대출과 일반 주담대를 분리하여 순위 매김
  const policyEligible = scored.filter((r) => r.isEligible && r.hasEnoughLimit && r.product.category !== "general");
  const generalEligible = scored.filter((r) => r.isEligible && r.product.category === "general");

  // 정책대출 순위
  policyEligible.sort((a, b) => b.score - a.score || a.totalInterest - b.totalInterest);
  policyEligible.forEach((result, index) => {
    const original = scored.find((item) => item.productId === result.productId);
    original.rank = index + 1;
  });

  // 일반 주담대 순위 (정책대출 뒤에 이어서)
  generalEligible.sort((a, b) => b.score - a.score || (a.estimatedRate || 99) - (b.estimatedRate || 99));
  const generalRankOffset = policyEligible.length;
  generalEligible.forEach((result, index) => {
    const original = scored.find((item) => item.productId === result.productId);
    original.rank = generalRankOffset + index + 1;
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

export function buildRankingReason(first, second) {
  if (!second) return null;

  const items = [];

  // 예상 금리 비교 (낮을수록 유리)
  const firstRate = first.estimatedRate;
  const secondRate = second.estimatedRate;
  if (firstRate && secondRate) {
    const winner = firstRate < secondRate ? "first" : secondRate < firstRate ? "second" : "draw";
    items.push({
      label: "예상 금리",
      firstValue: `${firstRate.toFixed(2)}%`,
      secondValue: `${secondRate.toFixed(2)}%`,
      winner,
      note: null
    });
  }

  // 한도 충족 비교
  const fmtLimit = (v) => v === true ? "충족" : v === false ? "부족" : "미확인";
  const limitWinner = first.hasEnoughLimit === second.hasEnoughLimit ? "draw"
    : first.hasEnoughLimit === true ? "first"
    : second.hasEnoughLimit === true ? "second" : "draw";
  items.push({
    label: "한도 충족",
    firstValue: fmtLimit(first.hasEnoughLimit),
    secondValue: fmtLimit(second.hasEnoughLimit),
    winner: limitWinner,
    note: null
  });

  // 상환방식별 비교 (공통 상환방식 기준)
  const firstOptions = first.repaymentOptions || [];
  const secondOptions = second.repaymentOptions || [];
  const commonMethodIds = firstOptions
    .map((o) => o.id)
    .filter((id) => secondOptions.some((o) => o.id === id));

  for (const methodId of commonMethodIds) {
    const fo = firstOptions.find((o) => o.id === methodId);
    const so = secondOptions.find((o) => o.id === methodId);
    if (!fo || !so || fo.monthlyPayment <= 0 || so.monthlyPayment <= 0) continue;

    const label = `월 납입(${fo.label})`;
    const monthlyWinner = fo.monthlyPayment < so.monthlyPayment ? "first"
      : so.monthlyPayment < fo.monthlyPayment ? "second" : "draw";
    items.push({
      label,
      firstValue: formatWon(fo.monthlyPayment),
      secondValue: formatWon(so.monthlyPayment),
      winner: monthlyWinner,
      note: null
    });

    const interestWinner = fo.totalInterest < so.totalInterest ? "first"
      : so.totalInterest < fo.totalInterest ? "second" : "draw";
    items.push({
      label: `총 이자(${fo.label})`,
      firstValue: formatWon(fo.totalInterest),
      secondValue: formatWon(so.totalInterest),
      winner: interestWinner,
      note: null
    });
  }

  const advantages = items.filter((item) => item.winner === "first").map((item) => item.label);
  let summary;
  if (advantages.length === 0) {
    summary = "종합 점수 기준으로 1순위로 선정되었습니다.";
  } else {
    const labels = [...new Set(advantages.map((l) => l.replace(/\(.*\)/, "").trim()))];
    summary = `${labels.join(", ")}에서 유리하여 1순위로 선정되었습니다.`;
  }

  return { items, summary };
}

function formatWon(value) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function relativeScore(value, bestValue, maxScore) {
  if (value <= bestValue) return maxScore;
  if (value === 0) return 0;
  const ratio = bestValue / value;
  return Math.max(0, Math.round(maxScore * ratio));
}
