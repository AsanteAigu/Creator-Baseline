import { execSync } from "node:child_process";

/** Fresh schema + seed in the test database before the suite. */
export default function setup(): void {
  const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
  execSync("pnpm exec tsx scripts/migrate.ts --reset", { env, stdio: "inherit" });
  execSync("pnpm exec tsx scripts/seed.ts", { env, stdio: "inherit" });
}
