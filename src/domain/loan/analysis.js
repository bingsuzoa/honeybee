import { checkLoanEligibility } from "./eligibility.js";
import { calculateRepayment, REPAYMENT_METHODS } from "./repayment.js";
import { pickRecommendedProduct, rankResults } from "./scoring.js";
import { calculateActualRate } from "./rate-calculator.js";

export function analyzeLoanProducts(input, products) {
  const rawResults = products.map((product) => {
    const eligibility = checkLoanEligibility(input, product);
    const principal = Math.min(input.requestedLoanAmount, eligibility.maxAvailableAmount);

    // 실제 금리 계산 (우대 조건 반영)
    const rateInfo = calculateActualRate(product, input);
    const actualRate = rateInfo.finalRate;

    const repaymentOptions = REPAYMENT_METHODS.filter((method) => product.repaymentTypes.includes(method.id)).map((method) => {
      const repayment = calculateRepayment(principal, actualRate, input.loanTermYears, method.id);
      return {
        id: method.id,
        label: method.label,
        monthlyPayment: repayment.monthlyPayment,
        firstMonthPayment: repayment.firstMonthPayment,
        lastMonthPayment: repayment.lastMonthPayment,
        totalRepayment: repayment.totalRepayment,
        totalInterest: repayment.totalInterest
      };
    });
    const repayment = repaymentOptions.find((option) => option.id === "equal_payment") ?? repaymentOptions[0];

    return {
      product,
      productId: product.id,
      productName: product.name,
      bank: product.bank,
      provider: product.provider,
      isEligible: eligibility.isEligible,
      ineligibleReasons: eligibility.ineligibleReasons,
      estimatedRate: actualRate,
      baseRate: rateInfo.baseRate,
      rateDiscounts: rateInfo.discounts,
      totalRateDiscount: rateInfo.totalDiscount,
      maxRateDiscount: rateInfo.maxDiscount,
      isRateCapped: rateInfo.isCapped,
      discountPeriodYears: rateInfo.discountPeriodYears,
      rateAfterDiscount: rateInfo.rateAfterDiscount,
      maxAvailableAmount: eligibility.maxAvailableAmount,
      hasEnoughLimit: eligibility.hasEnoughLimit,
      monthlyPayment: repayment?.monthlyPayment ?? 0,
      firstMonthPayment: repayment?.firstMonthPayment ?? 0,
      totalRepayment: repayment?.totalRepayment ?? 0,
      totalInterest: repayment?.totalInterest ?? 0,
      repaymentOptions,
      prepaymentPenaltySummary: product.prepaymentPenalty,
      score: 0,
      rank: null,
      reasons: buildReasons(input, product, eligibility, rateInfo),
      sourceReferences: product.sourceReferences
    };
  });

  const results = rankResults(rawResults);
  const recommended = pickRecommendedProduct(results);

  return {
    recommendedProductId: recommended?.productId ?? null,
    summary: recommended
      ? `현재 조건에서는 ${recommended.productName}이 가장 적합합니다.`
      : "현재 선택 조건으로는 추천 가능한 상품이 없습니다.",
    results
  };
}

function buildReasons(input, product, eligibility, rateInfo) {
  if (!eligibility.isEligible) {
    return eligibility.ineligibleReasons;
  }

  const reasons = ["자격 조건을 충족합니다."];
  if (eligibility.hasEnoughLimit) reasons.push("필요한 대출금액을 충족합니다.");
  if (["didimdol", "didimdol_newborn"].includes(product.category)) {
    reasons.push("정책대출 후보 중 낮은 금리 상품입니다.");
    if (rateInfo && rateInfo.discounts.length > 0) {
      reasons.push(`금리 우대 ${rateInfo.totalDiscount.toFixed(2)}%p 적용`);
    }
  }
  if (product.category === "bogeumjari") reasons.push("장기 고정금리 상품으로 비교 가치가 있습니다.");
  if (input.precisionLevel === "estimated") {
    reasons.push("구간 선택 기반 결과이므로 기준 경계에서는 정확한 금액 확인이 필요합니다.");
  }
  return reasons;
}
