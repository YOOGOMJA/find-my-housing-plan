import {
  markNotifiedNotices,
  markProcessedNotices,
  toProcessedKey,
  toProcessedKeySet,
} from "./state";
import { Notice, ParsedNotice } from "./types";

const baseNotice: Notice = {
  panId: "PAN-001",
  title: "테스트 공고",
  region: "11",
  housingType: "06",
  noticeDate: "20260307",
  noticeUrl: null,
  applicationStartDate: "2026.03.10 10:00",
  applicationEndDate: "2026.03.19 17:00",
  applicationStatus: "open",
  pdfUrl: null,
  supplyInfo: [],
};

const parsedNotice: ParsedNotice = {
  ...baseNotice,
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

describe("state helpers", () => {
  it("processed key를 생성한다", () => {
    expect(toProcessedKey("PAN-001", "open")).toBe("PAN-001:open");
  });

  it("공고 처리 상태를 기록한다", () => {
    const state = {};
    markProcessedNotices(state, [baseNotice], "2026-03-07T10:00:00.000Z");

    expect(state).toHaveProperty("PAN-001:open");
    expect((state as Record<string, { panId: string }>)["PAN-001:open"].panId).toBe("PAN-001");
  });

  it("알림 이력을 runId와 함께 기록한다", () => {
    const state = {};
    markNotifiedNotices(state, [parsedNotice], "run-001", "2026-03-07T10:00:00.000Z");

    expect(state).toHaveProperty("PAN-001:open:2026-03-07");
    expect((state as Record<string, { runId: string }>)["PAN-001:open:2026-03-07"].runId).toBe("run-001");
  });

  it("processed state에서 key set을 만든다", () => {
    const keys = toProcessedKeySet({
      "PAN-001:open": {
        panId: "PAN-001",
        phase: "open",
        lastProcessedAt: "2026-03-07T10:00:00.000Z",
      },
    });

    expect(keys.has("PAN-001:open")).toBe(true);
  });
});
