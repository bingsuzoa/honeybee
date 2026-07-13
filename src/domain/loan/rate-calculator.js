/**
 * 대출 상품의 실제 적용 금리를 계산합니다.
 * structured JSON의 rates.json과 discounts.json을 기반으로 계산합니다.
 */

export function calculateActualRate(product, input) {
  if (product.category === "didimdol_newborn") {
    return calculateNewbornSpecialRate(product, input);
  }

  if (product.category === "didimdol") {
    return calculateDidimdolRate(product, input);
  }

  if (product.category === "general") {
    return calculateGeneralMortgageRate(product, input);
  }

  // 기타 상품 (보금자리론 등): 기본금리만 반환
  const baseRate = getBaseRate(product, input);
  return {
    finalRate: baseRate,
    baseRate,
    discounts: [],
    totalDiscount: 0,
    maxDiscount: 0,
    isCapped: false,
    discountPeriodYears: 0,
    rateAfterDiscount: baseRate
  };
}

/**
 * 일반 주담대 금리 계산.
 * 확정 금리가 아닌 범위(min~max)와 예상금리를 반환한다.
 * 모든 금리유형을 계산하여 가장 유리한 유형을 대표로 선택하고,
 * 나머지는 alternativeRates로 반환한다.
 */
function calculateGeneralMortgageRate(product, input) {
  const gm = product.generalMortgage;
  if (!gm?.rateTable?.length) {
    return {
      finalRate: null,
      rateRange: null,
      estimatedRate: null,
      baseRate: null,
      discounts: [],
      totalDiscount: 0,
      maxDiscount: 0,
      isCapped: false,
      discountPeriodYears: 0,
      rateAfterDiscount: null,
      isEstimate: true,
      rateType: null,
      alternativeRates: [],
      rateNoticeDate: product.rateNoticeDate
    };
  }

  // 모든 금리유형 계산
  const allRates = gm.rateTable.map(entry => {
    const grossRate = entry.baseRate + entry.additionalRate;
    const minRate = entry.minimumRate ?? (grossRate - (gm.maximumDiscountRate || 0));
    const maxRate = entry.maximumRate ?? grossRate;
    const estimated = Math.round(((minRate + maxRate) / 2) * 100) / 100;
    return {
      rateType: entry.rateType,
      baseRate: entry.baseRate,
      additionalRate: entry.additionalRate,
      rateRange: { min: Math.round(minRate * 100) / 100, max: Math.round(maxRate * 100) / 100 },
      estimatedRate: estimated
    };
  });

  // 최저 minimumRate 기준 best 선택
  allRates.sort((a, b) => a.rateRange.min - b.rateRange.min);
  const best = allRates[0];
  const alternatives = allRates.slice(1);

  // 우대금리 정보 (확인 가능한 항목만)
  const confirmedDiscounts = [];
  const unconfirmedDiscounts = [];

  if (gm.discountGroups?.length) {
    for (const group of gm.discountGroups) {
      for (const item of group.items || []) {
        unconfirmedDiscounts.push({
          reason: item.code,
          amount: item.rate,
          group: group.name,
          groupMaximum: group.maximum
        });
      }
    }
  }

  return {
    finalRate: null, // 확정 불가
    rateRange: best.rateRange,
    estimatedRate: best.estimatedRate,
    rateType: best.rateType,
    baseRate: best.baseRate,
    additionalRate: best.additionalRate,
    alternativeRates: alternatives,
    confirmedDiscounts,
    unconfirmedDiscounts,
    discounts: confirmedDiscounts,
    totalDiscount: 0,
    maxDiscount: gm.maximumDiscountRate || 0,
    isCapped: false,
    discountPeriodYears: 0,
    rateAfterDiscount: best.baseRate + best.additionalRate,
    isEstimate: true,
    rateNoticeDate: product.rateNoticeDate
  };
}

function getBaseRate(product, input) {
  const table = product.rates?.baseRateTable;
  if (!table || !table.length) return product.defaultRate;

  const termYears = input.loanTermYears;
  const availableTerms = product.rates?.termYearsAvailable || [10, 15, 20, 30];
  const term = findClosestTerm(availableTerms, termYears);

  // Income-based table (didimdol, newborn-special)
  if (table[0]?.incomeMin !== undefined) {
    const tier = table.find((t) => input.combinedIncome >= t.incomeMin && input.combinedIncome <= t.incomeMax)
      ?? table[table.length - 1];
    return tier.rates[String(term)] ?? product.defaultRate;
  }

  // Product-type table (bogeumjari) - use first entry as default
  if (table[0]?.productType !== undefined) {
    return table[0].rates[String(term)] ?? product.defaultRate;
  }

  return product.defaultRate;
}

function findClosestTerm(availableTerms, targetTerm) {
  if (availableTerms.includes(targetTerm)) return targetTerm;
  return availableTerms.reduce((closest, term) =>
    Math.abs(term - targetTerm) < Math.abs(closest - targetTerm) ? term : closest
  );
}

function findDiscountByCode(discountsData, code) {
  if (!discountsData) return null;
  const allDiscounts = [
    ...(discountsData.nonCombinableDiscounts || []),
    ...(discountsData.combinableAdditionalDiscounts || []),
    ...(discountsData.discounts || [])
  ];
  return allDiscounts.find((d) => d.code === code) || null;
}

function calculateDidimdolRate(product, input) {
  const baseRate = getBaseRate(product, input);
  let currentRate = baseRate;
  const discounts = [];

  // 신혼가구 우대 (비결합)
  if (input.isMarried && input.marriagePeriodRange.maxYears <= 7) {
    const d = findDiscountByCode(product.discounts, "NEWLYWED");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({
        reason: "신혼가구",
        amount: d.discountPercentPoint,
        period: `${d.maxApplyYears || 5}년간`,
        category: "basic"
      });
    }
  }

  // 생애최초 우대 (신혼가구와 중복 불가)
  if (input.isFirstHomeBuyer && discounts.length === 0) {
    const d = findDiscountByCode(product.discounts, "FIRST_HOME");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({
        reason: "생애최초 주택구입",
        amount: d.discountPercentPoint,
        period: `${d.maxApplyYears || 5}년간`,
        category: "basic"
      });
    }
  }

  // 자녀 수 우대 (비결합)
  if (input.childrenCount >= 3) {
    const d = findDiscountByCode(product.discounts, "THREE_OR_MORE_CHILDREN");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({ reason: "다자녀(3명 이상)", amount: d.discountPercentPoint, period: "5년간", category: "children" });
    }
  } else if (input.childrenCount === 2) {
    const d = findDiscountByCode(product.discounts, "TWO_CHILDREN");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({ reason: "2자녀", amount: d.discountPercentPoint, period: "5년간", category: "children" });
    }
  } else if (input.childrenCount === 1) {
    const d = findDiscountByCode(product.discounts, "ONE_CHILD");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({ reason: "1자녀", amount: d.discountPercentPoint, period: "5년간", category: "children" });
    }
  }

  // 청약저축 가입자 우대 (결합 가능, 단계별)
  if (input.subscriptionStatus !== "NONE") {
    const discountCode = getSubscriptionDiscountCode(input);
    if (discountCode) {
      const d = findDiscountByCode(product.discounts, discountCode);
      if (d) {
        currentRate -= d.discountPercentPoint;
        discounts.push({
          reason: getSubscriptionDiscountLabel(input),
          amount: d.discountPercentPoint,
          period: `${d.maxApplyYears || 5}년간`,
          category: "additional"
        });
      }
    }
  }

  // 전자계약 우대 (결합 가능)
  if (input.usesElectronicContract) {
    const d = findDiscountByCode(product.discounts, "ELECTRONIC_CONTRACT");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({
        reason: "전자계약 체결",
        amount: d.discountPercentPoint,
        period: `${d.maxApplyYears || 5}년간 (2026년 12월 31일까지 계약분)`,
        category: "additional"
      });
    }
  }

  // 지방 소재 주택 우대 (결합 가능)
  if (input.region === "local") {
    const regionalDiscount = product.rates?.regionalDiscounts?.[0];
    if (regionalDiscount) {
      currentRate -= regionalDiscount.discountPercentPoint;
      discounts.push({
        reason: "지방 소재 주택",
        amount: regionalDiscount.discountPercentPoint,
        period: "전체 기간",
        category: "additional"
      });
    }
  }

  // 우대 상한 적용
  const cap = product.rates?.discountCapPercentPoint;
  const maxDiscount = input.childrenCount >= 3
    ? (cap?.multiChild ?? 0.7)
    : (cap?.general ?? 0.5);
  const totalDiscount = baseRate - currentRate;

  let finalRate = currentRate;
  let cappedDiscounts = [...discounts];

  if (totalDiscount > maxDiscount) {
    finalRate = baseRate - maxDiscount;
    cappedDiscounts = discounts.map((d) => ({ ...d, capped: true }));
  }

  const floorRate = product.rates?.finalRateFloorPercent ?? product.minRate ?? 1.5;
  if (finalRate < floorRate) finalRate = floorRate;

  return {
    finalRate: Math.round(finalRate * 100) / 100,
    baseRate,
    discounts: cappedDiscounts,
    totalDiscount: Math.round((baseRate - finalRate) * 100) / 100,
    maxDiscount,
    isCapped: totalDiscount > maxDiscount,
    discountPeriodYears: 5,
    rateAfterDiscount: baseRate
  };
}

function calculateNewbornSpecialRate(product, input) {
  const baseRate = getBaseRate(product, input);
  let currentRate = baseRate;
  const discounts = [];

  // 기존자녀 우대 (1인당 -0.1%p)
  if (input.childrenCount >= 1) {
    const d = findDiscountByCode(product.discounts, "EXISTING_MINOR_CHILD_OVER_2");
    if (d) {
      const perChild = d.discountPercentPointPerChild || 0.1;
      const childDiscount = perChild * Math.min(input.childrenCount, 3);
      currentRate -= childDiscount;
      discounts.push({
        reason: `기존자녀 ${input.childrenCount}명`,
        amount: childDiscount,
        period: `${d.maxApplyYears || 5}년간`,
        category: "children"
      });
    }
  }

  // 청약저축 가입자 우대 (단계별)
  if (input.subscriptionStatus !== "NONE") {
    const discountCode = getSubscriptionDiscountCode(input);
    if (discountCode) {
      const d = findDiscountByCode(product.discounts, discountCode);
      if (d) {
        currentRate -= d.discountPercentPoint;
        discounts.push({
          reason: getSubscriptionDiscountLabel(input),
          amount: d.discountPercentPoint,
          period: `${d.maxApplyYears || 5}년간`,
          category: "additional"
        });
      }
    }
  }

  // 전자계약 우대
  if (input.usesElectronicContract) {
    const d = findDiscountByCode(product.discounts, "ELECTRONIC_CONTRACT");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({
        reason: "전자계약 체결",
        amount: d.discountPercentPoint,
        period: `${d.maxApplyYears || 5}년간 (2026년 12월 31일까지 계약분)`,
        category: "additional"
      });
    }
  }

  // 지방 소재 주택 우대 (결합 가능)
  if (input.region === "local") {
    const regionalDiscount = product.rates?.regionalDiscounts?.[0];
    if (regionalDiscount) {
      currentRate -= regionalDiscount.discountPercentPoint;
      discounts.push({
        reason: "지방 소재 주택",
        amount: regionalDiscount.discountPercentPoint,
        period: "전체 기간",
        category: "additional"
      });
    }
  }

  // 우대 상한 적용
  const maxDiscount = 0.7;
  const totalDiscount = baseRate - currentRate;

  let finalRate = currentRate;
  let cappedDiscounts = [...discounts];

  if (totalDiscount > maxDiscount) {
    finalRate = baseRate - maxDiscount;
    cappedDiscounts = discounts.map((d) => ({ ...d, capped: true }));
  }

  const floorRate = product.rates?.finalRateFloorPercent ?? product.minRate ?? 1.2;
  if (finalRate < floorRate) finalRate = floorRate;

  return {
    finalRate: Math.round(finalRate * 100) / 100,
    baseRate,
    discounts: cappedDiscounts,
    totalDiscount: Math.round((baseRate - finalRate) * 100) / 100,
    maxDiscount,
    isCapped: totalDiscount > maxDiscount,
    discountPeriodYears: 5,
    rateAfterDiscount: baseRate
  };
}

function getSubscriptionDiscountCode(input) {
  const years = input.subscriptionYears;
  const count = input.subscriptionPaymentCount;
  if (years >= 15 && count >= 180) return "SUBSCRIPTION_SAVINGS_15Y_180";
  if (years >= 10 && count >= 120) return "SUBSCRIPTION_SAVINGS_10Y_120";
  if (years >= 5 && count >= 60) return "SUBSCRIPTION_SAVINGS_5Y_60";
  return null;
}

function getSubscriptionDiscountLabel(input) {
  if (input.subscriptionStatus === "WON_AND_CLOSED") {
    return "청약저축 (당첨 해지 인정)";
  }
  return "청약저축 가입";
}

/**
 * 금리 우대 내역을 사람이 읽기 쉬운 형태로 포맷팅합니다.
 */
export function formatRateDiscounts(rateInfo) {
  if (!rateInfo.discounts.length) {
    return "적용 가능한 우대 조건이 없습니다.";
  }

  const lines = rateInfo.discounts.map((d) => {
    return `  - ${d.reason}: -${d.amount.toFixed(2)}%p (${d.period})`;
  });

  let result = lines.join("\n");

  if (rateInfo.isCapped) {
    result += `\n\n* 우대 상한 ${rateInfo.maxDiscount.toFixed(1)}%p 적용됨`;
  }

  return result;
}
