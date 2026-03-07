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
  /**
   * 특별공급 신청 트랙.
   * 현재는 env-setup에서 수집하고 app-config에서 읽지만 필터/판정 로직에서 미사용.
   * TODO: 추후 특별공급 유형별 자격 필터에 활용 예정
   * @see https://github.com/YOOGOMJA/find-my-housing-plan/issues/20
   */
  applicantGroup:
    | "general"
    | "youth"
    | "newlywed"
    | "newborn"
    | "multiChild"
    | null;
}
