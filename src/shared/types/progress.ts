export type ProgressPhase = "collect" | "parse" | "notify";

export interface ProgressEvent {
  phase: ProgressPhase;
  current: number;
  total: number;
  percent: number;
  message: string;
}

export type ProgressReporter = (event: ProgressEvent) => void;
