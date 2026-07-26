// Compute-on-view snapshot cache for the owner cockpit's expensive reads (migration 196).
//
// STALE-WHILE-REVALIDATE: a page open reads ONE finished-JSON row and returns it INSTANTLY —
// even when it's a little stale — then refreshes the snapshot in the BACKGROUND (Next's
// `after()`, which runs work after the response is already sent) so the NEXT view is fresh.
// The user therefore never waits, except the very first cold view of a scope+report+range.
// This realises the owner's "recompute every ~5 min" idea without any external scheduler and
// with ZERO wasted work on dashboards nobody is looking at — only viewed keys refresh, and
// only when their cheap fingerprint shows the data actually changed.
//
// Isolation is unchanged: the key is built from the ALREADY-authorized scope (lib/ownerScope),
// so an owner can only ever hit their own restaurants' cache rows.
import { after } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

const TABLE = "owner_analytics_cache";

// Keys whose background revalidate is running in THIS instance right now — so several
// concurrent stale views (or a poll that fires alongside a view) don't each kick off the
// same heavy recompute. Combined with the DB re-read guard below, a stale key recomputes at
// most once per turnover. (Per-instance is enough: cross-instance dupes are rare and the
// re-read guard still catches them.)
const inflight = new Set<string>();

// The set of restaurants a cached read covers → a stable key part. `null` ids = admin
// whole-platform view. A real owner's set is sorted so member order never splits the key.
export function scopeKeyOf(rid: string | null, all: boolean, ids: string[]): string {
  if (rid) return `r:${rid}`;
  if (all) return "all";
  return "s:" + [...ids].sort().join(",");
}

export type Cached<T> = T & { cachedAt: string; cached: boolean };

const DEFAULT_MAX_AGE_SEC = 300; // ~5 min: within this a snapshot counts as fresh

// Serve `key` from the cache. Behaviour:
//   • row exists, fresh (< maxAgeSec) → return it (one row read, no work).
//   • row exists, stale → return it INSTANTLY, and refresh in the background for next time
//     (fingerprint-guarded: an unchanged window just bumps the timestamp, no heavy recompute).
//   • forced (Refresh button) → recompute the live value synchronously (caller waits).
//   • cold (no row) → compute once synchronously (the only unavoidable wait).
// `compute` may throw; on the sync path nothing is stored and the caller's try/catch surfaces
// the error, on the background path the failure is swallowed (the stale value already shipped).
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

  // Recompute + store, but only if still worth it — re-reads first so concurrent stale views
  // (or a poll that already refreshed) don't all recompute the same key; skips the heavy
  // compute when the fingerprint shows nothing changed.
  const revalidate = async () => {
    if (inflight.has(key)) return;                 // already refreshing in this instance
    inflight.add(key);
    try {
      const cur = (await sb.from(TABLE).select("computed_at, fingerprint").eq("cache_key", key).maybeSingle()).data;
      if (cur && Date.now() - Date.parse(cur.computed_at as string) < maxAgeMs) return; // someone beat us
      if (fingerprint && cur) {
        const fp = await fingerprint().catch(() => null);
        if (fp && fp === cur.fingerprint) { // unchanged → just mark fresh, no recompute
          await sb.from(TABLE).update({ computed_at: nowIso() }).eq("cache_key", key);
          return;
        }
      }
      const payload = await compute();
      const fp2 = fingerprint ? await fingerprint().catch(() => null) : null;
      await sb.from(TABLE).upsert(
        { cache_key: key, payload, fingerprint: fp2, computed_at: nowIso(), last_viewed_at: nowIso() },
        { onConflict: "cache_key" },
      );
    } finally {
      inflight.delete(key);
    }
  };

  const existing = force ? null
    : (await sb.from(TABLE).select("payload, computed_at, fingerprint").eq("cache_key", key).maybeSingle()).data;

  if (existing?.payload) {
    void sb.from(TABLE).update({ last_viewed_at: nowIso() }).eq("cache_key", key).then(() => {}, () => {});
    const stale = Date.now() - Date.parse(existing.computed_at as string) >= maxAgeMs;
    if (stale) {
      // Return the stale snapshot NOW; refresh after the response is sent (no user wait).
      // Fall back to a detached promise if after() isn't in a request context (e.g. a script).
      try { after(() => revalidate().catch(() => {})); }
      catch { void revalidate().catch(() => {}); }
    }
    return { ...(existing.payload as T), cachedAt: existing.computed_at as string, cached: true };
  }

  // Cold or forced → the only time the caller waits.
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

// Cheaper change-detector for WIDE, MONTH-bucket MONEY reports (mig 202). Derives the same
// "<count>:<max-activity>" string from the monthly rollup + current-month tail (~35ms) rather
// than scanning all ~398k orders (~9.5s). ONLY valid where the report reads that rollup
// (month bucket + a money report); dishes/categories/hourly still use ordersFingerprint so an
// edit to an OLD order is still detected. Same null-on-error contract (treat as changed).
export async function reportMonthFingerprint(ids: string[] | null, from: string, to: string): Promise<string | null> {
  const { data, error } = await sb.rpc("lfh_owner_report_month_fingerprint", { p_ids: ids, p_from: from, p_to: to });
  if (error) return null;
  return typeof data === "string" ? data : null;
}
