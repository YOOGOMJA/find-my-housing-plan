/**
 * LH 공고문 PDF 파싱 탐색 스크립트
 * 실행: node explore/lh-pdf-probe.js
 *
 * API 2 응답의 PDF URL을 다운로드 → 텍스트 추출 → Claude API로 구조화
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const Anthropic = require("@anthropic-ai/sdk");
let pdfjsLib;

// --- .env 파싱 ---
function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
}

// --- URL 다운로드 (리다이렉트 대응) ---
function download(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        return download(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

// --- Claude API로 공고문 텍스트 구조화 ---
async function extractWithClaude(client, text, noticeTitle) {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `다음은 LH 공공임대주택 공고문 텍스트입니다. 아래 항목을 JSON으로 추출해줘. 명시되지 않은 항목은 null로 해줘.

공고명: ${noticeTitle}

---
${text.slice(0, 6000)}
---

추출할 항목:
{
  "신청대상": "청년/신혼부부/일반 등",
  "소득기준": "예: 도시근로자 월평균소득 70% 이하",
  "자산기준": "예: 총자산 3.61억 이하",
  "자동차기준": "예: 자동차 3,683만원 이하",
  "무주택조건": "예: 무주택세대구성원",
  "임대보증금": "예: 26형 3,000만원",
  "월임대료": "예: 26형 15만원",
  "전용면적": "예: 26㎡, 37㎡",
  "접수방법": "온라인/현장 등",
  "기타특이사항": "중요한 내용 요약"
}

JSON만 출력해줘.`,
      },
    ],
  });

  try {
    const raw = response.content[0].text.trim();
    const json = raw.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(json);
  } catch {
    return { raw: response.content[0].text };
  }
}

async function main() {
  loadEnv();

  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !anthropicKey) {
    console.error("[오류] .env에 PUBLIC_DATA_API_KEY 또는 ANTHROPIC_API_KEY가 없습니다.");
    process.exit(1);
  }

  const outputDir = path.resolve(__dirname, "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const client = new Anthropic({ apiKey: anthropicKey });

  // API 2 응답에서 PDF URL 가져오기 (이전 탐색 결과 재사용)
  const detailPath = path.join(outputDir, "02_notice_detail.json");
  if (!fs.existsSync(detailPath)) {
    console.error("[오류] explore/output/02_notice_detail.json 없음. lh-api-probe.js 먼저 실행하세요.");
    process.exit(1);
  }

  const detail = JSON.parse(fs.readFileSync(detailPath, "utf-8"));
  const body = detail.body;

  // 첨부파일 목록에서 PDF URL 추출
  let pdfUrl = null;
  let noticeTitle = "공고문";

  for (const chunk of body) {
    // 공고명
    if (chunk.dsSbd?.[0]?.LCC_NT_NM) noticeTitle = chunk.dsSbd[0].LCC_NT_NM;
    // PDF URL (공고문 PDF 우선)
    if (chunk.dsAhflInfo) {
      const pdfFile = chunk.dsAhflInfo.find((f) => f.SL_PAN_AHFL_DS_CD_NM?.includes("PDF"));
      if (pdfFile) pdfUrl = pdfFile.AHFL_URL;
    }
  }

  if (!pdfUrl) {
    console.error("[오류] PDF URL을 찾을 수 없습니다. 02_notice_detail.json 확인하세요.");
    process.exit(1);
  }

  console.log(`공고명: ${noticeTitle}`);
  console.log(`PDF URL: ${pdfUrl}`);
  console.log("PDF 다운로드 중...");

  const { status, buffer } = await download(pdfUrl);
  console.log(`  HTTP ${status}, 크기: ${(buffer.length / 1024).toFixed(1)}KB`);

  // PDF → 텍스트
  console.log("텍스트 추출 중...");
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n";
  }
  console.log(`  추출된 텍스트 길이: ${text.length}자`);

  // 텍스트 저장 (디버깅용)
  fs.writeFileSync(path.join(outputDir, "06_notice_pdf_text.txt"), text, "utf-8");
  console.log("  저장 → explore/output/06_notice_pdf_text.txt");

  // Claude API로 구조화
  console.log("\nClaude API로 조건 추출 중...");
  const extracted = await extractWithClaude(client, text, noticeTitle);

  fs.writeFileSync(
    path.join(outputDir, "07_notice_extracted.json"),
    JSON.stringify(extracted, null, 2),
    "utf-8"
  );

  console.log("\n=== 추출 결과 ===");
  console.log(JSON.stringify(extracted, null, 2));
  console.log("\n저장 → explore/output/07_notice_extracted.json");
}

main().catch((err) => { console.error("[오류]", err.message); process.exit(1); });
