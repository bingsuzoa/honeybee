import express from "express";
import { insertUsageLog, getUsageLogs, getStats } from "../db.js";
import { hashIP } from "../utils/hash.js";

const router = express.Router();

// 사용 이력 저장
router.post("/", async (req, res) => {
  try {
    const { anonymousUserId, sessionId, inputData, analysisResult } = req.body;

    if (!anonymousUserId || !sessionId || !inputData || !analysisResult) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: anonymousUserId, sessionId, inputData, analysisResult"
      });
    }

    // IP 해시 처리
    const clientIP = req.ip || req.connection.remoteAddress;
    const ipHash = hashIP(clientIP);

    // User Agent
    const userAgent = req.headers["user-agent"] || "unknown";

    // DB에 저장
    const logId = await insertUsageLog({
      anonymous_user_id: anonymousUserId,
      session_id: sessionId,
      ip_hash: ipHash,
      user_agent: userAgent,
      input_data: inputData,
      analysis_result: analysisResult
    });

    if (!logId) {
      throw new Error("Failed to save log");
    }

    res.json({
      success: true,
      logId
    });
  } catch (error) {
    console.error("Error saving usage log:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save usage log"
    });
  }
});

// 관리자용 조회 API (간단한 기본 인증)
router.get("/admin", async (req, res) => {
  try {
    // 간단한 토큰 인증 (실제 환경에서는 더 강력한 인증 필요)
    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin-secret-token-change-me";

    if (authToken !== ADMIN_TOKEN) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const { limit = 100, offset = 0, anonymousUserId, sessionId } = req.query;

    const { logs, total } = await getUsageLogs({
      limit: parseInt(limit),
      offset: parseInt(offset),
      anonymousUserId,
      sessionId
    });

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.error("Error fetching usage logs:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch usage logs"
    });
  }
});

// 통계 API
router.get("/admin/stats", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin-secret-token-change-me";

    if (authToken !== ADMIN_TOKEN) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });
    }

    const stats = await getStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch stats"
    });
  }
});

export default router;
