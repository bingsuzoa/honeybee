/**
 * 익명 사용자 ID 관리 및 사용 이력 저장
 */

const STORAGE_KEY_USER_ID = "honeybee_anonymous_user_id";
const STORAGE_KEY_SESSION_ID = "honeybee_session_id";

/**
 * 익명 사용자 ID 가져오기 (없으면 생성)
 */
export function getOrCreateAnonymousUserId() {
  let userId = localStorage.getItem(STORAGE_KEY_USER_ID);

  if (!userId) {
    userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(STORAGE_KEY_USER_ID, userId);
  }

  return userId;
}

/**
 * 세션 ID 가져오기 (없으면 생성)
 */
export function getOrCreateSessionId() {
  let sessionId = sessionStorage.getItem(STORAGE_KEY_SESSION_ID);

  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    sessionStorage.setItem(STORAGE_KEY_SESSION_ID, sessionId);
  }

  return sessionId;
}

/**
 * 사용 이력을 서버에 저장
 */
export async function saveUsageLog(inputData, analysisResult) {
  try {
    const anonymousUserId = getOrCreateAnonymousUserId();
    const sessionId = getOrCreateSessionId();

    const response = await fetch("/api/usage-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        anonymousUserId,
        sessionId,
        inputData,
        analysisResult
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log("Usage log saved successfully:", result);
    return result;
  } catch (error) {
    // 사용자 경험을 해치지 않도록 조용히 실패 처리
    console.error("Failed to save usage log:", error);
    return { success: false, error: error.message };
  }
}
