import * as fs from "fs";
import * as path from "path";
import {
  loadIncomeStandardCatalog,
  toIncomeStandard,
  validateIncomeStandard,
} from "../../features/income-standard";

function printUsage(): void {
  console.log("사용법:");
  console.log("  npx ts-node src/app/income-standard/cli.ts validate <file>");
  console.log("  npx ts-node src/app/income-standard/cli.ts install <file> [--as-latest]");
  console.log("  npx ts-node src/app/income-standard/cli.ts show [--latest | --year <YYYY>]");
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeStandard(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function parseYearFlag(args: string[]): number | null {
  const yearIndex = args.indexOf("--year");
  if (yearIndex < 0 || !args[yearIndex + 1]) {
    return null;
  }

  const parsed = Number.parseInt(args[yearIndex + 1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function commandValidate(filePath: string): number {
  if (!fs.existsSync(filePath)) {
    console.error(`[오류] 파일이 없습니다: ${filePath}`);
    return 1;
  }

  const payload = readJsonFile(filePath);
  const errors = validateIncomeStandard(payload);
  if (errors.length > 0) {
    console.error("[오류] 기준표 검증 실패:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }

  const standard = toIncomeStandard(payload);
  if (!standard) {
    console.error("[오류] 기준표 파싱 실패");
    return 1;
  }

  console.log(`검증 성공: year=${standard.year}, source=${standard.sourceUrl}`);
  return 0;
}

function commandInstall(filePath: string, asLatest: boolean): number {
  if (!fs.existsSync(filePath)) {
    console.error(`[오류] 파일이 없습니다: ${filePath}`);
    return 1;
  }

  const payload = readJsonFile(filePath);
  const errors = validateIncomeStandard(payload);
  if (errors.length > 0) {
    console.error("[오류] 기준표 검증 실패:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }

  const standard = toIncomeStandard(payload);
  if (!standard) {
    console.error("[오류] 기준표 파싱 실패");
    return 1;
  }

  const rootDir = path.resolve(process.cwd(), "data", "income-standards");
  const historyPath = path.join(rootDir, "history", `${standard.year}.json`);
  writeStandard(historyPath, standard);
  console.log(`설치 완료: ${historyPath}`);

  if (asLatest) {
    const latestPath = path.join(rootDir, "latest.json");
    writeStandard(latestPath, standard);
    console.log(`latest 갱신: ${latestPath}`);
  }

  return 0;
}

function commandShow(args: string[]): number {
  const rootDir = path.resolve(process.cwd(), "data", "income-standards");
  const latestPath = path.join(rootDir, "latest.json");
  const catalog = loadIncomeStandardCatalog(latestPath);
  const explicitLatest = args.includes("--latest");
  const year = parseYearFlag(args);

  if (explicitLatest || year === null) {
    if (!catalog.latest) {
      console.error("[오류] latest 기준표가 없습니다.");
      return 1;
    }
    console.log(JSON.stringify(catalog.latest, null, 2));
    return 0;
  }

  const standard = catalog.byYear[year];
  if (!standard) {
    console.error(`[오류] ${year}년 기준표가 없습니다.`);
    return 1;
  }

  console.log(JSON.stringify(standard, null, 2));
  return 0;
}

function main(): number {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    printUsage();
    return 1;
  }

  if (command === "validate") {
    if (!args[0]) {
      printUsage();
      return 1;
    }
    return commandValidate(path.resolve(process.cwd(), args[0]));
  }

  if (command === "install") {
    if (!args[0]) {
      printUsage();
      return 1;
    }
    return commandInstall(path.resolve(process.cwd(), args[0]), args.includes("--as-latest"));
  }

  if (command === "show") {
    return commandShow(args);
  }

  printUsage();
  return 1;
}

const exitCode = main();
if (exitCode !== 0) {
  process.exit(exitCode);
}
