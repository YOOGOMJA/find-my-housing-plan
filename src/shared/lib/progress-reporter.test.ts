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

  it("6단계 기준으로 collect 완료 시 전체 퍼센트가 17%로 계산된다", () => {
    const writes: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    });

    withTty(true, () => {
      const reporter = createProgressReporter();
      reporter.report({ phase: "collect", current: 10, total: 10, percent: 100, message: "수집 완료" });
      reporter.flush();
    });

    writeSpy.mockRestore();
    const output = writes.join("");
    expect(output).toContain("전체 [");
    expect(output).toContain("17%");
  });

  it("non-TTY 환경에서 상태/전체를 한 줄 로그로 출력한다", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    withTty(false, () => {
      const reporter = createProgressReporter();
      reporter.report({ phase: "collect", current: 1, total: 2, percent: 50, message: "수집 1/2" });
      reporter.complete();
    });

    const logged = logSpy.mock.calls.map((call) => String(call[0]));
    logSpy.mockRestore();

    expect(logged.some((line) => line.includes("상태 [수집]"))).toBe(true);
    expect(logged.some((line) => line.includes("전체 ["))).toBe(true);
    expect(logged.some((line) => /상태 \[[|\/\\-] /.test(line))).toBe(false);
  });

  it("TTY 환경에서 현재 라인에는 스피너를 표시하지 않는다", () => {
    const writes: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    });

    withTty(true, () => {
      const reporter = createProgressReporter();
      reporter.report({ phase: "collect", current: 1, total: 2, percent: 50, message: "수집 1/2" });
      reporter.flush();
    });

    writeSpy.mockRestore();

    const output = writes.join("");
    expect(output).toContain("상태 [수집] 수집 1/2 (1/2, 50%)");
    expect(/상태 \[[|\/\\-] /.test(output)).toBe(false);
  });

  it("TTY 환경에서 전체 바 라인 끝에 스피너를 표시한다", () => {
    const writes: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    });

    withTty(true, () => {
      const reporter = createProgressReporter();
      reporter.report({ phase: "collect", current: 1, total: 2, percent: 50, message: "수집 1/2" });
      reporter.flush();
    });

    writeSpy.mockRestore();

    const output = writes.join("");
    expect(/전체 \[[^\]]+\] \d+% [|\/\\-]/.test(output)).toBe(true);
  });

  it("TTY 환경에서 진행 상태를 한 줄로 덮어쓴다", () => {
    const writes: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    });

    withTty(true, () => {
      const reporter = createProgressReporter();
      reporter.report({ phase: "collect", current: 1, total: 2, percent: 50, message: "수집 1/2" });
      reporter.report({ phase: "collect", current: 2, total: 2, percent: 100, message: "수집 2/2" });
      reporter.flush();
    });

    writeSpy.mockRestore();

    const output = writes.join("");
    expect(output).toContain("\r\u001B[2K");
    expect(output).not.toContain("\n현재");
    expect(output).not.toContain("\n상태");
  });

  it("TTY 환경에서 스피너가 1초마다 회전한다", () => {
    jest.useFakeTimers();
    const writes: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    });

    withTty(true, () => {
      const reporter = createProgressReporter();
      reporter.report({ phase: "collect", current: 1, total: 2, percent: 50, message: "수집 1/2" });
      jest.advanceTimersByTime(1000);
      reporter.flush();
    });

    writeSpy.mockRestore();
    jest.useRealTimers();

    const output = writes.join("");
    expect(output).toContain("% |");
    expect(output).toContain("% /");
  });

  it("마지막 이벤트가 완료 상태면 complete에서 중복 출력하지 않는다", () => {
    const writes: string[] = [];
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
      return true;
    });

    withTty(true, () => {
      const reporter = createProgressReporter();
      reporter.report({ phase: "notify", current: 4, total: 4, percent: 100, message: "Slack 전송 4/4" });
      reporter.complete();
      reporter.flush();
    });

    writeSpy.mockRestore();

    const output = writes.join("");
    const occurrences = output.split("Slack 전송 4/4").length - 1;
    expect(occurrences).toBe(1);
  });
});
