import { Notice, ParsedNotice, UserProfile } from "./types";

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

function parseIncomeLimit(text: string): number | null {
  const amountMatches = [...text.matchAll(/([\d,]+(?:\.\d+)?)\s*만\s*원/g)];
  if (amountMatches.length > 0) {
    const values = amountMatches
      .map((match) => Number.parseFloat(match[1].replace(/,/g, "")))
      .filter((value) => Number.isFinite(value));

    if (values.length > 0) {
      // 다수 값이 추출되면 가장 보수적인 상한으로 판단
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
      Object.keys(conditions.rent).length > 0,
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

export function matchesNoticeEligibility(notice: ParsedNotice, user: UserProfile): boolean {
  const { conditions } = notice;

  // PDF가 있는데 파싱 결과가 비어 있으면 오탐 방지를 위해 제외
  if (notice.pdfUrl && !hasExtractedEligibilityData(notice)) {
    return false;
  }

  if (conditions.incomeLimit) {
    const limit = parseIncomeLimit(conditions.incomeLimit);
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

export function filterNotices(notices: ParsedNotice[], user: UserProfile): ParsedNotice[] {
  return notices.filter(
    (notice) => matchesHousingPreference(notice, user) && matchesNoticeEligibility(notice, user),
  );
}
