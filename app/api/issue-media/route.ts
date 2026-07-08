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
import { userFromCookie, USER_COOKIE } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { panelRestaurantId } from "@/lib/panelScope";
import { storeIssueMedia, type MediaKind } from "@/lib/issues";

export const dynamic = "force-dynamic";
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function POST(req: NextRequest) {
  // Staff login FIRST (a device can hold both cookies — see requireRole's note), else admin.
  let staff = null;
  try { staff = await userFromCookie(req.cookies.get(USER_COOKIE)?.value); } catch { /* treat as not-staff */ }
  const isAdmin = tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
  if (!staff && !isAdmin) return bad("Not authorised — please log in.", 401);

  const rid = panelRestaurantId(req, { user: staff });
  if (!rid) return bad("No restaurant scope — open this panel from the admin console.", 400);

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
