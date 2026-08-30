// Tiny shared fetch for /api/owner/overview so the owner SHELL sidebar and the
// DASHBOARD page — which mount together on a hard load — don't each fire the same
// request (they used to, a duplicate read on every load; audit 2026-07-07). An
// in-flight/just-finished promise is shared for a few seconds, keyed by scope string;
// after the short TTL a fresh call goes out, so the 60s refreshes still get live data.
// A failed fetch is evicted immediately so we never cache an error.
import { deadline } from "@/lib/partialRead";

/** The owner Dashboard's own read. 25s: it is one scoped snapshot, not a report (owner picked item
 *  18, 2026-08-30 — it had no ceiling, so a stalled read left the sidebar and the dashboard both
 *  spinning, and the 8s share below meant every later caller waited on the same stalled promise). */
const OVERVIEW_DEADLINE_MS = 25_000;

type Entry = { at: number; p: Promise<unknown> };
const cache = new Map<string, Entry>();
const TTL_MS = 8000;

// `scp` is the caller's scope suffix (e.g. "" or "&scope=<rid>") — the SAME string both
// the shell and the dashboard already build, so identical scopes share one request.
export function fetchOwnerOverview(scp: string): Promise<unknown> {
  const key = scp || "_";
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.p;
  const sig = deadline(OVERVIEW_DEADLINE_MS);
  const p = fetch(`/api/owner/overview?_=1${scp}`, { cache: "no-store", ...(sig ? { signal: sig } : {}) }).then((r) => r.json()).then((j) => {
    // A failed request (HTTP 500) RESOLVES with an { error } body rather than rejecting, so
    // the .catch below never fires for it — evict here too, or a transient failure stays
    // cached for the TTL and blocks manual-refresh retries for up to 8s (audit 2026-07-09).
    if (j && typeof j === "object" && (j as { error?: unknown }).error) {
      if (cache.get(key)?.p === p) cache.delete(key);
    }
    return j;
  });
  cache.set(key, { at: now, p });
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key); });
  return p;
}
