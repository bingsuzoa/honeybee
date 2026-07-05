import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOAN_DOCUMENTS_DIR = path.resolve(__dirname, "../loan-documents");
const OUTPUT_PATH = path.resolve(__dirname, "../src/data/products.json");

const CATEGORY_MAP = {
  DIDIMDOL: "didimdol",
  NEWBORN_SPECIAL_DIDIMDOL: "didimdol_newborn",
  BOGEUMJARI: "bogeumjari"
};

const REPAYMENT_METHOD_MAP = {
  EQUAL_PRINCIPAL_AND_INTEREST: "equal_payment",
  EQUAL_PRINCIPAL: "equal_principal",
  GRADUATED_PAYMENT: "graduated_payment"
};

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function getBaseRateFromTable(rateTable, income, termYears) {
  if (!rateTable) return null;
  const term = String(termYears);
  for (const tier of rateTable) {
    if (tier.incomeMin !== undefined && tier.incomeMax !== undefined) {
      if (income >= tier.incomeMin && income <= tier.incomeMax) {
        return tier.rates[term] ?? null;
      }
    } else if (tier.productType !== undefined) {
      return tier.rates[term] ?? null;
    }
  }
  return null;
}

function computeRateRange(rates) {
  if (!rates?.baseRateTable) return { minRate: 0, maxRate: 0, defaultRate: 0 };
  const allRates = rates.baseRateTable.flatMap((tier) => Object.values(tier.rates));
  const minRate = Math.min(...allRates);
  const maxRate = Math.max(...allRates);
  const defaultRate = getBaseRateFromTable(rates.baseRateTable, 70000000, 30) ?? (minRate + maxRate) / 2;
  return {
    minRate: Math.round(minRate * 100) / 100,
    maxRate: Math.round(maxRate * 100) / 100,
    defaultRate: Math.round(defaultRate * 100) / 100
  };
}

function extractMaxLoanAmount(limits, category) {
  if (!limits) return 0;
  const amounts = limits.maxLoanAmount;
  if (!amounts) return 0;
  if (typeof amounts === "number") return amounts;
  if (category === "didimdol") return amounts.newlywed || amounts.general || 0;
  return amounts.general || Object.values(amounts).filter((v) => typeof v === "number")[0] || 0;
}

function extractLegacyMaxLoanAmount(limits, category) {
  if (!limits) return null;
  if (category === "didimdol") {
    return limits.legacyContractBefore2025_06_27?.newlywed || null;
  }
  if (category === "didimdol_newborn") {
    return limits.maxLoanAmount?.legacyContractBefore2025_06_27 || null;
  }
  return null;
}

function extractRepaymentTypes(repayment) {
  const methods = repayment?.methods || repayment?.repayment?.methods || [];
  if (!methods.length) return ["equal_payment", "equal_principal", "graduated_payment"];
  return methods.map((m) => REPAYMENT_METHOD_MAP[m] || m.toLowerCase());
}

function extractPrepaymentInfo(fees) {
  if (!fees?.prepaymentFee) return { prepaymentPenalty: "", prepaymentPenaltyLevel: "unknown" };
  const fee = fees.prepaymentFee;
  const hasWaiver = fee.waiver?.some((w) => w.waived);
  const rate = fee.maxRate || 0;
  const years = fee.appliesWithinYears || 0;
  const penalty =
    `중도상환수수료율 ${(rate * 100).toFixed(1)}% (${years}년 이내)` +
    (hasWaiver ? ". 2026.12.31까지 한시 면제." : "");
  return { prepaymentPenalty: penalty, prepaymentPenaltyLevel: hasWaiver ? "low" : "medium" };
}

function buildEligibility(rawEligibility, limits, category) {
  if (!rawEligibility) return {};
  const elig = rawEligibility.eligibilityRules || rawEligibility;
  const homeless = elig.homeless || {};
  const income = elig.incomeLimit || {};
  const asset = elig.assetLimit || {};
  const duplicate = elig.duplicateLoan || {};
  const contract = elig.contract || {};
  const birth = elig.birthOrAdoption || {};

  // House rules may be in eligibility or limits
  const houseRulesFromEligibility = rawEligibility.houseRules || {};
  const houseRulesFromLimits = limits?.houseRules || {};
  const houseFromEligibility = rawEligibility.house || elig.house || {};

  // Income limit
  let maxCombinedIncome = null;
  let maxDualIncome = null;
  if (category === "didimdol") {
    maxCombinedIncome = income.newlywed || income.general || null;
  } else if (category === "didimdol_newborn") {
    maxCombinedIncome = income.generalCombinedIncome || null;
    maxDualIncome = income.dualIncomeCombinedIncome || null;
  } else {
    const vals = Object.values(income).filter((v) => typeof v === "number");
    maxCombinedIncome = vals.length ? Math.max(...vals) : null;
  }

  // Asset limit
  const maxNetAsset = asset.netAssetAmount || null;

  // House price limit
  let maxHousePrice = null;
  if (houseRulesFromLimits.housePriceLimit) {
    maxHousePrice = typeof houseRulesFromLimits.housePriceLimit === "number"
      ? houseRulesFromLimits.housePriceLimit
      : houseRulesFromLimits.housePriceLimit.newlywed || houseRulesFromLimits.housePriceLimit.general || null;
  }
  if (!maxHousePrice && houseRulesFromEligibility.housePriceLimit) {
    maxHousePrice = typeof houseRulesFromEligibility.housePriceLimit === "number"
      ? houseRulesFromEligibility.housePriceLimit
      : houseRulesFromEligibility.housePriceLimit.newlywed || houseRulesFromEligibility.housePriceLimit.general || null;
  }
  if (!maxHousePrice && houseFromEligibility.housePriceLimit) {
    maxHousePrice = houseFromEligibility.housePriceLimit;
  }

  // Exclusive area limit
  let maxExclusiveArea = null;
  const areaSource = houseRulesFromLimits.exclusiveAreaLimitM2 || houseRulesFromEligibility.exclusiveAreaLimitM2 || null;
  if (areaSource) {
    maxExclusiveArea = areaSource.default || null;
  }

  // LTV
  let ltvRatio = 0.7;
  if (limits?.ltvLimit?.general) ltvRatio = limits.ltvLimit.general;
  else if (limits?.ltv?.apartment) ltvRatio = limits.ltv.apartment;

  // Boolean flags
  const requiresNoHouse = homeless.required || homeless.requiredForNewPurchase || false;
  const requiresNewborn = birth.required || false;

  // Marriage requirements (didimdol-specific for newlywed calculator)
  let requiresMarried = false;
  let requiresNewlyMarried = false;
  let maxMarriageYears = null;
  if (category === "didimdol") {
    requiresMarried = true;
    requiresNewlyMarried = true;
    maxMarriageYears = 7;
  }

  return {
    maxHousePrice,
    maxCombinedIncome,
    maxDualIncome: maxDualIncome || null,
    maxNetAsset,
    maxExclusiveArea,
    requiresMarried,
    requiresNewlyMarried,
    maxMarriageYears,
    requiresNewborn,
    requiresNoHouse,
    requiresHouseholdNoHouseConfirmed: requiresNoHouse,
    requiresPurchasePurpose: contract.mustHavePurchaseContract !== false,
    requiresNoExistingFundLoan: duplicate.housingFundLoanNotAllowed || false,
    requiresSaleContract: true,
    requiresMoveInPlan: true,
    requiresEligibleHouseType: true,
    requiresNoCreditIssue: true,
    ltvRatio
  };
}

function loadProductFromDir(dirPath, dirName) {
  const structuredDir = path.join(dirPath, "structured");
  const meta = loadJson(path.join(structuredDir, "meta.json"));
  if (!meta) return null;

  const eligibilityRaw = loadJson(path.join(structuredDir, "eligibility.json"));
  const rates = loadJson(path.join(structuredDir, "rates.json"));
  const limits = loadJson(path.join(structuredDir, "limits.json"));
  const discounts = loadJson(path.join(structuredDir, "discounts.json"));
  const repayment = loadJson(path.join(structuredDir, "repayment.json"));
  const fees = loadJson(path.join(structuredDir, "fees.json"));
  const recommendation = loadJson(path.join(structuredDir, "recommendation.json"));

  const loanType = meta.loanType || meta.sourceSummary?.loanType || dirName.toUpperCase();
  const category = CATEGORY_MAP[loanType] || dirName;
  const name = meta.productName || meta.product?.name || meta.sourceSummary?.productName || dirName;
  const provider = meta.provider || meta.sourceSummary?.provider || meta.product?.operatingInstitution || "";

  const { minRate, maxRate, defaultRate } = computeRateRange(rates);
  const maxLoanAmount = extractMaxLoanAmount(limits, category);
  const legacyMaxLoanAmount = extractLegacyMaxLoanAmount(limits, category);
  const repaymentTypes = extractRepaymentTypes(repayment);
  const { prepaymentPenalty, prepaymentPenaltyLevel } = extractPrepaymentInfo(fees);
  const eligibility = buildEligibility(eligibilityRaw, limits, category);

  return {
    id: dirName,
    name,
    provider,
    category,
    description: meta.product?.purpose || (meta.notes && meta.notes[0]) || `${name} 상품`,
    isActive: true,
    maxLoanAmount,
    legacyMaxLoanAmount,
    minRate,
    maxRate,
    defaultRate,
    repaymentTypes,
    prepaymentPenalty,
    prepaymentPenaltyLevel,
    eligibility,
    rates: rates || null,
    discounts: discounts || null,
    recommendation: recommendation || null,
    fees: fees || null,
    sourceReferences: []
  };
}

function main() {
  const entries = fs.readdirSync(LOAN_DOCUMENTS_DIR, { withFileTypes: true });
  const products = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(LOAN_DOCUMENTS_DIR, entry.name);
    const product = loadProductFromDir(dirPath, entry.name);
    if (product) {
      products.push(product);
      console.log(`  ✓ ${product.id}: ${product.name} (${product.category})`);
    }
  }

  products.sort((a, b) => a.id.localeCompare(b.id));

  const output = { generatedAt: new Date().toISOString(), products };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nGenerated ${products.length} products → ${OUTPUT_PATH}`);
}

main();
