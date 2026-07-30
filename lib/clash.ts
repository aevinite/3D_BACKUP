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

// Tables a panel may ask us to compare. An allowlist, so a client can never point the check
// at something it has no business reading.
const COMPARABLE_TABLES: Record<string, string> = {
  order_items: "id",
  orders: "id",
  sessions: "id",
  menu_items: "id",
  categories: "id",
  filters: "id",
  settings: "restaurant_id",   // one row per restaurant
  staff_users: "id",
  table_tags: "id",
};

/**
 * THE ONE CLASH GATE — "did someone else change this while you had it open?"
 *
 * Called once per panel write dispatcher, beside the section and replay gates. It does
 * nothing at all unless the screen SAID what it was editing from:
 *
 *   api("POST", path, body, { expect: { table: "order_items", id, fields: { note: "mild" } } })
 *
 * If the row no longer holds those values, someone got there first: we refuse and tell the
 * second person what it says NOW. Adding protection to a new feature is therefore one line at
 * the CALL SITE — no new server code — which is what makes "check every feature" realistic.
 *
 * FIRST SAVE WINS, everywhere, deliberately: the same rule as the offline replay check, so
 * staff learn one behaviour. FAILS OPEN on any lookup problem.
 */
export async function expectClash(req: NextRequest, rid: string): Promise<ClashInfo | null> {
  type Want = { table?: string; id?: string; fields?: Record<string, unknown>; label?: string };
  let want: Want | null = null;
  try {
    const raw = req.headers.get("x-lfh-expect");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    want = parsed as Want;
  } catch { return null; }

  const table = String(want?.table || "");
  const idCol = COMPARABLE_TABLES[table];
  const id = String(want?.id || "");
  const fields = want?.fields;
  if (!idCol || !id || !fields || typeof fields !== "object") return null;

  const cols = Object.keys(fields).filter((c) => /^[a-z_][a-z0-9_]*$/.test(c)).slice(0, 8);
  if (!cols.length) return null;

  try {
    let q = sb.from(table).select(cols.join(", ")).eq(idCol, id);
    // Tenant boundary: service-role bypasses RLS, so scope every comparison to this
    // restaurant — a foreign id must never be readable through this check.
    if (idCol !== "restaurant_id") q = q.eq("restaurant_id", rid);
    const res = await q.maybeSingle();
    if (res.error || !res.data) return null;
    const row = res.data as unknown as Record<string, unknown>;
    for (const c of cols) {
      if (sameValue((fields as Record<string, unknown>)[c], row[c])) continue;
      const what = want?.label || readable(c);
      return {
        code: "clash_changed_elsewhere",
        plain: `Someone else changed ${what} while you had it open — it now says ${describe(row[c])}.`,
        todo: "Your change was NOT saved. Look at what it says now and redo yours if it's still right.",
        retryable: false,
      };
    }
    return null;
  } catch {
    return null; // fail open
  }
}

// Compare loosely enough that formatting isn't treated as a change: trimmed text, and lists
// compared as sets (an allergen list's order is not meaningful).
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

// Column name → something a person would recognise on screen.
function readable(col: string): string {
  const map: Record<string, string> = {
    note: "this dish's kitchen note",
    removed: "this dish's allergens",
    qty: "the quantity",
    discount: "the discount",
    discount_note: "the discount note",
    title: "the name",
    price: "the price",
    sold_out: "the sold-out mark",
    available: "whether it's available",
    status: "the status",
    payment_status: "the payment status",
    table_count: "the number of tables",
    allergies: "the allergens",
  };
  return map[col] || `the ${col.replace(/_/g, " ")}`;
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
