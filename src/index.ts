import { loadConfig, loadEnv } from "./config";
import { collectNotices } from "./collector";
import { parseNotices } from "./parser";
import { filterNotices, matchesHousingPreference } from "./filter";
import { sendSlackNotification } from "./notifier";
import { NoticeApplicationStatus } from "./types";
import {
  loadNotifiedState,
  loadProcessedState,
  markNotifiedNotices,
  markProcessedNotices,
  saveNotifiedState,
  saveProcessedState,
  toProcessedKeySet,
} from "./state";

function normalizeApplicationStatus(value: string | undefined): NoticeApplicationStatus {
  if (value === "upcoming" || value === "open" || value === "closed" || value === "unknown") {
    return value;
  }

  return "unknown";
}

async function main(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const processedState = loadProcessedState();
  const notifiedState = loadNotifiedState();
  const runId = new Date().toISOString();
  const processedKeys = toProcessedKeySet(processedState);

  console.log("[1/4] 공고 수집 중...");
  const notices = await collectNotices(config.apiKey, processedKeys);
  console.log(`  처리 대상 공고 ${notices.length}건`);

  if (notices.length === 0) {
    console.log("마감 전 미처리 공고가 없습니다.");
    return;
  }

  console.log("[2/5] 선호조건 사전 필터링 중...");
  const candidates = notices.filter((notice) => matchesHousingPreference(notice, config.user));
  console.log(`  선호조건 후보 ${candidates.length}건`);

  if (candidates.length === 0) {
    markProcessedNotices(processedState, notices);
    saveProcessedState(processedState);
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
    markNotifiedNotices(notifiedState, matched, runId);
    saveNotifiedState(notifiedState);
  }

  markProcessedNotices(processedState, notices);
  saveProcessedState(processedState);

  console.log("완료.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[오류] ${message}`);
  process.exit(1);
});
