import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = join(__dirname, "../data");
const dbPath = join(dataDir, "usage-logs.json");

// 데이터 디렉토리 생성
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// 데이터베이스 초기화
if (!existsSync(dbPath)) {
  writeFileSync(dbPath, JSON.stringify({ logs: [], lastId: 0 }, null, 2));
}

/**
 * 데이터베이스 읽기
 */
function readDB() {
  try {
    const data = readFileSync(dbPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading database:", error);
    return { logs: [], lastId: 0 };
  }
}

/**
 * 데이터베이스 쓰기
 */
function writeDB(data) {
  try {
    writeFileSync(dbPath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error("Error writing database:", error);
    return false;
  }
}

/**
 * 사용 이력 추가
 */
export function insertUsageLog(log) {
  const db = readDB();
  const newLog = {
    id: db.lastId + 1,
    ...log,
    created_at: new Date().toISOString()
  };

  db.logs.push(newLog);
  db.lastId = newLog.id;

  const success = writeDB(db);
  return success ? newLog.id : null;
}

/**
 * 사용 이력 조회
 */
export function getUsageLogs({ limit = 100, offset = 0, anonymousUserId, sessionId }) {
  const db = readDB();
  let logs = db.logs;

  // 필터링
  if (anonymousUserId) {
    logs = logs.filter(log => log.anonymous_user_id === anonymousUserId);
  }

  if (sessionId) {
    logs = logs.filter(log => log.session_id === sessionId);
  }

  // 최신순 정렬
  logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // 페이지네이션
  const total = logs.length;
  const paginatedLogs = logs.slice(offset, offset + limit);

  return {
    logs: paginatedLogs,
    total
  };
}

/**
 * 통계 조회
 */
export function getStats() {
  const db = readDB();
  const logs = db.logs;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    totalLogs: logs.length,
    uniqueUsers: new Set(logs.map(log => log.anonymous_user_id)).size,
    uniqueSessions: new Set(logs.map(log => log.session_id)).size,
    todayLogs: logs.filter(log => log.created_at >= today).length,
    last7DaysLogs: logs.filter(log => log.created_at >= sevenDaysAgo).length
  };
}
