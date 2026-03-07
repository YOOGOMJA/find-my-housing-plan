/**
 * LH API 응답 탐색 스크립트
 * 실행: node explore/lh-api-probe.js
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// --- .env 파싱 ---
function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    console.error("[오류] .env 파일이 없습니다.");
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
}

// --- HTTP GET ---
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on("error", reject);
  });
}

function saveResult(outputDir, filename, data) {
  fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(data, null, 2), "utf-8");
  console.log(`  저장 → explore/output/${filename}`);
}

function printFields(label, obj) {
  if (!obj || typeof obj !== "object") return;
  console.log(`\n  [${label}] 필드 목록:`);
  for (const [k, v] of Object.entries(obj)) {
    console.log(`    ${k}: ${String(v).slice(0, 80)}`);
  }
}

function dateStr(d) {
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
}

// 응답에서 아이템 배열 추출 (다양한 구조 대응)
function extractItems(body) {
  if (!body) return [];
  // API 1/2/3 구조: body = [{dsSch:[...]}, {dsList:[...], resHeader:[...]}]
  if (Array.isArray(body)) {
    for (const chunk of body) {
      const key = Object.keys(chunk).find((k) => k !== "dsSch" && k !== "resHeader");
      if (key && Array.isArray(chunk[key])) return chunk[key];
    }
  }
  // 일반 구조
  const candidates = [body?.dsList, body?.ds, body?.response?.body?.items?.item, body?.items?.item];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return [];
}

// =============================================
// API 1: 분양임대공고 목록 조회 (일반)
// =============================================
async function probeNoticeList(apiKey, outputDir) {
  console.log("\n[API 1] 분양임대공고 목록 조회 (일반)");
  const today = new Date();
  const monthAgo = new Date(today); monthAgo.setMonth(monthAgo.getMonth() - 1);

  const params = new URLSearchParams({
    serviceKey: apiKey, type: "json",
    PG_SZ: "5", PAGE: "1",
    PAN_NT_ST_DT: dateStr(monthAgo),
    CLSG_DT: dateStr(today),
  });
  const url = `https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1?${params}`;
  const result = await get(url);
  saveResult(outputDir, "01_notice_list.json", result);
  const items = extractItems(result.body);
  if (items.length > 0) {
    console.log(`  전체 공고 수: ${items[0].ALL_CNT ?? "?"}건, 이번 응답: ${items.length}건`);
    // 임대주택(06) 항목 우선 선택, 없으면 첫 번째
    const target = items.find((i) => i.UPP_AIS_TP_CD === "06") ?? items[0];
    printFields("공고 목록 샘플 (임대주택 우선)", target);
    return target;
  } else {
    console.log("  결과 없음. 전체 응답 구조:", JSON.stringify(result.body).slice(0, 300));
    return null;
  }
}

// =============================================
// API 2: 분양임대공고 상세 조회 (일반)
// =============================================
async function probeNoticeDetail(apiKey, outputDir, noticeItem) {
  console.log("\n[API 2] 분양임대공고 상세 조회 (일반)");
  if (!noticeItem) { console.log("  목록 결과 없어 건너뜀"); return; }

  const panId = noticeItem.PAN_ID ?? noticeItem.panId ?? "";
  const uppAisTpCd = noticeItem.UPP_AIS_TP_CD ?? noticeItem.uppAisTpCd ?? "06";
  const ccrCnntSysDsCd = noticeItem.CCR_CNNT_SYS_DS_CD ?? noticeItem.ccrCnntSysDsCd ?? "01";
  const splInfTpCd = noticeItem.SPL_INF_TP_CD ?? noticeItem.splInfTpCd ?? "010";

  if (!panId) { console.log("  PAN_ID 없음 → 01_notice_list.json 확인 필요"); return; }

  const params = new URLSearchParams({
    serviceKey: apiKey, type: "json",
    PAN_ID: panId, UPP_AIS_TP_CD: uppAisTpCd,
    CCR_CNNT_SYS_DS_CD: ccrCnntSysDsCd, SPL_INF_TP_CD: splInfTpCd,
  });
  const url = `https://apis.data.go.kr/B552555/lhLeaseNoticeDtlInfo1/getLeaseNoticeDtlInfo1?${params}`;
  const result = await get(url);
  saveResult(outputDir, "02_notice_detail.json", result);
  const items = extractItems(result.body);
  if (items.length > 0) printFields("공고 상세 1건", items[0]);
  else console.log("  결과 없음:", JSON.stringify(result.body).slice(0, 300));
}

// =============================================
// API 3: 분양임대공고 공급정보 조회 (일반)
// =============================================
async function probeNoticeSupply(apiKey, outputDir, noticeItem) {
  console.log("\n[API 3] 분양임대공고 공급정보 조회 (일반)");
  if (!noticeItem) { console.log("  목록 결과 없어 건너뜀"); return; }

  const panId = noticeItem.PAN_ID ?? noticeItem.panId ?? "";
  const uppAisTpCd = noticeItem.UPP_AIS_TP_CD ?? noticeItem.uppAisTpCd ?? "06";
  const ccrCnntSysDsCd = noticeItem.CCR_CNNT_SYS_DS_CD ?? noticeItem.ccrCnntSysDsCd ?? "01";
  const splInfTpCd = noticeItem.SPL_INF_TP_CD ?? noticeItem.splInfTpCd ?? "010";

  if (!panId) { console.log("  PAN_ID 없음 → 01_notice_list.json 확인 필요"); return; }

  const params = new URLSearchParams({
    serviceKey: apiKey, type: "json",
    PAN_ID: panId, UPP_AIS_TP_CD: uppAisTpCd,
    CCR_CNNT_SYS_DS_CD: ccrCnntSysDsCd, SPL_INF_TP_CD: splInfTpCd,
  });
  const url = `https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1/getLeaseNoticeSplInfo1?${params}`;
  const result = await get(url);
  saveResult(outputDir, "03_notice_supply.json", result);
  const items = extractItems(result.body);
  if (items.length > 0) printFields("공급정보 1건", items[0]);
  else console.log("  결과 없음:", JSON.stringify(result.body).slice(0, 300));
}

// =============================================
// API 4: 공공임대주택 단지정보 조회
// =============================================
async function probeComplexInfo(apiKey, outputDir) {
  console.log("\n[API 4] 공공임대주택 단지정보 조회");
  const params = new URLSearchParams({
    serviceKey: apiKey, type: "json",
    numOfRows: "3", pageNo: "1",
  });
  const url = `https://apis.data.go.kr/B552555/lhLeaseInfo1/lhLeaseInfo1?${params}`;
  const result = await get(url);
  saveResult(outputDir, "04_complex_info.json", result);
  const items = extractItems(result.body);
  if (items.length > 0) printFields("단지정보 1건", items[0]);
  else console.log("  결과 없음:", JSON.stringify(result.body).slice(0, 300));
}

// =============================================
// API 5: 분양임대공고문 목록 조회 (사전청약)
// =============================================
async function probePreNoticeList(apiKey, outputDir) {
  console.log("\n[API 5] 분양임대공고문 목록 조회 (사전청약)");
  const params = new URLSearchParams({
    serviceKey: apiKey, type: "json",
    PG_SZ: "3", PAGE: "1",
  });
  const url = `https://apis.data.go.kr/B552555/prscrbLhLeaseNoticeInfo1/prscrbLhLeaseNoticeInfo1?${params}`;
  const result = await get(url);
  saveResult(outputDir, "05_pre_notice_list.json", result);
  const items = extractItems(result.body);
  if (items.length > 0) printFields("사전청약 공고 1건", items[0]);
  else console.log("  결과 없음:", JSON.stringify(result.body).slice(0, 300));
  return items[0] ?? null;
}

// =============================================
// 메인
// =============================================
async function main() {
  loadEnv();
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!apiKey) { console.error("[오류] .env에 PUBLIC_DATA_API_KEY가 없습니다."); process.exit(1); }

  const outputDir = path.resolve(__dirname, "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log("=== LH API 탐색 시작 ===");
  console.log("결과 저장 위치: explore/output/");

  const noticeItem = await probeNoticeList(apiKey, outputDir);
  await probeNoticeDetail(apiKey, outputDir, noticeItem);
  await probeNoticeSupply(apiKey, outputDir, noticeItem);
  await probeComplexInfo(apiKey, outputDir);
  await probePreNoticeList(apiKey, outputDir);

  console.log("\n=== 완료 ===");
  console.log("explore/output/*.json 파일을 확인하세요.");
}

main().catch((err) => { console.error("[오류]", err.message); process.exit(1); });
