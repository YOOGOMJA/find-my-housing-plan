import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { EligibilityCheck, NoticeApplicationStatus, ParsedNotice } from "../../../entities/notice";
import { UserProfile } from "../../../entities/user";
import { buildEligibilityChecks, IncomeEligibilityContext } from "../../filter-notices";
import { ProgressReporter } from "../../../shared/types";

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

export type SlackNoticeBucket = "open" | "upcoming" | "unknown";
export type ManualReviewReason = "no_pdf" | "parse_failed";

export interface ManualReviewNotice {
  notice: ParsedNotice;
  reason: ManualReviewReason;
}

export type SlackHistoryMessageType =
  | "batch_header"
  | "filter_summary"
  | "notice"
  | "manual_review_notice";

export interface SlackHistoryRecord {
  timestamp: string;
  runId: string;
  panId: string | null;
  messageType: SlackHistoryMessageType;
  applicationStatus: NoticeApplicationStatus | null;
  payloadText: string;
  status: "success" | "failed";
  httpStatus: number | null;
  errorMessage: string | null;
}

interface SlackHistoryRecordInput {
  runId: string;
  panId: string | null;
  messageType: SlackHistoryMessageType;
  applicationStatus: NoticeApplicationStatus | null;
  payloadText: string;
  status: "success" | "failed";
  httpStatus: number | null;
  errorMessage: string | null;
  nowIso?: string;
}

interface SendSlackNotificationOptions {
  keepAlive?: boolean;
  includeFilterSummary?: boolean;
  isReprocess?: boolean;
  incomeEligibilityContext?: IncomeEligibilityContext;
}

const HOUSING_TYPE_CODE_LABEL: Record<string, string> = {
  "01": "토지/분양",
  "05": "공공분양",
  "06": "임대주택",
  "13": "매입임대/전세임대",
  "22": "상가/업무시설",
};
const DEFAULT_PRICE_KEY = "default";
const JEONSE_KEYWORDS = ["장기전세", "전세임대"];
const MAEIP_KEYWORDS = ["매입임대"];

function formatDate(yyyymmdd: string): string {
  if (/^\d{8}$/.test(yyyymmdd)) {
    return yyyymmdd.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3");
  }

  return yyyymmdd;
}

function normalizeStatus(status: NoticeApplicationStatus | undefined): NoticeApplicationStatus {
  if (status === "upcoming" || status === "open" || status === "closed" || status === "unknown") {
    return status;
  }

  return "unknown";
}

function formatApplicationStatus(status: NoticeApplicationStatus | undefined): string {
  const normalized = normalizeStatus(status);

  if (normalized === "open") {
    return "🟢 접수중";
  }
  if (normalized === "upcoming") {
    return "🟡 접수예정";
  }
  if (normalized === "closed") {
    return "⚫ 접수마감";
  }

  return "❔ 상태확인필요";
}

function formatBucketTitle(bucket: SlackNoticeBucket): string {
  if (bucket === "open") {
    return "🟢 접수중";
  }
  if (bucket === "upcoming") {
    return "🟡 접수예정";
  }
  return "❔ 상태확인필요";
}

function buildBatchHeader(bucket: SlackNoticeBucket, count: number, isReprocess: boolean): SlackMessage {
  const prefix = isReprocess ? "📣 *LH 공고 알림 (재처리)*" : "📣 *LH 공고 알림*";
  return {
    text: `${prefix} | *${formatBucketTitle(bucket)}* ${count}건`,
  };
}

function formatNoticeLink(url: string | null | undefined): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) {
    return "-";
  }

  return `<${trimmed}|공고 상세 페이지>`;
}

function formatPanIdLink(panId: string, url: string | null | undefined): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) {
    return `\`${panId}\``;
  }

  return `<${trimmed}|${panId}>`;
}

function formatNoticeType(notice: ParsedNotice): string {
  const detail = (notice.detailTypeName ?? "").trim();
  const upper = (notice.upperTypeName ?? "").trim();

  if (detail && upper) {
    return `${detail} (${upper})`;
  }
  if (detail) {
    return detail;
  }
  if (upper) {
    return upper;
  }

  const code = (notice.housingType ?? "").trim();
  const codeLabel = HOUSING_TYPE_CODE_LABEL[code];
  if (codeLabel) {
    return `${codeLabel} [${code}]`;
  }

  return code || "정보없음";
}

function formatNoticeDateValue(value: string): string {
  const formatted = formatDate(value).trim();
  return formatted || "정보없음";
}

function formatApplicationPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
  status: NoticeApplicationStatus | undefined,
): string {
  const startText = (start ?? "").trim();
  const endText = (end ?? "").trim();

  if (startText && endText) {
    return `${startText} ~ ${endText}`;
  }
  if (startText) {
    return `${startText}부터 (종료일 미제공)`;
  }
  if (endText) {
    return `${endText}까지 (시작일 미제공)`;
  }

  const normalized = normalizeStatus(status);
  if (normalized === "upcoming") {
    return "일정 미공개 (공개전/원문 확인 필요)";
  }
  if (normalized === "open") {
    return "일정 미제공 (원문 확인 필요)";
  }
  if (normalized === "closed") {
    return "접수 마감";
  }

  return "일정 정보 없음";
}

function splitTextParts(value: string): string[] {
  let parts = value
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    parts = value
      .split(/[;|/]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (parts.length <= 1) {
    parts = value
      .split(/\.\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (parts.length <= 1 && value.length > 160) {
    parts = value
      .split(/,\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return parts;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function extractSupplyHighlights(notes: string | null): string[] {
  if (!notes) {
    return [];
  }

  const normalized = notes.replace(/\r/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const keywordPattern = /(전용면적|공용면적|면적|공급가격|분양가격|예정가격|공급금액|보증금|월임대료|호\b|계약금|잔금)/;
  const parts = splitTextParts(normalized);
  const highlights = parts.filter((part) => keywordPattern.test(part));

  const unique: string[] = [];
  for (const part of highlights) {
    if (!unique.includes(part)) {
      unique.push(part);
    }
  }

  return unique.slice(0, 3).map((line) => truncate(line, 120));
}

function formatNotes(notes: string | null): string {
  if (!notes) {
    return "  - 없음";
  }

  const normalized = notes.replace(/\r/g, "\n").trim();
  if (!normalized) {
    return "  - 없음";
  }

  const parts = splitTextParts(normalized);

  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.includes(part)) {
      unique.push(part);
    }
  }

  const picked = (unique.length > 0 ? unique : [normalized]).slice(0, 4);
  const lines = picked.map((line) => `  • ${truncate(line, 120)}`);
  if (unique.length > picked.length) {
    lines.push(`  • 외 ${unique.length - picked.length}개 항목`);
  }
  return lines.join("\n");
}

function formatAmountLimit(value: number): string {
  if (value <= 0) {
    return "제한 없음";
  }

  return `${value.toLocaleString("ko-KR")}만원 이하`;
}

function buildFilterSummaryMessage(user: UserProfile, isReprocess: boolean): SlackMessage {
  const regions = user.regions.length > 0 ? user.regions.join(", ") : "제한 없음";
  const districts = user.districts.length > 0 ? user.districts.join(", ") : "제한 없음";
  const housingTypes = user.housingTypes.length > 0 ? user.housingTypes.join(", ") : "제한 없음";
  const areaRange = `${user.minArea}㎡ ~ ${user.maxArea}㎡`;
  const prefix = isReprocess ? "🔁 *재처리 모드* 적용 필터" : "🎯 *적용 필터*";

  return {
    text: [
      `${prefix}`,
      `• 지역: ${regions}`,
      `• 선호구: ${districts}`,
      `• 공고유형 코드: ${housingTypes}`,
      `• 면적: ${areaRange}`,
      `• 보증금: ${formatAmountLimit(user.maxDeposit)}`,
      `• 월임대료: ${formatAmountLimit(user.maxRent)}`,
    ].join("\n"),
  };
}

export function groupNoticesByStatus(notices: ParsedNotice[]): Record<SlackNoticeBucket, ParsedNotice[]> {
  const grouped: Record<SlackNoticeBucket, ParsedNotice[]> = {
    open: [],
    upcoming: [],
    unknown: [],
  };

  for (const notice of notices) {
    const status = normalizeStatus(notice.applicationStatus);
    if (status === "open") {
      grouped.open.push(notice);
      continue;
    }

    if (status === "upcoming") {
      grouped.upcoming.push(notice);
      continue;
    }

    if (status === "unknown") {
      grouped.unknown.push(notice);
    }
  }

  return grouped;
}

function normalizePriceLookupKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const numberMatch = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (numberMatch) {
    return numberMatch[1];
  }

  return trimmed.replace(/\s+/g, "");
}

function pickPriceValue(record: Record<string, string>, typeKey: string): string | null {
  const direct = (record[typeKey] ?? "").trim();
  if (direct) {
    return direct;
  }

  const normalizedType = normalizePriceLookupKey(typeKey);
  if (normalizedType) {
    const normalizedDirect = (record[normalizedType] ?? "").trim();
    if (normalizedDirect) {
      return normalizedDirect;
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (normalizePriceLookupKey(key) === normalizedType && value.trim()) {
      return value.trim();
    }
  }

  const fallback = (record[DEFAULT_PRICE_KEY] ?? "").trim();
  return fallback || null;
}

function hasKeyword(source: string, keywords: string[]): boolean {
  return keywords.some((keyword) => source.includes(keyword));
}

function buildPriceLine(
  notice: ParsedNotice,
  itemType: string,
  areaLabel: string,
  countLabel: string,
): { line: string; isReferenceOnly: boolean } {
  const deposit = pickPriceValue(notice.conditions.deposit, itemType);
  const rent = pickPriceValue(notice.conditions.rent, itemType);
  const contract = pickPriceValue(notice.conditions.contract, itemType);
  const typeSource = `${notice.title} ${notice.upperTypeName ?? ""} ${notice.detailTypeName ?? ""}`;
  const isJeonseLike = hasKeyword(typeSource, JEONSE_KEYWORDS);
  const isMaeipLike = hasKeyword(typeSource, MAEIP_KEYWORDS);

  const parts: string[] = [];
  if (contract) {
    parts.push(`계약금 ${contract}`);
  }
  if (deposit) {
    parts.push(`보증금 ${deposit}`);
  }
  if (rent) {
    parts.push(`월임대료 ${rent}`);
  }

  if (parts.length === 0) {
    return {
      line: `    ${areaLabel} ${countLabel} | 공고문 참조형`,
      isReferenceOnly: true,
    };
  }

  if (contract) {
    return {
      line: `    ${areaLabel} ${countLabel} | 계약금 포함형 | ${parts.join(" / ")}`,
      isReferenceOnly: false,
    };
  }

  if (deposit && !rent && (isJeonseLike || isMaeipLike)) {
    return {
      line: `    ${areaLabel} ${countLabel} | 보증금 중심형 | ${parts.join(" / ")}`,
      isReferenceOnly: false,
    };
  }

  return {
    line: `    ${areaLabel} ${countLabel} | ${parts.join(" / ")}`,
    isReferenceOnly: false,
  };
}

export function formatSlackMessage(
  notice: ParsedNotice,
  eligibilityChecks: EligibilityCheck[],
  preferredDistricts: string[],
): SlackMessage {
  const supplyHighlights = extractSupplyHighlights(notice.conditions.notes);
  let hasReferenceOnlyPrice = false;

  const formatAreaLabel = (area: number): string => (area > 0 ? `${area}㎡` : "면적 미상");
  const formatCountLabel = (count: number): string => (count > 0 ? `${count}세대` : "세대수 미상");

  const supplyLines = notice.supplyInfo
    .map((item) => {
      const preferred = preferredDistricts.length > 0 && item.address
        ? preferredDistricts.some((d) => item.address!.includes(d))
        : false;
      const prefixMark = preferred ? " [선호지역]" : "";

      const addressLine = item.address
        ? `  ${item.address}${prefixMark}`
        : `  ${item.type || "단지 정보 미상"}${prefixMark}`;

      const { line: priceLine, isReferenceOnly } = buildPriceLine(
        notice,
        item.type,
        formatAreaLabel(item.area),
        formatCountLabel(item.count),
      );
      if (isReferenceOnly) {
        hasReferenceOnlyPrice = true;
      }

      let mapLine = "";
      if (item.address) {
        const encoded = encodeURIComponent(item.address);
        const naver = `https://map.naver.com/v5/search/${encoded}`;
        const google = `https://www.google.com/maps/search/${encoded}`;
        mapLine = `\n    <${naver}|네이버지도> | <${google}|구글지도>`;
      }

      return `${addressLine}\n${priceLine}${mapLine}`;
    })
    .join("\n");

  const supplySection =
    supplyLines ||
    (supplyHighlights.length > 0
      ? supplyHighlights.map((line) => `  • ${line}`).join("\n")
      : "  - 공급정보 없음");

  const lines: string[] = [
    "🏠 *LH 공고 알림*",
    `*${notice.title}*`,
    `🏷️ 공고유형: ${formatNoticeType(notice)}`,
    `📌 접수상태: *${formatApplicationStatus(notice.applicationStatus)}*`,
    `🗓️ 공고일: ${formatNoticeDateValue(notice.noticeDate)}`,
    `⏰ 접수기간: ${formatApplicationPeriod(
      notice.applicationStartDate,
      notice.applicationEndDate,
      notice.applicationStatus,
    )}`,
  ];

  if (eligibilityChecks.length > 0) {
    const eligibilityLines = eligibilityChecks.map((check) => {
      const icon = check.result === "pass" ? "통과" : check.result === "fail" ? "미충족" : "확인필요";
      const raw = check.rawCondition ? ` (${check.rawCondition})` : "";
      return `  ${icon} ${check.label}: ${check.userValue ?? ""}${raw}`;
    });
    lines.push("", "✅ *자격 판정*", ...eligibilityLines);
  }

  lines.push("", "📦 *공급 정보*", supplySection);

  const noteChunks: string[] = [];
  if (notice.conditions.notes) {
    noteChunks.push(notice.conditions.notes);
  }
  if (hasReferenceOnlyPrice) {
    noteChunks.push("공고문 참조형: 가격 정보가 구조화되지 않아 원문 확인이 필요합니다.");
  }

  const mergedNotes = noteChunks.length > 0 ? noteChunks.join("\n") : null;
  if (mergedNotes) {
    lines.push("", "📝 *비고*", formatNotes(mergedNotes));
  }

  lines.push("", `🆔 공고 ID: ${formatPanIdLink(notice.panId, notice.noticeUrl)}`);

  const noticeLink = formatNoticeLink(notice.noticeUrl);
  if (noticeLink !== "-") {
    lines.push(`🔗 바로가기: ${noticeLink}`);
  }

  return { text: lines.join("\n") };
}

function formatManualReviewReason(reason: ManualReviewReason): string {
  if (reason === "no_pdf") {
    return "PDF 미제공";
  }

  return "PDF 파싱 실패";
}

export function formatManualReviewMessage(item: ManualReviewNotice): SlackMessage {
  const { notice, reason } = item;
  const lines = [
    "🔔 *LH 공고 알림*",
    `*${notice.title}*`,
    `🏷️ 공고유형: ${formatNoticeType(notice)}`,
    `📌 접수상태: *${formatApplicationStatus(notice.applicationStatus)}*`,
    `🗓️ 공고일: ${formatNoticeDateValue(notice.noticeDate)}`,
    `⚠️ 자동추출 누락: ${formatManualReviewReason(reason)}`,
    `🆔 공고 ID: ${formatPanIdLink(notice.panId, notice.noticeUrl)}`,
  ];

  const noticeLink = formatNoticeLink(notice.noticeUrl);
  if (noticeLink !== "-") {
    lines.push(`🔗 바로가기: ${noticeLink}`);
  }

  return { text: lines.join("\n") };
}

class SlackPostError extends Error {
  public readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null) {
    super(message);
    this.name = "SlackPostError";
    this.statusCode = statusCode;
  }
}

function toHistoryDate(nowIso: string): string {
  return nowIso.slice(0, 10);
}

export function getSlackHistoryPath(nowIso = new Date().toISOString()): string {
  return path.resolve(process.cwd(), "data", "slack-history", `${toHistoryDate(nowIso)}.jsonl`);
}

export function createSlackHistoryRecord(input: SlackHistoryRecordInput): SlackHistoryRecord {
  return {
    timestamp: input.nowIso ?? new Date().toISOString(),
    runId: input.runId,
    panId: input.panId,
    messageType: input.messageType,
    applicationStatus: input.applicationStatus,
    payloadText: input.payloadText,
    status: input.status,
    httpStatus: input.httpStatus,
    errorMessage: input.errorMessage,
  };
}

export function appendSlackHistoryRecord(record: SlackHistoryRecord): void {
  const filePath = getSlackHistoryPath(record.timestamp);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
}

function tryAppendSlackHistory(record: SlackHistoryRecord): void {
  try {
    appendSlackHistoryRecord(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[notifier] Slack 히스토리 저장 실패: ${message}`);
  }
}

function postToSlack(
  webhookUrl: string,
  message: SlackMessage,
  agent?: https.Agent,
): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(message);
    const url = new URL(webhookUrl);

    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        agent,
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          const statusCode = response.statusCode ?? 0;

          if (statusCode === 200) {
            resolve({ statusCode });
            return;
          }

          reject(new SlackPostError(`Slack 응답: ${statusCode}`, statusCode));
        });
      },
    );

    request.on("error", (error) => {
      reject(new SlackPostError(error.message, null));
    });
    request.write(payload);
    request.end();
  });
}

export async function sendSlackNotification(
  webhookUrl: string,
  notices: ParsedNotice[],
  user: UserProfile,
  runId: string,
  onProgress?: ProgressReporter,
  manualReviewNotices: ManualReviewNotice[] = [],
  options?: SendSlackNotificationOptions,
): Promise<void> {
  const keepAlive = options?.keepAlive ?? true;
  const includeFilterSummary = options?.includeFilterSummary ?? true;
  const isReprocess = options?.isReprocess ?? false;
  const incomeEligibilityContext = options?.incomeEligibilityContext;
  const agent = keepAlive ? new https.Agent({ keepAlive: true }) : undefined;
  const grouped = groupNoticesByStatus(notices);
  const order: SlackNoticeBucket[] = ["open", "upcoming", "unknown"];
  const total = order.reduce((sum, bucket) => sum + grouped[bucket].length, 0) + manualReviewNotices.length;
  let current = 0;
  let filterSummarySent = false;

  const emitProgress = (message: string): void => {
    if (!onProgress) {
      return;
    }

    const safeTotal = Math.max(total, 1);
    const safeCurrent = Math.min(Math.max(current, 0), safeTotal);
    onProgress({
      phase: "notify",
      current: safeCurrent,
      total: safeTotal,
      percent: Math.floor((safeCurrent / safeTotal) * 100),
      message,
    });
  };
  emitProgress(`Slack 전송 준비 (대상 ${total}건)`);

  try {
    for (const bucket of order) {
      const bucketNotices = grouped[bucket];
      if (bucketNotices.length === 0) {
        continue;
      }

      const batchHeader = buildBatchHeader(bucket, bucketNotices.length, isReprocess);
      try {
        const result = await postToSlack(webhookUrl, batchHeader, agent);
        tryAppendSlackHistory(
          createSlackHistoryRecord({
            runId,
            panId: null,
            messageType: "batch_header",
            applicationStatus: null,
            payloadText: batchHeader.text,
            status: "success",
            httpStatus: result.statusCode,
            errorMessage: null,
          }),
        );
      } catch (error) {
        const statusCode = error instanceof SlackPostError ? error.statusCode : null;
        const message = error instanceof Error ? error.message : String(error);
        tryAppendSlackHistory(
          createSlackHistoryRecord({
            runId,
            panId: null,
            messageType: "batch_header",
            applicationStatus: null,
            payloadText: batchHeader.text,
            status: "failed",
            httpStatus: statusCode,
            errorMessage: message,
          }),
        );
        throw error;
      }

      if (includeFilterSummary && !filterSummarySent) {
        const filterSummary = buildFilterSummaryMessage(user, isReprocess);
        try {
          const result = await postToSlack(webhookUrl, filterSummary, agent);
          tryAppendSlackHistory(
            createSlackHistoryRecord({
              runId,
              panId: null,
              messageType: "filter_summary",
              applicationStatus: null,
              payloadText: filterSummary.text,
              status: "success",
              httpStatus: result.statusCode,
              errorMessage: null,
            }),
          );
        } catch (error) {
          const statusCode = error instanceof SlackPostError ? error.statusCode : null;
          const message = error instanceof Error ? error.message : String(error);
          tryAppendSlackHistory(
            createSlackHistoryRecord({
              runId,
              panId: null,
              messageType: "filter_summary",
              applicationStatus: null,
              payloadText: filterSummary.text,
              status: "failed",
              httpStatus: statusCode,
              errorMessage: message,
            }),
          );
          throw error;
        }
        filterSummarySent = true;
      }

      if (!onProgress) {
        console.log(`[notifier] ${formatBucketTitle(bucket)} ${bucketNotices.length}건 전송 시작`);
      }

      for (const notice of bucketNotices) {
        const checks = buildEligibilityChecks(notice, user, incomeEligibilityContext);
        const message = formatSlackMessage(notice, checks, user.districts);
        try {
          const result = await postToSlack(webhookUrl, message, agent);
          tryAppendSlackHistory(
            createSlackHistoryRecord({
              runId,
              panId: notice.panId,
              messageType: "notice",
              applicationStatus: normalizeStatus(notice.applicationStatus),
              payloadText: message.text,
              status: "success",
              httpStatus: result.statusCode,
              errorMessage: null,
            }),
          );
        } catch (error) {
          const statusCode = error instanceof SlackPostError ? error.statusCode : null;
          const errorMessage = error instanceof Error ? error.message : String(error);
          tryAppendSlackHistory(
            createSlackHistoryRecord({
              runId,
              panId: notice.panId,
              messageType: "notice",
              applicationStatus: normalizeStatus(notice.applicationStatus),
              payloadText: message.text,
              status: "failed",
              httpStatus: statusCode,
              errorMessage,
            }),
          );
          throw error;
        }

        if (!onProgress) {
          console.log(`[notifier] 전송 완료: ${notice.title}`);
        }
        current += 1;
        emitProgress(`Slack 전송 ${current}/${total} (${formatBucketTitle(bucket)})`);
      }
    }

    if (manualReviewNotices.length > 0) {
      if (includeFilterSummary && !filterSummarySent) {
        const filterSummary = buildFilterSummaryMessage(user, isReprocess);
        try {
          const result = await postToSlack(webhookUrl, filterSummary, agent);
          tryAppendSlackHistory(
            createSlackHistoryRecord({
              runId,
              panId: null,
              messageType: "filter_summary",
              applicationStatus: null,
              payloadText: filterSummary.text,
              status: "success",
              httpStatus: result.statusCode,
              errorMessage: null,
            }),
          );
        } catch (error) {
          const statusCode = error instanceof SlackPostError ? error.statusCode : null;
          const errorMessage = error instanceof Error ? error.message : String(error);
          tryAppendSlackHistory(
            createSlackHistoryRecord({
              runId,
              panId: null,
              messageType: "filter_summary",
              applicationStatus: null,
              payloadText: filterSummary.text,
              status: "failed",
              httpStatus: statusCode,
              errorMessage,
            }),
          );
          throw error;
        }
        filterSummarySent = true;
      }

      for (const item of manualReviewNotices) {
        const message = formatManualReviewMessage(item);
        try {
          const result = await postToSlack(webhookUrl, message, agent);
          tryAppendSlackHistory(
            createSlackHistoryRecord({
              runId,
              panId: item.notice.panId,
              messageType: "manual_review_notice",
              applicationStatus: normalizeStatus(item.notice.applicationStatus),
              payloadText: message.text,
              status: "success",
              httpStatus: result.statusCode,
              errorMessage: null,
            }),
          );
        } catch (error) {
          const statusCode = error instanceof SlackPostError ? error.statusCode : null;
          const errorMessage = error instanceof Error ? error.message : String(error);
          tryAppendSlackHistory(
            createSlackHistoryRecord({
              runId,
              panId: item.notice.panId,
              messageType: "manual_review_notice",
              applicationStatus: normalizeStatus(item.notice.applicationStatus),
              payloadText: message.text,
              status: "failed",
              httpStatus: statusCode,
              errorMessage,
            }),
          );
          throw error;
        }

        current += 1;
        emitProgress(`Slack 전송 ${current}/${total} (자동추출 누락 알림)`);
      }
    }
  } finally {
    agent?.destroy();
  }
}
