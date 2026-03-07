import { runMain } from "./app/main";

runMain().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[오류] ${message}`);
  process.exit(1);
});
