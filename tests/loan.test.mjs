import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeLoanProducts } from "../src/domain/loan/analysis.js";
import { checkLoanEligibility } from "../src/domain/loan/eligibility.js";
import { calculateEqualPayment, calculateEqualPrincipal, calculateGraduatedPayment } from "../src/domain/loan/repayment.js";
import { normalizeSelections } from "../src/domain/loan/selection-options.js";
import { calculateActualRate } from "../src/domain/loan/rate-calculator.js";

const { products } = JSON.parse(
  readFileSync(new URL("../src/data/products.json", import.meta.url), "utf-8")
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
  houseLegalStatus: "eligible_residential",
  creditStatus: "no_issue",
  acquisitionType: "GENERAL_PURCHASE",
  hasHousingSubscription: "yes",
  subscriptionYears: "over15",
  subscriptionPaymentCount: "over180",
  usesElectronicContract: "no"
};

test("products.json contains all expected products", () => {
  assert.equal(products.length, 15);
  // 정책대출 3개
  assert.ok(products.find((p) => p.id === "didimdol"));
  assert.ok(products.find((p) => p.id === "newborn-special"));
  assert.ok(products.find((p) => p.id === "bogeumjari"));
  // 일반 주담대 12개
  const generalProducts = products.filter((p) => p.category === "general");
  assert.equal(generalProducts.length, 12);
  assert.equal(generalProducts.filter((p) => p.comparisonEligible).length, 11);
  assert.equal(generalProducts.filter((p) => !p.comparisonEligible).length, 1); // NH월상환액고정형 stale
});

test("normalizes choice-based selections into analysis input", () => {
  const input = normalizeSelections(defaultSelections);

  assert.equal(input.isMarried, true);
  assert.equal(input.combinedIncome, 70000000);
  assert.equal(input.netAsset, 400000000);
  assert.equal(input.housePrice, 550000000);
  assert.equal(input.exclusiveArea, 75);
  assert.equal(input.requestedLoanAmount, 300000000);
  assert.equal(input.hasHousingSubscription, true);
  assert.equal(input.subscriptionStatus, "ACTIVE");
  assert.equal(input.subscriptionYears, 17);
  assert.equal(input.subscriptionPaymentCount, 200);
  assert.equal(input.acquisitionType, "GENERAL_PURCHASE");
  assert.equal(input.usesElectronicContract, false);
  assert.equal(input.hasNewborn, false);
  assert.equal(input.isDualIncome, false);
  assert.equal(input.precisionLevel, "estimated");
});

test("calculates equal payment repayment totals", () => {
  const result = calculateEqualPayment(300000000, 3, 30);

  assert.equal(Math.round(result.monthlyPayment), 1264812);
  assert.equal(Math.round(result.totalInterest), 155332356);
});

test("calculates equal principal with higher first payment", () => {
  const result = calculateEqualPrincipal(300000000, 3, 30);

  assert.ok(result.firstMonthPayment > result.averageMonthlyPayment);
  assert.equal(Math.round(result.totalInterest), 135375000);
});

test("calculates graduated repayment with lower first payment and higher last payment", () => {
  const equalPayment = calculateEqualPayment(300000000, 3, 30);
  const graduated = calculateGraduatedPayment(300000000, 3, 30);

  assert.ok(graduated.firstMonthPayment < equalPayment.monthlyPayment);
  assert.ok(graduated.lastMonthPayment > graduated.firstMonthPayment);
});

test("marks didimdol unavailable when house price exceeds eligibility", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    housePrice: "600to900"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(result.isEligible, false);
  assert.ok(result.ineligibleReasons.includes("주택가격 기준을 초과했습니다."));
});

test("marks didimdol unavailable when income exceeds newlywed limit", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "85to100"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(result.isEligible, false);
  assert.ok(result.ineligibleReasons.includes("부부합산 연소득 기준을 초과했습니다."));
});

test("marks didimdol unavailable when net asset exceeds limit", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    netAsset: "over511"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(result.isEligible, false);
  assert.ok(result.ineligibleReasons.includes("순자산 기준을 초과했습니다."));
});

test("marks didimdol unavailable when exclusive area exceeds limit", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    exclusiveArea: "over85"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(result.isEligible, false);
  assert.ok(result.ineligibleReasons.includes("전용면적 기준을 초과했습니다."));
});

test("marks didimdol unavailable when purchase is not for living", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    purchasePurpose: "investment_or_rent"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(result.isEligible, false);
  assert.ok(result.ineligibleReasons.includes("정책대출은 주택 구입 및 실거주 목적이어야 합니다."));
});

test("keeps analysis available when net asset is unknown", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    netAsset: "unknown"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(input.netAssetStatus, "unknown");
  assert.equal(result.isEligible, true);
  assert.ok(result.ineligibleReasons.includes("순자산 정보를 알 수 없어 정책대출 판단 정확도가 낮습니다."));
});

test("keeps didimdol available for the under 320M range when LTV allows it", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    requestedLoanAmount: "under320"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(input.requestedLoanAmount, 300000000);
  assert.equal(result.maxAvailableAmount, 320000000);
  assert.equal(result.hasEnoughLimit, true);
  assert.equal(result.isEligible, true);
});

test("marks 320-360M range unavailable for didimdol (exceeds 3.2억 limit)", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    requestedLoanAmount: "320to360"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(input.requestedLoanAmount, 340000000);
  assert.equal(result.maxAvailableAmount, 320000000);
  assert.equal(result.hasEnoughLimit, false);
});

test("marks over 400M range unavailable for didimdol", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    housePrice: "under600",
    requestedLoanAmount: "over400"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(input.requestedLoanAmount, 450000000);
  assert.equal(result.maxAvailableAmount, 320000000);
  assert.equal(result.hasEnoughLimit, false);
});

test("recommends didimdol for default newlywed scenario", () => {
  const input = normalizeSelections(defaultSelections);
  const analysis = analyzeLoanProducts(input, products);

  assert.equal(analysis.recommendedProductId, "didimdol");
  assert.equal(analysis.results[0].rank, 1);
  assert.deepEqual(
    analysis.results[0].repaymentOptions.map((option) => option.id),
    ["equal_payment", "equal_principal", "graduated_payment"]
  );
});

test("applies newlywed and subscription rate discounts for didimdol from structured JSON", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "0",
    subscriptionYears: "5to10",
    subscriptionPaymentCount: "60to120"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  // Base rate from rates.json: income 70M, 30yr → tier (40001-70000) = 3.80%
  assert.equal(rateInfo.baseRate, 3.8);
  assert.ok(rateInfo.discounts.some((d) => d.reason === "청약저축 가입" && d.amount === 0.3));
  assert.ok(rateInfo.discounts.some((d) => d.reason === "신혼가구" && d.amount === 0.2));
  // Total discount 0.5 = cap (general), so not capped (0.5 is not > 0.5)
  assert.equal(rateInfo.totalDiscount, 0.5);
  assert.equal(rateInfo.finalRate, 3.3);
});

test("applies children discount on top of newlywed discount", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "2",
    subscriptionYears: "5to10",
    subscriptionPaymentCount: "60to120"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.ok(rateInfo.discounts.some((d) => d.reason === "신혼가구"));
  assert.ok(rateInfo.discounts.some((d) => d.reason === "2자녀"));
  assert.ok(rateInfo.discounts.some((d) => d.reason === "청약저축 가입"));
  // Total raw = 0.2 + 0.5 + 0.3 = 1.0, capped at 0.5
  assert.equal(rateInfo.isCapped, true);
  assert.equal(rateInfo.totalDiscount, 0.5);
  assert.equal(rateInfo.finalRate, 3.3);
});

test("caps total discount at 0.5%p for non-multiple children", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "2",
    usesElectronicContract: "yes",
    subscriptionYears: "5to10",
    subscriptionPaymentCount: "60to120"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.equal(rateInfo.isCapped, true);
  assert.equal(rateInfo.maxDiscount, 0.5);
  assert.equal(rateInfo.totalDiscount, 0.5);
});

test("caps total discount at 0.7%p for 3+ children", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "3",
    usesElectronicContract: "yes",
    subscriptionYears: "5to10",
    subscriptionPaymentCount: "60to120"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.equal(rateInfo.maxDiscount, 0.7);
  assert.ok(rateInfo.totalDiscount <= 0.7);
});

test("bogeumjari applies newlywed discount for income under 70M", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "under85", // representative 70M → ≤ 70M
    childrenCount: "0"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  const newlywedDiscount = rateInfo.discounts.find((d) => d.reason === "신혼가구");
  assert.ok(newlywedDiscount);
  assert.equal(newlywedDiscount.amount, 0.3);
  assert.equal(rateInfo.finalRate, 4.9); // 5.2 - 0.3
});

test("bogeumjari does not apply newlywed discount for income over 70M", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "85to100", // representative 92M → > 70M
    childrenCount: "0"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  const newlywedDiscount = rateInfo.discounts.find((d) => d.reason === "신혼가구");
  assert.equal(newlywedDiscount, undefined);
  assert.equal(rateInfo.finalRate, 5.2);
});

test("bogeumjari applies 2-children discount", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "85to100", // income doesn't matter for children discount
    childrenCount: "2"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  const childDiscount = rateInfo.discounts.find((d) => d.reason === "2자녀");
  assert.ok(childDiscount);
  assert.equal(childDiscount.amount, 0.5);
  assert.equal(rateInfo.finalRate, 4.7); // 5.2 - 0.5
});

test("bogeumjari applies 3+ children discount", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    maritalStatus: "single",
    childrenCount: "3"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  const childDiscount = rateInfo.discounts.find((d) => d.reason === "다자녀(3명 이상)");
  assert.ok(childDiscount);
  assert.equal(childDiscount.amount, 0.7);
  assert.equal(rateInfo.finalRate, 4.5); // 5.2 - 0.7
});

test("bogeumjari stacks newlywed + children discount within 1.0%p cap", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "under85",
    childrenCount: "2"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  // 신혼 0.3 + 2자녀 0.5 = 0.8, under 1.0 cap
  assert.equal(rateInfo.totalDiscount, 0.8);
  assert.equal(rateInfo.isCapped, false);
  assert.equal(rateInfo.finalRate, 4.4); // 5.2 - 0.8
});

test("bogeumjari caps discount at 1.0%p", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "under85",
    childrenCount: "3"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  // 신혼 0.3 + 3자녀이상 0.7 = 1.0, exactly at cap
  assert.equal(rateInfo.totalDiscount, 1.0);
  assert.equal(rateInfo.isCapped, false); // exactly at cap, not over
  assert.equal(rateInfo.finalRate, 4.2); // 5.2 - 1.0
});

test("bogeumjari newborn discount not combined with newlywed", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "under85",
    hasNewborn: "yes",
    childrenCount: "0"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  // 신혼 0.3 적용됨 → 출산 0.2는 비결합으로 제외
  const newlywedDiscount = rateInfo.discounts.find((d) => d.reason === "신혼가구");
  const newbornDiscount = rateInfo.discounts.find((d) => d.reason === "출산가구");
  assert.ok(newlywedDiscount);
  assert.equal(newbornDiscount, undefined);
  assert.equal(rateInfo.finalRate, 4.9); // 5.2 - 0.3
});

test("bogeumjari newborn discount applies when not married", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    maritalStatus: "single",
    combinedIncome: "under85",
    hasNewborn: "yes",
    childrenCount: "0"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  const newbornDiscount = rateInfo.discounts.find((d) => d.reason === "출산가구");
  assert.ok(newbornDiscount);
  assert.equal(newbornDiscount.amount, 0.2);
  assert.equal(rateInfo.finalRate, 5.0); // 5.2 - 0.2
});

test("bogeumjari uses akkim-e rate when electronic contract selected", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "85to100",
    childrenCount: "0",
    usesElectronicContract: "yes"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  // 아낌e 30yr = 5.1 (U_BOGEUMJARI 5.2보다 0.1%p 낮음)
  assert.equal(rateInfo.baseRate, 5.1);
  assert.equal(rateInfo.finalRate, 5.1);
  // 아낌e 표시 포함
  const eDiscount = rateInfo.discounts.find((d) => d.reason.includes("아낌e"));
  assert.ok(eDiscount);
});

test("bogeumjari adds regulated area surcharge", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "85to100",
    childrenCount: "0",
    regulationZone: "SPECULATION_OVERHEATED"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  // 5.2 + 0.1 (규제지역) = 5.3
  assert.equal(rateInfo.finalRate, 5.3);
  const addition = rateInfo.discounts.find((d) => d.reason === "규제지역 가산");
  assert.ok(addition);
  assert.equal(addition.amount, -0.1); // negative = surcharge
});

test("bogeumjari no discount for unmarried no-children no-newborn", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    maritalStatus: "single",
    combinedIncome: "85to100",
    hasNewborn: "no",
    childrenCount: "0"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  assert.equal(rateInfo.discounts.length, 0);
  assert.equal(rateInfo.totalDiscount, 0);
  assert.equal(rateInfo.finalRate, 5.2);
});

// --- 신생아 특례 테스트 ---

test("marks newborn special unavailable when no newborn", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "no"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const result = checkLoanEligibility(input, newborn);

  assert.equal(result.isEligible, false);
  assert.ok(result.ineligibleReasons.includes("2년 이내 출생아 요건을 충족하지 않습니다."));
});

test("keeps newborn special eligible when newborn exists and conditions met", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    combinedIncome: "100to130",
    housePrice: "600to900"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const result = checkLoanEligibility(input, newborn);

  assert.equal(result.isEligible, true);
});

test("marks didimdol unavailable but newborn special available for income 85-100M", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    combinedIncome: "85to100"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const newborn = products.find((p) => p.id === "newborn-special");

  assert.equal(checkLoanEligibility(input, didimdol).isEligible, false);
  assert.equal(checkLoanEligibility(input, newborn).isEligible, true);
});

test("marks didimdol and bogeumjari unavailable for house price 6-9억", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    housePrice: "600to900"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const bogeumjari = products.find((p) => p.id === "bogeumjari");

  assert.equal(checkLoanEligibility(input, didimdol).isEligible, false);
  assert.equal(checkLoanEligibility(input, bogeumjari).isEligible, false);
});

test("newborn special available for house price 6-9억 when newborn exists", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    housePrice: "600to900"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const result = checkLoanEligibility(input, newborn);

  assert.equal(result.isEligible, true);
});

test("newborn special has max loan amount of 400M", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    housePrice: "600to900",
    requestedLoanAmount: "360to400"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const result = checkLoanEligibility(input, newborn);

  assert.equal(result.maxAvailableAmount, 400000000);
  assert.equal(result.hasEnoughLimit, true);
});

test("applies newborn special rate discounts for existing children", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    childrenCount: "2",
    subscriptionYears: "5to10",
    subscriptionPaymentCount: "60to120"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const rateInfo = calculateActualRate(newborn, input);

  assert.ok(rateInfo.discounts.some((d) => d.reason === "기존자녀 2명"));
  assert.ok(rateInfo.discounts.some((d) => d.reason === "청약저축 가입"));
  assert.ok(rateInfo.totalDiscount > 0);
});

test("newborn special base rate varies by income (30yr, under85 = 2.90%)", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    childrenCount: "0",
    hasHousingSubscription: "no",
    acquisitionType: "GENERAL_PURCHASE"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const rateInfo = calculateActualRate(newborn, input);

  assert.equal(rateInfo.baseRate, 2.9);
  assert.equal(rateInfo.finalRate, 2.9);
});

test("newborn special base rate for high income (30yr, 100-130M = 3.50%)", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    combinedIncome: "100to130",
    childrenCount: "0",
    hasHousingSubscription: "no",
    acquisitionType: "GENERAL_PURCHASE"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const rateInfo = calculateActualRate(newborn, input);

  assert.equal(rateInfo.baseRate, 3.5);
  assert.equal(rateInfo.finalRate, 3.5);
});

test("newborn special applies subscription discount of 0.5%p for 15yr/180 count", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    childrenCount: "0"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const rateInfo = calculateActualRate(newborn, input);

  // Default selections: over15, over180 → 0.5%p discount
  assert.ok(rateInfo.discounts.some((d) => d.reason === "청약저축 가입" && d.amount === 0.5));
  assert.equal(rateInfo.totalDiscount, 0.5);
  assert.equal(rateInfo.finalRate, 2.4);
});

test("newborn special applies subscription discount of 0.3%p for 5yr/60 count", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    childrenCount: "0",
    subscriptionYears: "5to10",
    subscriptionPaymentCount: "60to120"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const rateInfo = calculateActualRate(newborn, input);

  assert.ok(rateInfo.discounts.some((d) => d.reason === "청약저축 가입" && d.amount === 0.3));
  assert.equal(rateInfo.totalDiscount, 0.3);
  assert.equal(rateInfo.finalRate, 2.6);
});

test("income over 130M (외벌이) does not qualify for any policy loan", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "over130"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const newborn = products.find((p) => p.id === "newborn-special");

  assert.equal(checkLoanEligibility(input, didimdol).isEligible, false);
  assert.equal(checkLoanEligibility(input, bogeumjari).isEligible, false);
  assert.equal(checkLoanEligibility(input, newborn).isEligible, false);
});

test("dual income 130-200M qualifies for newborn special", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    combinedIncome: "130to200_dual"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const result = checkLoanEligibility(input, newborn);

  assert.equal(input.isDualIncome, true);
  assert.equal(result.isEligible, true);
});

test("dual income 130-200M does not qualify for didimdol or bogeumjari", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    combinedIncome: "130to200_dual"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const bogeumjari = products.find((p) => p.id === "bogeumjari");

  assert.equal(checkLoanEligibility(input, didimdol).isEligible, false);
  assert.equal(checkLoanEligibility(input, bogeumjari).isEligible, false);
});

test("income over 200M does not qualify for any policy loan", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    combinedIncome: "over200"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const newborn = products.find((p) => p.id === "newborn-special");

  assert.equal(checkLoanEligibility(input, didimdol).isEligible, false);
  assert.equal(checkLoanEligibility(input, bogeumjari).isEligible, false);
  assert.equal(checkLoanEligibility(input, newborn).isEligible, false);
});

test("newborn special also requires net asset under 5.11억", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    netAsset: "over511"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const result = checkLoanEligibility(input, newborn);

  assert.equal(result.isEligible, false);
  assert.ok(result.ineligibleReasons.includes("순자산 기준을 초과했습니다."));
});

test("house price over 9억 does not qualify for any policy loan", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    housePrice: "over900"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const newborn = products.find((p) => p.id === "newborn-special");

  assert.equal(checkLoanEligibility(input, didimdol).isEligible, false);
  assert.equal(checkLoanEligibility(input, bogeumjari).isEligible, false);
  assert.equal(checkLoanEligibility(input, newborn).isEligible, false);
});

// --- 청약저축 단계별 우대금리 테스트 ---

test("subscription discount 0.3%p for 5yr/60 count (didimdol)", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "0",
    subscriptionYears: "5to10",
    subscriptionPaymentCount: "60to120"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.ok(rateInfo.discounts.some((d) => d.reason === "청약저축 가입" && d.amount === 0.3));
});

test("subscription discount 0.4%p for 10yr/120 count (didimdol)", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "0",
    subscriptionYears: "10to15",
    subscriptionPaymentCount: "120to180"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.ok(rateInfo.discounts.some((d) => d.reason === "청약저축 가입" && d.amount === 0.4));
});

test("subscription discount 0.5%p for 15yr/180 count (didimdol)", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "0",
    subscriptionYears: "over15",
    subscriptionPaymentCount: "over180"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.ok(rateInfo.discounts.some((d) => d.reason === "청약저축 가입" && d.amount === 0.5));
});

test("WON_AND_CLOSED status still applies subscription discount", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "0",
    acquisitionType: "PRIVATE_PRESALE_WINNER",
    subscriptionYears: "over15",
    subscriptionPaymentCount: "over180"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.equal(input.subscriptionStatus, "WON_AND_CLOSED");
  assert.ok(rateInfo.discounts.some((d) => d.reason === "청약저축 (당첨 해지 인정)" && d.amount === 0.5));
});

test("NONE subscription status does not apply subscription discount", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "0",
    acquisitionType: "GENERAL_PURCHASE",
    hasHousingSubscription: "no",
    subscriptionYears: "over15",
    subscriptionPaymentCount: "over180"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.equal(input.subscriptionStatus, "NONE");
  assert.ok(!rateInfo.discounts.some((d) => d.reason.includes("청약저축")));
});

test("bogeumjari ignores subscription status entirely", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    maritalStatus: "single",
    childrenCount: "0",
    hasNewborn: "no",
    hasHousingSubscription: "yes",
    subscriptionYears: "over15",
    subscriptionPaymentCount: "over180"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const rateInfo = calculateActualRate(bogeumjari, input);

  assert.equal(rateInfo.discounts.length, 0);
  assert.ok(!rateInfo.discounts.some((d) => d.reason.includes("청약저축")));
});

// --- 지방 소재 주택 할인 테스트 ---

test("applies regional discount of -0.2%p for local region (didimdol)", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    region: "local",
    childrenCount: "0",
    hasHousingSubscription: "no"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.ok(rateInfo.discounts.some((d) => d.reason === "지방 소재 주택" && d.amount === 0.2));
  // Base 3.80 - newlywed 0.20 - regional 0.20 = 3.40
  assert.equal(rateInfo.finalRate, 3.4);
});

test("applies regional discount of -0.2%p for local region (newborn special)", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    region: "local",
    hasNewborn: "yes",
    childrenCount: "0",
    hasHousingSubscription: "no",
    acquisitionType: "GENERAL_PURCHASE"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const rateInfo = calculateActualRate(newborn, input);

  assert.ok(rateInfo.discounts.some((d) => d.reason === "지방 소재 주택" && d.amount === 0.2));
  // Base 2.90 - regional 0.20 = 2.70
  assert.equal(rateInfo.finalRate, 2.7);
});

test("does not apply regional discount for capital region", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    region: "capital",
    childrenCount: "0",
    hasHousingSubscription: "no"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.ok(!rateInfo.discounts.some((d) => d.reason === "지방 소재 주택"));
  // Base 3.80 - newlywed 0.20 = 3.60
  assert.equal(rateInfo.finalRate, 3.6);
});

// --- Legacy contract (2025.6.27 이전 계약) 한도 테스트 ---

test("didimdol legacy contract applies 4억 limit", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    contractDate: "before2025_06_27",
    requestedLoanAmount: "360to400"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(input.isLegacyContract, true);
  assert.equal(result.maxAvailableAmount, 385000000);
  assert.equal(result.hasEnoughLimit, true);
});

test("didimdol current contract applies 3.2억 limit", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    contractDate: "on_or_after2025_06_27",
    requestedLoanAmount: "320to360"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const result = checkLoanEligibility(input, didimdol);

  assert.equal(input.isLegacyContract, false);
  assert.equal(result.maxAvailableAmount, 320000000);
  assert.equal(result.hasEnoughLimit, false);
});

test("newborn special legacy contract applies 5억 limit", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    contractDate: "before2025_06_27",
    housePrice: "600to900",
    requestedLoanAmount: "over400"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const result = checkLoanEligibility(input, newborn);

  assert.equal(input.isLegacyContract, true);
  assert.equal(result.maxAvailableAmount, 500000000);
  assert.equal(result.hasEnoughLimit, true);
});

test("newborn special current contract applies 4억 limit", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    hasNewborn: "yes",
    contractDate: "on_or_after2025_06_27",
    housePrice: "600to900",
    requestedLoanAmount: "over400"
  });
  const newborn = products.find((p) => p.id === "newborn-special");
  const result = checkLoanEligibility(input, newborn);

  assert.equal(input.isLegacyContract, false);
  assert.equal(result.maxAvailableAmount, 400000000);
  assert.equal(result.hasEnoughLimit, false);
});

test("bogeumjari unaffected by legacy contract flag", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    contractDate: "before2025_06_27"
  });
  const bogeumjari = products.find((p) => p.id === "bogeumjari");
  const result = checkLoanEligibility(input, bogeumjari);

  assert.equal(result.maxAvailableAmount, 360000000);
});

test("subscription discount not applied when years under 5 or count under 60", () => {
  const input = normalizeSelections({
    ...defaultSelections,
    childrenCount: "0",
    subscriptionYears: "under5",
    subscriptionPaymentCount: "under60"
  });
  const didimdol = products.find((p) => p.id === "didimdol");
  const rateInfo = calculateActualRate(didimdol, input);

  assert.ok(!rateInfo.discounts.some((d) => d.reason.includes("청약저축")));
});
