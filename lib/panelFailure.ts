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
// 404, a real bug stays 500 with its own message, and the error row on the Repair board is
// written by the caller from the ORIGINAL error either way.
import { NextResponse } from "next/server";
import { isDataRefusal, isDbUnreachable, isMissingRow, refusalMessage, refusalStatus } from "@/lib/dbRefusal";

/**
 * @param e        whatever the handler threw
 * @param opts.unknown  what to say for a failure we can't classify. Some routes deliberately
 *                      answer a generic sentence there rather than pass an internal message to a
 *                      device (the waiter tablet's POST). Omit it to send the original message,
 *                      which is what the manager panel has always done.
 */
export function panelFailure(e: unknown, opts?: { unknown?: string }): NextResponse {
  const busy = isDbUnreachable(e);
  const known = busy || isDataRefusal(e) || isMissingRow(e);
  const message = !known && opts?.unknown ? opts.unknown : refusalMessage(e);
  return NextResponse.json(
    { error: message, ...(busy ? { busy: true } : {}) },
    { status: refusalStatus(e), ...(busy ? { headers: { "X-LFH-Busy": "1" } } : {}) },
  );
}
