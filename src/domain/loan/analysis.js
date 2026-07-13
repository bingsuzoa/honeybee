import { checkLoanEligibility, checkGeneralMortgageEligibility } from "./eligibility.js";
import { calculateRepayment, REPAYMENT_METHODS } from "./repayment.js";
import { pickRecommendedProduct, rankResults, buildRankingReason } from "./scoring.js";
import { calculateActualRate } from "./rate-calculator.js";
import { estimateGeneralMortgageLimit } from "./limit-calculator.js";

/**
 * 정책대출만 분석 (기존 로직, Phase 1)
 */
export function analyzeLoanProducts(input, products) {
  const policyProducts = products.filter((p) => p.category !== "general");
  return analyzeProducts(input, policyProducts);
}

/**
 * 정책대출 + 일반 주담대 통합 분석 (Phase 2)
 */
export function analyzeAllProducts(input, products, ltvRules) {
  const policyProducts = products.filter((p) => p.category !== "general");
  const generalProducts = products.filter((p) => p.category === "general");

  // 정책대출 분석 (기존 로직)
  const policyResults = policyProducts.map((product) => analyzePolicyProduct(input, product));

  // 일반 주담대 분석 (신규 로직)
  const generalResults = generalProducts.map((product) => analyzeGeneralProduct(input, product, ltvRules));

  const allResults = [...policyResults, ...generalResults];
  const results = rankResults(allResults);
  const recommended = pickRecommendedProduct(results);

  // 정책대출 가능 여부 요약
  const anyPolicyEligible = policyResults.some((r) => r.isEligible && r.hasEnoughLimit);
  const policyLimitShort = policyResults.some((r) => r.isEligible && !r.hasEnoughLimit);

  return {
    recommendedProductId: recommended?.productId ?? null,
    summary: buildSummary(recommended, anyPolicyEligible, policyLimitShort),
    results,
    policyResults: policyResults,
    generalResults: generalResults,
    anyPolicyEligible,
    policyLimitShort
  };
}

/**
 * 정책대출 분석 결과만 기반으로 Phase 2 진입이 필요한지 판단.
 */
export function shouldAutoEnterPhase2(policyAnalysis) {
  const { results } = policyAnalysis;
  const allIneligible = results.every((r) => !r.isEligible);
  const anyLimitShort = results.some((r) => r.isEligible && !r.hasEnoughLimit);
  return allIneligible || anyLimitShort;
}

function analyzeProducts(input, products) {
  const rawResults = products.map((product) => analyzePolicyProduct(input, product));

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

function analyzePolicyProduct(input, product) {
  const eligibility = checkLoanEligibility(input, product);
  const principal = Math.min(input.requestedLoanAmount, eligibility.maxAvailableAmount);

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
}

function analyzeGeneralProduct(input, product, ltvRules) {
  const eligibility = checkGeneralMortgageEligibility(input, product);
  const rateInfo = calculateActualRate(product, input);

  // 한도 추정
  const limitResult = ltvRules ? estimateGeneralMortgageLimit(input, product, ltvRules) : null;
  const estimatedMaxAmount = limitResult?.estimatedMaxAmount ?? null;
  const hasEnoughLimit = limitResult?.hasEnoughLimit ?? null;

  // 상환액 계산 (예상금리 기준)
  const calcRate = rateInfo.estimatedRate || rateInfo.rateRange?.min || 5.0;
  const principal = estimatedMaxAmount
    ? Math.min(input.requestedLoanAmount, estimatedMaxAmount)
    : input.requestedLoanAmount;

  const repaymentTypes = ["equal_payment", "equal_principal"];
  const repaymentOptions = REPAYMENT_METHODS
    .filter((method) => repaymentTypes.includes(method.id) && product.repaymentTypes.includes(method.id))
    .map((method) => {
      const repayment = calculateRepayment(principal, calcRate, input.loanTermYears, method.id);
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

  // 상환액이 없으면 calcRate로 원리금균등 직접 계산
  let repayment;
  if (repaymentOptions.length > 0) {
    repayment = repaymentOptions.find((o) => o.id === "equal_payment") ?? repaymentOptions[0];
  } else {
    const r = calculateRepayment(principal, calcRate, input.loanTermYears, "equal_payment");
    repayment = { id: "equal_payment", label: "원리금균등", ...r };
    repaymentOptions.push(repayment);
  }

  return {
    product,
    productId: product.id,
    productName: product.name,
    bank: product.provider,
    provider: product.provider,
    isEligible: eligibility.isEligible,
    ineligibleReasons: eligibility.ineligibleReasons,
    eligibilityType: eligibility.eligibilityType,
    estimatedRate: rateInfo.estimatedRate || calcRate,
    rateRange: rateInfo.rateRange,
    baseRate: rateInfo.baseRate,
    rateDiscounts: rateInfo.confirmedDiscounts || [],
    unconfirmedDiscounts: rateInfo.unconfirmedDiscounts || [],
    totalRateDiscount: rateInfo.totalDiscount,
    maxRateDiscount: rateInfo.maxDiscount,
    isRateCapped: false,
    discountPeriodYears: 0,
    rateAfterDiscount: rateInfo.rateAfterDiscount,
    rateType: rateInfo.rateType,
    alternativeRates: rateInfo.alternativeRates || [],
    rateNoticeDate: rateInfo.rateNoticeDate,
    isEstimate: true,
    maxAvailableAmount: estimatedMaxAmount,
    hasEnoughLimit,
    limitDetails: limitResult,
    monthlyPayment: repayment?.monthlyPayment ?? 0,
    firstMonthPayment: repayment?.firstMonthPayment ?? 0,
    totalRepayment: repayment?.totalRepayment ?? 0,
    totalInterest: repayment?.totalInterest ?? 0,
    repaymentOptions,
    rateAssumptionNote: "현재 금리가 유지된다는 가정 하에 계산된 참고용 예상치입니다.",
    prepaymentPenaltySummary: formatGeneralPrepaymentFee(product),
    score: 0,
    rank: null,
    reasons: buildGeneralReasons(input, product, eligibility, rateInfo, limitResult),
    sourceReferences: product.sourceReferences
  };
}

function formatGeneralPrepaymentFee(product) {
  const pf = product.generalMortgage?.prepaymentFee;
  if (!pf) return "중도상환수수료 정보 없음";
  const rates = [pf.baseRate, pf.fixedRate, pf.variableRate, pf.mixedRate].filter((r) => r != null);
  if (!rates.length) return "중도상환수수료 정보 확인 필요";
  const maxRate = Math.max(...rates);
  return `중도상환수수료 최대 ${(maxRate * 100).toFixed(1)}% (${pf.maximumChargeYears || 3}년 이내)`;
}

function buildSummary(recommended, anyPolicyEligible, policyLimitShort) {
  if (!recommended) {
    return "현재 선택 조건으로는 추천 가능한 상품이 없습니다.";
  }
  if (recommended.product.category === "general") {
    if (anyPolicyEligible) {
      return `정책대출과 함께 ${recommended.productName}도 비교 가치가 있습니다.`;
    }
    if (policyLimitShort) {
      return `정책대출 한도 부족으로 ${recommended.productName}이 대안이 될 수 있습니다.`;
    }
    return `일반 주담대 중 ${recommended.productName}이 현재 조건에서 가장 유리합니다.`;
  }
  return `현재 조건에서는 ${recommended.productName}이 가장 적합합니다.`;
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

function buildGeneralReasons(input, product, eligibility, rateInfo, limitResult) {
  if (!eligibility.isEligible) {
    return eligibility.ineligibleReasons;
  }

  const reasons = [];

  if (rateInfo.rateRange) {
    reasons.push(`예상 금리 ${rateInfo.rateRange.min}% ~ ${rateInfo.rateRange.max}% (${rateInfo.rateType || "변동금리"})`);
  }

  if (limitResult?.hasEnoughLimit === true) {
    reasons.push("예상 한도 내 대출 가능");
  } else if (limitResult?.hasEnoughLimit === false) {
    reasons.push("예상 한도 부족 (은행 심사에 따라 달라질 수 있음)");
  } else {
    reasons.push("한도는 은행 심사 결과에 따라 결정됩니다");
  }

  if (product.channel === "MOBILE") {
    reasons.push("모바일 비대면 신청 가능");
  }

  reasons.push("최종 금리와 한도는 은행 심사 결과에 따라 달라집니다.");

  return reasons;
}

export { buildRankingReason };
