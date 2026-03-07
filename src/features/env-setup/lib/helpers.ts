import { Mode, SetupSection, PromptCancelledError } from "../model/types";

export function toCsv(items: string[]): string {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].join(",");
}

export function parseNumberInput(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function parseModeFromArg(rawArg: string | undefined): Mode | null {
  const raw = (rawArg ?? "").toLowerCase().trim();
  if (raw === "profile" || raw === "filter" || raw === "all") {
    return raw;
  }
  return null;
}

export function parseSectionsFromArg(rawArg: string | undefined): SetupSection[] | null {
  const mode = parseModeFromArg(rawArg);
  if (!mode) {
    return null;
  }
  if (mode === "all") {
    return ["profile", "filter"];
  }
  return [mode];
}

export function throwOnCancel(): never {
  throw new PromptCancelledError();
}

export function isValidBirthMonthDay(monthDay: string): boolean {
  const match = monthDay.match(/^(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  const probe = new Date(2000, month - 1, day);

  return probe.getFullYear() === 2000 && probe.getMonth() === month - 1 && probe.getDate() === day;
}

export function calculateManAge(birthYear: number, birthMonthDay: string, today = new Date()): number {
  const [birthMonthText, birthDayText] = birthMonthDay.split("-");
  const birthMonth = Number.parseInt(birthMonthText, 10);
  const birthDay = Number.parseInt(birthDayText, 10);

  let age = today.getFullYear() - birthYear;
  if (today.getMonth() + 1 < birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() < birthDay)) {
    age -= 1;
  }

  return Math.max(age, 0);
}
