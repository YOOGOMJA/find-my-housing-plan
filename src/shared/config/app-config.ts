import * as fs from "fs";
import * as path from "path";
import { UserProfile } from "../../entities/user";

export interface AppConfig {
  apiKey: string;
  anthropicKey: string;
  slackWebhookUrl: string;
  user: UserProfile;
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
  };

  return {
    apiKey,
    anthropicKey,
    slackWebhookUrl,
    user,
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
