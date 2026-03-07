export interface UserProfile {
  age: number;
  maritalStatus: "single" | "married" | "newlywed";
  householdSize: number;
  currentRegion: string;
  noHomeYears: number;
  income: number;
  asset: number;
  carAsset: number;
  subscriptionDate: string;
  subscriptionCount: number;
  subscriptionAmount: number;
  regions: string[];
  minArea: number;
  maxArea: number;
  minBuildYear: number;
  housingTypes: string[];
  // 신규
  districts: string[];           // 선호 구 단위 (소프트 필터, 예: ["송파구", "관악구"])
  maxDeposit: number;            // 보증금 최대 (만원, 0이면 필터 안 함)
  maxRent: number;               // 월임대료 최대 (만원, 0이면 필터 안 함)
  applicantGroup:
    | "general"
    | "youth"
    | "newlywed"
    | "newborn"
    | "multiChild"
    | null;
}
