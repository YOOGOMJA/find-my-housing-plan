import { Notice } from "../../entities/notice";
import { buildClaudePrompt, extractJsonFromText, parseNotices } from ".";

describe("extractJsonFromText", () => {
  it("마크다운 코드블록 없는 JSON 파싱", () => {
    const text = '{"신청대상": "청년", "소득기준": null}';
    const result = extractJsonFromText(text);

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).신청대상).toBe("청년");
  });

  it("코드블록으로 감싼 JSON 파싱", () => {
    const text = "```json\n{\"소득기준\": \"70% 이하\"}\n```";
    const result = extractJsonFromText(text);

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).소득기준).toBe("70% 이하");
  });

  it("파싱 불가 시 null 반환", () => {
    expect(extractJsonFromText("이것은 JSON이 아닙니다")).toBeNull();
  });
});

describe("buildClaudePrompt", () => {
  it("공고명과 텍스트를 포함한 프롬프트 반환", () => {
    const prompt = buildClaudePrompt("테스트 공고", "공고 본문 내용");

    expect(prompt).toContain("테스트 공고");
    expect(prompt).toContain("공고 본문 내용");
    expect(prompt).toContain("소득기준");
  });
});

describe("parseNotices", () => {
  const baseNotice = (panId: string, pdfUrl: string | null): Notice => ({
    panId,
    title: `테스트 ${panId}`,
    region: "11",
    housingType: "06",
    noticeDate: "20260307",
    applicationStatus: "open",
    pdfUrl,
    supplyInfo: [],
  });

  it("PDF가 없는 공고는 실패 목록 없이 파싱 결과를 반환한다", async () => {
    const result = await parseNotices([baseNotice("A", null)], "dummy-key");

    expect(result.parsed).toHaveLength(1);
    expect(result.failedPanIds).toEqual([]);
  });

  it("파싱 실패 시 failedPanIds에 panId를 기록한다", async () => {
    const result = await parseNotices([baseNotice("B", "://invalid-url")], "dummy-key");

    expect(result.parsed).toHaveLength(1);
    expect(result.failedPanIds).toEqual(["B"]);
  });
});
