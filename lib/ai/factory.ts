import { serverEnv } from "@/lib/config";
import { AnthropicProvider } from "./client";
import { GeminiProvider } from "./gemini";
import { MockAiProvider } from "./mock";
import type { AiProvider } from "./provider";

let cached: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const env = serverEnv();
  // lib/config already refuses AI_PROVIDER=anthropic|gemini without its key.
  if (env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) {
    cached = new AnthropicProvider(env.ANTHROPIC_API_KEY);
  } else if (env.AI_PROVIDER === "gemini" && env.GEMINI_API_KEY) {
    cached = new GeminiProvider({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      fallbackModel: env.GEMINI_FALLBACK_MODEL,
    });
  } else {
    cached = new MockAiProvider();
  }
  return cached;
}
