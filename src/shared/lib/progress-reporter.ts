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
  let spinnerIndex = 0;

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

  const renderLines = (overallPercent: number, currentLine: string): void => {
    const spinner = spinnerFrames[spinnerIndex % spinnerFrames.length];
    const overallLine = isTty
      ? `전체 [${makeBar(overallPercent)}] ${clampPercent(overallPercent)}% ${spinner}`
      : `전체 [${makeBar(overallPercent)}] ${clampPercent(overallPercent)}%`;

    if (!isTty) {
      console.log(overallLine);
      console.log(currentLine);
      lastOverallPercent = clampPercent(overallPercent);
      return;
    }

    if (hasRendered) {
      process.stdout.write(`\u001B[1A\r\u001B[2K${overallLine}\n\r\u001B[2K${currentLine}`);
      return;
    }

    process.stdout.write(`${overallLine}\n${currentLine}`);
    hasRendered = true;
    lastOverallPercent = clampPercent(overallPercent);
  };

  const flush = (): void => {
    if (!isTty || !hasRendered) {
      return;
    }
    process.stdout.write("\n");
    hasRendered = false;
  };

  const formatCurrentLine = (event: ProgressEvent): string => {
    const percent = clampPercent(event.percent);
    return `현재 [${phaseLabel[event.phase]}] ${event.message} (${event.current}/${event.total}, ${percent}%)`;
  };

  const report = (event: ProgressEvent): void => {
    const currentLine = formatCurrentLine(event);
    renderLines(toOverallPercent(event), currentLine);
    if (isTty) {
      spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    }
    lastEvent = event;
  };

  const complete = (): void => {
    if (lastOverallPercent === 100) {
      return;
    }

    const currentLine = lastEvent
      ? `현재 [${phaseLabel[lastEvent.phase]}] ${lastEvent.message} (${lastEvent.total}/${lastEvent.total}, 100%)`
      : "현재 [완료] 파이프라인 완료 (100%)";
    renderLines(100, currentLine);
  };

  return { report, flush, complete };
}
