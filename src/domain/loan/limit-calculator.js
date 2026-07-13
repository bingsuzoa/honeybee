/**
 * 일반 주담대 한도 추정 엔진.
 * LTV 규제, DSR, 임시한도 정책을 기반으로 예상 한도를 계산한다.
 */

/**
 * LTV 규제에 따른 한도를 계산한다.
 * @param {number} housePrice - 주택가격
 * @param {string} regulationZone - 규제지역 구분 (SPECULATION_OVERHEATED, ADJUSTMENT_TARGET, NON_REGULATED, unknown)
 * @param {number} ownerCount - 기존 주택 보유 수 (0 = 무주택)
 * @param {object} ltvRules - LTV 규제 데이터
 * @returns {{ ltvLimit: number|null, ltvRatio: number|null, calculable: boolean, note: string|null }}
 */
export function calculateLtvLimit(housePrice, regulationZone, ownerCount, ltvRules) {
  if (!ltvRules?.ltvRules) {
    return { ltvLimit: null, ltvRatio: null, calculable: false, note: "LTV 규제 데이터 없음" };
  }

  // 규제지역 모름 → 비규제 70% 적용
  const effectiveZone = regulationZone === "unknown" ? "NON_REGULATED" : regulationZone;
  const zoneRules = ltvRules.ltvRules.find((z) => z.zone === effectiveZone);
  if (!zoneRules) {
    return { ltvLimit: null, ltvRatio: null, calculable: false, note: "해당 규제지역 데이터 없음" };
  }

  // 보유 주택 수에 맞는 규칙 찾기
  const matchingRule = zoneRules.rules.find((rule) => {
    if (rule.ownerCount !== undefined && rule.ownerCount !== ownerCount) return false;
    if (rule.housePriceMax !== undefined && housePrice > rule.housePriceMax) return false;
    if (rule.housePriceMin !== undefined && housePrice < rule.housePriceMin) return false;
    return true;
  });

  if (!matchingRule) {
    return { ltvLimit: null, ltvRatio: null, calculable: false, note: "해당 조건에 맞는 LTV 규칙 없음" };
  }

  if (matchingRule.ltv === 0) {
    return {
      ltvLimit: 0,
      ltvRatio: 0,
      calculable: true,
      note: matchingRule.note || "주택구입 목적 대출 불가"
    };
  }

  const ltvLimit = Math.floor(housePrice * matchingRule.ltv);
  const note = regulationZone === "unknown" ? "규제지역에 따라 한도가 달라질 수 있습니다" : null;

  return {
    ltvLimit,
    ltvRatio: matchingRule.ltv,
    calculable: true,
    note
  };
}

/**
 * DSR 기반 한도를 추정한다.
 * @param {number} annualIncome - 연소득
 * @param {number} existingAnnualRepayment - 기존 대출 연간 원리금 상환액
 * @param {number} annualRate - 예상 금리 (%)
 * @param {number} termYears - 대출 기간
 * @param {object} dsrRules - DSR 규제 데이터
 * @returns {{ dsrLimit: number|null, calculable: boolean, reason: string|null }}
 */
export function estimateDsrLimit(annualIncome, existingAnnualRepayment, annualRate, termYears, dsrRules) {
  if (!annualIncome || annualIncome <= 0) {
    return { dsrLimit: null, calculable: false, reason: "소득 정보 없음" };
  }

  const dsrLimit = dsrRules?.generalBorrower?.dsrLimit ?? 0.40;
  const maxAnnualRepayment = annualIncome * dsrLimit;
  const availableRepayment = maxAnnualRepayment - (existingAnnualRepayment || 0);

  if (availableRepayment <= 0) {
    return { dsrLimit: 0, calculable: true, reason: "기존 대출 상환액이 DSR 한도를 초과합니다" };
  }

  // 원리금균등 기준으로 가능 대출금액 역산
  const monthlyRate = annualRate / 100 / 12;
  const months = termYears * 12;
  const maxMonthlyPayment = availableRepayment / 12;

  if (monthlyRate === 0) {
    return { dsrLimit: Math.floor(maxMonthlyPayment * months), calculable: true, reason: null };
  }

  const power = (1 + monthlyRate) ** months;
  const maxPrincipal = Math.floor(maxMonthlyPayment * (power - 1) / (monthlyRate * power));

  return { dsrLimit: maxPrincipal, calculable: true, reason: null };
}

/**
 * 일반 주담대 예상 한도를 종합적으로 추정한다.
 */
export function estimateGeneralMortgageLimit(input, product, ltvRules) {
  const limits = [];
  const notes = [];

  // 1. 임시한도 정책
  const tempPolicy = product.generalMortgage?.temporaryPolicy;
  if (tempPolicy?.maximumAmount) {
    let tempLimit = tempPolicy.maximumAmount;
    // 고가주택 특별 규칙 (예: KB 25억 초과 시 2억)
    if (tempPolicy.higherPriorityRule && input.housePrice > 2500000000) {
      tempLimit = tempPolicy.higherPriorityRule.maximumAmount;
      notes.push(`주택 시가 25억원 초과: 한도 ${formatAmount(tempLimit)}`);
    }
    limits.push({ type: "temporaryPolicy", amount: tempLimit, calculable: true });
  }

  // 2. LTV 한도
  const ownerCount = input.isNoHousehold ? 0 : (input.housingStatus === "owned" ? 1 : 0);
  const ltvResult = calculateLtvLimit(input.housePrice, input.regulationZone || "unknown", ownerCount, ltvRules);
  if (ltvResult.calculable) {
    limits.push({ type: "ltv", amount: ltvResult.ltvLimit, calculable: true, ratio: ltvResult.ltvRatio });
    if (ltvResult.note) notes.push(ltvResult.note);
  } else {
    limits.push({ type: "ltv", amount: null, calculable: false, note: ltvResult.note });
  }

  // 3. DSR 한도
  const estimatedRate = getEstimatedRateForDsr(product);
  const dsrResult = estimateDsrLimit(
    input.combinedIncome,
    input.existingAnnualRepayment || 0,
    estimatedRate,
    input.loanTermYears,
    ltvRules?.dsrRules
  );
  if (dsrResult.calculable) {
    limits.push({ type: "dsr", amount: dsrResult.dsrLimit, calculable: true });
    if (dsrResult.reason) notes.push(dsrResult.reason);
  } else {
    limits.push({ type: "dsr", amount: null, calculable: false, note: dsrResult.reason });
  }

  // 4. 사용자 요청 금액
  limits.push({ type: "userRequest", amount: input.requestedLoanAmount, calculable: true });

  // 종합 한도: 계산 가능한 한도 중 최솟값
  const calculableLimits = limits.filter((l) => l.calculable && l.amount !== null && l.amount > 0);
  const estimatedMaxAmount = calculableLimits.length > 0
    ? Math.min(...calculableLimits.map((l) => l.amount))
    : null;

  const hasEnoughLimit = estimatedMaxAmount !== null
    ? input.requestedLoanAmount <= estimatedMaxAmount
    : null; // null = 판단 불가

  return {
    estimatedMaxAmount,
    hasEnoughLimit,
    limits,
    notes,
    isEstimate: true
  };
}

function getEstimatedRateForDsr(product) {
  const rateTable = product.generalMortgage?.rateTable;
  if (!rateTable || !rateTable.length) return 5.0; // fallback
  // 가장 낮은 minimumRate 사용
  const rates = rateTable.map((r) => r.minimumRate).filter((r) => r != null);
  return rates.length > 0 ? Math.min(...rates) : 5.0;
}

function formatAmount(amount) {
  if (amount >= 100000000) return `${amount / 100000000}억원`;
  return `${amount / 10000}만원`;
}
