import { serverEnv } from "@/lib/config";
import { AppError } from "@/lib/errors";

/**
 * Fixed-window rate limit per key. Upstash Redis (REST) when configured — required in
 * production by lib/config — otherwise an in-process map, which is fine for one dev server.
 */

const memory = new Map<string, { count: number; resetAt: number }>();

async function incrementUpstash(url: string, token: string, key: string, windowSec: number): Promise<number> {
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, String(windowSec), "NX"],
    ]),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`rate limiter returned ${res.status}`);
  const body = (await res.json()) as { result: unknown }[];
  return Number(body[0]?.result ?? 0);
}

function incrementMemory(key: string, windowSec: number): number {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

export async function enforceRateLimit(key: string, limit: number, windowSec: number): Promise<void> {
  const env = serverEnv();
  const namespaced = `cb:rl:${key}`;
  const count =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? await incrementUpstash(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN, namespaced, windowSec)
      : incrementMemory(namespaced, windowSec);
  if (count > limit) {
    throw new AppError("RATE_LIMITED", "That was a lot of requests in a short time. Please wait a few minutes.");
  }
}
