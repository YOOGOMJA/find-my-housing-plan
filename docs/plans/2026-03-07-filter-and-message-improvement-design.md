# 필터 강화 및 메시지 개선 설계

작성일: 2026-03-07

## 1. 요약

현재 LH 파이프라인의 필터와 Slack 메시지를 개선해, 공고를 받은 즉시 자격 여부 확인 및 서류 준비가 가능한 수준으로 만든다.

---

## 2. 변경 목표

### 필터

| 필터 | 방식 | 변경 |
|---|---|---|
| 지역 | 구 단위 소프트 필터 추가 (구 포함 공고 우선, 없으면 면적/가격으로 판단) | 신규 |
| 면적 | min/max 하드 필터 | 유지 |
| 가격 | 보증금/월임대료 max 하드 필터 | 신규 |
| 자격 | 소득·자산·무주택기간·청약통장·특별공급 트랙 판정 | 강화 |

소프트 필터 정의: 해당 조건을 만족하는 공고를 우선 표시하되, 미충족이어도 면적·가격 조건이 맞으면 포함한다.
하드 필터 정의: 조건 미충족 시 제외한다.

### 메시지

- 공고 유형 강조 표시 (청년매입임대, 국민임대 등)
- 자격 판정 결과: `통과 / 미충족 / 확인 필요` 3단계로 표시
- 자격 조건 원문과 판정 결과를 함께 표시
- 공급 단지 정보: 주소 + 면적 + 보증금/월임대료
- 지도 링크: 주소가 있을 경우 네이버지도 / 구글지도 링크 자동 생성

---

## 3. 메시지 포맷 (목표 형태)

```
[청년매입임대] 2026년 3월 LH 청년 매입임대 모집
접수중 | 공고일: 2026.03.01 | 접수: 03.10 ~ 03.20

자격 판정
  통과  소득: 월 250만원 이하 → 통과
  통과  무주택: 2년 이상 → 통과
  확인  청약통장: 납입 12회 이상 → 확인 필요
  (원문: 도시근로자 월평균소득 70% 이하, 무주택세대구성원)

공급 단지
  서울시 송파구 잠실동 123-4
    59m2 | 보증금 8,000만원 / 월 25만원
    네이버지도 | 구글지도

  서울시 송파구 가락동 56-1
    46m2 | 보증금 6,500만원 / 월 20만원
    네이버지도 | 구글지도

  (단지 정보가 없는 경우: 유형별 요약으로 대체)
  A형 (59m2) 30세대 | 보증금 8,000만원 / 월 25만원

공고 상세 페이지 링크
```

---

## 4. 데이터 모델 변경

### UserProfile 확장

```typescript
interface UserProfile {
  // 기존
  age: number;
  maritalStatus: "single" | "married" | "newlywed";
  householdSize: number;
  currentRegion: string;
  noHomeYears: number;
  income: number;
  asset: number;
  carAsset: number;
  subscriptionDate: string;
  subscriptionCount: number;
  subscriptionAmount: number;
  regions: string[];
  minArea: number;
  maxArea: number;
  minBuildYear: number;
  housingTypes: string[];

  // 신규
  districts: string[];           // 선호 구 단위 지역 (소프트 필터)
  maxDeposit: number;            // 보증금 최대 (만원)
  maxRent: number;               // 월임대료 최대 (만원)
  applicantGroup:                // 특별공급 트랙
    | "general"
    | "youth"
    | "newlywed"
    | "newborn"
    | "multiChild"
    | null;
}
```

### SupplyItem 확장

```typescript
interface SupplyItem {
  type: string;
  area: number;
  count: number;
  address?: string | null;      // 신규: 단지 주소 (API 제공 시)
}
```

### ParsedConditions 강화

```typescript
interface ParsedConditions {
  // 기존
  incomeLimit: string | null;
  assetLimit: string | null;
  carAssetLimit: string | null;
  noHomeCondition: string | null;
  subscriptionCondition: string | null;
  deposit: Record<string, string>;
  rent: Record<string, string>;
  target: string | null;
  notes: string | null;

  // 신규: 수치 파싱 결과 (필터·판정용)
  depositAmount: Record<string, number | null>;   // 유형별 보증금 (만원)
  rentAmount: Record<string, number | null>;       // 유형별 월임대료 (만원)
  noHomeYearsRequired: number | null;              // 무주택 요구 기간
  subscriptionCountRequired: number | null;        // 청약통장 납입 요구 횟수
}
```

---

## 5. 판정 결과 타입

```typescript
type EligibilityResult = "pass" | "fail" | "unknown";

interface EligibilityCheck {
  label: string;           // "소득", "무주택", "청약통장" 등
  result: EligibilityResult;
  rawCondition: string | null;   // 원문 조건
  userValue: string | null;      // 내 값 (표시용)
}
```

판정 불가(`unknown`) 케이스: 공고 원문에서 조건을 파싱하지 못한 경우. 숨기지 않고 명시적으로 표시한다.

---

## 6. 지도 링크 생성 규칙

주소가 있을 경우 아래 패턴으로 URL 생성:

- 네이버지도: `https://map.naver.com/v5/search/{encodeURIComponent(address)}`
- 구글지도: `https://www.google.com/maps/search/{encodeURIComponent(address)}`

주소가 없으면 지도 링크 미표시.

---

## 7. 구현 범위 (변경 대상 파일)

| 파일 | 변경 내용 |
|---|---|
| `src/entities/notice/model/types.ts` | `SupplyItem.address`, `ParsedConditions` 필드 추가 |
| `src/entities/user/model/types.ts` | `UserProfile` 필드 추가 |
| `src/features/parse-notice/model/parse-notices.ts` | 단지 주소, 보증금/월임대료 수치, 무주택·청약통장 조건 파싱 강화 |
| `src/features/filter-notices/model/filter-notices.ts` | 구 소프트 필터, 가격 하드 필터, 자격 판정 강화 |
| `src/features/notify-slack/model/send-slack-notification.ts` | 유형 강조, 판정 결과 표시, 단지 정보 + 지도 링크 |
| `src/features/env-setup/` | 신규 UserProfile 필드 입력 프롬프트 추가 |

---

## 8. 외부 의존 없음

- DB 불필요: 상태는 기존 JSON 파일로 유지
- 추가 API 불필요: LH 공고 상세 API에서 단지 주소 포함 시 활용, 없으면 graceful fallback
- 추가 서비스 불필요: 지도 링크는 URL 패턴으로 생성

---

## 9. 미결 사항

- LH 공고 상세 API에서 단지별 주소 필드가 실제로 제공되는지 탐색 필요
- 무주택·청약통장 조건 텍스트 파싱 정확도는 공고 원문 샘플 기반으로 검증 필요
