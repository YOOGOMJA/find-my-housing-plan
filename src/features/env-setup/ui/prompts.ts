import prompts from "prompts";
import { AREA_PRESET_CHOICES, HOUSING_TYPE_CHOICES, REGION_CHOICES } from "../model/constants";
import { EnvUpdates, SetupSection } from "../model/types";
import {
  calculateManAge,
  isValidBirthMonthDay,
  parseNumberInput,
  throwOnCancel,
  toCsv,
} from "../lib/helpers";

export async function askSections(): Promise<SetupSection[]> {
  const response = await prompts(
    {
      type: "multiselect",
      name: "sections",
      message: "어떤 설정을 진행할까요? (여러 개 선택 가능)",
      hint: "- Space: 선택, Enter: 완료",
      instructions: false,
      choices: [
        { title: "기본 자격 설정 (거주/결혼/소득)", value: "profile", selected: true },
        { title: "필터 설정 (관심지역/면적/사업형태)", value: "filter", selected: true },
      ],
      min: 1,
    },
    { onCancel: throwOnCancel },
  );

  const sections = Array.isArray(response.sections) ? (response.sections as SetupSection[]) : [];
  if (sections.length === 0) {
    throwOnCancel();
  }

  return sections;
}

export async function promptProfile(env: Record<string, string>): Promise<EnvUpdates> {
  const currentYear = new Date().getFullYear();
  const ageFallback = Number.parseInt(env.USER_AGE ?? "35", 10);

  const answers = await prompts(
    [
      {
        type: "select",
        name: "ageInputMode",
        message: "만 나이 입력 방식",
        choices: [
          { title: "직접 입력", value: "manual" },
          { title: "출생연도 + 생일로 자동 계산", value: "auto" },
        ],
        initial: 0,
      },
      {
        type: (prev: string) => (prev === "manual" ? "number" : null),
        name: "age",
        message: "만 나이 (USER_AGE)",
        initial: ageFallback,
        min: 0,
      },
      {
        type: (prev: string) => (prev === "auto" ? "number" : null),
        name: "birthYear",
        message: "출생연도 (YYYY)",
        initial: currentYear - ageFallback,
        min: 1900,
        max: currentYear,
        validate: (value: number) =>
          Number.isInteger(value) && value >= 1900 && value <= currentYear
            ? true
            : `1900 ~ ${currentYear} 범위의 연도를 입력해주세요.`,
      },
      {
        type: (_: unknown, values: Record<string, unknown>) => (values.ageInputMode === "auto" ? "text" : null),
        name: "birthMonthDay",
        message: "생일 (MM-DD)",
        initial: "01-01",
        validate: (value: string) => (isValidBirthMonthDay(value) ? true : "MM-DD 형식으로 입력해주세요. 예: 07-15"),
      },
      {
        type: "select",
        name: "maritalStatus",
        message: "혼인 상태 (USER_MARITAL_STATUS)",
        choices: [
          { title: "미혼 (single)", value: "single" },
          { title: "기혼 (married)", value: "married" },
          { title: "신혼 (newlywed)", value: "newlywed" },
        ],
        initial: 0,
      },
      {
        type: "number",
        name: "householdSize",
        message: "세대원 수 (USER_HOUSEHOLD_SIZE)",
        initial: Number.parseInt(env.USER_HOUSEHOLD_SIZE ?? "1", 10),
        min: 1,
      },
      {
        type: "select",
        name: "currentRegion",
        message: "현재 거주지 코드 (USER_CURRENT_REGION)",
        choices: REGION_CHOICES,
        initial: Math.max(0, REGION_CHOICES.findIndex((choice) => choice.value === (env.USER_CURRENT_REGION ?? "11"))),
      },
      {
        type: "number",
        name: "noHomeYears",
        message: "무주택 기간(년) (USER_NO_HOME_YEARS)",
        initial: Number.parseFloat(env.USER_NO_HOME_YEARS ?? "0"),
        min: 0,
      },
      {
        type: "select",
        name: "incomeBand",
        message: "소득 규모 선택 (만원/월)",
        choices: [
          { title: "소득 낮음 (200 이하)", value: 200 },
          { title: "소득 중간 (350)", value: 350 },
          { title: "소득 높음 (600)", value: 600 },
          { title: "직접 입력", value: "custom" },
        ],
        initial: 1,
      },
      {
        type: (prev: number | string) => (prev === "custom" ? "number" : null),
        name: "incomeCustom",
        message: "월 소득 입력 (만원) (USER_INCOME)",
        initial: Number.parseFloat(env.USER_INCOME ?? "300"),
        min: 0,
      },
      {
        type: "number",
        name: "asset",
        message: "총 자산 입력 (만원) (USER_ASSET)",
        initial: Number.parseFloat(env.USER_ASSET ?? "30000"),
        min: 0,
      },
      {
        type: "number",
        name: "carAsset",
        message: "자동차 자산가액 입력 (만원) (USER_CAR_ASSET)",
        initial: Number.parseFloat(env.USER_CAR_ASSET ?? "0"),
        min: 0,
      },
    ],
    { onCancel: throwOnCancel },
  );

  const income =
    answers.incomeBand === "custom"
      ? parseNumberInput(answers.incomeCustom, Number.parseFloat(env.USER_INCOME ?? "300"))
      : parseNumberInput(answers.incomeBand, Number.parseFloat(env.USER_INCOME ?? "300"));
  const age =
    answers.ageInputMode === "auto"
      ? calculateManAge(
          parseNumberInput(answers.birthYear, currentYear - ageFallback),
          String(answers.birthMonthDay ?? "01-01"),
        )
      : parseNumberInput(answers.age, ageFallback);

  return {
    USER_AGE: String(age),
    USER_MARITAL_STATUS: String(answers.maritalStatus ?? env.USER_MARITAL_STATUS ?? "single"),
    USER_HOUSEHOLD_SIZE: String(
      parseNumberInput(answers.householdSize, Number.parseInt(env.USER_HOUSEHOLD_SIZE ?? "1", 10)),
    ),
    USER_CURRENT_REGION: String(answers.currentRegion ?? env.USER_CURRENT_REGION ?? "11"),
    USER_NO_HOME_YEARS: String(parseNumberInput(answers.noHomeYears, Number.parseFloat(env.USER_NO_HOME_YEARS ?? "0"))),
    USER_INCOME: String(income),
    USER_ASSET: String(parseNumberInput(answers.asset, Number.parseFloat(env.USER_ASSET ?? "30000"))),
    USER_CAR_ASSET: String(parseNumberInput(answers.carAsset, Number.parseFloat(env.USER_CAR_ASSET ?? "0"))),
  };
}

export async function promptFilter(env: Record<string, string>): Promise<EnvUpdates> {
  const regionResponse = await prompts(
    [
      {
        type: "multiselect",
        name: "regions",
        message: "관심 지역 선택 (USER_REGIONS)",
        hint: "- Space: 선택, Enter: 완료",
        instructions: false,
        choices: [
          { title: "서울", value: "11" },
          { title: "경기 북부 (코드 41로 저장)", value: "41" },
          { title: "경기 남부 (코드 41로 저장)", value: "41" },
          { title: "인천", value: "28" },
          { title: "전국", value: "00" },
        ],
      },
      {
        type: "confirm",
        name: "addMoreRegions",
        message: "기타 시/도 코드도 추가할까요?",
        initial: false,
      },
      {
        type: (prev: boolean) => (prev ? "multiselect" : null),
        name: "extraRegions",
        message: "추가 지역 선택",
        instructions: false,
        choices: REGION_CHOICES.filter((choice) => choice.value !== "11" && choice.value !== "41" && choice.value !== "28"),
      },
    ],
    { onCancel: throwOnCancel },
  );

  const selectedRegions = [
    ...(Array.isArray(regionResponse.regions) ? (regionResponse.regions as string[]) : []),
    ...(Array.isArray(regionResponse.extraRegions) ? (regionResponse.extraRegions as string[]) : []),
  ];

  const detail = await prompts(
    [
      {
        type: "select",
        name: "areaInputMode",
        message: "면적 입력 방식 (USER_MIN_AREA / USER_MAX_AREA)",
        choices: [
          { title: "국민평수(전용 m²) 옵션 선택", value: "preset" },
          { title: "직접 입력 (최소/최대)", value: "custom" },
        ],
        initial: 0,
      },
      {
        type: (prev: string) => (prev === "preset" ? "multiselect" : null),
        name: "areaPresets",
        message: "국민평수(전용 m²) 선택",
        hint: "- Space: 선택, Enter: 완료",
        instructions: false,
        min: 1,
        choices: AREA_PRESET_CHOICES.map((choice) => ({
          ...choice,
          selected:
            choice.value >= Number.parseFloat(env.USER_MIN_AREA ?? "20") &&
            choice.value <= Number.parseFloat(env.USER_MAX_AREA ?? "60"),
        })),
      },
      {
        type: (_: unknown, values: Record<string, unknown>) => (values.areaInputMode === "custom" ? "number" : null),
        name: "minArea",
        message: "최소 전용면적 (㎡) (USER_MIN_AREA)",
        initial: Number.parseFloat(env.USER_MIN_AREA ?? "20"),
        min: 0,
      },
      {
        type: (_: unknown, values: Record<string, unknown>) => (values.areaInputMode === "custom" ? "number" : null),
        name: "maxArea",
        message: "최대 전용면적 (㎡) (USER_MAX_AREA)",
        initial: Number.parseFloat(env.USER_MAX_AREA ?? "60"),
        min: 0,
      },
      {
        type: "multiselect",
        name: "housingTypes",
        message: "관심 사업/공고 유형 (USER_HOUSING_TYPES)",
        hint: "- Space: 선택, Enter: 완료",
        instructions: false,
        choices: HOUSING_TYPE_CHOICES,
      },
      {
        type: "number",
        name: "minBuildYear",
        message: "최소 준공연도 (없으면 0) (USER_MIN_BUILD_YEAR)",
        initial: Number.parseInt(env.USER_MIN_BUILD_YEAR ?? "0", 10),
        min: 0,
      },
      {
        type: "text",
        name: "districts",
        message: "선호 구 단위 지역 (쉼표 구분, 없으면 엔터) (USER_DISTRICTS)",
        initial: env.USER_DISTRICTS ?? "",
      },
      {
        type: "number",
        name: "maxDeposit",
        message: "보증금 최대 (만원, 0이면 필터 안 함) (USER_MAX_DEPOSIT)",
        initial: Number.parseFloat(env.USER_MAX_DEPOSIT ?? "0"),
        min: 0,
      },
      {
        type: "number",
        name: "maxRent",
        message: "월임대료 최대 (만원, 0이면 필터 안 함) (USER_MAX_RENT)",
        initial: Number.parseFloat(env.USER_MAX_RENT ?? "0"),
        min: 0,
      },
      {
        type: "select",
        name: "applicantGroup",
        message: "특별공급 신청 트랙 (USER_APPLICANT_GROUP)",
        choices: [
          { title: "일반 (general)", value: "general" },
          { title: "청년 (youth)", value: "youth" },
          { title: "신혼부부 (newlywed)", value: "newlywed" },
          { title: "신생아 (newborn)", value: "newborn" },
          { title: "다자녀 (multiChild)", value: "multiChild" },
        ],
        initial: 0,
      },
    ],
    { onCancel: throwOnCancel },
  );

  const selectedAreas =
    detail.areaInputMode === "preset" && Array.isArray(detail.areaPresets) && detail.areaPresets.length > 0
      ? (detail.areaPresets as number[])
      : null;
  const minArea =
    selectedAreas !== null
      ? Math.min(...selectedAreas)
      : parseNumberInput(detail.minArea, Number.parseFloat(env.USER_MIN_AREA ?? "20"));
  const maxArea =
    selectedAreas !== null
      ? Math.max(...selectedAreas)
      : parseNumberInput(detail.maxArea, Number.parseFloat(env.USER_MAX_AREA ?? "60"));

  return {
    USER_REGIONS: toCsv(selectedRegions.length > 0 ? selectedRegions : (env.USER_REGIONS ?? "11,41").split(",")),
    USER_MIN_AREA: String(minArea),
    USER_MAX_AREA: String(maxArea),
    USER_HOUSING_TYPES: toCsv(
      Array.isArray(detail.housingTypes) && detail.housingTypes.length > 0
        ? (detail.housingTypes as string[])
        : (env.USER_HOUSING_TYPES ?? "06,13").split(","),
    ),
    USER_MIN_BUILD_YEAR: String(parseNumberInput(detail.minBuildYear, Number.parseInt(env.USER_MIN_BUILD_YEAR ?? "0", 10))),
    USER_DISTRICTS: String(detail.districts ?? ""),
    USER_MAX_DEPOSIT: String(detail.maxDeposit ?? 0),
    USER_MAX_RENT: String(detail.maxRent ?? 0),
    USER_APPLICANT_GROUP: String(detail.applicantGroup ?? "general"),
  };
}
