import * as fs from "fs";
import * as path from "path";
import prompts from "prompts";

type Mode = "profile" | "filter" | "all";
type EnvUpdates = Record<string, string>;
type SetupSection = "profile" | "filter";

class PromptCancelledError extends Error {
  constructor() {
    super("사용자가 설정을 취소했습니다.");
    this.name = "PromptCancelledError";
  }
}

const ENV_PATH = path.resolve(process.cwd(), ".env");
const ENV_EXAMPLE_PATH = path.resolve(process.cwd(), ".env.example");

const REGION_CHOICES = [
  { title: "전국", value: "00" },
  { title: "서울", value: "11" },
  { title: "경기", value: "41" },
  { title: "인천", value: "28" },
  { title: "부산", value: "26" },
  { title: "대구", value: "27" },
  { title: "광주", value: "29" },
  { title: "대전", value: "30" },
  { title: "울산", value: "31" },
  { title: "세종", value: "36" },
  { title: "강원", value: "42" },
  { title: "충북", value: "43" },
  { title: "충남", value: "44" },
  { title: "전북", value: "45" },
  { title: "전남", value: "46" },
  { title: "경북", value: "47" },
  { title: "경남", value: "48" },
  { title: "제주", value: "50" },
];

const HOUSING_TYPE_CHOICES = [
  { title: "임대주택 (06)", value: "06" },
  { title: "매입/전세임대 (13)", value: "13" },
  { title: "공공분양 (05)", value: "05" },
  { title: "토지/분양 (01)", value: "01" },
  { title: "상가/업무시설 (22)", value: "22" },
];

const AREA_PRESET_CHOICES = [
  { title: "소형 39㎡ (약 16평형)", value: 39 },
  { title: "소형 49㎡ (약 20평형)", value: 49 },
  { title: "국민평형 59㎡ (약 24평형)", value: 59 },
  { title: "중형 74㎡ (약 30평형)", value: 74 },
  { title: "중형 84㎡ (약 34평형)", value: 84 },
];

function loadCurrentEnvMap(): Record<string, string> {
  const sourcePath = fs.existsSync(ENV_PATH) ? ENV_PATH : ENV_EXAMPLE_PATH;
  if (!fs.existsSync(sourcePath)) {
    return {};
  }

  const content = fs.readFileSync(sourcePath, "utf-8");
  const map: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    map[key] = value;
  }

  return map;
}

function readEnvTemplate(): string {
  if (fs.existsSync(ENV_PATH)) {
    return fs.readFileSync(ENV_PATH, "utf-8");
  }
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    return fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  }
  return "";
}

function renderEnvContent(baseContent: string, updates: EnvUpdates): string {
  const lines = baseContent.length > 0 ? baseContent.split(/\r?\n/) : [];
  const used = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      output.push(line);
      continue;
    }

    const key = match[1];
    if (!(key in updates)) {
      output.push(line);
      continue;
    }

    output.push(`${key}=${updates[key]}`);
    used.add(key);
  }

  const missing = Object.keys(updates).filter((key) => !used.has(key));
  if (missing.length > 0) {
    if (output.length > 0 && output[output.length - 1].trim() !== "") {
      output.push("");
    }
    output.push("# Added by env setup CLI");
    for (const key of missing) {
      output.push(`${key}=${updates[key]}`);
    }
  }

  return `${output.join("\n").replace(/\n+$/, "\n")}`;
}

function writeEnv(updates: EnvUpdates): void {
  const merged: EnvUpdates = { ...loadCurrentEnvMap(), ...updates };
  const baseContent = readEnvTemplate();
  const rendered = renderEnvContent(baseContent, merged);
  fs.writeFileSync(ENV_PATH, rendered, "utf-8");
}

function toCsv(items: string[]): string {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].join(",");
}

function parseNumberInput(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function parseModeFromArg(): Mode | null {
  const raw = (process.argv[2] ?? "").toLowerCase().trim();
  if (raw === "profile" || raw === "filter" || raw === "all") {
    return raw;
  }
  return null;
}

function throwOnCancel(): never {
  throw new PromptCancelledError();
}

function parseSectionsFromArg(): SetupSection[] | null {
  const mode = parseModeFromArg();
  if (!mode) {
    return null;
  }
  if (mode === "all") {
    return ["profile", "filter"];
  }
  return [mode];
}

async function askSections(): Promise<SetupSection[]> {
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
    throw new PromptCancelledError();
  }

  return sections;
}

function isValidBirthMonthDay(monthDay: string): boolean {
  const match = monthDay.match(/^(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  const probe = new Date(2000, month - 1, day);

  return probe.getFullYear() === 2000 && probe.getMonth() === month - 1 && probe.getDate() === day;
}

function calculateManAge(birthYear: number, birthMonthDay: string, today = new Date()): number {
  const [birthMonthText, birthDayText] = birthMonthDay.split("-");
  const birthMonth = Number.parseInt(birthMonthText, 10);
  const birthDay = Number.parseInt(birthDayText, 10);

  let age = today.getFullYear() - birthYear;
  if (today.getMonth() + 1 < birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() < birthDay)) {
    age -= 1;
  }

  return Math.max(age, 0);
}

async function promptProfile(env: Record<string, string>): Promise<EnvUpdates> {
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
        initial: Math.max(
          0,
          REGION_CHOICES.findIndex((choice) => choice.value === (env.USER_CURRENT_REGION ?? "11")),
        ),
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

async function promptFilter(env: Record<string, string>): Promise<EnvUpdates> {
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
  };
}

async function main(): Promise<void> {
  const chalk = (await import("chalk")).default;
  const env = loadCurrentEnvMap();

  const sections = parseSectionsFromArg() ?? (await askSections());
  const updates: EnvUpdates = {};

  if (sections.includes("profile")) {
    console.log(chalk.cyan("\n[1] 기본 자격 설정"));
    Object.assign(updates, await promptProfile(env));
  }

  if (sections.includes("filter")) {
    const sectionIndex = sections.includes("profile") ? 2 : 1;
    console.log(chalk.cyan(`\n[${sectionIndex}] 필터 설정`));
    Object.assign(updates, await promptFilter({ ...env, ...updates }));
  }

  writeEnv(updates);

  console.log(chalk.green("\n.env 저장 완료"));
  console.log(chalk.gray(`- 파일: ${ENV_PATH}`));
  console.log(chalk.gray(`- 반영 키 수: ${Object.keys(updates).length}`));
}

main().catch((error: unknown) => {
  if (error instanceof PromptCancelledError) {
    console.log("[env-setup] 설정이 취소되어 변경사항을 저장하지 않았습니다.");
    process.exit(0);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`[env-setup] 오류: ${message}`);
  process.exit(1);
});
