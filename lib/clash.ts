// clash.ts — "someone else got there first" detection for changes that were made
// OFFLINE and are only now reaching the server.
//
// THE PROBLEM THIS SOLVES
//   A waiter's tablet loses signal. They take an order for table 5, apply a discount,
//   mark a bill paid — all saved on the device (public/panels/outbox.js). Ten minutes
//   later the signal returns and those changes are replayed. But meanwhile, on ANOTHER
//   device: table 5 was closed, the bill was settled, and a NEW party sat down.
//   Replaying blindly would put the old party's dishes on the new guests' bill, or
//   re-open a settled bill. Both are worse than the change simply not happening.
//
//   So a replayed change is checked against how things are NOW. If the ground moved, we
//   REFUSE it (409) with a plain-language explanation, and the panel puts it in front of
//   a person — "these changes need you" — instead of silently applying or silently
//   dropping it. Nothing is ever lost and nothing is ever overwritten behind someone's
//   back.
//
// WHAT IT DOES NOT DO
//   - It does NOT touch the ONLINE path. A normal live write carries no replay marker
//     (or one that's seconds old), so this returns null immediately — no extra query,
//     no behaviour change, nothing to regress.
//   - It does NOT try to be a full merge engine. It answers one question — "is the thing
//     this change was about still the same thing?" — and leaves the decision to a human.
//   - It FAILS OPEN. If a lookup errors we allow the write: the handler's own validation
//     still applies, and a clash check breaking must never stop a restaurant working.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { affectedTables } from "@/lib/tableOfAction";

// A change is only judged as a REPLAY once it's this old. An online write goes through
// the same outbox helper (so it carries the same header) but is milliseconds old — this
// is what keeps the live path completely untouched.
const REPLAY_MIN_AGE_MS = 20_000;

export type ClashInfo = {
  code: string;      // machine reason, for logs
  plain: string;     // what happened, in words a waiter can read
  todo: string;      // what to do about it
  retryable: boolean; // false = resending the same thing can't help; a person must redo it
};

/** 409 + the explanation, in the shape public/panels/outbox.js expects. */
export function clashJson(c: ClashInfo): NextResponse {
  return NextResponse.json({ error: c.code, clash: c }, { status: 409 });
}

/**
 * The replay markers a queued change carries (set in outbox.js doFetch):
 *   X-LFH-Replay   "1" — this was saved on a device and is being sent later
 *   X-LFH-Queued-At ISO — when the person actually did it
 * Returns null for anything that isn't an aged replay, which is the common case.
 */
export function replayMarkers(req: NextRequest): { queuedAt: Date } | null {
  if (req.headers.get("x-lfh-replay") !== "1") return null;
  const raw = req.headers.get("x-lfh-queued-at");
  if (!raw) return null;
  const at = new Date(raw);
  if (isNaN(at.getTime())) return null;
  if (Date.now() - at.getTime() < REPLAY_MIN_AGE_MS) return null; // effectively a live write
  return { queuedAt: at };
}

/**
 * TWO PEOPLE, ONE DISH, AT THE SAME MOMENT.
 *
 * Waiter A opens a dish and types "more spicy". Waiter B, on another tablet, opens the same
 * dish and types "less spicy". Both save within seconds. Without a check the second save
 * simply overwrites the first, nobody is told, and the kitchen cooks the wrong thing while
 * BOTH waiters believe their instruction stands.
 *
 * So each panel sends what it was editing FROM (`X-LFH-Expect`, e.g. {"note":"mild"}). If
 * the row no longer holds that value, someone else got there first: we refuse, and tell the
 * second person exactly what it says now so they can decide. FIRST SAVE WINS — the same rule
 * as the offline replay check above, so staff learn one behaviour, not two.
 *
 * Returns null when the write may proceed (nothing to compare, or nothing changed).
 * FAILS OPEN on any lookup error — a broken check must never block a real edit.
 */
export async function fieldClash(
  req: NextRequest,
  opts: { table: string; id: string; rid: string; fields: string[]; label?: string },
): Promise<ClashInfo | null> {
  let expect: Record<string, unknown> | null = null;
  try {
    const raw = req.headers.get("x-lfh-expect");
    if (!raw) return null; // older client / not an edit that carries an expectation
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    expect = parsed as Record<string, unknown>;
  } catch { return null; }

  // Only the fields the caller names are ever compared, so a client can't ask the server to
  // compare something it shouldn't.
  const cols = opts.fields.filter((f) => f in (expect as Record<string, unknown>));
  if (!cols.length) return null;

  try {
    const res = await sb.from(opts.table).select(cols.join(", ")).eq("id", opts.id).eq("restaurant_id", opts.rid).maybeSingle();
    if (res.error || !res.data) return null; // can't read it → let the handler decide
    const row = res.data as unknown as Record<string, unknown>;
    for (const c of cols) {
      const mine = expect[c];
      const theirs = row[c];
      if (sameValue(mine, theirs)) continue;
      const what = opts.label || "this";
      const now = describe(theirs);
      return {
        code: "clash_changed_elsewhere",
        plain: `Someone else changed ${what} while you had it open — it now says ${now}.`,
        todo: `Your change was NOT saved. Look at what it says now and redo yours if it's still right.`,
        retryable: false,
      };
    }
    return null;
  } catch {
    return null; // fail open
  }
}

// Compare loosely enough that formatting isn't treated as a change: trimmed text, and lists
// compared as sets (the allergen list's order is not meaningful).
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v == null ? "" : String(v).trim());
  if (Array.isArray(a) || Array.isArray(b)) {
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => norm(x).toLowerCase()).filter(Boolean).sort() : []);
    const x = arr(a), y = arr(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return norm(a) === norm(b);
}

// How to say the current value to a person.
function describe(v: unknown): string {
  if (Array.isArray(v)) return v.length ? `“no ${v.join(", ")}”` : "nothing to avoid";
  const s = v == null ? "" : String(v).trim();
  return s ? `“${s}”` : "nothing";
}

type SessionRow = Record<string, unknown> & { id?: string; status?: string; closed_at?: string | null; created_at?: string };

const parse = (v: unknown): number => {
  const t = v ? new Date(String(v)).getTime() : NaN;
  return isNaN(t) ? 0 : t;
};

/**
 * The ONE check a panel's POST dispatcher runs, right beside the section gate — same
 * idea, same place: resolved from the [a, b, c] path segments the dispatcher already
 * has, so a table-scoped action added next year is covered the day it's written.
 *
 * Returns null when the change may proceed (the overwhelming majority of calls), or the
 * clash to answer with.
 */
export async function replayClash(
  req: NextRequest,
  rid: string,
  a: string, b: string | undefined, c: string | undefined,
  body: Record<string, unknown> | null | undefined,
): Promise<ClashInfo | null> {
  const markers = replayMarkers(req);
  if (!markers) return null; // live write → nothing to check
  const { queuedAt } = markers;

  try {
    const { tables, unknown } = await affectedTables(a, b, c, body);
    // Not table-scoped (a parcel, a floor issue) or unresolvable → let the handler's own
    // validation speak. "Couldn't tell" must not become a refusal here: this check exists
    // to protect other people's work, not to invent failures.
    if (unknown || !tables.length) return null;

    for (const t of tables) {
      if (!t) continue;
      // The table's CURRENT session (newest first) — the party sitting there now.
      const res = await sb.from("sessions").select("id, status, closed_at, created_at")
        .eq("restaurant_id", rid).eq("table_number", t)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (res.error) return null;             // fail open
      const s = res.data as SessionRow | null;
      if (!s) continue;                       // nothing there now → the handler decides

      const started = parse(s.created_at);
      const closed = parse(s.closed_at);
      const isClosed = String(s.status || "") === "closed" || closed > 0;

      // A DIFFERENT PARTY is on this table now. This is the one that would silently put
      // the previous guests' dishes onto these guests' bill.
      if (started > queuedAt.getTime() + 1000) {
        return {
          code: "clash_new_party",
          plain: `Table ${t} has a different party now — this was for the guests who were sitting there when you did it.`,
          todo: `Nothing was applied. If it's still needed, do it again for table ${t} as it is now.`,
          retryable: false,
        };
      }

      // The bill was closed / settled AFTER the person acted. Re-opening a settled bill
      // from a stale device is exactly what must never happen.
      if (isClosed && closed > queuedAt.getTime()) {
        return {
          code: "clash_table_closed",
          plain: `Table ${t} was closed and billed after you did this${a === "order" ? " — the order never reached the kitchen" : ""}.`,
          todo: `Nothing was applied. If these dishes were served, add them to a new bill for table ${t}.`,
          retryable: false,
        };
      }
    }
    return null;
  } catch {
    return null; // fail open — a broken check must never stop a restaurant working
  }
}
