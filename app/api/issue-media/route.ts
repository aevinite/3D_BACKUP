// /api/issue-media — upload ONE attachment (photo or voice note) for an issue that a
// staff panel is about to raise. Returns { url }. The panel then POSTs its /issue with
// that URL (see lib/issues.ts → raiseIssue).
//
// Multipart, so it lives in its OWN route (the panels' [...path] POST parses JSON and
// is wrapped in the offline idempotency guard — neither fits a file body). Media
// upload is NOT queued offline: with no connection there's nothing to upload to, so
// the panel only offers attachments while online and sends text-only otherwise.
//
// Gate: any logged-in STAFF member (manager/kitchen/tablet) OR the admin super-user.
// The restaurant is taken from the session (panelRestaurantId), never from the body —
// a staff member can only attach media for their OWN restaurant; an admin uses the
// per-tab ?rid pin / act-as cookie, exactly like the panels' other calls.
import { NextRequest, NextResponse } from "next/server";
import { userFromCookie, USER_COOKIE, AuthDbError } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { panelRestaurantId } from "@/lib/panelScope";
import { storeIssueMedia, type MediaKind } from "@/lib/issues";
// The one sentence a person reads when the database didn't answer — shared with every panel route.
import { BUSY_MESSAGE } from "@/lib/dbRefusal";

export const dynamic = "force-dynamic";
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function POST(req: NextRequest) {
  // Staff login FIRST (a device can hold both cookies — see requireRole's note), else admin.
  //
  // "THE DATABASE DIDN'T ANSWER" IS NOT "YOU ARE NOT LOGGED IN" (T10 sweep, finding F2).
  //
  // This catch used to swallow everything with the comment "treat as not-staff". That reading is
  // right for a BAD or EXPIRED cookie and wrong for the other thing `userFromCookie` throws:
  // `AuthDbError`, raised when the staff_users lookup itself fails after its own retry. A sustained
  // DB/DNS flap therefore turned a signed-in cook into "nobody", the `!staff && !isAdmin` line
  // answered 401, and public/panels/issue-raise.js — which throws on any non-ok upload — put
  // "Couldn't send: Not authorised — please log in." on the screen of somebody who was logged in,
  // and threw away the photo, the voice note AND the typed report with it.
  //
  // lib/userAuth.ts states the rule this breaks in its own words: "A transient outage must surface
  // as 503 ('try again'), never as 'please log in'." So the two are told apart: a bad cookie still
  // falls through to the admin check exactly as before, and a database blip answers `busy` — the
  // same 503 + `X-LFH-Busy` shape every other panel route gives, which the device's offline layer
  // already knows how to read (lib/panelFailure.ts).
  let staff = null;
  try {
    staff = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  } catch (e) {
    if (e instanceof AuthDbError) {
      console.error("[issue-media] auth lookup failed:", e.message);
      return NextResponse.json(
        { error: BUSY_MESSAGE, busy: true },
        { status: 503, headers: { "X-LFH-Busy": "1" } },
      );
    }
    /* anything else: a bad/expired cookie — treat as not-staff, as before */
  }
  // `await` MATTERS HERE and its absence made this gate a no-op (sweep 2026-08-04). tokenIsValid is
  // async, so `const isAdmin = tokenIsValid(…)` is a Promise — always truthy — which made `!isAdmin`
  // always false and the 401 below UNREACHABLE. Anyone could reach the upload; the only thing left
  // in the way was panelRestaurantId needing a `?rid=`, which a caller supplies themselves.
  const isAdmin = await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
  if (!staff && !isAdmin) return bad("Not authorised — please log in.", 401);
  // A signed-in staff member is scoped to their OWN restaurant by panelRestaurantId. Only the admin
  // may name one — and only the admin's cookie makes `?rid=` mean anything (see lib/panelScope.ts).

  const rid = panelRestaurantId(req, { user: staff });
  if (!rid) return bad("This screen doesn’t know which restaurant it is for — open it from the admin console.", 400);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = String(form?.get("kind") || "") as MediaKind;
  if (!(file instanceof File)) return bad("Missing file.");
  if (kind !== "image" && kind !== "audio") return bad("Unknown attachment kind.");

  try {
    const url = await storeIssueMedia(rid, file, kind);
    return NextResponse.json({ ok: true, url, kind });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Upload failed.", 400);
  }
}
