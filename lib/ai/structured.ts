import type { z } from "zod";
import type { AiProvider, AiRequest, AiResponse } from "./provider";

/** Thrown when the model's output still fails validation after the one retry. */
export class AiOutputError extends Error {
  constructor(
    readonly purpose: string,
    readonly issues: string,
  ) {
    super(`AI ${purpose} output failed validation`);
    this.name = "AiOutputError";
  }
}

export interface StructuredCall {
  provider: AiProvider;
  request: Omit<AiRequest, "messages"> & { user: string };
  /** Called once per attempt, success or failure (the cost ledger). */
  onAttempt?: (attempt: { response: AiResponse | null; latencyMs: number; ok: boolean }) => Promise<void>;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
}

/** Strips markdown fences and anything around the outermost JSON object. */
export function extractJson(text: string): string {
  const unfenced = text.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

function parse<T>(schema: z.ZodType<T>, text: string): Parsed<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, error: "The reply was not valid JSON." };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .slice(0, 10)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: issues };
}

/**
 * The only place a model response is parsed. JSON-only instruction lives in each system
 * prompt; here: strip fences, validate with Zod, retry once feeding the validation error
 * back, then throw AiOutputError.
 */
export async function generateStructured<T>(schema: z.ZodType<T>, call: StructuredCall): Promise<StructuredResult<T>> {
  const { provider, request, onAttempt } = call;
  const messages: AiRequest["messages"] = [{ role: "user", content: request.user }];
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = Date.now();
    let response: AiResponse;
    try {
      response = await provider.complete({ ...request, messages });
    } catch (err) {
      await onAttempt?.({ response: null, latencyMs: Date.now() - started, ok: false });
      throw err;
    }

    const parsed = parse(schema, response.text);
    await onAttempt?.({ response, latencyMs: Date.now() - started, ok: parsed.ok });
    if (parsed.ok) return { data: parsed.data, model: response.model };

    lastError = parsed.error;
    messages.push(
      { role: "assistant", content: response.text },
      {
        role: "user",
        content: `Your reply did not match the required JSON schema: ${parsed.error}. Reply again with only the corrected JSON object.`,
      },
    );
  }

  throw new AiOutputError(request.purpose, lastError);
}
