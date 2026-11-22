/**
 * Local demo: runs the app against a separate local database filled with the demo agency,
 * with mock Instagram and mock AI, without touching .env.local's live settings.
 *
 *   pnpm demo           start the dev server on the demo data (sets it up on first run)
 *   pnpm demo --reset   rebuild the demo data first (fresh posts dated around today)
 *
 * Sign in as owner@demo.agency / creator-baseline-demo.
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import "./env";

const url = process.env.DEMO_DATABASE_URL?.trim();
if (!url) {
  console.error(
    "DEMO_DATABASE_URL is not set. Add a local database to .env.local, e.g.\n" +
      "DEMO_DATABASE_URL=postgres://postgres:password@localhost:5432/creator_baseline_demo",
  );
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  // The demo resets and seeds this database; never let that reach a hosted one.
  console.error(`Refusing to run the demo against ${host}: DEMO_DATABASE_URL must be a local database.`);
  process.exit(1);
}

// Empty, not deleted: Next and the scripts only fill variables from .env.local that are unset.
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: url,
  INSTAGRAM_SOURCE: "mock",
  AI_PROVIDER: "mock",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  INNGEST_EVENT_KEY: "",
  INNGEST_SIGNING_KEY: "",
  GEMINI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
};

const root = process.cwd();
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
const run = (script: string, ...args: string[]) =>
  execFileSync(process.execPath, [tsx, path.join("scripts", script), ...args], { env, stdio: "inherit" });

async function hasDemoData(): Promise<boolean> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url!, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from public.creators`;
    return (row?.n ?? 0) > 0;
  } catch {
    return false; // no schema yet
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--reset") || !(await hasDemoData())) {
    console.log("Setting up the demo data…");
    run("migrate.ts", "--reset");
    run("seed.ts");
    run("ingest.ts");
  }
  console.log("\nDemo ready: http://localhost:3000  (owner@demo.agency / creator-baseline-demo)\n");
  const child = spawn(process.execPath, [next, "dev", "-p", "3000"], { env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
