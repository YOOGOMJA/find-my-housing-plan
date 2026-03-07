# LH 공공주택 공고 알림 시스템 설계

작성일: 2026-03-07

## 개요

LH 공공데이터포털 API를 통해 임대주택 공고를 수집하고, 사용자 조건에 맞는 공고를 파싱하여 Slack으로 알림하는 로컬 실행형 TypeScript 파이프라인.

## 아키텍처

```
[index.ts] (진입점, npx ts-node src/index.ts)
  → [collector.ts]  LH API 1(목록) + API 3(공급정보) 호출
  → [parser.ts]     PDF 다운로드 → pdfjs-dist 텍스트 추출 → Claude API 구조화
  → [filter.ts]     공고 자격 조건 + 주택 선호 조건 매칭
  → [notifier.ts]   Slack Incoming Webhook 전송
  → [data/seen.json] 중복 방지 (처리된 공고 ID 저장)
```

## 모듈 구성

| 파일 | 역할 |
|------|------|
| `src/config.ts` | `.env` 파싱, 환경변수 타입 정의 및 유효성 검사 |
| `src/types.ts` | 공통 인터페이스 (`Notice`, `ParsedNotice`, `UserProfile`) |
| `src/collector.ts` | LH API 호출 (목록, 공급정보), `Notice[]` 반환 |
| `src/parser.ts` | PDF 파싱 + Claude API 구조화 추출, `ParsedNotice` 반환 |
| `src/filter.ts` | 사용자 프로필 대비 공고 조건 필터링 |
| `src/notifier.ts` | Slack 메시지 포맷 + 웹훅 전송 |
| `src/index.ts` | 파이프라인 진입점, seen.json 중복 관리 |

## 데이터 흐름

1. **수집 (collector)**: API 1로 신규 공고 목록 조회 → 미처리 공고만 선별 (seen.json 비교) → API 3로 공급정보(면적/세대수) 보완
2. **파싱 (parser)**: API 2 상세에서 PDF URL 추출 → pdfjs-dist로 텍스트 추출 → Claude API(haiku)로 구조화 (소득기준, 자산기준, 임대보증금, 월임대료 등)
3. **필터링 (filter)**: 공고 자격 조건(소득·자산·청약통장·무주택)과 주택 선호 조건(지역·면적·유형) 매칭
4. **알림 (notifier)**: 조건 충족 공고를 Slack 메시지로 포맷 후 전송

## 환경변수 (.env)

```bash
# API 키
PUBLIC_DATA_API_KEY=
ANTHROPIC_API_KEY=

# Slack
SLACK_WEBHOOK_URL=

# 사용자 기본 정보
USER_AGE=
USER_MARITAL_STATUS=        # single | married | newlywed
USER_HOUSEHOLD_SIZE=
USER_CURRENT_REGION=
USER_NO_HOME_YEARS=         # 무주택 기간 (년)

# 공고 자격 조건
USER_INCOME=                # 월 소득 (만원)
USER_ASSET=                 # 총자산 (만원)
USER_CAR_ASSET=             # 자동차 자산가액 (만원)
USER_SUBSCRIPTION_DATE=     # 청약통장 가입일 (YYYY-MM-DD)
USER_SUBSCRIPTION_COUNT=    # 청약통장 납입 횟수
USER_SUBSCRIPTION_AMOUNT=   # 청약통장 납입 총액 (만원)

# 주택 선호 조건
USER_REGIONS=               # 관심 지역 코드 콤마 구분 (예: 11,41,28)
USER_MIN_AREA=              # 최소 면적 (㎡)
USER_MAX_AREA=              # 최대 면적 (㎡)
USER_MIN_BUILD_YEAR=        # 최소 건축년도
USER_HOUSING_TYPES=         # 임대유형 코드 콤마 구분 (예: 06,13)
```

## 필터링 로직

### 공고 자격 조건 (notice conditions)
- 소득기준: Claude 추출값 파싱 → 도시근로자 월평균소득 비율 계산
- 자산기준: 총자산 한도 비교
- 자동차 자산: 차량 자산가액 한도 비교
- 청약통장: 납입 횟수 / 납입 총액 / 가입 기간 조건
- 무주택: `USER_NO_HOME_YEARS` 대비 공고 조건
- 결혼 여부 / 가구 구성: 신혼부부·청년 특별공급 자격 판단

### 주택 선호 조건 (housing conditions)
- 지역: `USER_REGIONS` 코드와 공고 CNP_CD 매칭
- 면적: `USER_MIN_AREA` ~ `USER_MAX_AREA` 범위
- 임대유형: `USER_HOUSING_TYPES`와 `UPP_AIS_TP_CD` 매칭
- 건축년도: `USER_MIN_BUILD_YEAR` 이상

## 중복 방지

`data/seen.json`에 처리된 `PAN_ID` 배열 저장. 실행 시마다 신규 공고만 파싱·알림 후 ID 추가.

## 기술 스택

- TypeScript (ts-node로 직접 실행)
- `pdfjs-dist` (legacy/build/pdf.mjs, dynamic import)
- `@anthropic-ai/sdk` (claude-haiku-4-5-20251001)
- LH 공공데이터포털 API (data.go.kr, B552555)
- Slack Incoming Webhook

## 실행 방법

```bash
npx ts-node src/index.ts
```

## 확장 계획 (미래)

- SH 공공주택 공고 수집 추가
- 서버 배포 (Railway / Oracle Free Tier)
- 다중 사용자 지원 (사용자별 .env 분리)
