import * as fs from "fs";
import * as path from "path";
import { EnvUpdates } from "../model/types";

export const ENV_PATH = path.resolve(process.cwd(), ".env");
const ENV_EXAMPLE_PATH = path.resolve(process.cwd(), ".env.example");

export function loadCurrentEnvMap(): Record<string, string> {
  const sourcePath = fs.existsSync(ENV_PATH) ? ENV_PATH : ENV_EXAMPLE_PATH;
  if (!fs.existsSync(sourcePath)) {
    return {};
  }

  const content = fs.readFileSync(sourcePath, "utf-8");
  const map: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    map[key] = value;
  }

  return map;
}

function readEnvTemplate(): string {
  if (fs.existsSync(ENV_PATH)) {
    return fs.readFileSync(ENV_PATH, "utf-8");
  }
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    return fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  }
  return "";
}

function renderEnvContent(baseContent: string, updates: EnvUpdates): string {
  const lines = baseContent.length > 0 ? baseContent.split(/\r?\n/) : [];
  const used = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      output.push(line);
      continue;
    }

    const key = match[1];
    if (!(key in updates)) {
      output.push(line);
      continue;
    }

    output.push(`${key}=${updates[key]}`);
    used.add(key);
  }

  const missing = Object.keys(updates).filter((key) => !used.has(key));
  if (missing.length > 0) {
    if (output.length > 0 && output[output.length - 1].trim() !== "") {
      output.push("");
    }
    output.push("# Added by env setup CLI");
    for (const key of missing) {
      output.push(`${key}=${updates[key]}`);
    }
  }

  return `${output.join("\n").replace(/\n+$/, "\n")}`;
}

export function writeEnv(updates: EnvUpdates): void {
  const merged: EnvUpdates = { ...loadCurrentEnvMap(), ...updates };
  const baseContent = readEnvTemplate();
  const rendered = renderEnvContent(baseContent, merged);
  fs.writeFileSync(ENV_PATH, rendered, "utf-8");
}
