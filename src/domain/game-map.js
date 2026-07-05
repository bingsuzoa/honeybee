/**
 * 게임 맵 시스템
 * 사용자의 진행 상황을 게임처럼 시각화
 */

export const GAME_MAP = [
  { step: 0, type: "start", icon: "🥚", label: "시작", emotion: "😊" },
  { step: 1, type: "reward", icon: "🍬", label: "사탕 획득", emotion: "😋" },
  { step: 2, type: "evolution", icon: "🐌", label: "유년기", emotion: "🙂", stage: "baby" },
  { step: 3, type: "reward", icon: "🎁", label: "선물상자", emotion: "😆" },
  { step: 4, type: "evolution", icon: "🐌", label: "성장기", emotion: "😄", stage: "child" },
  { step: 5, type: "reward", icon: "🍫", label: "초콜릿", emotion: "😋" },
  { step: 6, type: "progress", icon: "💪", label: "힘 증가", emotion: "😤" },
  { step: 7, type: "reward", icon: "💰", label: "돈주머니", emotion: "🤑" },
  { step: 8, type: "evolution", icon: "🐌", label: "성숙기", emotion: "😎", stage: "teen" },
  { step: 9, type: "reward", icon: "❤️", label: "체력 회복", emotion: "🥰" },
  { step: 10, type: "progress", icon: "⭐", label: "경험치", emotion: "🤩" },
  { step: 11, type: "reward", icon: "👑", label: "황금상자", emotion: "😍" },
  { step: 12, type: "evolution", icon: "🐌", label: "완전체", emotion: "😎", stage: "adult" },
  { step: 13, type: "reward", icon: "🔑", label: "황금열쇠", emotion: "🥳" },
  { step: 14, type: "progress", icon: "✨", label: "진화 준비", emotion: "🤩" },
  { step: 15, type: "evolution", icon: "👑", label: "최종 진화", emotion: "😤", stage: "final" },
  { step: 16, type: "boss", icon: "👿", label: "대출괴물", emotion: "😈" }
];

export const EVOLUTION_STAGES = {
  baby: {
    name: "유년기",
    description: "이제 막 시작한 아기 벌!",
    color: "#FFE5B4"
  },
  child: {
    name: "성장기",
    description: "쑥쑥 자라는 벌!",
    color: "#FFD700"
  },
  teen: {
    name: "성숙기",
    description: "당당한 벌!",
    color: "#FFA500"
  },
  adult: {
    name: "완전체",
    description: "강력한 벌!",
    color: "#FF6347"
  },
  final: {
    name: "최종 진화",
    description: "무적의 벌!",
    color: "#8B008B"
  }
};

export const REWARD_MESSAGES = {
  reward: [
    "보상을 획득했어요!",
    "멋진 아이템을 얻었어요!",
    "좋은 선택이에요!",
    "계속 진행해볼까요?"
  ],
  evolution: [
    "진화했어요! 🎉",
    "레벨업! ✨",
    "더 강해졌어요!",
    "새로운 단계 도달!"
  ],
  progress: [
    "한 걸음 더!",
    "좋은 진행이에요!",
    "계속 가볼까요?",
    "점점 가까워져요!"
  ]
};

/**
 * 현재 단계의 정보 가져오기
 */
export function getStepInfo(step) {
  return GAME_MAP[step] || GAME_MAP[0];
}

/**
 * 진화 단계인지 확인
 */
export function isEvolution(step) {
  const info = getStepInfo(step);
  return info.type === "evolution";
}

/**
 * 보상 단계인지 확인
 */
export function isReward(step) {
  const info = getStepInfo(step);
  return info.type === "reward";
}

/**
 * 랜덤 메시지 가져오기
 */
export function getRandomMessage(type) {
  const messages = REWARD_MESSAGES[type] || REWARD_MESSAGES.progress;
  return messages[Math.floor(Math.random() * messages.length)];
}
