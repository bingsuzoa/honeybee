import { analyzeLoanProducts } from "./domain/loan/analysis.js?v=20260705";
import { normalizeSelections } from "./domain/loan/selection-options.js?v=20260705";
import { loadProducts } from "./data/loan-product-loader.js?v=20260705";
import { loadRagIndex, searchRag } from "./data/rag-loader.js?v=20260705";
import { GAME_MAP, getStepInfo, isEvolution, isReward, getRandomMessage } from "./domain/game-map.js?v=20260705";
import { saveUsageLog } from "./utils/analytics.js?v=20260705";

const questScreen = document.querySelector("#quest-screen");
const headerCharacter = document.querySelector("#header-character");
const itemTrack = document.querySelector("#item-track");
const RAG_QUERY_TERMS = ["대출대상", "대출한도", "대출금리", "금리", "상환", "중도상환", "신혼", "생애최초"];

const ITEMS = [
  { id: "shell", label: "등껍질" },
  { id: "shoes", label: "신발" },
  { id: "hat", label: "모자" },
  { id: "shield", label: "방패" },
  { id: "sword", label: "칼" },
  { id: "cape", label: "망토" }
];

const DEFAULT_SELECTIONS = {
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

const QUESTIONS = [
  {
    title: "혼인신고 후 7년이 지나지 않았나요?",
    subtitle: "✓ 디딤돌대출: 신혼부부 필수 조건 (혼인신고일 기준 7년 이내)\n✓ 보금자리론·신생아 특례·주담대: 혼인 여부 무관",
    item: "shell",
    options: [
      { label: "예, 7년 이하입니다", patch: { maritalStatus: "married", marriagePeriod: "under7" } },
      { label: "아니오, 7년을 초과했습니다", patch: { maritalStatus: "married", marriagePeriod: "over7" } }
    ]
  },
  {
    title: "2023년 1월 1일 이후 출생한 자녀가 있나요?",
    subtitle: "✓ 신생아 특례 디딤돌대출의 필수 조건입니다.\n✓ 대출 신청일 기준 2년 이내 출생아가 있어야 합니다.\n✓ 입양아도 포함됩니다.",
    item: null,
    options: [
      { label: "예, 2년 이내 출생아가 있어요", patch: { hasNewborn: "yes" } },
      { label: "아니오, 해당하지 않아요", patch: { hasNewborn: "no" } }
    ]
  },
  {
    title: "본인, 배우자, 세대원 전원이 무주택인가요?",
    subtitle:
      "✓ 디딤돌·보금자리론·신생아 특례: 세대원 전원 무주택 필수\n✓ 일반 주담대: 무주택 요건 없음\n✓ 주민등록등본 기준, 같은 세대의 모든 세대원이 무주택이어야 합니다.",
    item: "shoes",
    options: [
      { label: "예, 전원 무주택이에요", patch: { housingStatus: "none", householdNoHouseConfirmed: "yes" } },
      { label: "아니오, 세대원 중 주택 보유자가 있어요", patch: { housingStatus: "owned", householdNoHouseConfirmed: "no" } },
      { label: "등본 확인 전이라 잘 모르겠어요", patch: { housingStatus: "unknown", householdNoHouseConfirmed: "unknown" } }
    ]
  },
  {
    title: "부부합산 연소득은 어느 구간인가요?",
    subtitle:
      "✓ 디딤돌: 8천5백만원 이하\n✓ 보금자리론: 1억원 이하\n✓ 신생아 특례: 1.3억원 이하 (맞벌이 2억원)\n✓ 일반 주담대: 제한 없음\n\n[확인 서류]\n• 근로자: 근로소득원천징수영수증, 소득금액증명원\n• 사업자: 소득금액증명원, 종합소득세 신고서",
    item: "hat",
    options: [
      { label: "8천5백만원 이하", patch: { combinedIncome: "under85" } },
      { label: "8천5백만원 초과 ~ 1억원 이하", patch: { combinedIncome: "85to100" } },
      { label: "1억원 초과 ~ 1.3억원 이하", patch: { combinedIncome: "100to130" } },
      { label: "1.3억원 초과 ~ 2억원 이하 (맞벌이)", patch: { combinedIncome: "130to200_dual" } },
      { label: "1.3억원 초과 (외벌이)", patch: { combinedIncome: "over130" } },
      { label: "2억원 초과", patch: { combinedIncome: "over200" } }
    ]
  },
  {
    title: "부부합산 순자산이 5.11억원 이하인가요?",
    subtitle: "✓ 디딤돌·신생아 특례: 필수 조건 (5.11억원 이하)\n✓ 보금자리론·주담대: 순자산 요건 없음\n\n[계산 방법]\n순자산 = (부동산 + 금융자산 + 기타자산) - 부채",
    item: "shield",
    options: [
      { label: "예, 5.11억원 이하입니다", patch: { netAsset: "under511" } },
      { label: "아니오, 5.11억원을 초과합니다", patch: { netAsset: "over511" } },
      {
        label: "잘 모르겠어요",
        description:
          "정확한 순자산은 대출 심사 과정에서 확인됩니다.",
        patch: { netAsset: "unknown" }
      }
    ]
  },
  {
    title: "구입 주택 가격은 어느 구간인가요?",
    subtitle: "✓ 디딤돌: 6억원 이하\n✓ 보금자리론: 6억원 이하\n✓ 신생아 특례: 9억원 이하\n✓ 일반 주담대: 제한 없음\n✓ 매매계약서상 거래금액 기준입니다.",
    item: "sword",
    options: [
      { label: "6억원 이하", patch: { housePrice: "under600" } },
      { label: "6억원 초과 ~ 9억원 이하", patch: { housePrice: "600to900" } },
      { label: "9억원 초과", patch: { housePrice: "over900" } }
    ]
  },
  {
    title: "구입 주택이 수도권에 있나요?",
    subtitle: "✓ 디딤돌·신생아 특례: 지방 소재 주택 구입 시 금리 -0.2%p 우대\n✓ 수도권: 서울, 경기, 인천\n✓ 지방: 그 외 지역",
    item: null,
    options: [
      { label: "예, 수도권이에요 (서울/경기/인천)", patch: { region: "capital" } },
      { label: "아니오, 지방이에요", patch: { region: "local" } }
    ]
  },
  {
    title: "전용면적이 85m2(약 25평) 이하인가요?",
    subtitle: "✓ 디딤돌·신생아 특례: 필수 조건 (85m2 이하)\n✓ 보금자리론·주담대: 면적 제한 없음\n✓ 등기부등본 또는 건축물대장에서 확인할 수 있습니다.",
    item: null,
    options: [
      { label: "예, 85m2 이하입니다", patch: { exclusiveArea: "under85" } },
      { label: "아니오, 85m2를 초과합니다", patch: { exclusiveArea: "over85" } }
    ]
  },
  {
    title: "자녀는 몇 명인가요?",
    subtitle: "✓ 자녀 수에 따라 금리 우대가 달라집니다.\n\n[디딤돌 금리 우대]\n• 1자녀: -0.3%p / 2자녀: -0.5%p / 3자녀 이상: -0.7%p\n\n[신생아 특례 금리 우대]\n• 기존자녀 1인당: -0.1%p / 추가출산: -0.2%p",
    item: null,
    options: [
      { label: "자녀 없음", patch: { childrenCount: "0" } },
      { label: "1명", patch: { childrenCount: "1" } },
      { label: "2명", patch: { childrenCount: "2" } },
      { label: "3명 이상", patch: { childrenCount: "3" } }
    ]
  },
  {
    title: "대출 금액을 선택해주세요",
    subtitle: "✓ 상품별 주요 한도 경계에 맞춰 선택해주세요.\n\n[상품별 한도]\n• 디딤돌(신혼): 3.2억원\n• 보금자리론: 3.6억원\n• 신생아 특례: 4억원",
    item: "cape",
    options: [
      { label: "3.2억원 이하", patch: { requestedLoanAmount: "under320" } },
      { label: "3.2억원 초과 ~ 3.6억원 이하", patch: { requestedLoanAmount: "320to360" } },
      { label: "3.6억원 초과 ~ 4억원 이하", patch: { requestedLoanAmount: "360to400" } },
      { label: "4억원 초과", patch: { requestedLoanAmount: "over400" } }
    ]
  },
  {
    title: "대출 기간을 선택해주세요",
    subtitle: "✓ 3가지 상환 방식을 모두 계산해서 비교해드립니다.\n(원리금균등, 원금균등, 체증식)",
    item: null,
    options: [
      { label: "10년", patch: { loanTermYears: "10" } },
      { label: "15년", patch: { loanTermYears: "15" } },
      { label: "20년", patch: { loanTermYears: "20" } },
      { label: "30년", patch: { loanTermYears: "30" } },
      { label: "40년", patch: { loanTermYears: "40" } }
    ]
  },
  {
    title: "이번 주택은 어떻게 구입하시나요?",
    subtitle: "✓ 청약 당첨으로 통장을 해지한 경우에도 디딤돌·신생아 특례에서 우대금리를 받을 수 있습니다.",
    item: null,
    options: [
      { label: "민간분양 청약 당첨", patch: { acquisitionType: "PRIVATE_PRESALE_WINNER" } },
      { label: "공공분양 청약 당첨", patch: { acquisitionType: "PUBLIC_PRESALE_WINNER" } },
      { label: "일반 매매", patch: { acquisitionType: "GENERAL_PURCHASE" } }
    ]
  },
  {
    title: "현재 청약통장을 보유하고 있나요?",
    subtitle: "✓ 디딤돌·신생아 특례 공통 우대 항목입니다.\n✓ 청약저축 가입기간과 납입횟수에 따라 우대금리가 달라집니다.",
    item: null,
    shouldShow: (sel) => sel.acquisitionType === "GENERAL_PURCHASE",
    options: [
      { label: "예, 보유하고 있어요", patch: { hasHousingSubscription: "yes" } },
      { label: "아니오, 보유하지 않아요", patch: { hasHousingSubscription: "no" } }
    ]
  },
  {
    title: "청약통장 가입기간은 얼마나 되나요?",
    subtitle: "✓ 가입기간과 납입횟수에 따라 우대금리가 달라집니다.\n\n[우대금리 단계]\n• 5년 이상 + 60회 이상: -0.3%p\n• 10년 이상 + 120회 이상: -0.4%p\n• 15년 이상 + 180회 이상: -0.5%p",
    item: null,
    shouldShow: (sel) =>
      sel.acquisitionType === "PRIVATE_PRESALE_WINNER" ||
      sel.acquisitionType === "PUBLIC_PRESALE_WINNER" ||
      (sel.acquisitionType === "GENERAL_PURCHASE" && sel.hasHousingSubscription === "yes"),
    options: [
      { label: "5년 미만", patch: { subscriptionYears: "under5" } },
      { label: "5년~10년", patch: { subscriptionYears: "5to10" } },
      { label: "10년~15년", patch: { subscriptionYears: "10to15" } },
      { label: "15년 이상", patch: { subscriptionYears: "over15" } }
    ]
  },
  {
    title: "청약통장 납입횟수는 몇 회인가요?",
    subtitle: "✓ 가입기간과 납입횟수 모두 충족해야 해당 단계의 우대금리가 적용됩니다.\n✓ 청약통장 가입확인서에서 확인할 수 있습니다.",
    item: null,
    shouldShow: (sel) =>
      sel.acquisitionType === "PRIVATE_PRESALE_WINNER" ||
      sel.acquisitionType === "PUBLIC_PRESALE_WINNER" ||
      (sel.acquisitionType === "GENERAL_PURCHASE" && sel.hasHousingSubscription === "yes"),
    options: [
      { label: "60회 미만", patch: { subscriptionPaymentCount: "under60" } },
      { label: "60회 이상", patch: { subscriptionPaymentCount: "60to120" } },
      { label: "120회 이상", patch: { subscriptionPaymentCount: "120to180" } },
      { label: "180회 이상", patch: { subscriptionPaymentCount: "over180" } }
    ]
  },
  {
    title: "부동산 전자계약 시스템을 사용할 계획인가요?",
    subtitle: "✓ 디딤돌·신생아 특례 공통 우대 항목입니다.\n✓ 국토교통부 전자계약시스템(irts.molit.go.kr) 이용 시\n\n[우대 내용]\n-0.1%p (5년간, 2026년 12월 31일까지 계약분만 해당)",
    item: null,
    options: [
      { label: "예, 전자계약을 사용할 계획이에요", patch: { usesElectronicContract: "yes" } },
      { label: "아니오, 일반 계약을 할 예정이에요", patch: { usesElectronicContract: "no" } }
    ]
  },
  {
    title: "이 대출은 어떤 목적으로 받나요?",
    subtitle: "✓ 정책대출(디딤돌·보금자리론·신생아 특례): 실거주 목적 구입자금만 가능\n✓ 일반 주담대: 다양한 목적 가능",
    item: null,
    options: [
      { label: "내가 살 집을 구입하려고 해요", patch: { purchasePurpose: "purchase_live" } },
      { label: "기존 대출을 갈아타려는 목적이에요", patch: { purchasePurpose: "refinance" } },
      { label: "투자 또는 임대 목적이에요", patch: { purchasePurpose: "investment_or_rent" } },
      { label: "아직 목적이 확실하지 않아요", patch: { purchasePurpose: "unknown" } }
    ]
  },
  {
    title: "기존 주택도시기금 대출이 있나요?",
    subtitle: "✓ 디딤돌·신생아 특례 공통 확인 항목입니다.\n✓ 세대 기준으로 확인합니다.\n✓ 본인 또는 배우자의 기존 기금대출 여부를 확인해주세요.",
    item: null,
    options: [
      { label: "세대 기준 기존 기금대출 없음", patch: { householdLoanStatus: "no_existing_fund_loan" } },
      { label: "나 또는 배우자에게 기존 기금대출 있음", patch: { householdLoanStatus: "has_existing_fund_loan" } },
      { label: "잘 모르겠음", patch: { householdLoanStatus: "unknown" } }
    ]
  },
  {
    title: "매매계약과 입주 계획은 어떤가요?",
    subtitle: "✓ 정책대출(디딤돌·보금자리론·신생아 특례): 매매계약 완료 후 신청 가능\n✓ 실거주 계획이 있어야 합니다.",
    item: null,
    options: [
      { label: "매매계약 완료, 입주 예정", patch: { contractAndMoveInStatus: "contract_signed_move_in" } },
      { label: "계약 전이고 매물만 보고 있어요", patch: { contractAndMoveInStatus: "before_contract" } },
      { label: "입주하지 않을 예정이에요", patch: { contractAndMoveInStatus: "no_move_in" } },
      { label: "아직 잘 모르겠어요", patch: { contractAndMoveInStatus: "unknown" } }
    ]
  },
  {
    title: "매매계약일이 2025년 6월 27일 이전인가요?",
    subtitle: "✓ 2025.6.27 이전 계약 건은 기존 대출한도가 적용됩니다.\n✓ 디딤돌(신혼): 4억원 / 신생아 특례: 5억원\n✓ 2025.6.27 이후 계약 건: 디딤돌(신혼) 3.2억원 / 신생아 특례 4억원",
    item: null,
    shouldShow: (sel) => sel.contractAndMoveInStatus === "contract_signed_move_in",
    options: [
      { label: "예, 6월 27일 이전에 계약했어요", patch: { contractDate: "before2025_06_27" } },
      { label: "아니오, 6월 27일 이후에 계약했어요", patch: { contractDate: "on_or_after2025_06_27" } }
    ]
  },
  {
    title: "구입 주택은 담보로 설정 가능한 집인가요?",
    subtitle:
      "✓ 모든 주택담보대출 공통 조건입니다.\n✓ 주거용 주택이어야 합니다.\n✓ 소유권 이전 및 근저당 설정이 가능해야 합니다.\n\n[확인 서류]\n등기부등본, 건축물대장, 매매계약서",
    item: null,
    options: [
      { label: "주거용이고 담보 설정 가능해요", patch: { houseLegalStatus: "eligible_residential" } },
      { label: "오피스텔/생활숙박시설 등 애매해요", patch: { houseLegalStatus: "unclear_house_type" } },
      { label: "소유권 이전이나 담보 설정이 어려워요", patch: { houseLegalStatus: "collateral_issue" } },
      { label: "잘 모르겠음", patch: { houseLegalStatus: "unknown" } }
    ]
  },
  {
    title: "최근 연체나 신용상 문제가 있나요?",
    subtitle: "✓ 모든 대출 상품 공통 심사 항목입니다.\n✓ 금융기관 심사 시 신용 및 연체 여부를 확인합니다.\n✓ 연체 이력이 있으면 대출이 어려울 수 있습니다.",
    item: null,
    options: [
      { label: "최근 연체나 신용상 문제 없음", patch: { creditStatus: "no_issue" } },
      { label: "최근 연체 이력이 있음", patch: { creditStatus: "has_delinquency" } },
      { label: "개인회생·파산·채무조정 이력이 있음", patch: { creditStatus: "debt_adjustment" } },
      { label: "잘 모르겠음", patch: { creditStatus: "unknown" } }
    ]
  }
];

let currentStep = -1;
let unlockedCount = 0;
let selections = { ...DEFAULT_SELECTIONS };
let finalAnalysis = null;
let answerHistory = [];
let loanProducts = [];
let ragIndex = { chunks: [] };

render();
initData();

async function initData() {
  try {
    const [products, rag] = await Promise.all([loadProducts(), loadRagIndex()]);
    loanProducts = products;
    ragIndex = rag;
    if (currentStep >= QUESTIONS.length) render();
  } catch (err) {
    console.error("Failed to load data:", err);
  }
}

function render() {
  // 헤더 숨기기
  document.querySelector(".game-header").style.display = "none";

  if (currentStep === -1) {
    renderStartScreen();
    return;
  }

  if (currentStep >= QUESTIONS.length) {
    renderFinalScene();
    return;
  }

  renderQuestion(QUESTIONS[currentStep]);
}

function renderGameMap(currentStep) {
  const totalSteps = QUESTIONS.length;
  const progress = Math.min(currentStep, totalSteps);
  const stepInfo = getStepInfo(currentStep);

  return `
    <div class="game-map">
      <svg class="map-path" viewBox="0 0 400 80" preserveAspectRatio="none">
        <!-- 배경 경로 -->
        <path class="path-bg" d="M 10 40 Q 100 20, 150 40 T 290 40 T 390 40"
          stroke="#e0e0e0" stroke-width="3" fill="none"/>
        <!-- 진행한 경로 -->
        <path class="path-progress" d="M 10 40 Q 100 20, 150 40 T 290 40 T 390 40"
          stroke="#FFD700" stroke-width="3" fill="none"
          stroke-dasharray="1000"
          stroke-dashoffset="${1000 - (progress / totalSteps) * 1000}"
          style="transition: stroke-dashoffset 0.6s ease-out"/>
      </svg>
      <div class="map-markers">
        ${GAME_MAP.slice(0, totalSteps + 1).map((marker, index) => {
          const isCurrent = index === progress;
          const isPassed = index < progress;
          const isFuture = index > progress;

          return `
            <div class="map-marker ${isCurrent ? 'is-current' : ''} ${isPassed ? 'is-passed' : ''} ${isFuture ? 'is-future' : ''}"
                 style="left: ${(index / totalSteps) * 100}%"
                 data-step="${index}">
              <span class="marker-icon">${isCurrent ? stepInfo.emotion : marker.icon}</span>
              ${isCurrent ? `<span class="marker-pulse"></span>` : ''}
            </div>
          `;
        }).join('')}
      </div>
      <div class="map-status">
        <span class="status-step">${progress} / ${totalSteps}</span>
        <span class="status-label">${stepInfo.label}</span>
      </div>
    </div>
  `;
}

function renderStartScreen() {
  questScreen.innerHTML = `
    <div class="simple-layout">
      <section class="start-screen">
        <img src="./first-img.png" alt="신혼부부 대출 계산기" class="start-image">
        <button class="start-button" type="button">대출모험 시작하기</button>
      </section>
    </div>
  `;

  questScreen.querySelector(".start-button").addEventListener("click", () => {
    currentStep = 0;
    render();
  });
}

function renderQuestion(question) {
  // answerHistory에서 실제로 사용자가 선택한 인덱스를 가져옴
  const selectedIndex = answerHistory[currentStep];

  questScreen.innerHTML = `
    <div class="simple-layout">
      <section class="question-card">
        <div class="progress-row">
          <span>${currentStep + 1} / ${QUESTIONS.length}</span>
          <div class="progress-bar"><i style="width: ${Math.round((currentStep / QUESTIONS.length) * 100)}%"></i></div>
        </div>
        <h2>${escapeHtml(question.title)}</h2>
        <p class="question-subtitle">${escapeHtml(question.subtitle)}</p>
        <div class="answer-grid">
          ${question.options
            .map(
              (option, index) => {
                // answerHistory 기반으로만 선택 여부 확인 (DEFAULT_SELECTIONS 무시)
                const isSelected = selectedIndex === index;
                const selectedClass = isSelected ? 'selected' : '';
                return `
                  <button class="answer-card ${selectedClass}" type="button" data-answer="${index}">
                    <span class="answer-index">${index + 1}</span>
                    <span class="answer-copy">
                      <strong>${escapeHtml(option.label)}</strong>
                      ${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}
                    </span>
                  </button>
                `;
              }
            )
            .join("")}
        </div>
        <div class="nav-row">
          <button class="ghost-action" type="button" data-action="back" ${currentStep === 0 ? "disabled" : ""}>이전</button>
          <button class="ghost-action" type="button" data-action="reset">처음부터</button>
        </div>
      </section>
    </div>
  `;

  questScreen.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => answerQuestion(Number(button.dataset.answer)));
  });
  questScreen.querySelector("[data-action='back']").addEventListener("click", goBack);
  questScreen.querySelector("[data-action='reset']").addEventListener("click", resetQuest);
}

function renderFinalScene() {
  const input = normalizeSelections(selections);
  finalAnalysis = analyzeLoanProducts(input, loanProducts);
  const recommended = finalAnalysis.results.find((result) => result.productId === finalAnalysis.recommendedProductId);
  const references = findRelevantReferences(recommended);

  // 사용 이력 저장 (비동기, 실패해도 사용자 경험에 영향 없음)
  saveUsageLog(
    {
      selections,
      normalizedInput: input,
      answerHistory
    },
    {
      summary: finalAnalysis.summary,
      recommendedProductId: finalAnalysis.recommendedProductId,
      recommendedProductName: recommended?.productName,
      results: finalAnalysis.results.map(r => ({
        productId: r.productId,
        productName: r.productName,
        isEligible: r.isEligible,
        estimatedRate: r.estimatedRate,
        maxAvailableAmount: r.maxAvailableAmount,
        rank: r.rank
      }))
    }
  );

  questScreen.innerHTML = `
    <div class="simple-layout">
      <section class="result-scroll">
        ${renderRecommendation(finalAnalysis, recommended)}
        ${renderFinalReviewConditions(recommended, input)}
        ${renderSourceReferences(references)}
        ${renderComparisonTable(finalAnalysis.results)}
        <div class="nav-row final-actions">
          <button class="primary-action" type="button" data-action="reset">처음부터</button>
        </div>
      </section>
    </div>
  `;

  questScreen.querySelector("[data-action='reset']").addEventListener("click", resetQuest);
}

function findNextVisibleStep(fromStep) {
  for (let i = fromStep; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    if (!q.shouldShow || q.shouldShow(selections)) return i;
  }
  return QUESTIONS.length;
}

function findPrevVisibleStep(fromStep) {
  for (let i = fromStep - 1; i >= 0; i--) {
    const q = QUESTIONS[i];
    if (!q.shouldShow || q.shouldShow(selections)) return i;
  }
  return 0;
}

function answerQuestion(optionIndex) {
  const question = QUESTIONS[currentStep];
  const option = question.options[optionIndex];
  answerHistory[currentStep] = optionIndex;
  selections = { ...selections, ...option.patch };
  currentStep = findNextVisibleStep(currentStep + 1);
  unlockedCount = countUnlockedItems();
  render();
}

function goBack() {
  if (currentStep === 0) return;
  // Rebuild selections up to the previous visible step
  const prevStep = findPrevVisibleStep(currentStep);
  currentStep = prevStep;
  unlockedCount = countUnlockedItems();
  selections = { ...DEFAULT_SELECTIONS };
  for (let index = 0; index < currentStep; index += 1) {
    if (answerHistory[index] !== undefined) {
      const previousChoice = QUESTIONS[index].options[answerHistory[index]];
      selections = { ...selections, ...previousChoice.patch };
    }
  }
  // currentStep의 답변도 유지 (이전 선택 표시용)
  answerHistory = answerHistory.slice(0, currentStep + 1);
  render();
}

function countUnlockedItems() {
  return Math.min(QUESTIONS.slice(0, currentStep).filter((question) => question.item).length, ITEMS.length);
}

function resetQuest() {
  currentStep = -1;
  unlockedCount = 0;
  selections = { ...DEFAULT_SELECTIONS };
  finalAnalysis = null;
  answerHistory = [];
  render();
}

function renderRecommendation(analysis, recommended) {
  if (!recommended) {
    return `
      <article class="result-card is-empty">
        <p class="result-kicker">전투 결과</p>
        <h2>추천 가능한 상품이 없습니다.</h2>
        <p>${escapeHtml(analysis.summary)}</p>
      </article>
    `;
  }

  const hasRateDiscounts = recommended.rateDiscounts && recommended.rateDiscounts.length > 0;

  return `
    <article class="result-card">
      <p class="result-kicker">자가진단 기준 1순위</p>
      <h2>${escapeHtml(recommended.productName)}</h2>
      <p>${escapeHtml(analysis.summary)} 사용자가 선택한 조건으로 우선순위를 계산한 결과입니다.</p>
      ${hasRateDiscounts ? renderRateDiscountDetail(recommended) : ""}
      <div class="metric-grid">
        <div><span>${hasRateDiscounts ? "우대 적용 금리" : "예상 금리"}</span><strong>${formatRate(recommended.estimatedRate)}</strong></div>
        <div><span>최대 가능 금액</span><strong>${formatMoney(recommended.maxAvailableAmount)}</strong></div>
        <div><span>원리금균등 월 납입</span><strong>${formatMoney(recommended.monthlyPayment)}</strong></div>
        <div><span>총 이자</span><strong>${formatMoney(recommended.totalInterest)}</strong></div>
      </div>
      ${renderRepaymentOptions(recommended.repaymentOptions)}
    </article>
  `;
}

function renderFinalReviewConditions(recommended, input) {
  if (!recommended) {
    return `
      <article class="review-card">
        <p class="result-kicker">입력 조건 확인</p>
        <h3>자가진단 조건을 먼저 충족해야 합니다.</h3>
        <p>현재 입력 조건에서는 추천 가능한 상품이 없어, 추가 확인 조건 안내를 생략합니다.</p>
      </article>
    `;
  }

  return `
    <article class="review-card">
      <p class="result-kicker">입력한 확인 조건</p>
      <h3>입력한 정보가 맞다면 ${escapeHtml(recommended.productName)}이 가장 효율적입니다.</h3>
      <ul class="review-list">
        <li>
          <strong>소득 서류 인정 금액: ${escapeHtml(input.combinedIncomeRange.label)}</strong>
          <span>근로자는 근로소득원천징수영수증, 소득금액증명원, 건강보험료 납부확인서 등에서 확인할 수 있어요. 사업자는 소득금액증명원이나 종합소득세 신고 자료를 확인하는 경우가 많아요.</span>
        </li>
        <li>
          <strong>세대원 전원 무주택: ${formatYesNo(input.householdNoHouseConfirmed)}</strong>
          <span>주민등록등본 기준 같은 세대에 포함된 모든 세대원이 무주택이어야 해요. 부모가 같은 세대에 포함되어 있다면 부모의 주택 보유 여부도 함께 확인해주세요.</span>
        </li>
        <li>
          <strong>자산심사 최종 확인: 기금e든든에서 확정</strong>
          <span>${getAssetReviewGuide(input)}</span>
        </li>
        <li>
          <strong>주택가격: ${escapeHtml(input.housePriceRange.label)}</strong>
          <span>디딤돌·보금자리론: 6억원 이하 / 신생아 특례: 9억원 이하</span>
        </li>
        <li>
          <strong>전용면적: ${escapeHtml(input.exclusiveAreaRange.label)}</strong>
          <span>디딤돌·신생아 특례: 85m2 이하 / 보금자리론: 면적 제한 없음</span>
        </li>
        <li>
          <strong>담보 주택 조건: ${formatHouseLegalStatus(input.houseLegalStatus)}</strong>
          <span>등기부등본, 건축물대장, 매매계약서에서 주거용 주택인지와 소유권 이전/근저당 설정에 문제가 없는지 확인할 수 있어요.</span>
        </li>
      </ul>
      <p class="review-summary">이 결과는 사용자가 입력한 정보가 맞다고 가정해 평가한 자가진단입니다.</p>
    </article>
  `;
}

function renderSourceReferences(references) {
  if (!references.length) {
    return `
      <article class="source-card is-empty">
        <p class="result-kicker">RAG 근거 문서</p>
        <h3>아직 연결된 근거 문서가 없습니다.</h3>
        <p>loan-documents에 rag Markdown을 추가하고 빌드하면 이 영역에 관련 근거가 표시됩니다.</p>
      </article>
    `;
  }

  return `
    <article class="source-card">
      <p class="result-kicker">RAG 근거 문서</p>
      <h3>관련 근거 문서</h3>
      <div class="source-list">
        ${references
          .map(
            (ref) => `
              <div class="source-item">
                <strong>${escapeHtml(ref.productName)} · ${escapeHtml(ref.topic)}</strong>
                <p class="source-heading">${escapeHtml(ref.heading)}</p>
                <p>${escapeHtml(ref.excerpt)}</p>
              </div>
            `
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderComparisonTable(results) {
  return `
    <div class="comparison-table-wrap">
      <table>
        <thead>
          <tr>
            <th>순위</th>
            <th>상품</th>
            <th>상태</th>
            <th>금리</th>
            <th>한도</th>
            <th>상환방식별 첫 달 납입</th>
            <th>근거</th>
          </tr>
        </thead>
        <tbody>${results.map(renderResultRow).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderResultRow(result) {
  const status = getStatus(result);
  const rank = result.rank ? `${result.rank}위` : "-";
  const reasons = result.isEligible ? result.reasons : result.ineligibleReasons;

  return `
    <tr>
      <td>${rank}</td>
      <td><strong>${escapeHtml(result.productName)}</strong><br><small>${escapeHtml(result.provider)}</small></td>
      <td><span class="status ${status.className}">${status.label}</span></td>
      <td>${formatRate(result.estimatedRate)}</td>
      <td>${formatMoney(result.maxAvailableAmount)}</td>
      <td>${renderRepaymentSummary(result.repaymentOptions)}</td>
      <td>${escapeHtml(reasons.slice(0, 2).join(" / "))}</td>
    </tr>
  `;
}

function renderRateDiscountDetail(recommended) {
  if (!recommended.rateDiscounts || recommended.rateDiscounts.length === 0) {
    return "";
  }

  const discountItems = recommended.rateDiscounts
    .map((d) => `<li>${escapeHtml(d.reason)}: <strong>-${d.amount.toFixed(2)}%p</strong> (${escapeHtml(d.period)})</li>`)
    .join("");

  const cappedNote = recommended.isRateCapped
    ? `<p class="rate-note">* 우대 상한 ${recommended.maxRateDiscount.toFixed(1)}%p 적용됨</p>`
    : "";

  const periodNote =
    recommended.discountPeriodYears > 0
      ? `<p class="rate-note">우대금리는 ${recommended.discountPeriodYears}년간 적용되며, 이후 기본금리 ${formatRate(recommended.baseRate)}가 적용됩니다.</p>`
      : "";

  return `
    <div class="rate-discount-detail">
      <p class="result-kicker">금리 우대 내역</p>
      <div class="discount-summary">
        <div class="discount-comparison">
          <div class="rate-item">
            <span>기본 금리</span>
            <strong>${formatRate(recommended.baseRate)}</strong>
          </div>
          <div class="rate-arrow">→</div>
          <div class="rate-item highlight">
            <span>최종 적용 금리</span>
            <strong>${formatRate(recommended.estimatedRate)}</strong>
          </div>
        </div>
        <ul class="discount-list">
          ${discountItems}
        </ul>
        ${cappedNote}
        ${periodNote}
      </div>
    </div>
  `;
}

function renderRepaymentOptions(options = []) {
  if (!options.length) return "";

  return `
    <div class="repayment-options">
      <p class="result-kicker">상환방식별 예상 비교</p>
      <div class="repayment-grid">
        ${options
          .map(
            (option) => `
              <div class="repayment-option">
                <strong>${escapeHtml(option.label)}</strong>
                <span>첫 달 ${formatMoney(option.firstMonthPayment)}</span>
                <span>평균 ${formatMoney(option.monthlyPayment)}</span>
                <span>총 이자 ${formatMoney(option.totalInterest)}</span>
              </div>
            `
          )
          .join("")}
      </div>
      <p class="repayment-note">체증식은 초기에 낮고 시간이 지나며 늘어나는 방식으로 계산한 참고용 예상치입니다.</p>
    </div>
  `;
}

function renderRepaymentSummary(options = []) {
  if (!options.length) return "-";
  return options.map((option) => `${escapeHtml(option.label)} ${formatMoney(option.firstMonthPayment)}`).join("<br>");
}

function findRelevantReferences(recommended) {
  if (!recommended || !ragIndex?.chunks?.length) return [];

  const queryTerms = [recommended.productName, recommended.provider, ...RAG_QUERY_TERMS].join(" ");
  return searchRag(queryTerms, recommended.productId, ragIndex);
}

function getStatus(result) {
  if (result.isEligible && result.hasEnoughLimit) return { label: "가능", className: "ok" };
  if (result.isEligible && !result.hasEnoughLimit) return { label: "한도 부족", className: "warn" };
  if (result.ineligibleReasons.some((reason) => reason.includes("확인"))) return { label: "확인 필요", className: "warn" };
  return { label: "불가능", className: "no" };
}

function formatYesNo(value) {
  if (value === "yes") return "예";
  if (value === "no") return "아니오";
  return "확인 필요";
}

function getAssetReviewGuide(input) {
  if (input.netAssetStatus === "unknown") {
    return "괜찮습니다. 정확한 순자산은 대출 심사 과정에서 확인됩니다. 서비스에서는 이후 결과를 참고용으로 제공하며, 정책대출 자격은 실제 심사 결과와 다를 수 있습니다.";
  }
  return "입력한 순자산 정보가 맞고 기금e든든 자산심사에서 기준 이하로 확인되면, 디딤돌대출 자산 요건을 충족할 가능성이 높아요.";
}

function formatHouseLegalStatus(value) {
  if (value === "eligible_residential") return "주거용, 담보 설정 가능";
  if (value === "unclear_house_type") return "주택 유형 확인 필요";
  if (value === "collateral_issue") return "담보 설정 이슈 있음";
  return "확인 필요";
}

function getItemLabel(id) {
  return ITEMS.find((item) => item.id === id)?.label ?? "";
}

function formatMoney(value) {
  const rounded = Math.round(value / 10000) * 10000;
  if (rounded >= 100000000) {
    const eok = rounded / 100000000;
    return `${Number.isInteger(eok) ? eok.toLocaleString("ko-KR") : eok.toFixed(1)}억원`;
  }
  return `${Math.round(rounded / 10000).toLocaleString("ko-KR")}만원`;
}

function formatRate(value) {
  return `${value.toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
