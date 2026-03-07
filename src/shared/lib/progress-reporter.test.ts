import { createProgressReporter } from "./progress-reporter";
import { ProgressEvent } from "../types";

function withTty(value: boolean, run: () => void): void {
  const original = process.stdout.isTTY;
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true });
  try {
    run();
  } finally {
    Object.defineProperty(process.stdout, "isTTY", { value: original, configurable: true });
  }
}

describe("createProgressReporter", () => {
  it("전체 퍼센트가 단계 진행에 따라 역행하지 않는다", () => {
    const writes: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    });

    withTty(true, () => {
      const reporter = createProgressReporter();
      const events: ProgressEvent[] = [
        { phase: "collect", current: 5, total: 10, percent: 50, message: "수집 5/10" },
        { phase: "collect", current: 10, total: 10, percent: 100, message: "수집 완료" },
        { phase: "parse", current: 3, total: 10, percent: 30, message: "파싱 3/10" },
        { phase: "notify", current: 1, total: 2, percent: 50, message: "전송 1/2" },
      ];

      for (const event of events) {
        reporter.report(event);
      }
      reporter.complete();
      reporter.flush();
    });

    writeSpy.mockRestore();

    const output = writes.join("");
    const percents = [...output.matchAll(/전체 \[[^\]]+\] (\d+)%/g)].map((match) => Number.parseInt(match[1], 10));

    expect(percents.length).toBeGreaterThan(0);
    for (let i = 1; i < percents.length; i += 1) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
    expect(percents[percents.length - 1]).toBe(100);
  });

  it("non-TTY 환경에서 전체/현재 2줄 로그를 출력한다", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    withTty(false, () => {
      const reporter = createProgressReporter();
      reporter.report({ phase: "collect", current: 1, total: 2, percent: 50, message: "수집 1/2" });
      reporter.complete();
    });

    const logged = logSpy.mock.calls.map((call) => String(call[0]));
    logSpy.mockRestore();

    expect(logged.some((line) => line.startsWith("전체 ["))).toBe(true);
    expect(logged.some((line) => line.startsWith("현재 [수집]"))).toBe(true);
  });
});
