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

// Is a stored snapshot still fresh? An UNPARSEABLE computed_at must count as STALE, not fresh.
// This used to be a bare `Date.now() - Date.parse(row) >= maxAgeMs`: with a corrupt timestamp
// that is `NaN >= maxAgeMs` → false → the row was treated as fresh FOREVER and never
// revalidated, while the guard inside revalidate() used the opposite comparison and disagreed
// about the same row (T5 sweep, 2026-08-06). One helper, so both sides can't drift again.
function isFresh(computedAt: unknown, maxAgeMs: number): boolean {
  const t = Date.parse(String(computedAt));
  return Number.isFinite(t) && Date.now() - t < maxAgeMs;
}

// ── Housekeeping, piggy-backed — NOT a cron (the project rule is "never a blind cron") ──────
// owner_analytics_cache is keyed by scope+report+range+the RESOLVED window day, so the reports
// route mints a brand-new row for every viewed combination every IST day. Nothing ever deleted
// the old ones: mig 196 added a `last_viewed_at` column and an index on it, and then no reader.
// So the table grew a whole report payload per key per day, forever (T5 sweep, 2026-08-06).
// This rides along on a COLD compute (already the rare, already-slow path), at most once an
// hour per instance, and is fire-and-forget — a failed sweep must never affect the response.
const SWEEP_EVERY_MS = 3600_000;
const KEEP_DAYS = 30;
let lastSweep = 0;
function sweepStaleRows(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  const cutoff = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
  void sb.from(TABLE).delete().lt("last_viewed_at", cutoff).then(() => {}, () => {});
}

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
      if (cur && isFresh(cur.computed_at, maxAgeMs)) return; // someone beat us
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
    const stale = !isFresh(existing.computed_at, maxAgeMs);
    if (stale) {
      // Return the stale snapshot NOW; refresh after the response is sent (no user wait).
      // Fall back to a detached promise if after() isn't in a request context (e.g. a script).
      try { after(() => revalidate().catch(() => {})); }
      catch { void revalidate().catch(() => {}); }
    }
    return { ...(existing.payload as T), cachedAt: existing.computed_at as string, cached: true };
  }

  // Cold or forced → the only time the caller waits. The change-detector and the payload
  // are independent reads, so run them SIDE-BY-SIDE — the wait is max(compute, fingerprint)
  // instead of their sum (a manual Refresh used to pay both back-to-back). A fingerprint
  // taken during the compute is safe either way: at worst the next check sees "changed"
  // once more and does one extra recompute — it can never mark stale data fresh.
  sweepStaleRows();   // rare path, fire-and-forget — see the note above
  const [payload, fp] = await Promise.all([
    compute(),
    fingerprint ? fingerprint().catch(() => null) : Promise.resolve(null),
  ]);
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
