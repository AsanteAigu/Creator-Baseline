import { serverEnv } from "@/lib/config";
import { AnthropicProvider } from "./client";
import { MockAiProvider } from "./mock";
import type { AiProvider } from "./provider";

let cached: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const env = serverEnv();
  // lib/config already refuses AI_PROVIDER=anthropic without a key.
  cached =
    env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY
      ? new AnthropicProvider(env.ANTHROPIC_API_KEY)
      : new MockAiProvider();
  return cached;
}
