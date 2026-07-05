import "dotenv/config";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import usageLogsRouter from "./routes/usage-logs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어
app.use(cors());
app.use(express.json());

// 정적 파일 제공 (프론트엔드)
app.use(express.static(join(__dirname, "..")));

// API 라우트
app.use("/api/usage-logs", usageLogsRouter);

// 헬스체크
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`\nAdmin API requires Authorization header:`);
  console.log(`  GET /api/usage-logs/admin?limit=10&offset=0`);
  console.log(`  GET /api/usage-logs/admin/stats`);
  console.log(`  Header: Authorization: Bearer admin-secret-token-change-me`);
});
