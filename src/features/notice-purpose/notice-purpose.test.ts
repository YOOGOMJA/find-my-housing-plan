import { Notice } from "../../entities/notice";
import { classifyNoticePurpose } from ".";

const baseNotice = (override: Partial<Notice>): Notice => ({
  panId: "N-001",
  title: "테스트 공고",
  region: "11",
  housingType: "06",
  noticeDate: "20260307",
  applicationStatus: "upcoming",
  pdfUrl: null,
  supplyInfo: [],
  ...override,
});

describe("classifyNoticePurpose", () => {
  it("가정어린이집은 non_residential로 분류한다", async () => {
    const decision = await classifyNoticePurpose(
      baseNotice({
        detailTypeName: "가정어린이집",
        upperTypeName: "임대주택",
        title: "성남판교 가정어린이집 운영예정자 모집 공고",
      }),
    );

    expect(decision.purpose).toBe("non_residential");
  });

  it("상가 유형은 non_residential로 분류한다", async () => {
    const decision = await classifyNoticePurpose(
      baseNotice({
        housingType: "22",
        upperTypeName: "상가",
        detailTypeName: "임대상가(추첨)",
        title: "영구임대상가 입점자 모집공고",
      }),
    );

    expect(decision.purpose).toBe("non_residential");
  });

  it("국민임대 예비입주자 모집은 residential로 분류한다", async () => {
    const decision = await classifyNoticePurpose(
      baseNotice({
        detailTypeName: "국민임대",
        upperTypeName: "임대주택",
        title: "강릉 국민임대 예비입주자 모집공고",
      }),
    );

    expect(decision.purpose).toBe("residential");
  });

  it("임대주택이지만 분류 근거가 약하면 unknown으로 남긴다", async () => {
    const decision = await classifyNoticePurpose(
      baseNotice({
        detailTypeName: "",
        upperTypeName: "임대주택",
        title: "공고 안내",
      }),
    );

    expect(decision.purpose).toBe("unknown");
  });
});
