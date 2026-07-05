# 신혼부부 대출 비교 계산기

신혼부부를 위한 대출 상품 비교 및 추천 서비스입니다.

## 주요 기능

- 사용자 맞춤 대출 상품 추천
- 금리 및 한도 자동 계산
- 상환 방식별 비교 (원리금균등, 원금균등, 체증식)
- 비회원 사용자 이용 이력 자동 저장
- 관리자용 통계 대시보드

## 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 데이터 빌드

```bash
npm run build:data
```

### 3. 서버 실행

```bash
npm run dev
```

서버가 실행되면 http://localhost:3000 에서 접속할 수 있습니다.

## 환경 변수 설정

`.env.example` 파일을 복사하여 `.env` 파일을 생성하고 필요한 값을 설정하세요.

```bash
cp .env.example .env
```

**중요**: `ADMIN_TOKEN`은 반드시 안전한 값으로 변경하세요!

## API 사용법

### 사용 이력 저장 (자동)

사용자가 분석을 완료하면 자동으로 서버에 저장됩니다.

```
POST /api/usage-logs
Content-Type: application/json

{
  "anonymousUserId": "user_1234567890_abc123",
  "sessionId": "session_1234567890_xyz789",
  "inputData": { ... },
  "analysisResult": { ... }
}
```

### 관리자 API

#### 사용 이력 조회

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  "http://localhost:3000/api/usage-logs/admin?limit=10&offset=0"
```

#### 통계 조회

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  "http://localhost:3000/api/usage-logs/admin/stats"
```

응답 예시:
```json
{
  "success": true,
  "stats": {
    "totalLogs": 150,
    "uniqueUsers": 85,
    "uniqueSessions": 120,
    "todayLogs": 12,
    "last7DaysLogs": 45
  }
}
```

## 데이터베이스

MVP 단계에서는 JSON 파일 기반 저장소를 사용합니다 (`data/usage-logs.json`).
추후 트래픽이 증가하면 PostgreSQL 등 실제 데이터베이스로 마이그레이션할 수 있습니다.

### 데이터 구조

```json
{
  "logs": [
    {
      "id": 1,
      "anonymous_user_id": "user_xxx",
      "session_id": "session_xxx",
      "ip_hash": "sha256_hash",
      "user_agent": "Mozilla/5.0...",
      "input_data": { ... },
      "analysis_result": { ... },
      "created_at": "2026-07-05T08:11:08.426Z"
    }
  ],
  "lastId": 1
}
```

### 관리자 대시보드

브라우저에서 `/admin.html`에 접속하여 사용 이력과 통계를 확인할 수 있습니다.

- URL: http://localhost:3000/admin.html
- 토큰: `.env` 파일의 `ADMIN_TOKEN` 값

## 개인정보 보호

- 이름, 전화번호, 주민등록번호 등 개인정보는 수집하지 않습니다.
- IP 주소는 SHA256 해시로 변환하여 저장합니다.
- 익명 사용자 ID는 브라우저 localStorage에만 저장됩니다.
- 세션 ID는 브라우저 sessionStorage에 저장되며 브라우저 종료 시 삭제됩니다.

## 프로젝트 구조

```
honeybee/
├── server/              # 백엔드 서버
│   ├── index.js        # Express 서버 메인
│   ├── db.js           # 데이터베이스 설정
│   ├── routes/         # API 라우트
│   └── utils/          # 유틸리티 함수
├── src/                # 프론트엔드
│   ├── app.js          # 메인 애플리케이션
│   ├── domain/         # 비즈니스 로직
│   ├── data/           # 데이터 로더
│   └── utils/          # 유틸리티 (analytics 포함)
├── loan-documents/     # 대출 상품 정보
└── data/               # 데이터베이스 저장 위치
```

## 라이선스

Private
