import { execSync } from "node:child_process";

/**
 * Supabase settings that must never reach the test run: with them set, the seed creates its
 * demo users in that Supabase project rather than the local test database's auth shim. This
 * happened once (14 Nov 2026) when .env.local pointed at the live project.
 */
export const LIVE_ONLY_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

/** Fresh schema + seed in the test database before the suite. */
export default function setup(): void {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
  // Empty, not deleted: the scripts load .env.local, which only fills variables that are unset.
  for (const key of LIVE_ONLY_VARS) env[key] = "";
  execSync("pnpm exec tsx scripts/migrate.ts --reset", { env, stdio: "inherit" });
  execSync("pnpm exec tsx scripts/seed.ts", { env, stdio: "inherit" });
}
