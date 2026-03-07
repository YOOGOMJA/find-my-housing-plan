export type Mode = "profile" | "filter" | "all";
export type EnvUpdates = Record<string, string>;
export type SetupSection = "profile" | "filter";

export class PromptCancelledError extends Error {
  constructor() {
    super("사용자가 설정을 취소했습니다.");
    this.name = "PromptCancelledError";
  }
}
