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
