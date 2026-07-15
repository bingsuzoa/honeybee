/**
 * KPI 계산 유틸리티 + 품질 보고서 생성기.
 *
 * collectMetrics: 단일 시나리오의 분석 결과 vs expected를 비교하여 metric 객체 반환
 * generateReport: 전체 시나리오 metric 배열로부터 품질 보고서 문자열 생성
 */

// ====== Metric Collection ======

/**
 * 단일 시나리오의 분석 결과와 expected를 비교하여 metric 수치를 수집한다.
 */
export function collectMetrics(analysis, expected, scenarioId) {
  const m = { scenarioId, eligibility: [], rates: [], limits: [], discounts: [], ranking: {} };

  // --- 정책대출 자격 + 금리 + 한도 ---
  const policyMap = {
    didimdol: "didimdol",
    bogeumjari: "bogeumjari",
    newbornSpecial: "newborn-special"
  };

  for (const [expKey, productId] of Object.entries(policyMap)) {
    const exp = expected[expKey];
    if (!exp) continue;

    const result = analysis.results.find((r) => r.productId === productId);
    if (!result) continue;

    // 자격 판정
    m.eligibility.push({
      productId,
      category: "policy",
      expected: exp.eligible,
      actual: result.isEligible,
      match: result.isEligible === exp.eligible
    });

    if (!exp.eligible || !result.isEligible) continue;

    // 금리 (확정 금리)
    if (exp.finalRate !== undefined) {
      m.rates.push({
        productId,
        category: "policy",
        type: "finalRate",
        expected: exp.finalRate,
        actual: result.estimatedRate,
        error: Math.abs(result.estimatedRate - exp.finalRate)
      });
    }
    if (exp.baseRate !== undefined) {
      m.rates.push({
        productId,
        category: "policy",
        type: "baseRate",
        expected: exp.baseRate,
        actual: result.baseRate,
        error: Math.abs(result.baseRate - exp.baseRate)
      });
    }

    // 한도
    if (exp.maxLoanAmount !== undefined) {
      m.limits.push({
        productId,
        category: "policy",
        expected: exp.maxLoanAmount,
        actual: result.maxAvailableAmount,
        error: Math.abs(result.maxAvailableAmount - exp.maxLoanAmount),
        hasEnoughLimitExpected: exp.hasEnoughLimit,
        hasEnoughLimitActual: result.hasEnoughLimit,
        hasEnoughLimitMatch: result.hasEnoughLimit === exp.hasEnoughLimit
      });
    }

    // 우대 상한 판정
    if (exp.isCapped !== undefined) {
      m.discounts.push({
        productId,
        type: "isCapped",
        expected: exp.isCapped,
        actual: result.isRateCapped,
        match: result.isRateCapped === exp.isCapped
      });
    }
    if (exp.totalDiscount !== undefined) {
      m.discounts.push({
        productId,
        type: "totalDiscount",
        expected: exp.totalDiscount,
        actual: result.totalRateDiscount,
        error: Math.abs(result.totalRateDiscount - exp.totalDiscount)
      });
    }
  }

  // --- 일반 주담대 자격 + 금리범위 ---
  if (expected.kbMortgage) {
    const exp = expected.kbMortgage;
    const kb = analysis.results.find((r) => r.productId === "kb-mortgage");
    if (kb) {
      m.eligibility.push({
        productId: "kb-mortgage",
        category: "general",
        expected: exp.eligible,
        actual: kb.isEligible,
        match: kb.isEligible === exp.eligible
      });

      if (exp.eligible && kb.isEligible && kb.rateRange) {
        m.rates.push({
          productId: "kb-mortgage",
          category: "general",
          type: "rateRangeMin",
          expected: exp.rateRangeMin,
          actual: kb.rateRange.min,
          error: Math.abs(kb.rateRange.min - exp.rateRangeMin)
        });
        m.rates.push({
          productId: "kb-mortgage",
          category: "general",
          type: "rateRangeMax",
          expected: exp.rateRangeMax,
          actual: kb.rateRange.max,
          error: Math.abs(kb.rateRange.max - exp.rateRangeMax)
        });
      }

      // 우대금리 분류 정확도
      if (exp.confirmedDiscountCodes && kb.rateDiscounts) {
        const actualCodes = kb.rateDiscounts.map((d) => d.reason);
        const expectedCodes = exp.confirmedDiscountCodes;

        const tp = expectedCodes.filter((c) => actualCodes.includes(c)).length;
        const fp = actualCodes.filter((c) => !expectedCodes.includes(c)).length;
        const fn = expectedCodes.filter((c) => !actualCodes.includes(c)).length;

        const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

        m.discounts.push({
          productId: "kb-mortgage",
          type: "confirmedF1",
          expected: expectedCodes,
          actual: actualCodes,
          precision,
          recall,
          f1
        });
      }

      // LTV 한도
      if (exp.ltvLimit !== undefined && kb.limitDetails) {
        const ltvEntry = kb.limitDetails.limits?.find((l) => l.type === "ltv");
        if (ltvEntry?.calculable) {
          m.limits.push({
            productId: "kb-mortgage",
            category: "general",
            expected: exp.ltvLimit,
            actual: ltvEntry.amount,
            error: Math.abs(ltvEntry.amount - exp.ltvLimit)
          });
        }
      }
    }
  }

  // --- 추천 순위 ---
  if (expected.expectedTop1) {
    m.ranking.top1Expected = expected.expectedTop1;
    m.ranking.top1Actual = analysis.recommendedProductId;
    m.ranking.top1Match = analysis.recommendedProductId === expected.expectedTop1;
  }
  if (expected.expectedTop1Category) {
    const recommended = analysis.results.find((r) => r.rank === 1);
    const actualCategory = recommended?.product?.category === "general" ? "general" : "policy";
    m.ranking.categoryExpected = expected.expectedTop1Category;
    m.ranking.categoryActual = actualCategory;
    m.ranking.categoryMatch = actualCategory === expected.expectedTop1Category;
  }
  if (expected.expectedPolicyEligibleIds) {
    const actualPolicyIds = analysis.policyResults
      .filter((r) => r.isEligible && r.hasEnoughLimit)
      .map((r) => r.productId)
      .sort();
    const expectedIds = [...expected.expectedPolicyEligibleIds].sort();
    m.ranking.policyEligibleExpected = expectedIds;
    m.ranking.policyEligibleActual = actualPolicyIds;
    m.ranking.policyEligibleMatch =
      JSON.stringify(actualPolicyIds) === JSON.stringify(expectedIds);
  }

  return m;
}


// ====== Report Generation ======

export function generateReport(allMetrics) {
  const n = allMetrics.length;

  // 1. 자격 판정 정확도
  const allElig = allMetrics.flatMap((m) => m.eligibility);
  const policyElig = allElig.filter((e) => e.category === "policy");
  const generalElig = allElig.filter((e) => e.category === "general");
  const policyCorrect = policyElig.filter((e) => e.match).length;
  const generalCorrect = generalElig.filter((e) => e.match).length;
  const policyEligPct = policyElig.length > 0 ? ((policyCorrect / policyElig.length) * 100).toFixed(1) : "N/A";
  const generalEligPct = generalElig.length > 0 ? ((generalCorrect / generalElig.length) * 100).toFixed(1) : "N/A";

  // 자격 판정 실패 상세
  const eligFailures = allElig.filter((e) => !e.match);

  // 2. 금리 정확도
  const allRates = allMetrics.flatMap((m) => m.rates);
  const policyFinalRates = allRates.filter((r) => r.category === "policy" && r.type === "finalRate");
  const policyBaseRates = allRates.filter((r) => r.category === "policy" && r.type === "baseRate");
  const generalMinRates = allRates.filter((r) => r.category === "general" && r.type === "rateRangeMin");
  const generalMaxRates = allRates.filter((r) => r.category === "general" && r.type === "rateRangeMax");

  const policyFinalMAE = mean(policyFinalRates.map((r) => r.error));
  const policyFinalMax = max(policyFinalRates.map((r) => r.error));
  const policyBaseMAE = mean(policyBaseRates.map((r) => r.error));
  const generalMinMAE = mean(generalMinRates.map((r) => r.error));
  const generalMaxMAE = mean(generalMaxRates.map((r) => r.error));

  // 금리 실패 상세
  const rateFailures = allRates.filter((r) => r.error > 0.01);

  // 3. 한도 정확도
  const allLimits = allMetrics.flatMap((m) => m.limits);
  const policyLimits = allLimits.filter((l) => l.category === "policy");
  const generalLimits = allLimits.filter((l) => l.category === "general");
  const limitCorrect = policyLimits.filter((l) => l.error === 0).length;
  const limitHasEnoughMatch = policyLimits.filter((l) => l.hasEnoughLimitMatch !== undefined && l.hasEnoughLimitMatch).length;
  const limitHasEnoughTotal = policyLimits.filter((l) => l.hasEnoughLimitMatch !== undefined).length;
  const generalLtvCorrect = generalLimits.filter((l) => l.error === 0).length;

  // 4. 우대금리 분류
  const allDisc = allMetrics.flatMap((m) => m.discounts);
  const f1Entries = allDisc.filter((d) => d.type === "confirmedF1");
  const avgF1 = f1Entries.length > 0 ? mean(f1Entries.map((d) => d.f1)) : null;
  const capEntries = allDisc.filter((d) => d.type === "isCapped");
  const capCorrect = capEntries.filter((d) => d.match).length;
  const discountErrors = allDisc.filter((d) => d.type === "totalDiscount" && d.error > 0.01);

  // 5. 추천 순위
  const rankings = allMetrics.map((m) => m.ranking).filter((r) => r.top1Expected);
  const top1Correct = rankings.filter((r) => r.top1Match).length;
  const categoryCorrect = allMetrics.map((m) => m.ranking).filter((r) => r.categoryMatch).length;
  const categoryTotal = allMetrics.map((m) => m.ranking).filter((r) => r.categoryExpected).length;
  const policySetCorrect = allMetrics.map((m) => m.ranking).filter((r) => r.policyEligibleMatch).length;
  const policySetTotal = allMetrics.map((m) => m.ranking).filter((r) => r.policyEligibleExpected).length;

  // 6. 종합 점수 계산
  const eligScore = allElig.length > 0 ? (allElig.filter((e) => e.match).length / allElig.length) * 100 : 100;
  const rateScore = policyFinalMAE !== null ? Math.max(0, 100 - policyFinalMAE * 1000) : 100;
  const limitScore = policyLimits.length > 0
    ? (policyLimits.filter((l) => l.error === 0).length / policyLimits.length) * 100 : 100;
  const repaymentScore = rateScore; // 상환액 정확도는 금리에서 파생
  const rankScore = rankings.length > 0
    ? (top1Correct / rankings.length) * 100 : 100;

  const overall = 0.25 * eligScore + 0.25 * rateScore + 0.20 * limitScore + 0.15 * repaymentScore + 0.15 * rankScore;

  // 보고서 생성
  let report = `
==========================================
  대출 추천 서비스 품질 보고서
==========================================
테스트 시나리오: ${n}개
테스트 일시: ${new Date().toISOString()}

[1] 자격 판정 정확도
    정책대출: ${policyEligPct}% (${policyCorrect}/${policyElig.length})
    일반주담대: ${generalEligPct}% (${generalCorrect}/${generalElig.length})`;

  if (eligFailures.length > 0) {
    report += `\n    --- 불일치 ---`;
    for (const f of eligFailures) {
      const sid = allMetrics.find((m) => m.eligibility.includes(f))?.scenarioId || "?";
      report += `\n    [${sid}] ${f.productId}: expected=${f.expected}, actual=${f.actual}`;
    }
  }

  report += `

[2] 금리 정확도
    정책대출 기본금리 MAE: ${fmt(policyBaseMAE)}%p (${policyBaseRates.length}건)
    정책대출 최종금리 MAE: ${fmt(policyFinalMAE)}%p (${policyFinalRates.length}건)
    정책대출 최종금리 최대오차: ${fmt(policyFinalMax)}%p
    일반주담대 최저금리 MAE: ${fmt(generalMinMAE)}%p (${generalMinRates.length}건)
    일반주담대 최고금리 MAE: ${fmt(generalMaxMAE)}%p (${generalMaxRates.length}건)`;

  if (rateFailures.length > 0) {
    report += `\n    --- 오차 > 0.01%p ---`;
    for (const f of rateFailures) {
      const sid = allMetrics.find((m) => m.rates.includes(f))?.scenarioId || "?";
      report += `\n    [${sid}] ${f.productId} ${f.type}: expected=${f.expected}, actual=${f.actual}, error=${f.error.toFixed(3)}`;
    }
  }

  report += `

[3] 한도 정확도
    정책대출 한도 일치: ${limitCorrect}/${policyLimits.length}
    정책대출 한도충족 판정 일치: ${limitHasEnoughMatch}/${limitHasEnoughTotal}
    일반주담대 LTV 한도 일치: ${generalLtvCorrect}/${generalLimits.length}

[4] 우대금리 분류
    Cap 판정 일치: ${capCorrect}/${capEntries.length}
    일반주담대 confirmed F1: ${avgF1 !== null ? avgF1.toFixed(3) : "N/A"} (${f1Entries.length}건)`;

  if (discountErrors.length > 0) {
    report += `\n    --- 할인액 오차 > 0.01%p ---`;
    for (const d of discountErrors) {
      const sid = allMetrics.find((m) => m.discounts.includes(d))?.scenarioId || "?";
      report += `\n    [${sid}] ${d.productId}: expected=${d.expected}, actual=${d.actual}`;
    }
  }

  report += `

[5] 추천 순위
    Top-1 일치율: ${rankings.length > 0 ? ((top1Correct / rankings.length) * 100).toFixed(1) : "N/A"}% (${top1Correct}/${rankings.length})
    카테고리 일치율: ${categoryTotal > 0 ? ((categoryCorrect / categoryTotal) * 100).toFixed(1) : "N/A"}% (${categoryCorrect}/${categoryTotal})
    정책대출 자격 집합 일치: ${policySetCorrect}/${policySetTotal}`;

  const rankFailures = rankings.filter((r) => !r.top1Match);
  if (rankFailures.length > 0) {
    report += `\n    --- Top-1 불일치 ---`;
    for (const rf of rankFailures) {
      const sid = allMetrics.find((m) => m.ranking === rf)?.scenarioId || "?";
      report += `\n    [${sid}] expected=${rf.top1Expected}, actual=${rf.top1Actual}`;
    }
  }

  report += `

[종합] 서비스 품질 점수: ${overall.toFixed(1)}점 / 100점
    자격판정(25%): ${eligScore.toFixed(1)}
    금리(25%): ${rateScore.toFixed(1)}
    한도(20%): ${limitScore.toFixed(1)}
    상환액(15%): ${repaymentScore.toFixed(1)}
    순위(15%): ${rankScore.toFixed(1)}

--- 측정 불가능 변수로 인한 한계 ---
  · 일반 주담대 정확한 금리: 은행 내부 CSS 모형 (공시 범위 내 위치 불확실)
  · 일반 주담대 정확한 한도: 담보평가·소득검증 필요 (추정치)
  · DSR 정밀 계산: 스트레스 금리 비공개
==========================================`;

  return report;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function max(arr) {
  if (!arr.length) return null;
  return Math.max(...arr);
}

function fmt(v) {
  if (v === null) return "N/A";
  return v.toFixed(3);
}
