# SH/LH 주택 공고 알림 시스템 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** n8n 워크플로우로 SH/LH 주택 공고를 매일 수집하고, 사용자 조건에 맞는 공고를 Slack으로 알림 발송

**Architecture:** n8n 스케줄러가 매일 아침 실행 → SH/LH 공공API(실패 시 크롤링 fallback)에서 공고 수집 → Code 노드에서 조건 필터링 → 조건 맞는 공고 있으면 Slack 웹훅으로 알림 발송. 조건 중 민감 정보(자산/소득)는 환경변수, 지역/유형 등은 Code 노드 JSON으로 관리.

**Tech Stack:** n8n, Docker Compose, Node.js (Code 노드), Slack Incoming Webhook, 공공데이터포털 OpenAPI

**Design Doc:** `docs/plans/2026-03-06-sh-lh-housing-alert-design.md`

---

## 사전 준비

- Docker Desktop 설치 확인
- Slack 워크스페이스 접근 권한
- 공공데이터포털 계정 (data.go.kr) - API 키 발급용

---

### Task 1: 프로젝트 디렉토리 및 Docker Compose 설정

**Files:**
- Create: `sh-lh-alert/docker-compose.yml`
- Create: `sh-lh-alert/.env.example`
- Create: `sh-lh-alert/.env`
- Create: `sh-lh-alert/.gitignore`

**Step 1: 프로젝트 디렉토리 생성**

```bash
mkdir -p sh-lh-alert
cd sh-lh-alert
```

**Step 2: docker-compose.yml 작성**

```yaml
# sh-lh-alert/docker-compose.yml
version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}
      - N8N_HOST=localhost
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - WEBHOOK_URL=http://localhost:5678/
      # 사용자 조건 환경변수
      - USER_ASSET_LIMIT=${USER_ASSET_LIMIT}
      - USER_INCOME_LIMIT=${USER_INCOME_LIMIT}
      - USER_HOUSEHOLD_SIZE=${USER_HOUSEHOLD_SIZE}
      - USER_HAS_CAR=${USER_HAS_CAR}
      # API 키
      - PUBLIC_DATA_API_KEY=${PUBLIC_DATA_API_KEY}
      # Slack
      - SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL}
    volumes:
      - n8n_data:/home/node/.n8n
    restart: unless-stopped

volumes:
  n8n_data:
```

**Step 3: .env.example 작성**

```bash
# sh-lh-alert/.env.example

# n8n 접속 계정
N8N_USER=admin
N8N_PASSWORD=changeme

# 사용자 조건 (민감정보 - .env에만, git 제외)
USER_ASSET_LIMIT=32500     # 만원 단위 (예: 3억2500만원)
USER_INCOME_LIMIT=5000     # 월 소득 만원 단위
USER_HOUSEHOLD_SIZE=2      # 세대원 수
USER_HAS_CAR=false         # 자동차 보유 여부

# 공공데이터포털 API 키 (data.go.kr에서 발급)
PUBLIC_DATA_API_KEY=your_api_key_here

# Slack Incoming Webhook URL
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

**Step 4: .env 파일 생성 (실제 값 입력)**

```bash
cp sh-lh-alert/.env.example sh-lh-alert/.env
# .env 파일을 열어서 실제 값 입력
```

**Step 5: .gitignore 작성**

```
# sh-lh-alert/.gitignore
.env
n8n_data/
```

**Step 6: n8n 실행 확인**

```bash
cd sh-lh-alert
docker compose up -d
```

브라우저에서 `http://localhost:5678` 접속 → .env의 N8N_USER/N8N_PASSWORD로 로그인 확인

**Step 7: 커밋**

```bash
git init sh-lh-alert
cd sh-lh-alert
git add docker-compose.yml .env.example .gitignore
git commit -m "feat: initial n8n docker-compose setup"
```

---

### Task 2: 공공 API 조사 및 테스트

**목적:** LH/SH 데이터를 공공 API로 가져올 수 있는지 확인. 가능하면 API 우선, 불가능하면 크롤링으로 fallback.

**Step 1: 공공데이터포털에서 API 확인**

브라우저에서 `data.go.kr` 접속 후 다음 키워드로 검색:
- "LH 임대주택"
- "SH 임대주택"
- "주택청약"

찾아야 할 API:
- LH 임대주택 공고 API (한국토지주택공사)
- SH 임대주택 공고 API (서울주택도시공사)

각 API 상세 페이지에서 확인:
- 엔드포인트 URL
- 요청 파라미터 (지역코드, 공고유형 등)
- 응답 필드 (공고명, 위치, 금액, 면적, 신청기간 등)

**Step 2: API 키 발급**

data.go.kr 에서 해당 API 활용 신청 → 승인 후 API 키 발급 (자동승인인 경우 즉시 가능)

**Step 3: curl로 API 테스트**

LH API 예시 (실제 엔드포인트는 data.go.kr에서 확인):
```bash
curl "https://api.odcloud.kr/api/...?serviceKey=YOUR_KEY&pageNo=1&numOfRows=10" | python3 -m json.tool
```

응답에서 확인해야 할 필드:
- 공고명 (사업명)
- 공급유형 (임대유형)
- 위치 (시/구/동)
- 보증금, 월임대료
- 전용면적, 공용면적
- 모집공고일, 신청기간
- 상세URL 또는 공고ID

**Step 4: 응답 구조 문서화**

`sh-lh-alert/docs/api-response-sample.json` 에 실제 응답 샘플 저장

**Step 5: API 없거나 데이터 불충분시 → 크롤링 대안 확인**

SH 사이트: `i-sh.co.kr/main/lay2/program/S1T294C295/pgm/selectRentalHouseList.do`
LH 사이트: `lh.or.kr` 공고 목록 페이지

n8n HTTP Request 노드로 HTML 가져온 후 Code 노드에서 파싱 가능한지 확인:
```bash
curl -s "https://i-sh.co.kr/..." | head -100
```

**Step 6: 결정 기록**

`sh-lh-alert/docs/data-source-decision.md` 에 선택한 데이터 소스와 이유 기록

---

### Task 3: 필터링 로직 개발 및 테스트 (독립 스크립트)

**목적:** n8n Code 노드에 넣기 전에 필터 로직을 독립 Node.js 스크립트로 개발/테스트

**Files:**
- Create: `sh-lh-alert/filter/filter.js`
- Create: `sh-lh-alert/filter/filter.test.js`
- Create: `sh-lh-alert/filter/sample-data.js`

**Step 1: 샘플 데이터 작성 (Task 2에서 얻은 실제 응답 기반)**

```js
// sh-lh-alert/filter/sample-data.js
module.exports = {
  listings: [
    {
      title: "2026년 3월 신혼부부 전세임대 II",
      source: "LH",
      type: "전세임대",
      city: "서울특별시",
      district: "강동구",
      dong: "천호동",
      deposit: 12000000,       // 보증금 (원)
      monthlyRent: 120000,     // 월세 (원)
      exclusiveArea: 46.2,     // 전용면적 (m²)
      supplyArea: 58.1,        // 공용면적 (m²)
      startDate: "2026-03-10",
      endDate: "2026-03-20",
      url: "https://lh.or.kr/...",
      parking: true,
      elevator: true,
      amenities: ["근린생활시설"],
    },
    {
      title: "2026년 청년 매입임대주택",
      source: "SH",
      type: "매입임대",
      city: "서울특별시",
      district: "마포구",
      dong: "합정동",
      deposit: 5000000,
      monthlyRent: 300000,
      exclusiveArea: 23.5,
      supplyArea: 30.1,
      startDate: "2026-03-05",
      endDate: "2026-03-08",  // 이미 지난 공고
      url: "https://i-sh.co.kr/...",
      parking: false,
      elevator: false,
      amenities: [],
    },
  ]
};
```

**Step 2: 실패하는 테스트 먼저 작성**

```js
// sh-lh-alert/filter/filter.test.js
const { filterListings } = require('./filter');
const { listings } = require('./sample-data');

const conditions = {
  // 환경변수에서 올 값들
  assetLimit: 32500,      // 만원
  incomeLimit: 5000,      // 월 만원
  householdSize: 2,
  hasCar: false,
  // Code 노드 JSON에서 올 값들
  regions: ["서울특별시"],
  districts: ["강동구", "송파구"],
  types: ["전세임대", "행복주택"],
  sources: ["LH", "SH"],
};

// 기본 필터: 지역 + 유형
const result = filterListings(listings, conditions);
console.assert(result.length === 1, `지역/유형 필터: 1개 기대, ${result.length}개 반환`);
console.assert(result[0].district === "강동구", "강동구 공고여야 함");

// 마감된 공고 제외
const today = new Date().toISOString().split('T')[0];
const notExpired = result.filter(l => l.endDate >= today);
console.assert(notExpired.length === result.length, "마감 공고 없어야 함");

console.log("모든 테스트 통과");
```

**Step 3: 테스트 실행 (실패 확인)**

```bash
cd sh-lh-alert
node filter/filter.test.js
```
Expected: `ReferenceError: Cannot find module './filter'`

**Step 4: 필터 로직 구현**

```js
// sh-lh-alert/filter/filter.js

/**
 * 공고 목록을 사용자 조건으로 필터링
 * @param {Array} listings - 공고 목록
 * @param {Object} conditions - 필터 조건
 * @returns {Array} 조건에 맞는 공고 목록
 */
function filterListings(listings, conditions) {
  const today = new Date().toISOString().split('T')[0];

  return listings.filter(listing => {
    // 마감된 공고 제외
    if (listing.endDate < today) return false;

    // 지역 필터 (regions 배열에 시가 있어야 함)
    if (conditions.regions.length > 0) {
      if (!conditions.regions.includes(listing.city)) return false;
    }

    // 구 필터 (districts 배열이 비어있으면 전체 허용)
    if (conditions.districts.length > 0) {
      if (!conditions.districts.includes(listing.district)) return false;
    }

    // 공급 유형 필터
    if (conditions.types.length > 0) {
      if (!conditions.types.includes(listing.type)) return false;
    }

    // 출처 필터 (LH/SH)
    if (conditions.sources.length > 0) {
      if (!conditions.sources.includes(listing.source)) return false;
    }

    return true;
  });
}

/**
 * 공고를 Slack 메시지 블록으로 변환
 */
function formatSlackMessage(listing) {
  const amenityText = listing.amenities && listing.amenities.length > 0
    ? listing.amenities.join(' · ')
    : null;

  const extras = [
    listing.parking ? '주차 가능' : null,
    listing.elevator ? '엘리베이터' : null,
    amenityText,
  ].filter(Boolean).join(' · ');

  const lines = [
    `*[${listing.source}] ${listing.title}*`,
    `분류: ${listing.source} · ${listing.type}`,
    `위치: ${listing.city} ${listing.district} ${listing.dong || ''}`.trim(),
    `면적: 전용 ${listing.exclusiveArea}m² / 공용 ${listing.supplyArea}m²`,
    `금액: 보증금 ${(listing.deposit / 10000).toLocaleString()}만원` +
      (listing.monthlyRent > 0 ? ` · 월세 ${(listing.monthlyRent / 10000).toLocaleString()}만원` : ''),
    `신청기간: ${listing.startDate} ~ ${listing.endDate}`,
    extras ? `부가조건: ${extras}` : null,
    `<${listing.url}|공고 바로가기>`,
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = { filterListings, formatSlackMessage };
```

**Step 5: 테스트 실행 (통과 확인)**

```bash
node filter/filter.test.js
```
Expected: `모든 테스트 통과`

**Step 6: formatSlackMessage 테스트 추가 및 확인**

```bash
# filter.test.js 하단에 추가
const { formatSlackMessage } = require('./filter');
const msg = formatSlackMessage(listings[0]);
console.assert(msg.includes('강동구'), "위치 포함 확인");
console.assert(msg.includes('전세임대'), "유형 포함 확인");
console.assert(msg.includes('보증금'), "금액 포함 확인");
console.log(msg);  // 실제 메시지 출력 확인
```

```bash
node filter/filter.test.js
```

**Step 7: 커밋**

```bash
git add filter/
git commit -m "feat: add listing filter and Slack message formatter"
```

---

### Task 4: Slack Webhook 설정

**Step 1: Slack에서 Incoming Webhook 생성**

1. Slack 워크스페이스 → `api.slack.com/apps` 접속
2. "Create New App" → "From scratch"
3. App 이름: `SH-LH Alert`, 워크스페이스 선택
4. 좌측 "Incoming Webhooks" → Activate → "Add New Webhook to Workspace"
5. 알림 받을 채널 선택 (예: `#housing-alert` 채널 생성 후 선택)
6. Webhook URL 복사 → `.env`의 `SLACK_WEBHOOK_URL`에 붙여넣기

**Step 2: Webhook 테스트**

```bash
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-type: application/json' \
  --data '{"text": "SH/LH 알림 테스트 메시지입니다."}'
```

Expected: Slack 채널에 메시지 수신 확인

---

### Task 5: n8n 워크플로우 구축

**목적:** n8n UI에서 워크플로우를 단계별로 구성

모든 작업은 `http://localhost:5678` n8n UI에서 진행.

**Step 1: 새 워크플로우 생성**

n8n UI → "+ New Workflow" → 이름: "SH/LH 주택 공고 알림"

**Step 2: Schedule Trigger 노드 추가**

- 노드 추가: "Schedule Trigger"
- Trigger Interval: "Days"
- Hour: 8 (오전 8시)
- 저장

**Step 3: HTTP Request 노드 추가 (데이터 수집)**

Task 2에서 결정한 데이터 소스에 따라:

**공공API 사용 시:**
- 노드 추가: "HTTP Request"
- Method: GET
- URL: `{{ $env.PUBLIC_DATA_API_KEY }}` 를 파라미터로 포함한 API URL
- Query Parameters:
  - `serviceKey`: `{{ $env.PUBLIC_DATA_API_KEY }}`
  - `pageNo`: 1
  - `numOfRows`: 100
  - `type`: json
- Response Format: JSON

**크롤링 사용 시:**
- URL: SH/LH 공고 목록 URL
- Response Format: String (HTML)

**Step 4: Code 노드 추가 (파싱 + 필터링)**

- 노드 추가: "Code" (JavaScript)
- Language: JavaScript

아래 코드를 붙여넣기 (filter.js의 로직을 n8n Code 노드 형식으로):

```javascript
// === 사용자 조건 설정 (지역/유형은 여기서 수정) ===
const USER_CONDITIONS = {
  regions: ["서울특별시"],
  districts: ["강동구", "송파구"],  // 빈 배열이면 전체 허용
  types: ["전세임대", "행복주택", "공공임대"],
  sources: ["LH", "SH"],
};

// === 환경변수에서 민감 조건 로드 ===
const sensitiveConditions = {
  assetLimit: Number(process.env.USER_ASSET_LIMIT || 0),
  incomeLimit: Number(process.env.USER_INCOME_LIMIT || 0),
  householdSize: Number(process.env.USER_HOUSEHOLD_SIZE || 1),
  hasCar: process.env.USER_HAS_CAR === 'true',
};

const conditions = { ...USER_CONDITIONS, ...sensitiveConditions };

// === API 응답 파싱 (Task 2에서 확인한 실제 필드명으로 수정 필요) ===
const rawData = $input.first().json;
const rawListings = rawData.response?.body?.items?.item || rawData.items || [];

const listings = rawListings.map(item => ({
  title: item.lttotPblancNm || item.title || '',
  source: item.suplyInsttNm?.includes('SH') ? 'SH' : 'LH',
  type: item.rentalType || item.type || '',
  city: item.sido || '',
  district: item.sgg || '',
  dong: item.umd || '',
  deposit: Number(item.leaseholdAmt || 0) * 10000,
  monthlyRent: Number(item.rentalAmt || 0) * 10000,
  exclusiveArea: Number(item.exclusiveArea || 0),
  supplyArea: Number(item.supplyArea || 0),
  startDate: item.rcritPbancBgnde || '',
  endDate: item.rcritPbancEndde || '',
  url: item.dtlUrl || item.url || '',
  parking: !!item.parkingAbltyCount,
  elevator: !!item.elvtrInstlYn,
  amenities: [],
}));

// === 필터링 ===
const today = new Date().toISOString().split('T')[0];

const filtered = listings.filter(listing => {
  if (listing.endDate && listing.endDate < today) return false;
  if (conditions.regions.length > 0 && !conditions.regions.includes(listing.city)) return false;
  if (conditions.districts.length > 0 && !conditions.districts.includes(listing.district)) return false;
  if (conditions.types.length > 0 && !conditions.types.includes(listing.type)) return false;
  if (conditions.sources.length > 0 && !conditions.sources.includes(listing.source)) return false;
  return true;
});

// === Slack 메시지 포맷 ===
const messages = filtered.map(listing => {
  const extras = [
    listing.parking ? '주차 가능' : null,
    listing.elevator ? '엘리베이터' : null,
  ].filter(Boolean).join(' · ');

  return [
    `*[${listing.source}] ${listing.title}*`,
    `분류: ${listing.source} · ${listing.type}`,
    `위치: ${listing.city} ${listing.district} ${listing.dong}`.trim(),
    listing.exclusiveArea > 0 ? `면적: 전용 ${listing.exclusiveArea}m² / 공용 ${listing.supplyArea}m²` : null,
    listing.deposit > 0 ? `금액: 보증금 ${(listing.deposit/10000).toLocaleString()}만원` + (listing.monthlyRent > 0 ? ` · 월세 ${(listing.monthlyRent/10000).toLocaleString()}만원` : '') : null,
    `신청기간: ${listing.startDate} ~ ${listing.endDate}`,
    extras ? `부가조건: ${extras}` : null,
    listing.url ? `<${listing.url}|공고 바로가기>` : null,
  ].filter(Boolean).join('\n');
});

return [{ json: { count: filtered.length, messages } }];
```

**Step 5: IF 노드 추가 (공고 있을 때만 알림)**

- 노드 추가: "IF"
- Condition: `{{ $json.count }}` Greater Than `0`

**Step 6: Slack 노드 추가 (알림 발송)**

- 노드 추가: "HTTP Request" (Slack 웹훅용)
- IF 노드의 "True" 출력에 연결
- Method: POST
- URL: `{{ $env.SLACK_WEBHOOK_URL }}`
- Body Content Type: JSON
- Body:
```json
{
  "text": "오늘의 SH/LH 공고 알림 ({{ $('Code').item.json.count }}건)",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "{{ $('Code').item.json.messages.join('\n\n---\n\n') }}"
      }
    }
  ]
}
```

**Step 7: 워크플로우 수동 테스트 실행**

n8n UI → "Execute Workflow" 버튼 클릭
- 각 노드 실행 결과 확인
- Code 노드 출력에서 `count`, `messages` 확인
- Slack 채널에서 메시지 수신 확인

**Step 8: 워크플로우 활성화**

n8n UI 우상단 토글 → "Active" 상태로 변경

**Step 9: 워크플로우 JSON export**

n8n UI → 메뉴 → "Download" → `sh-lh-alert/workflow/sh-lh-alert-workflow.json` 으로 저장

**Step 10: 커밋**

```bash
git add workflow/
git commit -m "feat: add n8n workflow export for SH/LH alert"
```

---

### Task 6: 멀티유저 지원 (가족/지인 추가)

**목적:** 다른 사람의 조건으로 추가 워크플로우 설정

**Step 1: 추가 사용자용 환경변수 세트 정의**

`.env.example`에 추가:
```bash
# 사용자2 (가족)
USER2_ASSET_LIMIT=
USER2_INCOME_LIMIT=
USER2_HOUSEHOLD_SIZE=
USER2_SLACK_WEBHOOK_URL=
```

**Step 2: n8n에서 워크플로우 복사**

n8n UI → 기존 워크플로우 → "Duplicate"
이름: "SH/LH 알림 - [이름]"

**Step 3: 복사된 워크플로우의 Code 노드 수정**

- `USER_CONDITIONS` 의 지역/유형을 해당 사용자 조건으로 변경
- `process.env.USER_ASSET_LIMIT` → `process.env.USER2_ASSET_LIMIT` 등으로 변경
- Slack 노드의 Webhook URL → `process.env.USER2_SLACK_WEBHOOK_URL`

**Step 4: 추가 워크플로우 export 저장**

`sh-lh-alert/workflow/sh-lh-alert-workflow-user2.json`

---

### Task 7: 배포 준비 (Railway or Oracle Cloud)

**목적:** 로컬 검증 완료 후 서버 배포를 위한 준비

**Step 1: 프로덕션용 docker-compose 작성**

```yaml
# sh-lh-alert/docker-compose.prod.yml
version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    ports:
      - "5678:5678"
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=${N8N_USER}
      - N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}
      - N8N_HOST=${N8N_HOST}          # 실제 도메인 (예: n8n.railway.app)
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://${N8N_HOST}/
      - USER_ASSET_LIMIT=${USER_ASSET_LIMIT}
      - USER_INCOME_LIMIT=${USER_INCOME_LIMIT}
      - USER_HOUSEHOLD_SIZE=${USER_HOUSEHOLD_SIZE}
      - USER_HAS_CAR=${USER_HAS_CAR}
      - PUBLIC_DATA_API_KEY=${PUBLIC_DATA_API_KEY}
      - SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL}
    volumes:
      - n8n_data:/home/node/.n8n
    restart: always

volumes:
  n8n_data:
```

**Step 2: 배포 방법 README 작성**

`sh-lh-alert/docs/deployment.md`:

```markdown
# 배포 가이드

## Railway 배포
1. Railway.app 에서 새 프로젝트 생성
2. Docker 서비스 추가 → docker-compose.prod.yml 사용
3. Railway 대시보드에서 환경변수 설정 (.env와 동일)
4. 배포 완료 후 n8n URL 확인

## n8n 워크플로우 마이그레이션
1. 로컬 n8n에서 워크플로우 export (workflow/*.json)
2. 서버 n8n에 접속
3. import workflow → JSON 파일 선택
4. 환경변수 확인 후 워크플로우 활성화

## Oracle Cloud Free Tier 배포
1. Oracle Cloud 무료 VM (Ampere) 생성
2. SSH 접속 후 Docker 설치
3. 이 repo clone
4. .env 파일 생성 후 docker compose -f docker-compose.prod.yml up -d
```

**Step 3: 최종 커밋**

```bash
git add docker-compose.prod.yml docs/deployment.md
git commit -m "feat: add production docker-compose and deployment guide"
```

---

## 검증 체크리스트

- [ ] `docker compose up` 후 `http://localhost:5678` 접속 가능
- [ ] n8n 워크플로우 수동 실행 시 공고 데이터 수집됨
- [ ] 필터링 후 조건 맞는 공고만 남음
- [ ] Slack 채널에 알림 메시지 수신됨
- [ ] 알림 메시지에 공고명/분류/위치/면적/금액/신청기간/링크 포함
- [ ] 스케줄러가 매일 오전 8시 실행 설정됨
- [ ] 워크플로우 JSON export 파일 저장됨

---

## 주의사항

- **API 필드명:** 공공API 실제 응답의 필드명은 API마다 다름. Task 2에서 확인한 실제 필드명으로 Code 노드의 파싱 부분 반드시 수정 필요.
- **크롤링 사용 시:** SH/LH 사이트 구조 변경 시 파싱 코드 업데이트 필요.
- **API 한도:** 공공데이터포털 API는 일일 호출 한도 있음. 하루 1회 실행이므로 문제없음.
