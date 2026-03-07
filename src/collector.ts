import * as https from "https";
import { Notice, NoticeApplicationStatus, SupplyItem } from "./types";

const LIST_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1";
const DETAIL_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeDtlInfo1/getLeaseNoticeDtlInfo1";
const SUPPLY_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1/getLeaseNoticeSplInfo1";
const PAGE_SIZE = 100;
const MAX_PAGE = 10;

type JsonObject = Record<string, unknown>;

interface NoticeDetailInfo {
  pdfUrl: string | null;
  applicationStartDate: string | null;
  applicationEndDate: string | null;
  applicationStatus: NoticeApplicationStatus;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parseDateTimeToMs(raw: string | null): number | null {
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
  const hour = match[4] ? Number.parseInt(match[4], 10) : 0;
  const minute = match[5] ? Number.parseInt(match[5], 10) : 0;

  const timestamp = new Date(year, month, day, hour, minute, 0, 0).getTime();
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

function classifyApplicationStatus(
  listPhase: NoticeApplicationStatus,
  applicationStartDate: string | null,
  applicationEndDate: string | null,
  nowMs: number,
): NoticeApplicationStatus {
  const startMs = parseDateTimeToMs(applicationStartDate);
  const endMs = parseDateTimeToMs(applicationEndDate);

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

export function extractItems(body: unknown): Record<string, unknown>[] {
  if (!Array.isArray(body)) {
    return [];
  }

  for (const chunk of body) {
    if (!isJsonObject(chunk)) {
      continue;
    }

    for (const [key, value] of Object.entries(chunk)) {
      if (key === "dsSch" || key === "resHeader") {
        continue;
      }

      if (!Array.isArray(value)) {
        continue;
      }

      return value.filter(isJsonObject);
    }
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

export function toSeenKey(panId: string, phase: NoticeApplicationStatus): string {
  return `${panId}:${phase}`;
}

export function shouldCollectBySeen(
  seenIds: Set<string>,
  panId: string,
  phase: NoticeApplicationStatus,
): boolean {
  if (!panId) {
    return false;
  }

  if (seenIds.has(toSeenKey(panId, phase))) {
    return false;
  }

  if (phase === "upcoming" || phase === "unknown") {
    return !seenIds.has(panId);
  }

  return true;
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

async function fetchNoticeList(apiKey: string): Promise<Record<string, unknown>[]> {
  const today = new Date();
  const lookback = new Date(today);
  lookback.setMonth(lookback.getMonth() - 6);

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

    const { body } = await get(url);
    const items = extractItems(body);
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
): Promise<NoticeDetailInfo> {
  const listPhase = inferListStatusPhase(toString(item.PAN_SS));
  const url = buildApiUrl(DETAIL_URL, apiKey, buildDetailParams(item, panId));
  const { body } = await get(url);

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

async function fetchSupplyInfo(apiKey: string, item: Record<string, unknown>, panId: string): Promise<SupplyItem[]> {
  const url = buildApiUrl(SUPPLY_URL, apiKey, buildDetailParams(item, panId));
  const { body } = await get(url);
  const items = extractItems(body);

  return items.map((supply) => ({
    type: toString(supply.HTY_NNA),
    area: toNumber(supply.DDO_AR),
    count: Math.trunc(toNumber(supply.NOW_HSH_CNT)),
  }));
}

export async function collectNotices(apiKey: string, seenIds: Set<string>): Promise<Notice[]> {
  const rawItems = await fetchNoticeList(apiKey);
  const targets = rawItems.filter((item) => {
    const panId = parsePanId(item);
    const phase = inferListStatusPhase(toString(item.PAN_SS));
    return shouldCollectBySeen(seenIds, panId, phase);
  });

  const notices: Notice[] = [];

  for (const item of targets) {
    const panId = parsePanId(item);
    if (!panId) {
      continue;
    }

    const [detail, supplyInfo] = await Promise.all([
      fetchDetailInfo(apiKey, item, panId),
      fetchSupplyInfo(apiKey, item, panId),
    ]);

    if (detail.applicationStatus === "closed") {
      continue;
    }

    notices.push({
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
    });
  }

  return notices;
}
