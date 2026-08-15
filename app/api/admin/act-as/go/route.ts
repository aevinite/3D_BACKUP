// GET /api/admin/act-as/go?rid=<restaurant_id>&to=</manager|/kitchen|...>[&uid=<owner>]
// The INSTANT quick-open: sets the act-as cookie and 302-redirects to the panel in ONE
// round trip. The click handler window.open()s this URL synchronously, so the tab
// appears the moment the admin clicks (owner 2026-07-04: quick-open "takes too much
// time" — the old flow awaited a POST before the tab even opened, which also risked
// popup blockers). Admin-gated like the POST route; `to` is whitelisted so this can
// never become an open redirect.
//   uid — OPTIONAL, for EVERY panel now (owner, 2026-08-02): WHICH PERSON to look
//   through. For to=/owner it is the "which owner?" chooser's pick, forwarded as ?as=
//   and honored by ownerScope after re-checking membership (owner 2026-07-25). For the
//   staff panels it is a person's "Visit their panel" button in their profile.
//   WE DO **NOT** ADD ?view=real HERE (owner, 2026-08-02, corrected the same day). The
//   first cut of this sent the admin straight to that person's stripped panel, on the
//   reasoning that "being someone means seeing their real panel". The owner's rule is the
//   opposite and it is the whole point of the admin view: from the console the admin
//   ALWAYS sees everything, with whatever that person lacks marked in cyan and listed in
//   the ribbon — and the top-right toggle is what strips it down to their real panel.
//   Landing on the stripped view first hides exactly the information the admin opened
//   the profile to get. Every pin is re-checked server-side on each call
//   (lib/viewAsPerson) — a bad uid just falls back to the plain admin view.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { logAction, deviceIdFrom } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const ALLOWED_PATHS = new Set(["/manager", "/editor", "/kitchen", "/tablet", "/owner"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rid = req.nextUrl.searchParams.get("rid") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  const uid = req.nextUrl.searchParams.get("uid") || "";
  // Check the id's SHAPE before it reaches a uuid column (T20 sweep, 2026-08-16). Without this a
  // stale bookmark or a mistyped link produced a raw Postgres 500 body instead of the tidy
  // "restaurant not found" below — every sibling admin route validates first.
  if (!UUID.test(rid) || !ALLOWED_PATHS.has(to))
    return NextResponse.json({ error: "rid and a known panel path required" }, { status: 400 });

  const r = (await sb.from("restaurants").select("id, name, deleted_at").eq("id", rid).limit(1)).data?.[0];
  if (!r) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });
  // A restaurant in the recycle bin has its guest menu switched off and its staff refused at
  // sign-in — so opening its panels would show a working screen for something the product treats
  // as gone. Refuse it here too, so all three doors agree.
  if (r.deleted_at) return NextResponse.json({ error: "That restaurant is in the recycle bin — restore it first." }, { status: 409 });

  // WALKING INTO A RESTAURANT IS RECORDED (T20 sweep, 2026-08-16). Reaching any restaurant's panel
  // with no password is the strongest thing this console can do, and it was the ONE admin action
  // that wrote nothing at all — every other one (owner changes, maintenance, retention, blocks,
  // log cleanup, exports) logs itself. Recorded on the `admin` panel, which the manager's own log
  // never shows, so this stays invisible to the restaurant exactly as the owner requires: it is a
  // record for HIM, not a hint for them.
  await logAction("admin", "admin_enter_panel", {
    restaurant_id: rid, actor: "admin", device_id: deviceIdFrom(req), level: "info",
    detail: `opened ${to} at "${r.name}"${uid ? " as a specific person" : ""}`,
  });

  // Same cookie the POST route sets; the redirect carries ?rid= so THIS tab stays
  // pinned to the restaurant even if the browser-wide cookie later changes. A chosen
  // PERSON (uid) rides along as ?as=: for the owner cockpit ownerScope re-checks that
  // they actually co-own this restaurant, and for the staff panels viewAsPerson
  // re-checks the restaurant + role on every single call. NO &view=real — the pin says
  // WHOSE permissions to mark against, never that the admin should stop seeing things
  // (see the header note). The toggle in the ribbon is the only thing that strips a panel.
  const asPin = uid ? `&as=${encodeURIComponent(uid)}` : "";
  const res = NextResponse.redirect(new URL(`${to}?rid=${encodeURIComponent(rid)}${asPin}`, req.nextUrl.origin), 302);
  // `secure` in production — same rule as the POST twin and both login doors (T17, finding F13).
  res.cookies.set(ADMIN_ACT_COOKIE, rid, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 6, secure: process.env.NODE_ENV === "production" });
  return res;
}
