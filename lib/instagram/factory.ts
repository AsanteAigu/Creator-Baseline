import { serverEnv } from "@/lib/config";
import { MockInstagramSource } from "./mock-source";
import type { InstagramSource } from "./types";

export function createInstagramSource(): InstagramSource {
  const env = serverEnv();
  if (env.INSTAGRAM_SOURCE === "mock") return new MockInstagramSource();
  // The Graph API adapter is Phase 5. Failing loudly beats silently serving fixtures.
  throw new Error("INSTAGRAM_SOURCE=graph is not available yet; use INSTAGRAM_SOURCE=mock.");
}
