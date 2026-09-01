// panelFailure.ts — the ONE answer every staff panel route gives when its handler threw.
//
// Each panel route (manager / kitchen / waiter tablet / inventory) ends in a catch-all that
// records the failure and answers the device. They used to build that answer themselves:
//
//     return err(refusalMessage(e), refusalStatus(e));
//
// Four copies of the same decision, and none of them carried the one thing the device needs to
// know: whether this failure was "your request was wrong / my code broke" or "I couldn't reach
// the database just now". The second one is temporary — by the owner's rule it takes the SAME
// path as no internet (CLAUDE.md, the rush section) — and the device can only act on that if it
// is TOLD, which is what the `busy` flag and the X-LFH-Busy header are for:
//
//   · public/sw.js answers the read from the copy saved on the device and stamps it, so the
//     offline bar says "showing saved data from 7:42 pm" instead of the screen breaking;
//   · public/panels/outbox.js keeps a write and replays it (it already did this for any 5xx —
//     unchanged, the status is still ≥500);
//   · the panel's api() marks the error `busy`, so a toast reads like a moment, not a fault.
//
// Deliberately a HEADER as well as a body flag: the service worker has to decide before reading
// the body, and re-reading a body it has to pass on is what corrupts a stream.
//
// It reports the STATUS honestly and hides nothing: a 400 refusal stays 400, a missing row stays
// 404, a real bug stays 500, and the error row on the Repair board is written by the caller from the
// ORIGINAL error either way.
//
// ⚠️ That last line used to read "a real bug stays 500 WITH ITS OWN MESSAGE". It no longer does, and
// the long note above the function says why: the "own message" of an unclassified failure is
// Postgres prose, a JavaScript error or nothing at all. The status is unchanged; only the words a
// waiter reads moved (T25 round 2, 2026-08-31).
import { NextResponse } from "next/server";
import { isDataRefusal, isDbUnreachable, isMissingRow, refusalMessage, refusalStatus } from "@/lib/dbRefusal";

// ── AN UNCLASSIFIED FAILURE IS NOT A SENTENCE (T25 round 2, item 25, 2026-08-31) ────────────────
//
// `opts.unknown` was optional, and 7 of the 11 call sites omitted it — so for any failure the
// classifier does not recognise, the raw text went straight to the device. MEASURED by calling the
// real code with the failures this stack actually produces:
//
//     permission denied for table orders                                    → shown verbatim
//     Could not find the function public.lfh_x(uuid) in the schema cache    → shown verbatim
//     new row violates row-level security policy for table "orders"         → shown verbatim
//     TypeError: Cannot read properties of undefined (reading 'id')         → shown verbatim
//     JWT expired                                                          → shown verbatim
//     ""  (an Error with no message)                                        → an EMPTY toast
//
// The first three are not hypothetical on this codebase: a staff function whose grants drifted, and
// a brand-new function missing from the shared database, are both written down as things that have
// happened here. What a waiter mid-service can do about "permission denied for table orders" is
// nothing at all, and an empty toast is worse — it is a tap that produced no answer.
//
// The wrapping is why the classifier cannot help: all 46 rethrows in the panel routes are
// `throw new Error(error.message)`, which DROPS the Postgres code, so only the message-text
// patterns can still match. Those catch the common refusals (a duplicate key does get "Something
// with that name or number already exists") and nothing else.
//
// So the DEFAULT moved instead of the classifier. `refusalMessage()` is untouched — it is the shared
// decision used elsewhere, and `tests/error-text.test.mjs` deliberately pins that an app bug keeps
// its own message there, which is right for a log and for the Repair board. This file is the panel
// boundary: the one place whose only job is what a WAITER reads.
const UNKNOWN_TEXT = "Something went wrong at our end. Please try again — and tell the manager if it keeps happening.";

/**
 * @param e        whatever the handler threw
 * @param opts.unknown  what to say for a failure we can't classify. Defaults to a plain sentence
 *                      (UNKNOWN_TEXT) — NOT the original message, which for an unclassified failure
 *                      is either Postgres prose, a JavaScript error, or empty. Pass your own when
 *                      the screen can say something more useful ("Couldn't save the table's notes.").
 *                      The original text is kept: it is logged here and the caller still writes the
 *                      Repair-board row from the ORIGINAL error.
 */
export function panelFailure(e: unknown, opts?: { unknown?: string }): NextResponse {
  const busy = isDbUnreachable(e);
  const known = busy || isDataRefusal(e) || isMissingRow(e);
  let message = known ? refusalMessage(e) : (opts?.unknown ?? UNKNOWN_TEXT);
  // A classified refusal with an empty sentence would still be an empty toast. Belt and braces:
  // whatever route we came down, a person gets words.
  if (!message || !message.trim()) message = UNKNOWN_TEXT;
  if (!known) {
    // The raw text does not go to the device, so it must go somewhere: the server log, where the
    // Fix-NOW board and `vercel logs` both read it.
    const raw = e instanceof Error ? `${e.name}: ${e.message}` : String((e as { message?: unknown } | null)?.message ?? e ?? "");
    console.error("[panel] unclassified failure:", raw || "(no message)");
  }
  return NextResponse.json(
    { error: message, ...(busy ? { busy: true } : {}) },
    { status: refusalStatus(e), ...(busy ? { headers: { "X-LFH-Busy": "1" } } : {}) },
  );
}
