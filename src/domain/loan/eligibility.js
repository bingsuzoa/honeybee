/**
 * 일반 주담대 자격 판정.
 * 정책대출과 달리 엄격한 자격요건이 아닌 상품 매칭 기반.
 */
export function checkGeneralMortgageEligibility(input, product) {
  const reasons = [];
  const gm = product.generalMortgage;

  // 비교 불가 (stale 데이터)
  if (!product.comparisonEligible) {
    reasons.push("금리 데이터가 최신이 아니어서 비교 대상에서 제외됩니다.");
    return { isEligible: false, ineligibleReasons: reasons, eligibilityType: "DATA_STALE", maxAvailableAmount: null, hasEnoughLimit: null };
  }

  // 담보 유형 매칭
  if (gm?.collateralTypes?.length && input.housingType) {
    const isApartment = input.housingType === "apartment";
    const collateralMatch = isApartment
      ? gm.collateralTypes.some((t) => t.includes("아파트") || t === "주택")
      : gm.collateralTypes.some((t) => !t.includes("아파트") || t.includes("주택"));
    if (!collateralMatch) {
      reasons.push(`이 상품은 ${gm.collateralTypes.join(", ")} 담보만 가능합니다.`);
    }
  }

  // 대출 목적 매칭
  if (gm?.purposes?.length && input.detailedPurpose) {
    const purposeMap = {
      purchase: ["주택구입", "주택구입자금", "주택자금", "가계자금", "구입자금대출"],
      refinance: ["대환", "타행대환", "기타 주택담보자금", "가계자금"],
      living: ["생활안정자금", "가계자금", "기타 주택담보자금"]
    };
    const expectedPurposes = purposeMap[input.detailedPurpose] || [];
    const purposeMatch = expectedPurposes.some((ep) => gm.purposes.some((gp) => gp.includes(ep) || ep.includes(gp)));
    if (!purposeMatch && input.detailedPurpose !== "unknown") {
      reasons.push(`이 상품은 ${gm.purposes.join(", ")} 목적만 가능합니다.`);
    }
  }

  // 수도권 기간 제한
  if (gm?.termYears?.capitalAreaMaximum && input.region === "capital") {
    if (input.loanTermYears > gm.termYears.capitalAreaMaximum) {
      reasons.push(`수도권 주택은 최대 ${gm.termYears.capitalAreaMaximum}년까지 가능합니다.`);
    }
  }

  return {
    isEligible: reasons.length === 0,
    ineligibleReasons: reasons,
    eligibilityType: "BANK_REVIEW_REQUIRED",
    maxAvailableAmount: null,
    hasEnoughLimit: null
  };
}

export function checkLoanEligibility(input, product) {
  const reasons = [];
  const elig = product.eligibility;

  if (!product.isActive) reasons.push("현재 비교 대상 상품이 아닙니다.");
  if (elig.requiresMarried && !input.isMarried) reasons.push("신혼부부 조건을 충족하지 않습니다.");
  if (elig.requiresNewlyMarried && input.marriagePeriodRange.minYears >= elig.maxMarriageYears) {
    reasons.push("신혼부부 인정 기간을 초과했습니다.");
  }
  if (elig.requiresNewborn && !input.hasNewborn) reasons.push("2년 이내 출생아 요건을 충족하지 않습니다.");
  if (elig.requiresNoHouse && !input.isNoHousehold) reasons.push("무주택 요건을 충족하지 않습니다.");
  if (elig.requiresHouseholdNoHouseConfirmed && input.householdNoHouseConfirmed !== "yes") {
    if (input.householdNoHouseConfirmed === "unknown") {
      reasons.push("주민등록등본 기준 세대원 전원 무주택 여부 확인이 필요합니다.");
    } else {
      reasons.push("본인, 배우자 또는 세대원 중 주택 보유자가 있어 무주택 요건을 충족하지 않습니다.");
    }
  }
  if (elig.requiresPurchasePurpose && input.purchasePurpose !== "purchase_live") {
    if (input.purchasePurpose === "unknown") reasons.push("주택 구입 및 실거주 목적 여부 확인이 필요합니다.");
    else reasons.push("정책대출은 주택 구입 및 실거주 목적이어야 합니다.");
  }
  if (elig.requiresNoExistingFundLoan && input.householdLoanStatus !== "no_existing_fund_loan") {
    if (input.householdLoanStatus === "unknown") reasons.push("기존 주택도시기금 대출 보유 여부 확인이 필요합니다.");
    else reasons.push("기존 주택도시기금 대출 보유 여부가 자격에 영향을 줄 수 있습니다.");
  }
  if (elig.requiresSaleContract && input.contractAndMoveInStatus !== "contract_signed_move_in") {
    if (input.contractAndMoveInStatus === "unknown") reasons.push("매매계약 및 입주 계획 확인이 필요합니다.");
    else if (input.contractAndMoveInStatus === "before_contract") reasons.push("매매계약 전 상태라 대출 신청 가능 여부 확인이 필요합니다.");
    else reasons.push("실거주 입주 계획을 충족하지 않습니다.");
  }
  if (elig.requiresEligibleHouseType && input.houseLegalStatus !== "eligible_residential") {
    if (input.houseLegalStatus === "unknown") reasons.push("담보주택 유형 및 담보 설정 가능 여부 확인이 필요합니다.");
    else if (input.houseLegalStatus === "unclear_house_type") reasons.push("주택 유형이 대출 대상인지 추가 확인이 필요합니다.");
    else reasons.push("담보 설정 또는 소유권 이전 조건을 충족하지 않습니다.");
  }
  if (elig.requiresNoCreditIssue && input.creditStatus !== "no_issue") {
    if (input.creditStatus === "unknown") reasons.push("연체 및 신용상 문제 여부 확인이 필요합니다.");
    else reasons.push("연체 또는 신용상 이슈가 대출 취급에 영향을 줄 수 있습니다.");
  }
  const incomeLimit = (input.isDualIncome && elig.maxDualIncome) ? elig.maxDualIncome : elig.maxCombinedIncome;
  if (incomeLimit && input.combinedIncome > incomeLimit) {
    reasons.push("부부합산 연소득 기준을 초과했습니다.");
  }
  if (elig.maxNetAsset && input.netAsset > elig.maxNetAsset) {
    reasons.push("순자산 기준을 초과했습니다.");
  }
  if (elig.maxHousePrice && input.housePrice > elig.maxHousePrice) {
    reasons.push("주택가격 기준을 초과했습니다.");
  }
  if (elig.maxExclusiveArea && input.exclusiveArea > elig.maxExclusiveArea) {
    reasons.push("전용면적 기준을 초과했습니다.");
  }
  if (input.housingStatus === "unknown") {
    reasons.push("무주택 여부를 알 수 없어 정책대출 판단 정확도가 낮습니다.");
  }
  if (input.netAssetStatus === "unknown") {
    reasons.push("순자산 정보를 알 수 없어 정책대출 판단 정확도가 낮습니다.");
  }

  const effectiveMaxLoanAmount = (input.isLegacyContract && product.legacyMaxLoanAmount)
    ? product.legacyMaxLoanAmount
    : product.maxLoanAmount;

  const maxByLtv = elig.ltvRatio ? Math.floor(input.housePrice * elig.ltvRatio) : effectiveMaxLoanAmount;
  const maxAvailableAmount = Math.min(effectiveMaxLoanAmount, maxByLtv);
  const hasEnoughLimit = input.requestedLoanAmount <= maxAvailableAmount;

  if (!hasEnoughLimit) {
    reasons.push("필요한 대출금액이 최대 가능 금액보다 큽니다.");
  }

  const hardReasons = reasons.filter((reason) => !reason.includes("정확도가 낮습니다"));

  return {
    isEligible: product.isActive && hardReasons.length === 0,
    ineligibleReasons: reasons,
    maxAvailableAmount,
    hasEnoughLimit
  };
}
