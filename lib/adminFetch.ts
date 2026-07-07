// adminFetch — the one safe way for admin pages to call the server, so a page can never
// "fail silently" again (audit 2026-07-07). It ALWAYS returns a tagged result: either
// { ok:true, data } or { ok:false, error }. It treats a non-2xx response, a JSON body with
// an `error` field, or a thrown network error all as failures with a readable message — so
// callers just check `res.ok` and show `res.error` (usually via useToast), never guessing.
export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function adminFetch<T = unknown>(url: string, opts?: RequestInit): Promise<AdminResult<T>> {
  try {
    const r = await fetch(url, { cache: "no-store", ...opts });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* non-JSON response */ }
    const err = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : null;
    if (!r.ok || err) return { ok: false, error: err || `Request failed (${r.status})`, status: r.status };
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error", status: 0 };
  }
}
