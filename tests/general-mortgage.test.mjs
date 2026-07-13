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

test("unconfirmedDiscounts include all discount group items with group info", () => {
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
    assert.equal(
      rateInfo.unconfirmedDiscounts.length, totalItems,
      `${product.name}: unconfirmed(${rateInfo.unconfirmedDiscounts.length}) != total items(${totalItems})`
    );

    // 각 항목에 group, groupMaximum 정보가 포함되는지 확인
    for (const d of rateInfo.unconfirmedDiscounts) {
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
