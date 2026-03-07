import { filterNotices, matchesHousingPreference, matchesNoticeEligibility, matchesDistrict, matchesPrice, buildEligibilityChecks } from ".";
import { ParsedNotice } from "../../entities/notice";
import { UserProfile } from "../../entities/user";

const baseUser: UserProfile = {
  age: 30,
  maritalStatus: "single",
  householdSize: 1,
  currentRegion: "11",
  noHomeYears: 5,
  income: 300,
  asset: 30000,
  carAsset: 0,
  subscriptionDate: "2020-01-01",
  subscriptionCount: 48,
  subscriptionAmount: 960,
  regions: ["11", "41"],
  minArea: 20,
  maxArea: 60,
  minBuildYear: 0,
  housingTypes: ["06"],
  districts: [],
  maxDeposit: 0,
  maxRent: 0,
  applicantGroup: null,
};

const baseNotice: ParsedNotice = {
  panId: "TEST-001",
  title: "테스트 공고",
  region: "11",
  housingType: "06",
  noticeDate: "20260307",
  pdfUrl: null,
  supplyInfo: [{ type: "26", area: 26.92, count: 180 }],
  conditions: {
    incomeLimit: "도시근로자 월평균소득 100% 이하",
    assetLimit: null,
    carAssetLimit: null,
    noHomeCondition: "무주택세대구성원",
    subscriptionCondition: null,
    deposit: { "26": "8,671,000원" },
    rent: { "26": "145,630원" },
    contract: {},
    target: null,
    notes: null,
    depositAmount: { "26": 867 },
    rentAmount: { "26": 14 },
    contractAmount: {},
    noHomeYearsRequired: null,
    subscriptionCountRequired: null,
  },
};

describe("matchesHousingPreference", () => {
  it("지역 일치하면 true", () => {
    expect(matchesHousingPreference(baseNotice, baseUser)).toBe(true);
  });

  it("지역 불일치하면 false", () => {
    const notice = { ...baseNotice, region: "28" };
    expect(matchesHousingPreference(notice, baseUser)).toBe(false);
  });

  it("지역명이 코드와 매칭되면 true", () => {
    const notice = { ...baseNotice, region: "서울특별시" };
    expect(matchesHousingPreference(notice, baseUser)).toBe(true);
  });

  it("전국 공고는 사용자 지역에 전국이 없으면 false", () => {
    const notice = { ...baseNotice, region: "전국" };
    expect(matchesHousingPreference(notice, baseUser)).toBe(false);
  });

  it("전국 공고는 사용자 지역에 전국이 있으면 true", () => {
    const notice = { ...baseNotice, region: "전국" };
    expect(matchesHousingPreference(notice, { ...baseUser, regions: ["11", "00"] })).toBe(true);
  });

  it("사용자 지역에 전국(00)이 있으면 개별 지역 공고도 true", () => {
    const notice = { ...baseNotice, region: "41" };
    expect(matchesHousingPreference(notice, { ...baseUser, regions: ["00"] })).toBe(true);
  });

  it("면적 범위 내 공급 있으면 true", () => {
    const notice = { ...baseNotice, supplyInfo: [{ type: "26", area: 26.92, count: 10 }] };
    expect(matchesHousingPreference(notice, { ...baseUser, minArea: 20, maxArea: 30 })).toBe(true);
  });

  it("면적 범위 밖이면 false", () => {
    const notice = { ...baseNotice, supplyInfo: [{ type: "26", area: 26.92, count: 10 }] };
    expect(matchesHousingPreference(notice, { ...baseUser, minArea: 40, maxArea: 60 })).toBe(false);
  });

  it("임대유형 불일치하면 false", () => {
    const notice = { ...baseNotice, housingType: "05" };
    expect(matchesHousingPreference(notice, baseUser)).toBe(false);
  });

  it("면적 정보가 미상(0)만 있으면 면적 필터를 건너뛴다", () => {
    const notice = { ...baseNotice, supplyInfo: [{ type: "26", area: 0, count: 10 }] };
    expect(matchesHousingPreference(notice, { ...baseUser, minArea: 40, maxArea: 60 })).toBe(true);
  });
});

describe("matchesNoticeEligibility", () => {
  it("조건 추출 실패(null)면 통과 처리(true)", () => {
    const notice = {
      ...baseNotice,
      conditions: { ...baseNotice.conditions, incomeLimit: null },
    };

    expect(matchesNoticeEligibility(notice, baseUser)).toBe(true);
  });

  it("소득 기준(만원) 초과 시 false", () => {
    const notice = {
      ...baseNotice,
      conditions: { ...baseNotice.conditions, incomeLimit: "월평균소득 300만원 이하" },
    };

    expect(matchesNoticeEligibility(notice, { ...baseUser, income: 301 })).toBe(false);
  });

  it("PDF가 있는데 파싱 결과가 비어 있으면 false", () => {
    const notice = {
      ...baseNotice,
      pdfUrl: "https://example.com/sample.pdf",
      conditions: {
        incomeLimit: null,
        assetLimit: null,
        carAssetLimit: null,
        noHomeCondition: null,
        subscriptionCondition: null,
        deposit: {},
        rent: {},
        contract: {},
        target: null,
        notes: null,
        depositAmount: {},
        rentAmount: {},
        contractAmount: {},
        noHomeYearsRequired: null,
        subscriptionCountRequired: null,
      },
    };

    expect(matchesNoticeEligibility(notice, baseUser)).toBe(false);
  });

  it("자산 기준이 억/만원 혼합 표기면 합산해서 판단한다", () => {
    const notice = {
      ...baseNotice,
      conditions: { ...baseNotice.conditions, assetLimit: "총자산 3억 6,100만원 이하" },
    };

    expect(matchesNoticeEligibility(notice, { ...baseUser, asset: 35000 })).toBe(true);
    expect(matchesNoticeEligibility(notice, { ...baseUser, asset: 36200 })).toBe(false);
  });
});

describe("filterNotices", () => {
  it("조건 통과한 공고만 반환", () => {
    const failRegion = { ...baseNotice, panId: "FAIL-001", region: "99" };
    const result = filterNotices([baseNotice, failRegion], baseUser);

    expect(result).toHaveLength(1);
    expect(result[0].panId).toBe("TEST-001");
  });
});

describe("구 단위 소프트 필터 (matchesDistrict)", () => {
  it("districts가 비어있으면 항상 true", () => {
    const notice = { ...baseNotice, supplyInfo: [{ ...baseNotice.supplyInfo[0], address: "서울시 강남구 역삼동 1" }] };
    expect(matchesDistrict(notice, { ...baseUser, districts: [] })).toBe(true);
  });

  it("공급 단지 주소에 선호 구가 포함되면 true", () => {
    const notice = { ...baseNotice, supplyInfo: [{ ...baseNotice.supplyInfo[0], address: "서울시 송파구 잠실동 1" }] };
    expect(matchesDistrict(notice, { ...baseUser, districts: ["송파구"] })).toBe(true);
  });

  it("공급 단지 주소에 선호 구가 없으면 false", () => {
    const notice = { ...baseNotice, supplyInfo: [{ ...baseNotice.supplyInfo[0], address: "서울시 강남구 역삼동 1" }] };
    expect(matchesDistrict(notice, { ...baseUser, districts: ["송파구"] })).toBe(false);
  });

  it("주소 정보가 없으면 true (알 수 없음)", () => {
    const notice = { ...baseNotice, supplyInfo: [{ ...baseNotice.supplyInfo[0], address: null }] };
    expect(matchesDistrict(notice, { ...baseUser, districts: ["송파구"] })).toBe(true);
  });
});

describe("가격 하드 필터 (matchesPrice)", () => {
  it("maxDeposit가 0이면 보증금 필터 안 함", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, depositAmount: { "26": 20000 } } };
    expect(matchesPrice(notice, { ...baseUser, maxDeposit: 0 })).toBe(true);
  });

  it("보증금이 maxDeposit 이하면 true", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, depositAmount: { "26": 8000 } } };
    expect(matchesPrice(notice, { ...baseUser, maxDeposit: 10000 })).toBe(true);
  });

  it("보증금이 maxDeposit 초과면 false", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, depositAmount: { "26": 12000 } } };
    expect(matchesPrice(notice, { ...baseUser, maxDeposit: 10000 })).toBe(false);
  });

  it("여러 공급 유형 중 하나라도 범위 내면 true", () => {
    const notice = {
      ...baseNotice,
      conditions: { ...baseNotice.conditions, depositAmount: { "26": 12000, "36": 8000 } },
    };
    expect(matchesPrice(notice, { ...baseUser, maxDeposit: 10000 })).toBe(true);
  });
});

describe("자격 판정 (buildEligibilityChecks)", () => {
  it("소득 통과 케이스", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, incomeLimit: "월평균소득 70% 이하 (250만원)" } };
    const checks = buildEligibilityChecks(notice, { ...baseUser, income: 200 });
    const income = checks.find((c) => c.label === "소득");
    expect(income?.result).toBe("pass");
  });

  it("소득 초과 케이스", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, incomeLimit: "200만원 이하" } };
    const checks = buildEligibilityChecks(notice, { ...baseUser, income: 300 });
    const income = checks.find((c) => c.label === "소득");
    expect(income?.result).toBe("fail");
  });

  it("무주택 기간 미달 케이스", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, noHomeYearsRequired: 3 } };
    const checks = buildEligibilityChecks(notice, { ...baseUser, noHomeYears: 1 });
    const noHome = checks.find((c) => c.label === "무주택");
    expect(noHome?.result).toBe("fail");
  });

  it("무주택 기간 정보 없으면 unknown", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, noHomeYearsRequired: null } };
    const checks = buildEligibilityChecks(notice, baseUser);
    const noHome = checks.find((c) => c.label === "무주택");
    expect(noHome?.result).toBe("unknown");
  });

  it("청약통장 횟수 통과 케이스", () => {
    const notice = { ...baseNotice, conditions: { ...baseNotice.conditions, subscriptionCountRequired: 12 } };
    const checks = buildEligibilityChecks(notice, { ...baseUser, subscriptionCount: 24 });
    const sub = checks.find((c) => c.label === "청약통장");
    expect(sub?.result).toBe("pass");
  });

  it("자동차 자산 통과 케이스", () => {
    const notice = {
      ...baseNotice,
      conditions: { ...baseNotice.conditions, carAssetLimit: "자동차 3,683만원 이하" },
    };
    const checks = buildEligibilityChecks(notice, { ...baseUser, carAsset: 3000 });
    const car = checks.find((c) => c.label === "자동차");
    expect(car?.result).toBe("pass");
  });

  it("자동차 자산 초과 케이스", () => {
    const notice = {
      ...baseNotice,
      conditions: { ...baseNotice.conditions, carAssetLimit: "자동차 3,683만원 이하" },
    };
    const checks = buildEligibilityChecks(notice, { ...baseUser, carAsset: 4000 });
    const car = checks.find((c) => c.label === "자동차");
    expect(car?.result).toBe("fail");
  });

  it("자동차 기준 파싱 불가 시 unknown", () => {
    const notice = {
      ...baseNotice,
      conditions: { ...baseNotice.conditions, carAssetLimit: "자동차 기준 별도 문의" },
    };
    const checks = buildEligibilityChecks(notice, baseUser);
    const car = checks.find((c) => c.label === "자동차");
    expect(car?.result).toBe("unknown");
  });
});
