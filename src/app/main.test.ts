import { Notice } from "../entities/notice";
import { buildCollectOptions, isReprocessDryRunMode, selectProcessedNotices } from "./main";

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

describe("isReprocessDryRunMode", () => {
  it("재처리 모드 + dry-run일 때만 true", () => {
    expect(isReprocessDryRunMode(true, true)).toBe(true);
    expect(isReprocessDryRunMode(false, true)).toBe(false);
    expect(isReprocessDryRunMode(true, false)).toBe(false);
  });
});

describe("buildCollectOptions", () => {
  const performance = {
    collectConcurrency: 4,
    httpKeepAlive: true,
  };

  it("일반 모드에서는 lookbackMonths를 전달하지 않는다", () => {
    const options = buildCollectOptions(false, performance, 3);
    expect(options).toEqual({
      concurrency: 4,
      keepAlive: true,
    });
    expect("lookbackMonths" in options).toBe(false);
  });

  it("재처리 모드에서는 lookbackMonths를 전달한다", () => {
    const options = buildCollectOptions(true, performance, 3);
    expect(options).toEqual({
      concurrency: 4,
      keepAlive: true,
      lookbackMonths: 3,
    });
  });
});
