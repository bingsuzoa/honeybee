export const RANGES = {
  marriagePeriod: {
    under7: { minYears: 0, maxYears: 7, label: "7년 이하" },
    over7: { minYears: 7, maxYears: Infinity, label: "7년 초과" }
  },
  combinedIncome: {
    under85: { min: 0, max: 85000000, representative: 70000000, label: "8천5백만원 이하" },
    "85to100": { min: 85000000, max: 100000000, representative: 92000000, label: "8천5백만원 초과 1억원 이하" },
    "100to130": { min: 100000000, max: 130000000, representative: 115000000, label: "1억원 초과 1.3억원 이하" },
    "130to200_dual": { min: 130000000, max: 200000000, representative: 160000000, label: "1.3억원 초과 2억원 이하 (맞벌이)" },
    over130: { min: 130000000, max: Infinity, representative: 150000000, label: "1.3억원 초과 (외벌이)" },
    over200: { min: 200000000, max: Infinity, representative: 250000000, label: "2억원 초과" }
  },
  netAsset: {
    under511: { min: 0, max: 511000000, representative: 400000000, label: "5.11억원 이하" },
    over511: { min: 511000000, max: Infinity, representative: 520000000, label: "5.11억원 초과" },
    unknown: { min: null, max: null, representative: 0, label: "잘 모르겠어요", isUnknown: true }
  },
  housePrice: {
    under600: { min: 0, max: 600000000, representative: 550000000, label: "6억원 이하" },
    "600to900": { min: 600000000, max: 900000000, representative: 750000000, label: "6억원 초과 9억원 이하" },
    over900: { min: 900000000, max: Infinity, representative: 1000000000, label: "9억원 초과" }
  },
  exclusiveArea: {
    under85: { min: 0, max: 85, representative: 75, label: "85m2 이하" },
    over85: { min: 85, max: Infinity, representative: 90, label: "85m2 초과" }
  },
  requestedLoanAmount: {
    under320: { min: 0, max: 320000000, representative: 300000000, label: "3.2억원 이하" },
    "320to360": { min: 320000000, max: 360000000, representative: 340000000, label: "3.2억원 초과 3.6억원 이하" },
    "360to400": { min: 360000000, max: 400000000, representative: 380000000, label: "3.6억원 초과 4억원 이하" },
    over400: { min: 400000000, max: Infinity, representative: 450000000, label: "4억원 초과" }
  },
  subscriptionYears: {
    under5: { min: 0, max: 5, representative: 3, label: "5년 미만" },
    "5to10": { min: 5, max: 10, representative: 7, label: "5년~10년" },
    "10to15": { min: 10, max: 15, representative: 12, label: "10년~15년" },
    over15: { min: 15, max: Infinity, representative: 17, label: "15년 이상" }
  },
  subscriptionPaymentCount: {
    under60: { min: 0, max: 60, representative: 30, label: "60회 미만" },
    "60to120": { min: 60, max: 120, representative: 80, label: "60회 이상" },
    "120to180": { min: 120, max: 180, representative: 150, label: "120회 이상" },
    over180: { min: 180, max: Infinity, representative: 200, label: "180회 이상" }
  }
};

function deriveSubscriptionStatus(selections) {
  if (selections.acquisitionType === "PRIVATE_PRESALE_WINNER" ||
      selections.acquisitionType === "PUBLIC_PRESALE_WINNER") {
    return "WON_AND_CLOSED";
  }
  if (selections.acquisitionType === "GENERAL_PURCHASE" &&
      selections.hasHousingSubscription === "yes") {
    return "ACTIVE";
  }
  return "NONE";
}

export function normalizeSelections(selections) {
  const marriagePeriodRange = RANGES.marriagePeriod[selections.marriagePeriod];
  const combinedIncomeRange = RANGES.combinedIncome[selections.combinedIncome];
  const netAssetRange = RANGES.netAsset[selections.netAsset];
  const housePriceRange = RANGES.housePrice[selections.housePrice];
  const exclusiveAreaRange = RANGES.exclusiveArea[selections.exclusiveArea];
  const requestedLoanAmountRange = RANGES.requestedLoanAmount[selections.requestedLoanAmount];
  const subscriptionYearsRange = RANGES.subscriptionYears[selections.subscriptionYears] || null;
  const subscriptionPaymentCountRange = RANGES.subscriptionPaymentCount[selections.subscriptionPaymentCount] || null;

  return {
    isMarried: selections.maritalStatus === "married",
    maritalStatus: selections.maritalStatus,
    marriageDate: null,
    marriagePeriodRange,
    isNoHousehold: selections.housingStatus === "none",
    housingStatus: selections.housingStatus,
    householdNoHouseConfirmed: selections.householdNoHouseConfirmed,
    isFirstHomeBuyer: selections.firstHomeBuyer === "yes",
    firstHomeBuyerStatus: selections.firstHomeBuyer,
    childrenCount: Number(selections.childrenCount),
    isExpectingChild: false,
    hasNewborn: selections.hasNewborn === "yes",
    isDualIncome: selections.combinedIncome === "130to200_dual",
    combinedIncome: combinedIncomeRange.representative,
    combinedIncomeRange,
    netAsset: netAssetRange.representative,
    netAssetRange,
    netAssetStatus: selections.netAsset,
    housePrice: housePriceRange.representative,
    housePriceRange,
    region: selections.region,
    exclusiveArea: exclusiveAreaRange.representative,
    exclusiveAreaRange,
    isPrivateSale: selections.privateSale === "yes",
    privateSaleStatus: selections.privateSale,
    requestedLoanAmount: requestedLoanAmountRange.representative,
    requestedLoanAmountRange,
    loanTermYears: Number(selections.loanTermYears),
    plansEarlyRepayment: false,
    purchasePurpose: selections.purchasePurpose,
    householdLoanStatus: selections.householdLoanStatus,
    contractAndMoveInStatus: selections.contractAndMoveInStatus,
    houseLegalStatus: selections.houseLegalStatus,
    creditStatus: selections.creditStatus,
    acquisitionType: selections.acquisitionType || "GENERAL_PURCHASE",
    subscriptionStatus: deriveSubscriptionStatus(selections),
    subscriptionYears: subscriptionYearsRange?.representative ?? 0,
    subscriptionPaymentCount: subscriptionPaymentCountRange?.representative ?? 0,
    hasHousingSubscription: deriveSubscriptionStatus(selections) !== "NONE",
    usesElectronicContract: selections.usesElectronicContract === "yes",
    isLegacyContract: selections.contractDate === "before2025_06_27",
    precisionLevel: "estimated",

    // Phase 2 일반 주담대 추가 입력
    housingType: selections.housingType || null, // apartment, non_apartment, unknown
    detailedPurpose: deriveDetailedPurpose(selections),
    preferredChannel: selections.preferredChannel || "any", // mobile, branch, any
    preferredRateType: "any", // 자동 최적 금리 비교 (질문 제거됨)
    existingAnnualRepayment: deriveExistingRepayment(selections),
    creditScoreRange: deriveCreditScoreRange(selections),
    plansEarlyRepaymentWithin3Years: selections.earlyRepaymentPlan === "within_3_years",
    regulationZone: selections.regulationZone || "unknown", // SPECULATION_OVERHEATED, ADJUSTMENT_TARGET, NON_REGULATED, unknown
    salaryTransferBank: selections.salaryTransferBank || null, // KB, HANA, NH, none
    bankTransactionLevel: selections.bankTransactionLevel || null, // primary, card_only, salary_only
    socialCareStatus: selections.socialCareStatus || null // none, eligible, farmer
  };
}

function deriveDetailedPurpose(selections) {
  if (selections.detailedPurpose) return selections.detailedPurpose;
  if (selections.purchasePurpose === "refinance") return "refinance";
  if (selections.purchasePurpose === "purchase_live") return "purchase";
  return "unknown";
}

function deriveExistingRepayment(selections) {
  if (!selections.existingRepayment) return 0;
  const map = {
    none: 0,
    unknown: null,
    under12m: 6000000,
    "12mto24m": 18000000,
    "24mto36m": 30000000,
    over36m: 42000000
  };
  return map[selections.existingRepayment] ?? 0;
}

function deriveCreditScoreRange(selections) {
  if (!selections.creditScore) return null;
  const map = {
    "900plus": { min: 900, max: 1000, label: "900점 이상" },
    "800to899": { min: 800, max: 899, label: "800~899점" },
    "700to799": { min: 700, max: 799, label: "700~799점" },
    under700: { min: 0, max: 699, label: "700점 미만" },
    unknown: null
  };
  return map[selections.creditScore] ?? null;
}
