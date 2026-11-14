import type { AiProvider, AiRequest, AiResponse } from "./provider";

/**
 * Google Gemini over its REST API (D-039). Plain fetch, so no new dependency. Server-side only.
 *
 * The services pass Claude model ids; this provider ignores them and uses its configured
 * model, because the three calls are short structured extractions a Flash model handles.
 * The free tier often answers 503 "high demand", so when the main model is still busy after
 * its retries, the call moves to the fallback model rather than failing the run.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;
/** 429 and 5xx retry twice with backoff, matching the Anthropic SDK's default behaviour. */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 2_000;

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiBody {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Tried when `model` is still rate-limited or unavailable after its retries. */
  fallbackModel?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: GeminiOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: req.maxTokens,
        responseMimeType: "application/json",
        // Thinking tokens would count against the tight output cap, as with Claude (D-021).
        // `thinkingBudget: 0` is rejected by the lite models; "minimal" works on all current ones.
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    });

    const data = await this.postWithFallback(body);
    const blocked = data.promptFeedback?.blockReason;
    const candidate = data.candidates?.[0];
    if (blocked !== undefined || candidate?.finishReason === "SAFETY") {
      throw new Error("The AI declined this request.");
    }
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => p.thought !== true && typeof p.text === "string")
      .map((p) => p.text)
      .join("");

    const usage = data.usageMetadata ?? {};
    const cached = usage.cachedContentTokenCount ?? 0;
    return {
      text,
      model: data.modelVersion ?? data.requestedModel,
      inputTokens: Math.max(0, (usage.promptTokenCount ?? 0) - cached),
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
    };
  }

  private async postWithFallback(body: string): Promise<GeminiBody & { requestedModel: string }> {
    const models = [this.opts.model, this.opts.fallbackModel].filter(
      (m, i, all): m is string => m !== undefined && m !== "" && all.indexOf(m) === i,
    );
    let lastError: Error | null = null;
    for (const model of models) {
      try {
        return { ...(await this.post(model, body)), requestedModel: model };
      } catch (err) {
        if (!(err instanceof BusyError)) throw err;
        lastError = err;
      }
    }
    throw lastError ?? new Error("The AI service is busy.");
  }

  private async post(model: string, body: string): Promise<GeminiBody> {
    const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          // Key in a header, never in the URL.
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.opts.apiKey },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
      } catch {
        if (attempt < MAX_ATTEMPTS) {
          await this.sleep(RETRY_BASE_MS * attempt);
          continue;
        }
        throw new BusyError("The AI service did not respond in time.");
      }
      if (res.ok) return (await res.json()) as GeminiBody;
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_ATTEMPTS) {
        await this.sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      // Status only: Google's error body can echo the request, which contains comments.
      if (retryable) throw new BusyError(`The AI service returned HTTP ${res.status}.`);
      throw new Error(`The AI service returned HTTP ${res.status}.`);
    }
  }
}

/** Rate-limited, overloaded or timed out: worth trying the fallback model. */
class BusyError extends Error {}
