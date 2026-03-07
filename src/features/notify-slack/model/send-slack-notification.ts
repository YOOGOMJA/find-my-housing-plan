import * as https from "https";
import { EligibilityCheck, NoticeApplicationStatus, ParsedNotice } from "../../../entities/notice";
import { UserProfile } from "../../../entities/user";
import { buildEligibilityChecks } from "../../filter-notices";
import { ProgressReporter } from "../../../shared/types";

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

export type SlackNoticeBucket = "open" | "upcoming" | "unknown";

const HOUSING_TYPE_CODE_LABEL: Record<string, string> = {
  "01": "토지/분양",
  "05": "공공분양",
  "06": "임대주택",
  "13": "매입임대/전세임대",
  "22": "상가/업무시설",
};

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

function buildBatchHeader(bucket: SlackNoticeBucket, count: number): SlackMessage {
  return {
    text: `📣 *LH 공고 알림* | *${formatBucketTitle(bucket)}* ${count}건`,
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

export function formatSlackMessage(
  notice: ParsedNotice,
  eligibilityChecks: EligibilityCheck[],
  preferredDistricts: string[],
): SlackMessage {
  const supplyHighlights = extractSupplyHighlights(notice.conditions.notes);

  const supplyLines = notice.supplyInfo
    .map((item) => {
      const deposit = notice.conditions.deposit[item.type] ?? "-";
      const rent = notice.conditions.rent[item.type] ?? "-";
      const preferred = preferredDistricts.length > 0 && item.address
        ? preferredDistricts.some((d) => item.address!.includes(d))
        : false;
      const prefixMark = preferred ? " [선호지역]" : "";

      const addressLine = item.address
        ? `  ${item.address}${prefixMark}`
        : `  ${item.type}형${prefixMark}`;

      const priceLine = `    ${item.area}㎡ ${item.count}세대 | 보증금 ${deposit} / 월임대료 ${rent}`;

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

  if (notice.conditions.notes) {
    lines.push("", "📝 *비고*", formatNotes(notice.conditions.notes));
  }

  lines.push("", `🆔 공고 ID: ${formatPanIdLink(notice.panId, notice.noticeUrl)}`);

  const noticeLink = formatNoticeLink(notice.noticeUrl);
  if (noticeLink !== "-") {
    lines.push(`🔗 바로가기: ${noticeLink}`);
  }

  return { text: lines.join("\n") };
}

function postToSlack(webhookUrl: string, message: SlackMessage): Promise<void> {
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
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          if (response.statusCode === 200) {
            resolve();
            return;
          }

          reject(new Error(`Slack 응답: ${response.statusCode ?? 0}`));
        });
      },
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

export async function sendSlackNotification(
  webhookUrl: string,
  notices: ParsedNotice[],
  user: UserProfile,
  onProgress?: ProgressReporter,
): Promise<void> {
  const grouped = groupNoticesByStatus(notices);
  const order: SlackNoticeBucket[] = ["open", "upcoming", "unknown"];
  const total = order.reduce((sum, bucket) => sum + grouped[bucket].length, 0);
  let current = 0;

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

  for (const bucket of order) {
    const bucketNotices = grouped[bucket];
    if (bucketNotices.length === 0) {
      continue;
    }

    await postToSlack(webhookUrl, buildBatchHeader(bucket, bucketNotices.length));
    if (!onProgress) {
      console.log(`[notifier] ${formatBucketTitle(bucket)} ${bucketNotices.length}건 전송 시작`);
    }

    for (const notice of bucketNotices) {
      const checks = buildEligibilityChecks(notice, user);
      const message = formatSlackMessage(notice, checks, user.districts);
      await postToSlack(webhookUrl, message);
      if (!onProgress) {
        console.log(`[notifier] 전송 완료: ${notice.title}`);
      }
      current += 1;
      emitProgress(`Slack 전송 ${current}/${total} (${formatBucketTitle(bucket)})`);
    }
  }
}
