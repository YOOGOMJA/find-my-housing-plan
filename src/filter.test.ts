import { filterNotices, matchesHousingPreference, matchesNoticeEligibility } from "./filter";
import { ParsedNotice, UserProfile } from "./types";

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
    target: null,
    notes: null,
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
        target: null,
        notes: null,
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
