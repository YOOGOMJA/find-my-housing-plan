export type NoticeApplicationStatus = "upcoming" | "open" | "closed" | "unknown";

export interface Notice {
  panId: string;
  title: string;
  region: string;
  housingType: string;
  upperTypeName?: string | null;
  detailTypeName?: string | null;
  noticeDate: string;
  noticeUrl?: string | null;
  applicationStartDate?: string | null;
  applicationEndDate?: string | null;
  applicationStatus?: NoticeApplicationStatus;
  pdfUrl: string | null;
  supplyInfo: SupplyItem[];
}

export interface SupplyItem {
  type: string;
  area: number;
  count: number;
  address?: string | null;   // 단지 주소 (API/PDF에서 제공 시)
  areaSource?: "DDO_AR" | "HTY_DS_NM" | "UNKNOWN";
  countSource?: "NOW_HSH_CNT" | "GNR_SPL_RMNO" | "UNKNOWN";
  rawTypeText?: string;
}

export interface ParsedConditions {
  incomeLimit: string | null;
  assetLimit: string | null;
  carAssetLimit: string | null;
  noHomeCondition: string | null;
  subscriptionCondition: string | null;
  deposit: Record<string, string>;
  rent: Record<string, string>;
  target: string | null;
  notes: string | null;
  // 신규: 수치 파싱 결과 (필터·판정용)
  depositAmount: Record<string, number | null>;
  rentAmount: Record<string, number | null>;
  noHomeYearsRequired: number | null;
  subscriptionCountRequired: number | null;
}

export interface ParsedNotice extends Notice {
  conditions: ParsedConditions;
}

// 신규: 자격 판정 결과 타입
export type EligibilityResult = "pass" | "fail" | "unknown";

export interface EligibilityCheck {
  label: string;
  result: EligibilityResult;
  rawCondition: string | null;
  userValue: string | null;
}
