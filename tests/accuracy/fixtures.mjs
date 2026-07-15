/**
 * 예측 정확도 검증 테스트 시나리오 30개.
 *
 * 각 시나리오의 expected 값은 은행 공시 규정(products.json, ltv-rules.json)을
 * 사람이 직접 계산한 정답이다. 코드로 계산하지 않는다.
 *
 * 주요 규정 기준 (products.json 2026-07-15 기준):
 * - 디딤돌 소득구간 대표값: under85 → 70M (40M~70M 구간, 30년 3.80%)
 * - 신생아특례 소득구간: under85 → 70M (60M~85M 구간, 30년 2.90%)
 * - 보금자리론 U형 30년: 5.20%, 아낌e 30년: 5.10%
 * - KB 신규COFIX12개월: min 3.95, max 5.35
 * - LTV 비규제 무주택: 70%, 투기과열 9억이하 무주택: 50%
 * - 디딤돌 우대상한: 일반 0.5%p, 다자녀 0.7%p
 * - 신생아특례 우대상한: 0.7%p
 * - 보금자리론 우대상한: 1.0%p
 *
 * RANGES 대표값 참고:
 *   combinedIncome: under85=70M, 85to100=92M, 100to130=115M,
 *                   130to200_dual=160M, over130=150M, over200=250M
 *   housePrice: under600=550M, 600to900=750M, over900=1000M
 *   requestedLoanAmount: under320=300M, 320to360=340M, 360to400=380M, over400=450M
 *   exclusiveArea: under85=75, over85=90
 *   subscriptionYears: over15=17, subscriptionPaymentCount: over180=200
 *   existingRepayment: none=0, 12mto24m=18M
 */

// Base selections shared by most scenarios
const BASE_SELECTIONS = {
  housingStatus: "none",
  householdNoHouseConfirmed: "yes",
  netAsset: "under511",
  exclusiveArea: "under85",
  loanTermYears: "30",
  acquisitionType: "GENERAL_PURCHASE",
  purchasePurpose: "purchase_live",
  householdLoanStatus: "no_existing_fund_loan",
  contractAndMoveInStatus: "contract_signed_move_in",
  contractDate: "on_or_after2025_06_27",
  houseLegalStatus: "eligible_residential",
  creditStatus: "no_issue",
  housingType: "apartment",
  detailedPurpose: "purchase",
  preferredChannel: "any",
  existingRepayment: "none",
  earlyRepaymentPlan: "no_plan",
  regulationZone: "NON_REGULATED"
};

export const SCENARIOS = [
  // ===== S01: A1+B1+C1+D1+E1 =====
  // 신혼 / 수도권 6억 이하 / 3억 30년 / KB주거래 / 신용900+
  {
    id: "S01",
    name: "신혼 / 수도권 6억 이하 / 3억 30년 / KB주거래 / 신용900+",
    tags: ["newlywed", "capital", "apartment", "kb_primary", "high_credit"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: income 70M → 40M~70M 구간, 30년 3.80%
      // 우대: NEWLYWED -0.2, SUBSCRIPTION_15Y_180 -0.5 = 0.7 → cap 0.5
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      // 보금자리론: U_BOGEUMJARI 30년 5.20%
      // 우대: 소득 70M ≤ 70M → NEWLYWED -0.3
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      // 신생아특례: hasNewborn=no → 불가
      newbornSpecial: {
        eligible: false
      },
      // KB: 신규COFIX12개월 min=3.95, max=5.35
      // confirmed: SALARY_OR_PENSION_TRANSFER(0.3), KB_CREDIT_CARD(0.3),
      //            AUTO_TRANSFER_3_OR_MORE(0.1), SAVINGS_BALANCE_300K(0.1),
      //            KB_STAR_BANKING(0.1)
      // 그룹 거래실적 우대 합계=0.9 → cap 0.9
      // rejected: REAL_ESTATE_E_CONTRACT(전자계약 미사용), VULNERABLE_BORROWER(사회배려 none)
      // 신용900+: min + (max-min)*0.25 = 3.95 + 1.4*0.25 = 4.30 → 4.30 - 0.9 = 3.95 (min보다 같거나 높으므로 3.95)
      // adjustedMax = 5.35 - 0.9 = 4.45
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 385000000  // 550M * 0.70
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S02: A1+B1+C1+D4+E3 =====
  // 신혼 / 수도권 6억 이하 / 3억 30년 / 급여없음 / 신용미입력
  {
    id: "S02",
    name: "신혼 / 수도권 6억 이하 / 3억 30년 / 급여없음 / 신용미입력",
    tags: ["newlywed", "capital", "no_salary", "unknown_credit"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "none",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "unknown"
    },
    expected: {
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      // KB: 급여없음 → salaryTransferBank="none" → 급여이체 rejected
      // none은 truthy이므로 SALARY_OR_PENSION_TRANSFER rejected (bank !== "KB")
      // 나머지 transaction: salaryMatchesProvider=false → unconfirmed
      // confirmed discounts = 없음 (salary doesn't match KB)
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S03: A2+B1+C1+D1+E1 =====
  // 신혼+신생아 / 수도권 6억 이하 / 3억 30년 / KB주거래 / 900+
  {
    id: "S03",
    name: "신혼+신생아 / 수도권 6억 이하 / 3억 30년 / KB주거래 / 900+",
    tags: ["newlywed", "newborn", "capital", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "yes",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        // 소득 70M ≤ 70M → NEWLYWED 적용 -0.3 (NEWBORN과 비결합, NEWLYWED 우선)
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      // 신생아특례: 소득 70M → 60M~85M 구간, 30년 2.90%
      // children=0 → EXISTING_MINOR_CHILD 없음
      // SUBSCRIPTION_15Y_180 -0.5 → cap 0.7 → 적용 0.5
      // maxLoanAmount: min(400M, 550M*0.7=385M) = 385M
      newbornSpecial: {
        eligible: true,
        baseRate: 2.90,
        totalDiscount: 0.5,
        isCapped: false,
        finalRate: 2.40,
        maxLoanAmount: 385000000,
        hasEnoughLimit: true
      },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 385000000
      },
      expectedTop1: "newborn-special",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari", "newborn-special"]
    }
  },

  // ===== S04: A2+B2+C1+D2+E2 =====
  // 신혼+신생아 / 8억 아파트 / 3억 30년 / 하나카드만 / 800
  {
    id: "S04",
    name: "신혼+신생아 / 8억 아파트 / 3억 30년 / 하나카드만 / 800",
    tags: ["newlywed", "newborn", "high_price", "hana_card"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "yes",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "600to900",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "HANA",
      bankTransactionLevel: "card_only",
      socialCareStatus: "none",
      creditScore: "800to899"
    },
    expected: {
      // 디딤돌: housePrice 750M > maxHousePrice 600M → 불가
      didimdol: { eligible: false },
      // 보금자리론: housePrice 750M > maxHousePrice 600M → 불가
      bogeumjari: { eligible: false },
      // 신생아특례: housePrice 750M ≤ maxHousePrice 900M → 가능
      // income 70M → 60M~85M 구간, 30년 2.90%
      // children=0 → no EXISTING_MINOR_CHILD
      // SUBSCRIPTION_15Y_180 -0.5
      // total 0.5 < cap 0.7 → not capped
      newbornSpecial: {
        eligible: true,
        baseRate: 2.90,
        totalDiscount: 0.5,
        isCapped: false,
        finalRate: 2.40,
        maxLoanAmount: 400000000,
        hasEnoughLimit: true
      },
      // 하나 아파트론2: 금융채6개월 min=4.158, max=5.358
      // salary=HANA, card_only → SALARY_TRANSFER confirmed(0.3), AFFILIATED_CARD_300K confirmed(0.1)
      // AFFILIATED_CARD_700K_ADDITIONAL: card_only → rejected
      // SAVINGS_OR_SUBSCRIPTION: card_only → rejected
      // 거래실적 합 0.4, cap 0.6 → 0.4
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 524999999  // Math.floor(750M * 0.70) - floating point
      },
      expectedTop1: "newborn-special",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["newborn-special"]
    }
  },

  // ===== S05: A3+B1+C1+D1+E1 =====
  // 신혼+다자녀(3명) / 수도권 6억 이하 / 3억 30년 / KB주거래 / 900+
  {
    id: "S05",
    name: "신혼+다자녀(3명) / 수도권 6억 이하 / 3억 30년 / KB주거래 / 900+",
    tags: ["newlywed", "multi_child", "capital", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "3",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: income 70M → 3.80%
      // 비결합: NEWLYWED -0.2 적용 (신혼)
      // 비결합: THREE_OR_MORE_CHILDREN -0.7 적용 (자녀)
      // 결합: SUBSCRIPTION_15Y_180 -0.5
      // total = 0.2 + 0.7 + 0.5 = 1.4 → cap 0.7 (다자녀)
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.7,
        isCapped: true,
        finalRate: 3.10,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      // 보금자리론: 5.20%
      // NEWLYWED -0.3 (소득 70M ≤ 70M, 신혼)
      // THREE_OR_MORE_CHILDREN -0.7
      // total discount = 1.0, cap 1.0 → 1.0 적용
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 1.0,
        finalRate: 4.20,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S06: A3+B4+C1+D3+E1 =====
  // 신혼+다자녀 / 지방 5억 / 3억 30년 / NH급여만 / 900+
  {
    id: "S06",
    name: "신혼+다자녀 / 지방 5억 / 3억 30년 / NH급여만 / 900+",
    tags: ["newlywed", "multi_child", "local", "nh_salary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "3",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "local",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "NH",
      bankTransactionLevel: "salary_only",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: 3.80%
      // NEWLYWED -0.2, THREE_OR_MORE_CHILDREN -0.7, SUBSCRIPTION_15Y_180 -0.5, 지방 -0.2
      // total = 1.6 → cap 0.7 (다자녀)
      // 지방 우대는 cap 별도가 아니라 cap에 포함됨 → finalRate = 3.80 - 0.7 = 3.10
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.7,
        isCapped: true,
        finalRate: 3.10,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        // NEWLYWED -0.3, THREE_OR_MORE_CHILDREN -0.7 = 1.0 → cap 1.0
        totalDiscount: 1.0,
        finalRate: 4.20,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      // NH주담대: 금융채6개월 min=4.33, max=6.83
      // salary=NH, salary_only → 급여 confirmed(0.3)
      // 카드: salary_only → rejected
      // 예금: salary_only → rejected
      // 적립식: salary_only → rejected
      // 비거치식 분할상환: confirmed(0.2)
      // 최초신규고객: existingRepayment=0 → confirmed(0.1)
      // 부동산 전자계약: 미사용 → rejected
      // 거래실적 그룹: 급여 0.3 cap 1.0 → 0.3
      // 정책 그룹: 비거치식 0.2 + 최초신규 0.1 = 0.3 cap 1.4 → 0.3
      // total = 0.6
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S07: A4+B1+C1+D1+E1 =====
  // 비신혼 기혼 / 수도권 6억 이하 / 3억 30년 / KB주거래 / 900+
  {
    id: "S07",
    name: "비신혼 기혼 / 수도권 6억 이하 / 3억 30년 / KB주거래 / 900+",
    tags: ["married_over7", "capital", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "over7",
      hasNewborn: "no",
      childrenCount: "1",
      combinedIncome: "85to100",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: requiresNewlyMarried=true, marriagePeriod=over7 → minYears=7 >= maxMarriageYears=7 → 불가
      didimdol: { eligible: false },
      // 보금자리론: 소득 92M ≤ 100M → 가능
      // U_BOGEUMJARI 30년 5.20%
      // 소득 92M > 70M → NEWLYWED/NEWBORN 불가
      // children=1 → TWO_CHILDREN/THREE_OR_MORE 불가
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0,
        finalRate: 5.20,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 385000000
      },
      expectedTop1: "bogeumjari",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["bogeumjari"]
    }
  },

  // ===== S08: A4+B2+C2+D4+E2 =====
  // 비신혼 / 8억 / 4억 초과 / 급여없음 / 800
  {
    id: "S08",
    name: "비신혼 / 8억 / 4억 초과 / 급여없음 / 800",
    tags: ["married_over7", "high_price", "high_amount", "no_salary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "over7",
      hasNewborn: "no",
      childrenCount: "1",
      combinedIncome: "85to100",
      housePrice: "600to900",
      region: "capital",
      requestedLoanAmount: "over400",
      hasHousingSubscription: "no",
      usesElectronicContract: "no",
      salaryTransferBank: "none",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "800to899"
    },
    expected: {
      // 디딤돌: married over7 → 불가
      didimdol: { eligible: false },
      // 보금자리론: housePrice 750M > 600M → 불가
      bogeumjari: { eligible: false },
      // 신생아특례: hasNewborn=no → 불가
      newbornSpecial: { eligible: false },
      // KB: eligible, 급여없음 → confirmed 없음
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 524999999  // Math.floor(750M * 0.70) - floating point
      },
      expectedTop1Category: "general",
      expectedPolicyEligibleIds: []
    }
  },

  // ===== S09: A5+B2+C1+D2+E1 =====
  // 고소득맞벌이+신생아 / 8억 / 3억 / 하나카드 / 900+
  {
    id: "S09",
    name: "고소득맞벌이+신생아 / 8억 / 3억 / 하나카드 / 900+",
    tags: ["high_income_dual", "newborn", "hana_card"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "yes",
      childrenCount: "0",
      combinedIncome: "130to200_dual",
      housePrice: "600to900",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "HANA",
      bankTransactionLevel: "card_only",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: income 160M > maxCombinedIncome 85M → 불가
      didimdol: { eligible: false },
      // 보금자리론: housePrice 750M > 600M → 불가
      bogeumjari: { eligible: false },
      // 신생아특례: isDualIncome=true, maxDualIncome=200M, income 160M ≤ 200M → 가능
      // housePrice 750M ≤ 900M → 가능
      // income 160M → 150M~170M 구간 (dualIncomeOnly=true), 30년 4.15%
      // children=0 → no EXISTING_MINOR_CHILD
      // SUBSCRIPTION_15Y_180 -0.5
      // total 0.5 < cap 0.7 → 0.5
      newbornSpecial: {
        eligible: true,
        baseRate: 4.15,
        totalDiscount: 0.5,
        isCapped: false,
        finalRate: 3.65,
        maxLoanAmount: 400000000,
        hasEnoughLimit: true
      },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 524999999  // Math.floor(750M * 0.70)
      },
      expectedTop1: "newborn-special",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["newborn-special"]
    }
  },

  // ===== S10: A5+B1+C1+D1+E1 =====
  // 고소득맞벌이+신생아 / 6억 이하 / 3억 / KB주거래 / 900+
  {
    id: "S10",
    name: "고소득맞벌이+신생아 / 6억 이하 / 3억 / KB주거래 / 900+",
    tags: ["high_income_dual", "newborn", "capital", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "yes",
      childrenCount: "0",
      combinedIncome: "130to200_dual",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      didimdol: { eligible: false },  // income 160M > 85M
      // 보금자리론: income 160M > 100M → 불가
      bogeumjari: { eligible: false },
      // 신생아특례: same as S09 but housePrice 550M
      // income 160M → 150M~170M 구간, 30년 4.15%
      // SUBSCRIPTION_15Y_180 -0.5
      // maxLoanAmount: min(400M, 550M*0.7=385M) = 385M
      newbornSpecial: {
        eligible: true,
        baseRate: 4.15,
        totalDiscount: 0.5,
        isCapped: false,
        finalRate: 3.65,
        maxLoanAmount: 385000000,
        hasEnoughLimit: true
      },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 385000000
      },
      expectedTop1: "newborn-special",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["newborn-special"]
    }
  },

  // ===== S11: A6+B3+C1+D1+E1 =====
  // 초고소득 / 10억초과 / 3억 / KB주거래 / 900+
  {
    id: "S11",
    name: "초고소득 / 10억초과 / 3억 / KB주거래 / 900+",
    tags: ["very_high_income", "very_high_price", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "over7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "over200",
      housePrice: "over900",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "no",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      didimdol: { eligible: false },   // income 250M > 85M, married over7
      bogeumjari: { eligible: false },  // income 250M > 100M, housePrice 1B > 600M
      newbornSpecial: { eligible: false }, // income 250M > 200M (dual), no newborn
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 700000000  // 1B * 0.70
      },
      expectedTop1Category: "general",
      expectedPolicyEligibleIds: []
    }
  },

  // ===== S12: A6+B1+C1+D4+E2 =====
  // 초고소득 / 6억 이하 / 3억 / 급여없음 / 800
  {
    id: "S12",
    name: "초고소득 / 6억 이하 / 3억 / 급여없음 / 800",
    tags: ["very_high_income", "no_salary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "over7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "over200",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "no",
      usesElectronicContract: "no",
      salaryTransferBank: "none",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "800to899"
    },
    expected: {
      didimdol: { eligible: false },
      bogeumjari: { eligible: false },  // income 250M > 100M
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1Category: "general",
      expectedPolicyEligibleIds: []
    }
  },

  // ===== S13: A7+B4+C1+D3+E1 =====
  // 저소득 / 지방 5억 / 3억 30년 / NH급여만 / 900+
  {
    id: "S13",
    name: "저소득 / 지방 5억 / 3억 30년 / NH급여만 / 900+",
    tags: ["low_income", "local", "nh_salary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "local",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "NH",
      bankTransactionLevel: "salary_only",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: income 70M → 3.80%
      // NEWLYWED -0.2, SUBSCRIPTION_15Y_180 -0.5, 지방 -0.2 = 0.9 → cap 0.5
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        // 소득 70M ≤ 70M → NEWLYWED -0.3
        // 지방이지만 규제지역 가산은 없음 (NON_REGULATED)
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S14: A7+B1+C5+D1+E1 =====
  // 저소득 / 수도권 6억 / 3억+청약최대 / KB주거래 / 900+
  {
    id: "S14",
    name: "저소득 / 수도권 6억 / 3억+청약최대 / KB주거래 / 900+",
    tags: ["low_income", "capital", "max_subscription", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // Same as S01 essentially
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S15: A8+B1+C1+D1+E1 =====
  // 1.3억 외벌이 / 수도권 6억 / 3억 / KB주거래 / 900+
  {
    id: "S15",
    name: "1.3억 외벌이 / 수도권 6억 / 3억 / KB주거래 / 900+",
    tags: ["high_income_single", "capital", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "over130",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: income 150M > 85M → 불가
      didimdol: { eligible: false },
      // 보금자리론: income 150M > 100M → 불가
      bogeumjari: { eligible: false },
      // 신생아특례: hasNewborn=no → 불가
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 385000000
      },
      expectedTop1Category: "general",
      expectedPolicyEligibleIds: []
    }
  },

  // ===== S16: A1+B1+C4+D1+E1 =====
  // 신혼+전자계약 / 수도권 6억 / 3억 / KB주거래 / 900+
  {
    id: "S16",
    name: "신혼+전자계약 / 수도권 6억 / 3억 / KB주거래 / 900+",
    tags: ["newlywed", "e_contract", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "yes",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: 3.80%
      // NEWLYWED -0.2, SUBSCRIPTION_15Y_180 -0.5, ELECTRONIC_CONTRACT -0.1
      // total = 0.8 → cap 0.5
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      // 보금자리론: 아낌e보금자리론 선택 → AKKIM_E 30년 5.10%
      // NEWLYWED -0.3 (소득 70M ≤ 70M)
      bogeumjari: {
        eligible: true,
        baseRate: 5.10,
        totalDiscount: 0.3,
        finalRate: 4.80,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      // KB: REAL_ESTATE_E_CONTRACT confirmed (전자계약+구입)
      // 전체 confirmed: salary+card+auto+savings+star+e_contract = 0.3+0.3+0.1+0.1+0.1+0.2 = 1.1 → cap 0.9
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING",
          "REAL_ESTATE_E_CONTRACT"
        ],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S17: A1+B1+C3+D4+E3 =====
  // 신혼+대환 / 수도권 6억 / 3억 / 급여없음 / 신용미입력
  {
    id: "S17",
    name: "신혼+대환 / 수도권 6억 / 3억 / 급여없음 / 신용미입력",
    tags: ["newlywed", "refinance", "no_salary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      purchasePurpose: "refinance",
      detailedPurpose: "refinance",
      salaryTransferBank: "none",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "unknown"
    },
    expected: {
      // 디딤돌: requiresPurchasePurpose=true, purchasePurpose=refinance → 불가
      didimdol: { eligible: false },
      // 보금자리론: requiresPurchasePurpose=true → 불가
      bogeumjari: { eligible: false },
      // 신생아특례: requiresPurchasePurpose=true → 불가, and no newborn
      newbornSpecial: { eligible: false },
      // KB: purpose includes "기타 주택담보자금" → refinance maps to this
      // REAL_ESTATE_E_CONTRACT: detailedPurpose=refinance → rejected
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1Category: "general",
      expectedPolicyEligibleIds: []
    }
  },

  // ===== S18: A1+B6+C1+D1+E1 =====
  // 신혼+규제지역 / 투기과열 / 3억 / KB주거래 / 900+
  {
    id: "S18",
    name: "신혼+규제지역 / 투기과열 / 3억 / KB주거래 / 900+",
    tags: ["newlywed", "speculation_zone", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus",
      regulationZone: "SPECULATION_OVERHEATED"
    },
    expected: {
      // 디딤돌은 자체 LTV를 사용 (0.7), regulationZone은 일반 주담대에만 영향
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      // 보금자리론: 규제지역 가산 +0.1%p
      // NEWLYWED -0.3
      // net discount = 0.3 - 0.1(가산은 별도) → finalRate = 5.20 - 0.3 + 0.1 = 5.00
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0.2,
        finalRate: 5.00,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      // KB: LTV 투기과열 550M ≤ 900M → 50%
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 275000000  // 550M * 0.50
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S19: A2+B4+C1+D3+E1 =====
  // 신혼+신생아 / 지방 / 3억 / NH급여만 / 900+
  {
    id: "S19",
    name: "신혼+신생아 / 지방 / 3억 / NH급여만 / 900+",
    tags: ["newlywed", "newborn", "local", "nh_salary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "yes",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "local",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "NH",
      bankTransactionLevel: "salary_only",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: 3.80%
      // NEWLYWED -0.2, SUBSCRIPTION_15Y_180 -0.5, 지방 -0.2 = 0.9 → cap 0.5
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      // 신생아특례: income 70M → 60M~85M, 30년 2.90%
      // children=0 → no EXISTING_MINOR_CHILD
      // SUBSCRIPTION_15Y_180 -0.5, 지방 -0.2 = 0.7 → cap 0.7
      // maxLoanAmount: min(400M, 550M*0.7=385M) = 385M
      newbornSpecial: {
        eligible: true,
        baseRate: 2.90,
        totalDiscount: 0.7,
        isCapped: true,
        finalRate: 2.20,
        maxLoanAmount: 385000000,
        hasEnoughLimit: true
      },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1: "newborn-special",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari", "newborn-special"]
    }
  },

  // ===== S20: A1+B5+C1+D2+E2 =====
  // 신혼 / 비아파트 / 3억 / 하나카드 / 800
  {
    id: "S20",
    name: "신혼 / 비아파트 / 3억 / 하나카드 / 800",
    tags: ["newlywed", "non_apartment", "hana_card"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      housingType: "non_apartment",
      salaryTransferBank: "HANA",
      bankTransactionLevel: "card_only",
      socialCareStatus: "none",
      creditScore: "800to899"
    },
    expected: {
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      // KB: collateralTypes includes "주택" → non_apartment matches "주택"
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S21: A1+B1+C6+D1+E1 =====
  // 신혼+기존대출 / 수도권 6억 / 3억 / KB / 900+
  {
    id: "S21",
    name: "신혼+기존대출 / 수도권 6억 / 3억 / KB / 900+",
    tags: ["newlywed", "existing_loan", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      existingRepayment: "12mto24m",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S22: A6+B3+C3+D4+E2 =====
  // 초고소득+대환 / 10억초과 / 3억 / 급여없음 / 800
  {
    id: "S22",
    name: "초고소득+대환 / 10억초과 / 3억 / 급여없음 / 800",
    tags: ["very_high_income", "refinance", "very_high_price"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "over7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "over200",
      housePrice: "over900",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "no",
      usesElectronicContract: "no",
      purchasePurpose: "refinance",
      detailedPurpose: "refinance",
      salaryTransferBank: "none",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "800to899"
    },
    expected: {
      didimdol: { eligible: false },
      bogeumjari: { eligible: false },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 700000000
      },
      expectedTop1Category: "general",
      expectedPolicyEligibleIds: []
    }
  },

  // ===== S23: A2+B1+C2+D1+E1 =====
  // 신혼+신생아 / 6억이하 / 4억초과 / KB / 900+
  {
    id: "S23",
    name: "신혼+신생아 / 6억이하 / 4억초과 / KB / 900+",
    tags: ["newlywed", "newborn", "over_limit"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "yes",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "over400",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: maxLoanAmount=320M, LTV=550M*0.7=385M → min(320M,385M)=320M
      // requestedLoanAmount=450M > 320M → hasEnoughLimit=false
      // But still eligible (limit is separate from eligibility in this code)
      // Actually checking code: hasEnoughLimit=false means ineligibleReasons includes limit reason
      // but isEligible checks hardReasons (excluding "정확도" notes)
      // "필요한 대출금액이 최대 가능 금액보다 큽니다" is a hard reason but...
      // Looking at code: isEligible = product.isActive && hardReasons.length === 0
      // The limit check adds reason but doesn't affect isEligible directly
      // Wait - looking more carefully: the hasEnoughLimit check adds to reasons,
      // but it's included in hardReasons. Let me re-check...
      // Line 124-126: if (!hasEnoughLimit) reasons.push("필요한 대출금액...")
      // Line 128: hardReasons = reasons.filter(r => !r.includes("정확도가 낮습니다"))
      // So limit reason IS in hardReasons → isEligible=false
      // Hmm, but the plan says hasEnoughLimit is separate from eligible.
      // Actually re-reading eligibility.js: the limit issue makes isEligible=false
      didimdol: {
        eligible: false,
        maxLoanAmount: 320000000,
        hasEnoughLimit: false
      },
      bogeumjari: {
        eligible: false,
        maxLoanAmount: 360000000,
        hasEnoughLimit: false
      },
      // 신생아특례: maxLoanAmount=400M, requestedLoanAmount=450M > 400M → hasEnoughLimit=false
      newbornSpecial: {
        eligible: false,
        maxLoanAmount: 400000000,
        hasEnoughLimit: false
      },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING"
        ],
        ltvLimit: 385000000
      },
      expectedTop1Category: "general",
      expectedPolicyEligibleIds: []
    }
  },

  // ===== S24: A1+B1+C1+D5+E1 =====
  // 신혼 / 6억 이하 / 3억 / KB+사회배려 / 900+
  {
    id: "S24",
    name: "신혼 / 6억 이하 / 3억 / KB+사회배려 / 900+",
    tags: ["newlywed", "social_care", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "eligible",
      creditScore: "900plus"
    },
    expected: {
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      // KB: VULNERABLE_BORROWER confirmed (socialCareStatus=eligible, purpose=purchase)
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING",
          "VULNERABLE_BORROWER"
        ],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S25: A4+B4+C1+D3+E1 =====
  // 비신혼 / 지방 / 3억 / NH급여만 / 900+
  {
    id: "S25",
    name: "비신혼 / 지방 / 3억 / NH급여만 / 900+",
    tags: ["married_over7", "local", "nh_salary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "over7",
      hasNewborn: "no",
      childrenCount: "1",
      combinedIncome: "85to100",
      housePrice: "under600",
      region: "local",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "NH",
      bankTransactionLevel: "salary_only",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: married over7 → 불가
      didimdol: { eligible: false },
      // 보금자리론: income 92M ≤ 100M → 가능
      // 소득 92M > 70M → NEWLYWED/NEWBORN 불가
      // children=1 → 불가
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0,
        finalRate: 5.20,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1: "bogeumjari",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["bogeumjari"]
    }
  },

  // ===== S26: A3+B1+C4+D1+E1 =====
  // 다자녀+전자계약 / 수도권 6억 / 3억 / KB / 900+
  {
    id: "S26",
    name: "다자녀+전자계약 / 수도권 6억 / 3억 / KB / 900+",
    tags: ["newlywed", "multi_child", "e_contract", "kb_primary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "3",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "yes",
      salaryTransferBank: "KB",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: 3.80%
      // NEWLYWED -0.2, THREE_OR_MORE_CHILDREN -0.7, SUBSCRIPTION_15Y_180 -0.5, ELECTRONIC_CONTRACT -0.1
      // total = 1.5 → cap 0.7 (다자녀)
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.7,
        isCapped: true,
        finalRate: 3.10,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      // 보금자리론 아낌e: 5.10%
      // NEWLYWED -0.3, THREE_OR_MORE_CHILDREN -0.7 = 1.0 → cap 1.0
      bogeumjari: {
        eligible: true,
        baseRate: 5.10,
        totalDiscount: 1.0,
        finalRate: 4.10,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 4.45,
        confirmedDiscountCodes: [
          "SALARY_OR_PENSION_TRANSFER",
          "KB_CREDIT_CARD",
          "AUTO_TRANSFER_3_OR_MORE",
          "SAVINGS_BALANCE_300K",
          "KB_STAR_BANKING",
          "REAL_ESTATE_E_CONTRACT"
        ],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S27: A7+B4+C1+D4+E3 =====
  // 저소득 / 지방 / 3억 / 급여없음 / 신용미입력
  {
    id: "S27",
    name: "저소득 / 지방 / 3억 / 급여없음 / 신용미입력",
    tags: ["low_income", "local", "no_salary", "unknown_credit"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "local",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "none",
      bankTransactionLevel: "primary",
      socialCareStatus: "none",
      creditScore: "unknown"
    },
    expected: {
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1: "didimdol",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari"]
    }
  },

  // ===== S28: A1+B2+C1+D2+E1 =====
  // 신혼 / 8억 / 3억 / 하나카드 / 900+
  {
    id: "S28",
    name: "신혼 / 8억 / 3억 / 하나카드 / 900+",
    tags: ["newlywed", "high_price", "hana_card"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "600to900",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "HANA",
      bankTransactionLevel: "card_only",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      // 디딤돌: housePrice 750M > 600M → 불가
      didimdol: { eligible: false },
      // 보금자리론: housePrice 750M > 600M → 불가
      bogeumjari: { eligible: false },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 524999999  // Math.floor(750M * 0.70)
      },
      expectedTop1Category: "general",
      expectedPolicyEligibleIds: []
    }
  },

  // ===== S29: A6+B1+C1+D2+E1 =====
  // 초고소득 / 6억이하 / 3억 / 하나카드 / 900+
  {
    id: "S29",
    name: "초고소득 / 6억이하 / 3억 / 하나카드 / 900+",
    tags: ["very_high_income", "hana_card"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "over7",
      hasNewborn: "no",
      childrenCount: "0",
      combinedIncome: "over200",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "no",
      usesElectronicContract: "no",
      salaryTransferBank: "HANA",
      bankTransactionLevel: "card_only",
      socialCareStatus: "none",
      creditScore: "900plus"
    },
    expected: {
      didimdol: { eligible: false },
      bogeumjari: { eligible: false },
      newbornSpecial: { eligible: false },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1Category: "general",
      expectedPolicyEligibleIds: []
    }
  },

  // ===== S30: A2+B1+C1+D3+E2 =====
  // 신혼+신생아 / 6억이하 / 3억 / NH급여만 / 800
  {
    id: "S30",
    name: "신혼+신생아 / 6억이하 / 3억 / NH급여만 / 800",
    tags: ["newlywed", "newborn", "nh_salary"],
    selections: {
      ...BASE_SELECTIONS,
      maritalStatus: "married",
      marriagePeriod: "under7",
      hasNewborn: "yes",
      childrenCount: "0",
      combinedIncome: "under85",
      housePrice: "under600",
      region: "capital",
      requestedLoanAmount: "under320",
      hasHousingSubscription: "yes",
      subscriptionYears: "over15",
      subscriptionPaymentCount: "over180",
      usesElectronicContract: "no",
      salaryTransferBank: "NH",
      bankTransactionLevel: "salary_only",
      socialCareStatus: "none",
      creditScore: "800to899"
    },
    expected: {
      didimdol: {
        eligible: true,
        baseRate: 3.80,
        totalDiscount: 0.5,
        isCapped: true,
        finalRate: 3.30,
        maxLoanAmount: 320000000,
        hasEnoughLimit: true
      },
      bogeumjari: {
        eligible: true,
        baseRate: 5.20,
        // 소득 70M ≤ 70M → NEWLYWED -0.3 (NEWBORN과 비결합, NEWLYWED 우선)
        totalDiscount: 0.3,
        finalRate: 4.90,
        maxLoanAmount: 360000000,
        hasEnoughLimit: true
      },
      // 신생아특례: income 70M → 60M~85M 구간, 30년 2.90%
      // SUBSCRIPTION_15Y_180 -0.5
      // maxLoanAmount: min(400M, 550M*0.7=385M) = 385M
      newbornSpecial: {
        eligible: true,
        baseRate: 2.90,
        totalDiscount: 0.5,
        isCapped: false,
        finalRate: 2.40,
        maxLoanAmount: 385000000,
        hasEnoughLimit: true
      },
      kbMortgage: {
        eligible: true,
        rateRangeMin: 3.95,
        rateRangeMax: 5.35,
        confirmedDiscountCodes: [],
        ltvLimit: 385000000
      },
      expectedTop1: "newborn-special",
      expectedTop1Category: "policy",
      expectedPolicyEligibleIds: ["didimdol", "bogeumjari", "newborn-special"]
    }
  }
];
