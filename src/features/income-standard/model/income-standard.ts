import * as fs from "fs";
import * as path from "path";

export interface IncomeStandard {
  year: number;
  publishedAt: string;
  sourceUrl: string;
  unit: string;
  householdIncome: Record<string, number>;
}

export interface IncomeStandardCatalog {
  latest: IncomeStandard | null;
  byYear: Record<number, IncomeStandard>;
  rootDir: string;
}

export interface IncomeStandardSelection {
  standard: IncomeStandard | null;
  source: "forced_year" | "notice_year" | "latest" | "none";
  requestedYear: number | null;
  reason: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function parseYear(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 2000) {
    return null;
  }

  return value;
}

export function validateIncomeStandard(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) {
    return ["root object가 아닙니다."];
  }

  const year = parseYear(value.year);
  if (year === null) {
    errors.push("year는 2000 이상 정수여야 합니다.");
  }

  if (typeof value.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.publishedAt)) {
    errors.push("publishedAt은 YYYY-MM-DD 형식이어야 합니다.");
  }

  if (typeof value.sourceUrl !== "string" || !/^https?:\/\/\S+/.test(value.sourceUrl)) {
    errors.push("sourceUrl은 http/https URL이어야 합니다.");
  }

  if (value.unit !== "만원/월") {
    errors.push("unit은 '만원/월' 이어야 합니다.");
  }

  if (!isObject(value.householdIncome)) {
    errors.push("householdIncome은 object여야 합니다.");
  } else {
    for (let size = 1; size <= 6; size += 1) {
      const key = String(size);
      const amount = parsePositiveNumber(value.householdIncome[key]);
      if (amount === null) {
        errors.push(`householdIncome.${key}는 양수 number여야 합니다.`);
      }
    }
  }

  return errors;
}

export function toIncomeStandard(value: unknown): IncomeStandard | null {
  const errors = validateIncomeStandard(value);
  if (errors.length > 0 || !isObject(value) || !isObject(value.householdIncome)) {
    return null;
  }

  const householdIncome: Record<string, number> = {};
  for (let size = 1; size <= 6; size += 1) {
    householdIncome[String(size)] = value.householdIncome[String(size)] as number;
  }

  return {
    year: value.year as number,
    publishedAt: value.publishedAt as string,
    sourceUrl: value.sourceUrl as string,
    unit: value.unit as string,
    householdIncome,
  };
}

function safeReadJson(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadIncomeStandardCatalog(standardPath: string): IncomeStandardCatalog {
  const rootDir = path.dirname(standardPath);
  const latest = toIncomeStandard(safeReadJson(standardPath));
  const byYear: Record<number, IncomeStandard> = {};

  const historyDir = path.join(rootDir, "history");
  if (fs.existsSync(historyDir) && fs.statSync(historyDir).isDirectory()) {
    for (const fileName of fs.readdirSync(historyDir)) {
      if (!fileName.endsWith(".json")) {
        continue;
      }

      const parsed = toIncomeStandard(safeReadJson(path.join(historyDir, fileName)));
      if (parsed) {
        byYear[parsed.year] = parsed;
      }
    }
  }

  if (latest) {
    byYear[latest.year] = latest;
  }

  return { latest, byYear, rootDir };
}

export function parseNoticeYear(noticeDate: string): number | null {
  const digits = noticeDate.replace(/\D/g, "");
  if (digits.length < 4) {
    return null;
  }

  const year = Number.parseInt(digits.slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

export function resolveIncomeStandardSelection(
  catalog: IncomeStandardCatalog | null,
  noticeDate: string,
  forcedYear: number | null,
): IncomeStandardSelection {
  if (!catalog) {
    return {
      standard: null,
      source: "none",
      requestedYear: forcedYear,
      reason: "기준표 카탈로그를 로드하지 못했습니다.",
    };
  }

  if (forcedYear !== null) {
    const forced = catalog.byYear[forcedYear];
    if (forced) {
      return { standard: forced, source: "forced_year", requestedYear: forcedYear, reason: null };
    }
  }

  const noticeYear = parseNoticeYear(noticeDate);
  if (noticeYear !== null) {
    const requestedYear = noticeYear - 1;
    const byNoticeYear = catalog.byYear[requestedYear];
    if (byNoticeYear) {
      return { standard: byNoticeYear, source: "notice_year", requestedYear, reason: null };
    }
  }

  if (catalog.latest) {
    return { standard: catalog.latest, source: "latest", requestedYear: catalog.latest.year, reason: null };
  }

  return {
    standard: null,
    source: "none",
    requestedYear: forcedYear,
    reason: "사용 가능한 소득 기준표가 없습니다.",
  };
}

export function resolveHouseholdIncome(standard: IncomeStandard, householdSize: number): number | null {
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 6) {
    return null;
  }

  const value = standard.householdIncome[String(householdSize)];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function detectIncomePercent(text: string): number | null {
  const normalized = text.replace(/\s+/g, " ");
  if (!/(도시근로자|월평균소득)/.test(normalized)) {
    return null;
  }

  const percentMatch = normalized.match(/(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*퍼센트/);
  if (!percentMatch) {
    return null;
  }

  const raw = percentMatch[1] ?? percentMatch[2];
  const value = raw ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}
