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

  if (product.category === "bogeumjari") {
    return calculateBogeumjariRate(product, input);
  }

  if (product.category === "general") {
    return calculateGeneralMortgageRate(product, input);
  }

  // 기타 상품: 기본금리만 반환
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

  // 신용점수 기반 estimatedRate 위치 보정
  if (input.creditScoreRange) {
    const min = best.rateRange.min;
    const max = best.rateRange.max;
    const range = max - min;
    if (input.creditScoreRange.min >= 900) {
      best.estimatedRate = Math.round((min + range * 0.25) * 100) / 100;
    } else if (input.creditScoreRange.min >= 800) {
      best.estimatedRate = Math.round((min + range * 0.45) * 100) / 100;
    } else if (input.creditScoreRange.min >= 700) {
      best.estimatedRate = Math.round((min + range * 0.65) * 100) / 100;
    } else {
      best.estimatedRate = Math.round((min + range * 0.85) * 100) / 100;
    }
  }

  // 우대금리 정보: 기존 입력으로 confirmed/rejected/unconfirmed 분류
  const confirmedDiscounts = [];
  const unconfirmedDiscounts = [];

  // 그룹별 확정 할인 합계 (maximum cap 적용용)
  const confirmedByGroup = {};

  if (gm.discountGroups?.length) {
    for (const group of gm.discountGroups) {
      for (const item of group.items || []) {
        const status = matchGeneralMortgageDiscount(item, input, product);
        if (status === "confirmed") {
          if (!confirmedByGroup[group.name]) {
            confirmedByGroup[group.name] = { total: 0, maximum: group.maximum };
          }
          confirmedByGroup[group.name].total += item.rate;
          confirmedDiscounts.push({
            reason: item.code,
            amount: item.rate,
            group: group.name,
            groupMaximum: group.maximum
          });
        } else if (status === "unconfirmed") {
          unconfirmedDiscounts.push({
            reason: item.code,
            amount: item.rate,
            group: group.name,
            groupMaximum: group.maximum
          });
        }
        // rejected → 제거 (어디에도 추가하지 않음)
      }
    }
  }

  // 그룹별 maximum cap 적용한 확정 할인 합계
  let totalConfirmedDiscount = 0;
  for (const groupName in confirmedByGroup) {
    const g = confirmedByGroup[groupName];
    totalConfirmedDiscount += Math.min(g.total, g.maximum);
  }
  totalConfirmedDiscount = Math.round(totalConfirmedDiscount * 100) / 100;

  // 확정 할인 반영: estimatedRate와 rateRange.max 하향
  const adjustedEstimated = Math.max(
    Math.round((best.estimatedRate - totalConfirmedDiscount) * 100) / 100,
    best.rateRange.min
  );
  const adjustedMax = Math.max(
    Math.round((best.rateRange.max - totalConfirmedDiscount) * 100) / 100,
    best.rateRange.min
  );

  return {
    finalRate: null, // 확정 불가
    rateRange: { min: best.rateRange.min, max: adjustedMax },
    estimatedRate: adjustedEstimated,
    rateType: best.rateType,
    baseRate: best.baseRate,
    additionalRate: best.additionalRate,
    alternativeRates: alternatives,
    confirmedDiscounts,
    unconfirmedDiscounts,
    rateDiscounts: confirmedDiscounts,
    discounts: confirmedDiscounts,
    totalDiscount: totalConfirmedDiscount,
    maxDiscount: gm.maximumDiscountRate || 0,
    isCapped: false,
    discountPeriodYears: 0,
    rateAfterDiscount: best.baseRate + best.additionalRate,
    isEstimate: true,
    rateNoticeDate: product.rateNoticeDate
  };
}

/**
 * 일반 주담대 우대금리 항목을 기존 입력으로 매칭하여
 * "confirmed" / "rejected" / "unconfirmed" 반환
 */
function matchGeneralMortgageDiscount(item, input, product) {
  const code = item.code;

  // KB 부동산 전자계약: 전자계약 사용 + 구입목적
  if (code === "REAL_ESTATE_E_CONTRACT") {
    if (input.usesElectronicContract && input.detailedPurpose === "purchase") {
      return "confirmed";
    }
    if (!input.usesElectronicContract || input.detailedPurpose === "refinance") {
      return "rejected";
    }
    return "unconfirmed";
  }

  // NH 부동산 전자계약: 전자계약 사용
  if (code === "부동산 전자계약") {
    if (input.usesElectronicContract) return "confirmed";
    if (input.usesElectronicContract === false) return "rejected";
    return "unconfirmed";
  }

  // 다자녀(3명 이상)
  if (code === "THREE_OR_MORE_CHILDREN") {
    if (input.childrenCount >= 3) return "confirmed";
    if (input.childrenCount < 3) return "rejected";
    return "unconfirmed";
  }

  // 2자녀 + 85m² 이하
  if (code === "TWO_CHILDREN_AND_AREA_85_OR_LESS") {
    if (input.childrenCount >= 2 && input.exclusiveArea <= 85) return "confirmed";
    if (input.childrenCount < 2 || input.exclusiveArea > 85) return "rejected";
    return "unconfirmed";
  }

  // 대출금액 2억원 이하
  if (code === "대출금액 2억원 이하") {
    if (input.requestedLoanAmount <= 200000000) return "confirmed";
    if (input.requestedLoanAmount > 200000000) return "rejected";
    return "unconfirmed";
  }

  // 급여이체 매칭 (provider 기반)
  const provider = product?.provider;

  // KB 급여·연금이체
  if (code === "SALARY_OR_PENSION_TRANSFER" && provider === "KB국민은행") {
    if (input.salaryTransferBank === "KB") return "confirmed";
    if (input.salaryTransferBank && input.salaryTransferBank !== "KB") return "rejected";
    return "unconfirmed";
  }

  // 하나 급여이체
  if (code === "SALARY_TRANSFER" && provider === "하나은행") {
    if (input.salaryTransferBank === "HANA") return "confirmed";
    if (input.salaryTransferBank && input.salaryTransferBank !== "HANA") return "rejected";
    return "unconfirmed";
  }

  // NH 급여 매월 150만원 이상
  if (code === "급여 매월 150만원 이상" && provider === "NH농협은행") {
    if (input.salaryTransferBank === "NH") return "confirmed";
    if (input.salaryTransferBank && input.salaryTransferBank !== "NH") return "rejected";
    return "unconfirmed";
  }

  // NH 비거치식 분할상환 (거치 없는 분할상환이 기본이므로 confirmed)
  if (code === "비거치식 분할상환" || code === "비거치식 분할상환(5년주기형)") {
    return "confirmed";
  }

  // NH 최초신규 / 최초신규고객 (기존 대출 없음 = 최초 신규)
  if (code === "최초신규" || code === "최초신규고객") {
    if (input.existingAnnualRepayment === 0) return "confirmed";
    if (input.existingAnnualRepayment > 0) return "rejected";
    return "unconfirmed";
  }

  // --- Phase 3: 거래실적 매칭 (급여이체 은행 + bankTransactionLevel) ---
  const salaryBank = input.salaryTransferBank;
  const txLevel = input.bankTransactionLevel;

  // 은행별 급여이체 코드 → provider 매핑
  const bankToProvider = { KB: "KB국민은행", HANA: "하나은행", NH: "NH농협은행" };
  const salaryMatchesProvider = salaryBank && bankToProvider[salaryBank] === provider;

  // 카드 이용실적 (4종)
  if (code === "KB_CREDIT_CARD" && provider === "KB국민은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary" || txLevel === "card_only") return "confirmed";
    if (txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }
  if (code === "AFFILIATED_CARD_300K" && provider === "하나은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary" || txLevel === "card_only") return "confirmed";
    if (txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }
  if (code === "AFFILIATED_CARD_700K_ADDITIONAL" && provider === "하나은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary") return "confirmed";
    if (txLevel === "card_only" || txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }
  if (code === "카드 3개월 100만원 이상" && provider === "NH농협은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary" || txLevel === "card_only") return "confirmed";
    if (txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }

  // 예금·적금 (4종)
  if (code === "SAVINGS_BALANCE_300K" && provider === "KB국민은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary") return "confirmed";
    if (txLevel === "card_only" || txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }
  if (code === "SAVINGS_OR_SUBSCRIPTION" && provider === "하나은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary") return "confirmed";
    if (txLevel === "card_only" || txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }
  if (code === "입출금예금 평잔 200만원 이상" && provider === "NH농협은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary") return "confirmed";
    if (txLevel === "card_only" || txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }
  if (code === "적립식예금 월 10만원 이상" && provider === "NH농협은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary") return "confirmed";
    if (txLevel === "card_only" || txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }

  // 자동이체 (2종)
  if (code === "AUTO_TRANSFER_3_OR_MORE" && provider === "KB국민은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary") return "confirmed";
    if (txLevel === "card_only" || txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }
  if (code === "자동이체 매월 3건 이상" && provider === "NH농협은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary") return "confirmed";
    if (txLevel === "card_only" || txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }

  // KB스타뱅킹 (1종)
  if (code === "KB_STAR_BANKING" && provider === "KB국민은행") {
    if (!salaryMatchesProvider) return "unconfirmed";
    if (txLevel === "primary" || txLevel === "card_only") return "confirmed";
    if (txLevel === "salary_only") return "rejected";
    return "unconfirmed";
  }

  // --- Phase 3: 사회배려 대상 매칭 ---
  const socialStatus = input.socialCareStatus;

  // 하나은행 사회배려 (4종) + KB 취약차주 (1종)
  if (code === "BASIC_LIVELIHOOD" || code === "SINGLE_PARENT" || code === "MULTICULTURAL" || code === "DISABLED" || code === "VULNERABLE_BORROWER") {
    if (socialStatus === "eligible") return "confirmed";
    if (socialStatus === "none" || socialStatus === "farmer") return "rejected";
    return "unconfirmed";
  }

  // NH 농업인 (1종)
  if (code === "농업인") {
    if (socialStatus === "farmer") return "confirmed";
    if (socialStatus === "none" || socialStatus === "eligible") return "rejected";
    return "unconfirmed";
  }

  return "unconfirmed";
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

function calculateBogeumjariRate(product, input) {
  // 아낌e보금자리론 여부에 따른 기준금리 선택
  const table = product.rates?.baseRateTable;
  const availableTerms = product.rates?.termYearsAvailable || [10, 15, 20, 30, 40, 50];
  const term = findClosestTerm(availableTerms, input.loanTermYears);

  let productType = "U_BOGEUMJARI";
  if (input.usesElectronicContract) {
    productType = "AKKIM_E_BOGEUMJARI";
  }

  const rateEntry = table?.find((t) => t.productType === productType) || table?.[0];
  const baseRate = rateEntry?.rates[String(term)] ?? product.defaultRate;

  let currentRate = baseRate;
  const discounts = [];

  // 아낌e보금자리론 선택 시 0.1%p 우대 표시 (기준금리에 이미 반영)
  if (input.usesElectronicContract && productType === "AKKIM_E_BOGEUMJARI") {
    const uRate = table?.find((t) => t.productType === "U_BOGEUMJARI")?.rates[String(term)];
    if (uRate && uRate > baseRate) {
      discounts.push({
        reason: "아낌e보금자리론 (전자약정·전자등기)",
        amount: Math.round((uRate - baseRate) * 100) / 100,
        period: "전체 기간",
        category: "product_type"
      });
    }
  }

  // 소득 7천만원 이하 체크 (많은 우대 항목의 전제조건)
  const incomeUnder70M = input.combinedIncome <= 70000000;

  // 신혼가구 우대 (소득 7천만 이하 + 혼인 7년 이내)
  if (incomeUnder70M && input.isMarried && input.marriagePeriodRange.maxYears <= 7) {
    const d = findDiscountByCode(product.discounts, "NEWLYWED");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({
        reason: "신혼가구",
        amount: d.discountPercentPoint,
        period: "전체 기간",
        category: "basic"
      });
    }
  }

  // 출산가구 우대 (소득 7천만 이하 + 신생아, 신혼과 비결합)
  const hasNewlywedDiscount = discounts.some((d) => d.reason === "신혼가구");
  if (incomeUnder70M && input.hasNewborn && !hasNewlywedDiscount) {
    const d = findDiscountByCode(product.discounts, "NEWBORN");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({
        reason: "출산가구",
        amount: d.discountPercentPoint,
        period: "전체 기간",
        category: "basic"
      });
    }
  }

  // 자녀 수 우대
  if (input.childrenCount >= 3) {
    const d = findDiscountByCode(product.discounts, "THREE_OR_MORE_CHILDREN");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({ reason: "다자녀(3명 이상)", amount: d.discountPercentPoint, period: "전체 기간", category: "children" });
    }
  } else if (input.childrenCount === 2) {
    const d = findDiscountByCode(product.discounts, "TWO_CHILDREN");
    if (d) {
      currentRate -= d.discountPercentPoint;
      discounts.push({ reason: "2자녀", amount: d.discountPercentPoint, period: "전체 기간", category: "children" });
    }
  }

  // 규제지역 가산 (+0.1%p, 전세사기피해자 제외)
  const additions = product.discounts?.additions;
  if (additions?.length) {
    const regulated = additions.find((a) => a.code === "REGULATED_AREA");
    if (regulated && (input.regulationZone === "SPECULATION_OVERHEATED" || input.regulationZone === "ADJUSTMENT_TARGET")) {
      currentRate += regulated.additionPercentPoint;
      discounts.push({
        reason: "규제지역 가산",
        amount: -regulated.additionPercentPoint,
        period: "전체 기간",
        category: "addition"
      });
    }
  }

  // 우대 상한 적용 (가산 제외, 우대만 cap)
  const maxDiscount = product.discounts?.maxDiscountPercentPoint ?? 1.0;
  const discountOnly = discounts
    .filter((d) => d.category !== "addition" && d.category !== "product_type")
    .reduce((sum, d) => sum + d.amount, 0);

  let finalRate = currentRate;
  let cappedDiscounts = [...discounts];

  if (discountOnly > maxDiscount) {
    const excess = discountOnly - maxDiscount;
    finalRate = currentRate + excess;
    cappedDiscounts = discounts.map((d) => ({ ...d, capped: d.category !== "addition" && d.category !== "product_type" }));
  }

  const floorRate = product.rates?.finalRateFloorPercent ?? 3.9;
  if (finalRate < floorRate) finalRate = floorRate;

  return {
    finalRate: Math.round(finalRate * 100) / 100,
    baseRate,
    discounts: cappedDiscounts,
    totalDiscount: Math.round((baseRate - finalRate) * 100) / 100,
    maxDiscount,
    isCapped: discountOnly > maxDiscount,
    discountPeriodYears: 0,
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
