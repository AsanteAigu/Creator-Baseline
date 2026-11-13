import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, AiRequest, AiResponse } from "./provider";

/** The only file that imports the Anthropic SDK (enforced by ESLint). Server-side only. */

export const MODELS = {
  /** Comment themes: high volume, simple extraction. */
  themes: "claude-haiku-5-5",
  /** Report + plan: needs judgement over the scored data. */
  report: "claude-sonnet-5-5",
  plan: "claude-sonnet-5-5",
} as const;

const TIMEOUT_MS = 60_000;

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    // SDK retries 408/409/429/5xx twice by default; that is the backoff we want here.
    this.client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    // These are short structured extractions with tight max_tokens; thinking tokens would
    // count against that cap, so thinking is switched off in the way each model accepts.
    const isHaiku = req.model.startsWith("claude-haiku");
    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: req.messages,
      thinking: isHaiku ? { type: "disabled" } : { type: "between_tools" },
      output_config: { effort: isHaiku ? "low" : "medium" },
    });

    if (response.stop_reason === "refusal") {
      throw new Error("The AI declined this request.");
    }
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      text,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
  }
}
