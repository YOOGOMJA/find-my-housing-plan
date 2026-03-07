import * as fs from "fs";
import * as path from "path";
import { Notice, NoticeApplicationStatus, ParsedNotice } from "./types";

export interface ProcessedRecord {
  panId: string;
  phase: NoticeApplicationStatus;
  lastProcessedAt: string;
}

export interface NotifiedRecord {
  panId: string;
  phase: NoticeApplicationStatus;
  lastNotifiedAt: string;
  runId: string;
}

export type ProcessedState = Record<string, ProcessedRecord>;
export type NotifiedState = Record<string, NotifiedRecord>;

const PROCESSED_PATH = path.resolve(process.cwd(), "data/processed.json");
const NOTIFIED_PATH = path.resolve(process.cwd(), "data/notified.json");

function normalizeApplicationStatus(value: string | undefined): NoticeApplicationStatus {
  if (value === "upcoming" || value === "open" || value === "closed" || value === "unknown") {
    return value;
  }

  return "unknown";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadStateFile<T extends Record<string, unknown>>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    return {} as T;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (isJsonObject(parsed)) {
      return parsed as T;
    }
  } catch {
    return {} as T;
  }

  return {} as T;
}

function saveStateFile(filePath: string, state: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export function toProcessedKey(panId: string, phase: NoticeApplicationStatus): string {
  return `${panId}:${phase}`;
}

function toNotifiedKey(panId: string, phase: NoticeApplicationStatus, runDate: string): string {
  return `${panId}:${phase}:${runDate}`;
}

export function loadProcessedState(): ProcessedState {
  return loadStateFile<ProcessedState>(PROCESSED_PATH);
}

export function saveProcessedState(state: ProcessedState): void {
  saveStateFile(PROCESSED_PATH, state);
}

export function loadNotifiedState(): NotifiedState {
  return loadStateFile<NotifiedState>(NOTIFIED_PATH);
}

export function saveNotifiedState(state: NotifiedState): void {
  saveStateFile(NOTIFIED_PATH, state);
}

export function toProcessedKeySet(state: ProcessedState): Set<string> {
  return new Set(Object.keys(state));
}

export function markProcessedNotices(
  state: ProcessedState,
  notices: Notice[] | ParsedNotice[],
  nowIso = new Date().toISOString(),
): void {
  for (const notice of notices) {
    const phase = normalizeApplicationStatus(notice.applicationStatus);
    const key = toProcessedKey(notice.panId, phase);
    state[key] = {
      panId: notice.panId,
      phase,
      lastProcessedAt: nowIso,
    };
  }
}

export function markNotifiedNotices(
  state: NotifiedState,
  notices: ParsedNotice[],
  runId: string,
  nowIso = new Date().toISOString(),
): void {
  const runDate = nowIso.slice(0, 10);

  for (const notice of notices) {
    const phase = normalizeApplicationStatus(notice.applicationStatus);
    const key = toNotifiedKey(notice.panId, phase, runDate);
    state[key] = {
      panId: notice.panId,
      phase,
      runId,
      lastNotifiedAt: nowIso,
    };
  }
}
