import { config as loadDotenv } from "dotenv";

// Scripts run outside Next, so load the same files Next would, most specific first.
loadDotenv({ path: ".env.local", quiet: true });
loadDotenv({ path: ".env", quiet: true });

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }
  return url;
}
