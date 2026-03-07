import * as http from "http";
import * as https from "https";
import { Notice } from "../../../entities/notice";

interface PdfPage {
  getTextContent(): Promise<{ items: Array<{ str?: unknown }> }>;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
}

interface PdfjsModule {
  getDocument(params: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
  }): PdfLoadingTask;
}

let pdfjsLib: PdfjsModule | null = null;

function isPdfjsModule(value: unknown): value is PdfjsModule {
  return typeof value === "object" && value !== null && "getDocument" in value && typeof value.getDocument === "function";
}

const NON_RESIDENTIAL_UPPER_TYPE_KEYWORDS = ["상가", "토지"];

const NON_RESIDENTIAL_DETAIL_TYPE_KEYWORDS = [
  "가정어린이집",
  "임대상가",
  "분양ㆍ(구)임대상가",
  "토지",
];

const NON_RESIDENTIAL_TITLE_KEYWORDS = [
  "어린이집",
  "임차운영자",
  "운영예정자",
  "운영자 모집",
  "임차인 선정",
  "입점자",
  "희망상가",
  "상가",
  "산학연혁신허브",
  "용지",
  "수의계약",
  "업무시설",
  "근린생활시설",
  "종교시설",
  "산업시설",
  "주차장용지",
  "일반상업용지",
];

const RESIDENTIAL_TYPE_KEYWORDS = [
  "국민임대",
  "영구임대",
  "행복주택",
  "장기전세",
  "매입임대",
  "전세임대",
  "통합공공임대",
  "공공임대",
  "신혼희망타운",
  "예비입주자 모집",
  "입주자 모집",
];

function includesAny(source: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    if (source.includes(keyword)) {
      return keyword;
    }
  }

  return null;
}

function toText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsLib) {
    const loaded = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!isPdfjsModule(loaded)) {
      throw new Error("pdfjs-dist 로드 실패");
    }
    pdfjsLib = loaded;
  }

  return pdfjsLib;
}

function downloadBuffer(url: string, maxRedirects = 5): Promise<Buffer> {
  const request = (targetUrl: string, redirectsLeft: number): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
      const client = targetUrl.startsWith("https") ? https : http;

      client
        .get(targetUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location;

          if ([301, 302, 303, 307, 308].includes(status) && location && redirectsLeft > 0) {
            res.resume();
            const redirected = new URL(location, targetUrl).toString();
            request(redirected, redirectsLeft - 1).then(resolve).catch(reject);
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer | string) => {
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          });
          res.on("end", () => {
            resolve(Buffer.concat(chunks));
          });
          res.on("error", reject);
        })
        .on("error", reject);
    });
  };

  return request(url, maxRedirects);
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const lib = await getPdfjs();
  const loadingTask = lib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  let text = "";

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => (typeof item.str === "string" ? item.str : "")).join(" ");
    text += `${pageText}\n`;

    if (text.length > 12000) {
      break;
    }
  }

  return text;
}

function classifyByText(text: string): { purpose: NoticePurpose; reasonCodes: string[] } {
  const nonResidentialHit = includesAny(text, NON_RESIDENTIAL_TITLE_KEYWORDS);
  if (nonResidentialHit) {
    return {
      purpose: "non_residential",
      reasonCodes: [`pdf_keyword:${nonResidentialHit}`],
    };
  }

  const residentialHit = includesAny(text, RESIDENTIAL_TYPE_KEYWORDS);
  if (residentialHit) {
    return {
      purpose: "residential",
      reasonCodes: [`pdf_keyword:${residentialHit}`],
    };
  }

  return {
    purpose: "unknown",
    reasonCodes: ["pdf_keyword_not_found"],
  };
}

function classifyByMetadata(notice: Notice): { purpose: NoticePurpose; reasonCodes: string[] } {
  const upperType = toText(notice.upperTypeName);
  const detailType = toText(notice.detailTypeName);
  const title = toText(notice.title);
  const combined = `${upperType} ${detailType} ${title}`;

  const nonResidentialUpper = includesAny(upperType, NON_RESIDENTIAL_UPPER_TYPE_KEYWORDS);
  if (nonResidentialUpper) {
    return {
      purpose: "non_residential",
      reasonCodes: [`upper_type:${nonResidentialUpper}`],
    };
  }

  const nonResidentialDetail = includesAny(detailType, NON_RESIDENTIAL_DETAIL_TYPE_KEYWORDS);
  if (nonResidentialDetail) {
    return {
      purpose: "non_residential",
      reasonCodes: [`detail_type:${nonResidentialDetail}`],
    };
  }

  const nonResidentialTitle = includesAny(combined, NON_RESIDENTIAL_TITLE_KEYWORDS);
  if (nonResidentialTitle) {
    return {
      purpose: "non_residential",
      reasonCodes: [`title_keyword:${nonResidentialTitle}`],
    };
  }

  const residentialType = includesAny(combined, RESIDENTIAL_TYPE_KEYWORDS);
  if (residentialType) {
    return {
      purpose: "residential",
      reasonCodes: [`residential_keyword:${residentialType}`],
    };
  }

  if (notice.housingType === "06" || notice.housingType === "05" || notice.housingType === "13") {
    return {
      purpose: "unknown",
      reasonCodes: [`housing_type:${notice.housingType}`],
    };
  }

  return {
    purpose: "non_residential",
    reasonCodes: [`housing_type:${notice.housingType || "unknown"}`],
  };
}

export type NoticePurpose = "residential" | "non_residential" | "unknown";

export type PurposeDecidedBy = "metadata" | "pdf";

export interface NoticePurposeDecision {
  notice: Notice;
  purpose: NoticePurpose;
  reasonCodes: string[];
  decidedBy: PurposeDecidedBy;
}

export async function classifyNoticePurpose(notice: Notice): Promise<NoticePurposeDecision> {
  const metadataResult = classifyByMetadata(notice);
  if (metadataResult.purpose !== "unknown") {
    return {
      notice,
      purpose: metadataResult.purpose,
      reasonCodes: metadataResult.reasonCodes,
      decidedBy: "metadata",
    };
  }

  if (!notice.pdfUrl) {
    return {
      notice,
      purpose: "unknown",
      reasonCodes: [...metadataResult.reasonCodes, "pdf_missing"],
      decidedBy: "metadata",
    };
  }

  try {
    const buffer = await downloadBuffer(notice.pdfUrl);
    const text = await extractTextFromPdf(buffer);
    const pdfResult = classifyByText(text);
    return {
      notice,
      purpose: pdfResult.purpose,
      reasonCodes: [...metadataResult.reasonCodes, ...pdfResult.reasonCodes],
      decidedBy: "pdf",
    };
  } catch {
    return {
      notice,
      purpose: "unknown",
      reasonCodes: [...metadataResult.reasonCodes, "pdf_parse_failed"],
      decidedBy: "pdf",
    };
  }
}

export async function classifyNoticePurposes(notices: Notice[]): Promise<NoticePurposeDecision[]> {
  const decisions: NoticePurposeDecision[] = [];

  for (const notice of notices) {
    decisions.push(await classifyNoticePurpose(notice));
  }

  return decisions;
}
