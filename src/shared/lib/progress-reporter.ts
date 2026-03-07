import { ProgressEvent, ProgressPhase, ProgressReporter } from "../types";

export function createProgressReporter(): { report: ProgressReporter; flush: () => void; complete: () => void } {
  const isTty = Boolean(process.stdout.isTTY);
  const phaseLabel: Record<ProgressPhase, string> = {
    collect: "수집",
    parse: "파싱",
    notify: "전송",
  };
  const phaseOrder: ProgressPhase[] = ["collect", "parse", "notify"];
  const spinnerFrames = ["|", "/", "-", "\\"];
  const barWidth = 20;

  let hasRendered = false;
  let lastEvent: ProgressEvent | null = null;
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
      return;
    }

    if (hasRendered) {
      process.stdout.write(`\u001B[1A\r\u001B[2K${overallLine}\n\r\u001B[2K${currentLine}`);
      return;
    }

    process.stdout.write(`${overallLine}\n${currentLine}`);
    hasRendered = true;
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
    if (!isTty) {
      return `현재 [${phaseLabel[event.phase]}] ${event.message} (${event.current}/${event.total}, ${percent}%)`;
    }

    const frame = spinnerFrames[spinnerIndex % spinnerFrames.length];
    return `현재 [${frame} ${phaseLabel[event.phase]}] ${event.message} (${event.current}/${event.total}, ${percent}%)`;
  };

  const isCompletedEvent = (event: ProgressEvent): boolean => {
    if (clampPercent(event.percent) >= 100) {
      return true;
    }
    return event.total > 0 && event.current >= event.total;
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
    if (lastEvent && isCompletedEvent(lastEvent)) {
      return;
    }

    const currentLine = lastEvent
      ? `현재 [${phaseLabel[lastEvent.phase]}] ${lastEvent.message} (100%)`
      : "현재 [완료] 파이프라인 완료 (100%)";
    renderLines(100, currentLine);
  };

  return { report, flush, complete };
}
