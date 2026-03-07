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
}
