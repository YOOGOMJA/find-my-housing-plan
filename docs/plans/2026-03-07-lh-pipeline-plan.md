# LH 공공주택 공고 알림 파이프라인 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** LH API로 공고를 수집하고, PDF를 파싱해 사용자 조건에 맞는 공고를 Slack으로 알림하는 TypeScript 파이프라인 구축

**Architecture:** TypeScript 모듈형 파이프라인 (config → types → collector → parser → filter → notifier → index). ts-node로 직접 실행, node-cron 없음. seen.json으로 중복 방지.

**Tech Stack:** TypeScript, ts-node, pdfjs-dist (legacy .mjs, dynamic import), @anthropic-ai/sdk (claude-haiku-4-5-20251001), LH 공공데이터 API (data.go.kr B552555), Slack Incoming Webhook, Jest + ts-jest (테스트)

---

## 참고: 탐색 단계에서 파악한 LH API 구조

- **API 1** (목록): `https://api.odcloud.kr/api/15056908/v1/uddi:...` → 응답 body가 배열 `[{dsSch:[...]}, {dsList01:[...], resHeader:[...]}]`
- **API 2** (상세): `getLeaseNoticeDtlInfo1` → `dsAhflInfo[].AHFL_URL`에 PDF URL
- **API 3** (공급정보): `lhLeaseNoticeSplInfo1` → `dsList01[].DDO_AR`(전용면적), `RFE`(임대료), `LS_GMY`(보증금) → 보통 "공고문 참조"로 와서 PDF 파싱 필요
- extractItems 함수: `body[i][key]`가 배열인 첫 번째 청크에서 추출
- 공고 ID 필드: `PAN_ID`, 유형코드: `UPP_AIS_TP_CD`, 지역코드: `CNP_CD`

---

## Task 1: 프로젝트 초기 설정 (TypeScript + Jest)

**Files:**
- Create: `tsconfig.json`
- Create: `jest.config.js`
- Modify: `package.json`

**Step 1: TypeScript와 테스트 의존성 설치**

```bash
npm install --save-dev typescript ts-node @types/node jest ts-jest @types/jest
```

**Step 2: tsconfig.json 생성**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: jest.config.js 생성**

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};
```

**Step 4: package.json scripts 추가**

`package.json`의 `"scripts"` 섹션을 수정:
```json
"scripts": {
  "start": "ts-node src/index.ts",
  "test": "jest"
}
```

**Step 5: src/ 및 data/ 디렉토리 생성**

```bash
mkdir -p src data
echo '[]' > data/seen.json
echo 'node_modules\ndist\n.env\ndata/seen.json' >> .gitignore
```

**Step 6: 설정 확인**

```bash
npx tsc --version
npx jest --version
```

Expected: 버전 출력

**Step 7: 커밋**

```bash
git add tsconfig.json jest.config.js package.json package-lock.json .gitignore
git commit -m "chore(#<issue>): TypeScript 및 Jest 초기 설정"
```

---

## Task 2: 타입 정의 (`src/types.ts`)

**Files:**
- Create: `src/types.ts`

**Step 1: 타입 파일 작성**

```typescript
// src/types.ts

/** LH API 1(목록)에서 수집한 공고 기본 정보 */
export interface Notice {
  panId: string;           // PAN_ID
  title: string;           // LCC_NT_NM
  region: string;          // CNP_CD (지역코드 예: "11")
  housingType: string;     // UPP_AIS_TP_CD (임대유형 예: "06")
  noticeDate: string;      // PAN_DT (공고일 예: "20260307")
  pdfUrl: string | null;   // API 2에서 추출
  supplyInfo: SupplyItem[]; // API 3에서 추출
}

/** API 3 공급정보 항목 (면적별) */
export interface SupplyItem {
  type: string;            // HTY_NNA (주택형 예: "26")
  area: number;            // DDO_AR (전용면적 ㎡)
  count: number;           // NOW_HSH_CNT (금회 공급 세대수)
}

/** Claude API 파싱 결과 */
export interface ParsedConditions {
  incomeLimit: string | null;       // 소득기준 (예: "도시근로자 월평균소득 70% 이하")
  assetLimit: string | null;        // 자산기준 (예: "3.61억 이하")
  carAssetLimit: string | null;     // 자동차기준
  noHomeCondition: string | null;   // 무주택조건
  subscriptionCondition: string | null; // 청약통장 조건
  deposit: Record<string, string>;  // 임대보증금 (예: {"26": "8,671,000원"})
  rent: Record<string, string>;     // 월임대료
  target: string | null;            // 신청대상 (예: "청년", "신혼부부")
  notes: string | null;             // 기타특이사항
}

/** 파싱 완료된 공고 (필터링 입력) */
export interface ParsedNotice extends Notice {
  conditions: ParsedConditions;
}

/** 사용자 프로필 (환경변수에서 로드) */
export interface UserProfile {
  age: number;
  maritalStatus: "single" | "married" | "newlywed";
  householdSize: number;
  currentRegion: string;
  noHomeYears: number;
  income: number;          // 월 소득 (만원)
  asset: number;           // 총자산 (만원)
  carAsset: number;        // 자동차 자산가액 (만원)
  subscriptionDate: string; // YYYY-MM-DD
  subscriptionCount: number;
  subscriptionAmount: number; // 납입 총액 (만원)
  regions: string[];        // 관심 지역 코드 배열
  minArea: number;
  maxArea: number;
  minBuildYear: number;
  housingTypes: string[];   // 임대유형 코드 배열
}
```

**Step 2: 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

**Step 3: 커밋**

```bash
git add src/types.ts
git commit -m "feat(#<issue>): 공통 타입 정의 추가"
```

---

## Task 3: 설정 모듈 (`src/config.ts`)

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

**Step 1: 실패하는 테스트 작성**

```typescript
// src/config.test.ts
import { loadConfig } from "./config";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("필수 환경변수가 모두 있으면 설정 객체를 반환한다", () => {
    process.env.PUBLIC_DATA_API_KEY = "test-api-key";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    process.env.USER_AGE = "30";
    process.env.USER_MARITAL_STATUS = "single";
    process.env.USER_HOUSEHOLD_SIZE = "1";
    process.env.USER_CURRENT_REGION = "11";
    process.env.USER_NO_HOME_YEARS = "5";
    process.env.USER_INCOME = "300";
    process.env.USER_ASSET = "30000";
    process.env.USER_CAR_ASSET = "0";
    process.env.USER_SUBSCRIPTION_DATE = "2020-01-01";
    process.env.USER_SUBSCRIPTION_COUNT = "24";
    process.env.USER_SUBSCRIPTION_AMOUNT = "480";
    process.env.USER_REGIONS = "11,41";
    process.env.USER_MIN_AREA = "20";
    process.env.USER_MAX_AREA = "60";
    process.env.USER_MIN_BUILD_YEAR = "2010";
    process.env.USER_HOUSING_TYPES = "06,13";

    const config = loadConfig();
    expect(config.apiKey).toBe("test-api-key");
    expect(config.user.age).toBe(30);
    expect(config.user.regions).toEqual(["11", "41"]);
    expect(config.user.housingTypes).toEqual(["06", "13"]);
    expect(config.user.maritalStatus).toBe("single");
  });

  it("필수 환경변수 누락 시 오류를 던진다", () => {
    process.env.PUBLIC_DATA_API_KEY = "";
    expect(() => loadConfig()).toThrow("PUBLIC_DATA_API_KEY");
  });
});
```

**Step 2: 테스트 실행해 실패 확인**

```bash
npx jest src/config.test.ts
```

Expected: FAIL "Cannot find module './config'"

**Step 3: config.ts 구현**

```typescript
// src/config.ts
import * as fs from "fs";
import * as path from "path";
import { UserProfile } from "./types";

export interface AppConfig {
  apiKey: string;
  anthropicKey: string;
  slackWebhookUrl: string;
  user: UserProfile;
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`환경변수 누락: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  }
}

export function loadConfig(): AppConfig {
  const apiKey = requireEnv("PUBLIC_DATA_API_KEY");
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");
  const slackWebhookUrl = requireEnv("SLACK_WEBHOOK_URL");

  const maritalRaw = optionalEnv("USER_MARITAL_STATUS", "single");
  if (!["single", "married", "newlywed"].includes(maritalRaw)) {
    throw new Error("USER_MARITAL_STATUS는 single | married | newlywed 중 하나여야 합니다.");
  }

  const user: UserProfile = {
    age: parseInt(requireEnv("USER_AGE")),
    maritalStatus: maritalRaw as UserProfile["maritalStatus"],
    householdSize: parseInt(optionalEnv("USER_HOUSEHOLD_SIZE", "1")),
    currentRegion: optionalEnv("USER_CURRENT_REGION", ""),
    noHomeYears: parseFloat(optionalEnv("USER_NO_HOME_YEARS", "0")),
    income: parseFloat(optionalEnv("USER_INCOME", "0")),
    asset: parseFloat(optionalEnv("USER_ASSET", "0")),
    carAsset: parseFloat(optionalEnv("USER_CAR_ASSET", "0")),
    subscriptionDate: optionalEnv("USER_SUBSCRIPTION_DATE", ""),
    subscriptionCount: parseInt(optionalEnv("USER_SUBSCRIPTION_COUNT", "0")),
    subscriptionAmount: parseFloat(optionalEnv("USER_SUBSCRIPTION_AMOUNT", "0")),
    regions: optionalEnv("USER_REGIONS", "").split(",").map(s => s.trim()).filter(Boolean),
    minArea: parseFloat(optionalEnv("USER_MIN_AREA", "0")),
    maxArea: parseFloat(optionalEnv("USER_MAX_AREA", "999")),
    minBuildYear: parseInt(optionalEnv("USER_MIN_BUILD_YEAR", "0")),
    housingTypes: optionalEnv("USER_HOUSING_TYPES", "").split(",").map(s => s.trim()).filter(Boolean),
  };

  return { apiKey, anthropicKey, slackWebhookUrl, user };
}
```

**Step 4: 테스트 실행해 통과 확인**

```bash
npx jest src/config.test.ts
```

Expected: PASS (2 tests)

**Step 5: 커밋**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(#<issue>): 설정 로드 모듈 및 테스트 추가"
```

---

## Task 4: LH API 수집 모듈 (`src/collector.ts`)

**Files:**
- Create: `src/collector.ts`
- Create: `src/collector.test.ts`

**Step 1: 실패하는 테스트 작성**

```typescript
// src/collector.test.ts
import { extractItems, buildApiUrl, parsePanId } from "./collector";

describe("extractItems", () => {
  it("배열 구조 응답에서 아이템 배열을 추출한다", () => {
    const body = [
      { dsSch: [{ PAN_ID: "ignore" }] },
      { dsList01: [{ PAN_ID: "A001" }, { PAN_ID: "A002" }], resHeader: [] },
    ];
    expect(extractItems(body)).toHaveLength(2);
    expect(extractItems(body)[0].PAN_ID).toBe("A001");
  });

  it("빈 배열이면 빈 배열 반환", () => {
    expect(extractItems([])).toEqual([]);
  });

  it("null이면 빈 배열 반환", () => {
    expect(extractItems(null)).toEqual([]);
  });
});

describe("parsePanId", () => {
  it("공고 목록 아이템에서 PAN_ID를 반환한다", () => {
    expect(parsePanId({ PAN_ID: "2026-000050" })).toBe("2026-000050");
  });
  it("PAN_ID 없으면 빈 문자열 반환", () => {
    expect(parsePanId({})).toBe("");
  });
});
```

**Step 2: 테스트 실행해 실패 확인**

```bash
npx jest src/collector.test.ts
```

Expected: FAIL "Cannot find module './collector'"

**Step 3: collector.ts 구현**

```typescript
// src/collector.ts
import * as https from "https";
import { Notice, SupplyItem } from "./types";

const BASE_URL = "https://api.odcloud.kr/api";
const LIST_SVC = "15056908/v1/uddi:f608b3c3-0ab6-4ef4-95cc-1e5b6e4c29d5";
const DETAIL_SVC = "15056908/v1/uddi:b95fdb23-7c0e-4dc6-8d85-8b7e3d6cf0b6";
const SUPPLY_SVC = "15056908/v1/uddi:af9fb6a2-0fbb-40a3-9a5e-43e3fc73ca0f";

// NOTE: 실제 엔드포인트 경로는 explore/lh-api-probe.js 및 explore/output/*.json 참고

function get(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c: string) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode ?? 0, body: data }); }
      });
    }).on("error", reject);
  });
}

/** API 응답 body에서 아이템 배열 추출 (다양한 구조 대응) */
export function extractItems(body: unknown): Record<string, unknown>[] {
  if (!body) return [];
  if (Array.isArray(body)) {
    for (const chunk of body) {
      if (!chunk || typeof chunk !== "object") continue;
      const key = Object.keys(chunk as object).find(
        (k) => k !== "dsSch" && k !== "resHeader" && Array.isArray((chunk as Record<string, unknown>)[k])
      );
      if (key) return (chunk as Record<string, unknown>)[key] as Record<string, unknown>[];
    }
  }
  return [];
}

/** 공고 아이템에서 PAN_ID 추출 */
export function parsePanId(item: Record<string, unknown>): string {
  return (item["PAN_ID"] as string) ?? "";
}

export function buildApiUrl(svc: string, apiKey: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, serviceKey: apiKey });
  return `${BASE_URL}/${svc}?${q}`;
}

/** API 1: 공고 목록 조회 */
async function fetchNoticeList(apiKey: string): Promise<Record<string, unknown>[]> {
  const url = buildApiUrl(LIST_SVC, apiKey, {
    page: "1",
    perPage: "50",
    "cond[UPP_AIS_TP_CD::EQ]": "06", // 임대주택
  });
  const { body } = await get(url);
  return extractItems(body);
}

/** API 2: 공고 상세에서 PDF URL 추출 */
async function fetchPdfUrl(apiKey: string, panId: string): Promise<string | null> {
  const url = buildApiUrl(DETAIL_SVC, apiKey, { PAN_ID: panId });
  const { body } = await get(url);
  if (!Array.isArray(body)) return null;
  for (const chunk of body as Record<string, unknown>[]) {
    const files = chunk["dsAhflInfo"] as Record<string, unknown>[] | undefined;
    if (!files) continue;
    const pdf = files.find((f) => (f["SL_PAN_AHFL_DS_CD_NM"] as string)?.includes("PDF"));
    if (pdf) return pdf["AHFL_URL"] as string;
  }
  return null;
}

/** API 3: 공급정보 조회 */
async function fetchSupplyInfo(apiKey: string, panId: string): Promise<SupplyItem[]> {
  const url = buildApiUrl(SUPPLY_SVC, apiKey, { PAN_ID: panId });
  const { body } = await get(url);
  const items = extractItems(body);
  return items.map((item) => ({
    type: (item["HTY_NNA"] as string) ?? "",
    area: parseFloat((item["DDO_AR"] as string) ?? "0"),
    count: parseInt((item["NOW_HSH_CNT"] as string) ?? "0"),
  }));
}

/** 공고 목록 수집 (seen에 없는 것만 반환) */
export async function collectNotices(apiKey: string, seenIds: Set<string>): Promise<Notice[]> {
  const rawItems = await fetchNoticeList(apiKey);
  const newItems = rawItems.filter((item) => !seenIds.has(parsePanId(item)));

  const notices: Notice[] = [];
  for (const item of newItems) {
    const panId = parsePanId(item);
    if (!panId) continue;

    const [pdfUrl, supplyInfo] = await Promise.all([
      fetchPdfUrl(apiKey, panId),
      fetchSupplyInfo(apiKey, panId),
    ]);

    notices.push({
      panId,
      title: (item["LCC_NT_NM"] as string) ?? "",
      region: (item["CNP_CD"] as string) ?? "",
      housingType: (item["UPP_AIS_TP_CD"] as string) ?? "",
      noticeDate: (item["PAN_DT"] as string) ?? "",
      pdfUrl,
      supplyInfo,
    });
  }
  return notices;
}
```

**Step 4: 테스트 실행해 통과 확인**

```bash
npx jest src/collector.test.ts
```

Expected: PASS (4 tests)

**Step 5: 커밋**

```bash
git add src/collector.ts src/collector.test.ts
git commit -m "feat(#<issue>): LH API 수집 모듈 및 테스트 추가"
```

---

## Task 5: PDF 파싱 모듈 (`src/parser.ts`)

**Files:**
- Create: `src/parser.ts`
- Create: `src/parser.test.ts`

**Step 1: 실패하는 테스트 작성**

```typescript
// src/parser.test.ts
import { extractJsonFromText, buildClaudePrompt } from "./parser";

describe("extractJsonFromText", () => {
  it("마크다운 코드블록 없는 JSON 파싱", () => {
    const text = '{"신청대상": "청년", "소득기준": null}';
    const result = extractJsonFromText(text);
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)["신청대상"]).toBe("청년");
  });

  it("코드블록으로 감싼 JSON 파싱", () => {
    const text = '```json\n{"소득기준": "70% 이하"}\n```';
    const result = extractJsonFromText(text);
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>)["소득기준"]).toBe("70% 이하");
  });

  it("파싱 불가 시 null 반환", () => {
    expect(extractJsonFromText("이것은 JSON이 아닙니다")).toBeNull();
  });
});

describe("buildClaudePrompt", () => {
  it("공고명과 텍스트를 포함한 프롬프트 반환", () => {
    const prompt = buildClaudePrompt("테스트 공고", "공고 본문 내용");
    expect(prompt).toContain("테스트 공고");
    expect(prompt).toContain("공고 본문 내용");
    expect(prompt).toContain("소득기준");
  });
});
```

**Step 2: 테스트 실행해 실패 확인**

```bash
npx jest src/parser.test.ts
```

Expected: FAIL "Cannot find module './parser'"

**Step 3: parser.ts 구현**

```typescript
// src/parser.ts
import * as https from "https";
import * as http from "http";
import Anthropic from "@anthropic-ai/sdk";
import { Notice, ParsedConditions, ParsedNotice } from "./types";

// pdfjs-dist는 ESM-only라 dynamic import 사용
let pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsLib;
}

function downloadBuffer(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    (client as typeof https).get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        return downloadBuffer(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const lib = await getPdfjs();
  const loadingTask = lib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item: { str: string }) => item.str).join(" ") + "\n";
  }
  return text;
}

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
  "청약통장조건": "납입 횟수 또는 금액 조건",
  "임대보증금": {"26형": "금액"},
  "월임대료": {"26형": "금액"},
  "기타특이사항": "중요한 내용 요약"
}

JSON만 출력해줘.`;
}

export function extractJsonFromText(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function parseWithClaude(anthropicKey: string, text: string, title: string): Promise<ParsedConditions> {
  const client = new Anthropic({ apiKey: anthropicKey });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildClaudePrompt(title, text) }],
  });

  const raw = (response.content[0] as { text: string }).text;
  const parsed = extractJsonFromText(raw);
  if (!parsed) return emptyConditions();

  return {
    incomeLimit: (parsed["소득기준"] as string) ?? null,
    assetLimit: (parsed["자산기준"] as string) ?? null,
    carAssetLimit: (parsed["자동차기준"] as string) ?? null,
    noHomeCondition: (parsed["무주택조건"] as string) ?? null,
    subscriptionCondition: (parsed["청약통장조건"] as string) ?? null,
    deposit: (parsed["임대보증금"] as Record<string, string>) ?? {},
    rent: (parsed["월임대료"] as Record<string, string>) ?? {},
    target: (parsed["신청대상"] as string) ?? null,
    notes: (parsed["기타특이사항"] as string) ?? null,
  };
}

function emptyConditions(): ParsedConditions {
  return {
    incomeLimit: null, assetLimit: null, carAssetLimit: null,
    noHomeCondition: null, subscriptionCondition: null,
    deposit: {}, rent: {}, target: null, notes: null,
  };
}

/** 공고 목록을 파싱하여 ParsedNotice 반환 (PDF 없는 경우 빈 조건으로) */
export async function parseNotices(notices: Notice[], anthropicKey: string): Promise<ParsedNotice[]> {
  const results: ParsedNotice[] = [];
  for (const notice of notices) {
    if (!notice.pdfUrl) {
      results.push({ ...notice, conditions: emptyConditions() });
      continue;
    }
    try {
      const buffer = await downloadBuffer(notice.pdfUrl);
      const text = await extractTextFromPdf(buffer);
      const conditions = await parseWithClaude(anthropicKey, text, notice.title);
      results.push({ ...notice, conditions });
    } catch (err) {
      console.error(`[parser] ${notice.panId} 파싱 실패:`, (err as Error).message);
      results.push({ ...notice, conditions: emptyConditions() });
    }
  }
  return results;
}
```

**Step 4: 테스트 실행해 통과 확인**

```bash
npx jest src/parser.test.ts
```

Expected: PASS (4 tests)

**Step 5: 커밋**

```bash
git add src/parser.ts src/parser.test.ts
git commit -m "feat(#<issue>): PDF 파싱 및 Claude API 구조화 모듈 추가"
```

---

## Task 6: 필터링 모듈 (`src/filter.ts`)

**Files:**
- Create: `src/filter.ts`
- Create: `src/filter.test.ts`

**Step 1: 실패하는 테스트 작성**

```typescript
// src/filter.test.ts
import { matchesHousingPreference, matchesNoticeEligibility, filterNotices } from "./filter";
import { ParsedNotice, UserProfile } from "./types";

const baseUser: UserProfile = {
  age: 30,
  maritalStatus: "single",
  householdSize: 1,
  currentRegion: "11",
  noHomeYears: 5,
  income: 300,
  asset: 30000,
  carAsset: 0,
  subscriptionDate: "2020-01-01",
  subscriptionCount: 48,
  subscriptionAmount: 960,
  regions: ["11", "41"],
  minArea: 20,
  maxArea: 60,
  minBuildYear: 0,
  housingTypes: ["06"],
};

const baseNotice: ParsedNotice = {
  panId: "TEST-001",
  title: "테스트 공고",
  region: "11",
  housingType: "06",
  noticeDate: "20260307",
  pdfUrl: null,
  supplyInfo: [{ type: "26", area: 26.92, count: 180 }],
  conditions: {
    incomeLimit: "도시근로자 월평균소득 100% 이하",
    assetLimit: null,
    carAssetLimit: null,
    noHomeCondition: "무주택세대구성원",
    subscriptionCondition: null,
    deposit: { "26": "8,671,000원" },
    rent: { "26": "145,630원" },
    target: null,
    notes: null,
  },
};

describe("matchesHousingPreference", () => {
  it("지역 일치하면 true", () => {
    expect(matchesHousingPreference(baseNotice, baseUser)).toBe(true);
  });

  it("지역 불일치하면 false", () => {
    const notice = { ...baseNotice, region: "28" };
    expect(matchesHousingPreference(notice, baseUser)).toBe(false);
  });

  it("면적 범위 내 공급 있으면 true", () => {
    const notice = { ...baseNotice, supplyInfo: [{ type: "26", area: 26.92, count: 10 }] };
    expect(matchesHousingPreference(notice, { ...baseUser, minArea: 20, maxArea: 30 })).toBe(true);
  });

  it("면적 범위 밖이면 false", () => {
    const notice = { ...baseNotice, supplyInfo: [{ type: "26", area: 26.92, count: 10 }] };
    expect(matchesHousingPreference(notice, { ...baseUser, minArea: 40, maxArea: 60 })).toBe(false);
  });

  it("임대유형 불일치하면 false", () => {
    const notice = { ...baseNotice, housingType: "05" };
    expect(matchesHousingPreference(notice, baseUser)).toBe(false);
  });
});

describe("matchesNoticeEligibility", () => {
  it("조건 추출 실패(null)면 통과 처리(true)", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, incomeLimit: null } };
    expect(matchesNoticeEligibility(notice, baseUser)).toBe(true);
  });
});

describe("filterNotices", () => {
  it("조건 통과한 공고만 반환", () => {
    const failRegion = { ...baseNotice, panId: "FAIL-001", region: "99" };
    const result = filterNotices([baseNotice, failRegion], baseUser);
    expect(result).toHaveLength(1);
    expect(result[0].panId).toBe("TEST-001");
  });
});
```

**Step 2: 테스트 실행해 실패 확인**

```bash
npx jest src/filter.test.ts
```

Expected: FAIL "Cannot find module './filter'"

**Step 3: filter.ts 구현**

```typescript
// src/filter.ts
import { ParsedNotice, UserProfile } from "./types";

/**
 * 주택 선호 조건 체크 (지역, 면적, 임대유형)
 * USER_REGIONS가 비어 있으면 지역 제한 없음
 */
export function matchesHousingPreference(notice: ParsedNotice, user: UserProfile): boolean {
  // 지역
  if (user.regions.length > 0 && !user.regions.includes(notice.region)) return false;

  // 임대유형
  if (user.housingTypes.length > 0 && !user.housingTypes.includes(notice.housingType)) return false;

  // 면적 (공급정보 중 범위 내 면적이 하나라도 있으면 통과)
  if (notice.supplyInfo.length > 0) {
    const hasMatchingArea = notice.supplyInfo.some(
      (s) => s.area >= user.minArea && s.area <= user.maxArea
    );
    if (!hasMatchingArea) return false;
  }

  return true;
}

/**
 * 공고 자격 조건 체크 (소득, 자산, 청약통장)
 * 파싱 실패(null)인 항목은 통과 처리 (false negative 방지)
 */
export function matchesNoticeEligibility(notice: ParsedNotice, user: UserProfile): boolean {
  const { conditions } = notice;

  // 소득기준: "N% 이하" 패턴에서 비율 추출
  if (conditions.incomeLimit) {
    const match = conditions.incomeLimit.match(/(\d+(?:\.\d+)?)\s*%\s*이하/);
    if (match) {
      const limitRatio = parseFloat(match[1]) / 100;
      // 도시근로자 월평균소득 기준값 (2024년 기준 3인 이하: 약 700만원, 단순화)
      // 실제 구현 시 가구원 수별 기준 테이블 필요. 현재는 단순 비율 비교.
      // 사용자 소득이 기준의 limitRatio 이하인지 확인하려면 절대값 기준 필요 → null(통과) 처리
      // TODO: 도시근로자 월평균소득 기준 테이블 추가
      _ = limitRatio; // 현재는 통과 처리
    }
  }

  // 자산기준: "N.NN억 이하" 또는 "N,NNN만원 이하" 패턴
  if (conditions.assetLimit) {
    const eokMatch = conditions.assetLimit.match(/([\d.]+)\s*억/);
    const manMatch = conditions.assetLimit.match(/([\d,]+)\s*만원/);
    if (eokMatch) {
      const limitManwon = parseFloat(eokMatch[1]) * 10000;
      if (user.asset > limitManwon) return false;
    } else if (manMatch) {
      const limitManwon = parseFloat(manMatch[1].replace(/,/g, ""));
      if (user.asset > limitManwon) return false;
    }
  }

  // 자동차 자산기준
  if (conditions.carAssetLimit) {
    const match = conditions.carAssetLimit.match(/([\d,]+)\s*만원/);
    if (match) {
      const limitManwon = parseFloat(match[1].replace(/,/g, ""));
      if (user.carAsset > limitManwon) return false;
    }
  }

  return true;
}

/** 공고 목록에서 사용자 조건에 맞는 것만 반환 */
export function filterNotices(notices: ParsedNotice[], user: UserProfile): ParsedNotice[] {
  return notices.filter(
    (n) => matchesHousingPreference(n, user) && matchesNoticeEligibility(n, user)
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare let _: unknown;
```

> **주의:** 소득기준 필터링은 도시근로자 월평균소득 절대값 기준 테이블이 필요합니다. 현재는 파싱만 하고 통과 처리합니다. 향후 `docs/domain/lh-sh-domain-guide.md`의 기준값을 참고해 구현하세요.

**Step 4: TypeScript 컴파일 오류 수정**

`declare let _: unknown` 대신 `void limitRatio`를 사용하거나 주석으로 처리. filter.ts에서 `_` 선언 제거 후:

```typescript
// 소득기준 절대값 테이블 미구현으로 통과 처리
// if (match) { const limitRatio = parseFloat(match[1]) / 100; /* TODO */ }
```

**Step 5: 테스트 실행해 통과 확인**

```bash
npx jest src/filter.test.ts
```

Expected: PASS (6 tests)

**Step 6: 커밋**

```bash
git add src/filter.ts src/filter.test.ts
git commit -m "feat(#<issue>): 공고 필터링 모듈 및 테스트 추가"
```

---

## Task 7: Slack 알림 모듈 (`src/notifier.ts`)

**Files:**
- Create: `src/notifier.ts`
- Create: `src/notifier.test.ts`

**Step 1: 실패하는 테스트 작성**

```typescript
// src/notifier.test.ts
import { formatSlackMessage } from "./notifier";
import { ParsedNotice } from "./types";

const notice: ParsedNotice = {
  panId: "2026-000050",
  title: "강릉미디어촌5 국민임대주택 예비입주자 모집",
  region: "42",
  housingType: "06",
  noticeDate: "20260307",
  pdfUrl: null,
  supplyInfo: [
    { type: "26", area: 26.92, count: 180 },
    { type: "37", area: 37.01, count: 200 },
  ],
  conditions: {
    incomeLimit: "도시근로자 월평균소득 100% 이하",
    assetLimit: null,
    carAssetLimit: null,
    noHomeCondition: "무주택세대구성원",
    subscriptionCondition: null,
    deposit: { "26": "8,671,000원", "37": "16,231,000원" },
    rent: { "26": "145,630원", "37": "204,560원" },
    target: null,
    notes: "최장 30년 거주 가능",
  },
};

describe("formatSlackMessage", () => {
  it("공고명을 포함한 메시지 반환", () => {
    const msg = formatSlackMessage(notice);
    expect(msg.text).toContain("강릉미디어촌5");
  });

  it("면적 정보를 포함한다", () => {
    const msg = formatSlackMessage(notice);
    const body = JSON.stringify(msg);
    expect(body).toContain("26");
    expect(body).toContain("37");
  });

  it("임대보증금 정보를 포함한다", () => {
    const msg = formatSlackMessage(notice);
    const body = JSON.stringify(msg);
    expect(body).toContain("8,671,000");
  });
});
```

**Step 2: 테스트 실행해 실패 확인**

```bash
npx jest src/notifier.test.ts
```

Expected: FAIL "Cannot find module './notifier'"

**Step 3: notifier.ts 구현**

```typescript
// src/notifier.ts
import * as https from "https";
import { ParsedNotice } from "./types";

interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

export function formatSlackMessage(notice: ParsedNotice): SlackMessage {
  const supplyLines = notice.supplyInfo
    .map((s) => {
      const deposit = notice.conditions.deposit[s.type] ?? "-";
      const rent = notice.conditions.rent[s.type] ?? "-";
      return `  • ${s.type}형 (${s.area}㎡) ${s.count}세대 | 보증금 ${deposit} / 월임대료 ${rent}`;
    })
    .join("\n");

  const lines = [
    `*[LH 공고]* ${notice.title}`,
    `공고일: ${notice.noticeDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3")}`,
    ``,
    `*공급 정보*`,
    supplyLines || "  (공급정보 없음)",
    ``,
  ];

  if (notice.conditions.incomeLimit) lines.push(`소득기준: ${notice.conditions.incomeLimit}`);
  if (notice.conditions.noHomeCondition) lines.push(`무주택: ${notice.conditions.noHomeCondition}`);
  if (notice.conditions.notes) lines.push(`\n비고: ${notice.conditions.notes}`);

  lines.push(`\n공고 ID: ${notice.panId}`);

  return { text: lines.join("\n") };
}

export async function sendSlackNotification(webhookUrl: string, notices: ParsedNotice[]): Promise<void> {
  for (const notice of notices) {
    const message = formatSlackMessage(notice);
    await postToSlack(webhookUrl, message);
    console.log(`[notifier] 전송 완료: ${notice.title}`);
  }
}

function postToSlack(webhookUrl: string, message: SlackMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(message);
    const url = new URL(webhookUrl);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          if (res.statusCode !== 200) reject(new Error(`Slack 응답: ${res.statusCode}`));
          else resolve();
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
```

**Step 4: 테스트 실행해 통과 확인**

```bash
npx jest src/notifier.test.ts
```

Expected: PASS (3 tests)

**Step 5: 커밋**

```bash
git add src/notifier.ts src/notifier.test.ts
git commit -m "feat(#<issue>): Slack 알림 모듈 및 테스트 추가"
```

---

## Task 8: 진입점 및 seen.json 관리 (`src/index.ts`)

**Files:**
- Create: `src/index.ts`

**Step 1: index.ts 구현**

```typescript
// src/index.ts
import * as fs from "fs";
import * as path from "path";
import { loadEnv, loadConfig } from "./config";
import { collectNotices } from "./collector";
import { parseNotices } from "./parser";
import { filterNotices } from "./filter";
import { sendSlackNotification } from "./notifier";

const SEEN_PATH = path.resolve(process.cwd(), "data/seen.json");

function loadSeen(): Set<string> {
  if (!fs.existsSync(SEEN_PATH)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(SEEN_PATH, "utf-8"));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>): void {
  fs.mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
  fs.writeFileSync(SEEN_PATH, JSON.stringify([...seen], null, 2), "utf-8");
}

async function main() {
  loadEnv();
  const config = loadConfig();
  const seen = loadSeen();

  console.log("[1/4] 공고 수집 중...");
  const notices = await collectNotices(config.apiKey, seen);
  console.log(`  신규 공고 ${notices.length}건`);

  if (notices.length === 0) {
    console.log("새로운 공고가 없습니다.");
    return;
  }

  console.log("[2/4] 공고문 파싱 중...");
  const parsed = await parseNotices(notices, config.anthropicKey);

  console.log("[3/4] 조건 필터링 중...");
  const matched = filterNotices(parsed, config.user);
  console.log(`  조건 충족 공고 ${matched.length}건`);

  if (matched.length > 0) {
    console.log("[4/4] Slack 알림 전송 중...");
    await sendSlackNotification(config.slackWebhookUrl, matched);
  }

  // seen.json 업데이트 (파싱 완료된 것만, 필터 통과 여부 무관)
  for (const n of parsed) seen.add(n.panId);
  saveSeen(seen);

  console.log("완료.");
}

main().catch((err) => {
  console.error("[오류]", err.message);
  process.exit(1);
});
```

**Step 2: 전체 테스트 실행**

```bash
npx jest
```

Expected: 모든 테스트 PASS

**Step 3: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음

**Step 4: 커밋**

```bash
git add src/index.ts
git commit -m "feat(#<issue>): 파이프라인 진입점 및 seen.json 관리 추가"
```

---

## Task 9: .env 환경변수 채우기 및 통합 실행

**Files:**
- Modify: `.env`

**Step 1: .env에 전체 항목 추가**

현재 `.env`에 `PUBLIC_DATA_API_KEY`, `ANTHROPIC_API_KEY`만 있음. 나머지 항목 추가:

```bash
# Slack
SLACK_WEBHOOK_URL=

# 사용자 기본 정보
USER_AGE=
USER_MARITAL_STATUS=single
USER_HOUSEHOLD_SIZE=1
USER_CURRENT_REGION=11
USER_NO_HOME_YEARS=0

# 공고 자격 조건
USER_INCOME=
USER_ASSET=
USER_CAR_ASSET=0
USER_SUBSCRIPTION_DATE=
USER_SUBSCRIPTION_COUNT=0
USER_SUBSCRIPTION_AMOUNT=0

# 주택 선호 조건
USER_REGIONS=11,41
USER_MIN_AREA=20
USER_MAX_AREA=60
USER_MIN_BUILD_YEAR=0
USER_HOUSING_TYPES=06,13
```

> `.env`는 gitignore 처리되어 있으므로 커밋하지 않음.

**Step 2: 실제 실행 테스트**

```bash
npx ts-node src/index.ts
```

Expected: 공고 수집 → 파싱 → 필터링 → (조건 맞으면 Slack 전송) 순서로 로그 출력

**Step 3: .env.example 생성 및 커밋**

```bash
git add .env.example
git commit -m "chore(#<issue>): .env.example 환경변수 템플릿 추가"
```

---

## Task 10: 최종 정리 및 PR

**Step 1: 전체 테스트 재실행**

```bash
npx jest --coverage
```

Expected: 모든 PASS

**Step 2: README 또는 CLAUDE.md에 실행 방법 추가**

`CLAUDE.md` 빠른 참조 섹션:
```bash
# 공고 알림 실행
npx ts-node src/index.ts

# 테스트
npx jest
```

**Step 3: GitHub Issue 생성 및 PR**

```bash
gh issue create --title "feat: LH 공공주택 공고 알림 파이프라인 구현" --body "..."
# 브랜치 생성
git checkout -b feat/#<issue>/lh-pipeline
# 커밋들을 포함한 PR 생성
gh pr create --title "feat(#<issue>): LH 공고 알림 파이프라인 구현" --body "..."
```
