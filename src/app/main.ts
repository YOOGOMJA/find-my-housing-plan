import { Notice, NoticeApplicationStatus } from "../entities/notice";
import { collectNotices } from "../features/collect-notices";
import { filterNotices, matchesHousingPreference } from "../features/filter-notices";
import {
  loadNotifiedState,
  loadProcessedState,
  markNotifiedNotices,
  markProcessedNotices,
  saveNotifiedState,
  saveProcessedState,
  toProcessedKeySet,
} from "../features/notice-state";
import { sendSlackNotification } from "../features/notify-slack";
import { parseNotices } from "../features/parse-notice";
import { loadConfig, loadEnv } from "../shared/config";
import { createProgressReporter } from "../shared/lib";

function normalizeApplicationStatus(value: string | undefined): NoticeApplicationStatus {
  if (value === "upcoming" || value === "open" || value === "closed" || value === "unknown") {
    return value;
  }

  return "unknown";
}

export function selectProcessedNotices(
  notices: Notice[],
  candidates: Notice[],
  failedPanIds: Set<string>,
): Notice[] {
  if (failedPanIds.size === 0) {
    return notices;
  }

  const candidatePanIds = new Set(candidates.map((notice) => notice.panId));
  return notices.filter((notice) => !candidatePanIds.has(notice.panId) || !failedPanIds.has(notice.panId));
}

export async function runMain(): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const processedState = loadProcessedState();
  const notifiedState = loadNotifiedState();
  const runId = new Date().toISOString();
  const processedKeys = toProcessedKeySet(processedState);
  const progress = createProgressReporter();

  console.log("[1/4] 공고 수집 중...");
  const notices = await collectNotices(config.apiKey, processedKeys, progress.report);
  progress.flush();
  console.log(`  처리 대상 공고 ${notices.length}건`);

  if (notices.length === 0) {
    progress.complete();
    progress.flush();
    console.log("마감 전 미처리 공고가 없습니다.");
    return;
  }

  console.log("[2/5] 선호조건 사전 필터링 중...");
  const candidates = notices.filter((notice) => matchesHousingPreference(notice, config.user));
  console.log(`  선호조건 후보 ${candidates.length}건`);

  if (candidates.length === 0) {
    markProcessedNotices(processedState, notices);
    saveProcessedState(processedState);
    progress.complete();
    progress.flush();
    console.log("선호조건에 맞는 공고가 없습니다.");
    return;
  }

  console.log("[3/5] 공고문 파싱 중...");
  const { parsed, failedPanIds } = await parseNotices(candidates, config.anthropicKey, progress.report);
  progress.flush();

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
    await sendSlackNotification(config.slackWebhookUrl, matched, progress.report);
    progress.flush();
    markNotifiedNotices(notifiedState, matched, runId);
    saveNotifiedState(notifiedState);
  }

  const failedPanIdSet = new Set(failedPanIds);
  const processedTargets = selectProcessedNotices(notices, candidates, failedPanIdSet);
  if (failedPanIdSet.size > 0) {
    console.warn(`[경고] 파싱 실패 ${failedPanIdSet.size}건은 processed 상태로 기록하지 않습니다.`);
  }
  markProcessedNotices(processedState, processedTargets);
  saveProcessedState(processedState);

  progress.complete();
  progress.flush();
  console.log("완료.");
}
