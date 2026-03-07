import { ProgressEvent, ProgressPhase, ProgressReporter } from "../types";

export function createProgressReporter(): { report: ProgressReporter; flush: () => void } {
  const isTty = Boolean(process.stdout.isTTY);
  const phaseLabel: Record<ProgressPhase, string> = {
    collect: "수집",
    parse: "파싱",
    notify: "전송",
  };

  let currentPhase: ProgressPhase | null = null;
  let lastLineLength = 0;

  const flush = (): void => {
    if (!isTty || lastLineLength === 0) {
      return;
    }
    process.stdout.write("\n");
    lastLineLength = 0;
    currentPhase = null;
  };

  const report = (event: ProgressEvent): void => {
    const line = `[진행][${phaseLabel[event.phase]}] ${event.message} (${event.current}/${event.total}, ${event.percent}%)`;

    if (!isTty) {
      console.log(line);
      return;
    }

    if (currentPhase !== event.phase && lastLineLength > 0) {
      process.stdout.write("\n");
      lastLineLength = 0;
    }

    currentPhase = event.phase;
    const padded = line.length < lastLineLength ? `${line}${" ".repeat(lastLineLength - line.length)}` : line;
    process.stdout.write(`\r${padded}`);
    lastLineLength = padded.length;
  };

  return { report, flush };
}
