import {
  classifyApplicationStatus,
  extractItems,
  inferListStatusPhase,
  isNoticeOpen,
  parsePanId,
  shouldCollectBySeen,
  toSeenKey,
} from "./collector";

describe("extractItems", () => {
  it("배열 구조 응답에서 아이템 배열을 추출한다", () => {
    const body = [
      { dsSch: [{ PAN_ID: "ignore" }] },
      { dsList01: [{ PAN_ID: "A001" }, { PAN_ID: "A002" }], resHeader: [] },
    ];

    expect(extractItems(body)).toHaveLength(2);
    expect(extractItems(body)[0].PAN_ID).toBe("A001");
  });

  it("빈 배열이면 빈 배열 반환", () => {
    expect(extractItems([])).toEqual([]);
  });

  it("null이면 빈 배열 반환", () => {
    expect(extractItems(null)).toEqual([]);
  });
});

describe("parsePanId", () => {
  it("공고 목록 아이템에서 PAN_ID를 반환한다", () => {
    expect(parsePanId({ PAN_ID: "2026-000050" })).toBe("2026-000050");
  });

  it("PAN_ID 없으면 빈 문자열 반환", () => {
    expect(parsePanId({})).toBe("");
  });
});

describe("isNoticeOpen", () => {
  it("상태가 공고중이고 마감일이 오늘 이후면 true", () => {
    expect(isNoticeOpen({ PAN_SS: "공고중", CLSG_DT: "2026.03.19" }, 20260310)).toBe(true);
  });

  it("상태가 마감이면 false", () => {
    expect(isNoticeOpen({ PAN_SS: "공고마감", CLSG_DT: "2026.03.19" }, 20260310)).toBe(false);
  });

  it("마감일이 오늘보다 과거면 false", () => {
    expect(isNoticeOpen({ PAN_SS: "공고중", CLSG_DT: "2026.03.01" }, 20260310)).toBe(false);
  });

  it("마감일 정보가 없으면 true", () => {
    expect(isNoticeOpen({ PAN_SS: "공고중" }, 20260310)).toBe(true);
  });
});

describe("inferListStatusPhase", () => {
  it("접수중이면 open", () => {
    expect(inferListStatusPhase("접수중")).toBe("open");
  });

  it("공고중이면 upcoming", () => {
    expect(inferListStatusPhase("공고중")).toBe("upcoming");
  });

  it("접수마감이면 closed", () => {
    expect(inferListStatusPhase("접수마감")).toBe("closed");
  });
});

describe("classifyApplicationStatus", () => {
  it("종료일이 날짜만 있으면 당일은 open으로 유지한다", () => {
    const now = new Date(2026, 2, 19, 10, 0, 0, 0).getTime();
    expect(classifyApplicationStatus("open", "2026.03.10", "2026.03.19", now)).toBe("open");
  });

  it("종료일이 날짜만 있으면 다음날부터 closed가 된다", () => {
    const now = new Date(2026, 2, 20, 0, 0, 0, 0).getTime();
    expect(classifyApplicationStatus("open", "2026.03.10", "2026.03.19", now)).toBe("closed");
  });
});

describe("shouldCollectBySeen", () => {
  it("동일 phase key가 있으면 수집하지 않는다", () => {
    const seen = new Set([toSeenKey("A001", "open")]);
    expect(shouldCollectBySeen(seen, "A001", "open")).toBe(false);
  });

  it("open은 legacy panId만 있어도 한번 더 수집한다", () => {
    const seen = new Set(["A001"]);
    expect(shouldCollectBySeen(seen, "A001", "open")).toBe(true);
  });

  it("upcoming은 legacy panId가 있으면 수집하지 않는다", () => {
    const seen = new Set(["A001"]);
    expect(shouldCollectBySeen(seen, "A001", "upcoming")).toBe(false);
  });

  it("upcoming으로 본 공고가 open으로 전이되면 다시 수집한다", () => {
    const seen = new Set([toSeenKey("A001", "upcoming")]);
    expect(shouldCollectBySeen(seen, "A001", "open")).toBe(true);
  });
});
