import { EligibilityCheck, EligibilityResult, Notice, ParsedNotice } from "../../../entities/notice";
import { UserProfile } from "../../../entities/user";
import {
  IncomeStandardCatalog,
  detectIncomePercent,
  resolveHouseholdIncome,
  resolveIncomeStandardSelection,
} from "../../income-standard";

const REGION_ALIAS_TO_CODE: Record<string, string> = {
  전국: "00",
  서울: "11",
  서울특별시: "11",
  부산: "26",
  부산광역시: "26",
  대구: "27",
  대구광역시: "27",
  인천: "28",
  인천광역시: "28",
  광주: "29",
  광주광역시: "29",
  대전: "30",
  대전광역시: "30",
  울산: "31",
  울산광역시: "31",
  세종: "36",
  세종특별자치시: "36",
  경기: "41",
  경기도: "41",
  강원: "42",
  강원도: "42",
  강원특별자치도: "42",
  충북: "43",
  충청북도: "43",
  충남: "44",
  충청남도: "44",
  전북: "45",
  전라북도: "45",
  전북특별자치도: "45",
  전남: "46",
  전라남도: "46",
  경북: "47",
  경상북도: "47",
  경남: "48",
  경상남도: "48",
  제주: "50",
  제주특별자치도: "50",
};

type HousingPreferenceNotice = Pick<Notice, "region" | "housingType" | "supplyInfo">;
export interface IncomeEligibilityContext {
  incomeStandardCatalog?: IncomeStandardCatalog | null;
  forcedIncomeStandardYear?: number | null;
}

function parseAssetLimit(text: string): number | null {
  const eokMatch = text.match(/([\d.]+)\s*억/);
  const manwonMatch = text.match(/([\d,]+(?:\.\d+)?)\s*만\s*원/);

  let total = 0;
  let matched = false;

  if (eokMatch) {
    const eok = Number.parseFloat(eokMatch[1]);
    if (Number.isFinite(eok)) {
      total += eok * 10000;
      matched = true;
    }
  }

  if (manwonMatch) {
    const manwon = Number.parseFloat(manwonMatch[1].replace(/,/g, ""));
    if (Number.isFinite(manwon)) {
      total += manwon;
      matched = true;
    }
  }

  return matched ? total : null;
}

function parseAbsoluteIncomeLimit(text: string): number | null {
  const amountMatches = [...text.matchAll(/([\d,]+(?:\.\d+)?)\s*만\s*원/g)];
  if (amountMatches.length > 0) {
    const values = amountMatches
      .map((match) => Number.parseFloat(match[1].replace(/,/g, "")))
      .filter((value) => Number.isFinite(value));

    if (values.length > 0) {
      return Math.min(...values);
    }
  }

  const eokMatch = text.match(/([\d.]+)\s*억/);
  if (eokMatch) {
    const value = Number.parseFloat(eokMatch[1]) * 10000;
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

function resolveIncomeLimit(
  notice: ParsedNotice,
  user: UserProfile,
  context?: IncomeEligibilityContext,
): { limit: number | null; reason: string | null } {
  const absolute = parseAbsoluteIncomeLimit(notice.conditions.incomeLimit ?? "");
  if (absolute !== null) {
    return { limit: absolute, reason: null };
  }

  const percent = detectIncomePercent(notice.conditions.incomeLimit ?? "");
  if (percent === null) {
    return { limit: null, reason: null };
  }

  if (context?.incomeStandardCatalog === undefined) {
    return { limit: null, reason: null };
  }

  const forcedYear = context?.forcedIncomeStandardYear ?? null;
  const selection = resolveIncomeStandardSelection(
    context?.incomeStandardCatalog ?? null,
    notice.noticeDate,
    forcedYear,
  );
  if (!selection.standard) {
    return {
      limit: null,
      reason: selection.reason ?? `소득 기준표를 찾지 못했습니다 (요청 연도: ${selection.requestedYear ?? "없음"})`,
    };
  }

  const householdIncome = resolveHouseholdIncome(selection.standard, user.householdSize);
  if (householdIncome === null) {
    return {
      limit: null,
      reason: `가구원수 ${user.householdSize}명은 소득 기준표 범위를 벗어납니다.`,
    };
  }

  return {
    limit: householdIncome * (percent / 100),
    reason: null,
  };
}

function hasExtractedEligibilityData(notice: ParsedNotice): boolean {
  const { conditions } = notice;

  return Boolean(
    conditions.incomeLimit ||
      conditions.assetLimit ||
      conditions.carAssetLimit ||
      conditions.noHomeCondition ||
      conditions.subscriptionCondition ||
      conditions.target ||
      conditions.notes ||
      Object.keys(conditions.deposit).length > 0 ||
      Object.keys(conditions.rent).length > 0 ||
      Object.keys(conditions.contract).length > 0,
  );
}

function normalizeRegionToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return REGION_ALIAS_TO_CODE[trimmed] ?? trimmed;
}

function matchesRegion(noticeRegion: string, userRegions: string[]): boolean {
  if (userRegions.length === 0) {
    return true;
  }

  const userTokens = new Set(userRegions.map(normalizeRegionToken).filter(Boolean));
  if (userTokens.has("00")) {
    return true;
  }

  const noticeToken = normalizeRegionToken(noticeRegion);
  if (!noticeToken) {
    return false;
  }

  return userTokens.has(noticeToken);
}

export function matchesHousingPreference(notice: HousingPreferenceNotice, user: UserProfile): boolean {
  if (!matchesRegion(notice.region, user.regions)) {
    return false;
  }

  if (user.housingTypes.length > 0 && !user.housingTypes.includes(notice.housingType)) {
    return false;
  }

  const knownAreas = notice.supplyInfo.filter((supply) => supply.area > 0);
  if (knownAreas.length > 0) {
    const matchedArea = knownAreas.some(
      (supply) => supply.area >= user.minArea && supply.area <= user.maxArea,
    );

    if (!matchedArea) {
      return false;
    }
  }

  return true;
}

export function matchesNoticeEligibility(
  notice: ParsedNotice,
  user: UserProfile,
  context?: IncomeEligibilityContext,
): boolean {
  const { conditions } = notice;

  if (notice.pdfUrl && !hasExtractedEligibilityData(notice)) {
    return false;
  }

  if (conditions.incomeLimit) {
    const { limit, reason } = resolveIncomeLimit(notice, user, context);
    if (reason) {
      console.warn(`[filter] ${notice.panId} 소득 판정 기준표 확인 필요: ${reason}`);
    }
    if (limit !== null && user.income > limit) {
      return false;
    }
  }

  if (conditions.assetLimit) {
    const limit = parseAssetLimit(conditions.assetLimit);
    if (limit !== null && user.asset > limit) {
      return false;
    }
  }

  if (conditions.carAssetLimit) {
    const limit = parseAssetLimit(conditions.carAssetLimit);
    if (limit !== null && user.carAsset > limit) {
      return false;
    }
  }

  return true;
}

export function matchesDistrict(notice: ParsedNotice, user: UserProfile): boolean {
  if (user.districts.length === 0) return true;

  const allAddresses = notice.supplyInfo
    .map((s) => s.address ?? "")
    .filter(Boolean);

  if (allAddresses.length === 0) return true; // 주소 없으면 필터 안 함

  return user.districts.some((district) =>
    allAddresses.some((addr) => addr.includes(district))
  );
}

export function matchesPrice(notice: ParsedNotice, user: UserProfile): boolean {
  const { depositAmount, rentAmount } = notice.conditions;

  if (user.maxDeposit > 0 && Object.keys(depositAmount).length > 0) {
    const anyDepositInRange = Object.values(depositAmount).some(
      (amount) => amount === null || amount <= user.maxDeposit
    );
    if (!anyDepositInRange) return false;
  }

  if (user.maxRent > 0 && Object.keys(rentAmount).length > 0) {
    const anyRentInRange = Object.values(rentAmount).some(
      (amount) => amount === null || amount <= user.maxRent
    );
    if (!anyRentInRange) return false;
  }

  return true;
}

export function buildEligibilityChecks(
  notice: ParsedNotice,
  user: UserProfile,
  context?: IncomeEligibilityContext,
): EligibilityCheck[] {
  const checks: EligibilityCheck[] = [];

  // 소득 판정
  if (notice.conditions.incomeLimit) {
    const { limit, reason } = resolveIncomeLimit(notice, user, context);
    if (reason) {
      console.warn(`[filter] ${notice.panId} 소득 판정 기준표 확인 필요: ${reason}`);
    }
    const result: EligibilityResult = limit === null ? "unknown" : user.income <= limit ? "pass" : "fail";
    checks.push({
      label: "소득",
      result,
      rawCondition: notice.conditions.incomeLimit,
      userValue: `월 ${user.income}만원`,
    });
  }

  // 자산 판정
  if (notice.conditions.assetLimit) {
    const limit = parseAssetLimit(notice.conditions.assetLimit);
    const result: EligibilityResult = limit === null ? "unknown" : user.asset <= limit ? "pass" : "fail";
    checks.push({
      label: "자산",
      result,
      rawCondition: notice.conditions.assetLimit,
      userValue: `${user.asset}만원`,
    });
  }

  // 무주택 판정
  if (notice.conditions.noHomeCondition || notice.conditions.noHomeYearsRequired !== null) {
    const required = notice.conditions.noHomeYearsRequired;
    const result: EligibilityResult =
      required === null ? "unknown" : user.noHomeYears >= required ? "pass" : "fail";
    checks.push({
      label: "무주택",
      result,
      rawCondition: notice.conditions.noHomeCondition,
      userValue: `${user.noHomeYears}년`,
    });
  }

  // 청약통장 판정
  if (notice.conditions.subscriptionCondition || notice.conditions.subscriptionCountRequired !== null) {
    const required = notice.conditions.subscriptionCountRequired;
    const result: EligibilityResult =
      required === null ? "unknown" : user.subscriptionCount >= required ? "pass" : "fail";
    checks.push({
      label: "청약통장",
      result,
      rawCondition: notice.conditions.subscriptionCondition,
      userValue: `${user.subscriptionCount}회`,
    });
  }

  // 자동차 자산 판정
  if (notice.conditions.carAssetLimit) {
    const limit = parseAssetLimit(notice.conditions.carAssetLimit);
    const result: EligibilityResult = limit === null ? "unknown" : user.carAsset <= limit ? "pass" : "fail";
    checks.push({
      label: "자동차",
      result,
      rawCondition: notice.conditions.carAssetLimit,
      userValue: `${user.carAsset}만원`,
    });
  }

  return checks;
}

export function filterNotices(
  notices: ParsedNotice[],
  user: UserProfile,
  context?: IncomeEligibilityContext,
): ParsedNotice[] {
  return notices.filter(
    (notice) =>
      matchesHousingPreference(notice, user) &&
      matchesPrice(notice, user) &&
      matchesNoticeEligibility(notice, user, context),
    // matchesDistrict는 소프트 필터 — 하드 필터로 제외하지 않음.
    // TODO: 선호 구 포함 공고를 상단 정렬하는 기능 미구현.
    //       현재는 formatSlackMessage에서 "[선호지역]" 강조 표시만 적용됨.
    //       @see https://github.com/YOOGOMJA/find-my-housing-plan/issues/20
  );
}
