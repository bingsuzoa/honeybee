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
