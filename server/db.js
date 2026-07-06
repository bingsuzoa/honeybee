import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// PostgreSQL 사용 여부
const usePostgres = !!process.env.DATABASE_URL;

let pool;

if (usePostgres) {
  const { default: pg } = await import("pg");
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// --- JSON 파일 폴백 (로컬 개발용) ---

const dataDir = join(__dirname, "../data");
const dbPath = join(dataDir, "usage-logs.json");

function ensureJsonDB() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  if (!existsSync(dbPath)) {
    writeFileSync(dbPath, JSON.stringify({ logs: [], lastId: 0 }, null, 2));
  }
}

function readDB() {
  try {
    const data = readFileSync(dbPath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading database:", error);
    return { logs: [], lastId: 0 };
  }
}

function writeDB(data) {
  try {
    writeFileSync(dbPath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error("Error writing database:", error);
    return false;
  }
}

// --- 공용 함수 ---

/**
 * DB 초기화 (PostgreSQL 테이블 생성 또는 JSON 파일 확인)
 */
export async function initDB() {
  if (usePostgres) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id SERIAL PRIMARY KEY,
        anonymous_user_id VARCHAR(255),
        session_id VARCHAR(255),
        ip_hash VARCHAR(255),
        user_agent TEXT,
        input_data JSONB,
        analysis_result JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at DESC);
    `);
    console.log("PostgreSQL database initialized");
  } else {
    ensureJsonDB();
    console.log("Using JSON file database (local fallback)");
  }
}

/**
 * 사용 이력 추가
 */
export async function insertUsageLog(log) {
  if (usePostgres) {
    const result = await pool.query(
      `INSERT INTO usage_logs (anonymous_user_id, session_id, ip_hash, user_agent, input_data, analysis_result)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        log.anonymous_user_id,
        log.session_id,
        log.ip_hash,
        log.user_agent,
        JSON.stringify(log.input_data),
        JSON.stringify(log.analysis_result)
      ]
    );
    return result.rows[0].id;
  }

  // JSON 폴백
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
export async function getUsageLogs({ limit = 100, offset = 0, anonymousUserId, sessionId }) {
  if (usePostgres) {
    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (anonymousUserId) {
      conditions.push(`anonymous_user_id = $${paramIdx++}`);
      params.push(anonymousUserId);
    }
    if (sessionId) {
      conditions.push(`session_id = $${paramIdx++}`);
      params.push(sessionId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM usage_logs ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const logsResult = await pool.query(
      `SELECT * FROM usage_logs ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    return { logs: logsResult.rows, total };
  }

  // JSON 폴백
  const db = readDB();
  let logs = db.logs;

  if (anonymousUserId) {
    logs = logs.filter(log => log.anonymous_user_id === anonymousUserId);
  }
  if (sessionId) {
    logs = logs.filter(log => log.session_id === sessionId);
  }

  logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const total = logs.length;
  const paginatedLogs = logs.slice(offset, offset + limit);

  return { logs: paginatedLogs, total };
}

/**
 * 통계 조회
 */
export async function getStats() {
  if (usePostgres) {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS "totalLogs",
        COUNT(DISTINCT anonymous_user_id) AS "uniqueUsers",
        COUNT(DISTINCT session_id) AS "uniqueSessions",
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS "todayLogs",
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS "last7DaysLogs"
      FROM usage_logs
    `);
    const row = result.rows[0];
    return {
      totalLogs: parseInt(row.totalLogs, 10),
      uniqueUsers: parseInt(row.uniqueUsers, 10),
      uniqueSessions: parseInt(row.uniqueSessions, 10),
      todayLogs: parseInt(row.todayLogs, 10),
      last7DaysLogs: parseInt(row.last7DaysLogs, 10)
    };
  }

  // JSON 폴백
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
