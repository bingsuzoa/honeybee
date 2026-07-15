/**
 * 예측 정확도 검증 테스트 러너.
 *
 * 30개 시나리오에 대해 서비스 분석 결과와 은행 규정 기반 정답(expected)을 비교한다.
 * 실행: node --test tests/accuracy/accuracy-runner.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { analyzeAllProducts } from "../../src/domain/loan/analysis.js";
import { normalizeSelections } from "../../src/domain/loan/selection-options.js";
import { SCENARIOS } from "./fixtures.mjs";
import { collectMetrics, generateReport } from "./metrics.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "../../src/data");

const productsData = JSON.parse(readFileSync(join(dataDir, "products.json"), "utf8"));
const products = productsData.products;
const ltvRules = JSON.parse(readFileSync(join(dataDir, "ltv-rules.json"), "utf8"));

const allMetrics = [];

for (const scenario of SCENARIOS) {
  test(`[${scenario.id}] ${scenario.name}`, async (t) => {
    const input = normalizeSelections(scenario.selections);
    const analysis = analyzeAllProducts(input, products, ltvRules);
    const expected = scenario.expected;

    // Collect metrics for the final report
    const metrics = collectMetrics(analysis, expected, scenario.id);
    allMetrics.push(metrics);

    // ===== 자격 판정 검증 =====
    await t.test("eligibility", () => {
      const policyMap = {
        didimdol: "didimdol",
        bogeumjari: "bogeumjari",
        newbornSpecial: "newborn-special"
      };

      for (const [expKey, productId] of Object.entries(policyMap)) {
        const exp = expected[expKey];
        if (!exp) continue;
        const result = analysis.results.find((r) => r.productId === productId);
        assert.ok(result, `${productId} 결과 없음`);
        assert.equal(
          result.isEligible, exp.eligible,
          `${productId} 자격: expected=${exp.eligible}, actual=${result.isEligible}` +
          (result.isEligible !== exp.eligible ? ` reasons=[${result.ineligibleReasons.join("; ")}]` : "")
        );
      }

      if (expected.kbMortgage) {
        const kb = analysis.results.find((r) => r.productId === "kb-mortgage");
        assert.ok(kb, "kb-mortgage 결과 없음");
        assert.equal(kb.isEligible, expected.kbMortgage.eligible, "KB 자격 불일치");
      }
    });

    // ===== 금리 검증 =====
    await t.test("rates", () => {
      const policyChecks = [
        { key: "didimdol", id: "didimdol" },
        { key: "bogeumjari", id: "bogeumjari" },
        { key: "newbornSpecial", id: "newborn-special" }
      ];

      for (const { key, id } of policyChecks) {
        const exp = expected[key];
        if (!exp?.eligible || exp.finalRate === undefined) continue;

        const result = analysis.results.find((r) => r.productId === id);
        if (!result?.isEligible) continue;

        // 기본금리
        if (exp.baseRate !== undefined) {
          assert.ok(
            Math.abs(result.baseRate - exp.baseRate) < 0.01,
            `${id} 기본금리: expected=${exp.baseRate}, actual=${result.baseRate}`
          );
        }

        // 최종금리
        assert.ok(
          Math.abs(result.estimatedRate - exp.finalRate) < 0.01,
          `${id} 최종금리: expected=${exp.finalRate}, actual=${result.estimatedRate}`
        );

        // 총 할인
        if (exp.totalDiscount !== undefined) {
          assert.ok(
            Math.abs(result.totalRateDiscount - exp.totalDiscount) < 0.01,
            `${id} 총할인: expected=${exp.totalDiscount}, actual=${result.totalRateDiscount}`
          );
        }

        // Cap 판정
        if (exp.isCapped !== undefined) {
          assert.equal(
            result.isRateCapped, exp.isCapped,
            `${id} cap: expected=${exp.isCapped}, actual=${result.isRateCapped}`
          );
        }
      }

      // 일반 주담대 금리 범위
      if (expected.kbMortgage?.eligible && expected.kbMortgage.rateRangeMin !== undefined) {
        const kb = analysis.results.find((r) => r.productId === "kb-mortgage");
        if (kb?.isEligible && kb.rateRange) {
          assert.ok(
            Math.abs(kb.rateRange.min - expected.kbMortgage.rateRangeMin) < 0.01,
            `KB 최저금리: expected=${expected.kbMortgage.rateRangeMin}, actual=${kb.rateRange.min}`
          );
          assert.ok(
            Math.abs(kb.rateRange.max - expected.kbMortgage.rateRangeMax) < 0.01,
            `KB 최고금리: expected=${expected.kbMortgage.rateRangeMax}, actual=${kb.rateRange.max}`
          );
        }
      }
    });

    // ===== 한도 검증 =====
    await t.test("limits", () => {
      const policyChecks = [
        { key: "didimdol", id: "didimdol" },
        { key: "bogeumjari", id: "bogeumjari" },
        { key: "newbornSpecial", id: "newborn-special" }
      ];

      for (const { key, id } of policyChecks) {
        const exp = expected[key];
        if (!exp?.eligible || exp.maxLoanAmount === undefined) continue;

        const result = analysis.results.find((r) => r.productId === id);
        if (!result?.isEligible) continue;

        assert.equal(
          result.maxAvailableAmount, exp.maxLoanAmount,
          `${id} 한도: expected=${exp.maxLoanAmount}, actual=${result.maxAvailableAmount}`
        );

        if (exp.hasEnoughLimit !== undefined) {
          assert.equal(
            result.hasEnoughLimit, exp.hasEnoughLimit,
            `${id} 한도충족: expected=${exp.hasEnoughLimit}, actual=${result.hasEnoughLimit}`
          );
        }
      }

      // KB LTV 한도
      if (expected.kbMortgage?.ltvLimit !== undefined) {
        const kb = analysis.results.find((r) => r.productId === "kb-mortgage");
        if (kb?.isEligible && kb.limitDetails) {
          const ltvEntry = kb.limitDetails.limits?.find((l) => l.type === "ltv");
          if (ltvEntry?.calculable) {
            assert.equal(
              ltvEntry.amount, expected.kbMortgage.ltvLimit,
              `KB LTV 한도: expected=${expected.kbMortgage.ltvLimit}, actual=${ltvEntry.amount}`
            );
          }
        }
      }
    });

    // ===== 우대금리 분류 검증 =====
    await t.test("discount classification", () => {
      if (!expected.kbMortgage?.eligible || !expected.kbMortgage.confirmedDiscountCodes) return;

      const kb = analysis.results.find((r) => r.productId === "kb-mortgage");
      if (!kb?.isEligible) return;

      const actualCodes = (kb.rateDiscounts || []).map((d) => d.reason).sort();
      const expectedCodes = [...expected.kbMortgage.confirmedDiscountCodes].sort();

      // Check each expected code is confirmed
      for (const code of expectedCodes) {
        assert.ok(
          actualCodes.includes(code),
          `KB confirmed 누락: ${code} (actual: [${actualCodes.join(", ")}])`
        );
      }

      // Check no unexpected codes are confirmed
      for (const code of actualCodes) {
        assert.ok(
          expectedCodes.includes(code),
          `KB 불필요 confirmed: ${code}`
        );
      }
    });

    // ===== 추천 순위 검증 =====
    await t.test("ranking", () => {
      // Top-1 상품 일치
      if (expected.expectedTop1) {
        assert.equal(
          analysis.recommendedProductId, expected.expectedTop1,
          `Top-1: expected=${expected.expectedTop1}, actual=${analysis.recommendedProductId}`
        );
      }

      // Top-1 카테고리 일치
      if (expected.expectedTop1Category) {
        const recommended = analysis.results.find((r) => r.rank === 1);
        const actualCategory = recommended?.product?.category === "general" ? "general" : "policy";
        assert.equal(
          actualCategory, expected.expectedTop1Category,
          `Top-1 카테고리: expected=${expected.expectedTop1Category}, actual=${actualCategory}`
        );
      }

      // 정책대출 자격 집합 일치
      if (expected.expectedPolicyEligibleIds) {
        const actualIds = analysis.policyResults
          .filter((r) => r.isEligible && r.hasEnoughLimit)
          .map((r) => r.productId)
          .sort();
        const expectedIds = [...expected.expectedPolicyEligibleIds].sort();
        assert.deepEqual(
          actualIds, expectedIds,
          `정책대출 자격 집합: expected=[${expectedIds}], actual=[${actualIds}]`
        );
      }
    });

    // ===== 월상환액 검증 (정책대출) =====
    await t.test("repayment", () => {
      const policyChecks = [
        { key: "didimdol", id: "didimdol" },
        { key: "bogeumjari", id: "bogeumjari" },
        { key: "newbornSpecial", id: "newborn-special" }
      ];

      for (const { key, id } of policyChecks) {
        const exp = expected[key];
        if (!exp?.eligible || exp.finalRate === undefined) continue;

        const result = analysis.results.find((r) => r.productId === id);
        if (!result?.isEligible) continue;

        // 월상환액이 양수인지 (금리가 맞으면 상환액도 맞을 것)
        assert.ok(result.monthlyPayment > 0, `${id} 월상환액이 0입니다`);
        assert.ok(result.totalInterest > 0, `${id} 총이자가 0입니다`);
        assert.ok(result.totalRepayment > result.totalInterest, `${id} 총상환 < 총이자`);
      }
    });
  });
}

// ===== 전체 품질 보고서 =====
test("Quality Report", () => {
  const report = generateReport(allMetrics);
  console.log(report);

  // 종합 기준: 모든 자격 판정이 일치해야 함
  const allElig = allMetrics.flatMap((m) => m.eligibility);
  const eligFailures = allElig.filter((e) => !e.match);
  assert.equal(eligFailures.length, 0,
    `자격 판정 불일치 ${eligFailures.length}건: ${eligFailures.map((f) => `${f.productId}(expected=${f.expected})`).join(", ")}`
  );

  // 금리 오차 기준
  const policyRates = allMetrics.flatMap((m) => m.rates).filter((r) => r.category === "policy" && r.type === "finalRate");
  const maxRateError = policyRates.length > 0 ? Math.max(...policyRates.map((r) => r.error)) : 0;
  assert.ok(maxRateError < 0.01, `정책대출 금리 최대 오차 ${maxRateError.toFixed(3)}%p > 0.01%p`);
});
