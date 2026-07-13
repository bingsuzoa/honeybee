/**
 * 은행별 일반 주담대 structured 데이터를 통합 포맷으로 변환하는 어댑터.
 *
 * KB/신한 분리형 (meta.json + 개별 파일)과
 * 우리/하나/NH 통합형 (product.json + rates.json + common_rules.json)을
 * 동일한 출력 스키마로 정규화한다.
 */

const REPAYMENT_METHOD_MAP = {
  EQUAL_PRINCIPAL_AND_INTEREST: "equal_payment",
  EQUAL_PRINCIPAL: "equal_principal",
  BULLET: "bullet",
  FIXED_MONTHLY_PAYMENT_VARIABLE_PRINCIPAL: "fixed_monthly_payment",
  MIXED: "mixed",
  OVERDRAFT: "overdraft",
  PARTIAL_BULLET: "partial_bullet",
  CUSTOMER_DESIGNATED_PRINCIPAL: "customer_designated_principal",
  FIXED_INSTALLMENT: "fixed_installment"
};

const KOREAN_REPAYMENT_MAP = {
  "만기일시상환": "bullet",
  "원금균등할부상환": "equal_principal",
  "원리금균등할부상환": "equal_payment",
  "원리금균등분할상환": "equal_payment",
  "혼합상환 50:50": "mixed",
  "마이너스통장": "overdraft"
};

/**
 * KB/신한 분리형 포맷 → 통합 스키마
 */
export function adaptKbShinhanFormat(dirId, meta, eligibility, rates, limits, discounts, repayment, fees, recommendation, temporaryPolicy) {
  const provider = meta.provider;
  const productName = meta.productName;
  const collateralCategory = meta.collateralCategory || null;

  // 담보 유형 추출
  const collateralTypes = extractCollateralTypes(eligibility, collateralCategory);

  // 채널: KB/신한 분리형은 모두 영업점
  const channel = "BRANCH";

  // 대출 목적
  const purposes = eligibility?.purposes || [];

  // 금리 테이블
  const rateTable = (rates?.rateTable || []).map((entry) => ({
    rateType: entry.rateType,
    baseRate: entry.baseRate,
    additionalRate: entry.additionalRate,
    minimumRate: entry.minimumRate ?? (entry.baseRate + entry.additionalRate - (rates.maximumDiscountRate || entry.maximumDiscountRate || 0)),
    maximumRate: entry.maximumRate ?? (entry.baseRate + entry.additionalRate)
  }));

  const rateNoticeDate = rates?.noticeDate || rates?.rateNoticeDate || meta.generatedAt;
  const maximumDiscountRate = rates?.maximumDiscountRate || discounts?.maximumDiscountRate || 0;

  // 우대금리 그룹
  const discountGroups = buildDiscountGroups(discounts);

  // 상환 방식
  const repaymentTypes = normalizeRepaymentMethods(repayment?.methods || []);

  // 기간 제한
  const termYears = extractTermYears(repayment?.terms || {});

  // 중도상환수수료
  const prepaymentFee = extractPrepaymentFee(fees);

  // 임시한도 정책
  const temporaryPolicyData = temporaryPolicy ? {
    maximumAmount: temporaryPolicy.maximumAmount,
    purpose: temporaryPolicy.purpose,
    effectiveFrom: temporaryPolicy.effectiveFrom,
    status: temporaryPolicy.status,
    higherPriorityRule: temporaryPolicy.higherPriorityRule || null
  } : null;

  return {
    id: dirId,
    name: productName,
    provider,
    category: "general",
    channel,
    isActive: true,
    comparisonEligible: true,
    rateNoticeDate,
    generalMortgage: {
      collateralTypes,
      purposes,
      rateFormula: rates?.formula || "기준금리 + 가산금리 - 우대금리",
      rateTable,
      maximumDiscountRate,
      discountGroups,
      termYears,
      temporaryPolicy: temporaryPolicyData,
      prepaymentFee,
      bankReviewRequired: eligibility?.finalBankReviewRequired || eligibility?.finalApprovalRequired || true,
      individualRateMayDiffer: rates?.individualRateMayDiffer || true
    },
    eligibility: null,
    rates: null,
    discounts: null,
    maxLoanAmount: null,
    repaymentTypes,
    sourceReferences: [],
    recommendation: recommendation || null
  };
}

/**
 * 우리/하나/NH 통합형 포맷 → 통합 스키마
 */
export function adaptWooriHanaNhFormat(dirId, product, rates, discounts, commonRules, fees) {
  const provider = product.bank || commonRules?.bank || inferProviderFromId(dirId);
  const productName = product.productName;

  // 채널 정규화
  const channel = normalizeChannel(product.channel);

  // 담보 유형
  const collateralTypes = extractCollateralTypesFromProduct(product);

  // 대출 목적
  const purposes = product.purposes || [];

  // 금리 테이블 정규화 (우리/하나/NH 각각 다른 포맷)
  const rateTable = normalizeRateTable(rates, product);

  // 비교 가능 여부
  const comparisonEligible = rates?.comparisonEligible !== false && rates?.status !== "stale";
  const rateNoticeDate = rates?.noticeDate || rates?.asOf || rates?.displayPageAsOf || null;

  // 최대 우대금리
  const maximumDiscountRate = product.maximumDiscountRate
    || product.housingMaximumDiscountRate
    || rates?.maximumDiscountRate
    || product.discountRate
    || 0;

  // 우대금리 그룹
  const discountGroups = buildDiscountGroupsFromNhHanaWoori(discounts);

  // 상환 방식
  const repaymentMethods = product.repaymentMethods || (product.repaymentMethod ? [product.repaymentMethod] : []);
  const repaymentTypes = normalizeRepaymentMethods(repaymentMethods);

  // 기간 제한
  const termYears = extractTermYearsFromProduct(product);

  // 중도상환수수료 (공통 규칙에서)
  const prepaymentFee = extractPrepaymentFeeFromCommon(commonRules, fees);

  return {
    id: dirId,
    name: productName,
    provider,
    category: "general",
    channel,
    isActive: true,
    comparisonEligible,
    rateNoticeDate,
    generalMortgage: {
      collateralTypes,
      purposes,
      rateFormula: commonRules?.rateFormula || "기준금리 + 가산금리 - 우대금리",
      rateTable,
      maximumDiscountRate,
      discountGroups,
      termYears,
      temporaryPolicy: null,
      prepaymentFee,
      bankReviewRequired: true,
      individualRateMayDiffer: true,
      fixedPaymentYears: product.fixedPaymentYears || null,
      rateCap: product.rateCap || rates?.rateCap || null
    },
    eligibility: null,
    rates: null,
    discounts: null,
    maxLoanAmount: null,
    repaymentTypes,
    sourceReferences: [],
    recommendation: null
  };
}

// --- Helper functions ---

function extractCollateralTypes(eligibility, collateralCategory) {
  if (eligibility?.collateral?.allowedTypes) return eligibility.collateral.allowedTypes;
  if (collateralCategory === "APARTMENT") return ["아파트"];
  if (collateralCategory === "NON_APARTMENT_HOME") return ["단독주택", "다가구주택", "다세대주택", "연립주택", "주상복합아파트"];
  return ["주택"];
}

function extractCollateralTypesFromProduct(product) {
  if (product.collateralTypes) return product.collateralTypes;
  if (product.collateral?.types) return product.collateral.types;
  if (product.collateral?.allowed) return product.collateral.allowed;
  if (product.collateral?.serviceIncludedTypes) return product.collateral.serviceIncludedTypes;
  return ["주택"];
}

function normalizeChannel(channel) {
  if (!channel) return "BRANCH";
  const lower = channel.toLowerCase();
  if (lower === "mobile" || lower === "mobile_app") return "MOBILE";
  if (lower === "branch") return "BRANCH";
  return channel.toUpperCase();
}

function inferProviderFromId(dirId) {
  if (dirId.includes("hana")) return "하나은행";
  if (dirId.includes("nh-bank") || dirId.includes("nh-mortgage") || dirId.includes("nh-mobile") || dirId.includes("nh-fixed")) return "NH농협은행";
  if (dirId.includes("kb")) return "KB국민은행";
  if (dirId.includes("shinhan")) return "신한은행";
  if (dirId.includes("woori") || dirId.includes("apartment") || dirId.includes("real-estate") || dirId.includes("won-home")) return "우리은행";
  return "";
}

function normalizeRateTable(rates, product) {
  // Standard rateTable format
  if (rates?.rateTable) {
    return rates.rateTable.map((entry) => ({
      rateType: entry.rateType,
      baseRate: entry.baseRate,
      additionalRate: entry.additionalRate,
      minimumRate: entry.minimumRate ?? entry.exampleRate ?? null,
      maximumRate: entry.maximumRate ?? (entry.baseRate + entry.additionalRate)
    }));
  }

  // Hana format: variableRate + mixedRate as separate keys
  if (rates?.variableRate || rates?.mixedRate) {
    const table = [];
    if (rates.variableRate) {
      const v = rates.variableRate;
      table.push({
        rateType: v.rateType || "변동금리",
        baseRate: v.baseRate,
        additionalRate: v.additionalRate,
        minimumRate: v.minimumRate,
        maximumRate: v.maximumRate ?? (v.baseRate + v.additionalRate)
      });
    }
    if (rates.mixedRate) {
      const m = rates.mixedRate;
      table.push({
        rateType: m.rateType || "혼합금리",
        baseRate: m.baseRate,
        additionalRate: m.additionalRate,
        minimumRate: m.minimumRate,
        maximumRate: m.maximumRate ?? (m.baseRate + m.additionalRate)
      });
    }
    return table;
  }

  // NH options format
  if (rates?.options) {
    return rates.options.map((opt) => ({
      rateType: opt.name,
      baseRate: opt.base,
      additionalRate: opt.spread,
      minimumRate: opt.minimum,
      maximumRate: opt.maximum ?? (opt.base + opt.spread)
    }));
  }

  // Stale historical data
  if (rates?.historicalOptions) {
    return rates.historicalOptions.map((opt) => ({
      rateType: opt.name,
      baseRate: opt.base,
      additionalRate: opt.spread,
      minimumRate: opt.minimum,
      maximumRate: opt.maximum ?? (opt.base + opt.spread)
    }));
  }

  return [];
}

function normalizeRepaymentMethods(methods) {
  const result = [];
  for (const m of methods) {
    const mapped = REPAYMENT_METHOD_MAP[m] || KOREAN_REPAYMENT_MAP[m] || m.toLowerCase();
    if (!result.includes(mapped)) result.push(mapped);
  }
  // Ensure at least equal_payment and equal_principal for comparison
  if (!result.includes("equal_payment") && !result.includes("equal_principal")) {
    result.push("equal_payment");
  }
  return result;
}

function extractTermYears(terms) {
  if (!terms) return {};
  return {
    installmentMaximum: terms.installmentYears?.maximum || terms.maximumYears || null,
    capitalAreaMaximum: terms.over40AgeMaximum || null,
    bulletMaximum: terms.bulletYears?.maximum || null,
    graceMaximum: terms.gracePeriod?.maximumYears || null
  };
}

function extractTermYearsFromProduct(product) {
  const t = product.termYears || product.terms || {};
  return {
    installmentMaximum: t.maximum || t.installmentOrMixedMaximumYears || null,
    capitalAreaMaximum: t.capitalAreaMaximum || t.capitalAndRegulatedAreaMaximum || t.capitalAreaHousingMaximum || null,
    bulletMaximum: t.bulletMaximum || t.bulletHouseholdMaximumYears || t.bulletHousingMaximumYears || null,
    graceMaximum: t.graceMaximum || t.graceMaximumYears || t.maximumGraceYears || null,
    minimum: t.minimum || t.minimumYearsExclusive || product.minimumTermYears || null
  };
}

function extractPrepaymentFee(fees) {
  if (!fees?.prepaymentFee) return null;
  const pf = fees.prepaymentFee;
  return {
    baseRate: pf.baseRate || pf.rate || null,
    specialRate: pf.specialRate || null,
    variableRate: pf.variableRate || null,
    mixedRate: pf.mixedRate || null,
    maximumChargeYears: pf.maximumChargeYears || pf.applicableYearsFromOrigination || 3,
    formula: pf.formula || null
  };
}

function extractPrepaymentFeeFromCommon(commonRules, fees) {
  const source = fees?.prepaymentFee || commonRules?.prepaymentFee;
  if (!source) return null;
  return {
    fixedRate: source.fixedRate || source.fixedRateRealEstateSecured || null,
    variableRate: source.variableRate || source.variableRateRealEstateSecured || null,
    mixedRate: source.mixedRate || null,
    maximumChargeYears: source.maximumChargeYears || 3,
    formula: source.formula || null,
    annualFreeRepaymentRatio: source.annualFreeRepaymentRatioOfOriginalPrincipal || null
  };
}

function buildDiscountGroups(discounts) {
  if (!discounts) return [];
  if (discounts.discounts) {
    // KB format: flat list of discounts
    return [{
      name: "거래실적 우대",
      maximum: discounts.performanceLinkedMaximum || discounts.maximumDiscountRate || null,
      items: discounts.discounts.map((d) => ({
        code: d.code,
        rate: d.rate,
        purpose: d.purpose || null
      }))
    }];
  }
  return [];
}

function buildDiscountGroupsFromNhHanaWoori(discounts) {
  if (!discounts) return [];

  // NH format with groups
  if (discounts.groups) {
    return discounts.groups.map((g) => ({
      name: g.name,
      maximum: g.maximum,
      items: g.items.map((item) => ({
        code: item.item,
        rate: item.rate
      }))
    }));
  }

  // Hana format with separate discount categories
  if (discounts.transactionDiscounts) {
    const groups = [];
    groups.push({
      name: "거래실적",
      maximum: discounts.transactionDiscountMaximum || null,
      items: discounts.transactionDiscounts.map((d) => ({ code: d.code, rate: d.rate }))
    });
    if (discounts.childrenDiscounts) {
      groups.push({
        name: "다자녀",
        maximum: discounts.childrenDiscountMaximum || null,
        items: discounts.childrenDiscounts.map((d) => ({ code: d.code, rate: d.rate }))
      });
    }
    if (discounts.socialCareDiscounts) {
      groups.push({
        name: "사회배려",
        maximum: discounts.socialCareMaximum || null,
        items: discounts.socialCareDiscounts.map((d) => ({ code: d.code, rate: d.rate }))
      });
    }
    return groups;
  }

  // NH mobile format with cycle-based discounts
  if (discounts.transactionItems || discounts.policyItems) {
    const groups = [];
    if (discounts.transactionItems) {
      groups.push({
        name: "거래실적",
        maximum: discounts.sixMonthCycle?.transactionMaximum || discounts.fiveYearCycle?.transactionMaximum || null,
        items: discounts.transactionItems.map((d) => ({ code: d.item, rate: d.rate }))
      });
    }
    if (discounts.policyItems) {
      groups.push({
        name: "정책",
        maximum: discounts.sixMonthCycle?.policyMaximum || discounts.fiveYearCycle?.policyMaximum || null,
        items: discounts.policyItems.map((d) => ({ code: d.item, rate: d.rate }))
      });
    }
    return groups;
  }

  return [];
}
