import { describe, expect, it } from "vitest";
import { GeminiProvider } from "./gemini";
import type { AiRequest } from "./provider";

const REQ: AiRequest = {
  purpose: "themes",
  model: "claude-haiku-5-5",
  system: "Reply with JSON only.",
  messages: [
    { role: "user", content: "first" },
    { role: "assistant", content: "{}" },
    { role: "user", content: "again" },
  ],
  maxTokens: 500,
  mockResponse: () => ({}),
};

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("GeminiProvider", () => {
  it("sends the key in a header, maps roles, asks for JSON, and reads text and usage", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const provider = new GeminiProvider({
      apiKey: "g-key",
      model: "gemini-2.5-flash",
      fetch: async (url, init) => {
        seenUrl = String(url);
        seenInit = init;
        return ok({
          candidates: [{ content: { parts: [{ text: '{"a":' }, { text: "1}" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, cachedContentTokenCount: 20 },
          modelVersion: "gemini-2.5-flash",
        });
      },
    });
    const res = await provider.complete(REQ);

    expect(seenUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(seenUrl).not.toContain("g-key");
    expect(new Headers(seenInit?.headers).get("x-goog-api-key")).toBe("g-key");
    const body = JSON.parse(String(seenInit?.body));
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 500, responseMimeType: "application/json" });
    expect(res).toEqual({
      text: '{"a":1}',
      model: "gemini-2.5-flash",
      inputTokens: 100,
      outputTokens: 30,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
    });
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    let calls = 0;
    const provider = new GeminiProvider({
      apiKey: "k",
      model: "m",
      sleep: async () => {},
      fetch: async () => {
        calls++;
        if (calls === 1) return ok({}, 429);
        if (calls === 2) return ok({}, 503);
        return ok({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
      },
    });
    await expect(provider.complete(REQ)).resolves.toMatchObject({ text: "{}" });
    expect(calls).toBe(3);
  });

  it("does not retry a 400 and does not echo the error body", async () => {
    let calls = 0;
    const provider = new GeminiProvider({
      apiKey: "k",
      model: "m",
      sleep: async () => {},
      fetch: async () => {
        calls++;
        return ok({ error: { message: "comment text echoed here" } }, 400);
      },
    });
    await expect(provider.complete(REQ)).rejects.toThrow("The AI service returned HTTP 400.");
    expect(calls).toBe(1);
  });

  it("treats a blocked prompt as a refusal", async () => {
    const provider = new GeminiProvider({
      apiKey: "k",
      model: "m",
      fetch: async () => ok({ promptFeedback: { blockReason: "SAFETY" } }),
    });
    await expect(provider.complete(REQ)).rejects.toThrow("The AI declined this request.");
  });
});

describe("GeminiProvider fallback", () => {
  it("moves to the fallback model when the main one stays busy, and reports that model", async () => {
    const seen: string[] = [];
    const provider = new GeminiProvider({
      apiKey: "k",
      model: "main",
      fallbackModel: "lite",
      sleep: async () => {},
      fetch: async (url) => {
        seen.push(String(url).split("/models/")[1] ?? "");
        return String(url).includes("/main:")
          ? ok({}, 503)
          : ok({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
      },
    });
    const res = await provider.complete(REQ);
    expect(seen).toEqual([
      "main:generateContent",
      "main:generateContent",
      "main:generateContent",
      "lite:generateContent",
    ]);
    expect(res.model).toBe("lite");
  });

  it("does not fall back on a non-retryable error", async () => {
    let calls = 0;
    const provider = new GeminiProvider({
      apiKey: "k",
      model: "main",
      fallbackModel: "lite",
      fetch: async () => {
        calls++;
        return ok({}, 403);
      },
    });
    await expect(provider.complete(REQ)).rejects.toThrow("HTTP 403");
    expect(calls).toBe(1);
  });
});
