// lib/readGuard.ts — ONE answer to "did every one of these reads actually work?"
//
// ── WHY THIS EXISTS (T9 sweep fix, 2026-08-12, owner's improvement #1) ────────────────────────────
//
// Ten separate findings in the T9 sweep were the SAME missing line, in six different files:
//
//     const [a, b, c] = await Promise.all([...]);
//     const total = (a.data || []).reduce(...);      // ← `a.error` never inspected
//
// When that read fails, `a.data` is null, `|| []` turns it into an empty list, and the screen prints
// a confident **₹0** — "stock value ₹0", "paid out ₹0", "collected today ₹0", "0 blocked guests" —
// for a restaurant where none of those are true. Two of them were worse still, because the compute
// sits inside `cachedOwnerPayload`, which happily STORES a payload that doesn't declare itself
// incomplete: the invented zero then outlived the blip by hours.
//
// Every one of those was fixed by hand, one route at a time, over several sweeps. It kept coming
// back because there was nothing to reuse — each route re-derived "was this ok?" from scratch, and a
// new route started from zero again. So the check lives here now, and a route gets it in one line.
//
// ── THE THREE RULES THIS ENCODES ─────────────────────────────────────────────────────────────────
//
//   1. A read that FAILED is never the same as a read that returned NOTHING. `rows()` throws rather
//      than hand back `[]` for a failure — you must say, at the call site, which of the two you mean.
//   2. The detail (the database's own words) is logged OUR side, exactly once, and never travels to
//      an owner. `lib/ownerScope.dbFail` does the same job for the response.
//   3. A screen built from several reads says WHICH part it couldn't read (`partial`), so it can
//      show the parts that are fine instead of failing whole — or failing silently.
//
// ── HOW A ROUTE USES IT ──────────────────────────────────────────────────────────────────────────
//
//     const reads = new ReadSet("owner/inventory", await Promise.all([
//       rd("summary",  () => sb.rpc("lfh_inv_stock_summary", {...})),
//       rd("expenses", () => sb.from("expenses").select(COLS).eq(...)),
//     ]));
//     if (reads.failed("summary")) return dbFail("owner/inventory", reads.error("summary"));
//     const expenses = reads.rowsOr("expenses", []);   // explicitly tolerant, and it says so
//     const partial  = reads.partial({ expenses: "expenses" });
//
// `rd()` also gives every read ONE retry on a genuinely transient failure (lib/readRetry), which is
// what most of these "blips" actually were — see that file for why a timeout is deliberately NOT
// retried.
import { retryRead, type SbRead } from "@/lib/readRetry";
import type { PartialKey } from "@/lib/partialRead";

export type { SbRead };

/** One read, with the NAME the route knows it by — so a failure can be reported in words. */
export type NamedRead<T = unknown> = {
  name: string;
  data: T | null;
  error: unknown;
  /**
   * The row count, when the read asked for one (`{ count: "exact", head: true }`).
   *
   * It rides BESIDE `data` on a supabase result rather than inside it, so it has to be carried
   * explicitly — a head-count read has `data: null` and its whole answer in this field, and dropping
   * it would turn every counted read into "no rows".
   */
  count: number | null;
  /** How long it took, so a slow read can be found without adding timing to every route. */
  ms: number;
  /** True when the first attempt failed transiently and the retry is what answered. */
  retried: boolean;
};

/** Thrown by `rows()` / `one()` when the read they are asked for did not succeed. */
export class ReadFailed extends Error {
  readonly where: string;
  readonly read: string;
  readonly cause: unknown;
  constructor(where: string, read: string, cause: unknown) {
    super(`[${where}] the "${read}" read failed`);
    this.name = "ReadFailed";
    this.where = where;
    this.read = read;
    this.cause = cause;
  }
}

/**
 * Run one read, under a name, with one retry on a transient failure.
 *
 * Pass a FUNCTION, not a promise — the retry has to be able to run it a second time. That is also
 * why call sites read `rd("x", () => sb.rpc(...))` rather than `sb.rpc(...)`.
 */
export async function rd<T>(
  name: string,
  run: () => PromiseLike<SbRead<T>>,
): Promise<NamedRead<T>> {
  const started = Date.now();
  const { result, retried } = await retryRead(run);
  const count = (result as { count?: number | null })?.count;
  return {
    name, data: result.data ?? null, error: result.error ?? null,
    count: typeof count === "number" ? count : null,
    ms: Date.now() - started, retried,
  };
}

/** Wrap an ALREADY-RESOLVED supabase result that wasn't started through `rd()`. No retry. */
export function named<T>(name: string, result: SbRead<T>): NamedRead<T> {
  const count = (result as { count?: number | null })?.count;
  return {
    name, data: result?.data ?? null, error: result?.error ?? null,
    count: typeof count === "number" ? count : null, ms: 0, retried: false,
  };
}

/**
 * A batch of reads a screen was built from.
 *
 * Construct it once, then ask it questions. It logs every failure exactly once (on construction),
 * with the route name, so no call site has to remember to.
 */
export class ReadSet {
  readonly where: string;
  private readonly byName = new Map<string, NamedRead>();

  constructor(where: string, reads: NamedRead<any>[]) {
    this.where = where;
    for (const r of reads) this.byName.set(r.name, r);
    for (const r of reads) {
      if (!r.error) continue;
      const msg = r.error instanceof Error ? r.error.message
        : (r.error && typeof r.error === "object" && "message" in r.error)
          ? String((r.error as { message: unknown }).message)
          : String(r.error);
      const code = r.error && typeof r.error === "object" && "code" in r.error
        ? String((r.error as { code: unknown }).code) : "";
      // The ONE place these words are allowed to appear. Never in a response.
      console.error(`[${where}] read "${r.name}" failed${code ? ` (${code})` : ""} after ${r.ms}ms:`, msg);
    }
  }

  /** Did this named read fail? An unknown name counts as failed — a typo must not read as "fine". */
  failed(name: string): boolean {
    const r = this.byName.get(name);
    return !r || !!r.error;
  }

  /** Did ANY of them fail? */
  get anyFailed(): boolean {
    for (const r of this.byName.values()) if (r.error) return true;
    return false;
  }

  /** Did EVERY one of them fail? (the "degrade gracefully, but a total failure is an error" rule) */
  get allFailed(): boolean {
    let n = 0;
    for (const r of this.byName.values()) { if (!r.error) return false; n++; }
    return n > 0;
  }

  /** The names that failed, in the order they were given. */
  get failedNames(): string[] {
    return [...this.byName.values()].filter((r) => r.error).map((r) => r.name);
  }

  /** The error object for one read, for handing to `dbFail`. */
  error(name: string): unknown {
    return this.byName.get(name)?.error ?? new Error(`no read named "${name}"`);
  }

  /** The first error in the batch, for a route that fails whole. */
  get firstError(): unknown {
    for (const r of this.byName.values()) if (r.error) return r.error;
    return null;
  }

  /**
   * The rows from a read that MUST have worked. Throws `ReadFailed` if it didn't.
   * Use this wherever the old code said `(x.data ?? [])` and the number depends on it.
   */
  rows<T = Record<string, unknown>>(name: string): T[] {
    const r = this.byName.get(name);
    if (!r) throw new ReadFailed(this.where, name, new Error("no such read"));
    if (r.error) throw new ReadFailed(this.where, name, r.error);
    return (r.data ?? []) as T[];
  }

  /** The FIRST row of a read that must have worked (the shape every `lfh_*_summary` RPC returns). */
  one<T = Record<string, unknown>>(name: string): T | null {
    const rows = this.rows<T>(name);
    return rows.length ? rows[0] : null;
  }

  /**
   * The rows from a read the screen can genuinely live without — the fallback is spelled out at the
   * call site, so "we tolerate this one" is a visible decision rather than an accident.
   */
  rowsOr<T = Record<string, unknown>>(name: string, fallback: T[]): T[] {
    const r = this.byName.get(name);
    return !r || r.error ? fallback : ((r.data ?? []) as T[]);
  }

  /**
   * The COUNT from a read that must have worked and asked for one.
   *
   * Returns a number or throws — never `?? 0`, which is the exact shape that made four failed
   * head-counts render as a confident "0 blocked guests" on the owner's Customers tiles.
   */
  count(name: string): number {
    const r = this.byName.get(name);
    if (!r) throw new ReadFailed(this.where, name, new Error("no such read"));
    if (r.error) throw new ReadFailed(this.where, name, r.error);
    if (typeof r.count !== "number") {
      throw new ReadFailed(this.where, name, new Error("this read did not ask for a count"));
    }
    return r.count;
  }

  /** The raw value of a read that must have worked (for an RPC returning a scalar or object). */
  value<T>(name: string): T | null {
    const r = this.byName.get(name);
    if (!r) throw new ReadFailed(this.where, name, new Error("no such read"));
    if (r.error) throw new ReadFailed(this.where, name, r.error);
    return (r.data ?? null) as T | null;
  }

  /**
   * Which parts of the screen could not be read, as `PartialKey`s the client already knows how to
   * word (`lib/partialRead.ts → partialNote`).
   *
   * `map` is read-name → the key the screen reports it under. A read with no entry is not
   * reportable and is simply left out — that is deliberate: `partial` is a promise that the SCREEN
   * can say something about it, so a key with no words would be worse than nothing.
   */
  partial(map: Record<string, PartialKey>): PartialKey[] {
    const out: PartialKey[] = [];
    for (const [name, key] of Object.entries(map)) {
      if (this.failed(name) && !out.includes(key)) out.push(key);
    }
    return out;
  }

  /** Reads slower than `ms` — used by the timing probe, and handy in a log when something drags. */
  slowerThan(ms: number): { name: string; ms: number }[] {
    return [...this.byName.values()].filter((r) => r.ms > ms).map((r) => ({ name: r.name, ms: r.ms }));
  }
}

/**
 * The "degrade gracefully, but a TOTAL failure is still an error" rule, in one place.
 *
 * Several routes fan a per-restaurant RPC out over an owner's whole set. Losing one restaurant must
 * not blank the page (the 2026-07-09 audit), but keeping "what answered" quietly turns a GROUP TOTAL
 * into a subset — so the caller gets back the ones that worked AND whether any were missing, and is
 * expected to name it in `partial` when some were.
 */
export function keepWhatAnswered<T extends { error?: unknown }>(
  results: T[],
): { ok: T[]; missing: number; allFailed: boolean; firstError: unknown } {
  const ok = results.filter((r) => !r.error);
  const firstError = results.find((r) => r.error)?.error ?? null;
  return { ok, missing: results.length - ok.length, allFailed: ok.length === 0 && results.length > 0, firstError };
}
