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
  const value = process.env[key];
  if (!value) {
    throw new Error(`환경변수 누락: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function parseIntValue(value: string): number {
  return Number.parseInt(value, 10);
}

function parseFloatValue(value: string): number {
  return Number.parseFloat(value);
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
    age: parseIntValue(requireEnv("USER_AGE")),
    maritalStatus,
    householdSize: parseIntValue(optionalEnv("USER_HOUSEHOLD_SIZE", "1")),
    currentRegion: optionalEnv("USER_CURRENT_REGION", ""),
    noHomeYears: parseFloatValue(optionalEnv("USER_NO_HOME_YEARS", "0")),
    income: parseFloatValue(optionalEnv("USER_INCOME", "0")),
    asset: parseFloatValue(optionalEnv("USER_ASSET", "0")),
    carAsset: parseFloatValue(optionalEnv("USER_CAR_ASSET", "0")),
    subscriptionDate: optionalEnv("USER_SUBSCRIPTION_DATE", ""),
    subscriptionCount: parseIntValue(optionalEnv("USER_SUBSCRIPTION_COUNT", "0")),
    subscriptionAmount: parseFloatValue(optionalEnv("USER_SUBSCRIPTION_AMOUNT", "0")),
    regions: splitCsv(optionalEnv("USER_REGIONS", "")),
    minArea: parseFloatValue(optionalEnv("USER_MIN_AREA", "0")),
    maxArea: parseFloatValue(optionalEnv("USER_MAX_AREA", "999")),
    minBuildYear: parseIntValue(optionalEnv("USER_MIN_BUILD_YEAR", "0")),
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
