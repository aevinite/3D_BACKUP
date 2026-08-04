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
// The value comparison lives in its own import-free file so scripts/verify-order-retry.mjs can
// execute the REAL rule rather than a copy of it. See that file for why objects need handling.
import { sameValue, isPlainObject } from "@/lib/clashCompare";

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

// Some rows are not identified by an `id` the screen knows. A stock count line is the case that
// forced this: it is one row per (count, item) and the panel only ever holds the count id and the
// item id — the row's own uuid never reaches the browser. Rather than let that feature grow its
// own private comparison (which is how the one gate stops being one gate), a call site may name a
// COMPOSITE key instead of an id:
//
//   expect: { table: "inv_count_lines", where: { count_id, item_id }, fields: { counted_base: was } }
//
// Only the columns listed here may be used, per table — so `where` can never be turned into a
// free-form filter over a table, and the restaurant scope below still always applies.
const COMPOSITE_KEYS: Record<string, string[]> = {
  inv_count_lines: ["count_id", "item_id"],
};

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
  // Inventory. Two people stock-taking at once is the commonest real collision in the whole
  // product (the count sheet is deliberately shared), and until these were listed the gate
  // could not answer for them even if a screen sent an expectation — an unknown table returns
  // null, which reads as "nothing to protect".
  inv_count_lines: "id",
  inv_items: "id",
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
  type Want = { table?: string; id?: string; where?: Record<string, unknown>; fields?: Record<string, unknown>; label?: string };
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
  if (!idCol || !fields || typeof fields !== "object") return null;

  // Either an id OR a whitelisted composite key (see COMPOSITE_KEYS). Every column named must
  // be on that table's list and carry a non-empty value, or we ignore the expectation entirely
  // rather than run a half-specified lookup that could match the wrong row.
  const allowedKeyCols = COMPOSITE_KEYS[table] || [];
  const where: Array<[string, string]> = [];
  if (!id) {
    const w = want?.where;
    if (!w || typeof w !== "object" || Array.isArray(w)) return null;
    const named = Object.keys(w);
    if (!named.length || named.length !== allowedKeyCols.length) return null;
    for (const col of named) {
      if (!allowedKeyCols.includes(col)) return null;
      const v = String((w as Record<string, unknown>)[col] ?? "");
      if (!v) return null;
      where.push([col, v]);
    }
  }

  // A field may name a SUB-KEY of a jsonb column with a dot: "profile.notes" (added 2026-08-04).
  // Without this, protecting anything stored in a jsonb meant comparing the WHOLE blob, which fires
  // on a change to any unrelated key in the same column — a false-positive machine that would teach
  // people to stop passing expectations. The staff profile keeps a person's private note and their
  // papers inside `profile`, so this is what makes those protectable at all.
  const keys = Object.keys(fields)
    .filter((c) => /^[a-z_][a-z0-9_]*(\.[a-zA-Z0-9_-]+)?$/.test(c))
    .slice(0, 8);
  if (!keys.length) return null;
  // Ask the database only for the real COLUMNS (dedup'd); the sub-key is read out of the object.
  const cols = [...new Set(keys.map((k) => k.split(".")[0]))];

  try {
    let q = sb.from(table).select(cols.join(", "));
    if (id) q = q.eq(idCol, id);
    else for (const [col, v] of where) q = q.eq(col, v);
    // Tenant boundary: service-role bypasses RLS, so scope every comparison to this
    // restaurant — a foreign id must never be readable through this check.
    if (idCol !== "restaurant_id") q = q.eq("restaurant_id", rid);
    const res = await q.maybeSingle();
    // No row: nothing to overwrite. For a composite key that is the normal "first person to
    // count this item" case, so it must READ as fine rather than as a clash.
    if (res.error || !res.data) return null;
    const row = res.data as unknown as Record<string, unknown>;
    for (const c of keys) {
      // "profile.notes" → read `notes` out of the `profile` object. A missing object compares as
      // absent, which is correct: "it had nothing there" is a real previous value.
      const [col, sub] = c.split(".");
      const current = sub
        ? ((row[col] && typeof row[col] === "object" ? (row[col] as Record<string, unknown>)[sub] : undefined))
        : row[col];
      if (sameValue((fields as Record<string, unknown>)[c], current)) continue;
      const what = want?.label || readable(sub || col);
      // QUOTING THE CURRENT VALUE IS THE USEFUL PART — but this gate deliberately runs once at
      // the top of the dispatcher, BEFORE the per-action permission check inside each branch.
      // So for a money column the sentence could state a figure the person's own role is not
      // shown anywhere else on their screen. For those, say that it moved and send them to look;
      // for everything else (a note, allergens, a quantity) quote it as before.
      // An OBJECT takes the quiet form too. There is no single value to quote for a jsonb blob —
      // quoting one produced "it now says something different now", which is both clumsy and
      // says nothing. Naming the field and sending them to look is the honest version.
      const quiet = QUIET_COLUMNS.has(c) || isPlainObject(current);
      const plain = quiet
        ? `Someone else changed ${what} while you had it open.`
        : `Someone else changed ${what} while you had it open — it now says ${describe(current)}.`;
      return {
        code: "clash_changed_elsewhere",
        plain,
        todo: "Your change was NOT saved. Look at what it says now and redo yours if it's still right.",
        retryable: false,
      };
    }
    return null;
  } catch {
    return null; // fail open
  }
}

// Money columns: the refusal says a value MOVED without repeating the figure, because this gate
// runs before the per-action permission check (see where it's used).
const QUIET_COLUMNS = new Set(["discount", "price", "payment_status", "total"]);

// Compare loosely enough that formatting isn't treated as a change: trimmed text, and lists
// compared as sets (an allergen list's order is not meaningful).
// How to say the current value to a person.
function describe(v: unknown): string {
  if (Array.isArray(v)) return v.length ? `“no ${v.join(", ")}”` : "nothing to avoid";
  // An object has no useful one-line value to quote — printing it would put the literal words
  // "[object Object]" in front of a manager. Say that it moved and send them to look instead.
  if (isPlainObject(v)) return "something different now";
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
    notes: "this person's private note",
    id_type: "the ID on file", id_number: "the ID number",
    // Inventory, in the words the stock screens use — never the column name. "counted_base" in
    // front of a person counting tomatoes would mean nothing.
    counted_base: "the counted quantity",
    reorder_level: "the reorder level",
    purchase_factor: "the pack size",
    purchase_uom: "the unit it's bought in",
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

      // CLOSED, BUT WE CAN'T PROVE WHEN. `closed_at` is set by the close trigger, but CLAUDE.md
      // names two real paths that don't go through it — "a script's bare UPDATE sessions SET
      // status='closed'" and a hand-run SQL fix. Those left `closed_at` null, so `closed` was 0,
      // so the test below could never fire and a saved change was applied to a CLOSED table.
      // With no timestamp there is no way to show the person acted first, and the safe answer to
      // "I can't tell" is to ask a human — never to write to a table that has been settled.
      if (isClosed && !closed) {
        return {
          code: "clash_table_closed",
          plain: `Table ${t} has been closed and billed since you did this.`,
          todo: `Nothing was applied. If these dishes were served, add them to a new bill for table ${t}.`,
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
