import * as fs from "fs";
import {
  appendSlackHistoryRecord,
  createSlackHistoryRecord,
  formatManualReviewMessage,
  formatSlackMessage,
  getSlackHistoryPath,
  groupNoticesByStatus,
} from ".";
import { ParsedNotice } from "../../entities/notice";
import { buildEligibilityChecks } from "../filter-notices";
import { UserProfile } from "../../entities/user";

const notice: ParsedNotice = {
  panId: "2026-000050",
  title: "강릉미디어촌5 국민임대주택 예비입주자 모집",
  region: "42",
  housingType: "06",
  noticeDate: "20260307",
  noticeUrl: "https://apply.lh.or.kr/sample-detail",
  applicationStartDate: "2026.03.10 10:00",
  applicationEndDate: "2026.03.19 17:00",
  applicationStatus: "open",
  pdfUrl: null,
  supplyInfo: [
    { type: "26", area: 26.92, count: 180 },
    { type: "37", area: 37.01, count: 200 },
  ],
  conditions: {
    incomeLimit: "도시근로자 월평균소득 100% 이하",
    assetLimit: null,
    carAssetLimit: null,
    noHomeCondition: "무주택세대구성원",
    subscriptionCondition: null,
    deposit: { "26": "8,671,000원", "37": "16,231,000원" },
    rent: { "26": "145,630원", "37": "204,560원" },
    target: null,
    notes: "최장 30년 거주 가능",
    depositAmount: { "26": 867.1, "37": 1623.1 },
    rentAmount: { "26": 14.563, "37": 20.456 },
    noHomeYearsRequired: null,
    subscriptionCountRequired: null,
  },
};

const baseUser: UserProfile = {
  age: 30,
  maritalStatus: "single",
  householdSize: 1,
  currentRegion: "42",
  noHomeYears: 5,
  income: 300,
  asset: 30000,
  carAsset: 0,
  subscriptionDate: "2020-01-01",
  subscriptionCount: 24,
  subscriptionAmount: 480,
  regions: ["42"],
  minArea: 20,
  maxArea: 60,
  minBuildYear: 0,
  housingTypes: ["06"],
  districts: ["송파구"],
  maxDeposit: 0,
  maxRent: 0,
  applicantGroup: "youth",
};

describe("formatSlackMessage", () => {
  it("공고명을 포함한 메시지 반환", () => {
    const message = formatSlackMessage(notice, [], []);
    expect(message.text).toContain("강릉미디어촌5");
  });

  it("면적 정보를 포함한다", () => {
    const message = formatSlackMessage(notice, [], []);
    const body = JSON.stringify(message);

    expect(body).toContain("26");
    expect(body).toContain("37");
  });

  it("임대보증금 정보를 포함한다", () => {
    const message = formatSlackMessage(notice, [], []);
    const body = JSON.stringify(message);

    expect(body).toContain("8,671,000");
  });

  it("접수상태 정보를 포함한다", () => {
    const message = formatSlackMessage(notice, [], []);

    expect(message.text).toContain("🏷️ 공고유형:");
    expect(message.text).toContain("접수상태: *🟢 접수중*");
    expect(message.text).toContain("접수기간: 2026.03.10 10:00 ~ 2026.03.19 17:00");
  });

  it("공고 ID를 링크로 표기하고 비고 섹션을 포함한다", () => {
    const message = formatSlackMessage(notice, [], []);

    expect(message.text).toContain("🆔 공고 ID: <https://apply.lh.or.kr/sample-detail|2026-000050>");
    expect(message.text).toContain("<https://apply.lh.or.kr/sample-detail|공고 상세 페이지>");
    expect(message.text).toContain("📝 *비고*");
    expect(message.text).toContain("• 최장 30년 거주 가능");
  });

  it("공고일/접수기간 미제공 시 안내 문구를 보여준다", () => {
    const message = formatSlackMessage({
      ...notice,
      noticeDate: "",
      applicationStartDate: null,
      applicationEndDate: null,
      applicationStatus: "upcoming",
    }, [], []);

    expect(message.text).toContain("공고일: 정보없음");
    expect(message.text).toContain("접수기간: 일정 미공개 (공개전/원문 확인 필요)");
  });

  it("공급정보가 비어도 비고에서 공급 관련 요약을 공급 정보 섹션에 보여준다", () => {
    const message = formatSlackMessage({
      ...notice,
      supplyInfo: [],
      conditions: {
        ...notice.conditions,
        notes:
          "전용면적 26.45㎡, 분양가격 213,000,000원, 계약금 42,600,000원. 문의 031-250-8171",
      },
    }, [], []);

    expect(message.text).toContain("📦 *공급 정보*");
    expect(message.text).toContain("전용면적");
    expect(message.text).toContain("분양가격");
  });
});

describe("formatSlackMessage — 판정 결과 포함", () => {
  it("자격 판정 결과를 포함한다", () => {
    const checks = buildEligibilityChecks(notice, baseUser);
    const msg = formatSlackMessage(notice, checks, baseUser.districts);
    expect(msg.text).toContain("자격 판정");
  });

  it("통과 항목에 통과 표시가 포함된다", () => {
    const checks = [{ label: "소득", result: "pass" as const, rawCondition: "200만원 이하", userValue: "150만원" }];
    const msg = formatSlackMessage(notice, checks, []);
    expect(msg.text).toContain("통과");
  });

  it("fail 항목에 미충족 표시가 포함된다", () => {
    const checks = [{ label: "소득", result: "fail" as const, rawCondition: "200만원 이하", userValue: "300만원" }];
    const msg = formatSlackMessage(notice, checks, []);
    expect(msg.text).toContain("미충족");
  });

  it("unknown 항목에 확인필요 표시가 포함된다", () => {
    const checks = [{ label: "청약통장", result: "unknown" as const, rawCondition: null, userValue: "24회" }];
    const msg = formatSlackMessage(notice, checks, []);
    expect(msg.text).toContain("확인필요");
  });
});

describe("formatSlackMessage — 단지 정보", () => {
  it("주소가 있는 공급 단지에 지도 링크를 포함한다", () => {
    const noticeWithAddr = {
      ...notice,
      supplyInfo: [{ type: "26", area: 26.92, count: 10, address: "서울시 송파구 잠실동 1" }],
    };
    const msg = formatSlackMessage(noticeWithAddr, [], []);
    expect(msg.text).toContain("map.naver.com");
    expect(msg.text).toContain("maps/search");
  });

  it("선호 구가 포함된 단지를 강조한다", () => {
    const noticeWithAddr = {
      ...notice,
      supplyInfo: [
        { type: "26", area: 26.92, count: 10, address: "서울시 송파구 잠실동 1" },
        { type: "36", area: 36, count: 5, address: "서울시 강남구 역삼동 1" },
      ],
    };
    const msg = formatSlackMessage(noticeWithAddr, [], ["송파구"]);
    expect(msg.text).toContain("선호");
  });
});

describe("groupNoticesByStatus", () => {
  it("접수중/접수예정/미확인으로 분리한다", () => {
    const open = { ...notice, panId: "OPEN-1", applicationStatus: "open" as const };
    const upcoming = { ...notice, panId: "UPCOMING-1", applicationStatus: "upcoming" as const };
    const unknown = { ...notice, panId: "UNKNOWN-1", applicationStatus: undefined };
    const closed = { ...notice, panId: "CLOSED-1", applicationStatus: "closed" as const };

    const grouped = groupNoticesByStatus([open, upcoming, unknown, closed]);

    expect(grouped.open.map((item: ParsedNotice) => item.panId)).toEqual(["OPEN-1"]);
    expect(grouped.upcoming.map((item: ParsedNotice) => item.panId)).toEqual(["UPCOMING-1"]);
    expect(grouped.unknown.map((item: ParsedNotice) => item.panId)).toEqual(["UNKNOWN-1"]);
  });
});

describe("formatManualReviewMessage", () => {
  it("PDF 미제공 사유를 표시한다", () => {
    const message = formatManualReviewMessage({
      notice,
      reason: "no_pdf",
    });

    expect(message.text).toContain("수동 확인 필요 공고");
    expect(message.text).toContain("사유: PDF 미제공");
  });

  it("PDF 파싱 실패 사유를 표시한다", () => {
    const message = formatManualReviewMessage({
      notice,
      reason: "parse_failed",
    });

    expect(message.text).toContain("사유: PDF 파싱 실패");
  });
});

describe("Slack 히스토리 로깅", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("히스토리 파일 경로를 날짜 기준으로 계산한다", () => {
    const pathValue = getSlackHistoryPath("2026-03-09T12:34:56.000Z");
    expect(pathValue).toMatch(/data\/slack-history\/2026-03-09\.jsonl$/);
  });

  it("히스토리 레코드 필드를 생성한다", () => {
    const record = createSlackHistoryRecord({
      runId: "run-1",
      panId: "PAN-1",
      messageType: "notice",
      applicationStatus: "open",
      payloadText: "payload",
      status: "success",
      httpStatus: 200,
      errorMessage: null,
      nowIso: "2026-03-09T01:02:03.000Z",
    });

    expect(record.timestamp).toBe("2026-03-09T01:02:03.000Z");
    expect(record.messageType).toBe("notice");
    expect(record.status).toBe("success");
    expect(record.httpStatus).toBe(200);
  });

  it("히스토리 레코드를 JSONL 한 줄로 append한다", () => {
    const record = createSlackHistoryRecord({
      runId: "run-success",
      panId: "PAN-1",
      messageType: "notice",
      applicationStatus: "open",
      payloadText: "payload",
      status: "success",
      httpStatus: 200,
      errorMessage: null,
      nowIso: "2099-01-02T01:02:03.000Z",
    });

    appendSlackHistoryRecord(record);
    const filePath = getSlackHistoryPath(record.timestamp);
    const lines = fs
      .readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const first = JSON.parse(lines[lines.length - 1] ?? "{}");
    expect(first.messageType).toBe("notice");
    expect(first.status).toBe("success");
    expect(first.panId).toBe("PAN-1");
  });

  it("실패 케이스도 failed 상태로 append된다", () => {
    const record = createSlackHistoryRecord({
      runId: "run-fail",
      panId: null,
      messageType: "batch_header",
      applicationStatus: null,
      payloadText: "header",
      status: "failed",
      httpStatus: 500,
      errorMessage: "Slack 응답: 500",
      nowIso: "2099-01-03T01:02:03.000Z",
    });

    appendSlackHistoryRecord(record);
    const filePath = getSlackHistoryPath(record.timestamp);
    const lines = fs
      .readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const written = JSON.parse(lines[lines.length - 1] ?? "{}");
    expect(written.status).toBe("failed");
    expect(written.httpStatus).toBe(500);
    expect(written.messageType).toBe("batch_header");
  });
});
