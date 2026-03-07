# 필터 강화 및 메시지 개선 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** LH 파이프라인의 필터를 강화하고 Slack 메시지를 개선해, 공고 수신 즉시 자격 여부 확인 및 서류 준비가 가능한 수준으로 만든다.

**Architecture:** feat/#18/lh-pipeline 브랜치 위에서 작업. 타입 확장 → 파싱 강화 → 필터 강화 → 메시지 개선 → env-setup/config 확장 순서로 진행. DB 추가 없이 런타임 메모리에서 처리. 상태 파일(JSON)은 그대로 유지.

**Tech Stack:** TypeScript, Jest, pdfjs-dist, Anthropic SDK (claude-haiku-4-5-20251001), prompts

---

## 사전 준비

```bash
git checkout feat/#18/lh-pipeline
npx jest  # 기존 테스트 전체 통과 확인
```

---

## Task 1: 타입 정의 확장

**Files:**
- Modify: `src/entities/notice/model/types.ts`
- Modify: `src/entities/user/model/types.ts`

### Step 1: notice types에 신규 필드 추가

`src/entities/notice/model/types.ts`를 아래와 같이 수정한다.

```typescript
export type NoticeApplicationStatus = "upcoming" | "open" | "closed" | "unknown";

export interface Notice {
  panId: string;
  title: string;
  region: string;
  housingType: string;
  upperTypeName?: string | null;
  detailTypeName?: string | null;
  noticeDate: string;
  noticeUrl?: string | null;
  applicationStartDate?: string | null;
  applicationEndDate?: string | null;
  applicationStatus?: NoticeApplicationStatus;
  pdfUrl: string | null;
  supplyInfo: SupplyItem[];
}

export interface SupplyItem {
  type: string;
  area: number;
  count: number;
  address?: string | null;   // 신규: 단지 주소 (API/PDF에서 제공 시)
}

export interface ParsedConditions {
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
  depositAmount: Record<string, number | null>;
  rentAmount: Record<string, number | null>;
  noHomeYearsRequired: number | null;
  subscriptionCountRequired: number | null;
}

export interface ParsedNotice extends Notice {
  conditions: ParsedConditions;
}

// 신규: 자격 판정 결과 타입
export type EligibilityResult = "pass" | "fail" | "unknown";

export interface EligibilityCheck {
  label: string;
  result: EligibilityResult;
  rawCondition: string | null;
  userValue: string | null;
}
```

### Step 2: user types에 신규 필드 추가

`src/entities/user/model/types.ts`를 아래와 같이 수정한다.

```typescript
export interface UserProfile {
  // 기존 필드 유지
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
  districts: string[];           // 선호 구 단위 (소프트 필터, 예: ["송파구", "관악구"])
  maxDeposit: number;            // 보증금 최대 (만원, 0이면 필터 안 함)
  maxRent: number;               // 월임대료 최대 (만원, 0이면 필터 안 함)
  applicantGroup:
    | "general"
    | "youth"
    | "newlywed"
    | "newborn"
    | "multiChild"
    | null;
}
```

### Step 3: 기존 테스트가 깨지지 않는지 확인

```bash
npx jest
```

Expected: 기존 테스트 전체 통과 (타입 추가라 로직 변경 없음)

만약 `baseUser`를 쓰는 테스트에서 컴파일 오류가 나면, 각 테스트 파일의 `baseUser`에 신규 필드 기본값을 추가한다.

```typescript
// filter-notices.test.ts의 baseUser에 추가
districts: [],
maxDeposit: 0,
maxRent: 0,
applicantGroup: null,
```

### Step 4: 커밋

```bash
git add src/entities/notice/model/types.ts src/entities/user/model/types.ts
git commit -m "feat(#18): notice/user 타입에 자격판정·지역·가격 필드 추가"
```

---

## Task 2: Claude 프롬프트 및 파싱 로직 강화

**Files:**
- Modify: `src/features/parse-notice/model/parse-notices.ts`
- Test: `src/features/parse-notice/parse-notice.test.ts`

이 태스크의 목표: Claude가 PDF에서 단지 주소, 보증금/월임대료 수치, 무주택 기간, 청약통장 횟수를 추출하도록 프롬프트를 확장하고, 그 결과를 `ParsedConditions`에 반영한다.

### Step 1: 실패 테스트 작성

`src/features/parse-notice/parse-notice.test.ts`에서 `extractJsonFromText` 관련 테스트를 찾아 아래 테스트를 추가한다.

```typescript
describe("buildClaudePrompt 출력에서 신규 필드 파싱", () => {
  it("무주택 기간 숫자를 파싱한다", () => {
    const json = {
      무주택기간: "2년 이상",
    };
    const result = parseNoHomeYears(json["무주택기간"] as string);
    expect(result).toBe(2);
  });

  it("무주택 기간이 없으면 null", () => {
    expect(parseNoHomeYears(null)).toBeNull();
    expect(parseNoHomeYears("")).toBeNull();
  });

  it("청약통장 납입 횟수를 파싱한다", () => {
    const result = parseSubscriptionCount("12회 이상 납입");
    expect(result).toBe(12);
  });

  it("청약통장 횟수가 없으면 null", () => {
    expect(parseSubscriptionCount(null)).toBeNull();
  });

  it("보증금 수치를 파싱한다 (만원 단위)", () => {
    const result = parseAmountToManwon("8,671,000원");
    expect(result).toBe(867.1);  // 만원 단위로 변환
  });

  it("보증금 수치가 만원 표기면 그대로", () => {
    const result = parseAmountToManwon("8,000만원");
    expect(result).toBe(8000);
  });

  it("보증금 수치가 억 표기면 만원으로 변환", () => {
    const result = parseAmountToManwon("1억 2,000만원");
    expect(result).toBe(12000);
  });
});
```

`parseNoHomeYears`, `parseSubscriptionCount`, `parseAmountToManwon`은 아직 존재하지 않으므로 import해야 한다. 이 함수들을 export할 예정이므로 테스트 파일 상단에 추가:

```typescript
import {
  buildClaudePrompt,
  extractJsonFromText,
  parseNoHomeYears,
  parseSubscriptionCount,
  parseAmountToManwon,
} from ".";
```

### Step 2: 테스트 실패 확인

```bash
npx jest parse-notice
```

Expected: FAIL (함수 미존재)

### Step 3: `parse-notices.ts` 수정 — 유틸 함수 추가

`parse-notices.ts`에 다음 함수들을 추가한다.

```typescript
export function parseNoHomeYears(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*년/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return isFinite(value) ? value : null;
}

export function parseSubscriptionCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d+)\s*회/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return isFinite(value) ? value : null;
}

export function parseAmountToManwon(text: string | null | undefined): number | null {
  if (!text) return null;
  let total = 0;
  let matched = false;

  const eokMatch = text.match(/([\d,]+(?:\.\d+)?)\s*억/);
  if (eokMatch) {
    const eok = parseFloat(eokMatch[1].replace(/,/g, ""));
    if (isFinite(eok)) { total += eok * 10000; matched = true; }
  }

  const manMatch = text.match(/([\d,]+(?:\.\d+)?)\s*만\s*원/);
  if (manMatch) {
    const man = parseFloat(manMatch[1].replace(/,/g, ""));
    if (isFinite(man)) { total += man; matched = true; }
  }

  if (!matched) {
    // "8,671,000원" 형태 (원 단위) → 만원으로 변환
    const wonMatch = text.match(/([\d,]+)\s*원/);
    if (wonMatch) {
      const won = parseFloat(wonMatch[1].replace(/,/g, ""));
      if (isFinite(won)) { return won / 10000; }
    }
  }

  return matched ? total : null;
}
```

### Step 4: Claude 프롬프트 확장

`buildClaudePrompt` 함수의 프롬프트 문자열을 수정한다.

```typescript
export function buildClaudePrompt(noticeTitle: string, text: string): string {
  return `다음은 LH 공공임대주택 공고문 텍스트입니다. 아래 항목을 JSON으로 추출해줘. 명시되지 않은 항목은 null로 해줘.

공고명: ${noticeTitle}

---
${text.slice(0, 6000)}
---

추출할 항목:
{
  "신청대상": "청년/신혼부부/일반 등",
  "소득기준": "예: 도시근로자 월평균소득 70% 이하",
  "자산기준": "예: 총자산 3.61억 이하",
  "자동차기준": "예: 자동차 3,683만원 이하",
  "무주택조건": "예: 무주택세대구성원",
  "무주택기간": "예: 2년 이상 (숫자+년 형태로)",
  "청약통장조건": "예: 12회 이상 납입 (횟수 포함)",
  "임대보증금": {"26형": "금액"},
  "월임대료": {"26형": "금액"},
  "단지주소목록": ["서울시 송파구 잠실동 123-4", ...],
  "기타특이사항": "중요한 내용 요약"
}

JSON만 출력해줘.`;
}
```

### Step 5: `parseWithClaude` 반환값 확장

`emptyConditions()` 함수와 `parseWithClaude` 함수를 수정해 신규 필드를 반환한다.

```typescript
function emptyConditions(): ParsedConditions {
  return {
    incomeLimit: null,
    assetLimit: null,
    carAssetLimit: null,
    noHomeCondition: null,
    subscriptionCondition: null,
    deposit: {},
    rent: {},
    target: null,
    notes: null,
    depositAmount: {},
    rentAmount: {},
    noHomeYearsRequired: null,
    subscriptionCountRequired: null,
  };
}
```

`parseWithClaude` 내부에서 `deposit`/`rent` 파싱 후 수치도 함께 파싱한다.

```typescript
const depositMap = toStringRecord(parsed["임대보증금"]);
const rentMap = toStringRecord(parsed["월임대료"]);

const depositAmountMap: Record<string, number | null> = {};
for (const [key, val] of Object.entries(depositMap)) {
  depositAmountMap[key] = parseAmountToManwon(val);
}

const rentAmountMap: Record<string, number | null> = {};
for (const [key, val] of Object.entries(rentMap)) {
  rentAmountMap[key] = parseAmountToManwon(val);
}

// 단지 주소: supplyInfo의 address 필드는 Notice 레벨에서 반영하기 어려우므로
// notes에 포함 또는 별도 처리 (Task 3에서 사용)
const addressList = Array.isArray(parsed["단지주소목록"])
  ? (parsed["단지주소목록"] as unknown[]).filter((v): v is string => typeof v === "string")
  : [];

return {
  incomeLimit: optionalString(parsed["소득기준"]),
  assetLimit: optionalString(parsed["자산기준"]),
  carAssetLimit: optionalString(parsed["자동차기준"]),
  noHomeCondition: optionalString(parsed["무주택조건"]),
  subscriptionCondition: optionalString(parsed["청약통장조건"]),
  deposit: depositMap,
  rent: rentMap,
  target: optionalString(parsed["신청대상"]),
  notes: optionalString(parsed["기타특이사항"]),
  depositAmount: depositAmountMap,
  rentAmount: rentAmountMap,
  noHomeYearsRequired: parseNoHomeYears(optionalString(parsed["무주택기간"])),
  subscriptionCountRequired: parseSubscriptionCount(optionalString(parsed["청약통장조건"])),
};
```

단지 주소 목록은 `parseNotices` 함수에서 `Notice.supplyInfo`의 첫 번째 항목부터 순서대로 매핑한다. `supplyInfo` 개수와 주소 목록 개수가 다를 수 있으므로 index 범위 내에서만 적용한다.

```typescript
// parseNotices 내부, conditions 파싱 후:
const addresses = (conditions as any)._addressList as string[] | undefined;
const supplyInfoWithAddress = notice.supplyInfo.map((item, idx) => ({
  ...item,
  address: addresses?.[idx] ?? null,
}));
results.push({ ...notice, supplyInfo: supplyInfoWithAddress, conditions });
```

실제 구현 시 `_addressList`를 임시 필드로 쓰지 않고, `parseWithClaude`가 `{ conditions, addressList }` 형태로 반환하도록 리팩토링하는 것이 더 깔끔하다.

```typescript
// parseWithClaude 반환 타입 변경
async function parseWithClaude(
  anthropicKey: string,
  text: string,
  title: string,
): Promise<{ conditions: ParsedConditions; addressList: string[] }> {
  // ... 기존 코드 ...
  return {
    conditions: { ...conditionFields },
    addressList,
  };
}
```

`parseNotices` 내에서 호출부도 함께 수정한다.

### Step 6: 테스트 통과 확인

```bash
npx jest parse-notice
```

Expected: PASS

### Step 7: 커밋

```bash
git add src/features/parse-notice/
git commit -m "feat(#18): 단지주소·보증금수치·무주택기간·청약통장횟수 파싱 추가"
```

---

## Task 3: filter-notices 강화

**Files:**
- Modify: `src/features/filter-notices/model/filter-notices.ts`
- Modify: `src/features/filter-notices/index.ts` (신규 export 추가)
- Test: `src/features/filter-notices/filter-notices.test.ts`

### Step 1: 테스트 파일에 baseUser 신규 필드 추가

기존 `baseUser`에 신규 필드 기본값을 추가한다.

```typescript
const baseUser: UserProfile = {
  // 기존 필드 ...
  districts: [],
  maxDeposit: 0,
  maxRent: 0,
  applicantGroup: null,
};
```

`baseNotice`의 `conditions`에도 신규 필드를 추가한다.

```typescript
conditions: {
  // 기존 필드 ...
  depositAmount: { "26": 867 },
  rentAmount: { "26": 14 },
  noHomeYearsRequired: null,
  subscriptionCountRequired: null,
},
```

### Step 2: 구 단위 소프트 필터 테스트 작성

```typescript
describe("구 단위 소프트 필터 (matchesDistrict)", () => {
  it("districts가 비어있으면 항상 true", () => {
    const notice = { ...baseNotice, supplyInfo: [{ ...baseNotice.supplyInfo[0], address: "서울시 강남구 역삼동 1" }] };
    expect(matchesDistrict(notice, { ...baseUser, districts: [] })).toBe(true);
  });

  it("공급 단지 주소에 선호 구가 포함되면 true", () => {
    const notice = { ...baseNotice, supplyInfo: [{ ...baseNotice.supplyInfo[0], address: "서울시 송파구 잠실동 1" }] };
    expect(matchesDistrict(notice, { ...baseUser, districts: ["송파구"] })).toBe(true);
  });

  it("공급 단지 주소에 선호 구가 없으면 false", () => {
    const notice = { ...baseNotice, supplyInfo: [{ ...baseNotice.supplyInfo[0], address: "서울시 강남구 역삼동 1" }] };
    expect(matchesDistrict(notice, { ...baseUser, districts: ["송파구"] })).toBe(false);
  });

  it("주소 정보가 없으면 true (알 수 없음)", () => {
    const notice = { ...baseNotice, supplyInfo: [{ ...baseNotice.supplyInfo[0], address: null }] };
    expect(matchesDistrict(notice, { ...baseUser, districts: ["송파구"] })).toBe(true);
  });
});
```

### Step 3: 가격 하드 필터 테스트 작성

```typescript
describe("가격 하드 필터 (matchesPrice)", () => {
  it("maxDeposit가 0이면 보증금 필터 안 함", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, depositAmount: { "26": 20000 } } };
    expect(matchesPrice(notice, { ...baseUser, maxDeposit: 0 })).toBe(true);
  });

  it("보증금이 maxDeposit 이하면 true", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, depositAmount: { "26": 8000 } } };
    expect(matchesPrice(notice, { ...baseUser, maxDeposit: 10000 })).toBe(true);
  });

  it("보증금이 maxDeposit 초과면 false", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, depositAmount: { "26": 12000 } } };
    expect(matchesPrice(notice, { ...baseUser, maxDeposit: 10000 })).toBe(false);
  });

  it("여러 공급 유형 중 하나라도 범위 내면 true", () => {
    const notice = {
      ...baseNotice,
      conditions: { ...baseNotice.conditions, depositAmount: { "26": 12000, "36": 8000 } },
    };
    expect(matchesPrice(notice, { ...baseUser, maxDeposit: 10000 })).toBe(true);
  });
});
```

### Step 4: 자격 판정 테스트 작성

```typescript
describe("자격 판정 (buildEligibilityChecks)", () => {
  it("소득 통과 케이스", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, incomeLimit: "월평균소득 70% 이하 (250만원)" } };
    const checks = buildEligibilityChecks(notice, { ...baseUser, income: 200 });
    const income = checks.find((c) => c.label === "소득");
    expect(income?.result).toBe("pass");
  });

  it("소득 초과 케이스", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, incomeLimit: "200만원 이하" } };
    const checks = buildEligibilityChecks(notice, { ...baseUser, income: 300 });
    const income = checks.find((c) => c.label === "소득");
    expect(income?.result).toBe("fail");
  });

  it("무주택 기간 미달 케이스", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, noHomeYearsRequired: 3 } };
    const checks = buildEligibilityChecks(notice, { ...baseUser, noHomeYears: 1 });
    const noHome = checks.find((c) => c.label === "무주택");
    expect(noHome?.result).toBe("fail");
  });

  it("무주택 기간 정보 없으면 unknown", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, noHomeYearsRequired: null } };
    const checks = buildEligibilityChecks(notice, baseUser);
    const noHome = checks.find((c) => c.label === "무주택");
    expect(noHome?.result).toBe("unknown");
  });

  it("청약통장 횟수 통과 케이스", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, subscriptionCountRequired: 12 } };
    const checks = buildEligibilityChecks(notice, { ...baseUser, subscriptionCount: 24 });
    const sub = checks.find((c) => c.label === "청약통장");
    expect(sub?.result).toBe("pass");
  });
});
```

### Step 5: 테스트 실패 확인

```bash
npx jest filter-notices
```

Expected: FAIL (함수 미존재)

### Step 6: 필터 함수 구현

`src/features/filter-notices/model/filter-notices.ts`에 추가한다.

```typescript
import { EligibilityCheck, EligibilityResult, ParsedNotice } from "../../../entities/notice";
import { UserProfile } from "../../../entities/user";

// 기존 함수들 유지 (parseAssetLimit, parseIncomeLimit, matchesRegion 등)

export function matchesDistrict(notice: ParsedNotice, user: UserProfile): boolean {
  if (user.districts.length === 0) return true;

  const allAddresses = notice.supplyInfo
    .map((s) => s.address ?? "")
    .filter(Boolean);

  if (allAddresses.length === 0) return true; // 주소 없으면 필터 안 함

  return user.districts.some((district) =>
    allAddresses.some((addr) => addr.includes(district))
  );
}

export function matchesPrice(notice: ParsedNotice, user: UserProfile): boolean {
  const { depositAmount, rentAmount } = notice.conditions;

  if (user.maxDeposit > 0 && Object.keys(depositAmount).length > 0) {
    const anyDepositInRange = Object.values(depositAmount).some(
      (amount) => amount === null || amount <= user.maxDeposit
    );
    if (!anyDepositInRange) return false;
  }

  if (user.maxRent > 0 && Object.keys(rentAmount).length > 0) {
    const anyRentInRange = Object.values(rentAmount).some(
      (amount) => amount === null || amount <= user.maxRent
    );
    if (!anyRentInRange) return false;
  }

  return true;
}

export function buildEligibilityChecks(notice: ParsedNotice, user: UserProfile): EligibilityCheck[] {
  const checks: EligibilityCheck[] = [];

  // 소득 판정
  if (notice.conditions.incomeLimit) {
    const limit = parseIncomeLimit(notice.conditions.incomeLimit);
    const result: EligibilityResult = limit === null ? "unknown" : user.income <= limit ? "pass" : "fail";
    checks.push({
      label: "소득",
      result,
      rawCondition: notice.conditions.incomeLimit,
      userValue: `월 ${user.income}만원`,
    });
  }

  // 자산 판정
  if (notice.conditions.assetLimit) {
    const limit = parseAssetLimit(notice.conditions.assetLimit);
    const result: EligibilityResult = limit === null ? "unknown" : user.asset <= limit ? "pass" : "fail";
    checks.push({
      label: "자산",
      result,
      rawCondition: notice.conditions.assetLimit,
      userValue: `${user.asset}만원`,
    });
  }

  // 무주택 판정
  if (notice.conditions.noHomeCondition || notice.conditions.noHomeYearsRequired !== null) {
    const required = notice.conditions.noHomeYearsRequired;
    const result: EligibilityResult =
      required === null ? "unknown" : user.noHomeYears >= required ? "pass" : "fail";
    checks.push({
      label: "무주택",
      result,
      rawCondition: notice.conditions.noHomeCondition,
      userValue: `${user.noHomeYears}년`,
    });
  }

  // 청약통장 판정
  if (notice.conditions.subscriptionCondition || notice.conditions.subscriptionCountRequired !== null) {
    const required = notice.conditions.subscriptionCountRequired;
    const result: EligibilityResult =
      required === null ? "unknown" : user.subscriptionCount >= required ? "pass" : "fail";
    checks.push({
      label: "청약통장",
      result,
      rawCondition: notice.conditions.subscriptionCondition,
      userValue: `${user.subscriptionCount}회`,
    });
  }

  return checks;
}

// 기존 filterNotices 수정: district + price 필터 추가
export function filterNotices(notices: ParsedNotice[], user: UserProfile): ParsedNotice[] {
  return notices.filter(
    (notice) =>
      matchesHousingPreference(notice, user) &&
      matchesPrice(notice, user) &&
      matchesNoticeEligibility(notice, user),
    // matchesDistrict는 소프트 필터 → 제외가 아닌 정렬로 처리 (메시지에서 강조)
  );
}
```

> **소프트 필터 구현 방식**: `matchesDistrict`는 하드 필터로 적용하지 않는다. 대신 Slack 메시지 포맷 단계에서 선호 구가 포함된 공급 단지를 상단에 표시하고 강조한다.

### Step 7: index.ts에 신규 함수 export 추가

`src/features/filter-notices/index.ts`에 신규 함수들을 추가로 export한다.

```typescript
export { filterNotices, matchesHousingPreference, matchesNoticeEligibility, matchesDistrict, matchesPrice, buildEligibilityChecks } from "./model/filter-notices";
```

### Step 8: 테스트 통과 확인

```bash
npx jest filter-notices
```

Expected: PASS

### Step 9: 커밋

```bash
git add src/features/filter-notices/
git commit -m "feat(#18): 구 소프트 필터·가격 필터·자격판정 함수 추가"
```

---

## Task 4: Slack 메시지 개선

**Files:**
- Modify: `src/features/notify-slack/model/send-slack-notification.ts`
- Test: `src/features/notify-slack/notify-slack.test.ts`

### Step 1: 테스트 파일에 신규 필드 반영

기존 테스트의 `ParsedNotice` fixture에 신규 `conditions` 필드를 추가한다.

```typescript
conditions: {
  // 기존 ...
  depositAmount: { "26": 867 },
  rentAmount: { "26": 14 },
  noHomeYearsRequired: null,
  subscriptionCountRequired: null,
},
```

`UserProfile` fixture에도 신규 필드를 추가한다.

```typescript
districts: ["송파구"],
maxDeposit: 0,
maxRent: 0,
applicantGroup: "youth",
```

### Step 2: 신규 메시지 포맷 테스트 작성

`src/features/notify-slack/notify-slack.test.ts`에 추가한다.

```typescript
import { buildEligibilityChecks } from "../../filter-notices";
import { formatSlackMessage } from ".";

describe("formatSlackMessage — 판정 결과 포함", () => {
  it("자격 판정 결과를 포함한다", () => {
    const checks = buildEligibilityChecks(baseNotice, baseUser);
    const msg = formatSlackMessage(baseNotice, checks, baseUser.districts);
    expect(msg.text).toContain("자격 판정");
  });

  it("통과 항목에 pass 표시가 포함된다", () => {
    const checks = [{ label: "소득", result: "pass" as const, rawCondition: "200만원 이하", userValue: "150만원" }];
    const msg = formatSlackMessage(baseNotice, checks, []);
    expect(msg.text).toContain("통과");
  });

  it("fail 항목에 미충족 표시가 포함된다", () => {
    const checks = [{ label: "소득", result: "fail" as const, rawCondition: "200만원 이하", userValue: "300만원" }];
    const msg = formatSlackMessage(baseNotice, checks, []);
    expect(msg.text).toContain("미충족");
  });

  it("unknown 항목에 확인필요 표시가 포함된다", () => {
    const checks = [{ label: "청약통장", result: "unknown" as const, rawCondition: null, userValue: "24회" }];
    const msg = formatSlackMessage(baseNotice, checks, []);
    expect(msg.text).toContain("확인필요");
  });
});

describe("formatSlackMessage — 단지 정보", () => {
  it("주소가 있는 공급 단지에 지도 링크를 포함한다", () => {
    const notice = {
      ...baseNotice,
      supplyInfo: [{ type: "26", area: 26.92, count: 10, address: "서울시 송파구 잠실동 1" }],
    };
    const msg = formatSlackMessage(notice, [], []);
    expect(msg.text).toContain("map.naver.com");
    expect(msg.text).toContain("maps/search");
  });

  it("선호 구가 포함된 단지를 강조한다", () => {
    const notice = {
      ...baseNotice,
      supplyInfo: [
        { type: "26", area: 26.92, count: 10, address: "서울시 송파구 잠실동 1" },
        { type: "36", area: 36, count: 5, address: "서울시 강남구 역삼동 1" },
      ],
    };
    const msg = formatSlackMessage(notice, [], ["송파구"]);
    expect(msg.text).toContain("선호");
  });
});
```

### Step 3: 테스트 실패 확인

```bash
npx jest notify-slack
```

Expected: FAIL (formatSlackMessage 시그니처 변경)

### Step 4: `formatSlackMessage` 시그니처 변경 및 구현

```typescript
export function formatSlackMessage(
  notice: ParsedNotice,
  eligibilityChecks: EligibilityCheck[],
  preferredDistricts: string[],
): SlackMessage {
  // 유형 강조 표시
  const typeLabel = formatNoticeType(notice);
  const typeBadge = `[${typeLabel}]`;

  // 자격 판정 섹션
  const eligibilityLines = eligibilityChecks.map((check) => {
    const icon = check.result === "pass" ? "통과" : check.result === "fail" ? "미충족" : "확인필요";
    const raw = check.rawCondition ? ` (${check.rawCondition})` : "";
    return `  ${icon} ${check.label}: ${check.userValue ?? ""}${raw}`;
  });

  // 공급 단지 섹션
  const supplyLines = notice.supplyInfo.map((item) => {
    const deposit = notice.conditions.deposit[item.type] ?? "-";
    const rent = notice.conditions.rent[item.type] ?? "-";
    const preferred = preferredDistricts.length > 0 && item.address
      ? preferredDistricts.some((d) => item.address!.includes(d))
      : false;
    const prefixMark = preferred ? " [선호지역]" : "";

    const addressLine = item.address
      ? `  ${item.address}${prefixMark}`
      : `  ${item.type}형${prefixMark}`;

    const priceLine = `    ${item.area}m2 ${item.count}세대 | 보증금 ${deposit} / 월임대료 ${rent}`;

    let mapLine = "";
    if (item.address) {
      const encoded = encodeURIComponent(item.address);
      const naver = `https://map.naver.com/v5/search/${encoded}`;
      const google = `https://www.google.com/maps/search/${encoded}`;
      mapLine = `\n    <${naver}|네이버지도> | <${google}|구글지도>`;
    }

    return `${addressLine}\n${priceLine}${mapLine}`;
  });

  const lines: string[] = [
    `🏠 *${typeBadge} ${notice.title}*`,
    `📌 접수상태: *${formatApplicationStatus(notice.applicationStatus)}*`,
    `🗓️ 공고일: ${formatNoticeDateValue(notice.noticeDate)}`,
    `⏰ 접수기간: ${formatApplicationPeriod(
      notice.applicationStartDate,
      notice.applicationEndDate,
      notice.applicationStatus,
    )}`,
  ];

  if (eligibilityLines.length > 0) {
    lines.push("", "✅ *자격 판정*", ...eligibilityLines);
  }

  lines.push("", "🏢 *공급 단지*");
  if (supplyLines.length > 0) {
    lines.push(...supplyLines);
  } else {
    lines.push("  - 공급정보 없음");
  }

  if (notice.conditions.notes) {
    lines.push("", "📝 *비고*", formatNotes(notice.conditions.notes));
  }

  lines.push("", `🔗 ${formatNoticeLink(notice.noticeUrl)}`);

  return { text: lines.join("\n") };
}
```

### Step 5: `sendSlackNotification` 호출부 수정

`sendSlackNotification` 함수가 `UserProfile`을 받아 `buildEligibilityChecks`와 `preferredDistricts`를 전달하도록 수정한다.

```typescript
import { buildEligibilityChecks } from "../../filter-notices";
import { UserProfile } from "../../../entities/user";

export async function sendSlackNotification(
  webhookUrl: string,
  notices: ParsedNotice[],
  user: UserProfile,              // 신규 파라미터
  onProgress?: ProgressReporter,
): Promise<void> {
  // ... 기존 grouped/order 로직 ...

  for (const notice of bucketNotices) {
    const checks = buildEligibilityChecks(notice, user);
    const message = formatSlackMessage(notice, checks, user.districts);
    await postToSlack(webhookUrl, message);
    // ...
  }
}
```

### Step 6: `app/main.ts`에서 호출부 수정

`sendSlackNotification(webhookUrl, notices)` → `sendSlackNotification(webhookUrl, notices, config.user)`

### Step 7: 테스트 통과 확인

```bash
npx jest notify-slack
npx jest  # 전체
```

Expected: PASS

### Step 8: 커밋

```bash
git add src/features/notify-slack/ src/app/main.ts
git commit -m "feat(#18): Slack 메시지에 유형강조·자격판정·단지주소·지도링크 추가"
```

---

## Task 5: env-setup 및 app-config 확장

**Files:**
- Modify: `src/features/env-setup/ui/prompts.ts`
- Modify: `src/features/env-setup/model/constants.ts` (필요 시)
- Modify: `src/shared/config/app-config.ts`
- Modify: `.env.example`

### Step 1: `promptFilter`에 신규 항목 추가

`src/features/env-setup/ui/prompts.ts`의 `promptFilter` 함수에 다음 항목을 추가한다.

```typescript
// 기존 detail prompts 배열 끝에 추가
{
  type: "text",
  name: "districts",
  message: "선호 구 단위 지역 (쉼표 구분, 없으면 엔터) (USER_DISTRICTS)",
  initial: env.USER_DISTRICTS ?? "",
},
{
  type: "number",
  name: "maxDeposit",
  message: "보증금 최대 (만원, 0이면 필터 안 함) (USER_MAX_DEPOSIT)",
  initial: Number.parseFloat(env.USER_MAX_DEPOSIT ?? "0"),
  min: 0,
},
{
  type: "number",
  name: "maxRent",
  message: "월임대료 최대 (만원, 0이면 필터 안 함) (USER_MAX_RENT)",
  initial: Number.parseFloat(env.USER_MAX_RENT ?? "0"),
  min: 0,
},
{
  type: "select",
  name: "applicantGroup",
  message: "특별공급 신청 트랙 (USER_APPLICANT_GROUP)",
  choices: [
    { title: "일반 (general)", value: "general" },
    { title: "청년 (youth)", value: "youth" },
    { title: "신혼부부 (newlywed)", value: "newlywed" },
    { title: "신생아 (newborn)", value: "newborn" },
    { title: "다자녀 (multiChild)", value: "multiChild" },
  ],
  initial: 0,
},
```

반환값에도 추가한다.

```typescript
return {
  // 기존 ...
  USER_DISTRICTS: String(detail.districts ?? ""),
  USER_MAX_DEPOSIT: String(detail.maxDeposit ?? 0),
  USER_MAX_RENT: String(detail.maxRent ?? 0),
  USER_APPLICANT_GROUP: String(detail.applicantGroup ?? "general"),
};
```

### Step 2: `app-config.ts`에서 신규 필드 읽기

`loadConfig()`의 `user` 객체에 신규 필드를 추가한다.

```typescript
const user: UserProfile = {
  // 기존 필드 ...
  districts: splitCsv(optionalEnv("USER_DISTRICTS", "")),
  maxDeposit: parseFloatValue(optionalEnv("USER_MAX_DEPOSIT", "0"), "USER_MAX_DEPOSIT"),
  maxRent: parseFloatValue(optionalEnv("USER_MAX_RENT", "0"), "USER_MAX_RENT"),
  applicantGroup: parseApplicantGroup(optionalEnv("USER_APPLICANT_GROUP", "general")),
};
```

`parseApplicantGroup` 함수를 추가한다.

```typescript
function parseApplicantGroup(value: string): UserProfile["applicantGroup"] {
  const valid = ["general", "youth", "newlywed", "newborn", "multiChild"] as const;
  return (valid as readonly string[]).includes(value)
    ? (value as UserProfile["applicantGroup"])
    : null;
}
```

### Step 3: `.env.example`에 신규 항목 추가

```
USER_DISTRICTS=송파구,관악구   # 선호 구 단위 (쉼표 구분, 소프트 필터)
USER_MAX_DEPOSIT=15000         # 보증금 최대 (만원, 0이면 필터 안 함)
USER_MAX_RENT=50               # 월임대료 최대 (만원, 0이면 필터 안 함)
USER_APPLICANT_GROUP=youth     # general|youth|newlywed|newborn|multiChild
```

### Step 4: 전체 테스트 통과 확인

```bash
npx jest
```

Expected: PASS

### Step 5: 커밋

```bash
git add src/features/env-setup/ src/shared/config/ .env.example
git commit -m "feat(#18): env-setup·app-config에 구필터·가격·신청트랙 설정 추가"
```

---

## Task 6: 통합 확인

### Step 1: 전체 테스트 최종 확인

```bash
npx jest --verbose
```

Expected: PASS (전체)

### Step 2: 실제 실행 확인 (선택)

`.env`에 신규 환경변수를 추가한 뒤 실행한다.

```bash
npx ts-node src/index.ts
```

Slack에 아래 형태의 메시지가 수신되는지 확인한다.
- `[청년매입임대] 공고명` 형태의 유형 강조 표시
- 자격 판정 섹션 (통과/미충족/확인필요)
- 단지 주소 + 보증금/월임대료 + 지도 링크

### Step 3: 미결 사항 메모

LH 공고 상세 API에서 단지 주소 필드가 실제로 제공되는지는 `explore/lh-api-probe.js`를 실행해 응답 원문을 확인해야 한다. 주소 파싱이 작동하지 않는 공고에서는 기존 유형별 요약 표시로 graceful fallback된다.

---

## 주요 명령 정리

```bash
# 테스트 전체
npx jest

# 특정 feature만
npx jest parse-notice
npx jest filter-notices
npx jest notify-slack

# 실행
npx ts-node src/index.ts
```

## 커밋 흐름 요약

```
feat(#18): notice/user 타입에 자격판정·지역·가격 필드 추가
feat(#18): 단지주소·보증금수치·무주택기간·청약통장횟수 파싱 추가
feat(#18): 구 소프트 필터·가격 필터·자격판정 함수 추가
feat(#18): Slack 메시지에 유형강조·자격판정·단지주소·지도링크 추가
feat(#18): env-setup·app-config에 구필터·가격·신청트랙 설정 추가
```
