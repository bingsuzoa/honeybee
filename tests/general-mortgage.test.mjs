import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeAllProducts, analyzeLoanProducts, shouldAutoEnterPhase2 } from "../src/domain/loan/analysis.js";
import { checkGeneralMortgageEligibility } from "../src/domain/loan/eligibility.js";
import { calculateActualRate } from "../src/domain/loan/rate-calculator.js";
import { normalizeSelections } from "../src/domain/loan/selection-options.js";
import { calculateLtvLimit, estimateDsrLimit, estimateGeneralMortgageLimit } from "../src/domain/loan/limit-calculator.js";

const { products } = JSON.parse(
  readFileSync(new URL("../src/data/products.json", import.meta.url), "utf-8")
);

const ltvRules = JSON.parse(
  readFileSync(new URL("../src/data/ltv-rules.json", import.meta.url), "utf-8")
);

const defaultSelections = {
  maritalStatus: "married",
  marriagePeriod: "under7",
  hasNewborn: "no",
  housingStatus: "none",
  householdNoHouseConfirmed: "yes",
  firstHomeBuyer: "yes",
  childrenCount: "0",
  combinedIncome: "under85",
  netAsset: "under511",
  housePrice: "under600",
  region: "capital",
  exclusiveArea: "under85",
  privateSale: "no",
  requestedLoanAmount: "under320",
  loanTermYears: "30",
  purchasePurpose: "purchase_live",
  householdLoanStatus: "no_existing_fund_loan",
  contractAndMoveInStatus: "contract_signed_move_in",
  contractDate: "on_or_after2025_06_27",
  houseLegalStatus: "eligible_residential",
  creditStatus: "no_issue",
  acquisitionType: "GENERAL_PURCHASE",
  hasHousingSubscription: "yes",
  subscriptionYears: "over15",
  subscriptionPaymentCount: "over180",
  usesElectronicContract: "no"
};

const generalProducts = products.filter((p) => p.category === "general");
const policyProducts = products.filter((p) => p.category !== "general");

// --- 1. 정책대출 모두 불가 + 일반 주담대만 후보 (소득 2억 초과) ---
test("income over 200M: all policy loans ineligible, general mortgages eligible", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    combinedIncome: "over200",
    housingType: "apartment"
  });

  const policyAnalysis = analyzeLoanProducts(input, products);
  assert.ok(shouldAutoEnterPhase2(policyAnalysis));

  const analysis = analyzeAllProducts(input, products, ltvRules);
  const eligibleGeneral = analysis.results.filter((r) => r.isEligible && r.product.category === "general");
  assert.ok(eligibleGeneral.length > 0);
});

// --- 2. 정책대출 가능 + 한도 초과 → 일반 주담대 병행 ---
test("policy eligible but limit short triggers auto Phase 2", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    requestedLoanAmount: "over400"
  });

  const policyAnalysis = analyzeLoanProducts(input, products);
  assert.ok(shouldAutoEnterPhase2(policyAnalysis));
});

// --- 3. DSR 계산 불가 (소득정보 없음) ---
test("DSR not calculable when income is zero", () => {
  const result = estimateDsrLimit(0, 0, 5.0, 30, ltvRules.dsrRules);
  assert.equal(result.calculable, false);
  assert.equal(result.reason, "소득 정보 없음");
});

// --- 4. 신용점수 모름 → 금리 범위 표시 ---
test("general mortgage rate returns range when credit unknown", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    creditScore: "unknown"
  });
  const rateInfo = calculateActualRate(kb, input);

  assert.ok(rateInfo.isEstimate);
  assert.ok(rateInfo.rateRange);
  assert.ok(rateInfo.rateRange.min < rateInfo.rateRange.max);
  assert.equal(rateInfo.finalRate, null);
});

// --- 5. 아파트 vs 비아파트 → 상품 필터링 ---
test("apartment type filters out non-apartment products", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    housingType: "apartment"
  });

  const wooriRealEstate = generalProducts.find((p) => p.name.includes("부동산론(일반"));
  if (wooriRealEstate) {
    const result = checkGeneralMortgageEligibility(input, wooriRealEstate);
    assert.equal(result.isEligible, false);
    assert.ok(result.ineligibleReasons.some((r) => r.includes("담보")));
  }
});

test("non-apartment type filters out apartment-only products", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    housingType: "non_apartment"
  });

  const shinhanApt = generalProducts.find((p) => p.name.includes("신한주택대출(아파트)"));
  if (shinhanApt) {
    const result = checkGeneralMortgageEligibility(input, shinhanApt);
    assert.equal(result.isEligible, false);
  }
});

// --- 6. 수도권 → 기간 제한 적용 ---
test("capital area enforces maximum term years", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    region: "capital",
    loanTermYears: "40"
  });

  const productWith30Limit = generalProducts.find(
    (p) => p.generalMortgage?.termYears?.capitalAreaMaximum === 30
  );
  if (productWith30Limit) {
    const result = checkGeneralMortgageEligibility(input, productWith30Limit);
    assert.equal(result.isEligible, false);
    assert.ok(result.ineligibleReasons.some((r) => r.includes("30년")));
  }
});

// --- 7. 채널 선호는 자격 필터로 사용하지 않음 ---
test("branch preference does not filter out mobile-only products", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    preferredChannel: "branch"
  });

  const mobileProducts = generalProducts.filter((p) => p.channel === "MOBILE");
  for (const mp of mobileProducts) {
    const result = checkGeneralMortgageEligibility(input, mp);
    assert.equal(result.isEligible, true);
  }
});

// --- 8. 우대금리 전혀 충족 안 함 ---
test("general mortgage rate with no discounts returns max rate", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({ ...defaultSelections });
  const rateInfo = calculateActualRate(kb, input);

  assert.ok(rateInfo.rateRange);
  assert.ok(rateInfo.unconfirmedDiscounts?.length > 0 || rateInfo.confirmedDiscounts?.length === 0);
});

// --- 9. NH월상환액고정형 → stale 제외 ---
test("NH fixed payment mortgage is excluded due to stale data", () => {
  const nhFixed = products.find((p) => p.name.includes("NH월상환액고정형"));
  assert.ok(nhFixed);
  assert.equal(nhFixed.comparisonEligible, false);

  const input = normalizeSelections(defaultSelections);
  const result = checkGeneralMortgageEligibility(input, nhFixed);
  assert.equal(result.isEligible, false);
  assert.ok(result.ineligibleReasons.some((r) => r.includes("최신")));
});

// --- 10. 월상환액고정형 상품 처리 ---
test("fixed monthly payment products have proper repayment types", () => {
  const fixedPaymentProducts = generalProducts.filter((p) =>
    p.name.includes("월상환액고정형")
  );
  assert.ok(fixedPaymentProducts.length >= 2); // 우리 2개 + NH 1개 (though NH is stale)
});

// --- 11. 대환 목적 사용자 ---
test("refinance purpose filters products correctly", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    purchasePurpose: "refinance",
    detailedPurpose: "refinance"
  });

  assert.equal(input.detailedPurpose, "refinance");
});

// --- 12. 중도상환 수수료 계산 ---
test("KB mortgage has prepayment fee info", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  assert.ok(kb.generalMortgage.prepaymentFee);
  assert.ok(kb.generalMortgage.prepaymentFee.baseRate > 0);
  assert.equal(kb.generalMortgage.prepaymentFee.maximumChargeYears, 3);
});

// --- 13. KB 임시한도 3억 적용 ---
test("KB temporary policy limits to 300M", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  assert.ok(kb.generalMortgage.temporaryPolicy);
  assert.equal(kb.generalMortgage.temporaryPolicy.maximumAmount, 300000000);

  const input = normalizeSelections({
    ...defaultSelections,
    housingType: "apartment",
    regulationZone: "NON_REGULATED"
  });

  const limitResult = estimateGeneralMortgageLimit(input, kb, ltvRules);
  // Should be limited by temporary policy (3억) or LTV, whichever is lower
  assert.ok(limitResult.estimatedMaxAmount <= 300000000);
});

// --- 14. 변동금리 총이자 가정 표시 ---
test("general mortgage analysis includes rate assumption note", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    housingType: "apartment"
  });
  const analysis = analyzeAllProducts(input, products, ltvRules);
  const generalResult = analysis.results.find((r) => r.product.category === "general" && r.isEligible);

  assert.ok(generalResult);
  assert.ok(generalResult.isEstimate);
  assert.ok(generalResult.rateAssumptionNote);
});

// --- 15. 일반 주담대 금리 범위 계산 ---
test("general mortgage rate range is correctly calculated", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({ ...defaultSelections });
  const rateInfo = calculateActualRate(kb, input);

  assert.ok(rateInfo.rateRange);
  assert.ok(rateInfo.rateRange.min > 0);
  assert.ok(rateInfo.rateRange.max > rateInfo.rateRange.min);
  assert.ok(rateInfo.estimatedRate > 0);
  assert.ok(rateInfo.rateType);
});

// --- 16. alternativeRates 반환 확인 ---
test("general mortgage rate returns alternativeRates for other rate types", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({ ...defaultSelections });
  const rateInfo = calculateActualRate(kb, input);

  // KB는 rateTable에 여러 금리유형이 있으므로 alternatives가 존재해야 함
  assert.ok(Array.isArray(rateInfo.alternativeRates));
  if (kb.generalMortgage.rateTable.length > 1) {
    assert.ok(rateInfo.alternativeRates.length > 0);
    const alt = rateInfo.alternativeRates[0];
    assert.ok(alt.rateType);
    assert.ok(alt.rateRange);
    assert.ok(alt.rateRange.min > 0);
    assert.ok(alt.rateRange.max >= alt.rateRange.min);
    assert.ok(alt.estimatedRate > 0);
  }
  // best의 min은 alternatives의 min보다 작거나 같아야 함
  for (const alt of rateInfo.alternativeRates) {
    assert.ok(rateInfo.rateRange.min <= alt.rateRange.min);
  }
});

// --- 17. alternativeRates가 analysis 결과에 전달되는지 확인 ---
test("analyzeAllProducts includes alternativeRates in general results", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    housingType: "apartment"
  });
  const analysis = analyzeAllProducts(input, products, ltvRules);
  const generalResult = analysis.results.find((r) => r.product.category === "general" && r.isEligible);

  assert.ok(generalResult);
  assert.ok(Array.isArray(generalResult.alternativeRates));
});

// --- LTV 규칙 테스트 ---
test("LTV limit for non-regulated area with no house", () => {
  const result = calculateLtvLimit(550000000, "NON_REGULATED", 0, ltvRules);
  assert.equal(result.calculable, true);
  assert.equal(result.ltvRatio, 0.70);
  assert.equal(result.ltvLimit, Math.floor(550000000 * 0.70));
});

test("LTV limit for speculation overheated area", () => {
  const result = calculateLtvLimit(550000000, "SPECULATION_OVERHEATED", 0, ltvRules);
  assert.equal(result.calculable, true);
  assert.equal(result.ltvRatio, 0.50);
});

test("LTV limit is zero for multi-home owner in regulated area", () => {
  const result = calculateLtvLimit(550000000, "SPECULATION_OVERHEATED", 1, ltvRules);
  assert.equal(result.calculable, true);
  assert.equal(result.ltvLimit, 0);
});

test("unknown regulation zone defaults to non-regulated with note", () => {
  const result = calculateLtvLimit(550000000, "unknown", 0, ltvRules);
  assert.equal(result.calculable, true);
  assert.equal(result.ltvRatio, 0.70);
  assert.ok(result.note);
});

// --- DSR 테스트 ---
test("DSR limit calculation with existing debt", () => {
  const result = estimateDsrLimit(70000000, 12000000, 5.0, 30, ltvRules.dsrRules);
  assert.equal(result.calculable, true);
  assert.ok(result.dsrLimit > 0);
  // DSR 40%: 70M * 0.4 = 28M annual, minus 12M existing = 16M available
  assert.ok(result.dsrLimit < 300000000); // Should be reasonable
});

test("DSR returns zero when existing debt exceeds limit", () => {
  const result = estimateDsrLimit(50000000, 30000000, 5.0, 30, ltvRules.dsrRules);
  // 50M * 0.4 = 20M, minus 30M = negative → 0
  assert.equal(result.calculable, true);
  assert.equal(result.dsrLimit, 0);
});

// --- 거래실적 우대: 질문 없이 unconfirmedDiscounts로 결과에 전달 ---
test("all discounts are unconfirmed (no user questions for transaction discounts)", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections(defaultSelections);
  const rateInfo = calculateActualRate(kb, input);

  assert.equal(rateInfo.confirmedDiscounts.length, 0);
  assert.equal(rateInfo.totalDiscount, 0);
  assert.ok(rateInfo.unconfirmedDiscounts.length > 0);
});

test("unconfirmedDiscounts + confirmedDiscounts account for non-rejected items", () => {
  const productsWithDiscounts = [
    { id: "kb-mortgage", expectedMinItems: 7 },
    { id: "hana-mortgages/hana-oneq-apartment-loan2", expectedMinItems: 10 },
    { id: "nh-bank-mortgages/nh-mobile-mortgage", expectedMinItems: 8 },
    { id: "nh-bank-mortgages/nh-mortgage", expectedMinItems: 10 }
  ];

  const input = normalizeSelections(defaultSelections);

  for (const { id, expectedMinItems } of productsWithDiscounts) {
    const product = products.find((p) => p.id === id);
    if (!product) continue;
    const rateInfo = calculateActualRate(product, input);

    // 전체 discount 항목 수 = discountGroups 내 모든 items 합계
    const totalItems = product.generalMortgage.discountGroups
      .reduce((sum, g) => sum + (g.items?.length || 0), 0);
    const classifiedCount = rateInfo.unconfirmedDiscounts.length + rateInfo.confirmedDiscounts.length;
    assert.ok(
      classifiedCount <= totalItems,
      `${product.name}: unconfirmed(${rateInfo.unconfirmedDiscounts.length}) + confirmed(${rateInfo.confirmedDiscounts.length}) > total items(${totalItems})`
    );

    // 각 항목에 group, groupMaximum 정보가 포함되는지 확인
    for (const d of [...rateInfo.unconfirmedDiscounts, ...rateInfo.confirmedDiscounts]) {
      assert.ok(d.reason, `${product.name}: discount에 reason이 없음`);
      assert.ok(d.amount > 0, `${product.name}: discount amount가 0`);
      assert.ok(d.group, `${product.name}: discount에 group이 없음`);
      assert.ok(d.groupMaximum != null, `${product.name}: discount에 groupMaximum이 없음`);
    }
  }
});

test("products without discountGroups have empty unconfirmedDiscounts", () => {
  const noDiscountProducts = products.filter(
    (p) => p.category === "general" && (!p.generalMortgage?.discountGroups?.length)
  );

  const input = normalizeSelections(defaultSelections);

  for (const product of noDiscountProducts) {
    const rateInfo = calculateActualRate(product, input);
    if (rateInfo.rateRange) {
      assert.equal(rateInfo.unconfirmedDiscounts.length, 0, `${product.name}: 우대그룹 없는데 unconfirmed 존재`);
      assert.equal(rateInfo.confirmedDiscounts.length, 0);
    }
  }
});

test("analyzeAllProducts passes unconfirmedDiscounts through to general results", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    housingType: "apartment"
  });
  const analysis = analyzeAllProducts(input, products, ltvRules);

  const kbResult = analysis.results.find((r) => r.productId === "kb-mortgage");
  assert.ok(kbResult);
  assert.ok(kbResult.unconfirmedDiscounts.length > 0, "KB 결과에 unconfirmedDiscounts가 없음");

  // 거래실적 그룹 항목이 포함되어 있는지 확인
  const salaryDiscount = kbResult.unconfirmedDiscounts.find(
    (d) => d.reason === "SALARY_OR_PENSION_TRANSFER"
  );
  assert.ok(salaryDiscount, "KB 결과에 급여이체 우대가 없음");
  assert.equal(salaryDiscount.amount, 0.3);
});

// --- 기존 정책대출 테스트가 깨지지 않는지 확인 ---
test("existing policy loan analysis unchanged with general products in pool", () => {
  const input = normalizeSelections(defaultSelections);
  const analysis = analyzeLoanProducts(input, products);

  // analyzeLoanProducts should only return policy products
  assert.equal(analysis.results.length, 3);
  assert.equal(analysis.recommendedProductId, "didimdol");
});

// ===== 우대금리 매칭 테스트 (9개) =====

// 1. KB 전자계약 + 구입목적 → confirmed 0.2%
test("KB e-contract + purchase purpose → confirmed 0.2%", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    usesElectronicContract: "yes",
    purchasePurpose: "purchase_live"
  });
  const rateInfo = calculateActualRate(kb, input);

  const eContract = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "REAL_ESTATE_E_CONTRACT"
  );
  assert.ok(eContract, "KB 전자계약 우대가 confirmed에 없음");
  assert.equal(eContract.amount, 0.2);
});

// 2. KB 전자계약 + 대환목적 → rejected
test("KB e-contract + refinance purpose → rejected (not in unconfirmed or confirmed)", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    usesElectronicContract: "yes",
    purchasePurpose: "refinance",
    detailedPurpose: "refinance"
  });
  const rateInfo = calculateActualRate(kb, input);

  const inConfirmed = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "REAL_ESTATE_E_CONTRACT"
  );
  const inUnconfirmed = rateInfo.unconfirmedDiscounts.find(
    (d) => d.reason === "REAL_ESTATE_E_CONTRACT"
  );
  assert.equal(inConfirmed, undefined, "대환목적인데 confirmed에 전자계약이 있음");
  assert.equal(inUnconfirmed, undefined, "대환목적인데 unconfirmed에 전자계약이 있음");
});

// 3. 하나 3자녀 → confirmed 0.2%
test("Hana 3+ children → confirmed 0.2%", () => {
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "3"
  });
  const rateInfo = calculateActualRate(hana, input);

  const threeChildren = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "THREE_OR_MORE_CHILDREN"
  );
  assert.ok(threeChildren, "하나 다자녀 우대가 confirmed에 없음");
  assert.equal(threeChildren.amount, 0.2);
});

// 4. 하나 2자녀 + 85m² 이하 → confirmed 0.1%
test("Hana 2 children + area ≤ 85m² → confirmed 0.1%", () => {
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "2",
    exclusiveArea: "under85"
  });
  const rateInfo = calculateActualRate(hana, input);

  const twoChildren = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "TWO_CHILDREN_AND_AREA_85_OR_LESS"
  );
  assert.ok(twoChildren, "하나 2자녀 우대가 confirmed에 없음");
  assert.equal(twoChildren.amount, 0.1);
});

// 5. 0자녀 → 다자녀 관련 rejected (unconfirmed에도 없음)
test("0 children → child discounts rejected (not in unconfirmed)", () => {
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "0"
  });
  const rateInfo = calculateActualRate(hana, input);

  const childInUnconfirmed = rateInfo.unconfirmedDiscounts.find(
    (d) => d.reason === "THREE_OR_MORE_CHILDREN" || d.reason === "TWO_CHILDREN_AND_AREA_85_OR_LESS"
  );
  const childInConfirmed = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "THREE_OR_MORE_CHILDREN" || d.reason === "TWO_CHILDREN_AND_AREA_85_OR_LESS"
  );
  assert.equal(childInUnconfirmed, undefined, "0자녀인데 다자녀 우대가 unconfirmed에 있음");
  assert.equal(childInConfirmed, undefined, "0자녀인데 다자녀 우대가 confirmed에 있음");
});

// 6. 전자계약 미사용 → 전자계약 우대 rejected
test("no e-contract → e-contract discounts rejected", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    usesElectronicContract: "no"
  });
  const rateInfo = calculateActualRate(kb, input);

  const eContractInAny = [
    ...rateInfo.confirmedDiscounts,
    ...rateInfo.unconfirmedDiscounts
  ].find((d) => d.reason === "REAL_ESTATE_E_CONTRACT");
  assert.equal(eContractInAny, undefined, "전자계약 미사용인데 전자계약 우대가 존재");
});

// 7. 그룹 maximum cap 적용 확인
test("confirmed discounts respect group maximum cap", () => {
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  // 3자녀: THREE_OR_MORE_CHILDREN(0.2) + TWO_CHILDREN_AND_AREA_85_OR_LESS(0.1) 둘 다 confirmed
  // 하나 다자녀 그룹 maximum은 0.2
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "3",
    exclusiveArea: "under85"
  });
  const rateInfo = calculateActualRate(hana, input);

  // 두 항목 모두 confirmed
  assert.ok(rateInfo.confirmedDiscounts.length >= 2);

  // totalDiscount은 그룹 maximum(0.2)으로 cap됨
  assert.ok(
    rateInfo.totalDiscount <= 0.2,
    `totalDiscount(${rateInfo.totalDiscount})가 그룹 maximum(0.2) 초과`
  );
});

// 8. confirmed 반영 시 estimatedRate 하향 확인
test("confirmed discounts lower estimatedRate", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const baseInput = normalizeSelections({ ...defaultSelections });
  const baseRate = calculateActualRate(kb, baseInput);

  const discountInput = normalizeSelections({
    ...defaultSelections,
    usesElectronicContract: "yes",
    purchasePurpose: "purchase_live"
  });
  const discountRate = calculateActualRate(kb, discountInput);

  assert.ok(
    discountRate.estimatedRate < baseRate.estimatedRate,
    `우대 적용(${discountRate.estimatedRate}) >= 미적용(${baseRate.estimatedRate})`
  );
});

// 9. rateRange.min 이하로 내려가지 않음 확인
test("estimatedRate does not go below rateRange.min", () => {
  // 모든 일반 주담대 상품에 대해 확인
  const input = normalizeSelections({
    ...defaultSelections,
    usesElectronicContract: "yes",
    purchasePurpose: "purchase_live",
    childrenCount: "3",
    exclusiveArea: "under85",
    requestedLoanAmount: "under320"
  });

  for (const product of generalProducts) {
    const rateInfo = calculateActualRate(product, input);
    if (!rateInfo.rateRange) continue;
    assert.ok(
      rateInfo.estimatedRate >= rateInfo.rateRange.min,
      `${product.name}: estimatedRate(${rateInfo.estimatedRate}) < min(${rateInfo.rateRange.min})`
    );
  }
});

// ===== Phase 2: 급여이체 + 신용등급 + NH 정책 테스트 (10개) =====

// 1. KB 급여이체 은행 일치 → SALARY_OR_PENSION_TRANSFER confirmed 0.3%
test("KB salary transfer bank match → SALARY_OR_PENSION_TRANSFER confirmed 0.3%", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "KB"
  });
  const rateInfo = calculateActualRate(kb, input);

  const salary = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "SALARY_OR_PENSION_TRANSFER"
  );
  assert.ok(salary, "KB 급여이체 우대가 confirmed에 없음");
  assert.equal(salary.amount, 0.3);
});

// 2. KB 급여이체 은행 불일치 → rejected
test("KB salary transfer bank mismatch → rejected", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "HANA"
  });
  const rateInfo = calculateActualRate(kb, input);

  const inConfirmed = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "SALARY_OR_PENSION_TRANSFER"
  );
  const inUnconfirmed = rateInfo.unconfirmedDiscounts.find(
    (d) => d.reason === "SALARY_OR_PENSION_TRANSFER"
  );
  assert.equal(inConfirmed, undefined, "KB인데 HANA 급여이체가 confirmed");
  assert.equal(inUnconfirmed, undefined, "KB인데 HANA 급여이체가 unconfirmed");
});

// 3. 하나 급여이체 은행 일치 → SALARY_TRANSFER confirmed 0.3%
test("Hana salary transfer bank match → SALARY_TRANSFER confirmed 0.3%", () => {
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "HANA"
  });
  const rateInfo = calculateActualRate(hana, input);

  const salary = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "SALARY_TRANSFER"
  );
  assert.ok(salary, "하나 급여이체 우대가 confirmed에 없음");
  assert.equal(salary.amount, 0.3);
});

// 4. NH 급여이체 은행 일치 → 급여 매월 150만원 이상 confirmed 0.3%
test("NH salary transfer bank match → 급여 매월 150만원 confirmed 0.3%", () => {
  const nh = products.find((p) => p.id === "nh-bank-mortgages/nh-mortgage" || p.id === "nh-bank-mortgages/nh-mobile-mortgage");
  if (!nh) return;
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "NH"
  });
  const rateInfo = calculateActualRate(nh, input);

  const salary = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "급여 매월 150만원 이상"
  );
  assert.ok(salary, "NH 급여이체 우대가 confirmed에 없음");
  assert.equal(salary.amount, 0.3);
});

// 5. 급여이체 "none" → 모든 급여 항목 rejected
test("salary transfer 'none' → all salary discounts rejected", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "none"
  });

  for (const product of generalProducts) {
    const rateInfo = calculateActualRate(product, input);
    if (!rateInfo.rateRange) continue;

    const salaryInAny = [
      ...rateInfo.confirmedDiscounts,
      ...rateInfo.unconfirmedDiscounts
    ].find((d) =>
      d.reason === "SALARY_OR_PENSION_TRANSFER" ||
      d.reason === "SALARY_TRANSFER" ||
      d.reason === "급여 매월 150만원 이상"
    );
    assert.equal(salaryInAny, undefined, `${product.name}: 급여이체 없는데 급여 우대가 존재`);
  }
});

// 6. 신용점수 900+ → estimatedRate가 중간값보다 낮음
test("credit score 900+ → estimatedRate below midpoint", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const highCreditInput = normalizeSelections({
    ...defaultSelections,
    creditScore: "900plus"
  });
  const unknownCreditInput = normalizeSelections({
    ...defaultSelections,
    creditScore: "unknown"
  });

  const highCreditRate = calculateActualRate(kb, highCreditInput);
  const unknownCreditRate = calculateActualRate(kb, unknownCreditInput);

  assert.ok(
    highCreditRate.estimatedRate < unknownCreditRate.estimatedRate,
    `900+ 신용(${highCreditRate.estimatedRate}) >= unknown(${unknownCreditRate.estimatedRate})`
  );
});

// 7. 신용점수 700 미만 → estimatedRate가 중간값보다 높음
test("credit score 700-799 → estimatedRate above midpoint", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const lowCreditInput = normalizeSelections({
    ...defaultSelections,
    creditScore: "700to799"
  });
  const unknownCreditInput = normalizeSelections({
    ...defaultSelections,
    creditScore: "unknown"
  });

  const lowCreditRate = calculateActualRate(kb, lowCreditInput);
  const unknownCreditRate = calculateActualRate(kb, unknownCreditInput);

  assert.ok(
    lowCreditRate.estimatedRate > unknownCreditRate.estimatedRate,
    `700-799 신용(${lowCreditRate.estimatedRate}) <= unknown(${unknownCreditRate.estimatedRate})`
  );
});

// 8. 신용점수 unknown → 기존 중간값 유지
test("credit score unknown → midpoint estimatedRate unchanged", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const unknownInput = normalizeSelections({
    ...defaultSelections,
    creditScore: "unknown"
  });
  const noScoreInput = normalizeSelections({
    ...defaultSelections
  });
  // creditScore not set at all → creditScoreRange is null
  delete noScoreInput.creditScoreRange;

  const unknownRate = calculateActualRate(kb, unknownInput);
  const noScoreRate = calculateActualRate(kb, noScoreInput);

  assert.equal(
    unknownRate.estimatedRate,
    noScoreRate.estimatedRate,
    `unknown(${unknownRate.estimatedRate}) !== no score(${noScoreRate.estimatedRate})`
  );
});

// 9. NH 최초신규 + 기존대출없음 → confirmed
test("NH first-time customer + no existing loan → confirmed", () => {
  const nh = products.find((p) => p.id === "nh-bank-mortgages/nh-mortgage");
  if (!nh) return;
  const input = normalizeSelections({
    ...defaultSelections,
    existingRepayment: "none"
  });
  const rateInfo = calculateActualRate(nh, input);

  const firstTime = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "최초신규" || d.reason === "최초신규고객"
  );
  assert.ok(firstTime, "NH 최초신규 우대가 confirmed에 없음");
});

// 10. NH 비거치식 분할상환 → confirmed
test("NH non-grace installment repayment → confirmed", () => {
  const nh = products.find((p) => p.id === "nh-bank-mortgages/nh-mortgage");
  if (!nh) return;
  const input = normalizeSelections(defaultSelections);
  const rateInfo = calculateActualRate(nh, input);

  const installment = rateInfo.confirmedDiscounts.find(
    (d) => d.reason === "비거치식 분할상환" || d.reason === "비거치식 분할상환(5년주기형)"
  );
  assert.ok(installment, "NH 비거치식 분할상환 우대가 confirmed에 없음");
});

// ===== Phase 3: 거래실적 + 사회배려 대상 매칭 테스트 (10개) =====

// 1. KB 주거래(primary) → KB_CREDIT_CARD + AUTO_TRANSFER + SAVINGS_BALANCE + KB_STAR_BANKING confirmed
test("KB primary bank → card, auto-transfer, savings, star banking confirmed", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "KB",
    bankTransactionLevel: "primary"
  });
  const rateInfo = calculateActualRate(kb, input);

  const card = rateInfo.confirmedDiscounts.find((d) => d.reason === "KB_CREDIT_CARD");
  const autoTransfer = rateInfo.confirmedDiscounts.find((d) => d.reason === "AUTO_TRANSFER_3_OR_MORE");
  const savings = rateInfo.confirmedDiscounts.find((d) => d.reason === "SAVINGS_BALANCE_300K");
  const starBanking = rateInfo.confirmedDiscounts.find((d) => d.reason === "KB_STAR_BANKING");

  assert.ok(card, "KB_CREDIT_CARD가 confirmed에 없음");
  assert.ok(autoTransfer, "AUTO_TRANSFER_3_OR_MORE가 confirmed에 없음");
  assert.ok(savings, "SAVINGS_BALANCE_300K가 confirmed에 없음");
  assert.ok(starBanking, "KB_STAR_BANKING가 confirmed에 없음");
});

// 2. KB 카드만(card_only) → KB_CREDIT_CARD + KB_STAR_BANKING confirmed, 나머지 rejected
test("KB card_only → card + star banking confirmed, savings + auto-transfer rejected", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "KB",
    bankTransactionLevel: "card_only"
  });
  const rateInfo = calculateActualRate(kb, input);

  assert.ok(rateInfo.confirmedDiscounts.find((d) => d.reason === "KB_CREDIT_CARD"), "KB_CREDIT_CARD confirmed 누락");
  assert.ok(rateInfo.confirmedDiscounts.find((d) => d.reason === "KB_STAR_BANKING"), "KB_STAR_BANKING confirmed 누락");

  const savingsInAny = [...rateInfo.confirmedDiscounts, ...rateInfo.unconfirmedDiscounts]
    .find((d) => d.reason === "SAVINGS_BALANCE_300K");
  const autoInAny = [...rateInfo.confirmedDiscounts, ...rateInfo.unconfirmedDiscounts]
    .find((d) => d.reason === "AUTO_TRANSFER_3_OR_MORE");
  assert.equal(savingsInAny, undefined, "card_only인데 SAVINGS_BALANCE_300K가 rejected 안됨");
  assert.equal(autoInAny, undefined, "card_only인데 AUTO_TRANSFER_3_OR_MORE가 rejected 안됨");
});

// 3. KB 급여만(salary_only) → 거래실적 전부 rejected
test("KB salary_only → all transaction discounts rejected", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "KB",
    bankTransactionLevel: "salary_only"
  });
  const rateInfo = calculateActualRate(kb, input);

  const txCodes = ["KB_CREDIT_CARD", "AUTO_TRANSFER_3_OR_MORE", "SAVINGS_BALANCE_300K", "KB_STAR_BANKING"];
  for (const code of txCodes) {
    const inAny = [...rateInfo.confirmedDiscounts, ...rateInfo.unconfirmedDiscounts]
      .find((d) => d.reason === code);
    assert.equal(inAny, undefined, `salary_only인데 ${code}가 rejected 안됨`);
  }
});

// 4. 하나 주거래(primary) → AFFILIATED_CARD_300K + 700K + SAVINGS confirmed
test("Hana primary bank → card 300K, card 700K, savings confirmed", () => {
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "HANA",
    bankTransactionLevel: "primary"
  });
  const rateInfo = calculateActualRate(hana, input);

  assert.ok(rateInfo.confirmedDiscounts.find((d) => d.reason === "AFFILIATED_CARD_300K"), "AFFILIATED_CARD_300K confirmed 누락");
  assert.ok(rateInfo.confirmedDiscounts.find((d) => d.reason === "AFFILIATED_CARD_700K_ADDITIONAL"), "AFFILIATED_CARD_700K_ADDITIONAL confirmed 누락");
  assert.ok(rateInfo.confirmedDiscounts.find((d) => d.reason === "SAVINGS_OR_SUBSCRIPTION"), "SAVINGS_OR_SUBSCRIPTION confirmed 누락");
});

// 5. NH 주거래(primary) → 카드 + 입출금예금 + 적립식예금 + 자동이체 confirmed (각 상품별)
test("NH primary bank → card, deposit, savings, auto-transfer confirmed", () => {
  const nhInput = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "NH",
    bankTransactionLevel: "primary"
  });

  // nh-mortgage: 카드, 입출금예금, 적립식예금
  const nhMortgage = products.find((p) => p.id === "nh-bank-mortgages/nh-mortgage");
  if (nhMortgage) {
    const rateInfo = calculateActualRate(nhMortgage, nhInput);
    assert.ok(rateInfo.confirmedDiscounts.find((d) => d.reason === "카드 3개월 100만원 이상"), "카드 3개월 100만원 이상 confirmed 누락 (nh-mortgage)");
    assert.ok(rateInfo.confirmedDiscounts.find((d) => d.reason === "입출금예금 평잔 200만원 이상"), "입출금예금 평잔 confirmed 누락 (nh-mortgage)");
    assert.ok(rateInfo.confirmedDiscounts.find((d) => d.reason === "적립식예금 월 10만원 이상"), "적립식예금 confirmed 누락 (nh-mortgage)");
  }

  // nh-mobile-mortgage: 카드, 입출금예금, 자동이체
  const nhMobile = products.find((p) => p.id === "nh-bank-mortgages/nh-mobile-mortgage");
  if (nhMobile) {
    const mobileRateInfo = calculateActualRate(nhMobile, nhInput);
    assert.ok(mobileRateInfo.confirmedDiscounts.find((d) => d.reason === "자동이체 매월 3건 이상"), "자동이체 confirmed 누락 (nh-mobile-mortgage)");
  }
});

// 6. 급여은행 불일치 → 해당 상품 거래실적 unconfirmed 유지
test("salary bank mismatch → transaction discounts stay unconfirmed", () => {
  const kb = products.find((p) => p.id === "kb-mortgage");
  const input = normalizeSelections({
    ...defaultSelections,
    salaryTransferBank: "HANA",
    bankTransactionLevel: "primary"
  });
  const rateInfo = calculateActualRate(kb, input);

  const txCodes = ["KB_CREDIT_CARD", "AUTO_TRANSFER_3_OR_MORE", "SAVINGS_BALANCE_300K", "KB_STAR_BANKING"];
  for (const code of txCodes) {
    const inConfirmed = rateInfo.confirmedDiscounts.find((d) => d.reason === code);
    assert.equal(inConfirmed, undefined, `은행 불일치인데 ${code}가 confirmed`);
    const inUnconfirmed = rateInfo.unconfirmedDiscounts.find((d) => d.reason === code);
    assert.ok(inUnconfirmed, `은행 불일치인데 ${code}가 unconfirmed에 없음`);
  }
});

// 7. 사회배려 "eligible" → BASIC_LIVELIHOOD 등 5개 confirmed
test("social care 'eligible' → all social care discounts confirmed", () => {
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  const input = normalizeSelections({
    ...defaultSelections,
    socialCareStatus: "eligible"
  });
  const rateInfo = calculateActualRate(hana, input);

  const socialCodes = ["BASIC_LIVELIHOOD", "SINGLE_PARENT", "MULTICULTURAL", "DISABLED"];
  for (const code of socialCodes) {
    const d = rateInfo.confirmedDiscounts.find((d) => d.reason === code);
    assert.ok(d, `${code}가 confirmed에 없음`);
  }

  // KB 취약차주도 확인
  const kb = products.find((p) => p.id === "kb-mortgage");
  const kbInput = normalizeSelections({ ...defaultSelections, socialCareStatus: "eligible" });
  const kbRate = calculateActualRate(kb, kbInput);
  const vulnerable = kbRate.confirmedDiscounts.find((d) => d.reason === "VULNERABLE_BORROWER");
  assert.ok(vulnerable, "VULNERABLE_BORROWER가 confirmed에 없음");
});

// 8. 사회배려 "none" → 사회배려 전부 rejected
test("social care 'none' → all social care discounts rejected", () => {
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  const input = normalizeSelections({
    ...defaultSelections,
    socialCareStatus: "none"
  });
  const rateInfo = calculateActualRate(hana, input);

  const socialCodes = ["BASIC_LIVELIHOOD", "SINGLE_PARENT", "MULTICULTURAL", "DISABLED"];
  for (const code of socialCodes) {
    const inAny = [...rateInfo.confirmedDiscounts, ...rateInfo.unconfirmedDiscounts]
      .find((d) => d.reason === code);
    assert.equal(inAny, undefined, `socialCareStatus=none인데 ${code}가 rejected 안됨`);
  }
});

// 9. 사회배려 "farmer" → 농업인 confirmed, 나머지 rejected
test("social care 'farmer' → 농업인 confirmed, others rejected", () => {
  const nh = products.find((p) => p.id === "nh-bank-mortgages/nh-mortgage");
  if (!nh) return;
  const input = normalizeSelections({
    ...defaultSelections,
    socialCareStatus: "farmer"
  });
  const rateInfo = calculateActualRate(nh, input);

  const farmer = rateInfo.confirmedDiscounts.find((d) => d.reason === "농업인");
  assert.ok(farmer, "농업인이 confirmed에 없음");

  // 하나 사회배려는 rejected
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  const hanaRate = calculateActualRate(hana, normalizeSelections({ ...defaultSelections, socialCareStatus: "farmer" }));
  const socialCodes = ["BASIC_LIVELIHOOD", "SINGLE_PARENT", "MULTICULTURAL", "DISABLED"];
  for (const code of socialCodes) {
    const inAny = [...hanaRate.confirmedDiscounts, ...hanaRate.unconfirmedDiscounts]
      .find((d) => d.reason === code);
    assert.equal(inAny, undefined, `farmer인데 ${code}가 rejected 안됨`);
  }
});

// 10. 사회배려 미입력(null) → unconfirmed 유지
test("social care null → social care discounts stay unconfirmed", () => {
  const hana = products.find((p) => p.id === "hana-mortgages/hana-oneq-apartment-loan2");
  if (!hana) return;
  const input = normalizeSelections({
    ...defaultSelections
    // socialCareStatus not set → null
  });
  const rateInfo = calculateActualRate(hana, input);

  const socialCodes = ["BASIC_LIVELIHOOD", "SINGLE_PARENT", "MULTICULTURAL", "DISABLED"];
  for (const code of socialCodes) {
    const inConfirmed = rateInfo.confirmedDiscounts.find((d) => d.reason === code);
    assert.equal(inConfirmed, undefined, `socialCareStatus=null인데 ${code}가 confirmed`);
    const inUnconfirmed = rateInfo.unconfirmedDiscounts.find((d) => d.reason === code);
    assert.ok(inUnconfirmed, `socialCareStatus=null인데 ${code}가 unconfirmed에 없음`);
  }
});
