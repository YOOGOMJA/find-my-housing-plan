import { Notice, NoticeApplicationStatus } from "../entities/notice";
import { collectNotices } from "../features/collect-notices";
import { filterNotices, matchesHousingPreference } from "../features/filter-notices";
import { classifyNoticePurposes } from "../features/notice-purpose";
import {
  loadNotifiedState,
  loadProcessedState,
  markNotifiedNotices,
  markProcessedNotices,
  saveNotifiedState,
  saveProcessedState,
  toProcessedKeySet,
} from "../features/notice-state";
import { ManualReviewNotice, sendSlackNotification } from "../features/notify-slack";
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
  const chalk = (await import("chalk")).default;
  loadEnv();
  const config = loadConfig();
  const processedState = loadProcessedState();
  const notifiedState = loadNotifiedState();
  const runId = new Date().toISOString();
  const processedKeys = toProcessedKeySet(processedState);
  const progress = createProgressReporter();
  const summaryLines: string[] = [];
  const stageTimingsMs: Record<string, number> = {
    collect: 0,
    classify: 0,
    prefilter: 0,
    parse: 0,
    filter: 0,
    notify: 0,
    total: 0,
  };
  const startedAt = Date.now();
  const formatDuration = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
  let statusSummary = "접수상태(접수중/접수예정/마감/미확인): 0/0/0/0";
  let completionMessage = chalk.bold.green("✅ 완료.");
  let warningMessage: string | null = null;

  let stageStartedAt = Date.now();
  const notices = await collectNotices(config.apiKey, processedKeys, progress.report, {
    concurrency: config.performance.collectConcurrency,
    keepAlive: config.performance.httpKeepAlive,
  });
  stageTimingsMs.collect = Date.now() - stageStartedAt;
  summaryLines.push(`📦 처리 대상 공고 ${notices.length}건`);

  if (notices.length === 0) {
    stageTimingsMs.total = Date.now() - startedAt;
    progress.complete();
    progress.flush();
    completionMessage = chalk.yellow("⚠ 마감 전 미처리 공고가 없습니다.");
    console.log(completionMessage);
    console.log(chalk.bold("요약"));
    for (const line of summaryLines) {
      console.log(chalk.dim(`  ${line}`));
    }
    if (config.performance.timingSummary) {
      console.log(
        chalk.dim(
          `  ⏱ 소요시간(총/수집/분류/사전필터/파싱/조건필터/알림): ${formatDuration(stageTimingsMs.total)}/${formatDuration(stageTimingsMs.collect)}/${formatDuration(stageTimingsMs.classify)}/${formatDuration(stageTimingsMs.prefilter)}/${formatDuration(stageTimingsMs.parse)}/${formatDuration(stageTimingsMs.filter)}/${formatDuration(stageTimingsMs.notify)}`,
        ),
      );
    }
    return;
  }

  progress.report({
    phase: "classify",
    current: 0,
    total: 1,
    percent: 0,
    message: `주거 목적 분류 시작 (대상 ${notices.length}건)`,
  });
  stageStartedAt = Date.now();
  const purposeDecisions = await classifyNoticePurposes(notices, {
    concurrency: config.performance.classifyConcurrency,
    keepAlive: config.performance.httpKeepAlive,
  });
  stageTimingsMs.classify = Date.now() - stageStartedAt;
  const residentialNotices = purposeDecisions
    .filter((decision) => decision.purpose === "residential")
    .map((decision) => decision.notice);
  const nonResidentialCount = purposeDecisions.filter((decision) => decision.purpose === "non_residential").length;
  const unknownPurposeCount = purposeDecisions.filter((decision) => decision.purpose === "unknown").length;
  progress.report({
    phase: "classify",
    current: 1,
    total: 1,
    percent: 100,
    message: `주거 ${residentialNotices.length}건, 비주거 ${nonResidentialCount}건, 분류불가 ${unknownPurposeCount}건`,
  });
  summaryLines.push(`🏠 주거 공고 ${residentialNotices.length}건, 비주거 제외 ${nonResidentialCount}건, 분류불가 제외 ${unknownPurposeCount}건`);

  progress.report({
    phase: "prefilter",
    current: 0,
    total: 1,
    percent: 0,
    message: `선호조건 사전 필터 시작 (대상 ${residentialNotices.length}건)`,
  });
  stageStartedAt = Date.now();
  const candidates = residentialNotices.filter((notice) => matchesHousingPreference(notice, config.user));
  stageTimingsMs.prefilter = Date.now() - stageStartedAt;
  progress.report({
    phase: "prefilter",
    current: 1,
    total: 1,
    percent: 100,
    message: `선호조건 후보 ${candidates.length}건`,
  });
  summaryLines.push(`🎯 선호조건 후보 ${candidates.length}건`);

  if (candidates.length === 0) {
    stageTimingsMs.total = Date.now() - startedAt;
    markProcessedNotices(processedState, notices);
    saveProcessedState(processedState);
    progress.complete();
    progress.flush();
    completionMessage = chalk.yellow("⚠ 선호조건에 맞는 공고가 없습니다.");
    console.log(completionMessage);
    console.log(chalk.bold("요약"));
    for (const line of summaryLines) {
      console.log(chalk.dim(`  ${line}`));
    }
    if (config.performance.timingSummary) {
      console.log(
        chalk.dim(
          `  ⏱ 소요시간(총/수집/분류/사전필터/파싱/조건필터/알림): ${formatDuration(stageTimingsMs.total)}/${formatDuration(stageTimingsMs.collect)}/${formatDuration(stageTimingsMs.classify)}/${formatDuration(stageTimingsMs.prefilter)}/${formatDuration(stageTimingsMs.parse)}/${formatDuration(stageTimingsMs.filter)}/${formatDuration(stageTimingsMs.notify)}`,
        ),
      );
    }
    return;
  }

  stageStartedAt = Date.now();
  const { parsed, failedPanIds, parseStatuses } = await parseNotices(candidates, config.anthropicKey, progress.report, {
    concurrency: config.performance.parseConcurrency,
    keepAlive: config.performance.httpKeepAlive,
  });
  stageTimingsMs.parse = Date.now() - stageStartedAt;

  const parsedSuccess = parsed.filter((notice) => parseStatuses[notice.panId] === "success");
  const manualReviewNotices: ManualReviewNotice[] = parsed
    .filter((notice) => parseStatuses[notice.panId] !== "success")
    .map((notice) => ({
      notice,
      reason: parseStatuses[notice.panId] === "no_pdf" ? "no_pdf" : "parse_failed",
    }));

  progress.report({
    phase: "filter",
    current: 0,
    total: 1,
    percent: 0,
    message: `조건 필터링 시작 (대상 ${parsedSuccess.length}건)`,
  });
  stageStartedAt = Date.now();
  const matched = filterNotices(parsedSuccess, config.user);
  stageTimingsMs.filter = Date.now() - stageStartedAt;
  progress.report({
    phase: "filter",
    current: 1,
    total: 1,
    percent: 100,
    message: `조건충족 ${matched.length}건, 수동확인 ${manualReviewNotices.length}건`,
  });
  summaryLines.push(`✅ 조건 충족 공고 ${matched.length}건`);
  summaryLines.push(`🟠 수동 확인 필요 공고 ${manualReviewNotices.length}건`);

  const statusCounts: Record<NoticeApplicationStatus, number> = {
    upcoming: 0,
    open: 0,
    closed: 0,
    unknown: 0,
  };

  for (const notice of matched) {
    statusCounts[normalizeApplicationStatus(notice.applicationStatus)] += 1;
  }

  statusSummary = `📌 접수상태(접수중/접수예정/마감/미확인): ${statusCounts.open}/${statusCounts.upcoming}/${statusCounts.closed}/${statusCounts.unknown}`;

  if (matched.length > 0 || manualReviewNotices.length > 0) {
    stageStartedAt = Date.now();
    await sendSlackNotification(
      config.slackWebhookUrl,
      matched,
      config.user,
      runId,
      progress.report,
      manualReviewNotices,
      { keepAlive: config.performance.httpKeepAlive },
    );
    stageTimingsMs.notify = Date.now() - stageStartedAt;
    markNotifiedNotices(notifiedState, matched, runId);
    saveNotifiedState(notifiedState);
    summaryLines.push(`📨 Slack 알림 전송 ${matched.length}건, 수동 확인 알림 ${manualReviewNotices.length}건`);
  } else {
    summaryLines.push("📨 Slack 알림 전송 없음");
  }

  const failedPanIdSet = new Set(failedPanIds);
  const processedTargets = selectProcessedNotices(notices, candidates, failedPanIdSet);
  if (failedPanIdSet.size > 0) {
    warningMessage = `⚠ 파싱 실패 ${failedPanIdSet.size}건은 processed 상태로 기록하지 않습니다.`;
  }
  markProcessedNotices(processedState, processedTargets);
  saveProcessedState(processedState);

  progress.complete();
  progress.flush();
  stageTimingsMs.total = Date.now() - startedAt;
  console.log(completionMessage);
  console.log(chalk.bold("요약"));
  for (const line of summaryLines) {
    console.log(chalk.dim(`  ${line}`));
  }
  console.log(chalk.dim(`  ${statusSummary}`));
  if (config.performance.timingSummary) {
    console.log(
      chalk.dim(
        `  ⏱ 소요시간(총/수집/분류/사전필터/파싱/조건필터/알림): ${formatDuration(stageTimingsMs.total)}/${formatDuration(stageTimingsMs.collect)}/${formatDuration(stageTimingsMs.classify)}/${formatDuration(stageTimingsMs.prefilter)}/${formatDuration(stageTimingsMs.parse)}/${formatDuration(stageTimingsMs.filter)}/${formatDuration(stageTimingsMs.notify)}`,
      ),
    );
  }
  if (warningMessage) {
    console.log(chalk.yellow(`  ${warningMessage}`));
  }
}
