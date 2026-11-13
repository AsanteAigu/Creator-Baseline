import { InstagramError } from "./types";

/**
 * Thin HTTP layer for the Graph API (BUILD_PROMPT §6): one request at a time, a timeout on
 * each, exponential backoff for 429/5xx/network failures, and pacing driven by Meta's own
 * usage headers. Tokens travel in the Authorization header, never in a URL we build, and no
 * URL, header or response body is ever logged.
 */

export const GRAPH_API_VERSION = "v27.0";
export const GRAPH_HOST = "https://graph.facebook.com";

/** Meta throttling codes: app (4), user (17), page (32), custom (613), Instagram BUC (80002). */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80002]);
/** Token invalid or expired (190), session/permission problems (102, 10, 200-299). */
const AUTH_CODES = new Set([102, 190, 10]);
/** Meta's own "unknown"/"service" errors are transient. */
const TRANSIENT_CODES = new Set([1, 2]);

export interface GraphClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Pause between consecutive calls even when usage is low. */
  minIntervalMs?: number;
}

interface GraphErrorBody {
  error?: { code?: unknown; error_subcode?: unknown; type?: unknown };
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly minIntervalMs: number;
  /** Highest usage percentage Meta last reported for this app/account. */
  private usagePct = 0;
  private lastCallAt = 0;

  constructor(opts: GraphClientOptions = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? realSleep;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.baseDelayMs = opts.baseDelayMs ?? 1_000;
    this.minIntervalMs = opts.minIntervalMs ?? 250;
  }

  /** `path` is either a Graph path (`/me/accounts`) or a `paging.next` URL Meta gave us. */
  async get(path: string, params: Record<string, string>, token: string | null): Promise<unknown> {
    return this.request(this.buildUrl(path, params), this.headers(token), "GET");
  }

  /** Used only to revoke a token at Meta when an account is disconnected (D-033). */
  async delete(path: string, params: Record<string, string>, token: string): Promise<unknown> {
    return this.request(this.buildUrl(path, params), this.headers(token), "DELETE");
  }

  private buildUrl(path: string, params: Record<string, string>): URL {
    const url = path.startsWith("https://") ? new URL(path) : new URL(`${GRAPH_HOST}/${GRAPH_API_VERSION}${path}`);
    if (url.origin !== GRAPH_HOST) throw new InstagramError("Instagram returned an unexpected link.", "PERMANENT", false);
    // Paging links can echo a token back; ours goes in the header only.
    url.searchParams.delete("access_token");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url;
  }

  private headers(token: string | null): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  private async request(url: URL, headers: Record<string, string>, method: "GET" | "DELETE"): Promise<unknown> {
    let lastError: InstagramError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(this.baseDelayMs * 2 ** (attempt - 1), 8_000);
        await this.sleep(backoff + Math.floor(Math.random() * 250));
      }
      await this.pace();
      try {
        return await this.once(url, headers, method);
      } catch (err) {
        if (!(err instanceof InstagramError) || !err.retryable) throw err;
        lastError = err;
      }
    }
    throw lastError ?? new InstagramError("Instagram is not responding.", "UNAVAILABLE", true);
  }

  private async pace(): Promise<void> {
    if (this.usagePct >= 100) {
      throw new InstagramError("Instagram's rate limit for this app has been reached.", "RATE_LIMITED", true);
    }
    // Slow down progressively above 75% of the allowance instead of running into the wall.
    const extra = this.usagePct > 75 ? Math.round(((this.usagePct - 75) / 25) * 5_000) : 0;
    const wait = this.lastCallAt + this.minIntervalMs + extra - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastCallAt = Date.now();
  }

  private async once(url: URL, headers: Record<string, string>, method: "GET" | "DELETE"): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, signal: AbortSignal.timeout(this.timeoutMs), cache: "no-store" });
    } catch {
      throw new InstagramError("Instagram did not respond in time.", "UNAVAILABLE", true);
    }
    this.readUsage(res.headers);

    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return body;

    const error = (body as GraphErrorBody | null)?.error;
    const code = typeof error?.code === "number" ? error.code : null;
    if (res.status === 429 || (code !== null && RATE_LIMIT_CODES.has(code))) {
      throw new InstagramError("Instagram is limiting requests right now.", "RATE_LIMITED", true);
    }
    if (code !== null && (AUTH_CODES.has(code) || (code >= 200 && code <= 299))) {
      throw new InstagramError("Instagram needs this account to be reconnected.", "AUTH", false);
    }
    if (res.status >= 500 || (code !== null && TRANSIENT_CODES.has(code))) {
      throw new InstagramError("Instagram had a temporary problem.", "UNAVAILABLE", true);
    }
    throw new InstagramError(`Instagram refused the request (HTTP ${res.status}, code ${code ?? "none"}).`, "PERMANENT", false);
  }

  /** Reads X-App-Usage and X-Business-Use-Case-Usage; either may be absent. */
  private readUsage(headers: Headers): void {
    let pct = 0;
    const app = parseJson(headers.get("x-app-usage"));
    if (app && typeof app === "object") pct = Math.max(pct, ...usageNumbers(app as Record<string, unknown>));
    const buc = parseJson(headers.get("x-business-use-case-usage"));
    if (buc && typeof buc === "object") {
      for (const entries of Object.values(buc as Record<string, unknown>)) {
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
          if (!e || typeof e !== "object") continue;
          const rec = e as Record<string, unknown>;
          pct = Math.max(pct, ...usageNumbers(rec));
          // Meta says when access returns; any wait at all means we're throttled now.
          if (typeof rec.estimated_time_to_regain_access === "number" && rec.estimated_time_to_regain_access > 0) {
            pct = Math.max(pct, 100);
          }
        }
      }
    }
    this.usagePct = pct;
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function usageNumbers(rec: Record<string, unknown>): number[] {
  return [rec.call_count, rec.total_cputime, rec.total_time].filter((v): v is number => typeof v === "number");
}
