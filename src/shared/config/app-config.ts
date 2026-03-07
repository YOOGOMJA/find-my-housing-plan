import * as fs from "fs";
import * as path from "path";
import { UserProfile } from "../../entities/user";

export interface AppConfig {
  apiKey: string;
  anthropicKey: string;
  slackWebhookUrl: string;
  user: UserProfile;
  performance: {
    collectConcurrency: number;
    classifyConcurrency: number;
    parseConcurrency: number;
    httpKeepAlive: boolean;
    timingSummary: boolean;
  };
  reprocess: {
    enabled: boolean;
    dryRun: boolean;
    lookbackMonths: number;
    maxNotifications: number;
  };
  incomeStandard: {
    path: string;
    year: number | null;
  };
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`환경변수 누락: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function parseIntValue(value: string, key: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`환경변수 숫자 파싱 실패: ${key}`);
  }

  return parsed;
}

function parseFloatValue(value: string, key: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`환경변수 숫자 파싱 실패: ${key}`);
  }

  return parsed;
}

function parseBooleanValue(value: string, key: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  throw new Error(`환경변수 불리언 파싱 실패: ${key}`);
}

function parsePositiveIntValue(value: string, key: string): number {
  const parsed = parseIntValue(value, key);
  if (parsed <= 0) {
    throw new Error(`환경변수는 1 이상의 정수여야 합니다: ${key}`);
  }
  return parsed;
}

function parseOptionalYearValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error("INCOME_STANDARD_YEAR는 정수여야 합니다.");
  }

  return parsed;
}

export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function loadConfig(): AppConfig {
  const apiKey = requireEnv("PUBLIC_DATA_API_KEY");
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");
  const slackWebhookUrl = requireEnv("SLACK_WEBHOOK_URL");

  const maritalStatus = optionalEnv("USER_MARITAL_STATUS", "single");
  if (!isValidMaritalStatus(maritalStatus)) {
    throw new Error("USER_MARITAL_STATUS는 single | married | newlywed 중 하나여야 합니다.");
  }

  const user: UserProfile = {
    age: parseIntValue(requireEnv("USER_AGE"), "USER_AGE"),
    maritalStatus,
    householdSize: parseIntValue(optionalEnv("USER_HOUSEHOLD_SIZE", "1"), "USER_HOUSEHOLD_SIZE"),
    currentRegion: optionalEnv("USER_CURRENT_REGION", ""),
    noHomeYears: parseFloatValue(optionalEnv("USER_NO_HOME_YEARS", "0"), "USER_NO_HOME_YEARS"),
    income: parseFloatValue(optionalEnv("USER_INCOME", "0"), "USER_INCOME"),
    asset: parseFloatValue(optionalEnv("USER_ASSET", "0"), "USER_ASSET"),
    carAsset: parseFloatValue(optionalEnv("USER_CAR_ASSET", "0"), "USER_CAR_ASSET"),
    subscriptionDate: optionalEnv("USER_SUBSCRIPTION_DATE", ""),
    subscriptionCount: parseIntValue(optionalEnv("USER_SUBSCRIPTION_COUNT", "0"), "USER_SUBSCRIPTION_COUNT"),
    subscriptionAmount: parseFloatValue(optionalEnv("USER_SUBSCRIPTION_AMOUNT", "0"), "USER_SUBSCRIPTION_AMOUNT"),
    regions: splitCsv(optionalEnv("USER_REGIONS", "")),
    minArea: parseFloatValue(optionalEnv("USER_MIN_AREA", "0"), "USER_MIN_AREA"),
    maxArea: parseFloatValue(optionalEnv("USER_MAX_AREA", "999"), "USER_MAX_AREA"),
    minBuildYear: parseIntValue(optionalEnv("USER_MIN_BUILD_YEAR", "0"), "USER_MIN_BUILD_YEAR"),
    housingTypes: splitCsv(optionalEnv("USER_HOUSING_TYPES", "")),
    districts: splitCsv(optionalEnv("USER_DISTRICTS", "")),
    maxDeposit: parseFloatValue(optionalEnv("USER_MAX_DEPOSIT", "0"), "USER_MAX_DEPOSIT"),
    maxRent: parseFloatValue(optionalEnv("USER_MAX_RENT", "0"), "USER_MAX_RENT"),
    applicantGroup: parseApplicantGroup(optionalEnv("USER_APPLICANT_GROUP", "general")),
  };

  const performance = {
    collectConcurrency: parsePositiveIntValue(optionalEnv("COLLECT_CONCURRENCY", "4"), "COLLECT_CONCURRENCY"),
    classifyConcurrency: parsePositiveIntValue(optionalEnv("CLASSIFY_CONCURRENCY", "2"), "CLASSIFY_CONCURRENCY"),
    parseConcurrency: parsePositiveIntValue(optionalEnv("PARSE_CONCURRENCY", "2"), "PARSE_CONCURRENCY"),
    httpKeepAlive: parseBooleanValue(optionalEnv("HTTP_KEEP_ALIVE", "true"), "HTTP_KEEP_ALIVE"),
    timingSummary: parseBooleanValue(optionalEnv("PERF_TIMING_SUMMARY", "true"), "PERF_TIMING_SUMMARY"),
  };

  const reprocess = {
    enabled: parseBooleanValue(optionalEnv("REPROCESS_ENABLED", "false"), "REPROCESS_ENABLED"),
    dryRun: parseBooleanValue(optionalEnv("REPROCESS_DRY_RUN", "false"), "REPROCESS_DRY_RUN"),
    lookbackMonths: parsePositiveIntValue(optionalEnv("REPROCESS_LOOKBACK_MONTHS", "6"), "REPROCESS_LOOKBACK_MONTHS"),
    maxNotifications: parsePositiveIntValue(
      optionalEnv("REPROCESS_MAX_NOTIFICATIONS", "50"),
      "REPROCESS_MAX_NOTIFICATIONS",
    ),
  };

  const incomeStandard = {
    path: optionalEnv("INCOME_STANDARD_PATH", "data/income-standards/latest.json"),
    year: parseOptionalYearValue(optionalEnv("INCOME_STANDARD_YEAR", "")),
  };

  return {
    apiKey,
    anthropicKey,
    slackWebhookUrl,
    user,
    performance,
    reprocess,
    incomeStandard,
  };
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isValidMaritalStatus(value: string): value is UserProfile["maritalStatus"] {
  return value === "single" || value === "married" || value === "newlywed";
}

function parseApplicantGroup(value: string): UserProfile["applicantGroup"] {
  const valid = ["general", "youth", "newlywed", "newborn", "multiChild"] as const;
  return (valid as readonly string[]).includes(value)
    ? (value as UserProfile["applicantGroup"])
    : null;
}
