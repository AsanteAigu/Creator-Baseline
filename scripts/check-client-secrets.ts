/**
 * SPECIFICATION §11 / acceptance criterion 9: no secret may reach the client bundle.
 *
 * Scans `.next/static` for the names of server-only variables *and* for their values when
 * they are present in this environment. Run after `pnpm build` (CI: build then this).
 *
 *   pnpm check:secrets
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const STATIC_DIR = path.join(process.cwd(), ".next", "static");

/** Server-only variables that must never be referenced from client code. */
const SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "INSTAGRAM_APP_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
];

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (/\.(js|mjs|css|map|json|html)$/.test(entry.name)) files.push(full);
  }
  return files;
}

async function main(): Promise<void> {
  let files: string[];
  try {
    files = await walk(STATIC_DIR);
  } catch {
    console.error("No .next/static directory. Run `pnpm build` first.");
    process.exit(1);
  }

  // Only values long enough to be meaningful; an empty or placeholder value is not a leak.
  const secretValues = SECRET_NAMES.map((name) => process.env[name]).filter(
    (value): value is string => typeof value === "string" && value.length >= 12,
  );

  const problems: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const names = SECRET_NAMES.filter((name) => text.includes(name));
    // Never print the value itself, only that a value was found.
    const values = secretValues.filter((value) => text.includes(value));
    if (names.length > 0 || values.length > 0) {
      const relative = path.relative(process.cwd(), file);
      problems.push(`${relative}: ${[...names, ...values.map(() => "secret value")].join(", ")}`);
    }
  }

  if (problems.length > 0) {
    console.error("Server-only secrets appear in the client bundle:");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  console.log(`Checked ${files.length} client files: no server-only secret names or values.`);
}

await main();
