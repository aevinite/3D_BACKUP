// Server-side gate for a PANEL ROUTE (e.g. /editor, /kitchen, /tablet). Runs in
// the Node runtime via the panel's layout.tsx — same pattern as the admin gate,
// because edge middleware can't reliably read the password env. Allows:
//   • a logged-in user whose role matches this panel, or
//   • the ADMIN super-user — but ONLY after deliberately picking a restaurant from
//     /aevinite (act-as cookie set by /api/admin/act-as/go), the same rule the owner
//     panel already enforces. A bare /tablet etc. with just the admin cookie used to
//     slip in silently scoped to restaurant #1; now it bounces to the admin console.
// Anyone else is bounced to /login (carrying ?next so they return after login).
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie, type Role } from "@/lib/userAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { isPanelEnabled, isRestaurantDeleted } from "@/lib/panelAccess";
import { getRestaurantBySlug, slugMovedTo } from "@/lib/tenant";

// Where each role lands after login. The canonical copy — LoginForm keeps a
// client-side duplicate (it can't import this server module).
export const ROLE_HOME: Record<Role, string> = { owner: "/owner", manager: "/manager", kitchen: "/kitchen", tablet: "/tablet" };

export async function requirePanel(role: Role, next: string): Promise<void> {
  const store = await cookies();
  // A logged-in user whose role matches this exact panel AND whose restaurant has
  // this panel ENABLED (mig 106) AND isn't in the recycle bin (mig 128) — any of
  // those failing bounces to login, so an already-signed-in user is locked out the
  // moment the admin disables their panel or bins their restaurant.
  // Staff is checked FIRST (mirrors requireRole's order, QA sweep 2026-07-03): on a
  // device holding both cookies, the person who explicitly signed in wins.
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  if (u && u.role === role && !(await isRestaurantDeleted(u.restaurant_id)) && (await isPanelEnabled(role, u.restaurant_id))) return;
  // Admin super-access: may hop into any panel — even one turned OFF for the
  // restaurant (admin sets up / inspects everything) — but only via the admin
  // console's act-as flow, which names WHICH restaurant. No scope → back to /aevinite.
  // (A binned restaurant stays reachable to the admin this way on purpose — the
  // recycle bin is an admin surface; guests + staff are the ones locked out.)
  if (await tokenIsValid(store.get(AUTH_COOKIE)?.value)) {
    if (store.get(ADMIN_ACT_COOKIE)?.value) return;
    redirect("/aevinite");
  }
  redirect(`/login?next=${encodeURIComponent(next)}`);
}

// Second half of the admin rule, run by the global panel PAGE (only pages can read
// searchParams — the layout above can't). An admin tab must arrive PINNED to one
// restaurant via ?rid=, which only the console's act-as/go link appends — so the
// ONLY way in is /aevinite → pick a restaurant → open its panel. A hand-typed
// /tablet with just the browser-wide act-as cookie (set up to 6h ago, maybe by a
// different tab, maybe for a different restaurant) bounces back to the console
// (owner, 2026-07-06: "you have to be specific about which restaurant").
// Returns the rid to forward into the panel iframe for a VERIFIED admin view, else
// null — so a staff login that hand-adds ?rid= gets it stripped (the API already
// ignored it for staff; stripping keeps the iframe's admin path bar honest too).
// A restaurant id is a uuid. A hand-typed ?rid that isn't one (bug #17, 2026-07-06)
// used to be forwarded raw, pinning the iframe to a non-existent restaurant → a blank
// panel. Reject the malformed value up front (no DB read on this hot path) and bounce
// to the console. (A well-formed-but-unknown uuid still just shows empty data — a far
// rarer, admin-only, self-inflicted case not worth a per-request existence read.)
const RID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function panelAdminRid(role: Role, rid: string | undefined): Promise<string | null> {
  const store = await cookies();
  // PER-TAB ADMIN PIN first (owner, 2026-07-28): a valid ?rid= + the admin cookie marks
  // THIS TAB as an admin view even when a real staff login for the same role exists in
  // the browser. Before, the staff check below answered first, so signing in as staff
  // in one tab silently turned every admin-opened panel tab into that staff session
  // (and Visit-panel landed on the staff view instead of the admin one). Only the
  // console's act-as flow appends ?rid=, and it's ignored without the admin cookie.
  if (rid && RID_RE.test(rid) && (await tokenIsValid(store.get(AUTH_COOKIE)?.value))) return rid;
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  if (u && u.role === role) return null; // real staff login — the layout already vetted them
  if (await tokenIsValid(store.get(AUTH_COOKIE)?.value)) {
    redirect("/aevinite"); // admin, but no (valid) restaurant named for THIS tab
  }
  return null; // not staff, not admin — the layout gate already bounced them to /login
}

// The panel iframe's src, with the admin view's per-tab pins carried into it.
//
// The panel UI lives in an iframe, so anything the console put on the OUTER url has to
// be handed across deliberately — the iframe can't see it. Three pins ride along, all
// admin-only and all ignored server-side for a real staff session:
//   rid   which restaurant this tab is looking at
//   view  "real" = render as the role really gets it, not the admin X-ray
//   as    WHICH PERSON to mark against (owner, 2026-08-02 — the profile's "Visit their
//         panel"). It is INDEPENDENT of `view`: naming a person changes whose permissions
//         the cyan marks describe, it does NOT strip the panel. The first cut chained the
//         two (`view === "real" || as`) and so a profile visit opened the limited panel
//         with nothing marked — the owner corrected that the same day: from the console
//         the admin always sees everything, and only the ribbon's toggle strips it.
// A malformed/unknown `as` is simply dropped by the server (lib/viewAsPerson) and the
// tab shows the ordinary admin view — the panel only ever names a person the server
// confirmed, so the ribbon can never claim a view it isn't showing.
export function panelIframeSrc(
  base: string, adminRid: string | null, pins?: { as?: string; view?: string },
): string {
  if (!adminRid) return base;
  let src = `${base}?rid=${encodeURIComponent(adminRid)}`;
  const as = pins?.as;
  if (as && /^[0-9a-f-]{36}$/i.test(as)) src += `&as=${encodeURIComponent(as)}`;
  if (pins?.view === "real") src += "&view=real";
  return src;
}

// Gate for a TENANT-SCOPED panel route (/r/<slug>/tablet|kitchen|manager).
//
// The slug is a LABEL + a CHECK — never the data source. Staff data stays scoped
// by the session cookie (lib/panelScope), so a typo'd or guessed slug can't leak
// anything: a staff session whose restaurant does NOT match the slug is bounced
// to THAT restaurant's login instead of silently showing their own restaurant
// under the wrong address. The admin super-user may open any slug; the returned
// restaurantId is then passed as ?rid= into the panel iframe (the existing
// admin view-as mechanism — ignored server-side for real staff sessions).
export async function requirePanelAt(
  role: Role, slug: string,
): Promise<{ restaurantId: string; admin: boolean }> {
  const r = await getRestaurantBySlug(slug);
  // ONE PLACE FOR ALL THREE SCOPED PANELS (mig 350). /r/<slug>/kitchen, /manager and /tablet all
  // come through here, so a staff bookmark or a taped-up link to a restaurant's OLD address lands
  // on its panel instead of a dead end. Only when the address resolves to nothing; a restaurant that
  // exists but has this panel switched off is handled below, where it belongs.
  if (!r) {
    const moved = await slugMovedTo(slug);
    if (moved) redirect(`/r/${moved}${ROLE_HOME[role]}`);
    notFound();
  }
  const store = await cookies();
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  if (u && u.role === role && u.restaurant_id === r.id && r.active && (await isPanelEnabled(role, r.id))) {
    return { restaurantId: r.id, admin: false };
  }
  // Admin super-access: any slug, even an inactive restaurant or a disabled panel
  // (admin sets up / inspects everything) — same bypass as the bare-route gate.
  if (await tokenIsValid(store.get(AUTH_COOKIE)?.value)) return { restaurantId: r.id, admin: true };
  redirect(`/r/${slug}/login?next=${encodeURIComponent(`/r/${slug}${ROLE_HOME[role]}`)}`);
}
