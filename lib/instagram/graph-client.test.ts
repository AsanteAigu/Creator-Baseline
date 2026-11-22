import { describe, expect, it } from "vitest";
import { GRAPH_API_VERSION, GraphClient } from "./graph-client";
import { InstagramError } from "./types";

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler): typeof fetch {
  return async (input, init) => {
    const url = input instanceof URL ? input : typeof input === "string" ? new URL(input) : new URL(input.url);
    return handler(url, init);
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function errorBody(code: number, subcode?: number) {
  return { error: { code, error_subcode: subcode, message: "not for display" } };
}

describe("GraphClient.get", () => {
  it("builds a versioned URL and sends the token in the header, not the query", async () => {
    let seen: { url: URL; init: RequestInit | undefined } | undefined;
    const client = new GraphClient({
      fetch: fakeFetch((url, init) => {
        seen = { url, init };
        return json({ ok: true });
      }),
      sleep: async () => {},
    });

    await client.get("/me", { fields: "id" }, "tok-123");

    expect(seen?.url.origin).toBe("https://graph.facebook.com");
    expect(seen?.url.pathname).toBe(`/${GRAPH_API_VERSION}/me`);
    expect(seen?.url.searchParams.get("fields")).toBe("id");
    expect(seen?.url.searchParams.get("access_token")).toBeNull();
    expect(new Headers(seen?.init?.headers).get("authorization")).toBe("Bearer tok-123");
  });

  it("follows a paging link but strips any token Meta put in it", async () => {
    let seen: URL | undefined;
    const client = new GraphClient({
      fetch: fakeFetch((url) => {
        seen = url;
        return json({ data: [] });
      }),
      sleep: async () => {},
    });

    await client.get(`https://graph.facebook.com/${GRAPH_API_VERSION}/next?access_token=leak&after=1`, {}, "tok");

    expect(seen?.searchParams.get("access_token")).toBeNull();
    expect(seen?.searchParams.get("after")).toBe("1");
  });

  it("refuses a paging link to another host", async () => {
    let called = false;
    const client = new GraphClient({
      fetch: fakeFetch(() => {
        called = true;
        return json({});
      }),
      sleep: async () => {},
    });

    await expect(client.get("https://evil.example/steal", {}, "tok")).rejects.toMatchObject({
      code: "PERMANENT",
    });
    expect(called).toBe(false);
  });
});

describe("retries", () => {
  it("retries 5xx with exponential backoff and then succeeds", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const client = new GraphClient({
      fetch: fakeFetch(() => {
        attempts++;
        return attempts === 1 ? json({}, 503) : json({ ok: true });
      }),
      sleep: async (ms) => {
        delays.push(ms);
      },
      baseDelayMs: 1_000,
    });

    await expect(client.get("/me", {}, "tok")).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
    // Backoff plus up to 250 ms of jitter.
    expect(delays[0]).toBeGreaterThanOrEqual(1_000);
    expect(delays[0]).toBeLessThanOrEqual(1_250);
  });

  it("retries 429 and network failures", async () => {
    let attempts = 0;
    const client = new GraphClient({
      fetch: fakeFetch(() => {
        attempts++;
        if (attempts === 1) return json({}, 429);
        if (attempts === 2) throw new TypeError("network down");
        return json({ ok: true });
      }),
      sleep: async () => {},
      maxAttempts: 4,
    });

    await expect(client.get("/me", {}, "tok")).resolves.toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  it("gives up with UNAVAILABLE after the last attempt", async () => {
    let attempts = 0;
    const client = new GraphClient({
      fetch: fakeFetch(() => {
        attempts++;
        return json({}, 500);
      }),
      sleep: async () => {},
      maxAttempts: 3,
    });

    await expect(client.get("/me", {}, "tok")).rejects.toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
    expect(attempts).toBe(3);
  });
});

describe("error mapping", () => {
  it("turns a 190 into AUTH, which is not retried", async () => {
    let attempts = 0;
    const client = new GraphClient({
      fetch: fakeFetch(() => {
        attempts++;
        return json(errorBody(190), 400);
      }),
      sleep: async () => {},
    });

    await expect(client.get("/me", {}, "tok")).rejects.toMatchObject({
      code: "AUTH",
      retryable: false,
    });
    expect(attempts).toBe(1);
  });

  it("treats other 4xx as permanent and does not leak the body", async () => {
    const client = new GraphClient({
      fetch: fakeFetch(() => json(errorBody(100), 400)),
      sleep: async () => {},
    });

    const err = await client.get("/me", {}, "tok").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstagramError);
    expect(err).toMatchObject({ code: "PERMANENT", retryable: false });
    expect((err as Error).message).not.toContain("not for display");
  });

  it("maps usage-limit codes to RATE_LIMITED", async () => {
    let attempts = 0;
    const client = new GraphClient({
      fetch: fakeFetch(() => {
        attempts++;
        return json(errorBody(4), 400);
      }),
      sleep: async () => {},
      maxAttempts: 2,
    });

    await expect(client.get("/me", {}, "tok")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(attempts).toBe(2);
  });
});

describe("usage headers", () => {
  it("refuses to call again once Meta reports 100%", async () => {
    let calls = 0;
    const client = new GraphClient({
      fetch: fakeFetch(() => {
        calls++;
        return json({ ok: true }, 200, { "x-app-usage": JSON.stringify({ call_count: 100 }) });
      }),
      sleep: async () => {},
    });

    await client.get("/me", {}, "tok");
    await expect(client.get("/me", {}, "tok")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(calls).toBe(1);
  });

  it("treats an estimated wait in the business-use-case header as throttled", async () => {
    let calls = 0;
    const client = new GraphClient({
      fetch: fakeFetch(() => {
        calls++;
        return json({ ok: true }, 200, {
          "x-business-use-case-usage": JSON.stringify({
            123: [{ call_count: 10, estimated_time_to_regain_access: 6 }],
          }),
        });
      }),
      sleep: async () => {},
    });

    await client.get("/me", {}, "tok");
    await expect(client.get("/me", {}, "tok")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(calls).toBe(1);
  });

  it("slows down progressively above 75%", async () => {
    const delays: number[] = [];
    let calls = 0;
    const client = new GraphClient({
      fetch: fakeFetch(() => {
        calls++;
        return json({ ok: true }, 200, { "x-app-usage": JSON.stringify({ call_count: 80 }) });
      }),
      sleep: async (ms) => {
        delays.push(ms);
      },
      minIntervalMs: 0,
    });

    await client.get("/me", {}, "tok");
    await client.get("/me", {}, "tok");
    expect(calls).toBe(2);
    // About 1 s at 80%: (80 - 75) / 25 * 5 s, minus the milliseconds already elapsed.
    expect(delays.some((ms) => ms >= 900)).toBe(true);
  });
});
