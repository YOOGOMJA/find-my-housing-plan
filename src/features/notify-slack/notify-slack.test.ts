import { formatSlackMessage, groupNoticesByStatus } from ".";
import { ParsedNotice } from "../../entities/notice";

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
  },
};

describe("formatSlackMessage", () => {
  it("공고명을 포함한 메시지 반환", () => {
    const message = formatSlackMessage(notice);
    expect(message.text).toContain("강릉미디어촌5");
  });

  it("면적 정보를 포함한다", () => {
    const message = formatSlackMessage(notice);
    const body = JSON.stringify(message);

    expect(body).toContain("26");
    expect(body).toContain("37");
  });

  it("임대보증금 정보를 포함한다", () => {
    const message = formatSlackMessage(notice);
    const body = JSON.stringify(message);

    expect(body).toContain("8,671,000");
  });

  it("접수상태 정보를 포함한다", () => {
    const message = formatSlackMessage(notice);

    expect(message.text).toContain("🏷️ 공고유형:");
    expect(message.text).toContain("접수상태: *🟢 접수중*");
    expect(message.text).toContain("접수기간: 2026.03.10 10:00 ~ 2026.03.19 17:00");
  });

  it("공고 ID를 링크로 표기하고 비고 섹션을 포함한다", () => {
    const message = formatSlackMessage(notice);

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
    });

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
    });

    expect(message.text).toContain("📦 *공급 정보*");
    expect(message.text).toContain("전용면적");
    expect(message.text).toContain("분양가격");
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
