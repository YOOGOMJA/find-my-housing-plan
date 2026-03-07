import { loadCurrentEnvMap, writeEnv, ENV_PATH } from "../../features/env-setup/lib/env-file";
import { parseSectionsFromArg } from "../../features/env-setup/lib/helpers";
import { EnvUpdates, PromptCancelledError } from "../../features/env-setup/model/types";
import { askSections, promptFilter, promptProfile } from "../../features/env-setup/ui/prompts";

async function main(): Promise<void> {
  const chalk = (await import("chalk")).default;
  const env = loadCurrentEnvMap();

  const sections = parseSectionsFromArg(process.argv[2]) ?? (await askSections());
  const updates: EnvUpdates = {};

  if (sections.includes("profile")) {
    console.log(chalk.cyan("\n[1] 기본 자격 설정"));
    Object.assign(updates, await promptProfile(env));
  }

  if (sections.includes("filter")) {
    const sectionIndex = sections.includes("profile") ? 2 : 1;
    console.log(chalk.cyan(`\n[${sectionIndex}] 필터 설정`));
    Object.assign(updates, await promptFilter({ ...env, ...updates }));
  }

  writeEnv(updates);

  console.log(chalk.green("\n.env 저장 완료"));
  console.log(chalk.gray(`- 파일: ${ENV_PATH}`));
  console.log(chalk.gray(`- 반영 키 수: ${Object.keys(updates).length}`));
}

main().catch((error: unknown) => {
  if (error instanceof PromptCancelledError) {
    console.log("[env-setup] 설정이 취소되어 변경사항을 저장하지 않았습니다.");
    process.exit(0);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`[env-setup] 오류: ${message}`);
  process.exit(1);
});
