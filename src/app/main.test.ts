import { Notice } from "../entities/notice";
import { selectProcessedNotices } from "./main";

const baseNotice = (panId: string): Notice => ({
  panId,
  title: `테스트 ${panId}`,
  region: "11",
  housingType: "06",
  noticeDate: "20260307",
  applicationStatus: "open",
  pdfUrl: null,
  supplyInfo: [],
});

describe("selectProcessedNotices", () => {
  it("파싱 실패가 없으면 전체를 processed 대상으로 반환한다", () => {
    const notices = [baseNotice("A"), baseNotice("B")];
    const candidates = [baseNotice("A")];

    const result = selectProcessedNotices(notices, candidates, new Set());
    expect(result.map((notice) => notice.panId)).toEqual(["A", "B"]);
  });

  it("후보군에서 파싱 실패한 panId는 processed 대상에서 제외한다", () => {
    const notices = [baseNotice("A"), baseNotice("B"), baseNotice("C")];
    const candidates = [baseNotice("A"), baseNotice("B")];

    const result = selectProcessedNotices(notices, candidates, new Set(["B"]));
    expect(result.map((notice) => notice.panId)).toEqual(["A", "C"]);
  });

  it("후보군이 아닌 공고는 failedPanIds에 있어도 유지한다", () => {
    const notices = [baseNotice("A"), baseNotice("B")];
    const candidates = [baseNotice("A")];

    const result = selectProcessedNotices(notices, candidates, new Set(["B"]));
    expect(result.map((notice) => notice.panId)).toEqual(["A", "B"]);
  });
});
