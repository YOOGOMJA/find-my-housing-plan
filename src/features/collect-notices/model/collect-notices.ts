import * as https from "https";
import { Notice, NoticeApplicationStatus, SupplyItem } from "../../../entities/notice";
import { ProgressReporter } from "../../../shared/types";
import { mapWithConcurrency } from "../../../shared/lib";
import { toProcessedKey } from "../../notice-state";

const LIST_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1";
const DETAIL_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeDtlInfo1/getLeaseNoticeDtlInfo1";
const SUPPLY_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1/getLeaseNoticeSplInfo1";
const PAGE_SIZE = 100;
const MAX_PAGE = 10;

type JsonObject = Record<string, unknown>;
type SupplyAreaSource = SupplyItem["areaSource"];
type SupplyCountSource = SupplyItem["countSource"];

interface NoticeDetailInfo {
  pdfUrl: string | null;
  applicationStartDate: string | null;
  applicationEndDate: string | null;
  applicationStatus: NoticeApplicationStatus;
}

interface ExtractItemsOptions {
  preferredKeys?: string[];
}

function emitCollectProgress(
  onProgress: ProgressReporter | undefined,
  current: number,
  total: number,
  message: string,
): void {
  if (!onProgress) {
    return;
  }

  const safeTotal = Math.max(total, 1);
  const safeCurrent = Math.min(Math.max(current, 0), safeTotal);

  onProgress({
    phase: "collect",
    current: safeCurrent,
    total: safeTotal,
    percent: Math.floor((safeCurrent / safeTotal) * 100),
    message,
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeBody(body: unknown): string {
  if (typeof body === "string") {
    return body.slice(0, 200);
  }

  try {
    return JSON.stringify(body).slice(0, 200);
  } catch {
    return String(body).slice(0, 200);
  }
}

export function assertSuccessStatus(status: number, url: string, body: unknown): void {
  if (status >= 200 && status < 300) {
    return;
  }

  throw new Error(`[collector] API 호출 실패: status=${status}, url=${url}, body=${summarizeBody(body)}`);
}

function get(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });

        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString("utf-8");

          try {
            resolve({ status, body: JSON.parse(text) as unknown });
          } catch {
            resolve({ status, body: text });
          }
        });
      })
      .on("error", reject);
  });
}

function getWithAgent(url: string, agent: https.Agent | undefined): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { agent }, (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });

        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString("utf-8");

          try {
            resolve({ status, body: JSON.parse(text) as unknown });
          } catch {
            resolve({ status, body: text });
          }
        });
      })
      .on("error", reject);
  });
}

function toString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatApiDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}`;
}

function toYmdNumber(value: unknown): number | null {
  const digits = toString(value).replace(/\D/g, "");
  if (digits.length < 8) {
    return null;
  }

  const parsed = Number.parseInt(digits.slice(0, 8), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseDateTimeToMs(raw: string | null, fallbackTime: "start" | "end" = "start"): number | null {
  if (!raw) {
    return null;
  }

  const match = raw.trim().match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const hasExplicitTime = Boolean(match[4]);
  const hour = hasExplicitTime ? Number.parseInt(match[4], 10) : fallbackTime === "end" ? 23 : 0;
  const minute = hasExplicitTime ? (match[5] ? Number.parseInt(match[5], 10) : 0) : fallbackTime === "end" ? 59 : 0;
  const second = hasExplicitTime ? 0 : fallbackTime === "end" ? 59 : 0;
  const millisecond = hasExplicitTime ? 0 : fallbackTime === "end" ? 999 : 0;

  const timestamp = new Date(year, month, day, hour, minute, second, millisecond).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function pickFirstString(source: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = toString(source[key]).trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export function classifyApplicationStatus(
  listPhase: NoticeApplicationStatus,
  applicationStartDate: string | null,
  applicationEndDate: string | null,
  nowMs: number,
): NoticeApplicationStatus {
  const startMs = parseDateTimeToMs(applicationStartDate, "start");
  const endMs = parseDateTimeToMs(applicationEndDate, "end");

  if (startMs !== null && endMs !== null) {
    if (nowMs < startMs) {
      return "upcoming";
    }
    if (nowMs > endMs) {
      return "closed";
    }
    return "open";
  }

  if (startMs !== null) {
    return nowMs < startMs ? "upcoming" : "open";
  }

  if (endMs !== null) {
    return nowMs > endMs ? "closed" : "open";
  }

  return listPhase;
}

function isMetaArrayKey(key: string): boolean {
  if (key === "dsSch" || key === "resHeader") {
    return true;
  }
  if (key.endsWith("Nm")) {
    return true;
  }

  return false;
}

export function extractItems(body: unknown, options?: ExtractItemsOptions): Record<string, unknown>[] {
  if (!Array.isArray(body)) {
    return [];
  }

  const candidates: Array<{ key: string; items: Record<string, unknown>[] }> = [];

  for (const chunk of body) {
    if (!isJsonObject(chunk)) {
      continue;
    }

    for (const [key, value] of Object.entries(chunk)) {
      if (!Array.isArray(value)) {
        continue;
      }

      candidates.push({
        key,
        items: value.filter(isJsonObject),
      });
    }
  }

  const preferredKeys = options?.preferredKeys ?? [];
  for (const preferredKey of preferredKeys) {
    const preferred = candidates.find((candidate) => candidate.key === preferredKey && candidate.items.length > 0);
    if (preferred) {
      return preferred.items;
    }
  }

  const primary = candidates.find((candidate) => !isMetaArrayKey(candidate.key) && candidate.items.length > 0);
  if (primary) {
    return primary.items;
  }

  const fallback = candidates.find((candidate) => candidate.items.length > 0);
  if (fallback) {
    return fallback.items;
  }

  return [];
}

export function parsePanId(item: Record<string, unknown>): string {
  return toString(item.PAN_ID);
}

export function buildApiUrl(endpoint: string, apiKey: string, params: Record<string, string>): string {
  const query = new URLSearchParams({
    ...params,
    serviceKey: apiKey,
  });

  return `${endpoint}?${query.toString()}`;
}

export function inferListStatusPhase(statusText: string): NoticeApplicationStatus {
  if (statusText.includes("마감") || statusText.includes("종료")) {
    return "closed";
  }

  if (statusText.includes("접수중")) {
    return "open";
  }

  if (statusText.includes("공고중") || statusText.includes("정정공고중") || statusText.includes("상담요청")) {
    return "upcoming";
  }

  return "unknown";
}

export function isNoticeOpen(item: Record<string, unknown>, todayYmd: number): boolean {
  const listPhase = inferListStatusPhase(toString(item.PAN_SS));
  if (listPhase === "closed") {
    return false;
  }

  const closeYmd = toYmdNumber(item.CLSG_DT);
  if (closeYmd !== null && closeYmd < todayYmd) {
    return false;
  }

  return true;
}

export function shouldCollectByProcessed(
  processedKeys: Set<string>,
  panId: string,
  phase: NoticeApplicationStatus,
): boolean {
  if (!panId) {
    return false;
  }

  return !processedKeys.has(toProcessedKey(panId, phase));
}

function buildDetailParams(item: Record<string, unknown>, panId: string): Record<string, string> {
  return {
    type: "json",
    PAN_ID: panId,
    UPP_AIS_TP_CD: toString(item.UPP_AIS_TP_CD) || "06",
    CCR_CNNT_SYS_DS_CD: toString(item.CCR_CNNT_SYS_DS_CD) || "01",
    SPL_INF_TP_CD: toString(item.SPL_INF_TP_CD) || "010",
  };
}

async function fetchNoticeList(
  apiKey: string,
  onProgress?: ProgressReporter,
  lookbackMonths = 6,
): Promise<Record<string, unknown>[]> {
  const today = new Date();
  const lookback = new Date(today);
  lookback.setMonth(lookback.getMonth() - lookbackMonths);

  const todayYmd = toYmdNumber(formatApiDate(today)) ?? 0;
  const startDate = formatApiDate(lookback);
  const endDate = formatApiDate(today);
  const unique = new Map<string, Record<string, unknown>>();

  for (let page = 1; page <= MAX_PAGE; page += 1) {
    const url = buildApiUrl(LIST_URL, apiKey, {
      type: "json",
      PG_SZ: String(PAGE_SIZE),
      PAGE: String(page),
      PAN_NT_ST_DT: startDate,
      CLSG_DT: endDate,
    });

    const { status, body } = await get(url);
    assertSuccessStatus(status, url, body);
    const items = extractItems(body);
    emitCollectProgress(onProgress, page, MAX_PAGE, `목록 페이지 조회 ${page}/${MAX_PAGE}`);
    if (items.length === 0) {
      break;
    }

    for (const item of items) {
      const panId = parsePanId(item);
      if (!panId) {
        continue;
      }

      if (isNoticeOpen(item, todayYmd)) {
        unique.set(panId, item);
      }
    }

    if (items.length < PAGE_SIZE) {
      break;
    }
  }

  return [...unique.values()];
}

async function fetchDetailInfo(
  apiKey: string,
  item: Record<string, unknown>,
  panId: string,
  agent?: https.Agent,
): Promise<NoticeDetailInfo> {
  const listPhase = inferListStatusPhase(toString(item.PAN_SS));
  const url = buildApiUrl(DETAIL_URL, apiKey, buildDetailParams(item, panId));
  const { status, body } = await getWithAgent(url, agent);
  assertSuccessStatus(status, url, body);

  if (!Array.isArray(body)) {
    return {
      pdfUrl: null,
      applicationStartDate: null,
      applicationEndDate: null,
      applicationStatus: listPhase,
    };
  }

  let pdfUrl: string | null = null;
  let applicationStartDate: string | null = null;
  let applicationEndDate: string | null = null;

  for (const chunk of body) {
    if (!isJsonObject(chunk)) {
      continue;
    }

    const files = chunk.dsAhflInfo;
    if (Array.isArray(files)) {
      for (const file of files) {
        if (!isJsonObject(file)) {
          continue;
        }

        const fileType = toString(file.SL_PAN_AHFL_DS_CD_NM);
        const fileUrl = toString(file.AHFL_URL);
        if (fileType.includes("PDF") && fileUrl) {
          pdfUrl = fileUrl;
          break;
        }
      }
    }

    const schedules = chunk.dsSplScdl;
    if (Array.isArray(schedules)) {
      for (const schedule of schedules) {
        if (!isJsonObject(schedule)) {
          continue;
        }

        if (!applicationStartDate) {
          applicationStartDate = pickFirstString(schedule, [
            "ACP_ST_DTTM",
            "SBSC_ACP_ST_DT",
            "UST_ACP_ST_DTTM",
          ]);
        }

        if (!applicationEndDate) {
          applicationEndDate = pickFirstString(schedule, [
            "ACP_ED_DTTM",
            "SBSC_ACP_CLSG_DT",
            "UST_ACP_CLSG_DTTM",
          ]);
        }

        if (applicationStartDate && applicationEndDate) {
          break;
        }
      }
    }
  }

  return {
    pdfUrl,
    applicationStartDate,
    applicationEndDate,
    applicationStatus: classifyApplicationStatus(
      listPhase,
      applicationStartDate,
      applicationEndDate,
      Date.now(),
    ),
  };
}

async function fetchSupplyInfo(
  apiKey: string,
  item: Record<string, unknown>,
  panId: string,
  agent?: https.Agent,
): Promise<SupplyItem[]> {
  const url = buildApiUrl(SUPPLY_URL, apiKey, buildDetailParams(item, panId));
  const { status, body } = await getWithAgent(url, agent);
  assertSuccessStatus(status, url, body);
  const items = extractItems(body, { preferredKeys: ["dsList01", "dsList", "dsList02"] });

  return items
    .filter((supply) => !isSupplyHeaderRow(supply))
    .map((supply) => {
      const { area, source: areaSource } = parseSupplyArea(supply);
      const { count, source: countSource } = parseSupplyCount(supply);
      const rawTypeText = toString(supply.HTY_DS_NM).trim() || undefined;
      const type = parseSupplyType(supply, rawTypeText);
      const address = parseSupplyAddress(supply);

      return {
        type,
        area,
        count,
        address,
        areaSource,
        countSource,
        rawTypeText,
      };
    });
}

function isSupplyHeaderRow(supply: Record<string, unknown>): boolean {
  const type = toString(supply.HTY_DS_NM).trim();
  const count = toString(supply.GNR_SPL_RMNO).trim();
  const area = toString(supply.DDO_AR).trim();
  const address = toString(supply.LTR_UNT_NM).trim();
  return (
    type === "주택유형"
    || count === "공급호수"
    || area === "전용면적"
    || address === "상세지역"
  );
}

function parseAreaFromTypeText(rawTypeText: string): number {
  const match = rawTypeText.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return 0;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSupplyArea(supply: Record<string, unknown>): { area: number; source: SupplyAreaSource } {
  const areaFromDdoAr = toNumber(supply.DDO_AR);
  if (areaFromDdoAr > 0) {
    return { area: areaFromDdoAr, source: "DDO_AR" };
  }

  const rawTypeText = toString(supply.HTY_DS_NM).trim();
  const areaFromType = parseAreaFromTypeText(rawTypeText);
  if (areaFromType > 0) {
    return { area: areaFromType, source: "HTY_DS_NM" };
  }

  return { area: 0, source: "UNKNOWN" };
}

function parseSupplyCount(supply: Record<string, unknown>): { count: number; source: SupplyCountSource } {
  const countFromNow = Math.trunc(toNumber(supply.NOW_HSH_CNT));
  if (countFromNow > 0) {
    return { count: countFromNow, source: "NOW_HSH_CNT" };
  }

  const countFromGeneral = Math.trunc(toNumber(supply.GNR_SPL_RMNO));
  if (countFromGeneral > 0) {
    return { count: countFromGeneral, source: "GNR_SPL_RMNO" };
  }

  return { count: 0, source: "UNKNOWN" };
}

function parseSupplyType(supply: Record<string, unknown>, rawTypeText: string | undefined): string {
  const directType = toString(supply.HTY_NNA).trim();
  if (directType) {
    return directType;
  }

  if (rawTypeText) {
    const numberMatch = rawTypeText.match(/(\d+(?:\.\d+)?)/);
    if (numberMatch) {
      return numberMatch[1];
    }
    return rawTypeText;
  }

  return "미상";
}

function parseSupplyAddress(supply: Record<string, unknown>): string | null {
  const unit = toString(supply.LTR_UNT_NM).trim();
  const region = toString(supply.SBD_CNP_NM).trim();
  if (unit && region && !unit.includes(region)) {
    return `${region} ${unit}`.trim();
  }

  if (unit) {
    return unit;
  }

  if (region) {
    return region;
  }

  return null;
}

export async function collectNotices(
  apiKey: string,
  processedKeys: Set<string>,
  onProgress?: ProgressReporter,
  options?: { concurrency?: number; keepAlive?: boolean; lookbackMonths?: number },
): Promise<Notice[]> {
  const lookbackMonths = Math.max(1, Math.floor(options?.lookbackMonths ?? 6));
  const rawItems = await fetchNoticeList(apiKey, onProgress, lookbackMonths);
  const total = rawItems.length;
  const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 4));
  const keepAlive = options?.keepAlive ?? true;
  const agent = keepAlive ? new https.Agent({ keepAlive: true }) : undefined;
  let skippedByProcessed = 0;
  let skippedByClosed = 0;
  let examined = 0;
  let collected = 0;

  emitCollectProgress(onProgress, 0, Math.max(total, 1), `상세 조회 준비 (대상 ${total}건)`);

  const processed = await (async () => {
    try {
      return await mapWithConcurrency(rawItems, concurrency, async (item) => {
        const panId = parsePanId(item);
        if (!panId) {
          return null;
        }

        const detail = await fetchDetailInfo(apiKey, item, panId, agent);
        if (!shouldCollectByProcessed(processedKeys, panId, detail.applicationStatus)) {
          skippedByProcessed += 1;
          examined += 1;
          emitCollectProgress(
            onProgress,
            examined,
            Math.max(total, 1),
            `상세/공급 조회 ${examined}/${total} (기처리 제외 ${skippedByProcessed})`,
          );
          return null;
        }

        if (detail.applicationStatus === "closed") {
          skippedByClosed += 1;
          examined += 1;
          emitCollectProgress(
            onProgress,
            examined,
            Math.max(total, 1),
            `상세/공급 조회 ${examined}/${total} (마감 제외 ${skippedByClosed})`,
          );
          return null;
        }

        const supplyInfo = await fetchSupplyInfo(apiKey, item, panId, agent);
        const notice: Notice = {
          panId,
          title: toString(item.PAN_NM) || toString(item.LCC_NT_NM),
          region: toString(item.CNP_CD) || toString(item.CNP_CD_NM),
          housingType: toString(item.UPP_AIS_TP_CD),
          upperTypeName: toString(item.UPP_AIS_TP_NM) || null,
          detailTypeName: toString(item.AIS_TP_CD_NM) || null,
          noticeDate: toString(item.PAN_DT) || toString(item.PAN_NT_ST_DT),
          noticeUrl: toString(item.DTL_URL) || toString(item.DTL_URL_MOB) || null,
          applicationStartDate: detail.applicationStartDate,
          applicationEndDate: detail.applicationEndDate,
          applicationStatus: detail.applicationStatus,
          pdfUrl: detail.pdfUrl,
          supplyInfo,
        };
        examined += 1;
        collected += 1;
        emitCollectProgress(
          onProgress,
          examined,
          Math.max(total, 1),
          `상세/공급 조회 ${examined}/${total} (수집 ${collected}건)`,
        );
        return notice;
      });
    } finally {
      agent?.destroy();
    }
  })();

  const notices = processed.filter((notice): notice is Notice => notice !== null);

  emitCollectProgress(
    onProgress,
    Math.max(total, 1),
    Math.max(total, 1),
    `수집 완료: 대상 ${total}건, 수집 ${notices.length}건, 기처리 제외 ${skippedByProcessed}건, 마감 제외 ${skippedByClosed}건`,
  );

  return notices;
}
