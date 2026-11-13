import type { AiProvider, AiRequest, AiResponse } from "./provider";

/**
 * AI_PROVIDER=mock. Returns the request's own deterministic, schema-valid fixture, so the
 * whole product builds, tests and demos with zero API spend. It still flows through
 * generateStructured, so parsing and validation are exercised exactly as in production.
 */
export class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;

  async complete(req: AiRequest): Promise<AiResponse> {
    return {
      text: JSON.stringify(req.mockResponse()),
      model: "mock",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
  }
}
