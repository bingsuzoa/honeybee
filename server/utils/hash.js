import { createHash } from "crypto";

export function hashIP(ip) {
  if (!ip) return "unknown";

  // IPv6를 IPv4로 변환 (::ffff:127.0.0.1 -> 127.0.0.1)
  const cleanIP = ip.replace(/^::ffff:/, "");

  // SHA256 해시 처리
  return createHash("sha256").update(cleanIP).digest("hex");
}

export function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
