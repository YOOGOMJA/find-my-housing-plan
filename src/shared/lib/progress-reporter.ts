import { ProgressEvent, ProgressPhase, ProgressReporter } from "../types";

export function createProgressReporter(): { report: ProgressReporter; flush: () => void; complete: () => void } {
  const isTty = Boolean(process.stdout.isTTY);
  const phaseLabel: Record<ProgressPhase, string> = {
    collect: "수집",
    classify: "분류",
    prefilter: "사전필터",
    parse: "파싱",
    filter: "조건필터",
    notify: "전송",
  };
  const phaseOrder: ProgressPhase[] = ["collect", "classify", "prefilter", "parse", "filter", "notify"];
  const spinnerFrames = ["|", "/", "-", "\\"];
  const barWidth = 20;

  let hasRendered = false;
  let lastEvent: ProgressEvent | null = null;
  let lastOverallPercent: number | null = null;
  let lastStatusLine: string | null = null;
  let spinnerIndex = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  const clampPercent = (value: number): number => {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.round(value)));
  };

  const makeBar = (percent: number): string => {
    const filled = Math.round((clampPercent(percent) / 100) * barWidth);
    return `${"█".repeat(filled)}${"░".repeat(Math.max(0, barWidth - filled))}`;
  };

  const toOverallPercent = (event: ProgressEvent): number => {
    const phaseIndex = phaseOrder.indexOf(event.phase);
    const safeIndex = phaseIndex >= 0 ? phaseIndex : 0;
    return ((safeIndex + clampPercent(event.percent) / 100) / phaseOrder.length) * 100;
  };

  const renderLine = (overallPercent: number, statusLine: string): void => {
    const spinner = spinnerFrames[spinnerIndex % spinnerFrames.length];
    const combinedLine = isTty
      ? `${statusLine} | 전체 [${makeBar(overallPercent)}] ${clampPercent(overallPercent)}% ${spinner}`
      : `${statusLine} | 전체 [${makeBar(overallPercent)}] ${clampPercent(overallPercent)}%`;

    if (!isTty) {
      console.log(combinedLine);
      lastOverallPercent = clampPercent(overallPercent);
      lastStatusLine = statusLine;
      return;
    }

    lastOverallPercent = clampPercent(overallPercent);
    lastStatusLine = statusLine;

    if (hasRendered) {
      process.stdout.write(`\r\u001B[2K${combinedLine}`);
      return;
    }

    process.stdout.write(combinedLine);
    hasRendered = true;
  };

  const stopSpinnerTimer = (): void => {
    if (!spinnerTimer) {
      return;
    }
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  };

  const startSpinnerTimer = (): void => {
    if (!isTty || spinnerTimer) {
      return;
    }

    spinnerTimer = setInterval(() => {
      if (!hasRendered || lastOverallPercent === null || !lastStatusLine) {
        return;
      }
      spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
      renderLine(lastOverallPercent, lastStatusLine);
    }, 1000);
  };

  const flush = (): void => {
    if (!isTty || !hasRendered) {
      return;
    }
    stopSpinnerTimer();
    process.stdout.write("\n");
    hasRendered = false;
  };

  const formatCurrentLine = (event: ProgressEvent): string => {
    const percent = clampPercent(event.percent);
    return `상태 [${phaseLabel[event.phase]}] ${event.message} (${event.current}/${event.total}, ${percent}%)`;
  };

  const report = (event: ProgressEvent): void => {
    const currentLine = formatCurrentLine(event);
    renderLine(toOverallPercent(event), currentLine);
    startSpinnerTimer();
    lastEvent = event;
  };

  const complete = (): void => {
    if (lastOverallPercent === 100) {
      return;
    }

    const currentLine = lastEvent
      ? `상태 [${phaseLabel[lastEvent.phase]}] ${lastEvent.message} (${lastEvent.total}/${lastEvent.total}, 100%)`
      : "상태 [완료] 파이프라인 완료 (100%)";
    renderLine(100, currentLine);
  };

  return { report, flush, complete };
}
