// Compute-on-view snapshot cache for the owner cockpit's expensive reads (migration 196).
//
// A normal page open reads ONE finished-JSON row instead of re-running multi-scan report
// RPCs — instant, near-zero egress, far less DB work. The heavy compute runs only when:
//   • the cache is cold (first ever view of this scope+report+range), or
//   • the caller forces it (the Refresh button → ?refresh=1 → "wait for the live value"), or
//   • a keep-warm pass recomputes a recently-viewed key (guarded by the fingerprint).
// Nothing here weakens isolation: the key is built from the ALREADY-authorized scope
// (lib/ownerScope), so an owner can only ever hit their own restaurants' cache rows.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

const TABLE = "owner_analytics_cache";

// The set of restaurants a cached read covers → a stable key part. `null` ids = admin
// whole-platform view. A real owner's set is sorted so member order never splits the key.
export function scopeKeyOf(rid: string | null, all: boolean, ids: string[]): string {
  if (rid) return `r:${rid}`;
  if (all) return "all";
  return "s:" + [...ids].sort().join(",");
}

export type Cached<T> = T & { cachedAt: string; cached: boolean };

const DEFAULT_MAX_AGE_SEC = 300; // ~5 min: within this a view is a pure single-row read

// Serve `key` from the cache; recompute only when needed. Behaviour:
//   • fresh (computed < maxAgeSec ago) and not forced → return stored JSON (one row read).
//   • stale (older than maxAgeSec) and not forced → check the cheap `fingerprint`; if it
//     matches the stored one, NOTHING changed → just bump the timestamp and reuse the JSON
//     (no heavy recompute — the owner's "don't recalc if nothing changed"). If it differs,
//     recompute.
//   • forced (Refresh button) → always recompute the live value.
//   • cold (no row) → compute once.
// `compute` may throw — nothing is stored on failure and the caller's try/catch surfaces the
// error (so a timeout never poisons the cache).
export async function cachedOwnerPayload<T extends object>(opts: {
  key: string;
  force?: boolean;
  maxAgeSec?: number;
  fingerprint?: () => Promise<string | null>;
  compute: () => Promise<T>;
}): Promise<Cached<T>> {
  const { key, force, fingerprint, compute } = opts;
  const maxAgeMs = (opts.maxAgeSec ?? DEFAULT_MAX_AGE_SEC) * 1000;
  const nowIso = () => new Date().toISOString();

  const existing = force ? null
    : (await sb.from(TABLE).select("payload, computed_at, fingerprint").eq("cache_key", key).maybeSingle()).data;

  if (existing?.payload) {
    const fresh = Date.now() - Date.parse(existing.computed_at as string) < maxAgeMs;
    if (fresh) {
      void sb.from(TABLE).update({ last_viewed_at: nowIso() }).eq("cache_key", key).then(() => {}, () => {});
      return { ...(existing.payload as T), cachedAt: existing.computed_at as string, cached: true };
    }
    // stale → only recompute if something actually changed (cheap fingerprint check).
    if (fingerprint) {
      const fp = await fingerprint().catch(() => null);
      if (fp && fp === existing.fingerprint) {
        const now = nowIso();
        void sb.from(TABLE).update({ computed_at: now, last_viewed_at: now }).eq("cache_key", key).then(() => {}, () => {});
        return { ...(existing.payload as T), cachedAt: now, cached: true };
      }
    }
  }

  const payload = await compute();
  let fp: string | null = null;
  try { fp = fingerprint ? await fingerprint() : null; } catch { fp = null; }
  const now = nowIso();
  await sb.from(TABLE).upsert(
    { cache_key: key, payload, fingerprint: fp, computed_at: now, last_viewed_at: now },
    { onConflict: "cache_key" },
  );
  return { ...payload, cachedAt: now, cached: false };
}

// Cheap change-detector for a scope+window (migration 196 SQL fn). Returns null on error so
// a fingerprint failure just means "treat as changed" (safe: at worst a needless recompute).
export async function ordersFingerprint(ids: string[] | null, from: string, to: string): Promise<string | null> {
  const { data, error } = await sb.rpc("lfh_owner_orders_fingerprint", { p_ids: ids, p_from: from, p_to: to });
  if (error) return null;
  return typeof data === "string" ? data : null;
}
