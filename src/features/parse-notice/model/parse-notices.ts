import * as http from "http";
import * as https from "https";
import Anthropic from "@anthropic-ai/sdk";
import { Notice, ParsedConditions, ParsedNotice } from "../../../entities/notice";
import { ProgressReporter } from "../../../shared/types";

type JsonObject = Record<string, unknown>;

interface PdfPage {
  getTextContent(): Promise<{ items: Array<{ str?: unknown }> }>;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
}

interface PdfjsModule {
  getDocument(params: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
  }): PdfLoadingTask;
}

let pdfjsLib: PdfjsModule | null = null;

export interface ParseNoticesResult {
  parsed: ParsedNotice[];
  failedPanIds: string[];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPdfjsModule(value: unknown): value is PdfjsModule {
  return isJsonObject(value) && typeof value.getDocument === "function";
}

async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsLib) {
    const loaded = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!isPdfjsModule(loaded)) {
      throw new Error("pdfjs-dist 로드 실패");
    }
    pdfjsLib = loaded;
  }

  return pdfjsLib;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function downloadBuffer(url: string, maxRedirects = 5): Promise<Buffer> {
  const request = (targetUrl: string, redirectsLeft: number): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
      const client = targetUrl.startsWith("https") ? https : http;

      client
        .get(targetUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location;

          if ([301, 302, 303, 307, 308].includes(status) && location && redirectsLeft > 0) {
            res.resume();
            const redirected = new URL(location, targetUrl).toString();
            request(redirected, redirectsLeft - 1).then(resolve).catch(reject);
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer | string) => {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          });
          res.on("end", () => {
            resolve(Buffer.concat(chunks));
          });
          res.on("error", reject);
        })
        .on("error", reject);
    });
  };

  return request(url, maxRedirects);
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

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => (typeof item.str === "string" ? item.str : ""))
      .join(" ");
    text += `${pageText}\n`;
  }

  return text;
}

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
  "단지주소목록": ["서울시 송파구 잠실동 123-4"],
  "기타특이사항": "중요한 내용 요약"
}

JSON만 출력해줘.`;
}

export function extractJsonFromText(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();

  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!isJsonObject(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

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

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isJsonObject(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      result[key] = item;
    }
  }

  return result;
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  for (const block of content) {
    if (!isJsonObject(block)) {
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }

  return "";
}

async function parseWithClaude(
  anthropicKey: string,
  text: string,
  title: string,
): Promise<{ conditions: ParsedConditions; addressList: string[] }> {
  const client = new Anthropic({ apiKey: anthropicKey });
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: buildClaudePrompt(title, text) }],
  });

  const raw = extractMessageText(response.content);
  const parsed = extractJsonFromText(raw);
  if (!parsed) {
    return { conditions: emptyConditions(), addressList: [] };
  }

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

  const addressList = Array.isArray(parsed["단지주소목록"])
    ? (parsed["단지주소목록"] as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const subscriptionCondition = optionalString(parsed["청약통장조건"]);

  return {
    conditions: {
      incomeLimit: optionalString(parsed["소득기준"]),
      assetLimit: optionalString(parsed["자산기준"]),
      carAssetLimit: optionalString(parsed["자동차기준"]),
      noHomeCondition: optionalString(parsed["무주택조건"]),
      subscriptionCondition,
      deposit: depositMap,
      rent: rentMap,
      target: optionalString(parsed["신청대상"]),
      notes: optionalString(parsed["기타특이사항"]),
      depositAmount: depositAmountMap,
      rentAmount: rentAmountMap,
      noHomeYearsRequired: parseNoHomeYears(optionalString(parsed["무주택기간"])),
      subscriptionCountRequired: parseSubscriptionCount(subscriptionCondition),
    },
    addressList,
  };
}

export async function parseNotices(
  notices: Notice[],
  anthropicKey: string,
  onProgress?: ProgressReporter,
): Promise<ParseNoticesResult> {
  const results: ParsedNotice[] = [];
  const failedPanIds: string[] = [];
  const total = notices.length;
  let current = 0;

  const emitProgress = (message: string): void => {
    if (!onProgress) {
      return;
    }

    const safeTotal = Math.max(total, 1);
    const safeCurrent = Math.min(Math.max(current, 0), safeTotal);
    onProgress({
      phase: "parse",
      current: safeCurrent,
      total: safeTotal,
      percent: Math.floor((safeCurrent / safeTotal) * 100),
      message,
    });
  };

  for (const notice of notices) {
    if (!notice.pdfUrl) {
      results.push({ ...notice, conditions: emptyConditions() });
      current += 1;
      emitProgress(`공고문 파싱 ${current}/${total} (${notice.title}) - PDF 없음`);
      continue;
    }

    try {
      const buffer = await downloadBuffer(notice.pdfUrl);
      const text = await extractTextFromPdf(buffer);
      const { conditions, addressList } = await parseWithClaude(anthropicKey, text, notice.title);
      const supplyInfoWithAddress = notice.supplyInfo.map((item, idx) => ({
        ...item,
        address: addressList[idx] ?? null,
      }));
      results.push({ ...notice, supplyInfo: supplyInfoWithAddress, conditions });
      current += 1;
      emitProgress(`공고문 파싱 ${current}/${total} (${notice.title})`);
    } catch (error) {
      console.error(`[parser] ${notice.panId} 파싱 실패: ${getErrorMessage(error)}`);
      results.push({ ...notice, conditions: emptyConditions() });
      failedPanIds.push(notice.panId);
      current += 1;
      emitProgress(`공고문 파싱 ${current}/${total} (${notice.title}) - 실패`);
    }
  }

  return {
    parsed: results,
    failedPanIds,
  };
}
