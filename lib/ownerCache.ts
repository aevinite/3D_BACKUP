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
// `lastSweep` is module state, so a serverless COLD START resets it and the guard below stops
// meaning "once an hour" (T5 sweep, 2026-08-11). Seeding it with a random slice of the interval
// means a fleet of fresh instances doesn't all sweep at once on their first cold compute; the
// delete is one indexed statement, so spreading it is enough — a shared clock would cost a read
// on the rare path it is trying to protect.
let lastSweep = -Math.floor(Math.random() * SWEEP_EVERY_MS);
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

// ── AN INCOMPLETE ANSWER IS NEVER CACHED (T9 finding F18, 2026-08-07) ─────────────────────────────
//
// Some payloads may now report `partial: [...]` — "these named figures could not be read this time"
// (lib/partialRead.ts). Storing one of those would be worse than the bug it exists to fix: a snapshot
// is served stale-while-revalidate, so a single blip would freeze "couldn't read the payment split"
// onto the owner's dashboard until the FINGERPRINT happened to move, which it does not do for a
// transient read failure. The note would outlive the problem and the owner would be told something
// untrue for as long as the key sat there.
//
// So a partial compute is returned to THIS caller and not persisted: no row, no fingerprint. The next
// open recomputes and, when the read succeeds, gets the whole answer with no note.
const isPartial = (p: unknown): boolean =>
  !!p && typeof p === "object" && Array.isArray((p as { partial?: unknown }).partial)
     && (p as { partial: unknown[] }).partial.length > 0;

// ── AND A PAYLOAD THAT WENT ALL-ZERO WITHOUT SAYING SO (improvement I2, owner 2026-08-12) ─────────
//
// `isPartial` above only catches a payload that ADMITS it is incomplete. That is the right first
// line — but it can only work when the route remembered to say so, and the whole T9 sweep was a list
// of places where nobody remembered. Two of them were serious specifically because the invented ₹0
// then got STORED here and outlived the blip by hours.
//
// So there is a second line now: if the payload we are about to save has collapsed every money
// figure to zero, and the value we are replacing did NOT, treat it as suspect and keep the old row.
//
// WHY THIS IS SAFE ON A GENUINELY QUIET DAY. It never invents a number and never serves the old one
// to this caller — the fresh (zero) payload is returned exactly as computed. It only declines to
// OVERWRITE, and the very next open recomputes. So the worst case for a restaurant that really did
// take ₹0 is that the snapshot refreshes one open later than it would have; the best case is that a
// half-read total never becomes what everybody sees for the next five minutes.
//
// Deliberately narrow: only NUMERIC fields, only a whole-payload collapse (every number that used to
// be non-zero is now zero), never a partial dip. A single figure legitimately going to zero is
// ordinary; every figure at once, after a non-zero snapshot, is the shape of a failed read.
function numbersIn(v: unknown, depth = 0, out: number[] = []): number[] {
  if (depth > 4 || out.length > 400) return out;
  if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  else if (Array.isArray(v)) for (const x of v) numbersIn(x, depth + 1, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) numbersIn(x, depth + 1, out);
  return out;
}
// ── AND IT WAS COUNTING THE TAX RATES AS IF THEY WERE MONEY (T11 item 16, 2026-09-01) ───────────
// numbersIn() walks the WHOLE payload, and a money payload carries a `tax` block — the configured
// rate and the CGST/SGST components. Those are CONFIGURATION, not takings. So on a day that took
// nothing, switching a restaurant to the composition scheme (which legitimately makes the rate 0
// and empties the components) turned the last non-zero numbers in the payload into zeros, and the
// guard read a deliberate settings change as a failed read and refused to store the answer.
// Observed while testing exactly that: a forced read answered `composition: true` and every other
// reader kept being handed the payload that said `false`.
// The guard's own comment says it is "deliberately narrow: only a whole-payload collapse". It is
// narrow now: the tax configuration is left out, so only the MONEY and the COUNTS decide.
const withoutConfig = (p: unknown): unknown => {
  if (!p || typeof p !== "object" || Array.isArray(p)) return p;
  const { tax: _tax, ...rest } = p as Record<string, unknown>;
  return rest;
};
function collapsedToZero(next: unknown, prev: unknown): boolean {
  if (!prev) return false;                              // nothing to compare against — store it
  const before = numbersIn(withoutConfig(prev));
  const after = numbersIn(withoutConfig(next));
  if (!before.length || !after.length) return false;
  const hadValue = before.some((n) => n !== 0);
  const allZeroNow = after.every((n) => n === 0);
  return hadValue && allZeroNow;
}

// ── …BUT A QUIET DAY IS NOT A BLIP, AND THE GUARD COULD NOT TELL (T11 item 16, 2026-09-01) ───────
//
// The rule above had no way out. Once a stored snapshot held money and the honest answer became
// ZERO — a restaurant closed on its weekly day off, a window whose only bills were all cancelled,
// a period before opening — every recompute was refused, the row was never even re-stamped, and
// the OLD money was served to everyone for ever. Not for five minutes: for ever, until real money
// happened to arrive again. And "updated X ago" sat beside it, so it read as current.
//
// Caught by the app's own warning while testing something else. Four of these in one run:
//   [ownerCache] refused to store an all-zero payload over a non-zero one (forced):
//     reports:v5:r:…:sales:today:2026-08-31
// and while they were happening a forced read answered `composition: true` while every other
// reader was still being handed the older payload that said `false`.
//
// The guard was written for a BLIP — a read that fails seconds after a good one. So the test is
// now the age of the thing we are protecting: **refuse only while the snapshot we hold is still
// FRESH.** A blip lands on a fresh row and is still refused, exactly as before. A genuinely quiet
// day lands on a row that has already gone stale, is believed, and the console self-heals within
// one freshness window instead of never.
//
// It reuses isFresh(), so there is no second definition of "recent" to drift, and no new state to
// lose on a cold start. What it costs: a read failure that happens to strike a key nobody has
// looked at for five minutes can still store a zero — which is the case the ORIGINAL guard was
// least aimed at (nobody is watching that key), and the next successful compute corrects it.
const zeroIsSuspicious = (next: unknown, prev: { payload?: unknown; computed_at?: unknown } | null | undefined,
  maxAgeMs: number): boolean =>
  !!prev && isFresh(prev.computed_at, maxAgeMs) && collapsedToZero(next, prev.payload);

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
      // `payload` rides along now so the all-zero guard below has something to compare against.
      const cur = (await sb.from(TABLE).select("computed_at, fingerprint, payload").eq("cache_key", key).maybeSingle()).data;
      if (cur && isFresh(cur.computed_at, maxAgeMs)) return; // someone beat us
      if (fingerprint && cur) {
        const fp = await fingerprint().catch(() => null);
        if (fp && fp === cur.fingerprint) { // unchanged → just mark fresh, no recompute
          await sb.from(TABLE).update({ computed_at: nowIso() }).eq("cache_key", key);
          return;
        }
      }
      const payload = await compute();
      if (isPartial(payload)) return;                // see isPartial — do not freeze a half answer
      if (zeroIsSuspicious(payload, cur, maxAgeMs)) {   // see zeroIsSuspicious — a blip, not a quiet day
        console.warn(`[ownerCache] refused to store an all-zero payload over a snapshot computed seconds ago: ${key}`);
        return;
      }
      const fp2 = fingerprint ? await fingerprint().catch(() => null) : null;
      await sb.from(TABLE).upsert(
        { cache_key: key, payload, fingerprint: fp2, computed_at: nowIso(), last_viewed_at: nowIso() },
        { onConflict: "cache_key" },
      );
    } finally {
      inflight.delete(key);
    }
  };

  // A FORCED read still has to read the row it is about to replace (T11 sweep, 2026-08-18).
  //
  // `force` means "don't SERVE the stored value" — it was also skipping the read entirely, so the
  // cold/forced store below had no `prev` and the all-zero guard above could never fire on it. That
  // left the one path most likely to need it unguarded: Refresh is the button he presses BECAUSE
  // the numbers already look wrong, so a blip during it could write ₹0 over a good snapshot and
  // every other viewer would see zeroes for the next five minutes with nothing saying so.
  //
  // The read is one indexed row on a path that is already the slow one, and it changes nothing
  // about what THIS caller gets back — the freshly computed payload is returned either way. It only
  // decides whether we are allowed to overwrite.
  const prevRow = (await sb.from(TABLE).select("payload, computed_at, fingerprint").eq("cache_key", key).maybeSingle()).data;
  const existing = force ? null : prevRow;

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
  // Same two rules on the cold/forced path: hand this caller the answer either way, but store
  // neither a partial one nor an all-zero one over a snapshot that had real money in it.
  if (isPartial(payload)) {
    // nothing stored — see isPartial
  } else if (zeroIsSuspicious(payload, prevRow, maxAgeMs)) {
    console.warn(`[ownerCache] refused to store an all-zero payload over a snapshot computed seconds ago (forced): ${key}`);
  } else {
    await sb.from(TABLE).upsert(
      { cache_key: key, payload, fingerprint: fp, computed_at: now, last_viewed_at: now },
      { onConflict: "cache_key" },
    );
  }
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
