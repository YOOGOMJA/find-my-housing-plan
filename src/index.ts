import * as fs from "fs";
import * as path from "path";
import { loadConfig, loadEnv } from "./config";
import { collectNotices, toSeenKey } from "./collector";
import { parseNotices } from "./parser";
import { filterNotices, matchesHousingPreference } from "./filter";
import { sendSlackNotification } from "./notifier";
import { NoticeApplicationStatus } from "./types";

const SEEN_PATH = path.resolve(process.cwd(), "data/seen.json");

function loadSeen(): Set<string> {
  if (!fs.existsSync(SEEN_PATH)) {
    return new Set();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(SEEN_PATH, "utf-8")) as unknown;
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item): item is string => typeof item === "string"));
    }
  } catch {
    return new Set();
  }

  return new Set();
}

function saveSeen(seen: Set<string>): void {
  fs.mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
  fs.writeFileSync(SEEN_PATH, JSON.stringify([...seen], null, 2), "utf-8");
}

function normalizeApplicationStatus(value: string | undefined): NoticeApplicationStatus {
  if (value === "upcoming" || value === "open" || value === "closed" || value === "unknown") {
    return value;
  }

  return "unknown";
}

async function main(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const seen = loadSeen();

  console.log("[1/4] 공고 수집 중...");
  const notices = await collectNotices(config.apiKey, seen);
  console.log(`  처리 대상 공고 ${notices.length}건`);

  if (notices.length === 0) {
    console.log("마감 전 미처리 공고가 없습니다.");
    return;
  }

  console.log("[2/5] 선호조건 사전 필터링 중...");
  const candidates = notices.filter((notice) => matchesHousingPreference(notice, config.user));
  console.log(`  선호조건 후보 ${candidates.length}건`);

  if (candidates.length === 0) {
    console.log("선호조건에 맞는 공고가 없습니다.");
    return;
  }

  console.log("[3/5] 공고문 파싱 중...");
  const parsed = await parseNotices(candidates, config.anthropicKey);

  console.log("[4/5] 조건 필터링 중...");
  const matched = filterNotices(parsed, config.user);
  console.log(`  조건 충족 공고 ${matched.length}건`);

  const statusCounts: Record<NoticeApplicationStatus, number> = {
    upcoming: 0,
    open: 0,
    closed: 0,
    unknown: 0,
  };

  for (const notice of matched) {
    statusCounts[normalizeApplicationStatus(notice.applicationStatus)] += 1;
  }

  console.log(
    `  접수상태(접수중/접수예정/마감/미확인): ${statusCounts.open}/${statusCounts.upcoming}/${statusCounts.closed}/${statusCounts.unknown}`,
  );

  if (matched.length > 0) {
    console.log("[5/5] Slack 알림 전송 중...");
    await sendSlackNotification(config.slackWebhookUrl, matched);
  }

  for (const notice of parsed) {
    const phase = normalizeApplicationStatus(notice.applicationStatus);
    seen.add(toSeenKey(notice.panId, phase));
  }
  saveSeen(seen);

  console.log("완료.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[오류] ${message}`);
  process.exit(1);
});
