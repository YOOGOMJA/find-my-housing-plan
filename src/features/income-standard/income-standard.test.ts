import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  detectIncomePercent,
  loadIncomeStandardCatalog,
  resolveHouseholdIncome,
  resolveIncomeStandardSelection,
  toIncomeStandard,
  validateIncomeStandard,
} from ".";

const sample = {
  year: 2025,
  publishedAt: "2025-02-01",
  sourceUrl: "https://example.com/source",
  unit: "만원/월",
  householdIncome: {
    "1": 321,
    "2": 489,
    "3": 671,
    "4": 763,
    "5": 804,
    "6": 873,
  },
};

describe("income-standard", () => {
  it("기준표 스키마를 검증한다", () => {
    expect(validateIncomeStandard(sample)).toEqual([]);
  });

  it("잘못된 스키마는 오류를 반환한다", () => {
    const invalid = { ...sample, unit: "원" };
    expect(validateIncomeStandard(invalid).length).toBeGreaterThan(0);
  });

  it("퍼센트 문구를 감지한다", () => {
    expect(detectIncomePercent("도시근로자 월평균소득 100% 이하")).toBe(100);
    expect(detectIncomePercent("월평균소득 70퍼센트 이하")).toBe(70);
    expect(detectIncomePercent("연소득 5천만원 이하")).toBeNull();
  });

  it("기준표 선택 우선순위는 강제연도 > 공고일전년도 > latest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "income-standard-"));
    const latestPath = path.join(root, "latest.json");
    const historyDir = path.join(root, "history");
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(latestPath, JSON.stringify(sample), "utf-8");
    fs.writeFileSync(
      path.join(historyDir, "2024.json"),
      JSON.stringify({ ...sample, year: 2024, householdIncome: { ...sample.householdIncome, "1": 300 } }),
      "utf-8",
    );

    const catalog = loadIncomeStandardCatalog(latestPath);
    const forced = resolveIncomeStandardSelection(catalog, "20260307", 2024);
    expect(forced.standard?.year).toBe(2024);

    const noticeYear = resolveIncomeStandardSelection(catalog, "20260307", null);
    expect(noticeYear.standard?.year).toBe(2025);

    expect(resolveHouseholdIncome(toIncomeStandard(sample)!, 7)).toBeNull();
  });
});
