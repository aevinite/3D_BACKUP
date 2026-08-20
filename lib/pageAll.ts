// lib/pageAll.ts — read EVERY row of a small table, past PostgREST's row cap.
//
// ── WHY (owner-approved 2026-08-20, T20 sweep item 13) ─────────────────────────────────────────
// PostgREST answers a plain `.select()` with at most `db-max-rows` rows and says nothing about the
// ones it left out. A read written as "give me all of them" therefore stops being all of them at
// some size, silently, and every figure derived from it goes quietly small. This project has been
// bitten by that class four separate times — the Z-report's till, the Pay Later headline, the owner
// reports' restaurant list, and the admin's all-restaurants scope — and each was fixed with its own
// private paging loop. This is that loop, once, so the fifth one doesn't have to be written again.
//
// ── WHEN TO USE IT, AND WHEN NOT TO ────────────────────────────────────────────────────────────
// USE IT for a table with ONE ROW PER RESTAURANT (or per plan, per owner) that must be complete:
// `restaurants`, `restaurant_billing`, `settings`. At a thousand restaurants that is one extra
// round trip, and the alternative is a wrong number.
//
// DO **NOT** use it for an append-heavy table — orders, payments, staff_actions. Paging a ledger
// into the app to add it up is the expensive way to be right: it drags every row across the wire to
// produce one number. Those get a SQL aggregate instead (`lfh_admin_platform_collected`,
// `lfh_khata_outstanding_summary`), which is why this file has a hard cap and refuses rather than
// paging forever. Hitting that cap means you reached for the wrong tool.
//
// It always orders by a stable column, because `range()` without an ORDER BY has no defined
// meaning — rows can repeat across pages or be skipped entirely.

/** One page of a supabase read. */
type Page<T> = { data: T[] | null; error: unknown };

/** The most rows this will ever assemble. Past it, the caller is told — never silently truncated. */
export const PAGE_ALL_MAX = 50_000;
const PAGE = 1000;

export class TooManyRows extends Error {
  constructor(public readonly table: string) {
    super(`${table} has more than ${PAGE_ALL_MAX} rows — this needs a SQL aggregate, not paging`);
    this.name = "TooManyRows";
  }
}

/**
 * Read every row, a page at a time.
 *
 * @param label  the table's name, for the error message only.
 * @param page   given a zero-based `from`/`to`, runs ONE page of the read. The caller supplies this
 *               (rather than a query object) so the column list, the filters and the ORDER BY stay
 *               visible at the call site — a helper that built the query would hide exactly the
 *               parts that matter for cost.
 * @returns      `{ rows }` on success; `{ error }` if any page failed. NEVER a partial list with no
 *               error, which is the whole fault this file exists to prevent.
 */
export async function pageAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<{ rows: T[]; error?: undefined } | { rows?: undefined; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await page(from, from + PAGE - 1);
    if (r.error) return { error: r.error };
    const batch = r.data || [];
    rows.push(...batch);
    // A short page is the last page. An exactly-full one might not be, so we ask again.
    if (batch.length < PAGE) break;
    if (rows.length >= PAGE_ALL_MAX) return { error: new TooManyRows(label) };
  }
  return { rows };
}
