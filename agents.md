# 빠른 참조

```bash
# n8n 시작
cd sh-lh-alert && docker compose up -d
# http://localhost:5678 (인증: .env의 N8N_USER / N8N_PASSWORD)

# 필터 로직 테스트
node filter/filter.test.js

# n8n 종료
docker compose down
```

## 프로젝트 개요

SH/LH 공공주택 공고를 매일 수집해 조건에 맞는 항목을 Slack으로 알림하는 자동화 시스템. 모든 워크플로우 로직은 n8n 안에 있으며, `sh-lh-alert/filter/`의 JS 코드만 독립적으로 개발/테스트 후 n8n Code 노드에 이식한다.

## 아키텍처

```
[n8n 스케줄러] 매일 오전 8시
  → [HTTP Request] data.go.kr 공공 API
      (데이터 부족 시 대체: i-sh.co.kr / lh.or.kr 크롤링)
  → [Code Node] 조건 필터링 (filter.js 로직)
  → [IF Node] 새 공고 있음? → YES: Slack 알림 / NO: 종료
```

## 프로젝트 구조

```
sh-lh-alert/
  docker-compose.yml        # 로컬 n8n
  docker-compose.prod.yml   # 프로덕션 (Railway/Oracle)
  .env                      # 시크릿 (gitignore)
  .env.example              # 환경변수 템플릿
  filter/
    filter.js               # filterListings() + formatSlackMessage()
    filter.test.js          # 테스트 (Node.js assert)
    sample-data.js          # 실제 API 응답 기반 픽스처
  workflow/
    *.json                  # n8n 워크플로우 내보내기 (사용자별 1개)
  docs/
    api-response-sample.json
    data-source-decision.md
    deployment.md
docs/plans/                 # 설계 및 구현 계획
```

## 설정 구조

환경변수 전체 목록: @sh-lh-alert/.env.example

| 구분 | 위치 | 항목 |
|------|------|------|
| 민감 정보 | `.env` | `USER_ASSET_LIMIT`, `USER_INCOME_LIMIT`, `USER_HOUSEHOLD_SIZE`, `USER_HAS_CAR`, `PUBLIC_DATA_API_KEY`, `SLACK_WEBHOOK_URL` |
| 일반 설정 | n8n Code 노드 JSON | `regions`, `districts`, `types`, `sources` |

다중 사용자: n8n 워크플로우를 복제하고 각각 다른 `.env`와 Slack 웹훅 URL 연결.

## 주의사항 (Gotchas)

- **API 필드명 불일치**: 공공 API 엔드포인트마다 필드명이 다름. 실제 응답은 `docs/api-response-sample.json` 참고 후 n8n Code 노드 파싱 부분 업데이트 필요.
- **filter.js 먼저, n8n 나중**: 로직 변경 시 반드시 `filter.test.js`로 검증 후 n8n Code 노드에 이식.
- **워크플로우 내보내기 필수**: n8n UI 수정 후 JSON을 `sh-lh-alert/workflow/`에 내보내고 커밋.
