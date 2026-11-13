import type { AiPurpose } from "@/lib/repositories";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiRequest {
  purpose: AiPurpose;
  model: string;
  /** Stable prefix: role, rules, schema, worked example. Cached by the Anthropic provider. */
  system: string;
  /** Per-request data comes last so the cached prefix keeps hitting. */
  messages: AiMessage[];
  maxTokens: number;
  /** What the mock provider returns. Built deterministically from the same input data. */
  mockResponse: () => unknown;
}

export interface AiResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AiProvider {
  readonly name: "anthropic" | "mock";
  complete(req: AiRequest): Promise<AiResponse>;
}
