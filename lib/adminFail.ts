// adminFail.ts — what the ADMIN CONSOLE says when the database didn't do what was asked.
//
// WHY (T17 sweep improvement, owner-approved 2026-08-14). Forty-odd handlers under /api/admin
// answered `NextResponse.json({ error: r.error.message }, { status: 500 })`, so the console's toast
// read `duplicate key value violates unique constraint "settings_pkey"`. That is the right sentence
// for a developer and the wrong one for the screen: the console is where the owner runs his
// platform, and a wall of Postgres prose in a red toast tells him nothing about what to do next.
//
// BUT THE RAW TEXT IS THE USEFUL PART WHEN SOMETHING IS ACTUALLY BROKEN, and the admin console is
// exactly where it gets read. So this keeps BOTH, in the right places:
//   · `error`  — a plain sentence naming what failed and whether anything changed. This is what
//                `lib/adminFetch.ts` surfaces, so every existing screen improves with no UI change.
//   · `detail` — the database's own words, still in the body for when someone needs them, and
//                written to the server log where they are searchable.
// The panels (manager / kitchen / tablet / inventory) do NOT get the second half — a waiter must
// never read Postgres — which is why this is its own helper and not a shared one with lib/dbRefusal.
import { NextResponse } from "next/server";

type DbError = { message?: string; code?: string; details?: string } | null | undefined;

/**
 * WHY THIS ACCEPTS `unknown` (T19 sweep #7, item 15, 2026-09-01).
 *
 * lib/readGuard's `ReadSet.error(name)` returns `unknown` — deliberately, because a supabase error
 * is not typed and the helper refuses to pretend otherwise. This function wanted a shaped object, so
 * the two could not be used together without an `as` cast at every one of ~30 call sites, and a cast
 * per call site is how a shape assumption spreads. Widening here instead: the parameter takes
 * anything, and the two fields this function actually reads are picked out safely. Every existing
 * caller keeps working unchanged — this only ever accepts MORE than before.
 */
function asDbError(e: unknown): DbError {
  if (e == null) return e as null | undefined;
  if (typeof e === "string") return { message: e };
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    return {
      message: typeof o.message === "string" ? o.message : undefined,
      code: typeof o.code === "string" ? o.code : undefined,
      details: typeof o.details === "string" ? o.details : undefined,
    };
  }
  return { message: String(e) };
}

/** Was this the database refusing the VALUE rather than failing to serve it? Those keep a 4xx and a
 *  sentence of their own, because retrying changes nothing. Mirrors lib/dbRefusal's code list. */
const REFUSAL = new Set(["22001", "22003", "22007", "22P02", "23502", "23503", "23505", "23514", "23P01"]);

/**
 * @param what   the thing, in the words the console uses: "this restaurant's channel settings".
 * @param e      the Supabase error.
 * @param opts.action  "load" (a read) or "save" (a write) — decides whether the sentence promises
 *                     that nothing changed. Defaults to "save", the answer that is safe to be wrong
 *                     about in only one direction.
 */
export function adminFail(what: string, err: unknown, opts?: { action?: "load" | "save"; status?: number }): NextResponse {
  const e = asDbError(err);
  const raw = e?.message || "the database gave no reason";
  const code = e?.code || "";
  console.error(`[admin] couldn't ${opts?.action === "load" ? "load" : "save"} ${what}:`, code || "", raw);
  const refused = !!code && REFUSAL.has(code);
  const status = opts?.status ?? (refused ? 400 : 500);
  const sentence = refused
    // A refused value is a 4xx: it will be refused identically forever, so "try again" would be a lie.
    ? `That value isn't allowed for ${what} — nothing was changed.`
    : opts?.action === "load"
      ? `Couldn't load ${what} — please try again.`
      : `Couldn't save ${what} — nothing was changed. Please try again.`;
  return NextResponse.json({ error: sentence, detail: raw, ...(code ? { code } : {}) }, { status });
}
