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
}

export interface ParsedNotice extends Notice {
  conditions: ParsedConditions;
}
