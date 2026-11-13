/** Browser-side fetch helper that unwraps the standard error shape into a readable message. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string; fields?: Record<string, string> };

export async function callApi<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 204) return { ok: true, data: undefined as T };
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    const err = (body as { error?: { message?: string; fields?: Record<string, string> } } | null)?.error;
    return { ok: false, message: err?.message ?? "Something went wrong. Please try again.", fields: err?.fields };
  } catch {
    return { ok: false, message: "We couldn't reach the server. Check your connection and try again." };
  }
}
