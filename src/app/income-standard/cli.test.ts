import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const cliPath = path.resolve(process.cwd(), "src/app/income-standard/cli.ts");
const tsNodeBin = path.resolve(process.cwd(), "node_modules/.bin/ts-node");

const sample = {
  year: 2025,
  publishedAt: "2025-02-01",
  sourceUrl: "https://example.com/source",
  unit: "만원/월",
  householdIncome: {
    "1": 321,
    "2": 489,
    "3": 671,
    "4": 763,
    "5": 804,
    "6": 873,
  },
};

function runCli(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(tsNodeBin, [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("income-standard cli", () => {
  it("validate/install/show가 동작한다", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "income-cli-"));
    const samplePath = path.join(tmp, "sample.json");
    fs.writeFileSync(samplePath, JSON.stringify(sample), "utf-8");

    const validate = runCli(["validate", "sample.json"], tmp);
    expect(validate.code).toBe(0);

    const install = runCli(["install", "sample.json", "--as-latest"], tmp);
    expect(install.code).toBe(0);
    expect(fs.existsSync(path.join(tmp, "data/income-standards/latest.json"))).toBe(true);

    const show = runCli(["show", "--latest"], tmp);
    expect(show.code).toBe(0);
    expect(show.stdout).toContain("\"year\": 2025");
  });
});
