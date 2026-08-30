// adminFetch — the one safe way for admin pages to call the server, so a page can never
// "fail silently" again (audit 2026-07-07). It ALWAYS returns a tagged result: either
// { ok:true, data } or { ok:false, error }. It treats a non-2xx response, a JSON body with
// an `error` field, or a thrown network error all as failures with a readable message — so
// callers just check `res.ok` and show `res.error` (usually via useToast), never guessing.
import { deadline, isDeadline, TOOK_TOO_LONG } from "@/lib/partialRead";

export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** How long an admin screen waits for our own server before it says so. Generous — some admin reads
 *  genuinely assemble a lot — and finite, which is the point: it had no ceiling at all, so a read
 *  that never came back left the console spinning for ever (owner picked item 18, 2026-08-30). */
const ADMIN_DEADLINE_MS = 30_000;

export async function adminFetch<T = unknown>(url: string, opts?: RequestInit): Promise<AdminResult<T>> {
  try {
    // A caller's OWN signal always wins — some admin screens cancel a read when the person moves on,
    // and replacing their signal would break that.
    const signal = opts?.signal ?? deadline(ADMIN_DEADLINE_MS);
    const r = await fetch(url, { cache: "no-store", ...opts, ...(signal ? { signal } : {}) });
    let body: unknown = null;
    try { body = await r.json(); } catch { /* non-JSON response */ }
    const err = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : null;
    if (!r.ok || err) return { ok: false, error: err || `Request failed (${r.status})`, status: r.status };
    return { ok: true, data: body as T };
  } catch (e) {
    // A DEADLINE is not a network error, and saying "Network error" for it sends a person to look at
    // their wifi for something that left the device perfectly well.
    if (isDeadline(e)) return { ok: false, error: TOOK_TOO_LONG, status: 0 };
    return { ok: false, error: e instanceof Error ? e.message : "Network error", status: 0 };
  }
}
