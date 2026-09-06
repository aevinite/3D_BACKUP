// Editor API — the whole editor/server.js Express surface, ported into ONE Next
// catch-all route handler so it runs inside the single app (no separate :4001
// server). Faithful to the original: same paths (under /api/editor/*), same
// request/response shapes, same business guards. Uses the server-only
// service-role client.
//
// The editor's browser UI (public/panels/editor/app.js) calls fetch("/api/editor"
// + path), so e.g. /api/editor/all, /api/editor/orders/:id, etc. land here.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { signRows } from "@/lib/mediaLinks";
import { withIdempotency } from "@/lib/idempotency";
import { replayClash, clashJson, expectClash } from "@/lib/clash";
import { offPlanTable } from "@/lib/planTable";
import { menuTag } from "@/lib/menuDataServer";
import { logAction, logError, deviceIdFrom } from "@/lib/oplog";
// The manager panel is plain JS and cannot import this, so /oplog attaches the plain sentence to
// each error row rather than a second copy of the translator being written in JS (2026-09-02).
import { plainHeadline } from "@/lib/plainError";
import { recordRemoval, reasonFromBody } from "@/lib/removalAudit";
import { watchCancellations } from "@/lib/cancelWatch";
import { ADMIN_VIEW_ACTOR_ID } from "@/lib/logMarks";
import { discountCapPct, discountRole, overDiscountCap } from "@/lib/discountCap";
import { businessDayStartIso, businessDayDate } from "@/lib/businessDay";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { panelRestaurantId, emptyIdSegment } from "@/lib/panelScope";
import { mergeParentTable } from "@/lib/tableMerge";
import { enabledOwnedRestaurantIds } from "@/lib/panelAccess";
import { raiseIssue } from "@/lib/issues";
import { effectiveTaxRate, taxComponents, TAX_SETTINGS_COLUMNS, resolveTaxMode, isMrpDish, splitBill } from "@/lib/tax";
// The rate ONE order was charged at is decided in the same file the printed bill uses, so the
// day-close sheet and the paper can never answer differently — see billTaxOf() below.
import BILLDOC from "@/public/panels/billdoc.js";
import { closeSession, clearTableSignals } from "@/lib/sessionClose";
import { openTableSession } from "@/lib/openSession";
import { softDeleteOrders } from "@/lib/softDelete";
// The admin stays invisible to a MANAGER too — the Audit now obeys the rule the Activity log
// already did (lib/auditActor.ts).
import { auditForReader, forReader } from "@/lib/auditActor";
import { auditAfter, auditBillHtml, auditBillSides } from "@/lib/auditDetail";
import { notifyAggregator } from "@/lib/aggregators";
import { PAYMENT_METHODS } from "@/lib/payments";
// The kitchen-ticket print queue (mig 269 + 335). Shared with the kitchen route: two panels now
// claim from the same rows, and one implementation is what stops them drifting into two ideas of
// "claimed" — which would be a ticket printed twice.
import { pendingKotJobs, claimKotJobs, finishKotJob, stationView, takeStation, releaseStation, mayClaim, touchStation, waitingToPrint, STUCK_AFTER_MS, SLOW_ACCEPT_MS} from "@/lib/printQueue";
// A COMPUTER (a helper) can own the paper now — mig 341. When one does, no screen prints that kind:
// a helper prints on the printer the address book names, a screen prints on whatever its own machine
// defaults to, and both printing means the same ticket in two rooms.
import { helperFor, helpersFor, queueJob, targetsFor, targetFor, screenMayPrint } from "@/lib/printHelpers";
// SETTING THE PRINTERS UP FROM THE MACHINE THAT HAS THEM (mig 367, owner 2026-08-27). The same board
// the admin console draws, narrowed to this computer — same file, same four steps, same words.
import {
  agentForDevice, createAgent, writeRoutes, readRoutes, syncKotSwitch, isRoutableKind, ROUTABLE_KINDS,
  panelForRole,
} from "@/lib/printHelpers";
import { printBoardState, helperFiles, stationFiles } from "@/lib/printBoard";
import { helperScript, HELPER_FILENAME, HELPER_AUTOSTART, type HelperOs } from "@/lib/printHelperScript";
// How long a BACKUP printer waits before it will take a ticket, so the kitchen's own printer always
// gets first refusal. Deliberately short: a cook waiting on a ticket notices 30 seconds.
// BACKUP_PRINTER_MS is gone with the backup screen (owner, 2026-08-30): there is no second room
// waiting its turn, so there is no window for it to wait.
// May a COUNTER (manager) screen print this restaurant's kitchen tickets — and only as the backup?
//
// It asks ONE thing now: the Kitchen slips route (mig 369). It used to ask two — the route AND
// mig 336's coarse `kot_print_target` — and the printing sweep caught them disagreeing, with the
// OLDER one winning: a route saying "the manager screen prints the kitchen slips" was refused
// because an admin had once set "kitchen" months before. Two settings for one question is how the
// owner's own choice ended up doing nothing, so there is one left.
//
// `backup` is no longer a setting at all: the retired 'both' went to `backupPanel` on the route,
// and then `backupPanel` itself went (owner, 2026-08-30 — there is no backup printer, a failure is
// reported instead). Both rungs of mig 107 still gate everything (the admin allowed auto-print
// AND the restaurant switched it on). Asked on the pending read AND again at the claim.
// `backup` LEFT THIS SHAPE on 2026-09-04 (T11 sweep #8). It was `!!may.backup` off
// screenMayPrint(), which never set `backup` at all once the backup screen was deleted on
// 2026-08-30 — so it answered false on every request, and no panel read it. Removed with the
// declaration it came from rather than left as a constant nobody trusts.
// ── THE ADDRESS BOOK IS READ ONCE, NOT FOUR TIMES (T24 sweep #8, 2026-09-06) ─────────────────
// `helperFor` and `targetFor` each do the SAME pair of reads — the routes row and the agents view.
// helpersFor()/targetsFor() exist precisely because "asking helperFor() three times on a poll is
// three times the same two queries" (their own comment). The pending-jobs poll then asked FOUR
// times over: helpersFor + targetsFor for all three kinds, and this function asking again for the
// kitchen slips it already had in both. That is 8 reads of two small tables every 20 seconds, per
// manager device, plus one on every ops breadcrumb — for 4 reads' worth of information.
//
// So the two answers can be handed in when the caller already holds them. Nothing else changes:
// with no `pre` this behaves exactly as before, which is what the two callers further down do.
async function counterPrintTarget(
  rid: string,
  pre?: { helper: Awaited<ReturnType<typeof helperFor>>; route: Awaited<ReturnType<typeof targetFor>> },
): Promise<{ mayPrint: boolean; target: string; helper?: Awaited<ReturnType<typeof helperFor>> }> {
  const [stQ, helper, route] = await Promise.all([
    sb.from("settings").select("auto_print_kot, auto_print_kot_allowed, modules").eq("restaurant_id", rid).maybeSingle(),
    pre ? Promise.resolve(pre.helper) : helperFor(rid, "kot"),
    pre ? Promise.resolve(pre.route) : targetFor(rid, "kot"),
  ]);
  const st = stQ.data as { auto_print_kot?: boolean; auto_print_kot_allowed?: boolean; modules?: Record<string, { paused?: boolean }> } | null;
  // A STOPPED QUEUE holds every screen too, not just the helper — otherwise "stop the queue" would
  // stop the computer and let a screen carry on printing, which is not stopping anything.
  const paused = st?.modules?.printing?.paused === true;
  const on = !paused && st?.auto_print_kot === true && st?.auto_print_kot_allowed === true;
  // `target` is kept in the shape only because the panels still read it to say WHERE paper goes in
  // plain words. It is derived from the route now, never stored.
  // "both" is gone with the backup screen: a room either prints the kitchen slips or it does not.
  const target = route.kind === "screen"
    ? (route.panel === "manager" ? "counter" : "kitchen")
    : "kitchen";
  // A named helper takes the kitchen slips off every screen — including this one, and including the
  // backup path. The panel is told WHO has them so it can say so rather than going quiet.
  if (helper.owned) return { mayPrint: false, target, helper };
  const may = screenMayPrint(route, { panel: "manager", personId: null, deviceId: null });
  // A person/device narrowing is checked per-request elsewhere (this helper has no request in hand),
  // so "may a manager screen print at all" is the panel-level answer only.
  // WITH NO ROUTE AT ALL, THE DEFAULT ROOM IS THE KITCHEN — so a manager screen does NOT auto-print.
  // That is exactly what the retired kot_print_target defaulted to ('kitchen'), and it matters: a
  // manager panel left open on a restaurant that has never touched the Printing board would
  // otherwise start pulling kitchen tickets it never used to. Caught by verify:printing-sweep phase
  // 22 before this shipped; my first version returned true here.
  // (After mig 369 every existing restaurant HAS a kitchen-slip route, so this branch is only a
  // brand-new one — where "the kitchen prints" is the right thing to assume.)
  const panelOk = route.kind === "screen" ? route.panel === "manager" : false;
  return { mayPrint: on && panelOk, target, helper };
}

import { settleBillInParts, reverseSplitLegs, PAY_LATER } from "@/lib/paySplit";
import { clampPerRow } from "@/lib/floorLayout";
import { worthLogging, pgError } from "@/lib/dbRefusal";
// ONE answer for a caught failure, so a database that didn't reply is told apart from a bug
// and the device can fall back to what it already has (lib/panelFailure.ts).
import { panelFailure } from "@/lib/panelFailure";
import { MANAGER_POWER_FLAGS, getOwnerEntitlements } from "@/lib/ownerEntitlements";
import { isTableTag, tableTagsLadder, khataLadder, banquetLadder, tableOpsLadder, takeOrdersLadder, parcelLadder, platformLadder, allModuleLadders, COMP_TAGS, ON_THE_HOUSE_METHOD, type TableTag } from "@/lib/tableTags";
import { tableAssignLadder } from "@/lib/tableAssign";
import { PERMISSIONS, moduleKey, ABSENT_ON_POWERS } from "@/lib/accessModel";
import { managerTabsOff, managerTabOn, managerSettingsOff, managerGrantValue, isConfigurableGrant, GRANT_FLAGS, NODE_BY_ID, defOf, MENU_PART_DEFAULTS, type ManagerTabKey } from "@/lib/accessTree";
import { managerCan } from "@/lib/managerCan";
import { dashboardReach, clampDashRange, billsReach } from "@/lib/dashRange";
import { saveBillCustomer } from "@/lib/billCustomer";
import { sharedFloorSummary, invalidateFloor } from "@/lib/floorSummary";
import { viewAsPerson, personLabel } from "@/lib/viewAsPerson";
// What never leaves the server inside a settings row (the delivery apps' connection keys).
import { panelSafeSettings } from "@/lib/panelSettings";
import { safeSearch } from "@/lib/searchText";

export const dynamic = "force-dynamic"; // always live, never cached

// ── THE INSTALL TEXT, BUILT FOR THE MACHINE ASKING FOR IT ────────────────────────────────────────
// The site the helper must talk to is taken from THIS request, never from a constant: a code minted
// on backup points at backup, one minted on the live site points at the live site. A helper aimed at
// the wrong site is a machine that never prints and never says why.
const originOfReq = (req: NextRequest) => {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
};

/** What this browser is running on, so the setup steps open on the right operating system without
 *  anybody having to choose. A guess, and treated as one: the other two are always one tap away. */
const osOfRequest = (req: NextRequest): HelperOs => {
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "mac";
  return "linux";
};

const PANEL_OS_LIST: HelperOs[] = ["mac", "windows", "linux"];
/** Shown ONCE, when a code is minted or replaced — it is stored only as a hash, so it can never be
 *  read back. A lost code is REPLACED, never recovered, and the screen says so beside the button. */
const panelScriptsFor = (origin: string, code: string, label: string) =>
  Object.fromEntries(PANEL_OS_LIST.map((os) => [os, {
    filename: HELPER_FILENAME[os], autostart: HELPER_AUTOSTART[os],
    text: helperScript(os, { origin, code, label }),
  }]));

// Gate: only a logged-in MANAGER (or the admin super-user) may touch this API.
// Returns a 401 response to short-circuit, or null to let the handler proceed.
async function gate(req: NextRequest): Promise<{ user: StaffUser | null } | NextResponse> {
  const g = await requireRole(req, "manager");
  // transient = the auth lookup itself failed (DB blip) — 503 keeps the panel logged
  // in and retrying; only a genuinely bad/expired cookie gets the 401 → /login bounce.
  if (!g.ok) {
    return g.transient
      ? NextResponse.json({ error: "Server can't reach the database — retrying." }, { status: 503 })
      : NextResponse.json({ error: "Not authorised — please log in." }, { status: 401 });
  }
  return { user: g.user };
}
// (panel restaurant scope now comes from lib/panelScope → panelRestaurantId, which
//  also honours the admin's "view as" restaurant. DEFAULT_RESTAURANT_ID is still used
//  below for menu-item id namespacing.)
// managerCan() LIVES IN lib/managerCan.ts SINCE 2026-08-27 — unchanged, just shared. A second
// door now asks it (/api/pair, where a print helper is adopted by a signed-in human), and a
// permission rule with two copies is the bug class the access rebuild exists to remove.
const permDenied = (what: string) => err(`Your owner hasn't given managers permission to ${what}.`, 403);

// A row on the Platform board is gated by different rungs depending on what it is: a staff
// PARCEL (source 'parcel') rides the parcel module + power; a delivery order (zomato/swiggy/
// website=takeaway) rides the platform module + power. Admin/owner pass via managerCan's
// higher-view bypass; for a real manager the module must ALSO be effective (mig 209).
async function platformOrParcelCan(g: { user: StaffUser | null }, rid: string, source?: string): Promise<boolean> {
  const isParcel = source === "parcel";
  const flag = isParcel ? "parcel" : "platform";
  if (g.user) { const ladder = await (isParcel ? parcelLadder : platformLadder)(rid); if (!ladder.effective) return false; }
  return managerCan(g, rid, flag);
}

// Activity-log visibility (owner 2026-07-24, access panel "Activity log" power). Deliberately
// NON-BREAKING: a manager keeps the log UNLESS the admin or owner has EXPLICITLY switched
// view_logs off in the access panel (manager_permissions.view_logs === false). An absent flag =
// keep it (every restaurant that
// never touched the new panel is unchanged). Owner + admin (no staff cookie) always see it.
async function canViewLogs(g: { user: StaffUser | null }, rid: string): Promise<boolean> {
  const u = g.user;
  if (!u || u.role === "owner") return true;
  const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements").eq("id", rid).maybeSingle()).data as
    { manager_permissions?: Record<string, boolean>; owner_entitlements?: Record<string, boolean> } | null;
  // (power_view_logs left with the rest of the old admin-cap rung on 2026-08-06 — see managerCan.
  //  The admin's switch for this menu is the Feature half of Access → Manager → Audit & logs.)
  // Per-person override (mig 115) — same precedence as managerCan: the individual's
  // setting wins over the restaurant-wide grant but never over the admin cap above (it
  // was accepted by set_permissions but never read here — a stored-but-dead key, fixed
  // 2026-07-26).
  const ov = u.permissions?.view_logs;
  if (ov === "on" || ov === "pin") return true;
  if (ov === "off") return false;
  if (r?.manager_permissions?.view_logs === false) return false;        // owner pulled it back from managers
  return true;
}

// Which VIEWS of the Audit & logs tab a real manager gets (owner, 2026-08-02 — the Access
// screen's "Audit & logs" sub-options): removals / activity / customers, stored at
// access_config.view_logs.manager_opts. ABSENT MEANS ON (the model's def is true), so no
// restaurant changes until an admin switches a view off. Admin and owner always pass —
// these sub-options limit managers only.
async function logPartAllowed(g: { user: StaffUser | null }, rid: string, part: "removals" | "activity" | "customers"): Promise<boolean> {
  const u = g.user;
  if (!u || u.role === "owner") return true;
  const opts = ((await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
    { view_logs?: { manager_opts?: Record<string, boolean> } } | null)?.view_logs?.manager_opts;
  if (!opts || typeof opts !== "object") return true;
  return opts[part] !== false;
}

// ── MANAGER'S MENU rung (access rebuild, 2026-07-31) ────────────────────────
// Which manager tabs this RESTAURANT has. Hiding a tab in the panel is never the only
// guard, so a switched-off tab's endpoints refuse here too — otherwise typing the URL
// still reached it. Deliberately ONE gate called from every handler rather than a check
// sprinkled per endpoint: a new endpoint under an existing tab is covered automatically.
// The lookup only runs for paths that belong to a tab, so ordinary requests pay nothing.
// A live-order dish operation: `items/<id>/<action>`. These belong to the floor (Tables/Bills,
// both FIXED menus every manager has), never to the menu editor — see the editor row below.
const ORDER_ITEM_ACTION = /^items\/[^/]+\/(delete|qty|note|removed|status)$/;
const TAB_PATHS: { tab: ManagerTabKey; test: (p: string, method: string) => boolean }[] = [
  { tab: "ratings", test: (p) => p === "ratings" || p.startsWith("ratings/") },
  // The Audit & logs tab owns THREE reads: the activity log (oplog), the removals record
  // (GET /audit) and the customer log (GET /users). READS ONLY for the last two: POST /audit
  // is the RECORDING of a removal — that must land whether or not anyone may view the tab,
  // or switching the menu off would quietly stop the audit trail (the compliance record).
  { tab: "log", test: (p, method) => p === "oplog" || p.startsWith("oplog/") || ((p === "audit" || p === "users") && method === "GET") },
  // "bills" LEFT this gate (owner, 2026-08-02): the Bill menu is FIXED — every manager has it,
  // so there is no view_bills question any more and its endpoints are plain manager endpoints.
  // The two dangerous actions inside it (delete / reopen a bill) keep their own managerCan
  // gates at their handlers — the TAB being fixed hands over nothing dangerous.
  // THE MENU EDITOR ONLY — not the live floor (fixed 2026-08-02, found by driving Aangan Garden,
  // which has Edit menu switched off). `items` is two completely different things sharing a word:
  //   · the MENU editor      — POST `items` (create/edit a dish), DELETE `items/:id`
  //   · a LIVE ORDER's dish  — POST `items/:id/{delete,qty,note,removed,status}`
  // The old pattern matched both, so switching Edit menu off ALSO stopped a manager marking a dish
  // SERVED, removing a dish a guest cancelled, and fixing a quantity — the floor, refused with
  // "the menu editor isn't part of this restaurant's manager panel". Nothing about the guest's food
  // belongs to the menu-editor switch, so the order-item actions are excluded by name.
  { tab: "editor", test: (p) => /^(categories|filters)(\/|$)/.test(p) || (/^items(\/|$)/.test(p) && !ORDER_ITEM_ACTION.test(p)) },
];
async function tabGate(g: { user: StaffUser | null }, rid: string, path: string[], method = "GET"): Promise<NextResponse | null> {
  if (!g.user) return null;                         // admin super-user keeps every tab
  const p = path.join("/");
  const hit = TAB_PATHS.find((t) => t.test(p, method));
  if (!hit) return null;
  const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config;
  // A menu row moves TWO stored values — the tab list and the manager power behind it — so the
  // gate checks both. Checking only the tab left the power writable but unread, which is the
  // dead-switch shape this whole rebuild exists to remove (caught by verify:access, 2026-08-01).
  //
  // Each flag is written out AT its managerCan call rather than looked up from a map: a map
  // hides the flag name from anything reading this file, and "is this permission actually
  // consulted anywhere" is a question both the guard and a person need to answer by reading.
  const granted =
    hit.tab === "editor"  ? await managerCan(g, rid, "edit_menu")
    : hit.tab === "ratings" ? await managerCan(g, rid, "view_ratings")
    :                         await managerCan(g, rid, "view_logs");
  if (managerTabOn(cfg, hit.tab) && granted) return null;
  const LABEL: Record<ManagerTabKey, string> = { editor: "the menu editor", ratings: "guest ratings", log: "the Audit & logs tab" };
  return err(`${LABEL[hit.tab]} isn't part of this restaurant's manager panel.`, 403);
}

// ── The nine parts of "Edit the menu" ─────────────────────────────────────────────
// Access → Manager's menu → Edit menu (Editor) lists nine sub-options, and the owner's
// rule for every one of them (2026-08-03) is the same three things: OFF means the control
// is GONE (not merely disabled), ON means it genuinely works, and an admin looking in sees
// it MARKED rather than missing. That only holds if ONE resolution answers all three, so
// this is it — the panel's whoami, the save path and the delete path all read from here.
export const MENU_PART_KEYS = [
  "edit_options", "add_dish", "edit_dish", "edit_price",
  "delete_dish", "mark_86", "manage_categories", "manage_filters", "edit_3d",
] as const;
type MenuParts = Record<string, boolean>;

// Resolve the nine for ONE role against a restaurant's stored manager_opts.
//   • admin (no staff cookie) — everything, always. Visible = usable is the X-ray rule.
//   • manager — NON-BREAKING: an unconfigured restaurant keeps allow-all (what every
//     un-migrated restaurant has always had); once configured, only an EXPLICIT true allows.
//   • owner / any other staff role — the menu is theirs, EXCEPT the 3D model.
//
// edit_3d is the one exception in both branches, and deliberately so. Attaching a model
// writes to storage that EVERY restaurant reads, so it defaults OFF in the access model
// (`def: false`) and it is not something an un-migrated restaurant should acquire by
// accident. Before today it was hard-wired "admin only", which made the switch the owner
// had put on the Access screen a dead one — granting it changed nothing. Now the switch
// decides for a manager, and only for a manager.
// ── A MISSING KEY MEANS THE ROW'S DEFAULT, NOT "NO" (fixed by sweep T6, 2026-08-10) ─────────────
//
// This used to read: "if the restaurant has ANY stored manager_opts, only an explicit `true`
// allows". That is a SECOND rule for a missing value, and the Access screen has always used the
// first one — `nodeValue` → `present(stored, defOf(node))`, i.e. nothing stored ⇒ the row's own
// default, and eight of the nine rows default to ON.
//
// So a restaurant configured BEFORE a sub-option was added had that option stored nowhere, and the
// two sides answered differently: the screen said ON, this function said NO. Measured on the
// backup database, 7 of 9 restaurants were affected — six on "Customisation", and pizza-palace on
// "Customisation", "Change a price" AND "Mark as sold out". An admin read "Change a price: ON",
// told the restaurant their manager could fix prices, and the manager had no such control, with no
// switch anywhere able to grant it because the switch already said ON.
//
// Both sides now go through MENU_PART_DEFAULTS (lib/accessTree.ts), derived from the same rows the
// screen draws. A key that IS stored still wins in both directions, so every `false` an admin
// deliberately set stays exactly as they set it — only "never stored" changes meaning, and it
// changes to what the admin has been reading all along. Guarded by verify:access so the two
// resolutions can never drift apart again.
function resolveMenuParts(role: "admin" | "manager" | "other", mo: Record<string, boolean> | null | undefined): MenuParts {
  const p: MenuParts = {};
  const stored = mo && typeof mo === "object" ? mo : null;
  for (const k of MENU_PART_KEYS) {
    p[k] = role === "admin" ? true
      : role !== "manager" ? k !== "edit_3d"
      : typeof stored?.[k] === "boolean" ? stored[k]
      : MENU_PART_DEFAULTS[k] === true;
  }
  return p;
}

// The current viewer's nine, in ONE read. A dish save asks about up to five of them, and
// the old one-question-per-call helper re-read the restaurant row every single time.
async function menuPartsFor(g: { user: StaffUser | null }, rid: string): Promise<MenuParts> {
  const u = g.user;
  if (!u) return resolveMenuParts("admin", null);
  const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
    { edit_menu?: { manager_opts?: Record<string, boolean> } } | null;
  return resolveMenuParts(u.role === "manager" ? "manager" : "other", cfg?.edit_menu?.manager_opts);
}

// One question against the same resolution. Caller must already have passed managerCan(edit_menu).
async function menuSubAllowed(g: { user: StaffUser | null }, rid: string, action: string): Promise<boolean> {
  return (await menuPartsFor(g, rid))[action] === true;
}

// ── NOBODY AT THE RESTAURANT REMOVES A BILL (owner, 2026-08-16) ──────────────────────────────
// His words, after being shown that a cancelled bill could still draw an invoice number: "I don't
// want to give permission to the restaurant owner to delete the bill because he will fake the bill
// and delete the bill … so what can we do that the restaurant doesn't cheat, and at the same time
// we can keep the track?"
//
// The answer is that CANCEL becomes the only way a bill leaves the working list. A cancel is a ₹0
// sale that stays visible with its reason, its person and its time; a delete is the shape a books
// check objects to, and it is the capability that put PetPooja's founders under summons
// (docs/COMPLIANCE-GUARDRAILS.md §2).
//
// THE OWNER IS INSIDE THE RESTAURANT, so the owner loses it too — that is the whole point, and it
// is the sentence this product sells: a client cannot make a real sale vanish, and cannot ask us
// to either. Note what a delete ever actually did: lib/softDelete.ts keeps the row and every tax
// figure (Z-report, GST report, owner money) still counts it, so no RECORD changes here. What goes
// is the button.
//
// The Aevidine ADMIN console (no staff cookie) keeps it for support work — still a soft delete,
// still into the ledger and the 90-day recycle bin.
//
// WHAT WAS DELETED WITH THIS: the per-manager resolution that read access_config.delete_bill.on,
// then the person's own `permissions.delete_bill` override, then manager_permissions.delete_bill,
// then the legacy void_bills.manager_opts.delete_bill (built 2026-07-24, corrected 2026-08-01/02/04).
// Those stored values are LEFT IN THE DATABASE untouched — nothing reads them now, and if the row
// is ever handed back it should be rebuilt deliberately rather than resurrected. The matching rows
// went from lib/accessTree.ts and lib/accessModel.ts in the same commit.
// REJECTED (owner, 2026-08-16) — docs/REJECTED-IDEAS.md → R27. This function must keep answering
// true for the Aevidine admin console ONLY. Do not widen it to the restaurant owner or a manager,
// and do not re-introduce a grantable "Delete a bill" permission to feed it: *"I don't want to give
// permission to the restaurant owner to delete the bill because he will fake the bill and delete the
// bill … what can we do that the restaurant doesn't cheat, and at the same time we can keep the
// track?"* Cancel is the only route out of a bill for anyone at the restaurant — a ₹0 sale that
// stays visible with its reason, its person and its time. See docs/COMPLIANCE-GUARDRAILS.md §3.
// (Marker added 2026-08-17: the rule was recorded in the doc but had no comment in the code, so the
// guard was not enforcing it — and R27 was filed under the doc's "Reversed" heading by mistake.)
async function canDeleteBill(g: { user: StaffUser | null }, _rid: string): Promise<boolean> {
  return !g.user; // the Aevidine admin console only; owner and manager alike get cancel, not delete
}

// ── IS LOG RETENTION FROZEN BY THE PLATFORM? (owner, 2026-08-21) ─────────────────────────────
// His answer to "should the 1-month cap be enforced?": *"make sure admin can do only lock for
// mangaer and ever admin do will be visible to manager"*. So the admin does not cap the product
// behind the restaurant's back — the admin LOCKS, the panel SHOWS the lock, and this is the
// server half that makes it real (hiding is never the only guard).
//
// Read from app_config (mig 186) — the same row the admin console writes.
//
// DELIBERATELY NOT CACHED. The first version held it for 30s, and the cost of that showed up
// immediately in testing: after the admin turned the lock ON, a manager's screen still said
// "owner only" and the server still ACCEPTED an owner's write, for up to half a minute. A policy
// switch whose whole purpose is "this is now frozen, and everyone can see it" cannot be eventually
// consistent — and what it buys is nothing: this is one primary-key lookup of one tiny row,
// alongside the several queries whoami already runs. Egress discipline is about not re-reading
// whole tables (docs/SAAS-EFFICIENCY-PLAYBOOK.md), not about shaving a single indexed row read.
async function retentionLock(): Promise<{ locked: boolean; at: string | null }> {
  const r = await sb.from("app_config").select("value").eq("key", "log_retention_lock").maybeSingle();
  // A FAILED read must not quietly unlock the platform: treat it as locked-unknown → locked,
  // so a database hiccup can never widen what a restaurant may do.
  if (r.error) return { locked: true, at: null };
  const val = (r.data?.value || {}) as Record<string, unknown>;
  return { locked: val.locked === true, at: typeof val.at === "string" ? val.at : null };
}
// May THIS caller change the two log-retention windows from the panel? Takes the lock it was
// already given, so one request never reads the same row twice.
//   · a real manager — never. Not this switch: a retention dial in the hands of the person it
//     audits is an off switch with extra steps (docs/COMPLIANCE-GUARDRAILS.md §3).
//   · the owner — yes, unless the admin has locked it.
//   · the Aevidine admin console (no staff cookie) — always; the lock is the admin's own, and the
//     admin console is not the party it binds.
function canSetRetention(g: { user: StaffUser | null }, lock: { locked: boolean }): { ok: boolean; code: string } {
  if (!g.user) return { ok: true, code: "" };
  if (g.user.role !== "owner") return { ok: false, code: "retention_manager_blocked" };
  return lock.locked ? { ok: false, code: "retention_locked" } : { ok: true, code: "" };
}

// Gate for the KOT ▾ menu (Table & KOT operations — canonical module ladder, mig 177).
// ADMIN X-RAY rule (owner, 2026-07-22): the admin super-user (no staff cookie) passes
// every rung — from the admin console the greyed-out button must genuinely work, the
// same bypass tabletPerm gives the admin. Everyone else follows the ladder:
// Rung 1: the module must be effective (admin's allowed switch AND, when transferred,
// the owner's toggle) — stops the OWNER and managers alike (the admin caps the reach).
// Rung 2: a plain manager additionally needs the owner's table_ops grant (managerCan;
// the owner passes that rung automatically). Returns a response to short-circuit, or
// null to proceed.
async function tableOpsGate(g: { user: StaffUser | null }, rid: string): Promise<NextResponse | null> {
  if (!g.user) return null; // admin super-user: X-ray honesty — visible = usable
  if (!(await tableOpsLadder(rid)).effective) return err("Table & KOT operations aren't enabled for this restaurant.", 403);
  if (!(await managerCan(g, rid, "table_ops"))) return permDenied("use table & KOT operations");
  return null;
}

// Friendly message for the move/merge RPCs' { ok:false, reason } (migs 173/175).
const moveErrMsg = (reason?: string) =>
  reason === "no_order" ? "That order isn't there anymore — refresh."
  : reason === "item_not_found" ? "That dish is no longer on the order."
  : reason === "order_not_found" ? "That order no longer exists."
  : reason === "order_cancelled" ? "This order was cancelled — nothing to move."
  : reason === "order_paid" ? "Won't move a PAID order — mark it unpaid first."
  : reason === "bad_table" ? "Pick a valid table."
  : reason === "same_table" ? "That order is already on that table."
  : reason === "source_invoiced" ? "This bill is already invoiced — void or regenerate its invoice before moving an order off it."
  : reason === "target_invoiced" ? "The target table's bill is already invoiced — void or regenerate its invoice before moving an order onto it."
  : (reason || "Couldn't move the order.");

// Friendly message for lfh_staff_merge_tables' { ok:false, reason } (mig 174).
const mergeErrMsg = (reason?: string) =>
  reason === "no_session" ? "That table's session isn't there anymore — refresh."
  : reason === "session_closed" ? "This table is already closed — nothing to merge."
  : reason === "bad_table" ? "Pick a valid table."
  : reason === "same_table" ? "That's the same table."
  : reason === "target_not_open" ? "That table has no party — use Change table to move there instead."
  : reason === "source_invoiced" ? "This bill is already invoiced — void its invoice before merging."
  : reason === "target_invoiced" ? "The target table's bill is already invoiced — void its invoice before merging."
  : (reason || "Couldn't merge the tables.");

// Friendly message for the banquet RPC's { ok:false, reason } (mig 130).
const banquetErrMsg = (reason?: string) =>
  reason === "not_allowed" ? "Banquet isn't enabled for this restaurant."
  : reason === "empty_order" ? "Add at least one banquet line."
  : reason === "unknown_item" ? "That banquet item no longer exists — reload and try again."
  : reason === "bad_table" ? "Pick a valid table."
  : (reason || "Couldn't create the banquet bill.");

const nowIso = () => new Date().toISOString();
// Mark an order as EDITED after it was placed → drives the persistent "✎ Edited"
// badge on the kitchen/tablet/manager ticket so staff re-check what changed.
// Best-effort: a stamp failure must never fail the edit itself.
const stampEdited = async (orderId?: string | null, rid?: string) => {
  if (!orderId) return;
  try { let q = sb.from("orders").update({ edited_at: nowIso() }).eq("id", orderId); if (rid) q = q.eq("restaurant_id", rid); await q; } catch {}
};
// Unwrap a Supabase { data, error } reply — throw on error so the catch turns it
// into a clean 500 (mirrors the editor server's `must`).

const must = (r: any) => {
  if (r.error) throw pgError(r.error); // pgError keeps code/details/hint — see lib/dbRefusal // keep the SQLSTATE: lib/dbRefusal reads it to tell "bad value" (400) from "server trouble" (500)
  return r.data;
};

const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

// Which restaurant this editor request acts on — the SINGLE choke point that also proves
// an OWNER's right to it. The owner menu editor (owner panel → Menu, 2026-07-25) opens the
// panel with ?rid=<one restaurant the owner owns>. Owner rows are pinned to a shared "home"
// namespace, so panelRestaurantId ignores their rid; instead we honor the ?rid HERE but ONLY
// after validating it against the owner's own portfolio (enabledOwnedRestaurantIds) — so a
// hand-forged rid for a restaurant they don't own is refused, never silently scoped. Other
// staff (manager/kitchen/tablet) stay pinned to their own restaurant; the admin super-user
// keeps the act-as path. Returns a rid, or a NextResponse (403/400) to short-circuit.
async function editorScope(req: NextRequest, g: { user: StaffUser | null }): Promise<string | NextResponse> {
  const u = g.user;
  if (u && u.role === "owner") {
    const urlRid = req.nextUrl.searchParams.get("rid");
    if (urlRid) {
      const owned = await enabledOwnedRestaurantIds(u.id);
      if (!owned.includes(urlRid)) return err("You can only edit restaurants you own.", 403);
      return urlRid;
    }
  }
  const rid = panelRestaurantId(req, g);
  // ⛔ REJECTED (owner, 2026-08-28) — docs/REJECTED-IDEAS.md → R48. "No restaurant scope" STAYS.
  // It was reworded into plain words as the T27 sweep's item 3 and he turned it down on
  // REACHABILITY, not on the wording: *"if you make everthing perfect the no 3 will not even
  // happen"*. He is right, and it is worth writing here rather than re-deriving: panelRestaurantId
  // returns `g.user.restaurant_id || DEFAULT_RESTAURANT_ID` for ANY signed-in staff member, so this
  // can never fire for a waiter, a manager or a cook. Its only reader is the ADMIN super-user who
  // opened a panel directly instead of through the console — one person, who knows the word.
  // Do not reword it, and do not re-report it as jargon.
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  return rid;
}

// Owner edited the SHARED menu (a dish/category/filter/guest-safe setting) → bust
// THIS restaurant's cached menu bundle so guests get the change within seconds via
// their realtime 'menu' refetch, which would otherwise be handed the stale bundle.
// Scoped to one restaurant's tag — never invalidates anyone else's menu.
//
// ⚠️ THE BACKSTOP IS 24 HOURS, NOT 120 SECONDS. This comment said "120s" three times and
// that number does not exist anywhere: lib/menuDataServer.ts sets `revalidate: 86400`. A
// missing bust is therefore a full DAY of guests reading a stale menu, not a two-minute
// annoyance — which is exactly how the kitchen's 86 board shipped without one (T13 sweep,
// 2026-08-05). If you add a write path that changes what a GUEST sees, it must call this.
// Best-effort: a bust failure must never fail the save.
const bustMenuCache = (rid: string) => {
  // `{ expire: 0 }`, NOT the "max" profile. This said 'max' = stale-while-revalidate, and that is
  // precisely wrong for a menu: MEASURED on the running app, "max" serves the OLD bundle to the very
  // next reader and only then refreshes — so an owner's edit needed a SECOND save (or a second guest
  // load) before a guest saw it, which is the "menu edits need a panel save" annoyance. Expiring the
  // entry makes the next read recompute. (T13 sweep, 2026-08-05)
  try { revalidateTag(menuTag(rid), { expire: 0 }); } catch {}
};

// ── A DISH PHOTO, UPLOADED (T19 sweep, 2026-08-14) ───────────────────────────────────────────
// POST /api/editor/dish-photo, multipart { file, replaces? } → { ok, url }.
//
// Until now the dish form's Image card was a bare "Image URL" box, so the only way to give a
// dish a picture was to host that picture somewhere yourself and paste its address — something a
// beginner owner cannot do, and the arrangement that had to be undone once already when
// restaurant #1's 41 photos were being served from an outside website. A restaurant LOGO, a
// STAFF photo, an inventory photo and an issue photo could all be uploaded; the one picture a
// guest actually looks at could not.
//
// NOT A NEW MODULE, and deliberately so: this fills in a field the "Edit menu → Edit a dish"
// permission already governs, so it is gated by exactly that pair — managerCan("edit_menu") and
// the edit_dish sub-part — and nothing new appears on the Access screen. The bucket is `menu-media`
// (migration 325), public-read like `branding` and deliberately NOT like `inv-media`/`issue-media`:
// migration 279 made those two private because they hold a restaurant's paperwork, and named the
// exception in its own text — a picture rendered on the guest menu, to the public, by design.
//
// SVG is refused for the same reason the logo route refuses it: an SVG can carry a <script> that
// runs when its public storage URL is opened directly.
const PHOTO_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const PHOTO_BUCKET = "menu-media";
const PHOTO_MAX = 4 * 1024 * 1024;   // 4 MB — a phone photo, not a print master

async function dishPhotoUpload(req: NextRequest, g: { user: StaffUser | null }, rid: string): Promise<NextResponse> {
  if (!(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the menu");
  if (!(await menuSubAllowed(g, rid, "edit_dish"))) return permDenied("edit dishes");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return err("No photo was attached — pick a file and try again.");
  const ext = PHOTO_EXT[file.type];
  // Say WHICH formats, not just "wrong type": the person is standing in front of a file picker.
  if (!ext) return err("A dish photo must be a PNG, JPG or WEBP image.");
  if (file.size > PHOTO_MAX) return err("That photo is larger than 4 MB — please use a smaller one.");
  // restaurant id + time + randomness, so a photo's address can't be guessed from a restaurant id.
  const path = `${rid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  const up = await sb.storage.from(PHOTO_BUCKET).upload(path, buf, { contentType: file.type, upsert: false });
  // Never hand a storage library's own sentence to a person standing at a file picker.
  if (up.error) { console.error("[editor/dish-photo] upload failed:", up.error.message); return err("Couldn't save that photo — please try again.", 500); }
  const url = sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  // Replacing a photo removes the one it replaces, so re-photographing a dish twenty times does
  // not leave twenty files behind. Only ever an object in OUR bucket, under THIS restaurant's
  // folder — a `replaces` naming anything else is simply ignored, never followed. Best-effort:
  // a cleanup miss must not fail an upload that already succeeded.
  const replaces = String(form?.get("replaces") || "");
  const mine = replaces.split(`/${PHOTO_BUCKET}/`)[1];
  if (mine && mine.startsWith(`${rid}/`) && !mine.includes("..")) {
    try { await sb.storage.from(PHOTO_BUCKET).remove([mine]); } catch { /* best-effort */ }
  }
  // The dish row itself is NOT written here — the panel drops this URL into the Image field and
  // the ordinary dish save writes it, which is what keeps one save path, one clash check and one
  // cache bust. Nothing a guest sees has changed yet, so there is nothing to bust.
  return ok({ ok: true, url });
}

// Money-integrity lock: while a session holds a LIVE (non-voided) invoice, its bill
// is frozen — reject any money-changing edit so the printed invoice total can't drift.
// Reopen (void) the invoice first. (work-checker 2026-06-21)
const LOCKED_MSG = "This bill is invoiced — reopen it (void the invoice) before changing the order.";
// ── IT ASKS ABOUT *THIS* RESTAURANT'S ROW (T24 sweep #8, 2026-09-06) ──────────────────────────
// These three reads were keyed on an id ALONE, and the id comes straight off the request path —
// no caller proves the order is this restaurant's first. Nothing was wrong on the floor (every
// write underneath is separately scoped, so no row could move), but it is the exact shape
// verify:scoped-reads exists for: inside lib/ and here the service-role client is exempt from the
// database's own row rules, so the WHERE clause is the only scope there is. Every call site
// already had `rid` in hand. Required, not optional — an optional scope is one a future caller
// forgets, which is the note lib/sessionClose.ts carries for the same reason.
async function invoiceLockedByOrder(orderId: string, rid: string): Promise<boolean> {
  const o = (await sb.from("orders").select("session_id").eq("id", orderId).eq("restaurant_id", rid).maybeSingle()).data as { session_id?: string } | null;
  if (!o?.session_id) return false;
  const s = (await sb.from("sessions").select("invoice_no,invoice_voided").eq("id", o.session_id).eq("restaurant_id", rid).maybeSingle()).data as { invoice_no?: number | null; invoice_voided?: boolean } | null;
  return !!(s && s.invoice_no != null && !s.invoice_voided);
}
async function invoiceLockedByItem(itemId: string, rid: string): Promise<boolean> {
  const it = (await sb.from("order_items").select("order_id").eq("id", itemId).eq("restaurant_id", rid).maybeSingle()).data as { order_id?: string } | null;
  return it?.order_id ? invoiceLockedByOrder(it.order_id, rid) : false;
}

// ── WHAT A DISCOUNT MAY WORK ON (mig 270 + 271) ──────────────────────────────────────────
// The server's copy of lfh_order_discount_base, written here so a whole BILL can be capped in
// one pass instead of one RPC round-trip per order. It must stay identical to the SQL and to
// billMath() in the manager panel — three copies of a money rule is how a bill starts
// disagreeing with itself, so the rule is stated the same way in all three:
//   rate > 0 → the TAXABLE base. Anything else breaks `due = total − discount × (1 + rate)`,
//              which the floor tiles, khata, sessionClose and every report compute from.
//   rate = 0 → subtotal minus the LOCKED MRP. With no tax the identity survives a discount
//              anywhere, and only a legally-final price stays out of reach. Note `nontax` is
//              NOT the lock: a nil-rated dish is untaxed but perfectly discountable (mig 272).
// NULL columns mean "placed before this feature": fully taxable, no MRP — exactly what those
// orders were, so no existing restaurant's cap moves.
type OrderMoney = { subtotal?: number | null; taxable_base?: number | null; mrp_amount?: number | null };
function discountBaseOf(o: OrderMoney, rate: number): number {
  const sub = Number(o?.subtotal) || 0;
  if (rate > 0) return o?.taxable_base == null ? sub : (Number(o.taxable_base) || 0);
  return Math.max(0, sub - (Number(o?.mrp_amount) || 0));
}

// ── THE TAX ON ONE BILL, AT EACH ORDER'S OWN RATE (mig 284) ───────────────────────────────
// Stated ONCE here because the Z-report needs it twice — the day's money totals and the
// payments-by-method reconciliation — and a money rule that exists twice is a money rule that
// drifts (this file already says so about discountBaseOf, two functions up).
//
// IT USED TO BORROW ONE RATE FOR THE WHOLE BILL (fixed 2026-08-11, T7 sweep finding F8):
//   const stamped = g.find((o) => Number(o.tax_rate) > 0);   // ← the old rule
// The printed bill (billdoc's billMoney) and settling in parts (lib/paySplit.ts) were BOTH
// rebuilt away from exactly that on 2026-08-05, each with a comment explaining why. The
// Z-report kept it. A banquet carries its own rate (mig 239) and is inserted into the table's
// existing OPEN session (migs 237/239), so an 18% banquet genuinely shares a bill with 5% food
// — and then the day-close sheet charged the whole bill at whichever of the two came first.
// Measured on food ₹1,000 @5% + banquet ₹2,000 @18%: the paper charged ₹410 of tax, this
// reported ₹150 (or ₹540 the other way round). COMPLIANCE §3 requires the two to reconcile to
// the rupee, and this is the sheet a manager signs and an inspector reads.
//
// `orderTaxRate` is imported rather than restated: it is the single definition of "the rate
// this order was charged at", already shared by the paper and pay-in-parts, and it handles a
// stamped ZERO (a real 0%, not a missing rate) which `> 0` alone cannot.
//
// Tax is rounded ONCE PER RATE — never per order, which drifts ±½ paise an order and can make
// the day-close miss the sum of its own bills.
type BillTaxRow = OrderMoney & { discount?: number | null; tax_rate?: number | null };
function billTaxOf(g: BillTaxRow[], settingsRate: number): { disc: number; taxable: number; tax: number } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rateOf = (o: BillTaxRow) => BILLDOC.orderTaxRate(o, settingsRate);
  // Capped exactly the way every discount door caps it, each order at its OWN rate.
  const cap = g.reduce((a, o) => a + discountBaseOf(o, rateOf(o)), 0);
  const disc = Math.min(g.reduce((a, o) => a + (Number(o.discount) || 0), 0), cap);
  const buckets = new Map<number, { base: number; disc: number }>();
  for (const o of g) {
    const r = rateOf(o);
    const b = buckets.get(r) || { base: 0, disc: 0 };
    b.base += o.taxable_base == null ? (Number(o.subtotal) || 0) : (Number(o.taxable_base) || 0);
    b.disc += Number(o.discount) || 0;
    buckets.set(r, b);
  }
  let taxable = 0, tax = 0;
  for (const [r, b] of buckets) {
    const bBase = r2(b.base);
    const bTaxable = Math.max(0, r2(bBase - Math.min(Math.max(0, r2(b.disc)), bBase)));
    taxable = r2(taxable + bTaxable);
    tax = r2(tax + r2(bTaxable * r));
  }
  return { disc, taxable, tax };
}
/** The columns effectiveTaxRate() needs — one small row, read only on a discount write. */
async function taxSettings(restaurantId: string) {
  return (await sb.from("settings").select("tax_rate,tax_components,price_tax_mode")
    .eq("restaurant_id", restaurantId).maybeSingle()).data || {};
}

// Friendly message for a staff-edit RPC's { ok:false, reason } (shared by the
// edit-qty / edit-note / add-item / delete endpoints).
const editErrMsg = (reason?: string) =>
  reason === "order_paid" ? "Won't change a PAID bill — mark it unpaid first."
  : reason === "order_cancelled" ? "This order was cancelled — nothing to edit."
  : reason === "item_not_found" ? "That dish is no longer on the order."
  : reason === "order_not_found" ? "That order no longer exists."
  : reason === "sold_out" ? "That dish is sold out — can't add it."
  : reason === "unknown_item" ? "That dish isn't on the menu."
  : reason === "empty_order" ? "Nothing to add."
  // mig 215: an open-price (as-per-MRP) dish carries no menu price, so the pricer refuses a line
  // that arrives without one. This was written TWICE, and the second copy was unreachable — so the
  // more useful of the two sentences (the one that says WHY the dish has no price) never appeared
  // (sweep 2026-08-05). One branch, both facts.
  : reason === "price_required" ? "Type a price for that dish first — it's priced as-per-MRP, so it has no menu price."
  : "Couldn't edit the order — please try again.";

const ORDER_STATUSES = ["received", "preparing", "served", "cancelled"];
// Generic CRUD tables: which Supabase table + its unique key.
const TABLES: Record<string, { name: string; key: string }> = {
  items: { name: "menu_items", key: "id" },
  categories: { name: "categories", key: "slug" },
  filters: { name: "filters", key: "slug" },
  settings: { name: "settings", key: "id" },
};

 
async function readBody(req: NextRequest): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = await editorScope(req, g);
  if (rid instanceof NextResponse) return rid;
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  // Without this a failure was logged as bare "canceling statement due to statement
  // timeout" with no hint of WHICH read timed out, so the admin Repair page could only
  // offer an unfixable mystery — nobody could tell if it was the Dashboard, the Z-report
  // or the log. (bug 2026-07-28)
  const { path = [] } = await ctx.params;
  // Manager's-menu rung: refuse a tab this restaurant switched off (see tabGate).
  { const tg = await tabGate(g, rid, path, req.method); if (tg) return tg; }
  const p = path.join("/");
  try {
    // customer-recognize?phone=… — repeat-customer lookup for the pay sheet
    // (Customer CRM, mig 212). Read-only, scoped by rid via the RPC. Never lists.
    if (p === "customer-recognize") {
      const phone = (new URL(req.url).searchParams.get("phone") || "").trim().slice(0, 20);
      if (!phone) return ok({ known: false });
      const { data, error } = await sb.rpc("lfh_recognize_customer", { p_phone: phone, p_restaurant_id: rid });
      if (error) throw new Error(error.message);
      return ok(data || { known: false });
    }

    // ── table-sections — who serves which table (waiter sections, mig 222) ────
    // The roster the section editor needs, and NOTHING else: id, display name, login,
    // active, assigned_tables. Deliberately not the full staff roster (that's
    // /api/owner/staff, gated by manage_staff) — a manager who may hand out sections
    // shouldn't thereby gain phone numbers and per-user permissions. Waiters only:
    // sections are a tablet concept.
    //
    // The ADMIN always gets an answer even when the module is off (x-ray rule: the admin
    // sees every feature, tinted, and it genuinely works); a real owner/manager needs the
    // module effective AND — for a manager — the granted power.
    if (p === "table-sections") {
      if (!(await managerCan(g, rid, "table_assign"))) return permDenied("give waiters their own tables");
      const [staff, settings] = await Promise.all([
        sb.from("staff_users").select("id, username, name, role, active, assigned_tables")
          .eq("restaurant_id", rid).eq("role", "tablet").is("deleted_at", null)
          .order("name", { ascending: true }).limit(200),
        sb.from("settings").select("table_count, table_names").eq("restaurant_id", rid).maybeSingle(),
      ]);
      return ok({
        moduleOn: true,   // sections are always on (owner 2026-07-30)
        waiters: must(staff) || [],
        tableCount: Number(must(settings)?.table_count) || 12,
        tableNames: must(settings)?.table_names || {},
      });
    }

    // customer-search?q=98250 — "who is this number?" for the bill's customer box.
    // Fired while the waiter is still typing, so it must stay tiny and quick: prefix-anchored
    // on the (restaurant_id, phone) index, at most 12 rows, only phone + name + visit count.
    // TWELVE, not the four the sheet shows: an answer the database did NOT have to truncate can be
    // narrowed on-device for every longer number, so one slightly bigger answer replaces several
    // small ones (owner, 2026-08-28). The cap is real as of migration 365 — before that the LIMIT
    // sat after a json_agg and capped nothing at all, so this asked for 6 and could get the lot.
    // A complete number is normalised first, so +91 / leading-0 spellings find the same row.
    if (p === "customer-search") {
      const q = (new URL(req.url).searchParams.get("q") || "").replace(/\D/g, "").slice(0, 15);
      if (q.length < 3) return ok({ matches: [] });
      const CUSTOMER_SEARCH_ROWS = 12;
      const { data, error } = await sb.rpc("lfh_customer_phone_search", { p_restaurant_id: rid, p_prefix: q, p_limit: CUSTOMER_SEARCH_ROWS });
      if (error) throw new Error(error.message);
      const matches = Array.isArray(data) ? data : [];
      // `whole` — did this answer hold EVERY customer matching that prefix, or did we cut it off?
      // The sheet reuses a complete answer for longer numbers without asking again, so it must
      // never have to GUESS this from a row count and a constant of its own: the two would drift
      // the moment either side's cap moved, and the sheet would silently narrow from a truncated
      // list and lose a real customer. The server knows; the server says. A panel too old to
      // understand the flag simply keeps asking, which is what it did before.
      return ok({ matches, whole: matches.length < CUSTOMER_SEARCH_ROWS });
    }

    // whoami — boot signal for the panel's hierarchy X-ray (2026-07-05). Tells the
    // client WHO is viewing (admin super-user / owner / manager) and this restaurant's
    // manager_permissions, so the nav can HIDE a disabled feature for the real manager
    // but show it GREYED to a higher role (admin/owner) looking in. Read-only; the
    // server still enforces every capability (managerCan) regardless of what the UI shows.
    if (p === "whoami") {
      // ACTUAL-VIEW mode (owner, 2026-07-28): an admin-view tab may ask ?view=real —
      // answer exactly as the REAL manager would be answered (restaurant-wide grants, no
      // higher-view tinting), plus simulated:true so the client keeps its ribbon (the way
      // back to the full admin view). Read-only; every write gate still sees the admin.
      // ...and ?as=<staff id> answers a DIFFERENT question (owner, 2026-08-02): not "hide
      // what they can't do" but "mark what they can't do". The pin swaps WHOSE permissions
      // the X-ray measures against — this individual's overrides instead of the role's
      // restaurant-wide average — while the admin keeps seeing the whole panel.
      // It deliberately does NOT imply the real view any more. The first cut had
      // `!!person || view === "real"`, so opening a profile's "Visit their panel" jumped
      // straight to the stripped panel with nothing marked, which threw away the very
      // comparison the admin opened it for. The ribbon's toggle is the only stripper.
      const person = await viewAsPerson(req, rid, g, "manager");
      const simulate = !g.user && new URL(req.url).searchParams.get("view") === "real";
      const actor = g.user ? g.user.role : simulate ? "manager" : "admin"; // no staff user cookie = admin super-user
      const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements, access_config").eq("id", rid).maybeSingle()).data as
        { manager_permissions?: Record<string, boolean>; owner_entitlements?: Record<string, boolean>; access_config?: { edit_menu?: { manager_opts?: Record<string, boolean> } } } | null;
      // The ladder, resolved per power (mig 133): effective = admin entitles it AND the
      // owner granted it. The X-ray tints on !effective and can say WHO turned it off.
      const perms = r?.manager_permissions || {};
      const ents = r?.owner_entitlements || {};
      const effectivePowers: Record<string, boolean> = {};
      const offByAdmin: Record<string, boolean> = {};
      // The acting person's per-person overrides (mig 115) — so the manager UI hides a power
      // pulled from THIS individual, matching what managerCan enforces. Only for a real staff
      // login (admin/owner see the restaurant-wide picture; they bypass the gate anyway).
      // Looking through ONE manager (?as=) uses THEIR overrides — that is the whole point
      // of the pin: the admin sees the panel this individual gets, not the role's average.
      const myOv = person ? (person.permissions || {})
        : (g.user && g.user.role !== "owner") ? (g.user.permissions || {}) : {};
      // EVERY grant the access model has, not just the older list. `view_bills` and
      // `delete_bill` are rows on the Access screen and are enforced by managerCan, but they
      // are not in the legacy MANAGER_POWER_FLAGS — so the panel got no answer for them and
      // treated them as "no power", which is how the Bills tab could be shown while the
      // server refused its data (found 2026-08-02 while checking the owner's rule that a
      // switched-off permission must be INVISIBLE as well as refused).
      const flags = Array.from(new Set([...MANAGER_POWER_FLAGS, ...GRANT_FLAGS]));
      const cfgOn = (r?.access_config || {}) as Record<string, { on?: boolean }>;
      for (const flag of flags) {
        // The same THREE rungs managerCan() applies, in the same order, so what the panel SHOWS
        // and what the server ALLOWS can never disagree:
        //   1. the feature half — does the restaurant have the thing at all
        //   2. this person's own override
        //   3. otherwise the restaurant's grant (managerGrantValue = the one rule)
        // (There were four until 2026-08-06. The old `power_<flag>` admin cap left both sides
        //  together — see managerCan — so this stays in step with it rather than drifting into
        //  showing a power the server would refuse, or hiding one it would allow.)
        const hasFeature = cfgOn[flag]?.on !== false;
        let granted = managerGrantValue(flag, perms[flag]);
        const ov = myOv[flag];
        if (ov === "on" || ov === "pin") granted = true;
        else if (ov === "off") granted = false;
        effectivePowers[flag] = hasFeature && granted;
        offByAdmin[flag] = !hasFeature;
      }
      // Feature-module rung (canonical ladder): a capability whose MODULE is off for this
      // restaurant renders nothing anywhere in the panel — the power flags above are the
      // owner→manager rung, this is the admin(/owner) application rung. ONE settings select
      // covers every module (accessModel MODULE_DEFS), and a module added there wires itself
      // here — this used to be five hand-written selects of the same row.
      const ladders = await allModuleLadders(rid);
      for (const mp of PERMISSIONS) {
        if (!mp.module || !mp.power) continue;
        if (!ladders[moduleKey(mp)]?.effective) effectivePowers[mp.power] = false;
      }
      // Finer edit-menu sub-limits (owner 2026-07-24): the SAME resolution the save and delete
      // paths use (resolveMenuParts), so what the panel shows and what the server allows can
      // never disagree. `menuSub` is this viewer's own answer — the panel hides a control that
      // reads false. The simulate view answers as the real manager, which is what it is for.
      const mo = r?.access_config?.edit_menu?.manager_opts;
      const menuSub = resolveMenuParts(
        simulate ? "manager" : !g.user ? "admin" : g.user.role === "manager" ? "manager" : "other", mo);
      // Which VIEWS of the Audit & logs tab this viewer gets (the Access screen's sub-options,
      // access_config.view_logs.manager_opts). Same resolution as logPartAllowed(): admin and
      // owner see every view; a real manager (or the simulate view) loses only a view an admin
      // explicitly switched off — ABSENT MEANS ON, unlike menuSub's explicit-true rule, because
      // these rows default ON in the model. The panel hides a view that reads false here; the
      // GET /oplog, /audit and /users guards refuse the same views server-side.
      const lo = ((g.user && g.user.role === "manager") || simulate)
        ? (r?.access_config as { view_logs?: { manager_opts?: Record<string, boolean> } } | null)?.view_logs?.manager_opts
        : null;
      const logParts: Record<string, boolean> = {};
      for (const k of ["removals", "activity", "customers"]) logParts[k] = lo && typeof lo === "object" ? lo[k] !== false : true;
      // Resolved ONCE: whoami runs on every panel open, and canSetRetention() itself reads the
      // lock, so asking four times would turn one cached fact into four calls.
      const retLock = await retentionLock();
      const retMay = canSetRetention(g, retLock);
      return ok({
        actor,
        role: actor,
        // A higher role is "viewing" a lower panel when it's the admin super-user or an
        // owner opening the manager panel — those see greyed (not hidden) disabled items.
        // (In the simulate mode actor is already "manager", so this resolves false.)
        higherView: actor === "admin" || actor === "owner",
        // THE ADMIN, specifically — not "a higher role". The floor definition (table names and
        // seat counts) is admin-owned as of 2026-08-06, and the OWNER is on the wrong side of that
        // line too, so `higherView` (which is true for an owner) cannot answer this question. The
        // panel greys the Table setting card for everyone but the admin; the route refuses it for
        // everyone but the admin either way — this only stops the screen offering a dead control.
        isAdmin: actor === "admin",
        simulated: simulate,
        // WHOSE panel this is, when the admin came in through a person's profile. The
        // ribbon says the name — and it says it only because the SERVER confirmed the
        // pin, so the label can never describe a view we aren't actually showing.
        asName: personLabel(person),
        managerPermissions: perms,
        effectivePowers,
        offByAdmin,
        menuSub,
        // …and the same nine as this restaurant's MANAGERS get them (owner, 2026-08-03). Same
        // job as tabsTint/settingsTint below: `menuSub` answers "what may I do", which for the
        // admin is always everything, so on its own it left the admin looking at a complete
        // dish form with no way to tell that a manager has no 3D card and no Customisation.
        // Always sent; the panel only acts on it in a higher view, and it marks in cyan there
        // rather than hiding — the admin's own power is never reduced.
        menuSubTint: resolveMenuParts("manager", mo),
        logParts,
        // How far back this restaurant's dashboard reaches (Access → Manager → Dashboard →
        // "How far back it reaches"). The panel draws its Today / Yesterday rail from THIS,
        // so the switch is what puts the Yesterday row on screen — and the same helper
        // clamps /stats below, so the rail can never offer a range the server refuses.
        // Everyone in this panel gets the same two rows: it is the manager's screen, and a
        // 30-day/12-month view here was only ever a duplicate of the owner's own Reports
        // (deleted 2026-08-03 at the owner's word).
        dashReach: dashboardReach(r?.access_config),
        // How far back the BILLS record reaches (Access → Manager → Permission for manager →
        // Bills → "Which bills they can see"). The panel draws its Today / Yesterday bill
        // groups from THIS, and GET /orders clamps its bills window + every bill search to
        // the same answer — so the screen can never offer a day the server refuses.
        billsReach: billsReach(r?.access_config),
        // THE MOST OFF A BILL THIS PERSON MAY TAKE, as a percentage (2026-08-11, T7 improvement I5).
        // The discount modal already refuses anything above what the BILL can carry (mig 272's base)
        // and says so out loud, but it knew nothing about the person's own %-ceiling — a waiter's 5%,
        // a manager's 50% (lib/discountCap.ts). So they could type ₹500 off, press Apply, and only
        // then be told "That discount is over your 5% limit". The panel's own comment already argues
        // against exactly that for the other cap: "offering a bigger one here only produced a refusal
        // at the last tap — the failure the QO/P destination gates exist to remove."
        // Sent so the modal can fold it into the maximum it already shows. The server check in
        // orders/discount is UNCHANGED and still decides — this only stops the screen offering a
        // number the server will refuse. `null` = uncapped (the admin, and the owner's own money).
        // A named person's own role wins here too (?as=), exactly as the powers above do.
        discountCapPct: await discountCapPct(rid, discountRole(person ? person.role : (g.user ? g.user.role : null))),
        // MANAGER'S MENU (access rebuild): which tabs this RESTAURANT has at all — a
        // different question from what a PERSON may do, which is the powers above. The panel
        // removes these tabs entirely (never greys them), and the guards below refuse their
        // endpoints so a hidden tab can't be reached by typing a URL. The admin keeps
        // everything (admin = top power), so a switched-off tab stays inspectable.
        tabsOff: actor === "admin" ? [] : managerTabsOff(r?.access_config),
        // MARK, don't remove (owner, 2026-08-02). tabsOff/settingsOff answer "what must
        // vanish"; these answer "what must be shown in cyan". They are always sent, and
        // the panel only acts on them in a higher view — so the admin sees the complete
        // panel with the missing pieces named, and a real manager is unaffected because
        // for them the same rows are already gone via the lists above. Without this the
        // admin got tabsOff:[] and therefore a panel with NOTHING marked, which reads as
        // "this restaurant has everything" — the exact wrong answer.
        tabsTint: managerTabsOff(r?.access_config),
        settingsTint: managerSettingsOff(r?.access_config),
        // Which SETTINGS sections this manager gets. The panel draws its sidebar from this; the
        // server refuses the same list below, so hiding is never the only guard. The admin
        // super-user keeps every section — a switched-off one stays inspectable from the console.
        settingsOff: actor === "admin" ? [] : managerSettingsOff(r?.access_config),
        // Delete-a-bill sub-permission (default OFF) — lets the panel show the "🗑 Delete bill"
        // button only when the owner ticked it (admin/owner always true; the simulate mode
        // resolves it like a real manager: only when the owner explicitly ticked it).
        // The SIMULATE path has to answer the same way canDeleteBill() does, or the admin's
        // "view as a manager" mode shows a button a real manager doesn't get. It read only the
        // legacy access_config path; the Access screen's row wins there too now.
        // A named manager's OWN answer wins here too (?as=), exactly as managerCan
        // resolves it — otherwise the one person given/denied this row would be the one
        // person this view got wrong.
        // The FEATURE half caps the simulated answer too, or "view as a manager" would show a
        // Delete-bill button for a restaurant that doesn't have the row at all (2026-08-04).
        // NOBODY AT THE RESTAURANT REMOVES A BILL (owner, 2026-08-16) — see canDeleteBill above.
        // The simulate branch used to replay the whole per-manager resolution so "view as a
        // manager" showed exactly what a real one gets; there is nothing left to resolve, and a
        // manager is now always `false`. Kept as its own line rather than folded away, because the
        // rule it states — the ADMIN CONSOLE is the only door — is the thing a reader needs.
        canDeleteBill: simulate ? false : await canDeleteBill(g, rid),
        // LOG RETENTION, ANSWERED BY THE SERVER (owner, 2026-08-21). The panel drew this dropdown
        // for everybody with no gate at all — so a manager got a live control whose every use ended
        // in a refusal, and an owner got one that stopped working the moment the admin locked it,
        // with nothing on screen to say why. The panel now repeats these fields instead of
        // guessing, exactly as it does for canDeleteBill, so the two can never drift.
        retention: {
          // "View as a manager" must answer the way a real manager is answered, or the admin's
          // simulate mode would show a working dropdown that a manager does not get.
          canEdit: retMay.ok && !simulate,
          why: simulate ? "retention_manager_blocked" : retMay.code,
          locked: retLock.locked,
          lockedAt: retLock.at,
        },
        // One entry per module-backed capability (same keys as before: table_tags, khata,
        // banquet, table_ops, take_orders, parcel) — derived, so new modules appear here.
        features: Object.fromEntries(PERMISSIONS.filter((mp) => mp.module).map((mp) => [mp.id, !!ladders[moduleKey(mp)]?.effective])),
      });
    }

    // banquet/items — the banquet menu (mig 130). Manager-panel surface; only
    // exists when the admin entitlement is on (renders nothing otherwise, and the
    // place RPC re-checks server-side anyway). Includes inactive rows so the
    // manager can toggle them back on.
    if (p === "banquet/items") {
      // Full ladder (mig 167): admin switch AND (owner's toggle when transferred)
      // AND the owner->manager grant (backfilled true, so nothing changed by itself).
      if (g.user && !(await banquetLadder(rid)).effective) return err("Banquet isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "banquet"))) return permDenied("use banquet billing");
      const items = must(await sb.from("banquet_items")
        .select("id,title,price,unit,sort_order,active").eq("restaurant_id", rid)
        .order("sort_order").limit(200));
      return ok({ items });
    }

    // banquet/bills — the restaurant's own banquet bill ledger (mig 237), newest
    // first. Its own section, separate from table bills, with the numbers this
    // restaurant printed. Scoped + explicit columns + hard limit (egress rule);
    // `?q=` filters on the server so a search never pulls the whole ledger.
    if (p === "banquet/bills") {
      if (g.user && !(await banquetLadder(rid)).effective) return err("Banquet isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "banquet"))) return permDenied("use banquet billing");
      // safeSearch, not a bare trim: `,` and `)` END a term in PostgREST's or=(...) grammar and
      // `%`/`*` are wildcards, so a banquet customer called "Sharma, R" used to search for
      // something other than what was typed (T9 finding F15, applied here 2026-08-16).
      const q = safeSearch(new URL(req.url).searchParams.get("q"), 40);
      const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 40));
      let sel = sb.from("banquet_bills")
        .select("id,bill_no,issued_at,total,received,cust_name,cust_phone,hall,func,fn_date,pax,order_id,voided_at,void_reason")
        .eq("restaurant_id", rid);
      if (q) sel = sel.or(`cust_name.ilike.%${q}%,cust_phone.ilike.%${q}%,bill_no.ilike.%${q}%`);
      const bills = must(await sel.order("issued_at", { ascending: false }).limit(limit));
      return ok({ bills });
    }

    // banquet/bill?id= — ONE bill, everything needed to re-print exactly what was
    // printed the first time (frozen totals + the lines from its order).
    if (p === "banquet/bill") {
      if (g.user && !(await banquetLadder(rid)).effective) return err("Banquet isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "banquet"))) return permDenied("use banquet billing");
      const id = String(new URL(req.url).searchParams.get("id") || "");
      if (!id) return err("id required");
      const bill = must(await sb.from("banquet_bills").select("*").eq("id", id).eq("restaurant_id", rid).limit(1))[0];
      if (!bill) return err("bill not found", 404);
      const order = bill.order_id
        ? must(await sb.from("orders").select("id,items,subtotal,tax,total,discount,status").eq("id", bill.order_id).eq("restaurant_id", rid).limit(1))[0]
        : null;
      return ok({ bill, order });
    }

    // khata — the pay-later book, grouped by person (mig 166). Feature + khata power gated
    // (admin/owner pass managerCan automatically). Outstanding bills only; a bill = the
    // orders parked together (grouped by session, solo orders by their own id).
    if (p === "khata") {
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("see the khata book");
      // ONE source of truth for the net-due math (mig 184): the RPC returns per-BILL open
      // rows; we group them into person → bills for the Pay Later view. The owner panel
      // calls the SAME RPC, so the two panels can never disagree on what's owed.
      const rows = (must(await sb.rpc("lfh_khata_outstanding", { p_restaurant_ids: [rid] })) || []) as any[];
      const byCust = new Map<string, any>();
      for (const r of rows) {
        let cst = byCust.get(r.khata_customer_id);
        if (!cst) { cst = { id: r.khata_customer_id, name: r.name, phone: r.phone, note: r.note, outstanding: 0, bills: [] }; byCust.set(r.khata_customer_id, cst); }
        const amt = Number(r.bill_amount) || 0;
        cst.bills.push({ key: r.bill_key, session_id: r.session_id, order_ids: r.order_ids || [], bill_no: r.bill_no, table_number: r.table_number, khata_at: r.khata_at, amount: amt });
        cst.outstanding = Math.round((cst.outstanding + amt) * 100) / 100;
      }
      const customers = [...byCust.values()].sort((x, y) => y.outstanding - x.outstanding);
      // "Collected today" — money actually received today (by paid_at), for the summary bar.
      const coll = (must(await sb.rpc("lfh_khata_collected", { p_restaurant_ids: [rid], p_from: businessDayStartIso(), p_to: nowIso() })) || []) as any[];
      const collectedToday = Math.round(coll.reduce((s, c) => s + (Number(c.collected) || 0), 0) * 100) / 100;
      return ok({ customers, total: Math.round(customers.reduce((s, cst) => s + cst.outstanding, 0) * 100) / 100, collectedToday });
    }

    // khata/customers?q= — the person picker's search (scoped, limited, debounced client-side).
    if (p === "khata/customers") {
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("use the khata book");
      const q = safeSearch(new URL(req.url).searchParams.get("q"), 60);
      let sel = sb.from("khata_customers").select("id,name,phone,note").eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(8);
      if (q) sel = sel.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
      const people = (must(await sel) || []) as any[];
      // Show each shown person's CURRENT tab so staff see they're adding to an existing debt.
      //
      // ── WHAT SOMEBODY OWES HAS ONE ANSWER, AND IT IS THE BOOK'S (T24 sweep #8, 2026-09-06) ─────
      // This used to work the debt out for itself, from the orders rows, in three ways the Pay
      // Later BOOK two endpoints above does not:
      //   · it re-derived the tax rate as tax ÷ subtotal — the exact expression migration 301's own
      //     header removed, "never re-derived from tax/subtotal, which is wrong the moment a bill
      //     carries an untaxed line", and which mig 310 replaced with the stored `orders.net_amount`
      //     under a column comment reading "EVERY money reader … sums THIS column, so no two
      //     screens can compute revenue differently";
      //   · it counted a BINNED bill as still owed (the book has `deleted_at IS NULL`, F12);
      //   · it showed the WHOLE bill on a tab that had already been part-collected — migration 364
      //     made a debt "the order net minus what arrived alongside the owed part", and this knew
      //     nothing about that.
      //
      // MEASURED on the dev database, French House: for the one person who owes anything, the Pay
      // Later book said ₹161.00 and this tag said "owes ₹483.00" — the whole of a bill whose other
      // ₹322 was taken in cash and UPI at the time. Three times the real debt, on the sheet a
      // waiter reads before parking another bill on the same person.
      //
      // So it asks the same function the book asks, and there is no second rule left to drift.
      // The cost is one indexed RPC on a debounced search instead of one scoped select — the same
      // read the Pay Later screen already makes when it opens.
      if (people.length) {
        const shown = new Set(people.map((p2) => String(p2.id)));
        const openRows = (must(await sb.rpc("lfh_khata_outstanding", { p_restaurant_ids: [rid] })) || []) as
          { khata_customer_id: string; bill_amount: number }[];
        const owed = new Map<string, number>();
        for (const r of openRows) {
          const who = String(r.khata_customer_id || "");
          if (!shown.has(who)) continue;
          owed.set(who, Math.round(((owed.get(who) || 0) + (Number(r.bill_amount) || 0)) * 100) / 100);
        }
        people.forEach((p2) => { p2.outstanding = owed.get(String(p2.id)) || 0; });
      }
      return ok({ customers: people });
    }

    // onhouse?days=N — the "On the house" report (comp bills; would-be amount = the bill's
    // pre-discount value). Keyed on the reserved payment method, so it lists exactly the
    // bills settled through the on-the-house button. Dashboard power gates it.
    if (p === "onhouse") {
      if (g.user && !(await tableTagsLadder(rid)).effective) return err("Table types aren't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      const days = Math.min(Math.max(Math.round(Number(new URL(req.url).searchParams.get("days"))) || 30, 1), 365);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const rows = must(await sb.from("orders")
        .select("id,session_id,table_number,subtotal,tax,total,items,paid_at,payment_note")
        .eq("restaurant_id", rid).eq("payment_method", ON_THE_HOUSE_METHOD).eq("payment_status", "paid")
        .gte("paid_at", since).order("paid_at", { ascending: false }).limit(1000)) as any[];
      // Group orders into bills by session (solo orders stand alone), like the bills views.
      const bills = new Map<string, any>();
      for (const o of rows) {
        const key = o.session_id || o.id;
        const items = Array.isArray(o.items) ? o.items.reduce((s: number, it: any) => s + (Number(it.qty) || 1), 0) : 0;
        const bl = bills.get(key) || { key, table_number: o.table_number, paid_at: o.paid_at, note: o.payment_note || "", items: 0, would_be: 0 };
        bl.items += items;
        bl.would_be = Math.round((bl.would_be + (Number(o.total) || 0)) * 100) / 100; // pre-discount value
        bills.set(key, bl);
      }
      const list = [...bills.values()];
      return ok({ bills: list, count: list.length, total: Math.round(list.reduce((s, bl) => s + bl.would_be, 0) * 100) / 100 });
    }

    if (p === "all") {
      const [items, categories, filters, settings, restaurant] = await Promise.all([
        // SELECT * is kept here (the editor form edits every column), but bounded with a high
        // .limit() so this boot/refresh bundle can never become an unbounded whole-table read.
        sb.from("menu_items").select("*").eq("restaurant_id", rid).order("sort_order").limit(5000),
        sb.from("categories").select("*").eq("restaurant_id", rid).order("sort_order").limit(500),
        sb.from("filters").select("*").eq("restaurant_id", rid).order("sort_order").limit(500),
        sb.from("settings").select("*").eq("restaurant_id", rid).maybeSingle(),
        // The restaurant's own identity, so the printed bill is white-labelled to
        // THIS restaurant (its name/logo/footer) instead of the French House default.
        sb.from("restaurants").select("id, slug, name, logo_text, accent_color, logo_url").eq("id", rid).maybeSingle(),
      ]);
      return ok({
        items: must(items),
        categories: must(categories),
        filters: must(filters),
        // `select("*")` above stays (this form edits every column), but the row also carries
        // `platform_channels` — the delivery apps' connection KEYS — which no manager screen reads
        // and which the two admin screens that manage them never hand back. Stripped through the
        // one shared list so this panel and the waiter tablet cannot drift. (T17 sweep, 2026-08-13)
        settings: panelSafeSettings(must(settings)) || { id: "site", bubbles_enabled: true, service_mode: false },
        restaurant: must(restaurant) || null,
      });
    }

    // ── Guest ratings (mig 140) — manager view, gated by the view_ratings power ──
    // The owner grants a manager the ability to see + handle guest star-ratings.
    // Scoped to THIS restaurant; explicit columns + limit (egress-safe).
    if (p === "ratings") {
      if (!(await managerCan(g, rid, "view_ratings"))) return permDenied("see guest ratings");
      const onlyUnhandled = new URL(req.url).searchParams.get("filter") === "unhandled";
      const sum = await sb.rpc("lfh_ratings_summary", { p_ids: [rid] });
      // A failed read is not a sentence a manager can act on. The raw text goes to the server log,
      // where the Fix-NOW board reads it; the screen gets words (lib/panelFailure's own rule, which
      // this line predated). (T24 sweep #8, 2026-09-06)
      if (sum.error) {
        console.error("[editor/ratings] summary read failed:", sum.error.message);
        return err("Couldn't load the ratings summary — please try again.", 500);
      }
      const s = (sum.data?.[0] ?? {}) as Record<string, any>;
      const summary = {
        total: Number(s.total) || 0, avg: Number(s.avg) || 0,
        dist: [Number(s.s1) || 0, Number(s.s2) || 0, Number(s.s3) || 0, Number(s.s4) || 0, Number(s.s5) || 0],
        unhandled: Number(s.unhandled) || 0,
      };
      let rq = sb.from("feedback")
        .select("id, rating, comment, name, table_number, created_at, acknowledged, acknowledged_at, acknowledged_by, staff_note")
        .eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(200);
      if (onlyUnhandled) rq = rq.eq("acknowledged", false);
      return ok({ summary, ratings: must(await rq) || [] });
    }

    if (p === "orders") {
      // TARGETED REFETCH (owner 2026-06-26 — egress cut): when a realtime breadcrumb
      // names ONE table, the panel asks for just that table's orders (?table=N) instead
      // of re-reading the whole floor. No param = full board (unchanged). Scopes the
      // 159 KB-and-growing whole-orders read down to a few rows.
      const sp = new URL(req.url).searchParams;
      const tbl = sp.get("table");
      // THE BILLS WINDOW (owner, 2026-08-03): the Bills record shows TODAY only, or today +
      // yesterday when Access → Manager → Permission for manager → Bills says so. The window
      // start is computed HERE and applied to the ?bills= fetch AND every ?history= search —
      // for the manager, the owner and the admin alike — so no typed URL or remembered search
      // can list a day the screen doesn't offer. (The plain no-param read below stays
      // unclamped: it is the LIVE floor's working set, and an open table's food must never
      // vanish from Live just because service ran past the day boundary.)
      const billsMode = sp.get("bills") === "1";
      const wantsWindow = billsMode || !!sp.get("history");
      let reach: ReturnType<typeof billsReach> = "today";
      let windowStartIso = "";
      if (wantsWindow) {
        reach = billsReach((await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config);
        windowStartIso = reach === "today_yesterday"
          ? businessDayStartIso(new Date(Date.now() - 24 * 3600 * 1000))
          : businessDayStartIso();
      }
      // BILLS-HISTORY SEARCH (owner, 2026-07-03): the Bills tab only fetched the newest 200
      // orders, so searching for an OLDER bill found nothing (the row was never fetched). When
      // ?history=1&q=…&type=… is set, query the DB directly for the match (scoped by rid),
      // returning up to 200 matching bill records. Since 2026-08-03 the match is CLAMPED to
      // the bills window above — the record only reaches as far as the Access screen allows.
      // The ?bills= window names its columns (the same discipline as the parcels read below
      // and the Platform board): everything the record cards, the bill modal, restore's
      // deadline math and the printed bill actually consume — and nothing else. NOT
      // customer_name: that is a SYNTHETIC field the enrichment below attaches from
      // session_members, not a column. The no-param floor read keeps select("*") — the live
      // board renders every column and RT_VOLATILE/boardSig depend on the full row shape.
      // taxable_base + nontax_amount ride along (mig 270): billMath() splits a bill into the
      // part GST is charged on and the untaxed MRP part, and a Bills record fetched without
      // them falls back to "all of subtotal was taxable" — which would print a DIFFERENT total
      // on a record card than the live floor and the paper show for the same bill.
      const BILLS_COLS = "id,session_id,table_number,status,payment_status,payment_method,paid_at,created_at,items,subtotal,total,taxable_base,nontax_amount,mrp_amount,tax_rate,discount,discount_note,kot_no,allergies,archived,archived_at,cancelled_at,khata_at,deleted_at";
      let oq = sb.from("orders").select(billsMode ? BILLS_COLS : "*").eq("restaurant_id", rid);
      // A DELETED BILL LEAVES THIS PANEL ENTIRELY (owner, 2026-08-04: "it will show only to
      // admin — it will delete from manager and stuff like that").
      //
      // It did not. `softDeleteOrders` stamps `deleted_at` AND `archived`, and the manager's
      // buckets read `archived` as "freed" — so a deleted bill simply moved from Live into the
      // Bills record and sat there, fully readable, printable and restorable by the very person
      // who deleted it. The panel has never referenced `deleted_at` at all, so the only place this
      // can be enforced is here, which is also the right place: a stale panel or a direct call
      // cannot see round it.
      //
      // Deliberately NOT applied to /stats, /zreport or the GST report: a deleted bill still counts
      // in the day's takings and the tax return (docs/COMPLIANCE-GUARDRAILS.md — "Z-report includes
      // voids/deletes"). Hiding a sale from the OPERATOR is a permissions decision; hiding it from
      // the RECORDS is the illegal one. Only the working list is filtered.
      oq = oq.is("deleted_at", null);
      if (wantsWindow) oq = oq.gte("created_at", windowStartIso);
      const histQ = sp.get("history") ? (sp.get("q") || "").trim() : "";
      if (histQ) {
        const type = sp.get("type") || "inv";
        // ── `type=any` — ONE BOX, EVERY FIELD (owner, 2026-08-22) ────────────────────────────
        // The panel's search is local now (it already holds the whole allowed window), so this
        // branch is reached in exactly one case: the window came back AT its row cap, meaning a
        // day busy enough that memory may not hold every bill. Then the panel asks for help and
        // has no idea which FIELD the person meant — so we try them all and union the sessions.
        //
        // Still clamped to the same window as everything else on this path, so it cannot reach a
        // day the Access screen does not hand over. Every read names its columns, is scoped by
        // restaurant_id, and is bounded — three small indexed reads, only on a capped day, only
        // while someone is typing.
        //
        // The number match is on the DIGITS of what was typed, and it matches a bill number or an
        // invoice number ENDING in them, which is what "search the last 3 digits" means. Postgres
        // cannot index a suffix match, but the candidate set here is one restaurant's day.
        if (type === "any") {
          const digits = histQ.replace(/\D/g, "");
          const like = `%${histQ}%`;
          const [sessQ2, memQ2] = await Promise.all([
            // The bill's own customer (mig 227), the table, and the two numbers.
            // ── A BILL NUMBER IS TAKEN ON THE FIRST ORDER, NOT WHEN THE TABLE OPENS (mig 040) ──
            // …so a table that opened before the 05:00 boundary and ordered this morning carries
            // TODAY's bill number under YESTERDAY's created_at — the same trap the Z-report's
            // numbering block below documents at length and had to use two doors to get round.
            // Filtering these sessions on their own created_at lost exactly that bill: the ONE-BOX
            // search could not find it by its number, its invoice number, its table or its
            // customer, while `type=bill` (which has no date filter) found it immediately.
            // One extra day of slack closes it, and nothing older can escape: `oq` is still clamped
            // to the window on the ORDERS, so a wider session set can only ever narrow to the same
            // days. (T24 sweep #8, 2026-09-06)
            sb.from("sessions").select("id,bill_no,invoice_no,table_number,cust_name,cust_phone")
              .eq("restaurant_id", rid)
              .gte("created_at", new Date(Date.parse(windowStartIso) - 24 * 3600 * 1000).toISOString())
              .limit(2000),
            // …and the guest's own name on their phone.
            sb.from("session_members").select("session_id,name,phone")
              .eq("restaurant_id", rid).ilike("name", like).limit(300),
          ]);
          const hit = new Set<string>();
          for (const r of ((sessQ2.data || []) as Record<string, unknown>[])) {
            const bn = r.bill_no == null ? "" : String(r.bill_no);
            const iv = r.invoice_no == null ? "" : String(r.invoice_no);
            const ph = String(r.cust_phone ?? "").replace(/\D/g, "");
            const nm = String(r.cust_name ?? "").toLowerCase();
            const tb = String(r.table_number ?? "").toLowerCase();
            const okNum = !!digits && (bn.endsWith(digits) || iv.endsWith(digits)
              || iv.padStart(6, "0").includes(digits) || ph.includes(digits) || tb === digits);
            const okTxt = nm.includes(histQ.toLowerCase()) || tb.includes(histQ.toLowerCase());
            if (okNum || okTxt) hit.add(String(r.id));
          }
          for (const m of ((memQ2.data || []) as Record<string, unknown>[])) {
            if (m.session_id) hit.add(String(m.session_id));
          }
          if (!hit.size) return ok([]);
          oq = oq.in("session_id", [...hit].slice(0, 400));
        } else if (type === "inv" || type === "bill") {
          // invoice_no / bill_no live on the SESSION → find matching sessions, then their orders.
          const col = type === "inv" ? "invoice_no" : "bill_no";
          // Match the LAST run of digits so a full formatted invoice pasted in
          // ("INV/2025-26/000042") resolves to its sequence number (42) — the old
          // strip-ALL-non-digits turned that into 2025260000042 and found nothing (2026-07-06).
          const m = histQ.match(/(\d+)(?!.*\d)/);
          const n = m ? parseInt(m[1], 10) : NaN;
          if (!Number.isFinite(n)) return ok([]);
          const sess = must(await sb.from("sessions").select("id").eq("restaurant_id", rid).eq(col, n).limit(200));
          const ids = (sess as any[]).map((s) => s.id);
          if (!ids.length) return ok([]);
          oq = oq.in("session_id", ids);
        } else if (type === "table") {
          oq = oq.eq("table_number", histQ);
        } else if (type === "cust") {
          // Customer name lives on the session's member rows (session_members.name), NOT on
          // orders — orders.customer_name is a SYNTHETIC field attached during enrichment
          // below, so it can't be queried. Resolve matching sessions by member name (rid-
          // scoped), then return those sessions' orders. No match → no bills.
          const mem = must(await sb.from("session_members").select("session_id").eq("restaurant_id", rid).ilike("name", `%${histQ}%`).limit(200));
          const sIds = [...new Set((mem as any[]).map((m) => m.session_id).filter(Boolean))];
          if (!sIds.length) return ok([]);
          oq = oq.in("session_id", sIds);
        } else if (type === "date") {
          // A DAY MEANS THE RESTAURANT'S DAY, NOT THE SERVER'S (sweep 2026-08-04).
          // This used `new Date(histQ)` + `setHours(0,0,0,0)`, which builds the window in
          // whatever timezone the server happens to run in — UTC on Vercel. So searching for
          // "5 August" actually asked for 05:30 IST on the 5th → 05:30 IST on the 6th: a bill
          // taken at 03:00 IST on the 5th was filed under the 4th and simply couldn't be found
          // under its own date. Anchored to IST explicitly, the same way gst-report builds its
          // month. (The date PICKER left the Bills tab in PR #748, so only a stale cached panel
          // can still reach this — but a live branch that returns the wrong day is worse than
          // one nobody calls.)
          // The date picker sends YYYY-MM-DD; anything else is parsed and then read back as an
          // IST calendar date, so both spellings land on the same day.
          const raw = String(histQ).trim();
          let day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
          if (!day) {
            const parsed = new Date(raw);
            if (isNaN(parsed.getTime())) return ok([]);
            day = new Date(parsed.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
          }
          const dayStart = new Date(`${day}T00:00:00+05:30`);
          if (isNaN(dayStart.getTime())) return ok([]);
          const dayEnd = new Date(dayStart.getTime() + 864e5);
          oq = oq.gte("created_at", dayStart.toISOString()).lt("created_at", dayEnd.toISOString());
        }
      } else if (tbl) {
        // THE FLOOR SLICE — only the party sitting there NOW.
        //
        // This branch is used ONLY by the panel's live table slice (loadTableSlice /
        // pollTables); bill history goes through the ?history= branch above or the unscoped
        // list. It used to return the newest 200 orders EVER placed at that table number,
        // archived ones included — so the browser was handed nine-day-old food belonging to a
        // party that had long left, and one missing filter in the panel put it on the new
        // guests' screen and nearly on their bill (owner report, 2026-07-30; PR #578 fixed the
        // panel, this closes the door on the server side so no future panel can repeat it).
        //
        // Rule, identical to lfh_table_view_summary and to the panels: the table's CURRENT open
        // party, plus a party-LESS row at that table — but only one that appeared AFTER the party
        // sat down (owner report, 2026-07-31).
        //
        // "plus every session-less row" was too generous and it showed: table 2 carried two live
        // orders from 7 JULY with no session at all. The tile counted the party's 1 dish (correct);
        // this slice handed the browser all three, so the detail said 7 dishes / ₹6,048 and
        // "Mark all paid" would have charged tonight's guests for food ordered 24 days earlier.
        // An order older than the party cannot be the party's — while a genuinely party-less row
        // taken DURING this sitting (banquet, a legacy path) still counts, so nothing is hidden.
        // The 60s of slack covers an order that landed a moment before its session row existed.
        oq = oq.eq("table_number", tbl).eq("archived", false).is("deleted_at", null);
        {
          // A MERGED TABLE'S PARTY IS ITS PARENT'S (mig 249). Its own orders carry ITS table
          // number — that is deliberate, it is what an unmerge hands back — but they sit on the
          // parent's session, so scoping to "an open party on THIS table" found nothing and the
          // table's own detail reported "nothing was ordered here" about food on the joint bill.
          const mergedParent = (await sb.from("table_merges").select("parent_table")
            .eq("restaurant_id", rid).eq("child_table", tbl).is("ended_at", null).limit(1)).data?.[0] as { parent_table?: string } | undefined;
          const partyTable = mergedParent?.parent_table || tbl;
          const liveSess = (await sb.from("sessions").select("id,opened_at").eq("restaurant_id", rid)
            .eq("table_number", partyTable).eq("status", "open")
            .order("last_activity_at", { ascending: false }).limit(1)).data?.[0] as { id: string; opened_at?: string } | undefined;
          if (liveSess) {
            const since = new Date(new Date(liveSess.opened_at || 0).getTime() - 60_000).toISOString();
            oq = oq.or(`session_id.eq.${liveSess.id},and(session_id.is.null,created_at.gte.${since})`);
          } else {
            const setRow = (await sb.from("settings").select("sessions_enabled").eq("restaurant_id", rid).maybeSingle()).data as { sessions_enabled?: boolean } | null;
            // No open party: with sessions ON there is nobody to own anything (the tile reads
            // free). With sessions OFF a table can still legitimately hold party-less legacy rows.
            if (setRow?.sessions_enabled) oq = oq.is("session_id", null);
          }
        }
      }
      // The bills window is a bounded day-or-two of records, so it may need more than the
      // floor's 200-row working set on a busy day — still explicit, scoped and limited.
      const orders = must(await oq.order("created_at", { ascending: false }).limit(billsMode ? 500 : 200));
      // Attach each order's SESSION invoice/bill state so the merged bill card knows
      // whether it's invoiced/locked (invoice lives on the session, not the order).
      const sids = [...new Set(orders.map((o: any) => o.session_id).filter(Boolean))];
      if (sids.length) {
        // `bill_printed_at` rides along (mig 333) so the panel knows a bill has ALREADY been on
        // paper and can label its button "Reprint" instead of "Print". It has to come from the row,
        // not from the device that printed: the case that matters is the manager printing at the
        // till and a WAITER reprinting from the tablet a minute later, whose own screen would
        // otherwise still say "Print". REJECTED (owner, 2026-08-19): this must NOT put anything on
        // the paper or in the Audit — it changes one word on one button, nothing else.
        const [sessQ, memQ, chainQ, payQ] = await Promise.all([
          sb.from("sessions").select("id,status,invoice_no,invoice_voided,invoice_at,bill_no,cust_name,cust_phone,bill_printed_at").in("id", sids),
          sb.from("session_members").select("session_id,name,role").in("session_id", sids).eq("role", "owner"),
          // THE SIGNED CHAIN (mig 332), for the verification line the bill prints. `bill_chain` is
          // RLS-locked with NO policy — service role only, deliberately — so this is a scoped
          // SERVER read of just these sessions, never something a client could ask for. Only the
          // sequence and the hash leave here; the money on that row stays where it is.
          sb.from("bill_chain").select("session_id,seq,chain_hash").eq("restaurant_id", rid).in("session_id", sids).limit(500),
          // ── HOW THE MONEY ACTUALLY CAME IN (owner, 2026-08-22) ───────────────────────────────
          // A bill settled in parts — "half in UPI, half in cash" — is stored as ONE paid bill with
          // `payment_method = 'Split'`, and the parts live in `session_payments` (mig 176; a
          // pay-later leg since mig 352). The panel could already CREATE a split and could not SHOW
          // one back: every screen printed the bare word "Split" and the parts existed nowhere a
          // person could look. So the manager could take ₹200 UPI + ₹200 cash and then had no way
          // to answer "which was which?" — on the one screen that exists to answer questions about
          // a bill.
          //
          // Scoped exactly like its neighbours: this restaurant, and only the sessions already
          // being returned — no wider scope, an explicit column list, and a bound. It is ONE extra
          // read per bills load (not per bill, and not per keystroke), which is what the parts cost.
          // `session_payments` is RLS-locked with no policy, so this is service-role only and can
          // never be asked for by a client.
          sb.from("session_payments").select("session_id,amount,method,note,created_at")
            .eq("restaurant_id", rid).in("session_id", sids)
            .order("created_at", { ascending: true }).limit(2000),
        ]);
        const map: Record<string, any> = Object.fromEntries(((must(sessQ) || []) as any[]).map((s) => [s.id, s]));
        // A session has at most one chain row; if a re-issue ever produced two, the LATEST is the
        // one this bill was signed as, so it is the one that belongs on the paper.
        const chainMap: Record<string, { seq: number; chain_hash: string }> = {};
        for (const c of ((chainQ.data || []) as any[])) {
          if (!c.session_id) continue;
          const prev = chainMap[c.session_id];
          if (!prev || Number(c.seq) > Number(prev.seq)) chainMap[c.session_id] = { seq: c.seq, chain_hash: c.chain_hash };
        }
        const nameMap: Record<string, string> = {};
        for (const m of (must(memQ) || []) as any[]) { if (m.name && !nameMap[m.session_id]) nameMap[m.session_id] = m.name; }
        // The parts of a split, grouped by bill, oldest first — the order they were taken in.
        // A read failure is NOT fatal here: the bill's own total and method are already on the row,
        // so the worst case is the parts breakdown being absent, which the panel words as
        // "how it was split isn't available" rather than inventing a single method.
        const payMap: Record<string, { amount: number; method: string; note: string | null; at: string }[]> = {};
        for (const pp of ((payQ.data || []) as any[])) {
          if (!pp.session_id) continue;
          (payMap[pp.session_id] ||= []).push({
            amount: Number(pp.amount) || 0, method: String(pp.method || ""),
            note: pp.note ?? null, at: pp.created_at,
          });
        }
        for (const o of orders as any[]) {
          const s = map[o.session_id];
          if (s) {
            o.invoice_no = s.invoice_no; o.invoice_voided = s.invoice_voided; o.invoice_at = s.invoice_at; o.bill_no = s.bill_no;
            // IS THE TABLE STILL ON THE FLOOR? (owner, 2026-08-26.) The Bills tab has to tell a
            // LIVE bill being corrected before payment from a FINISHED one whose party has left —
            // they take two different doors (void-invoice vs reopen-table, mig 365) and the button
            // has to pick the right one. It cannot ask state.board.sessions: that holds only the
            // SELECTED table's slice, so in the Bills tab it is empty and every bill would look
            // open. Found by driving it — the button rendered, and rendered the wrong door.
            o.session_status = s.status;
            // who the BILL is made out to (captured at invoice time, mig 227). Kept apart
            // from customer_name below, which is the guest's own name on their phone.
            o.bill_cust_name = s.cust_name; o.bill_cust_phone = s.cust_phone;
            // Has this bill already been on paper? (mig 333) — the BUTTON then says "Reprint".
            o.bill_printed_at = s.bill_printed_at;
            // The verification line the bill prints (mig 332). Named the way billdoc's billData
            // reads them off the session, so no panel has to reshape anything.
            const ch = chainMap[o.session_id];
            if (ch) { o.chain_seq = ch.seq; o.chain_hash = ch.chain_hash; }
          }
          if (nameMap[o.session_id]) o.customer_name = nameMap[o.session_id];
          // Attached to EVERY order of the bill, because the panel resolves a bill from whichever
          // of its orders it happens to hold — the same reason invoice_no is attached per order
          // above rather than once per session.
          const parts = payMap[o.session_id];
          if (parts && parts.length) o.pay_parts = parts;
        }
      }
      if (billsMode) {
        // PARCEL BILLS BELONG IN THE BILLS RECORD (owner, 2026-08-03: "the parcel bill should
        // also come in the bill section"). Parcels live in aggregator_orders, a different
        // table from dine-in orders, which is why they never appeared here — and a finished
        // parcel even leaves the Platform board after ~6 minutes, making its bill invisible
        // everywhere. FINISHED parcels (handed over / cancelled) inside the same clamped
        // window ride along here; active ones stay on the Platform board, which is their
        // operational home. Same explicit column list as the Platform read — no payload.
        const parcels = (await parcelLadder(rid)).effective
          ? (must(await sb.from("aggregator_orders")
              .select("id,source,items,total,status,kot_no,bill_no,invoice_no,invoice_at,created_at,customer_name,customer_phone,paid,printed_at,payment_method,discount:payload->discount,discount_note:payload->>discount_note")
              .eq("restaurant_id", rid).eq("source", "parcel")
              .in("status", ["handed_over", "cancelled"])
              .gte("created_at", windowStartIso)
              .order("created_at", { ascending: false }).limit(300)) || [])
          : [];
        return ok({ rows: orders, parcels, reach });
      }
      return ok(orders);
    }

    if (p === "calls") {
      const tbl = new URL(req.url).searchParams.get("table"); // targeted refetch (see /orders)
      let cq = sb.from("waiter_calls").select("*").eq("restaurant_id", rid);
      if (tbl) cq = cq.eq("table_number", tbl);
      return ok(must(await cq.order("created_at", { ascending: false }).limit(100)));
    }

    // Issues this restaurant has raised (newest first, open before resolved) — so the
    // manager can see what they've reported + its status. Scoped to THIS restaurant.
    if (p === "issues") {
      const rows = must(await sb.from("issues").select("*").eq("restaurant_id", rid).order("status", { ascending: true }).order("created_at", { ascending: false }).limit(100));
      // A photo or voice note attached to a complaint is private paperwork: hand the screen a
      // short-lived signed link, never the permanent public one (lib/mediaLinks.ts).
      return ok(await signRows("issue-media", rows as Record<string, unknown>[], ["image_url", "audio_url"]));
    }

    // Platform (Zomato/Swiggy/takeaway) orders + the two operator toggles. Read
    // from the separate aggregator_orders table — dine-in `orders` is untouched.
    if (p === "platform") {
      // The Platform board is a ladder MODULE (mig 209). It shows delivery-app orders
      // (Zomato/Swiggy/website) when the platform module is effective AND that channel is on,
      // plus staff PARCELS (own source, own `parcel` module). Refuse only when BOTH are off.
      const [plat, parc] = await Promise.all([platformLadder(rid), parcelLadder(rid)]);
      if (!plat.effective && !parc.effective) return err("The Platform board isn't enabled for this restaurant.", 403);
      // Which delivery channels are live for this restaurant (settings.platform_channels).
      // website is stored under source 'takeaway' (the existing plumbing) but labelled "Website".
      const settingsRow = must(await sb.from("settings")
        .select("kitchen_can_accept_platform, platform_in_bills, platform_channels").eq("restaurant_id", rid).maybeSingle()) as
        { kitchen_can_accept_platform?: boolean; platform_in_bills?: boolean; platform_channels?: Record<string, { on?: boolean }> } | null;
      const chan = settingsRow?.platform_channels || {};
      const chOn = (k: string) => chan?.[k]?.on === true;
      // Build the set of sources this board may show: enabled delivery channels ∪ parcels.
      const sources: string[] = [];
      if (plat.effective) { if (chOn("zomato")) sources.push("zomato"); if (chOn("swiggy")) sources.push("swiggy"); if (chOn("website")) sources.push("takeaway"); }
      if (parc.effective) sources.push("parcel");
      const channels = { zomato: plat.effective && chOn("zomato"), swiggy: plat.effective && chOn("swiggy"), website: plat.effective && chOn("website") };
      // Nothing to show (module on but every channel off, parcel off) → empty board, no query.
      if (!sources.length) return ok({ orders: [], toggles: { ...(settingsRow || {}) }, channels, platform_on: plat.effective, parcel_on: parc.effective });
      // Active orders (any age) + just-handed-over ones (last 6 min): a handed-over
      // ticket lingers ~6 min in the board's "Handed over" column for a final glance,
      // then drops off the live board. Cancelled never show. (owner, 2026-06-21)
      const handoverCutoff = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      // Explicit column list (NOT select("*")) on this POLLED path — the board only renders
      // these, and select("*") pulled the heavy `payload` (full webhook body) + growing
      // `status_history` on every 60s/2s poll for nothing (egress). updated_at is only used
      // in the server-side filter below, so it doesn't need selecting. Scoped to the live sources.
      // printed_at rides along (mig 256) so the floor's Parcel tiles know when a parcel is
      // finished — the tile stays until it is BOTH printed and paid.
      // payment_method too (one short string): the card's 🖨 Print bill prints the customer's
      // receipt straight from these rows, and a receipt that can't say how it was paid is wrong.
      // bill_no / invoice_no / invoice_at ride along (mig 261): a parcel or a delivery order is
      // numbered from the SAME two counters a dine-in bill uses, and the numbers have to reach
      // the panel or the printed receipt would go out blank where a table bill shows them.
      // The discount comes across as TWO JSON PATHS, not the payload column (2026-08-03). A
      // parcel's discount is recorded in `payload` because aggregator_orders has no column for
      // it — but selecting `payload` here would drag the whole webhook body back onto this polled
      // path, which is the exact thing the note above says not to do. `payload->discount` fetches
      // the two small values and nothing else, so the detail card and the printed bill can show
      // what was taken off at no meaningful egress cost.
      const rows = sb.from("aggregator_orders").select("id,source,items,total,status,kot_no,bill_no,invoice_no,invoice_at,created_at,customer_name,customer_phone,paid,printed_at,payment_method,discount:payload->discount,discount_note:payload->>discount_note").eq("restaurant_id", rid)
        .in("source", sources)
        .or(`status.eq.new,status.eq.accepted,status.eq.preparing,status.eq.ready,and(status.eq.handed_over,updated_at.gte.${handoverCutoff})`)
        .order("created_at", { ascending: false }).limit(200);
      return ok({ orders: must(await rows) || [], toggles: { kitchen_can_accept_platform: settingsRow?.kitchen_can_accept_platform, platform_in_bills: settingsRow?.platform_in_bills }, channels, platform_on: plat.effective, parcel_on: parc.effective });
    }

    // Day-close "Z report": the business-day totals, computed SERVER-SIDE from the DB
    // (discount BEFORE tax, same as billMath). Dine-in + platform + invoices/voids.
    if (p === "zreport") {
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      const since = businessDayStartIso();
      // The day-close report MUST see the WHOLE business day. A plain select is capped at
      // PostgREST's db-max-rows (~1000 rows), which on a busy day (>1000 orders) silently
      // computed the till on a truncated sample → understated cash. Page through every order
      // so the Z-report money is COMPLETE, not a partial read. (owner 2026-07-06)
      const orders: any[] = [];
      // Advance by the ACTUAL number of rows returned and stop only on an EMPTY page — so this
      // stays complete even if PostgREST's db-max-rows is configured below 1000 (a fixed +1000
      // step would break early and undercount there). Hard cap the loop as a safety belt.
      for (let from = 0, guard = 0; guard < 500; guard++) {
        // ── payment_method IS READ FOUR TIMES BELOW, SO IT HAS TO BE ASKED FOR (T11 sweep #7, 2026-08-30)
        // It was missing from this column list while the code underneath read `o.payment_method` four
        // times, so every one of those reads was `undefined`:
        //   · the till breakdown labelled EVERY bill not settled in parts "Not recorded" — measured on
        //     2026-08-26, this report said "Not recorded ₹1,932 / 4 bills" for the same business day and
        //     the same window (05:00 IST) where the owner's day sheet said "Cash ₹1,932 / 4 bills". The
        //     money and the bill count were right; only the NAME was wrong — and at day close "nobody
        //     wrote down how this was paid" is an action item that was not real.
        //   · `onHouseCount` / `onHouseNet` could never be anything but zero, so an on-the-house bill
        //     fell into paidCount/paidNet instead — counted as money collected when nothing was.
        // One column, and it is a short string on a query that already pages the day's orders.
        const page = (must(await sb.from("orders").select("id,session_id,subtotal,taxable_base,nontax_amount,mrp_amount,tax_rate,discount,status,payment_status,tip,payment_method")
          .eq("restaurant_id", rid).gte("created_at", since)
          .order("created_at", { ascending: true }).range(from, from + 999)) as any[] | null) || [];
        orders.push(...page);
        if (page.length === 0) break;
        from += page.length;
      }
      const [invQ, voidQ, platQ, setQ, legQ, openSessQ, cntQ, numAggQ] = await Promise.all([
        sb.from("sessions").select("id").eq("restaurant_id", rid).gte("invoice_at", since).limit(50000),     // invoices GENERATED today
        sb.from("sessions").select("id").eq("restaurant_id", rid).gte("void_at", since).limit(50000),        // invoices VOIDED today
        sb.from("aggregator_orders").select("total,status").eq("restaurant_id", rid).gte("created_at", since).limit(5000),
        sb.from("settings").select(`${TAX_SETTINGS_COLUMNS}, restaurant_name, gstin, invoice_prefix`).eq("restaurant_id", rid).maybeSingle(),
        // HOW THE MONEY CAME IN — the day's payment legs (2026-08-05). `session_payments` was
        // WRITE-ONLY: lib/paySplit.ts inserted legs and stamped them reversed, and nothing in the
        // product ever read one. So the day-close had no cash-vs-UPI line at all and a manager could
        // not count the drawer against it, while a split-settled bill showed only "Split". Reversed
        // legs are read too, and reported separately — a reversal is never hidden, only excluded
        // from what was collected (mig 285). Scoped, explicit columns, limited.
        sb.from("session_payments").select("session_id,amount,method,reversed_at").eq("restaurant_id", rid)
          .gte("created_at", since).limit(20000),
        // Which of today's tables are STILL SITTING — see the till count below. Ids only, one
        // indexed filter, and only the open ones, so it is a few rows however busy the day was.
        sb.from("sessions").select("id").eq("restaurant_id", rid).is("closed_at", null).limit(5000),
        // IS EVERY NUMBER ACCOUNTED FOR? (owner, 2026-08-06 — "show gaps on the Z-report".)
        //
        // Gaps in the bill/invoice series are CORRECT here: a number retires on a void and is never
        // reused (mig 073, mig 261, COMPLIANCE §2). Both migrations reason that a gap is always
        // explainable "because the cancelled row is visible and auditable" — true, but only for
        // someone who knows to go and look. This is the day-close sheet a manager signs and an
        // inspector reads, so it now says so out loud: the range issued today, which numbers are on
        // something other than an ordinary settled bill (and why), and — the line that actually
        // matters — whether any number in the range is on NOTHING at all.
        //
        // Only the PARCEL/DELIVERY half can be fetched HERE. Those rows take their number at insert,
        // so their own created_at really is the day it was issued. The SESSIONS half cannot: bill_no
        // is lazy (mig 040), so a date filter on sessions gets it wrong — see the numbering block
        // below, which scopes by the day's ORDERS instead.
        //
        // HOW MANY NUMBERS WERE HANDED OUT TODAY — ASKED, NOT INFERRED (2026-08-06, third attempt).
        //
        // `daily_counters` is the row the bill trigger itself bumps, so its `n` IS the count of bill
        // numbers issued for this restaurant today. Two earlier versions of this section guessed the
        // range from the min/max of whatever rows they could still find, which turns any row they
        // could not see into an accusation — they named 2 wrong numbers, then 25. The counter cannot
        // be wrong about its own count, so the range comes from here and nowhere else.
        // Keyed exactly as lfh_business_day() keys it (see businessDayDate).
        sb.from("daily_counters").select("n").eq("restaurant_id", rid).eq("key", "bill")
          .eq("day", businessDayDate()).maybeSingle(),
        // Parcel / delivery share the SAME counters (mig 261), so they are part of the same series
        // and a Z-report that ignored them would report every one of their numbers as a gap.
        // `source` is the column that names the channel (zomato / swiggy / website / parcel) — there
        // is no `channel` column. Selecting one that does not exist makes PostgREST reject the WHOLE
        // query, and must() turns that into a 500, so the day-close sheet stopped building at all
        // (shipped 2026-08-06, caught the same day by the write-test half of the T7 re-run).
        sb.from("aggregator_orders").select("bill_no,invoice_no,status,created_at,source")
          .eq("restaurant_id", rid).gte("created_at", since).not("bill_no", "is", null).limit(20000),
      ]);
      const set = (must(setQ) || {}) as any;
      // Effective rate = sum of named tax components (CGST/SGST/…), else the fallback
      // rate, else 5% — the SAME rule as billMath/the printed bill (lib/tax.ts), so the
      // Z-report tax matches what the day's bills actually charged. Was flat tax_rate/5%.
      const rate = effectiveTaxRate(set);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      // Group orders into BILLS by session_id (a solo order is its own bill) so the
      // tax is computed per-bill — IDENTICAL to billMath()/the printed receipt — and the
      // Z-report net reconciles to the penny with the sum of the day's printed bills.
      // (Taxing each order separately could drift a rupee or two on multi-order tables.)
      const groups = new Map<string, any[]>();
      // CANCELLATIONS ARE REPORTED, NOT JUST COUNTED (owner, 2026-08-16). The day-close sheet has
      // always said how MANY orders were cancelled and never what they were WORTH — and the value
      // is the number that means something: nine voids on a quiet night is a conversation, and a
      // manager voiding ₹40,000 of food is a different conversation from one voiding ₹400. Nothing
      // was collected on any of it, so this never touches gross/net/tax; it is stated beside them.
      // Same shape as the money below: the taxable base plus the untaxed part, falling back to
      // subtotal for legacy rows — i.e. what the guest WOULD have been charged before tax.
      let orderCount = 0, cancelled = 0, cancelledNet = 0;
      for (const o of orders) {
        if (o.status === "cancelled") {
          cancelled++;
          cancelledNet += (o.taxable_base == null ? (Number(o.subtotal) || 0) : (Number(o.taxable_base) || 0))
            + (Number(o.nontax_amount) || 0);
          continue;
        }
        orderCount++;
        const key = o.session_id || ("solo:" + o.id);
        (groups.get(key) || (groups.set(key, []), groups.get(key)!)).push(o);
      }
      // THE TAXABLE FIGURE IS THE TAXABLE BASE, NOT THE SUBTOTAL (mig 270). A bill can now
      // carry MRP / nil-rated lines that are never taxed and never discounted, so taxing the
      // whole subtotal would declare output tax on money no guest was charged it on. The MRP
      // turnover gets its OWN line instead, and gross keeps meaning "everything sold" — so the
      // day still reconciles to the rupee: gross − discount = taxable, taxable + tax + mrp = net.
      // Legacy rows (taxable_base NULL) fall back to subtotal with mrp 0, which is exactly what
      // those bills charged, so yesterday's Z-report is unchanged.
      //
      // The two MRP treatments sort themselves out here with no branch, which is the point of
      // freezing the behaviour on the line: under mrp_tax_treatment='inclusive' an MRP line
      // resolves to 'incl', so its net sits INSIDE taxable_base and the GST pulled out of it is
      // already counted as tax collected; under 'none' it resolves to 'exempt', lands in
      // nontax_amount, and contributes no tax at all. The report never has to ask which.
      let gross = 0, disc = 0, taxable = 0, tax = 0, net = 0, mrp = 0;
      let paidCount = 0, paidNet = 0, unpaidCount = 0, unpaidNet = 0; // counts are BILLS, not orders
      let onHouseCount = 0, onHouseNet = 0;                            // comped — a real sale, zero collected
      for (const g of groups.values()) {
        const base = g.reduce((a, o) => a + (o.taxable_base == null ? (Number(o.subtotal) || 0) : (Number(o.taxable_base) || 0)), 0);
        const nontax = g.reduce((a, o) => a + (Number(o.nontax_amount) || 0), 0);
        const sub = r2(base + nontax);
        // THE RATE EACH ORDER WAS ACTUALLY CHARGED AT (orders.tax_rate, mig 284) — capped and
        // taxed per rate bucket by billTaxOf(), the one definition shared with the printed bill
        // and pay-in-parts. It used to borrow ONE rate for the whole bill; see billTaxOf's own
        // note for the banquet case that made the day-close disagree with the paper.
        // `rate` (the restaurant's settings) stays the fallback for rows from before the column.
        const { disc: d, taxable: tx, tax: t } = billTaxOf(g, rate);
        // One formula for both cases — subtotal − discount + tax — so a zero-rate (composition)
        // day, where the discount can land outside the taxable base, still adds up.
        const tot = r2(sub - d + t);
        gross += sub; disc += d; taxable += tx; tax += t; net += tot; mrp += nontax;
        // A bill counts as collected only when EVERY order on it is paid (a table settles in
        // one go — Mark paid pays the whole table — so this matches real behaviour).
        //
        // ON THE HOUSE IS NOT MONEY IN THE TILL (2026-08-05). Comping sets `discount = subtotal`,
        // but every discount door caps a discount at the TAXABLE base (mig 272 — a sealed MRP price
        // is locked and may not be discounted), so a comped bill carrying a bottle kept a residue:
        // sub 880 − capped disc 800 = ₹80 counted into GRAND TOTAL on a bill nobody paid for. The
        // sale still shows in gross and discount, and now has its own line, so nothing is hidden —
        // it simply stops being counted as cash.
        if (g.some((o) => o.payment_method === ON_THE_HOUSE_METHOD)) { onHouseCount++; onHouseNet += tot; }
        else if (g.every((o) => o.payment_status === "paid")) { paidCount++; paidNet += tot; }
        else { unpaidCount++; unpaidNet += tot; }
      }
      // ── HOW THE MONEY CAME IN, by method — the day-close till count ─────────────────────────
      // Two sources, and each bill uses exactly one of them so nothing is counted twice:
      //   · a bill settled in PARTS carries payment_method 'Split' and its real methods live in
      //     session_payments, so the legs speak for it;
      //   · every other paid bill states its own method on the order rows.
      // Reversed legs are excluded from what was collected and reported on their own line.
      const legs = (must(legQ) || []) as { session_id: string | null; amount: number; method: string | null; reversed_at: string | null }[];
      const byMethod = new Map<string, { amount: number; count: number }>();
      const addMethod = (m: string, amt: number) => {
        const key = (m || "").trim() || "Not recorded";
        const row = byMethod.get(key) || { amount: 0, count: 0 };
        row.amount = r2(row.amount + amt); row.count += 1;
        byMethod.set(key, row);
      };
      // ── A LEG ON A BILL THAT IS NOT SETTLED IS NOT TODAY'S TAKINGS (T11, 2026-09-01) ────────
      // The stated side below already skips a bill that is still open. The legs loop skipped
      // nothing but a reversal, so a table that had paid HALF and was still sitting there was
      // counted as money collected — and the till list totalled more than the day's takings
      // printed above it. Measured in one moment on French House: the list came to ₹14,301
      // against a day that had taken ₹12,369, and the difference was a single open table with
      // three payment legs on it (session 7e261230).
      //
      // The money is REAL — it is in the drawer — so it is not thrown away. It moves to its own
      // line, exactly the way a reversed leg already has one, so BOTH numbers are true at once:
      // the method list totals the day's takings, and the drawer still reconciles. Excluding it
      // silently would have left a manager counting cash over by that amount with nothing on the
      // report to explain it.
      // THE TEST IS "IS THE TABLE STILL SITTING", NOT "IS THE BILL STAMPED PAID". Three shapes,
      // and only the first is money that has not been collected yet:
      //   · a table STILL OPEN that has paid part of its bill — the cash is in the drawer, but the
      //     bill is not finished, so it is not today's takings;
      //   · a bill settled in parts, all real methods — closed, collected, belongs in the list;
      //   · a bill closed with one part on a TAB (mig 364) — the session is CLOSED and the collected
      //     parts really were collected today, even though `payment_status` is deliberately not
      //     'paid' because money that never arrived is never claimed. Keying off payment_status
      //     would have thrown this cash out of the till count, which is why the test is the session.
      const openSessions = new Set<string>(
        ((must(openSessQ) || []) as { id: string }[]).map((r2s) => String(r2s.id)),
      );
      let reversedNet = 0, reversedCount = 0, asideNet = 0, asideCount = 0;
      for (const l of legs) {
        const amt = Number(l.amount) || 0;
        if (l.reversed_at) { reversedNet = r2(reversedNet + amt); reversedCount += 1; continue; }
        if (l.session_id && openSessions.has(String(l.session_id))) {
          asideNet = r2(asideNet + amt); asideCount += 1; continue;
        }
        addMethod(String(l.method || ""), amt);
      }
      // The order-stated side, per BILL so a multi-order table counts once, and net of its discount
      // the same way every figure above is.
      for (const g of groups.values()) {
        if (g.some((o: any) => o.payment_method === ON_THE_HOUSE_METHOD)) continue;   // nothing collected
        if (!g.every((o: any) => o.payment_status === "paid")) continue;              // still open
        const method = String((g.find((o: any) => o.payment_method) || {}).payment_method || "");
        if (method === "Split") continue;                                             // its legs already spoke
        const base = g.reduce((a: number, o: any) => a + (o.taxable_base == null ? (Number(o.subtotal) || 0) : (Number(o.taxable_base) || 0)), 0);
        const ntx = g.reduce((a: number, o: any) => a + (Number(o.nontax_amount) || 0), 0);
        // Same per-rate rule as the money totals above — one definition, so "how the money came
        // in" can never total differently from the day's net.
        const { disc: d2, tax: t2 } = billTaxOf(g, rate);
        addMethod(method, r2(r2(base + ntx) - d2 + t2));
      }
      const payments = [...byMethod.entries()]
        .map(([method, v]) => ({ method, amount: r2(v.amount), bills: v.count }))
        .sort((a, b) => b.amount - a.amount);
      const paymentsTotal = r2(payments.reduce((a, p2) => a + p2.amount, 0));
      // `aside` mirrors `reversed`: money that moved but is not part of today's takings.

      const plat = (must(platQ) || []) as any[];
      // Exclude cancelled AND still-"new" (pending, unaccepted) delivery orders — the same
      // filter the dashboard /stats uses — so the Z-report platform revenue matches the
      // dashboard's "today" box instead of counting money that hasn't been accepted yet.
      const platActive = plat.filter((p2) => p2.status !== "cancelled" && p2.status !== "new");
      const platRevenue = r2(platActive.reduce((a, p2) => a + (Number(p2.total) || 0), 0));
      // Tips collected today = SUM(orders.tip) over PAID, non-cancelled orders. Tips are EXTRA staff
      // money on top of the bill (never part of revenue/tax), so reported as their own figure.
      const tips = r2(orders.filter((o) => o.status !== "cancelled" && o.payment_status === "paid").reduce((a, o) => a + (Number(o.tip) || 0), 0));

      // ── EVERY NUMBER ACCOUNTED FOR ─────────────────────────────────────────────────────────────
      //
      // A BILL NUMBER IS TAKEN ON THE FIRST ORDER, NOT WHEN THE TABLE OPENS — mig 040 made it lazy so
      // a tap that never orders cannot burn one. So "today's numbered bills" is NOT "sessions created
      // today": a table opened last night whose first order lands this morning takes TODAY's number
      // while its own created_at says yesterday. The first version of this block filtered sessions by
      // created_at, could not see that bill, and reported its number under "on no bill at all" — the
      // one line here that has to be trustworthy. It was doing exactly that on the dev stack (two
      // numbers), found when the write-test half of the T7 re-run asked the LIVE site for a real
      // Z-report rather than trusting that the code reads correctly.
      //
      // …so BOTH doors are used, and the set is their UNION: a session counts as today's if one of
      // TODAY's orders belongs to it (catches the overnight table), OR it was created today (catches a
      // bill whose orders have since been removed by something outside the app). Using either alone
      // under-counts, and every number it under-counts becomes a false accusation below.
      const SESSION_NUM_COLS = "id,bill_no,invoice_no,invoice_voided,void_at,deleted_at,delete_reason,table_number,closed_at,created_at";
      const daysSessionIds = [...new Set(orders.map((o) => o.session_id).filter(Boolean))] as string[];
      const [byOrderQ, byDayQ] = await Promise.all([
        daysSessionIds.length
          ? sb.from("sessions").select(SESSION_NUM_COLS).eq("restaurant_id", rid).in("id", daysSessionIds).not("bill_no", "is", null).limit(20000)
          : Promise.resolve({ data: [] as any[] }),
        sb.from("sessions").select(SESSION_NUM_COLS).eq("restaurant_id", rid).gte("created_at", since).not("bill_no", "is", null).limit(20000),
      ]);
      const numById = new Map<string, any>();
      for (const r of [...((byOrderQ as any).data || []), ...((byDayQ as any).data || [])]) numById.set(r.id, r);
      const numRows = [...numById.values()];
      // Today's orders BY SESSION — cancelled ones INCLUDED, unlike `groups` above, which skips them
      // for the money. A bill whose every order was cancelled still took a number, and "cancelled" is
      // precisely the reason worth printing beside it.
      const allBySession = new Map<string, any[]>();
      for (const o of orders) {
        if (!o.session_id) continue;
        (allBySession.get(o.session_id) || (allBySession.set(o.session_id, []), allBySession.get(o.session_id)!)).push(o);
      }
      const ist = (t: string | null) => (t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "");
      const numbered: { no: number; note: string; at: string }[] = [];
      const seen = new Set<number>();
      for (const s of numRows as any[]) {
        const no = Number(s.bill_no);
        if (!Number.isFinite(no)) continue;
        seen.add(no);
        const own = allBySession.get(s.id as string) || [];
        // Only the states a person would ask about. An ordinary settled or still-running bill is
        // not listed — a sheet that names every number says nothing (the don't-cry-wolf rule).
        const why = s.deleted_at ? `deleted${s.delete_reason ? ` — ${String(s.delete_reason).slice(0, 60)}` : ""}`
          : (own.length > 0 && own.every((o: any) => o.status === "cancelled")) ? "cancelled"
            : s.invoice_voided === true ? "invoice voided, number retired"
              : "";
        if (why) numbered.push({ no, note: `T${s.table_number ?? "?"} · ${why}`, at: ist(s.deleted_at || s.void_at || s.closed_at || s.created_at) });
      }
      for (const a of (must(numAggQ) || []) as any[]) {
        const no = Number(a.bill_no);
        if (!Number.isFinite(no)) continue;
        seen.add(no);
        if (a.status === "cancelled") numbered.push({ no, note: `${a.source || "parcel"} · cancelled`, at: ist(a.created_at) });
      }
      // IS EVERY NUMBER ACCOUNTED FOR — THE RANGE COMES FROM THE COUNTER (owner, 2026-08-06, after I
      // got this wrong twice by guessing at it).
      //
      // `issued` is `daily_counters.n`: the row the bill trigger itself bumps, so it is the count of
      // numbers handed out today and it cannot be wrong about its own count. The numbers run 1..issued.
      // Both earlier versions inferred that range from the min/max of the rows they could find, which
      // makes any row they cannot see look like a hidden sale — they named 2 wrong numbers, then 25.
      //
      // What we look for is therefore a number in 1..issued that NOTHING carries. Every path in the
      // product keeps its row (soft-delete, void and cancel all leave the number attached), so on a
      // real restaurant this is empty — which is exactly why it is worth printing. It is stated as a
      // COUNT plus the numbers, never as an accusation about money, and the flagged list above already
      // explains the ordinary reasons a number is not on a live bill.
      const issued = Math.max(0, Number((cntQ as any)?.data?.n) || 0);
      const unaccounted: number[] = [];
      for (let n = 1; n <= issued; n++) if (!seen.has(n)) unaccounted.push(n);
      const lo = issued > 0 ? 1 : 0;
      // The counter's own ceiling, not the highest number we happened to find — those differ exactly
      // when something is unaccounted for, which is the case this section exists to show.
      const hi = issued;
      numbered.sort((a, b) => a.no - b.no);

      return ok({
        // The day's numbering, stated plainly so "why is 43 missing?" has an answer on the sheet.
        numbering: {
          from: lo, to: hi, issued,
          onFile: seen.size,                    // how many of those numbers we can actually see
          flagged: numbered.slice(0, 200),
          unaccounted: unaccounted.slice(0, 200),
          unaccountedTotal: unaccounted.length, // the real count, even if the list above is capped
        },
        date: new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }), since,
        dineIn: { orderCount, bills: groups.size, gross: r2(gross), discount: r2(disc), taxable: r2(taxable), tax: r2(tax), net: r2(net),
          // MRP / nil-rated turnover, shown as its own line so the day's takings still add up
          // on the page: taxable + tax + mrp = net. 0 for every restaurant not using it.
          mrp: r2(mrp),
          paidCount, paidNet: r2(paidNet), unpaidCount, unpaidNet: r2(unpaidNet), cancelled, cancelledNet: r2(cancelledNet), tips,
          onHouseCount, onHouseNet: r2(onHouseNet) },
        // The till count: what came in and how. `total` is the sum of the methods, so a manager can
        // check it against paidNet — a gap means a bill was settled without a method recorded.
        payments: { rows: payments, total: paymentsTotal, reversed: r2(reversedNet), reversedCount, aside: r2(asideNet), asideCount },
        platform: { count: platActive.length, revenue: platRevenue },
        invoicesGenerated: (must(invQ) || []).length,
        invoicesVoided: (must(voidQ) || []).length,
        // ── THE DAY'S BILL LEDGER, VERIFIED (mig 332, owner 2026-08-16) ─────────────────────────
        // Every issued invoice is signed into an append-only chain, each link carrying the hash of
        // the one before it and the money the bill was signed at. This walks today's links and
        // answers two different questions: was the LEDGER touched (a link rewritten, or one removed
        // so the chain no longer joins up), and was a BILL touched after it was signed (its live
        // orders no longer add up to what was signed).
        //
        // It is on the day-close sheet deliberately. That is the moment a restaurant states its
        // takings, it is the paper an inspector is handed, and printing the verification beside the
        // money is what the fiscal regimes this design follows actually require. One tap on
        // "Z-report" IS the verify — nobody has to remember to run it.
        //
        // Best-effort: a verification that could fail the day-close would be worse than none, so a
        // problem reading it says so in `error` and every figure above still prints.
        chain: await (async () => {
          try {
            const v = await sb.rpc("lfh_verify_bill_chain", { p_rid: rid, p_from: since, p_to: new Date().toISOString() });
            if (v.error) return { ok: false, error: "could not be checked" };
            const rows = (v.data || []) as { kind: string; seq: number; invoice_no: number | null; bill_no: number | null; detail: string }[];
            const checked = rows.find((r) => r.kind === "checked");
            // A RECORDED ACT IS NOT A PROBLEM (mig 353). The verifier used to answer `bill_changed`
            // for three different things: a sale altered after signing, a bill put in the RECYCLE
            // BIN, and a sale CANCELLED after its invoice was issued. The last two are permitted,
            // recorded and reversible — and they are the common ones, so the day-close sheet printed
            // "⚠ Bill ledger — 11 problems" for eleven bills that were all fine (measured on the
            // backup stack). A sheet that cries wolf is a sheet a manager stops reading, and then the
            // one line that matters is buried in it.
            //
            // So the two lists are separate, and NEITHER is dropped: `problems` is what actually
            // needs telling the owner, `notes` is stated as information on the same sheet.
            const REAL = new Set(["row_rewritten", "chain_broken", "bill_changed"]);
            const findings = rows.filter((r) => r.kind !== "checked");
            const problems = findings.filter((r) => REAL.has(r.kind));
            const notes = findings.filter((r) => !REAL.has(r.kind));
            return {
              ok: problems.length === 0, bills: Number(checked?.seq) || 0,
              problems: problems.slice(0, 20), notes: notes.slice(0, 20), noteCount: notes.length,
            };
          } catch { return { ok: false, error: "could not be checked" }; }
        })(),
        // GRAND TOTAL = money actually COLLECTED today, so use paidNet (paid-only dine-in),
        // NOT net (which includes still-open/unpaid bills). Matches mig 113's paid-only rule +
        // the /stats endpoint; the old `net + platRevenue` overstated the day-close cash by the
        // value of any unpaid bills open at print time (owner-facing till mismatch). (2026-07-03)
        grandTotal: r2(paidNet + platRevenue), rate,
        restaurant: { name: set.restaurant_name || "Little French House", gstin: set.gstin || "" },
      });
    }

    // MONTHLY GST REPORT (restaurant's OWN dine-in sales only — excludes aggregators). Paid bills
    // only, discount BEFORE tax, per-bill tax — the SAME single-source math as the Z-report/printed
    // bill. GST is filed per CALENDAR month, so the window is [month-01 00:00 IST, next-month-01 IST).
    if (p === "gst-report") {
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      const sp = new URL(req.url).searchParams;
      const monthStr = /^\d{4}-\d{2}$/.test(sp.get("month") || "") ? sp.get("month")! : new Date().toISOString().slice(0, 7);
      const [y, m] = monthStr.split("-").map(Number);
      const startIso = new Date(`${monthStr}-01T00:00:00+05:30`).toISOString();
      const endIso = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00+05:30`).toISOString();
      // Complete read (page past PostgREST's ~1000-row cap) so a busy month isn't undercounted.
      const orders: any[] = [];
      for (let from = 0, guard = 0; guard < 500; guard++) {
        const page = (must(await sb.from("orders").select("id,session_id,subtotal,taxable_base,nontax_amount,mrp_amount,tax_rate,discount,status,payment_status,created_at")
          .eq("restaurant_id", rid).eq("payment_status", "paid").neq("status", "cancelled")
          .gte("created_at", startIso).lt("created_at", endIso)
          .order("created_at", { ascending: true }).range(from, from + 999)) as any[] | null) || [];
        orders.push(...page);
        if (page.length === 0) break;
        from += page.length;
      }
      const set = (must(await sb.from("settings").select(`${TAX_SETTINGS_COLUMNS}, restaurant_name, gstin`).eq("restaurant_id", rid).maybeSingle()) || {}) as any;
      const rate = effectiveTaxRate(set);
      const comps = taxComponents(set);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
      // Group orders into BILLS by session (per-bill tax = printed-bill parity), remembering each bill's IST day.
      // THE TAXABLE VALUE IS THE TAXABLE BASE, NOT THE SUBTOTAL (mig 270). A filing that
      // declares output tax on MRP / nil-rated turnover is wrong in the direction that costs
      // the restaurant money, so those lines are carried separately and reported on their own
      // row — the month still foots (taxable + tax + mrp = gross). Legacy rows have
      // taxable_base NULL and fall back to subtotal with no MRP, so past months are unchanged.
      // Under mrp_tax_treatment='inclusive' an MRP line resolves to 'incl' and its GST is
      // already inside `tax` here; under 'none' it is exempt and contributes none. No branch
      // is needed because the behaviour was frozen onto the line when it was sold.
      //
      // ── AND AT THE RATE EACH ORDER WAS ACTUALLY CHARGED (T24 sweep #8, 2026-09-06) ────────────
      // This block worked every bill out at ONE rate — `rate`, the restaurant's settings rate —
      // while selecting `tax_rate` in the column list above and never reading it. That is exactly
      // the rule the Z-report was moved off on 2026-08-11 (T7 finding F8) and that billTaxOf's own
      // header describes: a banquet carries its own rate (mig 239) and is inserted into the table's
      // existing OPEN session (migs 237/239), so an 18% banquet genuinely shares a bill with 5%
      // food — and this document declared the whole bill at 5%.
      //
      // MEASURED on the dev database, French House, August 2026: at each order's own rate the
      // month's output tax is ₹25,967.60; at the settings rate this reported ₹25,853.55 — ₹114.05
      // under-declared on the one document that goes to the tax authority. Every other month on
      // that restaurant carries a single rate and is unchanged to the paisa.
      //
      // Fixed by calling billTaxOf() — the SAME function the day-close sheet and the printed bill
      // use — instead of restating a second copy of the arithmetic here. `rate` stays as the
      // fallback for rows written before the column existed, which is all it ever was.
      const bills = new Map<string, { rows: BillTaxRow[]; base: number; nontax: number; day: string }>();
      for (const o of orders) {
        const key = o.session_id || ("solo:" + o.id);
        const b = bills.get(key) || { rows: [], base: 0, nontax: 0, day: istDay(o.created_at) };
        b.rows.push(o as BillTaxRow);
        b.base += o.taxable_base == null ? (Number(o.subtotal) || 0) : (Number(o.taxable_base) || 0);
        b.nontax += Number(o.nontax_amount) || 0;
        b.day = istDay(o.created_at);
        bills.set(key, b);
      }
      const byDay = new Map<string, { taxable: number; tax: number; mrp: number; gross: number; bills: number }>();
      let taxable = 0, tax = 0, gross = 0, mrp = 0;
      for (const b of bills.values()) {
        // Capped exactly the way every discount door caps it (discountBaseOf / mig 272) — inside
        // billTaxOf, at each order's OWN rate — and totalled with the one formula
        // subtotal − discount + tax, so a zero-rate month still adds up.
        const { disc: dsc, taxable: tx, tax: t } = billTaxOf(b.rows, rate);
        const tot = r2(r2(b.base + b.nontax) - dsc + t);
        taxable += tx; tax += t; gross += tot; mrp += b.nontax;
        const d = byDay.get(b.day) || { taxable: 0, tax: 0, mrp: 0, gross: 0, bills: 0 };
        d.taxable += tx; d.tax += t; d.mrp += b.nontax; d.gross += tot; d.bills += 1; byDay.set(b.day, d);
      }
      // CGST/SGST must add back to the SAME total tax shown (and thus to the grand total). The
      // total tax is summed with PER-BILL rounding; computing each component off the whole-month
      // taxable base rounds at a different point, so the split wouldn't reconcile on the filing
      // document (off by a few paise/rupees). Split the ACTUAL rounded total tax by component rate
      // instead, with the last component absorbing the remainder → the parts sum to tax exactly.
      const taxR2 = r2(tax);
      const compRateSum = comps.reduce((s, c) => s + c.rate, 0);
      let compAllocated = 0;
      const components = comps.map((c, i) => {
        const amount = compRateSum > 0 && i < comps.length - 1 ? r2(taxR2 * (c.rate / compRateSum)) : r2(taxR2 - compAllocated);
        compAllocated += amount;
        return { label: c.label, rate: c.rate, amount };
      });
      return ok({
        month: monthStr,
        restaurant: { name: set.restaurant_name || "Little French House", gstin: set.gstin || "" },
        ratePct: Math.round(rate * 10000) / 100,
        components,
        totals: { bills: bills.size, taxable: r2(taxable), tax: r2(tax), mrp: r2(mrp), gross: r2(gross) },
        days: [...byDay.entries()].sort().map(([date, v]) => ({ date, taxable: r2(v.taxable), tax: r2(v.tax), mrp: r2(v.mrp), gross: r2(v.gross), bills: v.bills })),
        note: "Paid dine-in bills only (this restaurant's own sales; excludes Zomato/Swiggy). Discount applied before tax."
          + (mrp > 0 ? " MRP / nil-rated turnover is listed separately — no GST is charged on it." : ""),
      });
    }

    if (p === "summary") {
      // TIER 1 of the two-tier Table view (mig 101, lfh_table_view_summary): a MINIMAL
      // per-tile summary for the GRID — each tile's computed state/label/meta/counts/due/
      // pay/badge-flags (NOT the heavy session/member/order_item rows), plus the small
      // restaurant-wide aggregates the side panel + chimes need (pending calls / requests /
      // joiners, blocklist, a diffable live-order count + the latest order's table). ~84 kB
      // at 300 tables vs ~315 kB for the full bundle. The selected table's FULL detail still
      // comes from /sessions?table=N (tier 2). ?table=N → just that ONE tile (targeted refetch,
      // ~5 kB) for pollTables; no param → the whole-floor grid. Aggregates always returned.
      // ?table= must be a NUMBER. A non-numeric value reached the RPC and Postgres threw
      // "invalid input syntax for type integer" — 15 of those landed in the error log in one
      // burst, and each one is a 500 that blanks the caller's refetch. A bad param should
      // simply mean "no targeted table" (a full, correct refresh), never an error.
      const tblRaw = new URL(req.url).searchParams.get("table");
      const tbl = tblRaw !== null && /^\d{1,6}$/.test(tblRaw.trim()) ? tblRaw.trim() : null;
      // Whole-floor reads for the SAME restaurant inside a 1.5s window share ONE database call
      // (lib/floorSummary.ts). Several devices polling the 300-table floor together used to
      // queue ~1,800 statements each and cross the statement timeout — that is what filled the
      // error log and pinged the owner. A targeted ?table= refetch is never shared, so a tile
      // still updates the instant its order lands.
      const { data, error } = tbl
        ? await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: tbl })
        : await sharedFloorSummary(`floor:${rid}`, async () => await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: null }));
      if (error) throw new Error(error.message);
      // ── PRINTER TROUBLE — ITS OWN SHARED KEY, NOT FOLDED INTO THE FLOOR READ ───────────────
      // Open printer problems + reprints nobody printed (queued/printing past 90s, or failed out
      // of retries), added by mig 269 for the manager's floor strip.
      //
      // IT USED TO BE ATTACHED INSIDE THE `floor:${rid}` CLOSURE, AND THAT WAS A REAL FAULT
      // (T13 sweep, 2026-08-05). `sharedFloorSummary` keys on the STRING alone, and the waiter
      // route shares the SAME `floor:${rid}` key with a closure that is a bare
      // lfh_table_view_summary call — no printer. So whichever panel read first decided for both,
      // and a waiter's routine poll handed the manager a floor with no `printer` key at all.
      // `printerAlerts()` starts `if (!pr) return []`, so the strip VANISHED — and worse,
      // `noticePrinterNews()` ends `seenPrinterKeys = keys`, so the empty pass reset the seen-set
      // and the next pass that DID carry the payload re-announced every still-open problem in red.
      // The one alarm that means "food orders are not reaching the kitchen" blinked in and out and
      // cried wolf each time it came back. Not a rare race either: an unscopable event wakes the
      // manager and every tablet at the same instant, so the winner was a coin flip.
      //
      // Its own key fixes it without giving up anything: the EXPENSIVE whole-floor read stays
      // shared between both panels (that is the whole point of lib/floorSummary), these two tiny
      // indexed reads are shared across manager devices under their own key, and the waiter route
      // never pays for them. Same 1.5s window, and the key ENDS IN THE RESTAURANT ID so
      // invalidateFloor() still drops it after a write — a report or a resolve shows on the next
      // read. Exactly the shape `merges:${rid}` below already uses.
      // A targeted ?table= refetch never pays for this (printer state isn't per-table).
      const printer = tbl ? null : await sharedFloorSummary(`printer:${rid}`, async () => {
        const staleIso = new Date(Date.now() - 90000).toISOString();
        const [ev, stuck] = await Promise.all([
          // `printer` (mig 351) so the floor can say WHICH printer to go and look at, instead of the
          // hard-coded word "kitchen" it used to print beside every complaint.
          sb.from("printer_events").select("id, kind, note, count, reported_by, last_at, printer")
            .eq("restaurant_id", rid).eq("status", "open").order("last_at", { ascending: false }).limit(5),
          // A STUCK BILL IS A STUCK JOB TOO (owner, 2026-09-03: "stuck bill will also give
          // notification"). This asked for `kind = 'kot'` only, so a bill that never came out of
          // the printer was invisible everywhere — no strip, no bell, no toast — while the
          // customer stood at the counter waiting for it. Same query, same index, same shared
          // 1.5s read; `kind` now rides along so the sentence can say WHICH kind is stuck.
          sb.from("print_jobs").select("id, order_id, kind, status, attempts, created_at, requested_by, error")
            .eq("restaurant_id", rid).in("kind", ["kot", "bill"])
            .or(`status.eq.failed,and(status.eq.queued,created_at.lt.${staleIso}),and(status.eq.printing,created_at.lt.${staleIso})`)
            .order("created_at").limit(5),
        ]);
        let jobs = (stuck.data || []) as Record<string, unknown>[];
        if (jobs.length) {
          const oids = [...new Set(jobs.map((j) => j.order_id).filter(Boolean))] as string[];
          const os = (await sb.from("orders").select("id, kot_no, table_number").in("id", oids).eq("restaurant_id", rid)).data || [];
          const byId = new Map(os.map((x) => [x.id, x]));
          jobs = jobs.map((j) => ({ ...j, kot_no: byId.get(j.order_id as string)?.kot_no ?? null, table_number: byId.get(j.order_id as string)?.table_number ?? null }));
        }
        // HOW MANY ARE STACKED UP (owner, 2026-08-27). The `stuck` list above is deliberately
        // narrow — five rows, 90 seconds old, so it can name each one — and it can never answer
        // "how far behind are we": a hundred tickets behind a dead printer show as five. This is the
        // whole number, counted (no rows), with the age of the oldest so the strip can tell a
        // two-second blip from an emergency. It rides the read the floor already shares.
        const waiting = await waitingToPrint(rid, "kot");
        return { events: ev.data || [], stuck: jobs, waiting, stuckAfterMs: STUCK_AFTER_MS };
      });
      // ── AN ORDER NOBODY HAS ACCEPTED FOR THREE MINUTES (owner, 2026-09-03) ────────────────────
      // "order not accepted for more than 3 to 4 min only get you notification — it should not
      // give notification just when order arrive; that will be in request queue."
      //
      // The bell used to raise a row the moment a tile carried an unaccepted order, because the
      // floor summary reports that as a STATE with no time on it (mig 238), so the panel had no
      // way to tell a ten-second-old order from a ten-minute-old one. This is the missing clock,
      // and it is the smallest read that can carry it: the ids and times of the orders that are
      // still waiting, restaurant-scoped, five at most, and only the four columns the sentence
      // needs. It rides the SAME shared 1.5s window as `printer` above, so ten manager devices
      // cost one read and a targeted ?table= refetch never pays for it at all. No new poll, no
      // new subscription, and `idx_orders_rest_active (restaurant_id, status) WHERE NOT archived`
      // (mig 104) is exactly the index for it.
      const slowOrders = tbl ? null : await sharedFloorSummary(`slow-orders:${rid}`, async () => {
        const slowIso = new Date(Date.now() - SLOW_ACCEPT_MS).toISOString();
        const r = await sb.from("orders").select("id, table_number, kot_no, created_at")
          .eq("restaurant_id", rid).eq("status", "received").eq("archived", false)
          .lt("created_at", slowIso)
          .order("created_at").limit(5);
        return { rows: r.data || [], afterMs: SLOW_ACCEPT_MS };
      });
      // WHICH TABLES ARE SERVED AS ONE PARTY (mig 249). A handful of rows, restaurant-scoped, live
      // ones only — small enough to ride along with every floor read, and the floor needs it on
      // BOTH tiles: the parent says "merged with T7", the child says "access from T6" instead of
      // pretending to be free. Kept OUT of lfh_table_view_summary on purpose: that function is the
      // hot shared read and every change to it has to be re-proven tile by tile.
      // SHARED like the floor read above (sweep 2026-08-04). This list is restaurant-wide and
      // identical in every answer, but it rode on EVERY call including the targeted ?table=N one —
      // and pollTables() widens each requested table to its whole party and fires one targeted call
      // per member (realtime allows up to 20 in a window), so one bulk change issued twenty
      // identical reads of the same handful of rows. The waiter route already shared it under this
      // exact key; the manager route was the one that didn't. Same 1.5s window, and
      // invalidateFloor() drops any key ending in the restaurant id, so a just-made merge is never
      // served stale after a write.
      const merges = await sharedFloorSummary(`merges:${rid}`, async () => (await sb.from("table_merges")
        .select("parent_table, child_table, merged_at, merged_by")
        .eq("restaurant_id", rid).is("ended_at", null).limit(200)).data || []);
      // Spread into a NEW object — `data` may BE the 1.5s shared snapshot and a handler must never
      // write into it (owner bug, 2026-08-02). `printer` lands in the same place the panel already
      // reads it from (`state.summary.printer`, editor/app.js printerAlerts), and stays absent on
      // the targeted ?table= path exactly as before.
      return ok({
        ...(data || { tiles: {}, order_count: 0, latest_order_table: null, calls: [], requests: [], joiners: [], blocklist: [] }),
        merges,
        ...(printer ? { printer } : {}),
        ...(slowOrders ? { slowOrders } : {}),
      });
    }

    // ── print-jobs/pending — THIS SCREEN IS A PRINTER TOO (owner, 2026-08-17) ───────────────────
    // "Add auto-print in the manager panel — when you turn that on, the ticket prints there instead
    // of the kitchen." The kitchen PC could not be trusted to keep its Chrome tab in front, and the
    // ticket was lost when it wasn't; since mig 335 every new order queues a ROW, so the honest fix
    // is to let a SECOND screen claim the same rows. Whichever screen is awake prints; the atomic
    // claim in lib/printQueue.ts means they can never both print the same ticket.
    //
    // Asked for ONLY by a device whose own "print tickets on this screen" switch is on (it is a
    // per-device choice, kept in that browser — the counter PC prints, the manager's phone must not),
    // and only while auto-print is switched on for the restaurant at all. `?mode=backup` is the
    // gentler setting: it asks for jobs at least 30 seconds old, so the KITCHEN printer always gets
    // first refusal and this screen is the safety net rather than the main path. The age test is
    // enforced again at the claim, server-side, so a stale tab cannot jump the queue.
    if (path[0] === "print-jobs" && path[1] === "pending") {
      // WHO IS PRINTING (mig 338) — sent whether or not this screen may print, because the answer
      // "printing is happening on the kitchen screen" is exactly what a manager needs to see.
      const dv = deviceIdFrom(req);
      // Every kind's owner, not just the kitchen slips: the panel needs to know before it prints a
      // BILL whether a computer will do it, and this is the read it already makes. One pair of
      // queries for all three (helpersFor), not three pairs — and the same one pair again for the
      // routes (targetsFor). Resolved FIRST so counterPrintTarget can be handed the kitchen-slip
      // answers instead of asking for them a second and third time (see its own note).
      const [owners, targets, station] = await Promise.all([
        helpersFor(rid, ["kot", "bill", "banquet"]),
        targetsFor(rid, ["kot", "bill", "banquet"]),
        stationView(rid, dv),
      ]);
      const t = await counterPrintTarget(rid, { helper: owners.kot, route: targets.kot });
      if (station.mine) { try { await touchStation(rid, dv as string); } catch { /* next read retries */ } }
      // `off` is a real answer, not an error: the panel stops asking and shows nothing. Either
      // auto-print is not on for this restaurant, or the admin has said only the KITCHEN prints.
      // …and how far behind the printer is (owner, 2026-08-27). It is sent whether or not this
      // screen may print, for the same reason the station is: "eleven tickets are stacked up" is
      // exactly what a manager needs to see about a printer that is not theirs.
      const waiting = await waitingToPrint(rid, "kot");
      const whoAmI = { panel: "manager" as const, personId: g.user?.id || null, deviceId: dv };
      const mayKot = screenMayPrint(targets.kot, whoAmI);
      // MAY THIS PERSON'S SCREEN PRINT AT ALL (accessTree ACTIONS → "print_here").
      //
      // BEING NAMED BY THE ADMIN *IS* THE PERMISSION (owner, 2026-08-29). He was being sent off to
      // Access & permissions in the middle of setting a printer up — "in the middle of thing, you
      // tell me to go to the access and permission… remove it completely" — and worse, naming
      // somebody whose general permission happened to be off produced a screen that was offered the
      // job and then refused it, with the paper going nowhere. So an explicit, deliberate choice of
      // ONE person on the Printing screen outranks the restaurant-wide default: the admin has
      // already answered the question that permission asks. The permission still governs everyone
      // the admin has NOT named.
      const namedMe = targets.kot.kind === "screen" && !!g.user?.id && targets.kot.person === g.user.id;
      const mayBePrinter = !g.user || namedMe ? true : await managerCan(g, rid, "print_here");
      if (!t.mayPrint || !mayKot.ok || !mayBePrinter) {
        return ok({ jobs: [], off: true, target: t.target, station, helper: t.helper, helpers: owners,
                    waiting, stuckAfterMs: STUCK_AFTER_MS,
                    targets, printRefused: !mayBePrinter ? "not_allowed" : mayKot.ok ? null : mayKot.why });
      }
      // 'both' = this screen is the BACKUP: it may only see (and win) a ticket the kitchen has left
      // for 30 seconds. The same window is re-applied at the claim, so it is the server's rule.
      // Only the ACTIVE station is handed tickets. Another manager screen (or a phone) gets the
      // station's name instead, so it can offer "print here instead" rather than quietly racing.
      if (!station.mine && station.active && !station.stale) return ok({ jobs: [], target: t.target, station, helpers: owners, waiting, stuckAfterMs: STUCK_AFTER_MS });
      return ok({ jobs: await pendingKotJobs(rid, { includeAuto: true, minAgeMs: 0 }), target: t.target, station, helpers: owners, waiting, stuckAfterMs: STUCK_AFTER_MS, targets });
    }



    // ── SETTINGS → PRINTING: the same board the admin sees, on the machine that has the printer ──
    //
    // Owner, 2026-08-27: "that device is connected to the printer, so it will be easy for THAT device
    // to set up the printer… admin can still see it… but that device will only get the option in
    // settings, like everyone has their settings where they log out from."
    //
    // TWO LEVELS OF ANSWER, and the difference is one permission:
    //   · anybody who can open Settings gets the READ — is printing on, where does the paper go,
    //     what has printed. It is the same page they had before, and it tells nobody anything about
    //     another restaurant.
    //   · a person with "May set the printers up" (accessTree → print_setup) additionally gets the
    //     BUTTONS: register this computer, get its code, choose which printer prints what.
    // The permission is asked here, on the server, and again on every write below — the screen
    // hiding a button has never been a gate.
    if (path[0] === "printing" && (path.length === 1 || path[1] === "state")) {
      const dv = deviceIdFrom(req);
      const maySetup = g.user ? await managerCan(g, rid, "print_setup") : true;
      const board = await printBoardState(rid, { deviceId: dv });
      return ok({
        ...board,
        // The same one generic file the admin console shows — same text, same source, so the two
        // screens cannot hand out different helpers (mig 368).
        files: helperFiles(originOfReq(req)),
        // MODE B's launcher, sent beside MODE A's. Both are plain text with nothing secret in them,
        // so the panel can show whichever the mode calls for with no second round trip.
        stationFiles: stationFiles(originOfReq(req)),
        maySetup,
        deviceId: dv,
        // Which install text to show FIRST. The browser knows what it is running on, so nobody has to
        // pick their own operating system off a list and get it wrong — the other two stay one tap away.
        os: osOfRequest(req),
        person: g.user ? { id: g.user.id, name: g.user.name || g.user.username || "" } : null,
      });
    }

    // print-jobs/:id — everything needed to print a stuck reprint HERE instead (mig 269).
    // One-off read on the manager's click, never polled. The order may have left the live
    // board long ago (a served KOT is exactly what gets reprint requests), so its rows are
    // fetched fresh rather than trusted to the panel's state.
    if (path[0] === "print-jobs" && path.length === 2) {
      const job = must(await sb.from("print_jobs").select("id, order_id, reprint, status").eq("id", path[1]).eq("restaurant_id", rid).maybeSingle());
      if (!job) return err("That print job is gone.", 404);
      const [o, items] = await Promise.all([
        sb.from("orders").select("id, kot_no, table_number, created_at, allergies, items").eq("id", job.order_id).eq("restaurant_id", rid).maybeSingle(),
        sb.from("order_items").select("id, order_id, title, qty, note, options, removed").eq("order_id", job.order_id).eq("restaurant_id", rid).order("created_at"),
      ]);
      if (!o.data) return err("That KOT's order is gone.", 404);
      return ok({ job, order: o.data, items: items.data || [] });
    }

    if (p === "sessions") {
      // ONE ROUND-TRIP (mig 100, lfh_floor_bundle): the whole floor — sessions + members +
      // items + pending requests + blocklist — is assembled SERVER-SIDE in a single DB call,
      // so the panel doesn't make ~4 sequential trips to the (Sydney, ~250ms RTT) DB. That was
      // the panel-jam-under-load cause (~950ms → ~300ms). Same JSON shape as before.
      // ?table=N → that table's slice (targeted refetch); no param → full board.
      const tbl = new URL(req.url).searchParams.get("table");
      const { data, error } = await sb.rpc("lfh_floor_bundle", { p_restaurant_id: rid, p_table: tbl || null });
      if (error) throw new Error(error.message);
      return ok(data || { sessions: [], members: [], items: [], requests: [], blocklist: [] });
    }

    if (p === "stats") {
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      // Range: today | yesterday. ONE business day either way, bucketed by hour.
      //
      // This panel's dashboard reaches exactly as far as Access → Manager → Manager menu →
      // Dashboard hands over, and no further. Every restaurant starts on TODAY; "today +
      // yesterday" is handed over deliberately, because someone who can see yesterday can
      // work out what a shift took. The 30-day and 12-month windows LEFT this panel on
      // 2026-08-03 (owner, looking at Aangan through owner → manager mode: "the thirty days
      // and one year is showing… there is literally no need for it") — they were never a
      // manager's screen, only a greyed extra for an admin/owner looking in, duplicating the
      // owner panel's Reports, which does wide ranges properly (snapshot-cached and
      // pre-aggregated instead of scanning orders live).
      //
      // The clamp is for EVERYONE now — manager, owner and admin alike — so no screen can ask
      // this endpoint for a window it doesn't offer. Clamping here and not only in the panel is
      // the point: ?range=year in the URL still returns today, it is never an error.
      const reach = dashboardReach((await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config);
      const range = clampDashRange(new URL(req.url).searchParams.get("range"), reach);
      const now = new Date();
      // 05:00-IST business day, so a 1 a.m. bill still belongs to the night it was taken.
      // "Yesterday" is yesterday ALONE (its own 05:00→05:00 day, ending where today starts) —
      // not today-and-yesterday lumped together, which would make every figure on the screen
      // mean two different days at once and read as double the takings.
      const dayStart = new Date(businessDayStartIso());
      const since = range === "yesterday" ? new Date(dayStart.getTime() - 864e5) : dayStart;
      const until = range === "yesterday" ? dayStart : now;

      // Crazy-dashboard upgrade (owner, 2026-07-05): fetch ONE window covering the
      // current period AND the one before it, split in code. This doubles the rows
      // of this on-demand (never polled) endpoint in exchange for honest deltas —
      // the previous period is cut at the SAME elapsed time ("today till 5pm vs
      // yesterday till 5pm", the Restroworks trick), so a half-day never gets
      // compared against a full day. Channel split needs one extra SCOPED query
      // on aggregator_orders (column list + limit, indexed by restaurant+time).
      // The day before this one. On "today" the cut is the same ELAPSED time (today till 5pm vs
      // yesterday till 5pm); on "yesterday" the day is already complete, so elapsed = the whole
      // 24h and the ghost line is the full day before it.
      const prevSince = new Date(since.getTime() - 864e5);
      const elapsedMs = until.getTime() - since.getTime();
      const [dishesQ, setQ, platRangeQ] = await Promise.all([
        // Bounded like every other read (egress rule). Unbounded, PostgREST capped it at ~1000
        // anyway, so a restaurant with a bigger menu silently lost dishes from the dish→category
        // map that feeds Top dishes and the menu matrix. (sweep 2026-08-04)
        sb.from("menu_items").select("id,title,category").eq("restaurant_id", rid).limit(5000),
        sb.from("settings").select(`${TAX_SETTINGS_COLUMNS}, platform_channels`).eq("restaurant_id", rid).maybeSingle(),
        // Upper bound too: on "yesterday" today's orders are somebody else's day, and leaving
        // them out is fewer rows read as well as the right answer (egress rule).
        sb.from("aggregator_orders").select("source,total,status,created_at").eq("restaurant_id", rid).gte("created_at", since.toISOString()).lt("created_at", until.toISOString()).limit(5000),
      ]);
      // Page through EVERY order in the window. A single .limit(50000) is silently capped by
      // PostgREST's db-max-rows (~1000), so on a busy restaurant the dashboard read only the newest
      // ~1000 orders and UNDER-counted revenue / orders / deltas (this made the Dashboard disagree
      // with the owner panel, whose SQL SUM has no row cap). The Z-report already pages around this;
      // /stats now does too. (B9 root cause — dashboard truncation.) On-demand endpoint, never polled;
      // pre-aggregated summary table is the extreme-scale follow-up per CLAUDE.md.
      const allRows: any[] = [];
      // Page NEWEST-first, capped at STATS_ROW_CAP rows. A single big .limit() is silently capped by
      // PostgREST's db-max-rows (~1000) — which truncated the dashboard to the newest ~1000 orders and
      // under-counted a busy restaurant (why it disagreed with the owner panel). Paging fixes that; the
      // cap stops a huge range from turning the dashboard into a slow, egress-heavy full-table scan.
      // Newest-first keeps the RECENT window complete + deterministic. So "Today" and "30 days" are
      // exact for a normal restaurant. A very-high-volume FULL YEAR can still exceed the cap → its
      // totals reflect only the most recent STATS_ROW_CAP orders, so we return truncated:true and the
      // dashboard shows an HONEST "most recent N orders" note instead of a silently-too-low number.
      // Penny-exact big-range totals are the planned pre-aggregated-summary follow-up (CLAUDE.md:
      // dashboards read summaries, not live scans) — that fix needs the owner to sign off on the numbers.
      // Cap = 12k (was 5k): a busy/demo restaurant's 30-day window spans ~60 days of rows (current +
      // previous period for the delta chips), which exceeded 5k and truncated the 30-day total; 12k keeps
      // the common Today/30-day demo views COMPLETE (no truncation note) while still bounding a full scan.
      const STATS_ROW_CAP = 12000;
      const STATS_PAGE = 1000;
      let statsTruncated = false;
      const statsPage = (from: number) => sb.from("orders").select("id,session_id,subtotal,total,discount,status,payment_status,payment_method,created_at,items,table_number").eq("restaurant_id", rid).gte("created_at", prevSince.toISOString()).lt("created_at", until.toISOString()).order("created_at", { ascending: false }).range(from, from + STATS_PAGE - 1);
      // Fetch those pages in DOUBLING PARALLEL WAVES — 1, then 2, then 4, then 8 at a time —
      // stopping the moment a wave comes back short. This used to be up to 12 STRICTLY
      // SEQUENTIAL round-trips: on the busiest restaurant a full-year Dashboard spent ~5.5s
      // just queueing, close enough to Postgres' statement timeout that a burst of panel
      // traffic tipped it over into "canceling statement due to statement timeout" (the error
      // the owner kept seeing, 2026-07-28). Same page size, same rows, same order, same
      // numbers — only the WAITING is now concurrent. Measured on the busiest demo restaurant:
      // full-year Dashboard 5.5s → 2.3s under load, 3.0s → 1.0s idle.
      //
      // Why doubling instead of firing all 12 at once: an OFFSET page still has to walk the
      // rows before it, so pages past the end of the data are not free. Doubling bounds the
      // wasted reads (at most one extra wave past the end) while cutting round-trips from 12
      // to at most 4. A restaurant with under a page of orders in the window still issues
      // exactly ONE query, exactly as before.
      let statsFrom = 0;
      let statsWave = 1;
      while (statsFrom < STATS_ROW_CAP) {
        const offsets: number[] = [];
        for (let i = 0; i < statsWave && statsFrom < STATS_ROW_CAP; i++, statsFrom += STATS_PAGE) offsets.push(statsFrom);
        const pages = (await Promise.all(offsets.map((from) => statsPage(from))))
          .map((r) => ((must(r) as any[] | null) || []));
        for (const page of pages) allRows.push(...page); // offset order = the old loop's order
        // A short page means the data ran out — nothing after it can be full, so stop here.
        if (pages.some((page) => page.length < STATS_PAGE)) break;
        // Every page full AND the cap is consumed → older orders exist beyond it, so the
        // dashboard shows its honest "most recent N orders" note. Same rule as the old loop.
        if (statsFrom >= STATS_ROW_CAP) statsTruncated = true;
        statsWave *= 2;
      }
      const oldestLoadedIso = allRows.length ? allRows[allRows.length - 1].created_at : null;
      const dishes = must(dishesQ);
      const sinceMs = since.getTime(), prevSinceMs = prevSince.getTime();
      const orders = allRows.filter((o: { created_at: string }) => new Date(o.created_at).getTime() >= sinceMs);
      const prevRows = allRows.filter((o: { created_at: string }) => {
        const t = new Date(o.created_at).getTime();
        return t < sinceMs && t - prevSinceMs <= elapsedMs; // same-elapsed-time cut
      });
      // Same effective rate + discount-before-tax rule as billMath/Z-report (lib/tax.ts),
      // so the dashboard revenue agrees with the Bills tab and the printed bills. Was
      // summing the STORED order total (taxed at a flat 5% on the pre-discount subtotal).
      const setRow = (must(setQ) || {}) as Record<string, any>;
      const rate = effectiveTaxRate(setRow);
      // Which platform surfaces are live (mig 209) — so the dashboard hides dead channels for a
      // restaurant that isn't on the delivery apps. moduleLadder formula, computed from the
      // columns already fetched above (no extra query).
      // TWO modules again since mig 259: Platforms (takeaway_*) is the delivery side, Parcel
      // (parcel_*) is the counter. A restaurant with no delivery apps still sells parcels, and
      // a dashboard that hid the parcel line for them was under-reporting real money.
      // Both halves are PERMANENT (owner, 2026-08-03) — the dashboard always counts them, and
      // a channel is shown when the restaurant actually switched that channel on. The comment
      // above still holds and is now unconditional: hiding a parcel line under-reports real money.
      const platOnDash = true, parcelOnDash = true;
      const dashChan = (setRow.platform_channels || {}) as Record<string, { on?: boolean }>;
      const channelsOn = { zomato: platOnDash && dashChan.zomato?.on === true, swiggy: platOnDash && dashChan.swiggy?.on === true, website: platOnDash && dashChan.website?.on === true, parcel: parcelOnDash };
      const catOf: Record<string, string> = Object.fromEntries(dishes.map((d: { id: string; category?: string }) => [d.id, d.category || "other"]));
      const hours = Array(24).fill(0);
      const topD: Record<string, number> = {}, cats: Record<string, number> = {}, seriesMap: Record<string, number> = {};
      const dishAgg: Record<string, { units: number; rev: number }> = {}; // per-dish PAID units + gross ₹ → menu star/dog matrix
      // Payment-method breakdown (owner, 2026-07-01): revenue + bill count per method
      // for whatever's ALREADY marked paid in this range — no extra query, same orders array.
      const paymentMethods: Record<string, { rev: number; bills: number }> = {};
      // ONE bucket size now: both ranges are a single business day, so the series is 24 hourly
      // points either way. (The day/month buckets went with the 30-day and 12-month views on
      // 2026-08-03 — see the range comment above.)
      // ALL hour-of-day stats bucket in IST explicitly — dt.getHours() was server-local,
      // which on Vercel (UTC) shifted the busy-hours chart by 5½ hours (latent bug).
      const IST_OFF = 5.5 * 3600e3;
      const istHour = (d: Date) => new Date(d.getTime() + IST_OFF).getUTCHours();
      const keyFor = (d: Date) => String(istHour(d));
      // Day parts (PetPooja pattern): 7–11 breakfast · 11–15 lunch · 15–19 evening ·
      // 19–23 dinner · 23–7 late.
      const DAY_PARTS = ["Breakfast 7–11", "Lunch 11–15", "Evening 15–19", "Dinner 19–23", "Late 23–7"] as const;
      const partOf = (h: number) => (h >= 7 && h < 11 ? 0 : h >= 11 && h < 15 ? 1 : h >= 15 && h < 19 ? 2 : h >= 19 && h < 23 ? 3 : 4);
      const dayParts = DAY_PARTS.map((label) => ({ label, revenue: 0, orders: 0 }));
      let paid = 0, unpaid = 0, cancelled = 0, revenue = 0, cancelledValue = 0, taxCollected = 0;
      let discTotal = 0, discCount = 0;
      let discMax: { amt: number; table: string } | null = null;
      let biggestBill: { amt: number; table: string } | null = null;
      // Counts + kitchen volume (hours/top-dishes/categories/day-part order counts) are
      // PER ORDER; every ₹ figure (revenue, series, payment methods, biggest bill, tax,
      // day-part revenue) is computed PER BILL below — a whole-bill discount is stored on
      // ONE order, so per-order clamping would drop the excess and overstate revenue.
      for (const o of orders) {
        const dt = new Date(o.created_at);
        const h = istHour(dt);
        if (o.status === "cancelled") {
          // What the cancelled order WOULD have billed (its own net, gross of tax) —
          // "lost business", shown on the dashboard as cancelledValue.
          cancelled++;
          cancelledValue += Math.max(0, (Number(o.subtotal) || 0) - (Number(o.discount) || 0)) * (1 + rate);
          continue;
        }
        if (o.payment_status === "paid") paid++; else unpaid++;
        const disc = Number(o.discount) || 0;
        if (disc > 0) {
          discTotal += disc * (1 + rate); discCount++;
          if (!discMax || disc * (1 + rate) > discMax.amt) discMax = { amt: disc * (1 + rate), table: String(o.table_number || "").trim() };
        }
        hours[h] += 1;
        dayParts[partOf(h)].orders++;
        const oPaid = o.payment_status === "paid";
        for (const it of (Array.isArray(o.items) ? o.items : [])) {
          const q = Number(it.qty) || 1;
          if (it.title) topD[it.title] = (topD[it.title] || 0) + q;
          const c = catOf[it.id] || "other";
          cats[c] = (cats[c] || 0) + q;
          // menu-matrix: gross ₹ per dish on PAID bills (menu price × qty; discounts are bill-level).
          if (oPaid) { const key = it.title || it.slug || "?"; const dd = dishAgg[key] || (dishAgg[key] = { units: 0, rev: 0 }); dd.units += q; dd.rev += q * (Number(it.price) || 0); }
        }
      }
      // Revenue / series / payment-methods / tax / day-part ₹ / biggest bill are PER BILL
      // (session), not per order. A whole-bill discount is stored on ONE order but is
      // capped at the whole-bill total, so clamping max(0, subtotal−discount) PER ORDER
      // dropped the excess and OVERSTATED revenue on multi-order tables. Group paid,
      // non-cancelled orders into bills and apply the discount to the bill,
      // discount-before-tax — matches billMath/Z-report.
      const billAgg = new Map<string, { sub: number; disc: number; tot: number; dt: Date; method: string; table: string }>();
      for (const o of orders) {
        if (o.status === "cancelled" || o.payment_status !== "paid") continue;
        const key = o.session_id || ("solo:" + o.id);
        const b = billAgg.get(key) || { sub: 0, disc: 0, tot: 0, dt: new Date(o.created_at), method: o.payment_method || "Not recorded", table: String(o.table_number || "").trim() };
        b.sub += Number(o.subtotal) || 0;
        b.disc += Number(o.discount) || 0;
        b.tot += Number(o.total) || 0; // stored gross total (frozen at payment) — the collected basis (B9)
        const d = new Date(o.created_at); if (d < b.dt) b.dt = d; // earliest order = the bill's time
        if (!b.table) b.table = String(o.table_number || "").trim();
        billAgg.set(key, b);
      }
      for (const b of billAgg.values()) {
        const net = Math.max(0, b.sub - b.disc);
        // Revenue = WHAT WAS COLLECTED, frozen at payment time: the stored bill total minus the
        // (grossed) discount — the SAME basis the owner panel uses (mig 140: total − discount×(1+rate)),
        // so the two screens always agree and a later tax-rate change never rewrites a past month.
        // (B9; was net*(1+currentRate), which retroactively re-taxed old bills at today's rate.)
        const amt = Math.max(0, (Number(b.tot) || 0) - b.disc * (1 + rate));
        revenue += amt;
        taxCollected += net * rate;
        const k = keyFor(b.dt); seriesMap[k] = (seriesMap[k] || 0) + amt;
        const pm = paymentMethods[b.method] || (paymentMethods[b.method] = { rev: 0, bills: 0 });
        pm.rev += amt; pm.bills++;
        dayParts[partOf(istHour(b.dt))].revenue += amt;
        if (!biggestBill || amt > biggestBill.amt) biggestBill = { amt, table: b.table };
      }
      // Previous period (already cut at the same elapsed time): totals for the delta
      // chips + a bucket-aligned series so the sales chart can draw it as the dashed
      // "last time" ghost line. Same PER-BILL rule as above so the delta compares
      // like with like.
      const prevSeries = Array(24).fill(0);
      let prevRevenue = 0, prevOrders = 0, prevCancelled = 0;
      const prevBills = new Map<string, { sub: number; disc: number; tot: number; dt: Date }>();
      for (const o of prevRows) {
        if (o.status === "cancelled") { prevCancelled++; continue; }
        prevOrders++;
        if (o.payment_status !== "paid") continue;
        const key = o.session_id || ("solo:" + o.id);
        const b = prevBills.get(key) || { sub: 0, disc: 0, tot: 0, dt: new Date(o.created_at) };
        b.sub += Number(o.subtotal) || 0;
        b.disc += Number(o.discount) || 0;
        b.tot += Number(o.total) || 0;
        const d = new Date(o.created_at); if (d < b.dt) b.dt = d;
        prevBills.set(key, b);
      }
      for (const b of prevBills.values()) {
        const amt = Math.max(0, (Number(b.tot) || 0) - b.disc * (1 + rate)); // collected basis (B9), matches billAgg + owner
        prevRevenue += amt;
        prevSeries[istHour(b.dt)] += amt;
      }
      // Channel split for the WHOLE range: dine-in from the same orders rows, the
      // three platform channels from the one scoped aggregator query above.
      const platRows = (must(platRangeQ) || []) as { source: string; total: number; status: string }[];
      const channels: Record<string, { rev: number; count: number }> = {
        dinein: { rev: 0, count: 0 }, zomato: { rev: 0, count: 0 }, swiggy: { rev: 0, count: 0 }, takeaway: { rev: 0, count: 0 }, parcel: { rev: 0, count: 0 },
      };
      for (const pr of platRows) {
        if (pr.status === "cancelled" || pr.status === "rejected") continue;
        const ch = channels[pr.source] || (channels[pr.source] = { rev: 0, count: 0 });
        ch.rev += Number(pr.total) || 0; ch.count++;
      }
      // Zero-filled, ordered revenue series with friendly labels: the 24 hours of the day.
      const series: { label: string; revenue: number }[] = [];
      const r2 = (n: number) => Math.round(n * 100) / 100;
      for (let h = 0; h < 24; h++) series.push({ label: `${h}:00`, revenue: r2(seriesMap[String(h)] || 0) });
      // Average per BILL (revenue is aggregated per bill): divide by the number of paid BILLS,
      // not paid ORDERS — dividing by orders understated the average on any multi-order table,
      // and the card is labelled "/bill". billAgg holds exactly one entry per paid bill.
      const avgOrder = billAgg.size > 0 ? r2(revenue / billAgg.size) : 0;
      // Live per-channel snapshot for the Today summary box: open dine-in tables,
      // active platform orders by source, and today's platform totals (platform
      // orders live in aggregator_orders, separate from dine-in `orders`).
      const todayStart = new Date(businessDayStartIso()).toISOString();
      // EVERY READ CARRIES A BOUND, AND A COUNT IS COUNTED (sweep 2026-08-04). These three had
      // no .limit(), which the egress rule requires — but the real damage was that PostgREST
      // silently caps an unbounded select at ~1000 rows, and both figures below are derived from
      // the LENGTH of the list. So on a big floor "open tables" and today's platform revenue
      // could read low with nothing on screen saying so, while the same endpoint honestly
      // reports `truncated` for its orders scan. Open tables is now a rows-free head COUNT, so
      // it cannot be capped at all (and costs no row egress); the platform reads get a bound.
      const [openSessQ, platActiveQ, platTodayQ] = await Promise.all([
        sb.from("sessions").select("id", { count: "exact", head: true }).eq("status", "open").eq("restaurant_id", rid),
        sb.from("aggregator_orders").select("source").eq("restaurant_id", rid).in("status", ["new", "accepted", "preparing", "ready"]).limit(5000),
        sb.from("aggregator_orders").select("total,status").eq("restaurant_id", rid).gte("created_at", todayStart).limit(5000),
      ]);
      // A head count answers in `count`, not in rows. must() still runs on it so a FAILED read
      // keeps raising instead of quietly reporting an empty floor (the old `must(openSessQ)`
      // did that, and losing it would turn a database blip into "0 tables open").
      must(openSessQ);
      const openTableCount = Number(openSessQ.count) || 0;
      const platActive = (must(platActiveQ) || []) as { source: string }[];
      // Platform revenue counts a delivery order only once it's ACCEPTED+ (never a
      // still-"new" ticket, never a cancelled one) — owner 2026-07-05, so today's
      // platform ₹ matches the Z-report's platform basis (both exclude cancelled).
      const platToday = ((must(platTodayQ) || []) as { total: number; status: string }[])
        .filter((r) => r.status !== "cancelled" && r.status !== "new");
      const live = {
        dineIn: openTableCount,
        zomato: platActive.filter((r) => r.source === "zomato").length,
        swiggy: platActive.filter((r) => r.source === "swiggy").length,
        takeaway: platActive.filter((r) => r.source === "takeaway").length,   // website channel
        parcel: platActive.filter((r) => r.source === "parcel").length,       // staff parcels
      };
      const platformToday = { count: platToday.length, revenue: r2(platToday.reduce((sum, r) => sum + (Number(r.total) || 0), 0)) };
      // Dine-in channel = the collected dine-in figures computed above.
      channels.dinein = { rev: r2(revenue), count: paid };
      // Menu star/dog matrix (menu engineering): classify each PAID dish by popularity (units) × gross
      // revenue, split at the medians → star / workhorse / puzzle / dog. Revenue (NOT profit — dish cost
      // isn't tracked yet; that's the future inventory module), labelled honestly in the UI.
      const mmArr = Object.entries(dishAgg).map(([title, d]) => ({ title, units: d.units, rev: r2(d.rev) }));
      const _med = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
      const medU = _med(mmArr.map((d) => d.units)), medR = _med(mmArr.map((d) => d.rev));
      const menuMatrix = mmArr.map((d) => ({ ...d, q: d.units >= medU ? (d.rev >= medR ? "star" : "workhorse") : (d.rev >= medR ? "puzzle" : "dog") })).sort((a, b) => b.rev - a.rev);
      return ok({
        menuMatrix,
        range, series, hours, cats, paid, unpaid, cancelled, revenue: r2(revenue),
        // Non-cancelled only, so it equals paid+unpaid (the card's own sub-line) AND compares
        // like-for-like against prev.orders (also non-cancelled). Counting cancelled here made
        // the big number disagree with its sub-line and skewed the up/down delta chip.
        orderCount: paid + unpaid, avgOrder,
        topDishes: Object.entries(topD).sort((a, b) => b[1] - a[1]).slice(0, 10),
        // [method, revenue, billCount] triples, biggest first (bill count shipped 2026-07-05
        // for the donut legend — same rows, no extra read; old clients ignore the 3rd slot).
        paymentMethods: Object.entries(paymentMethods).map(([method, v]) => [method, r2(v.rev), v.bills]).sort((a, b) => (b[1] as number) - (a[1] as number)),
        live, platformToday, channelsOn,
        // Crazy-dashboard fields (2026-07-05). prev is cut at the same elapsed time as
        // the current period, so deltas stay honest mid-day/mid-month.
        prev: { revenue: r2(prevRevenue), orders: prevOrders, cancelled: prevCancelled, series: prevSeries.map(r2) },
        dayParts: dayParts.map((d) => ({ ...d, revenue: r2(d.revenue) })),
        // Kept as an empty array, not dropped: an older cached panel still reads s.heatmap and
        // would throw on undefined. The weekday × hour card only ever meant something over a
        // 30-day/12-month window, and those left this panel (see the range comment above) —
        // the owner's own Reports still has the busiest-times heatmap.
        heatmap: [] as number[][],
        discounts: { total: r2(discTotal), count: discCount, max: discMax ? { amt: r2(discMax.amt), table: discMax.table } : null },
        taxCollected: r2(taxCollected),
        biggestBill: biggestBill ? { amt: r2(biggestBill.amt), table: biggestBill.table } : null,
        cancelledValue: r2(cancelledValue),
        channels: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, { rev: r2(v.rev), count: v.count }])),
        // Honesty flag: on a very busy restaurant a wide range can exceed STATS_ROW_CAP, so these
        // totals + the menu-winners split reflect only the most recent N orders. The dashboard shows
        // a plain note when truncated is true, instead of a silently-too-low number. (review #2)
        truncated: statsTruncated, statsCap: STATS_ROW_CAP, oldestLoaded: oldestLoadedIso,
        updatedAt: now.toISOString(),
      });
    }


    if (p === "users") {
      // The Customer-log VIEW of the Audit & logs tab can be switched off on its own
      // (the tab half is refused by tabGate; this is the sub-view switch).
      if (!(await logPartAllowed(g, rid, "customers"))) return permDenied("view the customer log");
      // The per-guest order/call tallies below are computed from these windows. The old 400/120
      // caps undercounted an active restaurant (a guest whose orders fell outside the latest 400
      // showed "0 orders"). Raised to a safer bound — this is an on-demand tab (not polled), and
      // the order/call rows are 3 tiny columns. (A perfectly-accurate count needs a GROUP BY
      // aggregate RPC; that's the follow-up if these windows ever prove too small.)
      const members = must(
        await sb.from("session_members")
          .select("id, name, phone, phone_verified, role, approved, removed, location_ok, joined_at, session:sessions(table_number, status)")
          .eq("restaurant_id", rid).order("joined_at", { ascending: false }).limit(500)
      );
      const customers = must(await sb.from("customers").select("*").eq("restaurant_id", rid).order("last_seen_at", { ascending: false }).limit(500));
      // The blocklist read had NO limit at all. Columns named to match what the panel renders
      // (b.id / b.phone / b.table_number / b.reason) plus member_id, which unblocking needs.
      // unban_phone / unban_requested_at are what a BLOCKED GUEST left on the "you've been
      // blocked" wall when they asked to be let back in (mig 077). They were written by the
      // guest RPC and selected by nobody, so the wall's promise — "leave your number and ask a
      // member of staff" — reached no staff screen at all. Two more columns, same one query.
      const blocklist = must(await sb.from("blocklist").select("id, phone, table_number, member_id, reason, blocked_at, device_id, unban_phone, unban_requested_at").eq("restaurant_id", rid).order("blocked_at", { ascending: false }).limit(500));
      const orders = must(await sb.from("orders").select("member_id, total, created_at").eq("restaurant_id", rid).not("member_id", "is", null).order("created_at", { ascending: false }).limit(3000));
      const calls = must(await sb.from("waiter_calls").select("member_id, note, created_at").eq("restaurant_id", rid).not("member_id", "is", null).order("created_at", { ascending: false }).limit(3000));
      return ok({ members, customers, blocklist, orders, calls });
    }

    if (p === "oplog") {
      if (!(await canViewLogs(g, rid))) return permDenied("view the activity log");
      // The Activity-log VIEW of the Audit & logs tab can be switched off on its own.
      if (!(await logPartAllowed(g, rid, "activity"))) return permDenied("view the activity log");
      // The operation log: recent staff actions across all panels. HIERARCHY RULE
      // (owner, 2026-07-03 — "in the manager's logs there shouldn't be owner or admin
      // actions"): a lower role must never observe a higher role's activity. So the
      // ADMIN's actions (panel='admin') AND the OWNER's actions (panel='owner' —
      // staff changes, permission grants…) are both hidden here; they show only in
      // their own panels' logs.
      const rows = (must(await sb.from("staff_actions").select("*").eq("restaurant_id", rid).not("panel", "in", "(admin,owner,db)").order("created_at", { ascending: false }).limit(200)) || []) as { actor_id?: string | null }[];
      // Actions the ADMIN performed from a panel view carry actor_id='admin:view' (owner,
      // 2026-07-28). Only the admin's own view may see that marker — for staff/owner
      // viewers the row must stay a plain, neutral panel row (the admin stays invisible).
      if (g.user) for (const row of rows) if (row.actor_id === ADMIN_VIEW_ACTOR_ID) row.actor_id = null;
      // ── AN ERROR ROW ARRIVES WITH ITS PLAIN SENTENCE ATTACHED (owner, 2026-09-02) ─────────────
      // "make sure every possible log and stuff in human language so I can understand easily."
      // The admin and owner screens are React and import lib/plainError directly, so they pay
      // nothing for this. The manager panel is plain JS in public/ and cannot import a TS module,
      // and the alternative — a second copy of the translator written in JS — is exactly the drift
      // this family of files exists to prevent (see lib/errorSignature.ts's header, and the 2026-08-03
      // lesson where the panel's own label map covered 19 of ~130 action codes).
      //
      // So the SERVER says it once and the panel prints it. Attached to error rows ONLY: an
      // ordinary row's detail is already English, and a sentence per row on 200 rows would be
      // paid-for payload with nothing in it. Nothing is removed — `detail` still carries the
      // exact text, which is what the panel's own detail view shows.
      for (const row of rows as { level?: string | null; detail?: string | null; plain?: string }[]) {
        if (row.level === "error" && row.detail) row.plain = plainHeadline(row.detail);
      }
      return ok(rows);
    }

    if (p === "staff-risk") {
      // Staff-watch aggregation: count the risk actions (discounts / voids / deletes / paid-reverts)
      // per staff member over a DATE RANGE, aggregated SERVER-SIDE so the browser gets a tiny summary
      // instead of thousands of log rows (egress-safe). Scoped to this restaurant; hides admin + owner
      // rows exactly like /oplog. Replaces the old client that aggregated only the newest 200 rows with
      // NO date window (which silently undercounted, and could miss a staff member, on a busy day). (review #4)
      //
      // THIS CARD LIVES ON THE DASHBOARD, SO IT NEEDS THE DASHBOARD'S PERMISSION (sweep 2026-08-04).
      // It had none at all: /stats (the screen around it) checks view_dashboard and /oplog (the log
      // it summarises) checks canViewLogs, but this endpoint checked neither, and tabGate doesn't
      // match "staff-risk" either. So a restaurant that switched the dashboard off for managers
      // still handed any logged-in manager a per-person tally of who gave discounts, who voided
      // bills and who deleted them — a switch on the Access screen that saved and was never read
      // on this path, which is the dead-switch shape the access rebuild exists to remove.
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      // Same two ranges as the dashboard it sits on, clamped by the same helper — this card
      // must not reach further back than the screen around it (a manager asking ?range=year
      // used to get a year of staff-watch rows). today | yesterday, one business day each.
      const riskReach = dashboardReach((await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config);
      const range = clampDashRange(new URL(req.url).searchParams.get("range"), riskReach);
      const riskDayStart = new Date(businessDayStartIso()).getTime();
      const sinceMs = range === "yesterday" ? riskDayStart - 864e5 : riskDayStart;
      const untilMs = range === "yesterday" ? riskDayStart : Date.now();
      const sinceIso = new Date(sinceMs).toISOString();
      const untilIso = new Date(untilMs).toISOString();
      const RISK: Record<string, "disc" | "void" | "del" | "rev"> = { order_discount: "disc", invoice_void: "void", void_invoice: "void", order_delete: "del", orders_delete: "del", payment_revert: "rev" };
      const by: Record<string, { disc: number; void: number; del: number; rev: number; total: number }> = {};
      let truncated = false;
      for (let from = 0; from < 20000; from += 1000) {
        const page = (must(await sb.from("staff_actions").select("action,actor,created_at").eq("restaurant_id", rid).not("panel", "in", "(admin,owner,db)").gte("created_at", sinceIso).lt("created_at", untilIso).order("created_at", { ascending: false }).range(from, from + 999)) as { action: string; actor: string | null }[] | null) || [];
        for (const r of page) { const k = RISK[r.action]; if (!k) continue; const who = r.actor || "— (device only)"; const a = by[who] || (by[who] = { disc: 0, void: 0, del: 0, rev: 0, total: 0 }); a[k]++; a.total++; }
        if (page.length < 1000) break;
        if (from + 1000 >= 20000) truncated = true;
      }
      const rows = Object.entries(by).map(([who, v]) => ({ who, ...v })).sort((a, b) => b.total - a.total);
      return ok({ range, rows, truncated });
    }

    // audit (GET) — the newest removals for this restaurant, for the Audit & logs screen. Scoped,
    // columned and capped, like every other panel read. The tab half (menus.manager.log) is
    // refused by tabGate; these two are the person half + the Removals sub-view switch.
    if (p === "audit") {
      if (!(await canViewLogs(g, rid))) return permDenied("view the removals record");
      if (!(await logPartAllowed(g, rid, "removals"))) return permDenied("view the removals record");
      // ?detail=<id> — ONE removal, in full (owner, 2026-08-04): which KOT, every item on it with
      // its quantity and price, the totals, the customer, the time and day, and who did it. `meta`
      // carries the snapshot (lib/removalAudit.ts) and is fetched lazily, so the LIST payload is
      // unchanged — 100 snapshots for rows nobody opened would be the whole-board read the egress
      // rules exist to prevent. Scoped by restaurant like the list. READ-ONLY: nothing here can put
      // a bill back — that is the admin's alone.
      const detailId = String(req.nextUrl.searchParams.get("detail") || "");
      if (detailId) {
        if (!/^\d+$/.test(detailId)) return err("bad id", 400);
        const one = must(await sb.from("deletion_audit")
          .select("id,at,kind,reason_code,reason_note,actor,actor_role,table_number,bill_no,invoice_no,kot_no,item_title,qty,amount,session_id,order_id,item_id,device_id,meta")
          .eq("id", Number(detailId)).eq("restaurant_id", rid).limit(1)) as Record<string, unknown>[] | null;
        if (!one || !one.length) return err("That record isn't for this restaurant.", 404);
        // `g.user` is null ONLY for the admin super-user. A real manager never learns that Aevidine
        // removed something in their restaurant; the row, its reason and its amount are untouched.
        // …with the two boxes and the bill, so the manager's card is the SAME card the owner and the
        // admin read (one record, one story — the rule this whole area exists under).
        const dMeta = ((one[0] as Record<string, unknown>).meta || {}) as Record<string, unknown>;
        const dRow = one[0] as Record<string, unknown>;
        const dOrderId = dRow.order_id ? String(dRow.order_id) : null;
        const [dAfter, dBill, dBillSides] = await Promise.all([
          auditAfter(rid, dOrderId),
          auditBillHtml(rid, (dMeta.was || null) as Record<string, unknown> | null),
          // WHAT THIS DID TO THE TABLE'S BILL (owner, 2026-08-26) — the whole-bill before/after,
          // as opposed to the KOT compared with itself. See auditBillSides() for how both numbers
          // are got without inventing any history.
          auditBillSides(rid, dRow.session_id ? String(dRow.session_id) : null,
            (dMeta.was || null) as Record<string, unknown> | null, dOrderId),
        ]);
        return ok({
          ...forReader(one[0] as { actor?: string | null; actor_role?: string | null }, !g.user),
          __after: dAfter, __billHtml: dBill, __billSides: dBillSides,
        });
      }
      const lim = Math.min(Math.max(parseInt(String(req.nextUrl.searchParams.get("limit") || "100"), 10) || 100, 1), 300);
      const rows = must(await sb.from("deletion_audit")
        // `order_id` and the ONE scalar out of meta (owner, 2026-08-18) — never `meta` itself. The
        // comment above explains why meta is lazy: it carries a whole order snapshot, and 100 of them
        // for rows nobody opened is the board-wide read the egress rules exist to prevent. A JSON
        // path selection costs a text field per row and is what lets the list show the loss tag and
        // offer the answer without opening anything.
        .select("id,at,kind,reason_code,reason_note,actor,actor_role,table_number,bill_no,invoice_no,kot_no,item_title,qty,amount,order_id,made:meta->>made")
        // A REMOVALS list shows REMOVALS. 'removal_classified' is the answer to "was the food made?",
        // not a thing taken out of the system — leaving it in put "Cancellation answered" rows in a
        // list headed "everything taken out", and counted them in its record count and money total.
        // The current answer already rides on the cancellation row itself as a tag; the trail of who
        // answered and what they changed stays in the table for the admin's support view.
        .neq("kind", "removal_classified")
        .eq("restaurant_id", rid).order("at", { ascending: false }).limit(lim));
      return ok(auditForReader((rows || []) as { actor?: string | null; actor_role?: string | null }[], !g.user));
    }

    return err("unknown GET endpoint", 404);
  } catch (e) {
    // Record the unexpected failure as an error-level diary line (mig 159) so it shows red in
    // the admin log and can drive the alert / nightly-fix tooling. Fire-and-forget.
    if (worthLogging(e)) logError("manager", "route_error", e, { restaurant_id: rid, detail: `GET ${p || "/"}` });
    return panelFailure(e);
  }
}

// ── DROPPING THE FLOOR SNAPSHOT, ONCE BEFORE AND ONCE AFTER ──────────────────
// Each write handler below calls invalidateFloor(rid) as soon as it knows the restaurant.
// That is worth keeping, but on its own it CANNOT deliver what it claims ("a device can
// never be handed a floor computed before its own action"), because the snapshot is dropped
// BEFORE the change lands. On a floor with several devices the gap is easy to hit:
//
//   t=0     a waiter taps Mark paid → the snapshot is dropped
//   t=60ms  another device's whole-floor poll lands → computes and SHARES a floor with no payment
//   t=250ms the UPDATE commits
//   t=300ms the acting device reloads → still inside that poll's 1.5s window → old floor
//
// …which is the tile-flicks-back-for-a-second behaviour the sharing was carefully written to
// avoid (see lib/floorSummary.ts). sessions/:id/merge and tables/:t/unmerge already worked
// round it by calling invalidateFloor a second time themselves; this wrapper does it for
// EVERY write instead, so a new endpoint gets it without anyone remembering to.
//
// The rid is carried on a WeakMap keyed by the request object (withIdempotency passes the
// same object straight through), so nothing is shared between concurrent requests. `finally`
// means a handler that throws still drops the snapshot — a half-applied write must not leave
// a stale floor behind either. Over-invalidating is free: the next read just computes.
const writeRid = new WeakMap<NextRequest, string>();
function invalidateFloorAfter(fn: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await fn(req, ctx);
    } finally {
      const rid = writeRid.get(req);
      if (rid) invalidateFloor(rid);
    }
  };
}

// ── POST ─────────────────────────────────────────────────────────────────────
// Wrapped so a replayed offline action runs at most once (see lib/idempotency.ts).
export const POST = withIdempotency(invalidateFloorAfter(postImpl), "editor");
async function postImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  // Attribute every logged action to the signed-in staff member (name = their login;
  // admin super-user has no per-user cookie). Before this, `actor` was never filled, so
  // the Operation-log "By" column and the Staff-watch tool saw only an anonymous row.
  const actorName = g.user?.name || g.user?.username || null;
  // Admin panel-view actions (no staff cookie) get the actor_id='admin:view' marker so the
  // ADMIN's log surfaces can attribute them; staff/owner log reads mask it (owner 2026-07-28).
  // actor_id (the STABLE staff uuid) rides along too, not just the display name: a rename
  // used to orphan every past row, and "what did this person do" / the performance report
  // can only join on an id. (2026-07-29)
  const log = (...a: Parameters<typeof logAction>) => logAction(a[0], a[1], { actor: actorName, ...(g.user ? { actor_id: g.user.id } : { actor_id: ADMIN_VIEW_ACTOR_ID }), ...(a[2] || {}) });
  const rid = await editorScope(req, g);
  if (rid instanceof NextResponse) return rid;
  // A write to this restaurant drops its shared floor snapshot, so the very next read
  // recomputes. Dropping it HERE is not enough on its own (a poll landing between this line
  // and the write re-shares the old floor) — invalidateFloorAfter() drops it again once the
  // handler has finished, which is what makes "read your own write" actually true.
  invalidateFloor(rid);
  writeRid.set(req, rid);
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  // Manager's-menu rung: refuse a tab this restaurant switched off (see tabGate).
  { const tg = await tabGate(g, rid, path, req.method); if (tg) return tg; }
  // ── A DISH PHOTO, UPLOADED (T19 sweep, 2026-08-14) ─────────────────────────────────────
  // Handled HERE, before the `try` below, because the very first thing in there is
  // `readBody(req)` — which calls req.json() and consumes the request stream, leaving
  // req.formData() with nothing to parse. Not a new module and it needs no switch of its own:
  // it is the same "Edit menu → Edit a dish" permission that already governs the Image field
  // this fills in, checked inside dishPhotoUpload().
  if (path[0] === "dish-photo") return await dishPhotoUpload(req, g, rid);
  try {
    const [a, b, c] = path;
    // A missing client id arrives as literal "undefined"/"null"/"NaN" — reject before it
    // reaches a uuid query and throws the "invalid input syntax for type uuid" route_error.
    if (emptyIdSegment(b) || emptyIdSegment(c)) return err("Missing id — please refresh and try again.");
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which device (this editor screen) is acting

    // ── OFFLINE REPLAY CLASH (offline sync 2026-07-30) ────────────────────────────
    // A change saved on a device with no signal, arriving only now, must not be applied
    // if the ground moved underneath it (the table was closed and billed, or a different
    // party is sitting there now). We refuse with a plain reason and the panel asks a
    // person to redo it — never a silent overwrite, never a silent drop. See lib/clash.ts.
    // A LIVE write carries no replay marker, so this returns without a single query.
    const clash = await replayClash(req, rid, a, b, c, body as Record<string, unknown> | null);
    if (clash) return clashJson(clash);

    // ── print/send — "put this piece of paper in the basket for the computer that owns it" ────────
    // The panel calls this INSTEAD of opening its print window, when a helper owns that kind of
    // paper (mig 341). It is deliberately not a general "print anything" verb: the kind must be one
    // a route names, the row must belong to this restaurant, and the document is built server-side
    // from ids at the moment of printing — so this cannot be used to print an arbitrary document, or
    // an out-of-date one.
    //
    // `noRoute` is a normal answer, not a failure: it means no computer owns this paper, and the
    // panel then does exactly what it has always done — open the window. That is the fallback which
    // keeps every restaurant working, including the ones that install nothing.
    if (a === "print" && b === "send") {
      const kind = String((body as Record<string, unknown>)?.kind || "");
      if (kind !== "bill" && kind !== "banquet") return err("Only a bill or a banquet sheet can be sent this way.", 400);
      const own = await helperFor(rid, kind);
      if (!own.owned) return ok({ noRoute: true });
      // ── THE ADMIN LOOKING IS NOT THE RESTAURANT PRINTING (owner, 2026-08-20) ──────────────────
      // `g.user` is null when this is the admin console viewing a restaurant's panel. Their printers
      // are theirs: nothing comes out of a paying client's roll because we opened their screen. The
      // panel is told, and shows the document on OUR screen instead — the same window every
      // restaurant without a helper uses. `force` is the deliberate way to help them ("their printer
      // was stuck, send it again"), and it is audited so a mystery ticket at their counter can always
      // be traced back to us.
      if (!g.user && (body as Record<string, unknown>)?.force !== true) {
        return ok({ adminView: true, printer: own.printer, agent: own.agent });
      }
      const payload: Record<string, unknown> = {};
      // What the diary line will call this piece of paper, filled in by whichever branch below
      // resolves it — so the log says "bill #218 for table 6", not just "bill".
      let printedWhat = kind === "bill" ? "bill" : "banquet sheet";
      let printedTable: string | null = null;
      if (kind === "bill") {
        const sid = String((body as Record<string, unknown>)?.sessionId || "");
        if (!sid) return err("Which bill?", 400);
        // The session must be this restaurant's — the route handler never trusts the panel's word
        // for whose row it is (every other write here does the same).
        // `table_number` and `bill_no` ride along so the diary line can NAME the bill — see the
        // note on logAction below. Same read, two more small columns.
        const sess = (await sb.from("sessions").select("id, table_number, bill_no").eq("id", sid).eq("restaurant_id", rid).maybeSingle()).data as
          { id: string; table_number: unknown; bill_no: unknown } | null;
        if (!sess) return err("That table's bill is not this restaurant's.", 404);
        payload.sessionId = sid;
        if ((body as Record<string, unknown>)?.parcel) payload.parcel = true;
        printedTable = sess.table_number != null ? String(sess.table_number) : null;
        printedWhat = `bill${sess.bill_no != null ? ` #${sess.bill_no}` : ""}`
          + `${sess.table_number != null ? ` for table ${sess.table_number}` : ""}`;
      } else {
        const bid = String((body as Record<string, unknown>)?.billId || "");
        if (!bid) return err("Which banquet bill?", 400);
        const bill = (await sb.from("banquet_bills").select("id, bill_no").eq("id", bid).eq("restaurant_id", rid).maybeSingle()).data as
          { id: string; bill_no: unknown } | null;
        if (!bill) return err("That banquet bill is not this restaurant's.", 404);
        payload.billId = bid;
        printedWhat = `banquet sheet${bill.bill_no != null ? ` #${bill.bill_no}` : ""}`;
      }
      const q = await queueJob(rid, kind, payload, { requestedBy: g.user?.name || g.user?.username || "manager" });
      if ("error" in q) return q.error === "no-route" ? ok({ noRoute: true }) : err("Could not send that to the printer.", 500);
      // ── THE DIARY LINE NAMES *WHICH* BILL (owner, 2026-08-28: "make log do that") ─────────────
      // Asked for "say who printed a bill, on the bill itself", he answered: let the LOG answer it.
      // It could not. The row read `bill sent to Printer_POS_80 on Shop's computer` — which says
      // WHERE the paper came out and never WHICH bill came out of it, so on a night with forty
      // prints no two rows could be told apart. Both facts were already in reach: `table_number`
      // is a column logAction has always accepted and nothing here passed, and the bill number is
      // one extra column on a read this branch already makes.
      // ── …AND *WHO* SENT IT (T24 sweep #8, 2026-09-06) ────────────────────────────────────────
      // This was the ONE write in this file filed with nobody's name on it. It called logAction()
      // directly and passed `actor` only on the admin branch, so a manager pressing Print produced
      // a diary row whose By column was empty — on the very row the note above says he asked for
      // ("say who printed a bill, on the bill itself" → "make log do that"). Every other write here
      // goes through log(), which fills in the person's name AND their stable id; this one now does
      // too, and the admin branch still overrides both, exactly as before.
      await log("editor", g.user ? "print_sent" : "print_sent_by_admin", {
        restaurant_id: rid, device_id: dev,
        // Filterable as well as readable: the Audit & logs tab groups by table, so a bill print
        // now sits with the rest of that table's story instead of floating loose. A banquet sheet
        // has no table, and stays null rather than being given a pretend one.
        table_number: printedTable,
        ...(g.user ? {} : { actor: "Aevidine admin", actor_id: ADMIN_VIEW_ACTOR_ID }),
        detail: `${printedWhat} sent to ${own.printer} on ${own.agent}`
          + (g.user ? "" : " — sent deliberately from the admin console"),
      });
      // What the person is told, in the words they need: where it went, and — honestly — that it is
      // waiting if that computer is asleep.
      return ok({
        queued: true, id: q.id, printer: own.printer, agent: own.agent, connected: !!own.connected,
        note: own.connected ? `Sent to ${own.printer}` : `Saved — it prints at ${own.printer} as soon as ${own.agent} is back`,
      });
    }


    // Same floor-plan sanity check as the waiter panel (see lib/planTable.ts).
    if ((a === "order" || (a === "sessions" && b === "open")) && body && (body as Record<string, unknown>).table != null) {
      const offPlan = await offPlanTable(rid, (body as Record<string, unknown>).table);
      if (offPlan) return err(offPlan, 400);
    }

    // ── NO SILENT OVERWRITES (owner, 2026-07-30) ──────────────────────────────────
    // If the screen told us what it was editing FROM, refuse when someone else has since
    // changed it — and tell that person what it says now. One gate for every action here:
    // a feature opts in from its CALL SITE (see the NEW-FEATURE CHECKLIST in CLAUDE.md), so
    // this cannot be forgotten on the server side when a new endpoint is added.
    const overwrite = await expectClash(req, rid);
    if (overwrite) return clashJson(overwrite);

    // customer-capture — save the guest's name+number at bill time, with consent
    // (Customer CRM, mig 212). DPDP: the RPC stores NOTHING without consent. Records
    // one visit for the table's session (idempotent), links devices, bumps the
    // returning count. Gated by the "customers" entitlement (default on). Called once
    // after the bill closes; a failure never blocks the settle that already happened.
    // ── table-sections — set ONE waiter's tables (waiter sections, mig 222) ────
    // Body: { user_id, tables: number[] }. The whole set is replaced, so the client can
    // send the result of a tick/untick without any merge logic. Same ladder as the GET.
    //
    // Numbers are sanitised and clamped to 1…table_count here, not trusted from the
    // client: a stale panel could otherwise write table 40 into a 12-table restaurant and
    // the waiter would hold a table that doesn't exist. Duplicates collapse, order is
    // stable, and an empty list is a legitimate "this waiter serves nothing yet".
    if (a === "table-sections") {
      if (!(await managerCan(g, rid, "table_assign"))) return permDenied("give waiters their own tables");
      const uid = String(body?.user_id || "").trim();
      if (!uid) return err("Which person? — user_id is required.");
      const cnt = Number((await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle()).data?.table_count) || 12;
      const seen = new Set<number>();
      const tables: number[] = [];
      for (const v of Array.isArray(body?.tables) ? body.tables : []) {
        const n = parseInt(String(v), 10);
        if (Number.isFinite(n) && n >= 1 && n <= cnt && !seen.has(n)) { seen.add(n); tables.push(n); }
      }
      tables.sort((x, y) => x - y);
      // Scoped to THIS restaurant and to a waiter: a manager can't reach another
      // restaurant's staff row, nor give a manager/kitchen login a section.
      const upd = await sb.from("staff_users").update({ assigned_tables: tables })
        .eq("id", uid).eq("restaurant_id", rid).eq("role", "tablet")
        .select("id, username, name, assigned_tables");
      // Same rule as everywhere else: the database's own words go to the server log, never to the
      // person standing at the section editor. (T24 sweep #8, 2026-09-06)
      if (upd.error) {
        console.error("[editor/table-sections] save failed:", upd.error.message);
        return err("Couldn't save that waiter's tables — please try again.", 500);
      }
      const row = (upd.data || [])[0];
      if (!row) return err("That waiter is no longer on this restaurant's team.", 404);
      await log("editor", "table_sections_set", {
        restaurant_id: rid, device_id: dev,
        detail: `${row.name || row.username}: ${tables.length ? tables.map((t) => `T${t}`).join(" ") : "no tables"}`,
      });
      return ok({ ok: true, user: row });
    }

    if (a === "customer-capture") {
      const tRaw = String(body?.table || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // The bill's session sits on the PARENT of a merged table — without this the ownership
      // check below ("does that session really sit at this table?") refused the party's own
      // session whenever the popup was opened from a child table, and the visit was lost.
      const t = await mergeParentTable(sb, rid, tRaw);
      const ent = await getOwnerEntitlements(rid);
      if (!ent.customers) return err("The customer directory isn't enabled for this restaurant.", 403);
      // WHOSE BILL: the panel sends the session it just settled. Verified against this
      // restaurant + table before it is used, and the RPC falls back to the table's OPEN
      // session when a caller sends nothing. Resolving by table alone used to book the visit
      // (and the device links) onto whichever party was seated at that table NEXT — mig 233.
      let capSession: string | null = null;
      const capSessionRaw = String(body?.session || "").trim();
      if (/^[0-9a-f-]{36}$/i.test(capSessionRaw)) {
        const owns = (await sb.from("sessions").select("id").eq("id", capSessionRaw)
          .eq("restaurant_id", rid).eq("table_number", t).maybeSingle()).data as { id: string } | null;
        capSession = owns?.id ?? null;
      }
      const { data, error } = await sb.rpc("lfh_capture_customer", {
        p_restaurant_id: rid, p_table: t,
        p_phone: String(body?.phone || "").slice(0, 20),
        p_name: String(body?.name || "").slice(0, 80),
        p_consent: body?.consent === true,
        p_session: capSession,
      });
      if (error) return err(error.message, 500);
      if ((data as { ok?: boolean })?.ok) await log("editor", "customer_saved", { restaurant_id: rid, table_number: t, device_id: dev });
      return ok(data || { ok: false });
    }

    // ── Raise an issue / complaint ────────────────────────────────────────────
    // A manager (or any staff) flags an operational problem for THIS restaurant; the
    // owner sees it on their issues page and the admin sees it as a platform complaint.
    if (a === "issue") {
      const ib = body as { subject?: string; body?: string; image_url?: string; audio_url?: string };
      try {
        await raiseIssue({
          rid,
          subject: String(ib?.subject || ""),
          body: ib?.body,
          raisedBy: g.user?.name || g.user?.username || "Manager",
          raisedRole: g.user?.role || "manager",
          imageUrl: ib?.image_url,
          audioUrl: ib?.audio_url,
        });
      } catch (e) { return err(e instanceof Error ? e.message : "Couldn't raise the issue.", 400); }
      return ok({ ok: true });
    }

    // ── order — take a BRAND-NEW dine-in order from the manager panel ───────────
    // Same behaviour as the waiter tablet's POST /order (server-priced via
    // lfh_staff_place_order — never trusts client prices), so the manager can run a
    // table the same way a waiter does. Gated by the take_orders manager power (admin
    // entitles it AND the owner grants it; managerCan, 2026-07-22). Wrapped by
    // withIdempotency like every editor write, so a replayed offline action places once.
    if (a === "order" && path.length === 1) {
      // Module rung (mig 179): ordering must be enabled for this restaurant at all,
      // then the manager needs the take_orders power (admin exists + owner grant).
      if (!(await takeOrdersLadder(rid)).effective) return err("Order-taking isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "take_orders"))) return permDenied("take new orders");
      const { table, items, allergies, note } = body || {};
      const t = String(table || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      // Reject a table that doesn't exist (1..table_count) — a typo would otherwise float
      // a phantom order on a non-existent table (mirrors the tablet guard).
      const tcRow = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const tableCount = Number((tcRow.data as { table_count?: number } | null)?.table_count) || 0;
      const tn = Number(t);
      if (tableCount > 0 && (tn < 1 || tn > tableCount)) return err(`Table ${t} doesn't exist (this place has ${tableCount} tables).`, 400);
      if (!Array.isArray(items) || !items.length) return err("items required");
      // Overridable double-tap guard: refuse an IDENTICAL order for the same table within
      // 3s unless confirmDuplicate:true (two guests ordering the same drink is legitimate).
      const optSig = (opts: any) => (Array.isArray(opts) && opts.length)
        ? opts.map((o: any) => ({ group: o?.group ?? null, label: o?.label ?? null })) : null;
      const remSig = (r: any) => (Array.isArray(r) ? r.map((x: any) => String(x).toLowerCase()).sort() : []);
      // NOTE: price is deliberately NOT part of the signature. The stored rows always carry a
      // server-formatted price while an incoming line usually carries none, so comparing it
      // would make every order look "new" and disable this guard. Two open-price lines at
      // different prices can therefore trip the warning — it's overridable (confirmDuplicate).
      const lineSig = (i: any) => ({ id: i.id, qty: Number(i.qty) || 1, options: optSig(i.options), removed: remSig(i.removed) });
      const sig = JSON.stringify({ items: items.map(lineSig), allergies: Array.isArray(allergies) ? allergies : [] });
      if (!(body && body.confirmDuplicate === true)) {
        const recent = (await sb.from("orders").select("items, allergies")
          .eq("table_number", t).eq("restaurant_id", rid).gte("created_at", new Date(Date.now() - 3000).toISOString()).limit(5)).data || [];
        if (recent.some((o: any) => JSON.stringify({
          items: (o.items || []).map(lineSig),
          allergies: Array.isArray(o.allergies) ? o.allergies : [],
        }) === sig)) {
          return NextResponse.json({ error: "This looks identical to an order you just sent.", duplicateWarning: true }, { status: 409 });
        }
      }
      const { data, error } = await sb.rpc("lfh_staff_place_order", {
        p_table: t, p_items: items, p_allergies: Array.isArray(allergies) ? allergies : [], p_note: note || null,
        p_restaurant_id: rid,
        // Pass the "send anyway" flag through, exactly like the tablet route: the RPC runs its
        // OWN double-tap guard atomically under a per-table lock (mig 202), which is what
        // catches two truly-simultaneous identical sends (the JS pre-check above races). Without
        // this, confirming "Send it anyway?" skipped only the JS guard and the RPC still refused
        // — so a deliberate re-send was impossible for 3s and answered {ok:false}.
        p_confirm_duplicate: body?.confirmDuplicate === true,
      });
      if (error) throw new Error(error.message);
      // A REFUSAL (sold_out / unknown_item / price_required …) fell through as a SUCCESS with
      // no order_id: the manager saw "Order sent to the kitchen" and nothing was placed — a tap
      // that vanished in silence. Surface it as a real error so the refusal is readable.
      if (data && (data as { ok?: boolean }).ok === false) {
        return err(editErrMsg((data as { reason?: string }).reason), 400);
      }
      // A manager placed this, so it's already confirmed — skip the kitchen "accept" step
      // and push it straight onto the pass as "preparing" (same as the tablet).
      const placedId = (data as any)?.order_id;
      if (placedId) {
        const cur = (await sb.from("orders").select("items").eq("id", placedId).eq("restaurant_id", rid).single()).data as { items?: any[] } | null;
        const its = Array.isArray(cur?.items) ? cur!.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
        // WHO punched this order rides along on the SAME update (no extra round trip), so the
        // performance report can say "this manager punched 412 bills". NULL keeps meaning
        // "the guest ordered it themselves". (mig 220 added the columns; 2026-07-29)
        await sb.from("orders")
          .update({ items: its, status: "preparing", placed_by_id: g.user?.id ?? null, placed_by: actorName })
          .eq("id", placedId).eq("restaurant_id", rid);
        await sb.from("order_items").update({ status: "preparing" }).eq("order_id", placedId).eq("restaurant_id", rid).eq("status", "received");
      }
      // ── A DISCOUNT TYPED IN ⚡ QO/P, applied in the SAME request (owner, 2026-08-03) ──
      // The builder holds the amount while the order is assembled and sends it here rather than
      // firing a second POST once the order exists: a follow-up call can fail on its own, or land
      // after the bill was printed, and either way the guest is charged the undiscounted price.
      //
      // Three rules, all enforced HERE and not in the browser:
      //  · the power — same `give_discounts` the − Discount button on a table is gated by;
      //  · the role's %-cap — the identical discountCapPct/overDiscountCap check the
      //    orders/:id/discount handler runs, so QO/P is not a way around a waiter's 5% limit;
      //  · ADD, never replace. A quick order can land on a table that already has a bill
      //    discount. lfh_staff_bill_discount SETS the session's discount, so passing the new
      //    amount alone would silently wipe the discount that table was already given.
      const rawDisc = Number(body?.discount);
      if (placedId && Number.isFinite(rawDisc) && rawDisc > 0) {
        if (!(await managerCan(g, rid, "give_discounts"))) return permDenied("give discounts");
        const row = (await sb.from("orders").select("subtotal, taxable_base, mrp_amount, session_id, discount").eq("id", placedId).eq("restaurant_id", rid).single()).data as
          (OrderMoney & { session_id?: string | null; discount?: number }) | null;
        // The same cap as every other discount door (mig 270 + 271) — a quick order containing
        // an MRP bottle must not be the one way round a price that is legally final.
        const base = discountBaseOf(row || {}, effectiveTaxRate(await taxSettings(rid)));
        const cap = await discountCapPct(rid, discountRole(g.user?.role));
        if (overDiscountCap(rawDisc, base, cap)) return err(`That discount is over your ${cap}% limit — ask the owner.`, 403);
        const note = String(body?.discountNote || "").slice(0, 200) || null;
        const amount = Math.round(Math.min(Math.max(rawDisc, 0), base) * 100) / 100;
        if (row?.session_id) {
          // The bill's CURRENT discount + this one. Read from the session's own orders so a
          // discount given seconds earlier on another device is included rather than lost.
          const sib = (must(await sb.from("orders").select("discount, status").eq("session_id", row.session_id).eq("restaurant_id", rid)) || []) as { discount?: number; status?: string }[];
          const already = sib.reduce((a, o) => a + (o.status === "cancelled" ? 0 : Number(o.discount) || 0), 0);
          must(await sb.rpc("lfh_staff_bill_discount", { p_session: row.session_id, p_amount: Math.round((already + amount) * 100) / 100, p_note: note }));
        } else {
          must(await sb.from("orders").update({ discount: amount, discount_note: note }).eq("id", placedId).eq("restaurant_id", rid));
        }
        await log("manager", "order_discount", { restaurant_id: rid, order_id: placedId, detail: `quick order discount ₹${amount}${note ? ` · ${note}` : ""}`, device_id: dev });
      }
      await log("editor", "order_place", { restaurant_id: rid, table_number: t, device_id: dev, order_id: placedId ?? null });
      return ok(data);
    }

    // ── Parcel (a staff-placed counter PARCEL) ────────────────────────────────
    // A "New Parcel" is a manually-created order in the Platform system with its OWN
    // source 'parcel' (mig 209) — so it lands on the Platform board / kitchen labelled
    // "Parcel" (never confused with the website "Takeaway" channel). Gated by the parcel
    // module + power (its own ladder), separate from the platform delivery module.
    // Titles/prices are resolved SERVER-SIDE (never trust the client cart); total is the
    // item subtotal, matching how every other platform order stores `total`.
    if (a === "parcel" && path.length === 1) {
      if (!(await parcelLadder(rid)).effective) return err("Parcel orders aren't switched on for this restaurant.", 403);
      if (!(await managerCan(g, rid, "parcel"))) return permDenied("take parcel / takeaway orders");
      const { items, customer, phone, note, allergies, paid, method } = body || {};
      if (!Array.isArray(items) || !items.length) return err("items required");
      // The client sends only {id, qty, note} (+ price for an open-price dish); resolve
      // title+price from OUR menu (rid-scoped).
      const ids = [...new Set(items.map((i: any) => String(i?.id || "")).filter(Boolean))];
      // `tags` so the 86 board is honoured here too — parcel prices itself instead of going
      // through the shared server-side pricer, so it has to make the same two refusals by hand.
      // `tax_mode` so a parcel prices an MRP bottle the same way a table does (mig 270).
      // Parcel deliberately prices itself instead of calling lfh_price_order, so every rule
      // that pricer applies has to be applied here BY HAND — the 86 board below, and now the
      // three price behaviours. A parcel is a taxable sale like any other; a sealed bottle
      // sold at the counter is no more taxable than the same bottle sold at a table.
      const menu = (must(await sb.from("menu_items").select("id,title,price,open_price,tags,tax_mode").eq("restaurant_id", rid).in("id", ids)) || []) as { id: string; title: string; price: unknown; open_price?: boolean; tags?: string[]; tax_mode?: string }[];
      const byId = new Map(menu.map((d) => [String(d.id), d]));
      // The tax posture is read ONCE, before the loop, because every line needs it.
      const parcelSet = (await sb.from("settings")
        .select(`${TAX_SETTINGS_COLUMNS}, item_tax_modes_allowed, mrp_tax_treatment`)
        .eq("restaurant_id", rid).maybeSingle()).data || {};
      const picked: { title: string; qty: number; price: number; note?: string; tax_mode?: string; is_mrp?: boolean }[] = [];
      let total = 0;
      for (const it of items) {
        const d = byId.get(String(it?.id || ""));
        // Was silently dropped, so the parcel went out a line short — see the waiter panel's twin.
        if (!d) return err(editErrMsg("unknown_item"), 400);
        if (Array.isArray(d.tags) && d.tags.includes("sold-out")) return err(`"${d.title}" is sold out — can't add it.`, 400);
        const qty = Math.max(1, Math.min(99, Number(it?.qty) || 1));
        // Open-price dish: the manager typed the price at order time — honour it (clamped),
        // don't read the (empty) DB price. A missing/zero price on such a line is refused.
        let price: number;
        if (d.open_price) {
          price = Math.max(0, Math.min(100000, Number(String(it?.price ?? "").replace(/[^0-9.]/g, "")) || 0));
          if (price <= 0) return err(`Enter a price for "${d.title}".`, 400);
          price = Math.round(price * 100) / 100;
        } else {
          price = Number(String(d.price).replace(/[^0-9.]/g, "")) || 0;
        }
        const line: { title: string; qty: number; price: number; note?: string; tax_mode?: string; is_mrp?: boolean } = {
          title: d.title, qty, price,
          // Resolved and FROZEN onto the line, exactly as lfh_price_order does for a table.
          tax_mode: resolveTaxMode(d.tax_mode, parcelSet),
        };
        if (isMrpDish(d.tax_mode, parcelSet)) line.is_mrp = true;
        const ln = String(it?.note || "").trim().slice(0, 200);
        if (ln) line.note = ln;
        picked.push(line);
        total += price * qty;
      }
      if (!picked.length) return err("no valid dishes", 400);
      total = Math.round(total * 100) / 100;
      // THE RECORD MUST EQUAL THE PAPER (fixed 2026-08-02). A parcel was stored at the item
      // subtotal with no tax, while the bill handed to the customer runs through the same
      // billMath() a table's bill does and ADDS tax on top — so ₹250 of food was charged as
      // ₹262.50 and recorded as ₹250. For a tax tool that is the wrong way round: the sale was
      // understated by exactly the tax collected. A counter takeaway is a taxable sale like any
      // other, so it is stored like any other — subtotal + tax — using the ONE tax source
      // (lib/tax.ts), never a rate typed in here. aggregator_orders has a single `total` column
      // and for every delivery row it already means the final amount; a parcel now agrees.
      // The printed bill takes its subtotal from the LINES (never this stored total, or it would
      // tax it twice), so paper and record land on the same number.
      // The split (mig 270): only the taxable part of the parcel is taxed, and a discount may
      // not eat a locked MRP price — the same two rules a table's bill obeys.
      const parcelSplit0 = splitBill(picked, parcelSet, 0);
      // ── DISCOUNT, BEFORE TAX (owner, 2026-08-03 — the ⚡ QO/P builder can now give one) ──
      // The same order the whole app uses (lib/billMath): discount comes off the SUBTOTAL, and
      // tax is charged on what is left. Taking it off the tax-inclusive total instead would
      // over-credit by discount×rate — the 2026-07-06 bug, and on a tax tool it would also
      // understate the tax collected. Clamped to the food value and re-checked against this
      // role's %-cap here, because a client number is a request and never the ruling.
      // What a discount may work on: NOT the whole subtotal any more, because part of it can
      // be a price that is legally final. Refused OUT LOUD when it is too big — never trimmed
      // in silence, which would hand back a bill the person did not ask for.
      const parcelDiscBase = parcelSplit0.discountBase;
      let parcelDisc = 0;
      const rawPDisc = Number(body?.discount);
      if (Number.isFinite(rawPDisc) && rawPDisc > 0) {
        if (!(await managerCan(g, rid, "give_discounts"))) return permDenied("give discounts");
        const pcap = await discountCapPct(rid, discountRole(g.user?.role));
        if (overDiscountCap(rawPDisc, parcelDiscBase, pcap)) return err(`That discount is over your ${pcap}% limit — ask the owner.`, 403);
        if (rawPDisc > parcelDiscBase + 0.005) {
          return err(parcelSplit0.mrpAmount > 0
            ? `Most you can take off this parcel is ₹${parcelDiscBase.toFixed(2)} — the other ₹${parcelSplit0.mrpAmount.toFixed(2)} is MRP items, whose price is final.`
            : `Most you can take off this parcel is ₹${parcelDiscBase.toFixed(2)}.`, 400);
        }
        parcelDisc = Math.round(Math.max(rawPDisc, 0) * 100) / 100;
      }
      total = splitBill(picked, parcelSet, parcelDisc).total;

      // HOW IT WAS PAID, IN THE ONE SPELLING EVERY BREAKDOWN COUNTS — CHECKED BEFORE THE ROW
      // EXISTS (2026-08-05). Two faults, one line: it wrote `String(method || "cash").slice(0, 20)`
      // with no allow-list and a default in the WRONG CASE, so a counter-paid parcel was filed
      // under a spelling nothing groups by (the live backup data showed 8 rows of `cash` beside 4
      // of `Cash`, while dine-in has only ever held the canonical four). `/platform/:id/pay` was
      // given this exact fix on 2026-08-04; the create path one function away never got it.
      //
      // And it is validated HERE, not after the insert: refusing later would leave an orphaned
      // parcel on the Platform board WITH a kitchen ticket already fired for it. A request that
      // is going to be refused must be refused before it creates anything.
      let payMethod: string | null = null;
      if (paid === true) {
        const rawM = String(method || "Cash").trim();
        const m = (PAYMENT_METHODS as readonly string[]).find((x) => x.toLowerCase() === rawM.toLowerCase());
        if (!m) return err("Pick how it was paid.", 400);
        payMethod = m;
      }
      const cust = String(customer || "").trim().slice(0, 120) || "Parcel";
      const ext = `PARCEL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const ins = await sb.rpc("lfh_platform_insert", {
        p_source: "parcel", p_external_id: ext, p_customer: cust,
        p_phone: String(phone || "").trim().slice(0, 40) || null,
        p_items: picked, p_total: total, p_restaurant_id: rid,
      });
      if (ins.error) throw new Error(ins.error.message);
      const row = Array.isArray(ins.data) ? ins.data[0] : ins.data;
      // Post-insert: keep the whole-order kitchen note + allergies + a 'parcel' channel
      // marker in payload, and — when paid at the counter — stamp the paid columns. ONE
      // scoped UPDATE (service-role bypasses RLS, so id + restaurant_id is the fence).
      const wholeNote = String(note || "").trim().slice(0, 300);
      const alg = Array.isArray(allergies) ? allergies.map((x: unknown) => String(x)).slice(0, 20) : [];
      // The discount is RECORDED, not just deducted. `total` already reflects it, so every board,
      // report and Z-figure is right without touching them — but a sale whose total is lower than
      // its lines with nothing saying why is exactly the shape a books check objects to. aggregator
      // _orders has no discount column, so the record rides in `payload` (JSONB, already written
      // here): what came off, and the reason, readable on the parcel and printed on its bill.
      const pDisc = parcelDisc > 0 ? { discount: parcelDisc, discount_note: String(body?.discountNote || "").slice(0, 200) || null } : {};
      const patch: Record<string, unknown> = { payload: { channel: "parcel", note: wholeNote || null, allergies: alg, ...pDisc } };
      if (paid === true) { patch.paid = true; patch.paid_at = new Date().toISOString(); patch.payment_method = payMethod as string; }
      if (row?.id) { const up = await sb.from("aggregator_orders").update(patch).eq("id", row.id).eq("restaurant_id", rid); if (up.error) throw new Error(up.error.message); }
      await log("manager", "parcel_place", { restaurant_id: rid, detail: `${paid === true ? "paid" : "unpaid"} · ₹${total}${parcelDisc > 0 ? ` · discount ₹${parcelDisc}` : ""}`, device_id: dev });
      // A discount is a money change, so it gets its OWN audit row too — the "who is discounting"
      // watch reads `order_discount`, and a parcel discount buried inside a parcel_place line
      // would never reach it.
      if (parcelDisc > 0) await log("manager", "order_discount", { restaurant_id: rid, detail: `parcel discount ₹${parcelDisc}${body?.discountNote ? ` · ${String(body.discountNote).slice(0, 200)}` : ""}`, device_id: dev });
      return ok({ ...row, paid: paid === true });
    }

    // ── Handle a guest rating (mig 140) — mark handled / add an internal note ──
    // Gated by the view_ratings power; the feedback row must belong to THIS restaurant.
    if (a === "ratings" && b === "ack") {
      if (!(await managerCan(g, rid, "view_ratings"))) return permDenied("handle guest ratings");
      const rb = body as { id?: string; acknowledged?: unknown; note?: unknown };
      const id = String(rb?.id || "");
      if (!id) return err("id required", 400);
      const hasAck = "acknowledged" in (rb || {});
      if (hasAck && typeof rb.acknowledged !== "boolean") return err("acknowledged must be true/false", 400);
      const hasNote = "note" in (rb || {});
      if (hasNote && typeof rb.note !== "string") return err("note must be text", 400);
      const row = (await sb.from("feedback").select("id, restaurant_id").eq("id", id).maybeSingle()).data as { restaurant_id: string } | null;
      if (!row) return err("not found", 404);
      if (row.restaurant_id !== rid) return err("forbidden", 403);
      const who = g.user?.name || g.user?.username || "Manager";
      const patch: Record<string, unknown> = {};
      if (hasAck) { patch.acknowledged = rb.acknowledged; patch.acknowledged_at = rb.acknowledged ? new Date().toISOString() : null; patch.acknowledged_by = rb.acknowledged ? who : null; }
      if (hasNote) patch.staff_note = (rb.note as string).trim() || null;
      if (!Object.keys(patch).length) return err("nothing to update", 400);
      const upd = await sb.from("feedback").update(patch).eq("id", id);
      if (upd.error) throw new Error(upd.error.message);
      return ok({ ok: true });
    }

    // ── Platform (Zomato/Swiggy/website) orders ───────────────────────────────
    // platform/test — the "Simulate order" control: drop a realistic demo order in on a chosen
    // channel (stands in for the real aggregator webhook until API keys exist). Same insert path
    // the webhook will use. Gated by the platform module + channel + the manager `platform` power
    // (admin/owner pass via managerCan's higher-view bypass). Marked payload.demo so a later real
    // integration can tell demo orders apart.
    if (a === "platform" && b === "test") {
      if (g.user && !(await platformLadder(rid)).effective) return err("The Platform board isn't enabled for this restaurant.", 403);
      // Simulate is a DEMO/representation tool, NOT an operational action — restrict it to the
      // admin (g.user === null) and the owner. Real floor staff must never be able to add fake
      // orders to live revenue (the reason the old "test order" button was removed). The manager
      // panel hides the button for them too; this is the server-side guard.
      if (g.user && g.user.role !== "owner") return err("Only the owner or admin can add demo platform orders.", 403);
      // Only simulate on a channel that's actually turned on for this restaurant.
      const chRow = must(await sb.from("settings").select("platform_channels").eq("restaurant_id", rid).maybeSingle()) as { platform_channels?: Record<string, { on?: boolean }> } | null;
      const chan = chRow?.platform_channels || {};
      const CH2SRC: Record<string, string> = { zomato: "zomato", swiggy: "swiggy", website: "takeaway" };
      const onChannels = Object.keys(CH2SRC).filter((k) => chan?.[k]?.on === true);
      const reqCh = String((body && body.channel) || "").toLowerCase();
      // A named channel that's OFF is refused (don't silently simulate a different one); no name
      // = pick any live channel (the UI only ever offers channels that are on).
      if (reqCh && !onChannels.includes(reqCh)) return err("That channel is turned off for this restaurant.", 400);
      const channel = reqCh || onChannels[Math.floor(Math.random() * onChannels.length)];
      if (!channel) return err("No delivery channel is turned on for this restaurant.", 400);
      const src = CH2SRC[channel];
      // open_price dishes are skipped: they carry no menu price, so a demo order built from
      // one would show a ₹0 line.
      const dishes = must(await sb.from("menu_items").select("title, price").eq("restaurant_id", rid).eq("open_price", false).limit(50)) || [];
      const pick: { title: string; qty: number; price: number }[] = [];
      let total = 0;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n && dishes.length; i++) {
        const d = dishes[Math.floor(Math.random() * dishes.length)];
        const qty = 1 + Math.floor(Math.random() * 2);
        const price = Number(String(d.price).replace(/[^0-9.]/g, "")) || 0;
        pick.push({ title: d.title, qty, price });
        total += price * qty;
      }
      const NAMES = ["Aarav S.", "Meera K.", "Priya R.", "Rohan B.", "Sana M.", "Kunal D.", "Diya P.", "Vikram J."];
      const cust = NAMES[Math.floor(Math.random() * NAMES.length)];
      const ext = `${channel.toUpperCase()}-DEMO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const { data, error } = await sb.rpc("lfh_platform_insert", {
        p_source: src, p_external_id: ext, p_customer: cust,
        p_phone: `+9190${Math.floor(10000000 + Math.random() * 89999999)}`,
        p_items: pick, p_total: total, p_restaurant_id: rid,
      });
      if (error) throw new Error(error.message);
      const testRow = Array.isArray(data) ? data[0] : data;
      // Mark the row as a demo/representation order + remember which channel it came in on
      // (website vs the takeaway source), so the board labels it and a later real integration
      // can distinguish it. One scoped update (id + restaurant_id is the fence).
      if (testRow?.id) await sb.from("aggregator_orders").update({ payload: { demo: true, channel } }).eq("id", testRow.id).eq("restaurant_id", rid);
      await log("manager", "platform_test_order", { restaurant_id: rid, detail: `${channel} demo order`, device_id: dev });
      return ok(testRow);
    }

    // platform/:id/status — advance a platform order (accept/preparing/ready/handed_over/cancelled)
    if (a === "platform" && c === "status") {
      const status = body && body.status;
      const ALLOWED = ["new", "accepted", "preparing", "ready", "handed_over", "cancelled"];
      if (!ALLOWED.includes(status)) return err("invalid status");
      // lfh_platform_set_status updates by id with NO tenant scope (mig 071); confirm this
      // platform order is THIS restaurant's before advancing it (service-role bypasses RLS).
      const owns = must(await sb.from("aggregator_orders").select("id,source").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as { source?: string } | null;
      if (!owns) return err("That platform order isn't for this restaurant.", 404);
      // A parcel is gated by the parcel module/power; a delivery order by the platform one.
      if (!(await platformOrParcelCan(g, rid, owns.source))) return permDenied("manage this order");
      const { data, error } = await sb.rpc("lfh_platform_set_status", { p_id: b, p_status: status, p_by: "manager" });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      void notifyAggregator(row?.source, row?.external_id, status); // best-effort push back to the platform (dormant w/o keys)
      await log("manager", "platform_status", { restaurant_id: rid, detail: status, device_id: dev });
      return ok(row);
    }

    // platform/:id/pay — collect a "pay on pickup" parcel (or any unpaid takeaway) at handover.
    // Scoped ownership check first (the set is service-role, so this eq() pair is the fence).
    if (a === "platform" && c === "pay") {
      const owns = must(await sb.from("aggregator_orders").select("id,total,source,paid").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as { total?: number; source?: string; paid?: boolean } | null;
      if (!owns) return err("That order isn't for this restaurant.", 404);
      if (!(await platformOrParcelCan(g, rid, owns.source))) return permDenied("collect this order");
      // ALREADY COLLECTED → say so instead of re-stamping it. Paying twice used to move paid_at
      // and overwrite the method, quietly rewriting how the money came in.
      if (owns.paid) return err("This one is already marked collected.", 409);
      // VALIDATED against the same list every table settle uses (2026-08-04). This accepted any
      // string up to 20 characters, so a typo or a stale client could write a payment method that
      // appears in no breakdown — while a table settle has always been checked.
      const rawMethod = String((body && body.method) || "Cash").trim();
      const method = (PAYMENT_METHODS as readonly string[]).find((m) => m.toLowerCase() === rawMethod.toLowerCase());
      if (!method) return err("Pick how it was paid.", 400);
      const up = await sb.from("aggregator_orders").update({ paid: true, paid_at: new Date().toISOString(), payment_method: method }).eq("id", b).eq("restaurant_id", rid);
      if (up.error) throw new Error(up.error.message);
      await log("manager", "parcel_collect", { restaurant_id: rid, detail: `₹${owns.total ?? 0} · ${method}`, device_id: dev });
      return ok({ ok: true, id: b, paid: true });
    }

    /* sessions/:id/bill-printed — record that this TABLE's bill went to the printer (mig 333).
       The exact shape of platform/:id/printed below, one table across, and for the same stated
       reason: the fact has to live on the BILL, not on the device that printed it, because the
       manager prints at the till and a waiter may reprint from the tablet a minute later — that
       second device has no way to know, and would hand out an unbranded duplicate.
       Stamped ONCE and never moved: the first print stays the first print, so every later copy is
       a reprint and the document brands it. Deliberately not reversible from here — this is a
       record that paper was produced. Answering ok() when it is already stamped means a panel can
       call it after every print without a guard of its own, and a retry is free. */
    if (a === "sessions" && c === "bill-printed") {
      const owns = must(await sb.from("sessions").select("id,bill_printed_at").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as { bill_printed_at?: string | null } | null;
      if (!owns) return err("That bill isn't for this restaurant.", 404);
      if (owns.bill_printed_at) return ok({ ok: true, id: b, bill_printed_at: owns.bill_printed_at, reprint: true });
      const at = new Date().toISOString();
      const up = await sb.from("sessions").update({ bill_printed_at: at }).eq("id", b).eq("restaurant_id", rid);
      if (up.error) throw new Error(up.error.message);
      return ok({ ok: true, id: b, bill_printed_at: at, reprint: false });
    }

    // platform/:id/printed — record that this order's customer bill went to the printer
    // (mig 256). Together with `paid` this is what decides when a Parcel tile leaves the
    // live floor, so it has to be on the ORDER, not on the device that printed it.
    // Deliberately NOT reversible from here: this is a record that paper was produced.
    if (a === "platform" && c === "printed") {
      const owns = must(await sb.from("aggregator_orders").select("id,source,printed_at").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as { source?: string; printed_at?: string | null } | null;
      if (!owns) return err("That order isn't for this restaurant.", 404);
      if (!(await platformOrParcelCan(g, rid, owns.source))) return permDenied("print this order");
      // Already stamped → answer ok without moving the time, so a reprint doesn't rewrite
      // when the first bill was produced.
      if (owns.printed_at) return ok({ ok: true, id: b, printed_at: owns.printed_at });
      const at = new Date().toISOString();
      const up = await sb.from("aggregator_orders").update({ printed_at: at }).eq("id", b).eq("restaurant_id", rid);
      if (up.error) throw new Error(up.error.message);
      await log("manager", "parcel_print", { restaurant_id: rid, device_id: dev });
      return ok({ ok: true, id: b, printed_at: at });
    }

    // platform/toggles — flip "kitchen can accept" / "show in bills"
    if (a === "platform" && b === "toggles") {
      const patch: Record<string, boolean> = {};
      if (typeof body.kitchen_can_accept_platform === "boolean") patch.kitchen_can_accept_platform = body.kitchen_can_accept_platform;
      if (typeof body.platform_in_bills === "boolean") patch.platform_in_bills = body.platform_in_bills;
      if (!Object.keys(patch).length) return err("no toggle given");
      must(await sb.from("settings").update(patch).eq("restaurant_id", rid).select());
      // A SENTENCE, NOT THE PATCH OBJECT (owner, 2026-09-02: "it should be in the human
      // language"). This recorded `{"platform_in_bills":true}` — a database column name and a
      // boolean, on a screen the manager and the owner both read. Both toggles are named here in
      // the words their own switches use on the Parcel & platforms screen.
      const TOGGLE_WORDS: Record<string, [string, string]> = {
        kitchen_can_accept_platform: ["the kitchen can now accept delivery-app orders", "the kitchen can no longer accept delivery-app orders"],
        platform_in_bills: ["delivery-app orders now show in the bills", "delivery-app orders no longer show in the bills"],
      };
      const said = Object.entries(patch)
        .map(([k, v]) => TOGGLE_WORDS[k]?.[v ? 0 : 1] ?? `${k.replace(/_/g, " ")} turned ${v ? "on" : "off"}`)
        .join("; ");
      await log("manager", "platform_toggle", { restaurant_id: rid, detail: said, device_id: dev });
      return ok({ ok: true, ...patch });
    }

    // ── banquet (mig 130): item CRUD + bill generation. All rid-scoped; the
    // entitlement is re-checked here (and again inside the place RPC) so a
    // restaurant without the module can't be driven even by a forged client.
    if (a === "banquet") {
      // Full ladder (mig 167) — see the GET gate above; the place RPC still re-checks
      // the admin switch inside SQL as the final backstop.
      if (g.user && !(await banquetLadder(rid)).effective) return err("Banquet isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "banquet"))) return permDenied("use banquet billing");
      // banquet/item-save — create/update one banquet line ({ id?, title, price, unit, active, sort_order })
      if (b === "item-save") {
        if (!(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the banquet menu");
        const title = String(body?.title || "").trim().slice(0, 120);
        if (!title) return err("title required");
        const price = Math.max(0, Math.min(1_000_000, Number(body?.price) || 0));
        const unit = String(body?.unit ?? "per plate").trim().slice(0, 40);
        const patch = { title, price, unit, active: body?.active !== false, sort_order: Math.round(Number(body?.sort_order) || 0) };
        const row = body?.id
          ? must(await sb.from("banquet_items").update(patch).eq("id", String(body.id)).eq("restaurant_id", rid).select("id,title,price,unit,sort_order,active"))[0]
          : must(await sb.from("banquet_items").insert({ ...patch, restaurant_id: rid }).select("id,title,price,unit,sort_order,active"))[0];
        if (!row) return err("banquet item not found", 404);
        await log("manager", "banquet_item_save", { restaurant_id: rid, detail: `"${title}" ₹${price}`, device_id: dev });
        return ok(row);
      }
      // banquet/item-delete — { id }
      if (b === "item-delete") {
        if (!(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the banquet menu");
        must(await sb.from("banquet_items").delete().eq("id", String(body?.id || "")).eq("restaurant_id", rid).select("id"));
        await log("manager", "banquet_item_delete", { restaurant_id: rid, device_id: dev });
        return ok({ ok: true });
      }
      // banquet/place — { table?, lines:[{id, qty}] }. With a table the bill lands on
      // it like a normal order; WITHOUT one (mig 133) it lands as a standalone
      // "Walk-in / no table" bill in the Bills tab — no phantom table needed.
      if (b === "place") {
        const t = String(body?.table || "").trim();
        if (t) {
          if (!/^\d+$/.test(t)) return err("valid table required");
          const tcRow = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
          const tableCount = Number((tcRow.data as { table_count?: number } | null)?.table_count) || 0;
          if (tableCount > 0 && (Number(t) < 1 || Number(t) > tableCount)) return err(`Table ${t} doesn't exist (this place has ${tableCount} tables).`, 400);
        }
        const lines = Array.isArray(body?.lines) ? body.lines : [];
        if (!lines.length) return err("lines required");
        const { data, error } = await sb.rpc("lfh_banquet_place_order", { p_table: t || null, p_lines: lines, p_restaurant_id: rid });
        if (error) throw new Error(error.message);
        if (!(data as any)?.ok) return err(banquetErrMsg((data as any)?.reason), 400);
        await log("manager", "banquet_place", { restaurant_id: rid, table_number: t || null, detail: `total ${(data as any)?.total}`, device_id: dev });
        return ok(data);
      }
      // banquet/bill — issue a numbered banquet bill (mig 237).
      // { table?, lines:[{id,qty,price?}], meta:{…} }. The RPC prices every line from
      // banquet_items, keeps ONLY the meta keys this restaurant is allowed to fill
      // (settings.banquet_fields), takes the next number from the restaurant's own
      // counter under a row lock, and lands the sale as a normal 'served' order so
      // Bills, the day-book and the GST report see it with no changes. POST is already
      // wrapped in withIdempotency, so an offline replay bills exactly once.
      if (b === "bill") {
        const t = String(body?.table || "").trim();
        if (t) {
          if (!/^\d+$/.test(t)) return err("valid table required");
          const tcRow = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
          const tableCount = Number((tcRow.data as { table_count?: number } | null)?.table_count) || 0;
          if (tableCount > 0 && (Number(t) < 1 || Number(t) > tableCount)) return err(`Table ${t} doesn't exist (this place has ${tableCount} tables).`, 400);
        }
        const lines = Array.isArray(body?.lines) ? body.lines : [];
        if (!lines.length) return err("Add at least one banquet line.");
        // prepared_by is recorded from the LOGIN, never from the browser (the field
        // switch only decides whether it prints).
        const meta = { ...(body?.meta && typeof body.meta === "object" ? body.meta : {}), prepared_by: g.user?.name || g.user?.username || "Manager" };
        const { data, error } = await sb.rpc("lfh_banquet_bill_create", {
          p_lines: lines, p_meta: meta, p_table: t || null, p_restaurant_id: rid,
          p_by: g.user?.name || g.user?.username || "Manager",
        });
        if (error) throw new Error(error.message);
        if (!(data as any)?.ok) return err(banquetErrMsg((data as any)?.reason), 400);
        await log("manager", "banquet_bill", {
          restaurant_id: rid, table_number: t || null,
          detail: `${(data as any)?.bill_no} · total ${(data as any)?.total}`, device_id: dev,
        });
        // prepared_by comes back so the FIRST print carries the same name a re-print
        // will show (the panel has no reliable copy of who is logged in).
        return ok({ ...(data as object), prepared_by: meta.prepared_by });
      }
      return err("unknown banquet action", 404);
    }

    // orders/delete (bulk/clear) — keep settled bills. Removing bill records is
    // owner-gated (least-privilege): a plain manager needs the void_bills power.
    // Managers can always CANCEL an order (routine, ungated) — only a DELETE needs
    // the power. A "delete" here is a SOFT delete (mig 188): rows are stamped, never
    // erased, so a deleted bill is retained for tax/audit and shows as a tombstone.
    // Every clear is written to the Log for accountability.
    // ── REMOVAL AUDIT (mig 251) ──────────────────────────────────────────────────
    // audit — record WHY something was removed, with the person who did it. The panel calls this
    // the moment a removal succeeds, and the RPC fills in the context (bill number, KOT number,
    // table) from the order itself rather than trusting the browser for it.
    if (a === "audit" && !b && req.method === "POST") {
      const { kind, reason_code, reason_note, order_id, item_id, item_title, qty, amount, table } = body || {};
      const kinds = ["order_cancelled", "order_deleted", "dish_removed", "menu_item_deleted", "invoice_voided"];
      if (!kinds.includes(String(kind))) return err("unknown removal kind", 400);
      const { data, error } = await sb.rpc("lfh_record_removal", {
        p_rid: rid, p_kind: String(kind),
        p_reason_code: reason_code ? String(reason_code).slice(0, 40) : null,
        p_reason_note: reason_note ? String(reason_note).slice(0, 400) : null,
        p_actor: g.user?.username || g.user?.role || "manager",
        p_actor_id: g.user?.id ?? null, p_actor_role: g.user?.role ?? null, p_device: dev ?? null,
        p_order: order_id || null, p_item: item_id || null,
        p_item_title: item_title ? String(item_title).slice(0, 200) : null,
        p_qty: Number.isFinite(Number(qty)) ? Number(qty) : null,
        p_amount: Number.isFinite(Number(amount)) ? Number(amount) : null,
        p_table: table ? String(table) : null, p_meta: {},
      });
      if (error) throw new Error(error.message);
      return ok({ ok: true, id: data });
    }

    // ── ANSWER (OR CORRECT) "WAS THE FOOD MADE?" FROM THE AUDIT (P3, owner 2026-08-18) ──────────
    // "from audit section you can trasnfer the thing as cancelling." Three rows need this and none
    // of them had a person to ask at the time:
    //   · a cancellation from before this feature existed;
    //   · the waiter tablet emptying an order dish by dish until it cancels itself;
    //   · lib/sessionClose archiving unpaid food when a table closes — nobody is standing there.
    // They sit tagged `unanswered`, and this is where a manager settles them. It is also how a
    // WRONG answer is corrected: the RPC is idempotent and append-only, so it moves the stock and
    // the expense to match the new answer and records what it changed from.
    //
    // Gated on `void_bills` — the same power that lets someone cancel in the first place. Answering
    // moves real stock and writes a real cost, so it is not open floor work; but it needs no NEW
    // permission either, because "may cancel" and "may say whether it was cooked" are one job.
    if (a === "audit" && b === "classify" && req.method === "POST") {
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("change whether a cancelled order's food was made");
      const orderId = body?.order_id ? String(body.order_id) : "";
      const made = body?.made;
      if (!orderId) return err("which order?", 400);
      if (typeof made !== "boolean") return err("say whether the food was made", 400);
      const { data, error } = await sb.rpc("lfh_cancel_classify", {
        p_restaurant: rid, p_order: orderId, p_made: made,
        p_actor: g.user?.name || g.user?.username || "manager",
        p_actor_id: g.user?.id ?? null, p_actor_role: g.user?.role ?? null, p_audit_id: null,
      });
      if (error) throw new Error(error.message);
      const res = data as { ok?: boolean; reason?: string; lossCost?: number } | null;
      // A refusal is a real answer the screen must show, not a silent no-op — this is the mistake
      // the cancel path made on 2026-08-18 (it called the RPC before the row was cancelled).
      if (!res || res.ok !== true) return err(res?.reason === "not_cancelled"
        ? "That order isn't cancelled, so there is nothing to answer."
        : res?.reason === "order_not_found" ? "That order no longer exists."
        : "Couldn't record that answer — try again.", 409);
      await log("editor", "cancel_classified", {
        restaurant_id: rid, order_id: orderId, device_id: dev,
        detail: made
          ? `the food WAS made — recorded as a loss of ${res.lossCost ?? 0}`
          : "the food was never made — ingredients returned to stock",
      });
      return ok({ ok: true, ...res });
    }

    if (a === "orders" && b === "delete") {
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("delete or clear bills");
      if (!(await canDeleteBill(g, rid))) return permDenied("delete bills");
      const { ids } = body || {};
      // Reason the manager typed (owner 2026-07-23 — deletes must carry a why for the bill audit).
      const delReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      // ── ONE BILL PER REQUEST. THERE IS NO SWEEP (owner, 2026-08-21) ───────────────────────────
      // His words: *"we don't want that option, remove that option completely from manager panel"*,
      // and then, on what may still be deleted: *"he can delete one bill but with reason."*
      //
      // WHAT WENT: a `{ all: true }` branch that read up to 300 deletable bills for the restaurant
      // and tombstoned the lot, and the `🗑 Clear freed` button that fed a whole day's freed tables
      // in as one `ids` list. The `all` branch had had no caller in the panel for a long time — every
      // screen names its ids — so it was a live bulk delete reachable only by hand-forming a request.
      //
      // `ids` STAYS A LIST, because one bill is genuinely several order rows: a table's successive
      // KOTs all hang off one session, and the cancelled-bill card and the per-session delete both
      // hand over that whole group. So the rule is not "one id" — it is ONE BILL, enforced here on
      // the SESSION, which is what a bill actually is in this schema (there is no `bills` table; see
      // lib/billLedger.ts). A caller that names orders from two bills is refused, so no future screen
      // can turn this back into "clear the day" by widening a list.
      //
      // An order with no session (a counter parcel, a standalone banquet line) has no bill to group
      // by, so exactly one of those may be named at a time.
      //
      // R27 sits above all of it and is unchanged: canDeleteBill() is true for the Aevidine admin
      // console only. A manager and an owner cancel; they never delete. This endpoint is the admin's
      // support tool, and it is now a one-bill-at-a-time tool.
      const MAX_ORDERS_PER_BILL = 60;   // a very long table; far beyond it means the ids are not one bill
      let deletable: string[]; let kept: number;
      if (Array.isArray(ids) && ids.length) {
        if (ids.length > MAX_ORDERS_PER_BILL) {
          return err(`That names ${ids.length} orders. A bill is deleted one bill at a time — there is no bulk clear.`, 400);
        }
        const candidates = must(await sb.from("orders").select("id,payment_status,status,session_id").eq("restaurant_id", rid).is("deleted_at", null).in("id", ids)) as { id: string; payment_status: string; status: string; session_id: string | null }[];
        // ONE BILL: every named order must sit on the same session. `null` is not a group — an order
        // with no session is its own bill, so only one may be named.
        const sessions = new Set(candidates.map((o) => o.session_id));
        if (sessions.size > 1 || (sessions.has(null) && candidates.length > 1)) {
          return err("Those orders belong to more than one bill. Delete one bill at a time.", 400);
        }
        deletable = candidates.filter((o) => !(o.payment_status === "paid" && o.status !== "cancelled")).map((o) => o.id);
        kept = candidates.length - deletable.length;
      } else return err("no ids");
      // What each bill was worth, read BEFORE the delete so every Audit row can say so.
      const worthOf = new Map<string, { total: number; session_id: string | null; table_number: string | null }>();
      if (deletable.length) {
        for (const o of (must(await sb.from("orders").select("id,total,session_id,table_number").eq("restaurant_id", rid).in("id", deletable)) as
          { id: string; total: number | null; session_id: string | null; table_number: string | null }[]))
          worthOf.set(o.id, { total: Number(o.total) || 0, session_id: o.session_id, table_number: o.table_number });
      }
      // SOFT delete — the row stays; a restore can bring it back.
      const res = deletable.length ? await softDeleteOrders(rid, deletable, { actor: actorName, actorId: g.user?.id ?? null, reason: delReason }) : { deleted: 0 };
      await log("editor", "orders_delete", { restaurant_id: rid, detail: `deleted a bill (${res.deleted} ${res.deleted === 1 ? "order" : "orders"})` + (delReason ? ` — ${delReason}` : ""), device_id: dev });
      // One Audit row per bill, written server-side (was the browser's job — see removalAudit.ts).
      // In bounded PARALLEL, not one after another: strictly sequential meant a clear-all of a few
      // hundred bills spent most of the request waiting on round-trips. recordRemoval never throws,
      // so a batch cannot fail here — it reports itself as an error-level activity row instead.
      const AUDIT_CONCURRENCY = 8;
      for (let i = 0; i < deletable.length; i += AUDIT_CONCURRENCY) {
        await Promise.all(deletable.slice(i, i + AUDIT_CONCURRENCY).map((oid) => {
          const w = worthOf.get(oid);
          return recordRemoval({
            rid, kind: "order_deleted",
            reason: { code: typeof body?.reason_code === "string" ? body.reason_code : null, note: delReason || null },
            user: g.user, deviceId: dev, orderId: oid, sessionId: w?.session_id ?? null,
            tableNumber: w?.table_number ?? null, amount: w?.total ?? null,
            meta: { orders_on_bill: deletable.length },
          });
        }));
      }
      // No `moreToClear` any more — there is no sweep to be part-way through. `kept` stays, because
      // a settled bill is still refused and the panel says so rather than looking like it did nothing.
      return ok({ ok: true, deleted: res.deleted, kept });
    }

    // orders/:id/discount | accept | serve-all | item
    // orders/:id/tip — record an optional TIP (extra staff money on top of a bill), captured at
    // payment. Stored on this one order (a table bill puts its whole tip on the first paid order);
    // completely separate from subtotal/tax/discount/total, so it never affects the bill math.
    if (a === "orders" && c === "tip") {
      // A tip is money captured at payment and it is summed into the Z-report's "tips collected
      // today", so it gets a CEILING — that is the real fix here (sweep 2026-08-04): there was no
      // upper bound at all, so a mis-typed 500000 landed in the day-close figure with nothing to
      // stop it. The cap is deliberately generous; it is there to catch a typo, not to judge a tip.
      //
      // The permission read below is INERT today, for the reason spelled out at the on-the-house
      // gate (mark_paid has no Access row). It is here so a tip can never be the one settle-time
      // write that ignores a Mark-paid row if one ever returns — not because a hole was found.
      if (!(await managerCan(g, rid, "mark_paid"))) return permDenied("record a tip");
      const amt = Math.min(Math.max(0, Number(body?.amount) || 0), 100000);
      must(await sb.from("orders").update({ tip: amt }).eq("id", b).eq("restaurant_id", rid));
      await log("manager", "order_tip", { restaurant_id: rid, order_id: b, detail: `tip ₹${amt}`, device_id: dev });
      return ok({ ok: true });
    }
    if (a === "orders" && c === "discount") {
      if (!(await managerCan(g, rid, "give_discounts"))) return permDenied("give discounts");
      if (await invoiceLockedByOrder(b, rid)) return err(LOCKED_MSG, 409);
      // .eq(restaurant_id, rid) is the only tenant boundary (sb is service-role, RLS bypassed) —
      // a foreign order id can't be discounted.
      const cur = must(await sb.from("orders").select("subtotal, taxable_base, mrp_amount, session_id").eq("id", b).eq("restaurant_id", rid).single());
      const raw = Number(body && body.amount);
      // WHAT A DISCOUNT MAY WORK ON — the rule stated once (mig 272's lfh_order_discount_base):
      //   rate > 0 → the TAXABLE base. The `due = total − discount × (1 + rate)` identity every
      //              panel computes from only holds while the discount stays in the taxable pile.
      //   rate = 0 → everything except the locked MRP. With no tax, (1 + rate) is 1, so the
      //              identity survives a discount anywhere; only a legally-final price is locked.
      // NULL columns = an order placed before mig 270/271 = fully taxable, no MRP — which is
      // what those orders were, so nothing moves for an existing restaurant. The panel hides
      // the impossible amount; this is the guard behind it.
      const discRate = effectiveTaxRate(await taxSettings(rid));
      const discBase = discountBaseOf(cur as OrderMoney, discRate);
      // Per-role %-cap (owner 2026-07-24): refuse a discount over this actor's configured limit
      // (non-breaking — no cap → no block). Admin (g.user null) is uncapped.
      { const cap = await discountCapPct(rid, discountRole(g.user?.role));
        if (Number.isFinite(raw) && overDiscountCap(Math.max(raw, 0), discBase, cap)) return err(`That discount is over your ${cap}% limit — ask the owner.`, 403); }
      const note = String((body && body.note) || "").slice(0, 200) || null;
      // WHOLE-BILL (session) discount path — the FIX for the "discount shrinks when marked paid"
      // bug (2026-07-08). A table's discount is conceptually on the whole BILL, but the manager
      // panel used to write the entire amount onto ONE order (the first non-cancelled one). When
      // that order's own subtotal was smaller than the discount, mig 148's re-price trigger clamped
      // the discount down to that order's subtotal on the next subtotal/payment change (e.g. Mark
      // paid) — so the recorded + printed total jumped ABOVE what the guest actually paid. Routing
      // through lfh_staff_bill_discount (mig 143 — the SAME path the tablet uses) stores the amount
      // on the SESSION and splits it proportionally across the unpaid orders, each clamped to its
      // OWN subtotal. That is clamp-safe, partial-payment safe, and mutually exclusive with a
      // tablet-entered bill discount (so a manager discount can no longer be silently reverted — B5).
      // Money off a bill is a money-lowering change, so it goes in the AUDIT as well as the
      // activity log (owner, 2026-08-02: "even though it is a discount and all that, in the audit
      // section everything should be there"). Removing a discount PUTS money back, so it is not
      // recorded as a removal — the activity log carries that.
      const auditDiscount = async (amount: number, orderId: string, sessionId: string | null) => {
        if (!(amount > 0)) return;
        await recordRemoval({
          rid, kind: "discount_given",
          // The note the manager typed IS the reason for a discount, so it becomes the reason when
          // no explicit reason_code/-note was sent.
          reason: { code: reasonFromBody(body).code, note: reasonFromBody(body).note || note },
          user: g.user, deviceId: dev, orderId, sessionId, amount,
          meta: { discount: amount },
        });
      };
      if (cur.session_id) {
        // Capped at the BILL's taxable base (mig 270). lfh_staff_bill_discount splits the
        // amount across the session's unpaid orders and clamps each to its own SUBTOTAL, which
        // predates the split and would let a discount eat an MRP line. Clamping here, before
        // the RPC, is what keeps the cap true for the whole bill; on a bill with nothing
        // untaxed the two numbers are identical, so no existing restaurant sees a change.
        const sib = (must(await sb.from("orders").select("subtotal, taxable_base, mrp_amount, status").eq("session_id", cur.session_id).eq("restaurant_id", rid)) || []) as
          (OrderMoney & { status?: string })[];
        const billBase = sib.reduce((acc, o) => acc + (o.status === "cancelled" ? 0 : discountBaseOf(o, discRate)), 0);
        const amount = Number.isFinite(raw) ? Math.round(Math.min(Math.max(raw, 0), billBase) * 100) / 100 : 0;
        const res = must(await sb.rpc("lfh_staff_bill_discount", { p_session: cur.session_id, p_amount: amount, p_note: note }));
        await log("manager", "order_discount", { restaurant_id: rid, order_id: b, detail: amount > 0 ? `bill discount ₹${amount}${note ? ` · ${note}` : ""}` : "discount removed", device_id: dev });
        // The RPC clamps + splits across the bill's unpaid orders, so record what it actually
        // stored rather than what was asked for.
        await auditDiscount(Number((res as { discount?: number } | null)?.discount ?? amount) || 0, b, cur.session_id);
        return ok({ ok: true, discount: (res && (res as { discount?: number }).discount) ?? amount });
      }
      // Legacy standalone order (no table session): keep the per-order write, capped at its OWN
      // pre-tax TAXABLE base (a lone order can't carry more discount than its taxable food
      // value, and an MRP line inside it is a final price — mig 270).
      const amount = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), discBase) : 0;
      must(await sb.from("orders").update({ discount: amount, discount_note: note }).eq("id", b).eq("restaurant_id", rid));
      await log("manager", "order_discount", { restaurant_id: rid, order_id: b, detail: amount > 0 ? `discount ₹${amount}${note ? ` · ${note}` : ""}` : "discount removed", device_id: dev });
      await auditDiscount(amount, b, null);
      return ok({ ok: true });
    }
    // orders/:id/allergies — staff edit of the order-wide "avoid" list (add a
    // missed allergen, fix a wrong one). Stored on orders.allergies; the kitchen/
    // tablet distribute it onto every dish as "NO X". Free-form strings allowed
    // (guests can type "other"), trimmed + de-duped + capped. (owner, 2026-06-16)
    if (a === "orders" && c === "allergies") {
      const raw = Array.isArray(body?.allergies) ? body.allergies : [];
      const allergies = [...new Set(raw.map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      // Diff the OLD order-wide list so the per-dish markers stay right: an order-wide
      // allergen distributes onto every dish, so an add/remove here marks ＋ / ✎− on
      // ALL the order's items (same rules as the per-dish endpoint).
      const prev = must(await sb.from("orders").select("allergies").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      // The row was READ but never checked (sweep 2026-08-05): a vanished order took the same path
      // and answered ok:true, so an allergen typed onto a just-voided or just-moved ticket was
      // accepted on screen and written nowhere. Same refusal as every sibling on this endpoint family.
      if (!prev) return err("That order isn't there anymore — refresh.", 404);
      const oldOW = new Set((Array.isArray(prev.allergies) ? prev.allergies : []).map((x: any) => String(x).toLowerCase()));
      const addedOW = allergies.filter((s) => !oldOW.has(s));
      const removedOW = [...oldOW].filter((s) => !allergies.includes(s));
      must(await sb.from("orders").update({ allergies, edited_at: nowIso() }).eq("id", b).eq("restaurant_id", rid));
      if (addedOW.length || removedOW.length) {
        const items = must(await sb.from("order_items").select("id, added_allergens, removed_flag").eq("order_id", b).eq("restaurant_id", rid));
        for (const it of items) {
          const mark = new Set((Array.isArray(it.added_allergens) ? it.added_allergens : []).map((x: any) => String(x).toLowerCase()));
          let rf = !!it.removed_flag;
          for (const s of addedOW) mark.add(s);
          for (const s of removedOW) { if (mark.has(s)) mark.delete(s); else rf = true; }
          await sb.from("order_items").update({ added_allergens: [...mark], removed_flag: rf }).eq("id", it.id).eq("restaurant_id", rid);
        }
      }
      const detail = [addedOW.length ? `added ${addedOW.join(", ")}` : "", removedOW.length ? `removed ${removedOW.join(", ")}` : ""].filter(Boolean).join("; ") || (allergies.join(", ") || "(none)");
      await log("editor", "order_allergies", { restaurant_id: rid, order_id: b, detail, device_id: dev });
      return ok({ ok: true });
    }
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());

      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      // return=minimal: client re-fetches the board → skip both the .select() and the full-row re-read.
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("restaurant_id", rid).eq("status", "received");
      await log("editor", "order_accept", { restaurant_id: rid, order_id: b, device_id: dev });
      return ok({ ok: true });
    }
    if (a === "orders" && c === "serve-all") {
      const cur = must(await sb.from("orders").select("items,status").eq("id", b).eq("restaurant_id", rid).single());
      // A VOIDED TICKET MAY NOT BE SERVED BACK TO LIFE (sweep 2026-08-04). This handler wrote
      // status='served' with no look at what the order currently is, so a cancelled order handed
      // to it silently stopped being cancelled — the void vanished from the record and the money
      // rejoined the bill (isUnpaidBill matches anything not cancelled / not received / not paid).
      // The ONE sanctioned un-cancel is PATCH /orders/:id → 'received': it is limited to 30
      // minutes from cancelled_at and writes an Audit row. This path had neither, which made it a
      // way to un-void a sale with no trace — exactly what the billing-compliance rules forbid.
      // Refused with a reason a person can act on; the manager panel also filters these out now,
      // so this is the backstop for every other caller (offline replay, the tablet, a future one).
      if (cur.status === "cancelled") return err("That ticket was voided — restore it first if it should be served.", 409);
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: "served" })) : [];
      must(await sb.from("orders").update({ items, status: "served" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "served", served_at: nowIso() }).eq("order_id", b).eq("restaurant_id", rid).neq("status", "served");
      await log("editor", "order_serve", { restaurant_id: rid, order_id: b, device_id: dev });
      // Only session_id is needed (for auto-settle); the client discards the body → not the full row.
      const servedRow = must(await sb.from("orders").select("session_id").eq("id", b).eq("restaurant_id", rid).single());
      return ok({ ok: true });
    }
    if (a === "orders" && c === "item") {
      const idx = Number(body && body.index);
      const status = body && body.status;
      if (!["received", "preparing", "served"].includes(status)) return err("invalid status");
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());
      const items = Array.isArray(cur.items) ? cur.items : [];
      if (!items[idx]) return err("bad item index");
      items[idx] = { ...items[idx], status };

      const servedCount = items.filter((i: any) => i.status === "served").length;

      const orderStatus = servedCount === items.length ? "served"
        : items.some((i: any) => i.status === "preparing" || i.status === "served") ? "preparing" : "received";
      // Only session_id is needed (for auto-settle); the client discards the body.
      const row = must(await sb.from("orders").update({ items, status: orderStatus }).eq("id", b).eq("restaurant_id", rid).select("session_id"));
      return ok({ ok: true });
    }

    // sessions/open — was 4 sequential DB round-trips (table_count check, existing-session
    // check, insert-or-update, approve requests); now ONE, via lfh_staff_open_table
    // (migration 114 — mirrors lfh_staff_open_all_tables' single-round-trip pattern for
    // the single-table case). Cut the "tap Open → table shows as open" latency roughly
    // in half (owner report, 2026-07-02 — felt like a 5+ second lag).
    if (a === "sessions" && b === "open") {
      const table = String((body && body.table) || "").trim();
      if (!table) return err("table required");
      if (!/^\d+$/.test(table) || Number(table) < 1) return err("invalid table number");
      const { data, error } = await sb.rpc("lfh_staff_open_table", { p_restaurant_id: rid, p_table: table });
      if (error) throw new Error(error.message);
      if (data && data.error) return err(data.error);
      await log("editor", "table_open", { restaurant_id: rid, table_number: table, device_id: dev });
      return ok(data || null);
    }

    // ── "OPEN ALL / CLOSE ALL TABLES" IS GONE (owner, 2026-08-04) ──────────────────────────
    // The panel's "⬆ Open all / ⬇ Close all" card was removed on 2026-07-31 once the lifecycle
    // stopped needing it (the first order starts the party; a person taps ✓ Close to end it —
    // mig 254, "no table ends itself"). These two endpoints were left behind with no caller,
    // and the owner's call is that the option should not exist at all: "we don't even need
    // close every table and all that stuff. So remove that option completely."
    //
    // Removing them rather than leaving them is the right shape. lfh_staff_close_all_tables
    // walked every open session, closed it, and with force=true cancelled food still cooking
    // and bills still unpaid — the most destructive action in the product, reachable over HTTP
    // from no screen at all. Both RPCs are dropped by migration 268.
    //
    // Their activity-log labels ("Opened every table" / "Closed every table") deliberately STAY
    // in the panel + admin label maps: old staff_actions rows still carry those codes, and the
    // log has to keep reading as English rather than leaking a raw key.

    // sessions/:id/close | auto-approve | shift
    // Uses the SHARED closeSession so the manager's rule is identical to the tablet's
    // (blocked on unpaid OR still-cooking unless force). The manager needs no PIN —
    // they're already the manager; force=true is their "close anyway" override.
    if (a === "sessions" && c === "close") {
      const result = await closeSession(b, { force: !!(body && body.force === true) }, { panel: "editor", deviceId: dev, restaurantId: rid, user: g.user, reason: reasonFromBody(body) });
      // Carry the REASON CODE, not just the sentence. The panel used to decide whether to
      // offer "close anyway" by searching the message for the words "owes money" — so the
      // cooking-only refusal ("still has orders cooking — serve them, or close anyway")
      // matched nothing and the override button never appeared, leaving the table stuck.
      // reason is 'unpaid' | 'cooking' | 'both' | 'not_found' (lib/sessionClose.ts).
      if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: result.status });
      return ok(result.session);
    }
    if (a === "sessions" && c === "auto-approve") {
      const value = !!(body && body.value === true);
      // .eq(restaurant_id, rid) is the tenant boundary (service-role bypasses RLS) — the
      // same rule applied to order/dish writes; a foreign session id can't be flipped.
      const row = must(await sb.from("sessions").update({ auto_approve: value }).eq("id", b).eq("restaurant_id", rid).select());
      // The table closed while the toggle was on screen — the setting had nowhere to land, and saying
      // "saved" would be a lie. Matches the waiter's twin. (twin-parity pass, 2026-08-07)
      if (!row[0]) return err("That table has closed — the setting wasn't saved.", 404);
      await log("editor", "auto_approve", { restaurant_id: rid, detail: value ? "on" : "off", device_id: dev });
      return ok(row[0]);
    }
    // sessions/:id/invoice — GENERATE the tax invoice (assign a permanent number, lock the
    // bill). Server-authoritative. A RE-issue (after a void) carries a reason and is REFUSED
    // once the bill is settled (mig 189 enforces both — the invoice locks at settlement).
    if (a === "sessions" && c === "invoice") {
      // "Generate bills" is a row on the Access screen and now genuinely bites. It never did:
      // the switch wrote manager_permissions.print_invoice and NOTHING read it, so a manager it
      // was switched off for could still issue a numbered tax invoice (found 2026-08-01).
      // Default is ON, so no restaurant changes until an admin deliberately turns it off.
      if (!(await managerCan(g, rid, "print_invoice"))) return permDenied("generate bills");
      // lfh_generate_invoice has no tenant param — confirm the session is THIS restaurant's
      // first (service-role bypasses RLS; a foreign session id must not get an invoice).
      const ownsGen = must(await sb.from("sessions").select("id, table_number, bill_no").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as
        { id: string; table_number: string | null; bill_no: number | null } | null;
      if (!ownsGen) return err("That table isn't for this restaurant.", 404);
      // The bill is made out to a named customer (mig 227). When the restaurant requires it,
      // NO invoice is issued without a mobile + name — enforced here, not just in the UI, so
      // a stale panel or a direct call can't skip it. Saved before the number is assigned, so
      // an issued invoice always carries its customer.
      const custSave = await saveBillCustomer(sb, rid, b as string, body);
      if (!custSave.ok) return err(custSave.message, 400);
      let genReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      // ── the AFTER half of a reopen ────────────────────────────────────────────────────────
      // A reopen records what the bill was worth when it was reopened. Until now nothing recorded
      // what it became — so a bill reopened to ADD food showed only the lower, earlier number and
      // the trail read as if money had gone missing (owner, 2026-08-05: "before and after will
      // also be shown in the audit section"). Read the last reopen for this bill; if there is
      // one, this issue is the "after", so capture both sides. Only on a re-issue, so a normal
      // first bill costs nothing.
      // The timestamp column on deletion_audit is `at`, NOT `created_at` (migration 251). Asking
      // for created_at made this select fail silently, so `reopened` was always falsy and the
      // before/after row was never written — invisible in code review, caught the first time a
      // real bill was driven through the server (T15, 2026-08-05).
      const priorVoid = (await sb.from("deletion_audit")
        .select("id, at, reason_code, reason_note, meta")
        .eq("restaurant_id", rid).eq("session_id", b).eq("kind", "invoice_voided")
        .order("at", { ascending: false }).limit(1)).data as
          { id: number; at: string; reason_code: string | null; reason_note: string | null; meta: Record<string, unknown> | null }[] | null;
      const reopened = priorVoid && priorVoid[0];
      // THE REASON COMES FROM THE REOPEN, NOT FROM A SECOND QUESTION (owner, 2026-08-19:
      // "reprinting should also not ask any question"). The panel used to stop on Print and demand
      // a typed re-issue reason — the same question the reopen picker had already REQUIRED one step
      // earlier, worded as if pressing Print were itself a reopen. The prompt is gone, so the
      // record takes the answer he actually gave: this bill was reopened for <reason>, therefore
      // it is being re-issued for <reason>. Nothing about the trail gets thinner, and a caller that
      // does send its own reason still wins.
      // The typed note if there is one, otherwise the picked reason in plain words ("add items").
      const reopenWhy = (reopened?.reason_note || "").trim() || (reopened?.reason_code || "").replace(/_/g, " ").trim();
      if (!genReason && reopenWhy) genReason = `Reopened: ${reopenWhy}`.slice(0, 200);
      const { data, error } = await sb.rpc("lfh_generate_invoice", { p_session: b, p_reason: genReason || null, p_actor: actorName });
      if (error) {
        if (error.code === "LFH01" || /invoice locked/i.test(error.message)) return err("This bill is settled — its invoice can't be reopened. Make a credit note instead.", 409);
        // A CANCELLED SALE TAKES NO INVOICE NUMBER (mig 331, owner 2026-08-16). The RPC refuses
        // before the counter is touched, so a refused request never burns a number; this only
        // turns its code into the sentence a manager reads.
        if (error.code === "LFH02" || /cancelled sale never takes an invoice/i.test(error.message)) {
          return err("This bill was cancelled — a cancelled sale never gets a tax invoice.", 409);
        }
        throw pgError(error);
      }
      // Say WHICH table and bill, not the session's uuid. The Activity log's "Where" column read
      // `session dce216b5-72d7-4ba2-…` — a value that identifies nothing to the person reading it
      // (2026-08-03). table_number also fills the column the log row renders on its own.
      await log("editor", "invoice_generate", {
        restaurant_id: rid, table_number: ownsGen.table_number ?? null,
        detail: `Bill #${ownsGen.bill_no ?? "?"}` + (genReason ? ` · ${genReason}` : ""), device_id: dev,
      });
      // If this bill had been reopened, write the before → after so the Audit can be read as one
      // story instead of two unrelated rows.
      if (reopened) {
        const afterRows = (await sb.from("orders").select("total, discount").eq("session_id", b).eq("restaurant_id", rid)).data as
          { total: number | null; discount: number | null }[] | null;
        const nowTotal = (afterRows || []).reduce((t, o) => t + (Number(o.total) || 0), 0);
        const nowDiscount = (afterRows || []).reduce((t, o) => t + (Number(o.discount) || 0), 0);
        const wasT = Number((reopened.meta || {}).total_at_reopen) || 0;
        const wasD = Number((reopened.meta || {}).discount_at_reopen) || 0;
        const wasN = Number((reopened.meta || {}).orders_on_bill) || 0;
        const delta = Math.round((nowTotal - wasT) * 100) / 100;
        // Plain words first — this is what a person reads before they open the detail.
        const moved = delta > 0 ? `₹${delta} MORE` : delta < 0 ? `₹${Math.abs(delta)} LESS` : "no change in value";
        await recordRemoval({
          rid, kind: "bill_changed_after_reopen", reason: reasonFromBody(body), user: g.user, deviceId: dev,
          sessionId: b, tableNumber: ownsGen.table_number ?? null, amount: Math.abs(delta),
          meta: {
            summary: `Reopened at ₹${wasT}, re-issued at ₹${nowTotal} — ${moved}`,
            before: { total: wasT, discount: wasD, orders: wasN },
            after: { total: nowTotal, discount: nowDiscount, orders: (afterRows || []).length },
            change: { total: delta, discount: Math.round((nowDiscount - wasD) * 100) / 100, orders: (afterRows || []).length - wasN },
            reopened_at: reopened.at, reopen_audit_id: reopened.id,
            reissue_reason: genReason || null,
          },
        });
      }
      return ok(Array.isArray(data) ? data[0] : data);
    }
    // sessions/:id/reopen-table — PUT THE TABLE BACK, not the bill (owner, 2026-08-26).
    //
    // "You should reopen table not the bill … if the table has already taken the order, it
    //  shouldn't be able to reopen. If the table is free, then only it should be able to reopen,
    //  and after reopen you can add the order to that particular bill, you can't delete."
    //
    // The sibling above (void-invoice) reopens a bill that is still LIVE, for edits before it is
    // paid. This one is the other case: a party that paid, left, and came back. The bill is closed
    // and settled; the table is free; they want one more coffee. Until now the app's only answer
    // was a credit note, which is a refund document, not a way to sell them a coffee.
    //
    // Every rule lives in the RPC (mig 365) so all three doors obey it — the table must be free,
    // there must be a real sale to come back to, the invoice number is retired rather than reused,
    // and nothing is un-paid. The route's job is the permission, the tenant boundary, the reason,
    // and turning the RPC's codes into sentences a person can act on.
    if (a === "sessions" && c === "reopen-table") {
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("reopen a bill");
      const ownsRe = must(await sb.from("sessions").select("id,status,invoice_no,invoice_voided,table_number,bill_no").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as
        { id: string; status?: string | null; invoice_no?: string | null; invoice_voided?: boolean | null; table_number?: string | null; bill_no?: number | null } | null;
      if (!ownsRe) return err("That table isn't for this restaurant.", 404);
      if (ownsRe.status === "open") return err("This bill is already open — the table is live right now.", 409);
      const reReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      if (!reReason) return err("A reason is required to reopen a table.", 400);
      const { data: reData, error: reErr } = await sb.rpc("lfh_reopen_table", { p_session: b, p_reason: reReason, p_actor: actorName });
      if (reErr) {
        if (reErr.code === "LFH03" || /another party is sitting/i.test(reErr.message))
          return err(`Someone else is sitting at ${ownsRe.table_number ? "T" + ownsRe.table_number : "that table"} right now. The table has to be free before this bill can come back to it.`, 409);
        if (reErr.code === "LFH04" || /nothing to reopen/i.test(reErr.message))
          return err("Every KOT on this bill was cancelled, so there is no sale to reopen.", 409);
        throw pgError(reErr);
      }
      // The table + bill, never the session uuid — the same rule the sibling handlers follow, so a
      // person reading the Audit sees what they saw on the floor.
      await log("editor", "table_reopened", {
        restaurant_id: rid, table_number: ownsRe.table_number ?? null,
        detail: `Bill #${ownsRe.bill_no ?? "?"}` + (ownsRe.invoice_no ? ` · Invoice ${ownsRe.invoice_no} retired` : "") + ` · ${reReason}`,
        device_id: dev,
      });
      invalidateFloor(rid);
      return ok(reData);
    }

    // sessions/:id/void-invoice — VOID it (reopen the bill for edits; number kept in record).
    // A reason is REQUIRED (owner: every reopen must say why). Refused once settled (mig 189).
    if (a === "sessions" && c === "void-invoice") {
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("void bills");
      // Confirm the session belongs to THIS restaurant before voiding (RPC has no tenant param).
      const ownsVoid = must(await sb.from("sessions").select("id,invoice_at,invoice_no,invoice_voided,table_number,bill_no").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as
        { id: string; invoice_at?: string | null; invoice_no?: string | null; invoice_voided?: boolean | null; table_number?: string | null; bill_no?: number | null } | null;
      if (!ownsVoid) return err("That table isn't for this restaurant.", 404);
      // THERE MUST BE A BILL TO REOPEN (2026-08-03). lfh_void_invoice deliberately no-ops when the
      // session was never invoiced (or is already reopened) — it returns the row unchanged and
      // writes no invoice_event. The route recorded the Audit row anyway, so a tap on a table with
      // no bill answered "done" and put a "Bill reopened · ₹460" line in the Audit for something
      // that never happened. An audit that invents an event is worse than no audit, and a tap that
      // did nothing must never look like it worked. Say so instead, and record nothing.
      if (!ownsVoid.invoice_no)
        return err("This table's bill hasn't been generated yet, so there's nothing to reopen.", 409);
      if (ownsVoid.invoice_voided)
        return err("This bill is already reopened — it's open for edits right now.", 409);
      // "Only within X minutes" (Access → Permission for manager → Reopen a bill; owner default
      // 5 min, 2026-08-02). Enforced HERE for a real MANAGER — until 2026-08-02 the row saved a
      // number nothing read, the dead-switch shape the access rebuild removes. Admin and owner
      // are not clamped, matching every other money gate; the credit-note path below stays open
      // because that IS the way to correct a bill once this window has passed.
      if (g.user && g.user.role === "manager" && ownsVoid.invoice_at) {
        const winCfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
          { void_bills?: { limit?: { minutes?: number } } } | null;
        const stored = Number(winCfg?.void_bills?.limit?.minutes);
        // Nothing stored → the default the Access screen shows (one rule, both sides read it).
        const winMin = Number.isFinite(stored) && stored > 0 ? stored : Number(defOf(NODE_BY_ID["mgr_bill_reopen_mins"])) || 5;
        if (Date.now() - new Date(ownsVoid.invoice_at).getTime() > winMin * 60_000)
          return err(`This bill closed more than ${winMin} minutes ago, so a manager can no longer reopen it. Make a credit note instead.`, 409);
      }
      const voidReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      if (!voidReason) return err("A reason is required to void / reopen an invoice.", 400);
      // What the bill SAID before it was reopened — the owner's requirement is that the audit
      // shows what it was and what changed, so the figures at reopen time are captured here.
      const beforeVoid = (await sb.from("orders").select("total, discount").eq("session_id", b).eq("restaurant_id", rid)).data as
        { total: number | null; discount: number | null }[] | null;
      const wasTotal = (beforeVoid || []).reduce((s, o) => s + (Number(o.total) || 0), 0);
      const wasDiscount = (beforeVoid || []).reduce((s, o) => s + (Number(o.discount) || 0), 0);
      const { data, error } = await sb.rpc("lfh_void_invoice", { p_session: b, p_reason: voidReason, p_actor: actorName });
      if (error) { if (error.code === "LFH01" || /invoice locked/i.test(error.message)) return err("This bill is settled — its invoice can't be reopened. Make a credit note instead.", 409); throw pgError(error); }
      // The table + bill, never the session uuid (see invoice_generate above).
      await log("editor", "invoice_void", {
        restaurant_id: rid, table_number: ownsVoid.table_number ?? null,
        detail: `Bill #${ownsVoid.bill_no ?? "?"}` + (ownsVoid.invoice_no ? ` · Invoice ${ownsVoid.invoice_no}` : "") + ` · ${voidReason}`,
        device_id: dev,
      });
      // Into the AUDIT too (it was named by migration 251 and never written until 2026-08-02).
      // `amount` is what the bill stood at when it was reopened, so a later change is visible as a
      // difference rather than having to be reconstructed.
      await recordRemoval({
        rid, kind: "invoice_voided", reason: reasonFromBody(body), user: g.user, deviceId: dev,
        sessionId: b, amount: wasTotal,
        meta: { total_at_reopen: wasTotal, discount_at_reopen: wasDiscount, orders_on_bill: (beforeVoid || []).length },
      });
      return ok(Array.isArray(data) ? data[0] : data);
    }
    // sessions/:id/credit-note — issue a CREDIT NOTE against a bill (the legal correction
    // path once the invoice/bill is settled and locked; mig 194). Money action → void_bills.
    // The bill is NEVER edited — a new, numbered, immutable credit document is recorded.
    if (a === "sessions" && c === "credit-note") {
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("issue credit notes");
      const ownsCn = must(await sb.from("sessions").select("id, table_number, bill_no").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as
        { id: string; table_number: string | null; bill_no: number | null } | null;
      if (!ownsCn) return err("That table isn't for this restaurant.", 404);
      const cnAmount = Math.round((Number(body?.amount) || 0) * 100) / 100;
      const cnReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      if (cnAmount <= 0) return err("Enter a credit amount greater than zero.", 400);
      if (!cnReason) return err("A reason is required to issue a credit note.", 400);
      const { data: cnData, error: cnErr } = await sb.rpc("lfh_issue_credit_note", { p_session: b, p_amount: cnAmount, p_reason: cnReason, p_actor: actorName });
      if (cnErr) { if (cnErr.code === "LFH02" || /cannot exceed/i.test(cnErr.message)) return err("The credit can't be more than the bill total.", 409); throw pgError(cnErr); }
      const cnRow = Array.isArray(cnData) ? cnData[0] : cnData;
      // Table + bill, never the session uuid (same rule as invoice_generate / invoice_void).
      await log("editor", "credit_note", {
        restaurant_id: rid, order_id: undefined, table_number: ownsCn.table_number ?? null,
        detail: `Bill #${ownsCn.bill_no ?? "?"} · credit ₹${cnAmount} · ${cnReason}`, device_id: dev,
      });
      return ok(cnRow);
    }
    if (a === "sessions" && c === "shift") {
      // "Change table" IS a table operation and must follow the same ladder as its four siblings
      // (sweep 2026-08-05). It is the FIRST item in the panel's 🧾 KOT ▾ menu and the whole button
      // is drawn only when tableOpsOn() — so until now, hiding it was the ONLY guard: with
      // Table & KOT operations switched off for the restaurant, a stale tab (or any direct call)
      // could still move a whole party — session, orders, calls and bill — onto another table.
      // orders/:id/move, sessions/:id/merge, tables/:t/pay-split and order-items/:id/move have
      // always called this; the waiter tablet's twin was fixed for exactly this reason
      // (tablet route: "it was ungated before, so a restaurant with table-ops set to PIN/off
      // could still shift parties from the tablet") and the manager side was never given the
      // same pass. tableOpsGate lets the admin super-user through, so the X-ray stays honest.
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      const to = String((body && body.to) || "").trim();
      // Validate the destination is a plain positive integer (the RPC trusts whatever arrives).
      if (!/^\d+$/.test(to) || Number(to) < 1) return err("Pick a valid table to move to.", 400);
      // lfh_staff_shift_table takes no tenant param — confirm the session belongs to THIS
      // restaurant AND the target is within its table count before shifting (service-role
      // bypasses RLS; a foreign session id or an out-of-range table must be refused).
      const [ownsShift, setRow] = await Promise.all([
        sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle(),
        sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle(),
      ]);
      if (!must(ownsShift)) return err("That table isn't for this restaurant.", 404);
      const tableCount = Number((must(setRow) || {}).table_count) || 0;
      if (tableCount && Number(to) > tableCount) return err("That table number is out of range.", 400);
      const { data, error } = await sb.rpc("lfh_staff_shift_table", { p_session: b, p_to: to });
      if (error) throw new Error(error.message);
      await log("editor", "table_shift", { restaurant_id: rid, detail: "→ table " + to, device_id: dev });
      return ok(data);
    }

    // orders/:id/move — move ONE order (a single KOT) and its dish rows to another
    // table, leaving the rest of the party's bill behind. Part of the KOT ▾ menu
    // (ladder-gated, mig 172); the whole-party variant is sessions/:id/shift above.
    // The RPC (mig 173) is atomic, re-splits both bills' discounts and nudges BOTH
    // tables' tiles — the same shared implementation the tablet route calls.
    if (a === "orders" && c === "move") {
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to) || Number(to) < 1) return err("Pick a valid table to move to.", 400);
      // Reject a target table that doesn't exist (1..table_count) — the RPC checks
      // digits/occupancy but doesn't know the restaurant's table count.
      const setRowMv = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const tableCountMv = Number((must(setRowMv) || {}).table_count) || 0;
      if (tableCountMv && Number(to) > tableCountMv) return err("That table number is out of range.", 400);
      const { data, error } = await sb.rpc("lfh_staff_move_order", { p_order: b, p_to: to, p_rid: rid });
      if (error) throw new Error(error.message);
      if (data && (data as { ok?: boolean }).ok === false) return err(moveErrMsg((data as { reason?: string }).reason), 409);
      await log("editor", "order_move", { restaurant_id: rid, order_id: b, detail: "KOT → table " + to, device_id: dev });
      return ok(data);
    }

    // sessions/:id/merge — MERGE this table's party into an OCCUPIED table: one table,
    // one bill (KOT ▾ menu; the complement of shift, which needs a FREE target).
    // The RPC (mig 174) moves orders/items/calls/members/cart, sums + re-splits the
    // discounts, closes the source session, and nudges both tables' tiles.
    if (a === "sessions" && c === "merge") {
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to) || Number(to) < 1) return err("Pick a valid table to merge into.", 400);
      const [ownsMerge, setRowMg] = await Promise.all([
        sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle(),
        sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle(),
      ]);
      if (!must(ownsMerge)) return err("That table isn't for this restaurant.", 404);
      const tableCountMg = Number((must(setRowMg) || {}).table_count) || 0;
      if (tableCountMg && Number(to) > tableCountMg) return err("That table number is out of range.", 400);
      // WHO joined them (mig 308). The record has carried merged_by since mig 249, but the actor was
      // read from a session GUC nothing ever set, so every merge row said NULL — on the one action
      // that puts two tables' money onto a single bill. Passed as a parameter now, exactly the way
      // the unmerge half a few hundred lines below already does it.
      const { data, error } = await sb.rpc("lfh_staff_merge_tables", {
        p_session: b, p_to: to, p_rid: rid,
        p_actor: g.user?.username || g.user?.role || "manager",
        p_actor_id: g.user?.id ?? null,
      });
      if (error) throw new Error(error.message);
      if (data && (data as { ok?: boolean }).ok === false) return err(mergeErrMsg((data as { reason?: string }).reason), 409);
      // The RPC decides which table survives (the LOWER number always), so log what it actually
      // did rather than what was asked for, and stamp WHO on the merge record — the owner wants
      // both directions findable: "if you want to find who does it and who did it, we can able to
      // find very quickly".
      const md = (data || {}) as { from?: string; to?: string; parent_table?: string; child_table?: string };
      const actor = g.user?.username || g.user?.role || "manager";
      if (md.child_table) {
        await sb.from("table_merges").update({ merged_by: actor, merged_by_id: g.user?.id ?? null })
          .eq("restaurant_id", rid).eq("child_table", md.child_table).is("ended_at", null);
      }
      invalidateFloor(rid);
      await log("editor", "table_merge", { restaurant_id: rid, table_number: md.parent_table ?? to,
        detail: `T${md.child_table ?? md.from} merged into T${md.parent_table ?? to} — one party, one bill`, device_id: dev });
      return ok(data);
    }

    // tables/:t/pay-split — settle the whole bill as SEVERAL payment legs (equal /
    // custom / by-dish shares computed client-side; KOT ▾ menu, mig 176). The bill
    // stays ONE bill: orders are marked paid once (method 'Split'), the legs land in
    // session_payments for the money trail. Σ legs must equal the due (±2p) — the
    // server recomputes the due itself, never trusting the client's number.
    if (a === "tables" && c === "pay-split") {
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      // Splitting a bill SETTLES money, so it needs the same permission as a plain "Mark paid" —
      // otherwise switching mark_paid off would leave the split route as a way round it.
      if (!(await managerCan(g, rid, "mark_paid"))) return permDenied("mark a bill paid");
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // A merged child's bill lives on its parent — split the PARTY's bill (lib/tableMerge).
      const t = await mergeParentTable(sb, rid, tRaw);
      // The arithmetic + the write live in lib/paySplit.ts, shared with the waiter tablet, so
      // the two panels can never disagree about what a split bill does (owner, 2026-08-02).
      // Un-accepted (received) orders stay OUT of the scope — the same graceful rule as
      // mark-paid: settle the accepted part, leave a just-added order to be accepted and paid
      // separately (was: a 409 the client could never satisfy — owner deep-QA 2026-07-23).
      const splitParts = Array.isArray(body?.splits) ? body.splits : [];
      // A PAY-LATER PART IS STILL PAY-LATER (mig 352). It needs the khata module AND the khata
      // power on top of mark_paid — otherwise a split would be a way round both, which is exactly
      // the hole the mark_paid line above closes for the money half.
      if (splitParts.some((s: { method?: unknown }) => String(s?.method) === PAY_LATER)) {
        if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
        if (!(await managerCan(g, rid, "khata"))) return permDenied("put part of a bill on a tab");
      }
      const rSp = await settleBillInParts(sb, { rid, table: t, splits: splitParts });
      if (!rSp.ok) return err(rSp.message, rSp.status);
      // A tab leaves the bill UNPAID and in the book, so the table has to be closed the same way
      // the whole-bill Pay Later button closes it — orders were archived by the settle first, so
      // the close's cook-guard cancels nothing.
      if (rSp.parked && rSp.sessionId) {
        const closed = await closeSession(rSp.sessionId, { force: true }, { panel: "editor", deviceId: dev, restaurantId: rid, user: g.user, reason: reasonFromBody(body) });
        if (!closed.ok) return err(closed.message, closed.status);
      }
      await log("editor", "bill_split", { restaurant_id: rid, table_number: t, detail: rSp.note.slice(0, 120), device_id: dev });
      // The tab itself is a khata event, so it reads in the book's own history too, not only as a split.
      if (rSp.parked && rSp.customer) {
        await log("editor", "khata_park", { restaurant_id: rid, table_number: t, detail: `₹${rSp.owed.toFixed(0)} of a split → ${rSp.customer.name} (₹${rSp.collected.toFixed(0)} collected)`, device_id: dev });
      }
      return ok({ ok: true, count: rSp.count, due: rSp.due, parked: rSp.parked, owed: rSp.owed, collected: rSp.collected, customer: rSp.customer });
    }

    // order-items/:id/move — move ONE dish line to another table (KOT ▾ menu; the
    // finest-grained transfer). Lands under a FRESH KOT on the target; both bills
    // re-price server-side (mig 175).
    if (a === "order-items" && c === "move") {
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to) || Number(to) < 1) return err("Pick a valid table to move to.", 400);
      const setRowIm = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const tableCountIm = Number((must(setRowIm) || {}).table_count) || 0;
      if (tableCountIm && Number(to) > tableCountIm) return err("That table number is out of range.", 400);
      const { data, error } = await sb.rpc("lfh_staff_move_order_item", { p_item: b, p_to: to, p_rid: rid });
      if (error) throw new Error(error.message);
      if (data && (data as { ok?: boolean }).ok === false) return err(moveErrMsg((data as { reason?: string }).reason), 409);
      await log("editor", "order_item_move", { restaurant_id: rid, detail: `dish → table ${to} (new KOT)`, device_id: dev });
      return ok(data);
    }

    // members/:id/approve | remove | make-head
    if (a === "members" && c === "approve") {
      // rid-scoped like every by-id write (service-role bypasses RLS → this is the boundary).
      const row = must(await sb.from("session_members").update({ approved: true }).eq("id", b).eq("restaurant_id", rid).select());
      // A TAP THAT MOVED NOTHING MUST NOT REPORT SUCCESS (twin-parity pass, 2026-08-07). The waiter's
      // identical endpoint was given this on 2026-08-06 and the manager's was left behind — exactly the
      // drift `npm run verify:twins` now exists to catch. The guest left the party (or the table closed)
      // between the paint and the tap; 200 here told the manager they had let someone in.
      if (!row[0]) return err("That guest is no longer on this table — refresh and try again.", 404);
      return ok(row[0]);
    }
    if (a === "members" && c === "remove") {
      const row = must(await sb.from("session_members").update({ removed: true }).eq("id", b).eq("restaurant_id", rid).select());
      if (!row[0]) return err("That guest is no longer on this table — refresh and try again.", 404);
      // ...and it is LOGGED, like the waiter's twin: kicking someone off a table is a thing a person
      // did to another person, and "who removed this guest?" had no answer on this side. (2026-08-07)
      await log("editor", "member_remove", { restaurant_id: rid, detail: "kicked", device_id: dev });
      return ok(row[0]);
    }
    if (a === "members" && c === "make-head") {
      const found = must(await sb.from("session_members").select("id,session_id,role,removed").eq("id", b).eq("restaurant_id", rid).limit(1));
      const m = found[0];
      if (!m) return err("member not found", 404);
      const sessRows = must(await sb.from("sessions").select("status").eq("id", m.session_id).eq("restaurant_id", rid).limit(1));
      if (!sessRows[0] || sessRows[0].status !== "open") return err("table is not open");
      if (m.role === "owner" && !m.removed) return ok(m);
      must(await sb.from("session_members").update({ removed: true }).eq("session_id", m.session_id).eq("restaurant_id", rid).eq("role", "owner").eq("removed", false).select());
      const row = must(await sb.from("session_members").update({ role: "owner", approved: true, removed: false }).eq("id", m.id).eq("restaurant_id", rid).select());
      return ok(row[0] || null);
    }

    // items/:id/delete — remove ONE dish (order_item) from a table's order and
    // reconcile the bill. CRITICAL (money): orders.total is a stored server-priced
    // number, so we DON'T just delete the row — the lfh_delete_order_item RPC
    // deletes it AND recomputes the order's subtotal/tax/total from the remaining
    // dishes (and cancels the order if it's now empty), all in one transaction.
    // The RPC refuses to touch a PAID bill. Returns { ok, items_left, total, ... }.
    if (a === "items" && c === "delete") {
      if (await invoiceLockedByItem(b, rid)) return err(LOCKED_MSG, 409);
      // Confirm the dish belongs to THIS restaurant before the RPC (which looks it up by id alone) —
      // the same tenant boundary the sibling money endpoints enforce. (B15 scoping consistency.)
      // Read what it WAS before the RPC deletes it: the Audit row has to name the dish and what it
      // was worth, and after the delete there is nothing left to look up (2026-08-02).
      const gone = (await sb.from("order_items").select("id, title, qty, unit_price, order_id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data as
        { id: string; title: string | null; qty: number | null; unit_price: number | null; order_id: string | null } | null;
      if (!gone) return err("That dish was already removed.", 404);
      const { data, error } = await sb.rpc("lfh_delete_order_item", { p_item_id: b });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) {
        const reason = data.reason || "could not delete";
        const msg = reason === "order_paid"
          ? "Won't change a PAID bill — mark it unpaid first."
          : reason === "item_not_found"
            ? "That dish was already removed."
            : reason;
        return err(msg, reason === "order_paid" ? 409 : 400);
      }
      await log("editor", "order_item_delete", { restaurant_id: rid, order_id: data?.order_id, detail: data?.order_cancelled ? "order emptied → cancelled" : `dish removed, ${data?.items_left} left`, device_id: dev });
      // …and into the AUDIT, which is where a person looks for "what was taken off, and why".
      // The dish's own worth, not the order's total: this is one line off a bill.
      await recordRemoval({
        rid, kind: "dish_removed", reason: reasonFromBody(body), user: g.user, deviceId: dev,
        orderId: data?.order_id ?? gone.order_id, itemId: gone.id, itemTitle: gone.title, qty: gone.qty,
        amount: (Number(gone.unit_price) || 0) * (Number(gone.qty) || 1),
        meta: { items_left: data?.items_left ?? null, order_cancelled: !!data?.order_cancelled },
      });
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/qty — STAFF EDIT: change ONE dish's quantity on a PLACED order.
    // Money-safe: the RPC clamps 1..99, updates the row, then re-prices the bill
    // from order_items (orders.total is a stored server-priced number). Refuses a
    // PAID/cancelled order. (owner, 2026-06-17 — gated behind the UI confirm.)
    if (a === "items" && c === "qty") {
      if (await invoiceLockedByItem(b, rid)) return err(LOCKED_MSG, 409);
      const qty = Math.round(Number(body?.qty));
      if (!Number.isFinite(qty) || qty < 1) return err("invalid quantity");
      // What it was, so the Audit row can say 3 → 1 rather than just "1" (owner: "whatever the
      // changes that previously it was there and he has made").
      const wasRow = (await sb.from("order_items").select("id, title, qty, unit_price").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data as
        { id: string; title: string | null; qty: number | null; unit_price: number | null } | null;
      if (!wasRow) return err("That dish was already removed.", 404); // B15 scoping
      const { data, error } = await sb.rpc("lfh_staff_edit_item_qty", { p_item: b, p_qty: qty });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("editor", "order_item_qty", { restaurant_id: rid, order_id: data?.order_id, detail: `qty → ${data?.qty}`, device_id: dev });
      // Lowering a quantity takes money off the bill exactly like removing the dish, so it is
      // recorded the same way. Raising one adds money and is not a removal — the activity log
      // above still carries it.
      const wasQty = Number(wasRow.qty) || 0;
      if (qty < wasQty) {
        await recordRemoval({
          rid, kind: "qty_reduced", reason: reasonFromBody(body), user: g.user, deviceId: dev,
          orderId: data?.order_id ?? null, itemId: wasRow.id, itemTitle: wasRow.title, qty: wasQty - qty,
          amount: (Number(wasRow.unit_price) || 0) * (wasQty - qty),
          meta: { qty_before: wasQty, qty_after: qty },
        });
      }
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/note — STAFF EDIT: change ONE dish's note on a PLACED order.
    if (a === "items" && c === "note") {
      if (!(await sb.from("order_items").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data) return err("That dish was already removed.", 404); // B15 scoping
      const { data, error } = await sb.rpc("lfh_staff_edit_item_note", { p_item: b, p_note: String(body?.note ?? "") });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("editor", "order_item_note", { restaurant_id: rid, order_id: data?.order_id, device_id: dev });
      // EDITING AFTER THE BILL IS ALLOWED, AND RECORDED (owner, 2026-08-13). Only when the bill was
      // already SETTLED — an edit before that is ordinary work and the activity log already has it.
      // Risk level `record`, never `money`: mig 312 patches just this line's note and touches no
      // total, tax or discount (auditsort.js KIND_RISK / SQL lfh_audit_risk).
      if (data?.settled) {
        await recordRemoval({
          rid, kind: "bill_annotated", user: g.user, deviceId: dev,
          orderId: data?.order_id, itemId: b,
          reason: reasonFromBody(body),
          meta: { field: "note", note_now: data?.note ?? null },
        });
      }
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/removed — STAFF EDIT: change ONE dish's removed/allergen list ("NO X")
    // on a PLACED order — add a missed allergen on just this dish, or UNDO one added by
    // mistake (the order-wide list has its own endpoint above). Removals don't change
    // the price, so a direct table write (service-role, already gated) is enough.
    // Allowed at ANY dish/order status (owner, 2026-07-03 — "allergy can be added to
    // all items"): unlike qty, this never touches money, so served/ready/paid is fine.
    // Still refused for a cancelled order — nothing was ever served, nothing to annotate.
    if (a === "items" && c === "removed") {
      const raw = Array.isArray(body?.removed) ? body.removed : [];
      const removed = [...new Set(raw.map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      // Fetch the CURRENT state so we can diff old→new and keep the per-dish edit
      // markers: which allergens were ADDED after placement (added_allergens, → a "＋"
      // beside each) and whether one was REMOVED (removed_flag, → a "✎−" on the name).
      // maybeSingle: a stale id returns null so the friendly "dish not found" 400 fires.
      const item = must(await sb.from("order_items").select("id, order_id, removed, added_allergens, removed_flag, status").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!item) return err(editErrMsg("item_not_found"), 400);
      // MERGE NOTE: the allergen branch removed the ready/served/paid rejections
      // (edits allowed at ANY status — see header comment); main independently added
      // restaurant_id scoping to this order lookup (tenancy hardening). Both kept.
      const order = must(await sb.from("orders").select("payment_status, status").eq("id", item.order_id).eq("restaurant_id", rid).maybeSingle());
      if (order?.status === "cancelled") return err(editErrMsg("order_cancelled"), 400);
      const oldSet = new Set((Array.isArray(item.removed) ? item.removed : []).map((x: any) => String(x).toLowerCase()));
      const justAdded = removed.filter((s) => !oldSet.has(s));
      const justRemoved = [...oldSet].filter((s) => !removed.includes(s));
      const addedMark = new Set((Array.isArray(item.added_allergens) ? item.added_allergens : []).map((x: any) => String(x).toLowerCase()));
      let removedFlag = !!item.removed_flag;
      for (const s of justAdded) addedMark.add(s);   // staff-added allergen → mark it "added"
      for (const s of justRemoved) { if (addedMark.has(s)) addedMark.delete(s); else removedFlag = true; } // un-mark a re-removed add; else flag a real removal
      const added_allergens = [...addedMark].filter((s) => removed.includes(s)); // keep only ones still present
      const rowU = must(await sb.from("order_items").update({ removed, added_allergens, removed_flag: removedFlag }).eq("id", b).eq("restaurant_id", rid).select());
      const detail = [justAdded.length ? `added ${justAdded.join(", ")}` : "", justRemoved.length ? `removed ${justRemoved.join(", ")}` : ""].filter(Boolean).join("; ") || "no change";
      await log("editor", "order_item_removed", { restaurant_id: rid, order_id: item.order_id, detail, device_id: dev });
      // Same rule as the note above: allowed after the bill, and RECORDED when the bill was already
      // settled — minor, no money (owner, 2026-08-13). `detail` says which allergens moved, so the
      // Audit row can be read without opening the order.
      if (order?.payment_status === "paid" && (justAdded.length || justRemoved.length)) {
        await recordRemoval({
          rid, kind: "bill_annotated", user: g.user, deviceId: dev,
          orderId: item.order_id, itemId: b,
          reason: reasonFromBody(body),
          meta: { field: "allergy", added: justAdded, removed: justRemoved },
        });
      }
      await stampEdited(item.order_id, rid);
      return ok(rowU[0] || { ok: true });
    }

    // orders/:id/add-item — STAFF EDIT: ADD a new dish to an already-placed order.
    // Server-priced (rejects unknown/sold-out), inserted as 'received', then the
    // bill is re-priced. Body: { dishId, qty, options?, removed?, note? }.
    if (a === "orders" && c === "add-item") {
      if (await invoiceLockedByOrder(b, rid)) return err(LOCKED_MSG, 409);
      const dishId = String(body?.dishId || body?.id || "").trim();
      if (!dishId) return err("dish required");
      if (!(await sb.from("orders").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data) return err("That order was not found.", 404); // B15 scoping
      const line = {
        id: dishId,
        qty: Math.max(1, Math.round(Number(body?.qty) || 1)),
        // Staff-typed price for open-price (as-per-MRP) dishes; the RPC's pricer honours it
        // ONLY when the dish is flagged open_price, and clamps it — normal dishes stay DB-priced.
        price: body?.price != null ? String(body.price) : undefined,
        options: Array.isArray(body?.options) ? body.options : undefined,
        removed: Array.isArray(body?.removed) ? body.removed : undefined,
        note: body?.note ? String(body.note) : undefined,
      };
      const { data, error } = await sb.rpc("lfh_staff_add_item_to_order", { p_order: b, p_items: [line] });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("editor", "order_add_item", { restaurant_id: rid, order_id: b, detail: dishId, device_id: dev });
      await stampEdited(b, rid);
      return ok(data);
    }

    // items/:id/status (session order_items)
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "served"].includes(status)) return err("invalid status");
       
      const patch: any = { status };
      // Serving stamps served_at; an undo that sends the dish back must clear it
      // again so the row never keeps a stale served time (owner undo bar, 2026-07-22).
      patch.served_at = status === "served" ? nowIso() : null;
      const updated = must(await sb.from("order_items").update(patch).eq("id", b).eq("restaurant_id", rid).select());
      const item = updated[0];
      // Same fix as the kitchen's items/:id/status (sweep 2026-08-04): the scoped update matches no
      // row when the dish has gone, and answering `ok(null)` with HTTP 200 is a tap that vanished —
      // no caller checks for a null body. Say it plainly instead.
      if (!item) return err("That dish isn't on this order any more — refresh and try again.", 404);
      if (item.order_id) {
        const rows = must(await sb.from("order_items").select("status").eq("order_id", item.order_id).eq("restaurant_id", rid));
        const total = rows.length;

        const served = rows.filter((r: any) => r.status === "served").length;

        const anyActive = rows.some((r: any) => ["preparing", "ready", "served"].includes(r.status));
        const orderStatus = total > 0 && served === total ? "served" : anyActive ? "preparing" : "received";
        await sb.from("orders").update({ status: orderStatus }).eq("id", item.order_id).eq("restaurant_id", rid);
      }
      // Serving a dish is a floor action a person is accountable for, and it was unlogged here while
      // the waiter tablet's identical action has been logged since 2026-07-29.
      await log("editor", "item_status", { restaurant_id: rid, order_id: item.order_id ?? null, detail: status, device_id: dev });
      return ok(item);
    }

    // requests/:id/resolve
    if (a === "requests" && c === "resolve") {
      const status = body && body.status;
      if (!["approved", "denied"].includes(status)) return err("invalid status");
      // Only resolve a STILL-PENDING request (B22): a double-tap or a re-poll re-approve then updates
      // 0 rows (reqRow undefined) and returns cleanly, instead of re-running the open-session insert.
      const reqRow = must(await sb.from("requests").update({ status }).eq("id", b).eq("restaurant_id", rid).eq("status", "pending").select())[0];
      // ALREADY ANSWERED — and the two cases are NOT the same (twin-parity pass, 2026-08-07).
      // The update is scoped `.eq("status","pending")`, so a request somebody already answered matches
      // no row. What happens next depends on WHO answered and HOW:
      //   · same answer  → this is a double-tap or a re-poll of your own action. The outcome you wanted
      //     already holds, so say OK. (That idempotence is deliberate — B22 — and it is what stops a
      //     re-approve running the open-session insert twice.)
      //   · different answer → somebody ELSE decided the other way. Reporting success would hide that:
      //     the waiter taps Approve on a request a colleague just DENIED, is told it worked, and on the
      //     tablet that used to go on to OPEN A TABLE nobody asked for.
      // So: idempotent for your own repeat, refused out loud when the ground actually moved.
      if (!reqRow) {
        const now = must(await sb.from("requests").select("status").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as { status?: string } | null;
        if (!now) return err("That request is no longer there — refresh.", 404);
        if (now.status !== status) return err(`Someone already ${now.status === "approved" ? "approved" : "denied"} that request — refresh to see where it stands.`, 409);
        return ok(null);   // same answer, already recorded — nothing more to do
      }
      if (status === "approved" && reqRow.type === "open") {
        const existing = must(await sb.from("sessions").select("id").eq("table_number", reqRow.table_number).eq("restaurant_id", rid).neq("status", "closed").limit(1));
        if (!existing.length) {
          // A concurrent open (two waiters, or a waiter tap-open racing the guest's own open) can both
          // pass the check above; the one-open-session-per-table unique index (mig 082) rejects the
          // loser. Treat that as success ("already open") rather than a raw duplicate-key 500. (B22)
          const ins = { error: await openTableSession(rid, String(reqRow.table_number)).then(() => null).catch((e: unknown) => ({ message: e instanceof Error ? e.message : String(e) })) }; // race-tolerant (2026-07-30)
          if (ins.error && !/duplicate|unique/i.test(ins.error.message)) throw new Error(ins.error.message);
        }
      }
      return ok(reqRow || null);
    }

    // blocklist (add)
    // tables/:t/restart — clear the round off the floor but KEEP the table open (fresh party). ONE
    // atomic server call: archive the round (served + archived, NOT cancelled), release the party's
    // members, CLEAR the table's live signals (open waiter-calls + pending requests) so no ghost 🔔
    // remains, and reopen a session if sessions are on. The manager panel used to do this as a
    // client loop that never cleared the signals → a stuck bell on the emptied table. (B12)
    if (a === "tables" && c === "restart") {
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // THIS CLEARS A TABLE THAT MAY STILL OWE MONEY, SO IT NEEDS THE SAME POWER AS ITS
      // SIBLINGS (sweep 2026-08-04). It had no permission check at all, while cancelling ONE
      // ticket needs void_bills (whose own description is "…or closing a table unpaid after a
      // walk-out") and deleting a bill needs void_bills + canDeleteBill. Clearing the WHOLE
      // table needed nothing. Default is ON, so nothing changes for a restaurant that hasn't
      // deliberately taken the power away.
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("clear a table that still owes money");
      // A merged child's party lives on its parent — restart clears the whole party (lib/tableMerge).
      const t = await mergeParentTable(sb, rid, tRaw);
      const openSess = (await sb.from("sessions").select("id").eq("table_number", t).eq("status", "open").eq("restaurant_id", rid).order("last_activity_at", { ascending: false }).limit(1)).data?.[0] as { id: string } | undefined;
      // WHAT WAS STILL OWED, READ BEFORE THE ROWS ARE ARCHIVED (sweep 2026-08-04).
      // closeSession() deliberately reads this first so a walk-out is recorded as
      // "closed with N unpaid order(s), ₹X owed"; this path archived the rows itself, so the
      // mig-232 close trigger (which only looks at archived = false) then found nothing to
      // cancel and NO money line was ever written. The bill stayed in the takings as unpaid
      // with nothing naming the amount or the person who cleared it. Same action code
      // (close_unpaid) and the same discount-aware math as lib/sessionClose.ts, so the
      // compliance surfaces pick it up with no changes.
      let owedQ = sb.from("orders").select("total,discount,subtotal,tax")
        .eq("restaurant_id", rid).eq("archived", false).neq("status", "cancelled").neq("payment_status", "paid");
      owedQ = openSess ? owedQ.eq("session_id", openSess.id) : owedQ.eq("table_number", t);
      const owedRows = (must(await owedQ) || []) as { total?: number; discount?: number; subtotal?: number; tax?: number }[];
      if (owedRows.length) {
        // Discount is stored PRE-TAX, so what is actually owed drops by discount×(1+rate);
        // each order's own rate comes from its stored tax/subtotal (correct per restaurant).
        const owed = owedRows.reduce((s, o) => {
          const sub = Number(o.subtotal) || 0, tax = Number(o.tax) || 0;
          const rate = sub > 0 ? tax / sub : 0;
          return s + (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate);
        }, 0);
        await log("manager", "close_unpaid", { restaurant_id: rid, table_number: t, detail: `table cleared with ${owedRows.length} unpaid ${owedRows.length === 1 ? "order" : "orders"}, ₹${Math.round(owed * 100) / 100} owed`, device_id: dev });
      }
      let q = sb.from("orders").update({ status: "served", archived: true, archived_at: nowIso() }).neq("status", "cancelled").eq("archived", false).eq("restaurant_id", rid);
      q = openSess ? q.eq("session_id", openSess.id) : q.eq("table_number", t);
      const rows = must(await q.select());
      if (openSess) must(await sb.from("session_members").update({ removed: true }).eq("session_id", openSess.id).eq("removed", false).select());
      await clearTableSignals(rid, t); // the B12 fix — no ghost waiter-call bell on the emptied table
      // NO FRESH EMPTY PARTY (owner, 2026-08-01). This line used to open a new session so the
      // table stayed "open, waiting for guests" — a state no screen can show since open/close was
      // removed, which is exactly how he found table 30 reading Free on the floor and open in the
      // database. The party now ENDS with its round: the table is free, on both sides.
      if (openSess) must(await sb.from("sessions").update({ status: "closed", closed_at: nowIso(), last_activity_at: nowIso() }).eq("id", openSess.id).select());
      await log("manager", "table_restart", { restaurant_id: rid, table_number: t, detail: `${rows.length} ${rows.length === 1 ? "order" : "orders"} cleared`, device_id: dev });
      return ok({ ok: true, count: rows.length });
    }

    // tables/:t/unmerge — separate THIS table from the party it was merged into (mig 249).
    // Reached only from the CHILD table (owner: "you can only unmerge by clicking on the seven
    // number table"). The RPC does the work and returns what moved, so the panel's confirm can
    // have already told the truth before anyone tapped; the log records who split which tables.
    if (a === "tables" && c === "unmerge") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      // Was the PERSON half only (managerCan) with no MODULE rung (sweep 2026-08-05) — so with
      // Table & KOT operations switched off for the restaurant, an OWNER (who passes every
      // managerCan power automatically) could still split a merged party. tableOpsGate is both
      // rungs in one call, exactly as its four siblings use it. Splitting and merging are the
      // same feature; they must answer to the same switch.
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      const actor = g.user?.username || g.user?.role || "manager";
      const { data, error } = await sb.rpc("lfh_staff_unmerge_table", { p_rid: rid, p_child: t, p_actor: actor });
      if (error) throw new Error(error.message);
      const r = (data || {}) as { ok?: boolean; reason?: string; parent?: string; moved?: number; kots?: string | null };
      if (r.ok === false) {
        // A printed bill covers both tables — it has to be voided before they can be separated.
        return NextResponse.json({ error: r.reason === "invoiced"
          ? "This bill has already been invoiced. Reopen (void) the invoice first, then split the tables."
          : r.reason === "not_merged" ? "That table isn't merged with another one."
          : "Couldn't split those tables.", reason: r.reason }, { status: 409 });
      }
      invalidateFloor(rid);
      await log("manager", "table_unmerge", { restaurant_id: rid, table_number: t,
        detail: `split from T${r.parent ?? "?"} · ${r.moved ?? 0} ${(r.moved ?? 0) === 1 ? "order" : "orders"} returned${r.kots ? ` (KOT ${r.kots})` : ""}`, device_id: dev });
      return ok({ ok: true, ...r });
    }

    // ── Table types (VIP / Family / Owner's Guest) + khata — mig 166 ─────────────
    // tables/:t/tag — mark or clear a table's special type. body { tag: 'vip'|'family'|
    // 'guest' } to mark, { tag: null } to clear. Feature-laddered + table_tags power.
    if (a === "tables" && c === "tag") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      if (g.user && !(await tableTagsLadder(rid)).effective) return err("Table types aren't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "table_tags"))) return permDenied("mark tables");
      const tag = body?.tag ?? null;
      if (tag === null || tag === "") {
        must(await sb.from("table_tags").delete().eq("restaurant_id", rid).eq("table_number", t).select());
        await log("manager", "table_tag_clear", { restaurant_id: rid, table_number: t, device_id: dev });
        return ok({ ok: true, tag: "" });
      }
      if (!isTableTag(tag)) return err("invalid tag");
      must(await sb.from("table_tags")
        .upsert({ restaurant_id: rid, table_number: t, tag, tagged_by: actorName || "admin", tagged_at: nowIso() }, { onConflict: "restaurant_id,table_number" })
        .select());
      await log("manager", "table_tag_set", { restaurant_id: rid, table_number: t, detail: tag, device_id: dev });
      return ok({ ok: true, tag });
    }

    // tables/:t/on-the-house — settle a Family / Owner's-Guest table at no charge:
    // 100% pre-tax discount per order (the SAME stored shape as a whole-bill discount,
    // so every money view — already net-of-discount, paid-only — reads ₹0 with no
    // changes) + mark paid under the reserved "On the house" method (the report keys
    // on it). Same accept rule as mark-paid: nothing still 'received'.
    if (a === "tables" && c === "on-the-house") {
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // The comp settles the PARTY's bill — resolve a merged child to the table holding it.
      const t = await mergeParentTable(sb, rid, tRaw);
      if (g.user && !(await tableTagsLadder(rid)).effective) return err("Table types aren't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "table_tags"))) return permDenied("settle a bill on the house");
      // SETTLING A BILL IS SETTLING A BILL, WHATEVER BUTTON IT CAME FROM (sweep 2026-08-04).
      // This writes payment_status='paid' + paid_at + a payment method, so it reads the same
      // permission as a plain Mark paid, in the same shape as tables/:t/pay-split beside it.
      //
      // BE HONEST ABOUT WHAT THIS DOES TODAY: `mark_paid` has NO row on the Access screen. The
      // owner took take_orders / mark_paid / print_invoice / table_tags / table_ops out of the
      // grant list on 2026-08-01 — "how the floor RUNS; a restaurant that switched them off could
      // not trade" — so managerGrantValue() answers ON for it permanently and a stored
      // manager_permissions.mark_paid is ignored. This gate can therefore only ever fire on the
      // feature rung (access_config.mark_paid.on), which nothing writes. It is a guard in waiting,
      // consistent with its three siblings, NOT a hole being closed: there was no way round
      // Mark-paid, because Mark-paid cannot be switched off. What actually protects this action is
      // the table_tags ladder above. (I first reported this as a live gap; it was not. The gate is
      // kept because the day a row returns, every settle path should honour it at once.)
      if (!(await managerCan(g, rid, "mark_paid"))) return permDenied("mark a bill paid");
      // The mark may sit on ANY member of a merged party — the family sat at T29 before it was
      // joined to T28; their comp must not stop working because the bill now lives on T28.
      const partyKids = ((await sb.from("table_merges").select("child_table")
        .eq("restaurant_id", rid).eq("parent_table", t).is("ended_at", null).limit(20)).data || []) as { child_table: string }[];
      const tagRows = ((await sb.from("table_tags").select("tag")
        .eq("restaurant_id", rid).in("table_number", [t, ...partyKids.map((k) => k.child_table)])).data || []) as { tag?: TableTag }[];
      const tagRow = tagRows.find((r) => r.tag && COMP_TAGS.includes(r.tag)) || null;
      if (!tagRow) return err("On the house is only for tables marked Family or Owner's Guest.", 409);
      const openSess = (await sb.from("sessions").select("id").eq("table_number", t).eq("status", "open").eq("restaurant_id", rid).order("last_activity_at", { ascending: false }).limit(1)).data?.[0] as { id: string } | undefined;
      let oq = sb.from("orders").select("id,subtotal,status,payment_status").eq("restaurant_id", rid).eq("archived", false).neq("status", "cancelled");
      oq = openSess ? oq.eq("session_id", openSess.id) : oq.eq("table_number", t);
      const orders = must(await oq) as { id: string; subtotal: number; status: string; payment_status: string }[];
      const unpaid = orders.filter((o) => o.payment_status !== "paid");
      if (!unpaid.length) return err("Nothing to settle on this table.", 409);
      if (unpaid.some((o) => o.status === "received")) return err("Accept the order first — a bill can only be settled once the order is accepted.", 409);
      for (const o of unpaid) {
        must(await sb.from("orders").update({
          discount: Number(o.subtotal) || 0, discount_note: "On the house",
          payment_status: "paid", paid_at: nowIso(), payment_method: ON_THE_HOUSE_METHOD,
        }).eq("id", o.id).eq("restaurant_id", rid).select("id"));
      }
      await log("manager", "on_the_house", { restaurant_id: rid, table_number: t, detail: `${unpaid.length} ${unpaid.length === 1 ? "order" : "orders"} · ${tagRow.tag}`, device_id: dev });
      // Settling with no money collected is the largest money-lowering action there is, so it
      // gets an Audit row per order, naming what each was worth (2026-08-02).
      for (const o of unpaid) {
        await recordRemoval({
          rid, kind: "on_the_house", reason: { code: reasonFromBody(body).code, note: reasonFromBody(body).note || `On the house · ${tagRow.tag}` },
          user: g.user, deviceId: dev, orderId: o.id, tableNumber: t, amount: Number(o.subtotal) || 0,
          meta: { table_tag: tagRow.tag, orders_on_bill: unpaid.length },
        });
      }
      return ok({ ok: true, count: unpaid.length });
    }

    // tables/:t/khata — "Collect later": park the table's unpaid bill on a PERSON and
    // free the table. body { customer_id } OR { name, phone?, note? } (adds the person).
    // Orders keep payment_status='pending' but gain khata markers, so they leave the
    // pending-bills warnings and live in the khata book until collected. The close
    // itself reuses closeSession(force) — orders were archived here first, so nothing
    // gets cancelled by the close's cook-guard.
    if (a === "tables" && c === "khata") {
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // Parking "collect later" parks the PARTY's bill — resolve a merged child first.
      const t = await mergeParentTable(sb, rid, tRaw);
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("park bills to collect later");
      const openSess = (await sb.from("sessions").select("id").eq("table_number", t).eq("status", "open").eq("restaurant_id", rid).order("last_activity_at", { ascending: false }).limit(1)).data?.[0] as { id: string } | undefined;
      let kq = sb.from("orders").select("id,status,payment_status").eq("restaurant_id", rid).eq("archived", false).neq("status", "cancelled");
      kq = openSess ? kq.eq("session_id", openSess.id) : kq.eq("table_number", t);
      const korders = must(await kq) as { id: string; status: string; payment_status: string }[];
      const kunpaid = korders.filter((o) => o.payment_status !== "paid");
      if (!kunpaid.length) return err("Nothing unpaid to park on this table.", 409);
      if (korders.some((o) => o.status === "received" || o.status === "preparing"))
        return err("This table still has orders cooking — serve them first, then park the bill.", 409);
      // Resolve the person: existing id, or create (a phone that already exists reuses
      // that person — the picker's search should catch it, this is the race-safe net).
      let customer: { id: string; name: string; phone: string | null } | null = null;
      if (body?.customer_id) {
        customer = (await sb.from("khata_customers").select("id,name,phone").eq("restaurant_id", rid).eq("id", String(body.customer_id)).maybeSingle()).data as any;
        if (!customer) return err("That person isn't in this restaurant's khata book.", 404);
      } else {
        const name = String(body?.name || "").trim().slice(0, 80);
        if (!name) return err("A name is required to park a bill.");
        const phone = String(body?.phone || "").trim().slice(0, 20) || null;
        const note = String(body?.note || "").trim().slice(0, 200) || null;
        if (phone) customer = (await sb.from("khata_customers").select("id,name,phone").eq("restaurant_id", rid).eq("phone", phone).maybeSingle()).data as any;
        if (!customer) {
          const ins = await sb.from("khata_customers").insert({ restaurant_id: rid, name, phone, note }).select("id,name,phone");
          if (ins.error) return err(ins.error.message, 500);
          customer = (ins.data as any[])[0];
        }
      }
      const stamp = nowIso();
      // Mark + archive the unpaid orders in one update (archived = off the live floor;
      // khata_at = in the book). Paid orders on the same bill just archive via the close.
      must(await sb.from("orders").update({ khata_at: stamp, khata_customer_id: customer!.id, archived: true, archived_at: stamp })
        .in("id", kunpaid.map((o) => o.id)).eq("restaurant_id", rid).select("id"));
      if (openSess) {
        const closed = await closeSession(openSess.id, { force: true }, { panel: "editor", deviceId: dev, restaurantId: rid, user: g.user, reason: reasonFromBody(body) });
        if (!closed.ok) return err(closed.message, closed.status);
      } else {
        await clearTableSignals(rid, t);
      }
      await log("manager", "khata_park", { restaurant_id: rid, table_number: t, detail: `${kunpaid.length} ${kunpaid.length === 1 ? "order" : "orders"} → ${customer!.name}`, device_id: dev });
      return ok({ ok: true, customer, count: kunpaid.length });
    }

    // khata/customers — add a person to the book directly (the picker's "add new").
    if (a === "khata" && b === "customers" && !c) {
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("use the khata book");
      const name = String(body?.name || "").trim().slice(0, 80);
      if (!name) return err("name required");
      const phone = String(body?.phone || "").trim().slice(0, 20) || null;
      const note = String(body?.note || "").trim().slice(0, 200) || null;
      if (phone) {
        const existing = (await sb.from("khata_customers").select("id,name,phone,note").eq("restaurant_id", rid).eq("phone", phone).maybeSingle()).data;
        if (existing) return ok({ customer: existing, existed: true });
      }
      const ins = await sb.from("khata_customers").insert({ restaurant_id: rid, name, phone, note }).select("id,name,phone,note");
      if (ins.error) return err(ins.error.message, 500);
      return ok({ customer: (ins.data as any[])[0], existed: false });
    }

    // khata/pay — collect a parked bill. body { session_id } (a bill) or { order_id }
    // (a solo parked order), + { method, note? }. Normal payment methods only.
    if (a === "khata" && b === "pay") {
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("collect khata payments");
      // Collecting a parked tab MARKS ORDERS PAID, so it reads the settle permission too, in the
      // same shape as its siblings. It is INERT today for the reason spelled out at the
      // on-the-house gate (mark_paid has no Access row and cannot be switched off) — the khata
      // ladder above is what actually protects this action. Kept so that if a Mark-paid row ever
      // returns, every path that settles money honours it on the same day.
      if (!(await managerCan(g, rid, "mark_paid"))) return permDenied("mark a bill paid");
      const method = String(body?.method || "");
      if (!PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) return err("invalid payment_method");
      const note = String(body?.note || "").slice(0, 200) || null;
      let pq = sb.from("orders").update({ payment_status: "paid", paid_at: nowIso(), payment_method: method, payment_note: note })
        .eq("restaurant_id", rid).not("khata_at", "is", null).neq("payment_status", "paid").neq("status", "cancelled");
      if (body?.session_id) pq = pq.eq("session_id", String(body.session_id));
      else if (body?.order_id) pq = pq.eq("id", String(body.order_id));
      else return err("session_id or order_id required");
      const paidRows = must(await pq.select("id,table_number,session_id")) as { id: string; table_number: string; session_id: string | null }[];
      if (!paidRows.length) return err("Nothing outstanding on that bill.", 409);
      // A TAB TAKEN AS PART OF A SPLIT IS NOW REAL MONEY (mig 352). When only part of a bill went on
      // the tab, that part is a session_payments row still marked owed. Marking the orders paid
      // clears the DEBT, but left alone the money trail would keep saying "₹121 Pay later" for a
      // bill that has since been collected in cash — so the part is stamped settled and re-labelled
      // with the way the money actually arrived. The person it was owed by stays on the row, which
      // is what makes "this was Ravi's tab, collected in cash" readable afterwards.
      const paidSessions = [...new Set(paidRows.map((r) => r.session_id).filter(Boolean))] as string[];
      if (paidSessions.length) {
        try {
          await sb.from("session_payments")
            .update({ settled_at: nowIso(), method, note: note || "collected from the pay-later book" })
            .in("session_id", paidSessions).eq("restaurant_id", rid)
            .not("khata_customer_id", "is", null).is("settled_at", null).is("reversed_at", null);
        } catch { /* the debt is already cleared by the orders above; the label is best-effort */ }
      }
      await log("manager", "khata_collect", { restaurant_id: rid, table_number: paidRows[0]?.table_number ?? null, detail: `${paidRows.length} ${paidRows.length === 1 ? "order" : "orders"} · ${method}`, device_id: dev });
      return ok({ ok: true, count: paidRows.length });
    }

    if (a === "blocklist" && path.length === 1) {
      const table = body.table ? String(body.table).trim() : null;
      let phone = body.phone ? String(body.phone).trim() : null;
      let device = body.device_id ? String(body.device_id).trim() : null; // block a staff device (tablet/kitchen)
      const memberId = body.member_id || null;
      if (!phone && !table && !device && !memberId) return err("phone, table, device_id, or member_id required");
      // Banning a specific member → also pull THEIR guest device id (and phone) so the
      // ban targets the device the guest actually uses, not just a phone they may never
      // have given. This is what makes the guest "you're blocked" wall stick. (077)
      if (memberId && !device) {
        const m = (await sb.from("session_members").select("device_id, phone").eq("id", memberId).eq("restaurant_id", rid).maybeSingle()).data as { device_id?: string | null; phone?: string | null } | null;
        if (m?.device_id) device = m.device_id;
        if (!phone && m?.phone) phone = m.phone;
      }
      const row = must(await sb.from("blocklist").insert({ phone, table_number: table, device_id: device, member_id: memberId, reason: body.reason || "banned", restaurant_id: rid }).select())[0];
      // Kick the banned guest from their seat in the SAME request (B23) — the manager panel used to
      // do this as a separate client call, so a network blip could leave them banned-but-still-seated.
      if (memberId) await sb.from("session_members").update({ removed: true }).eq("id", memberId).eq("restaurant_id", rid);
      if (phone) await sb.from("customers").upsert({ phone, blocked: true, restaurant_id: rid }, { onConflict: "restaurant_id,phone" });
      // Record WHO banned WHAT in the Log (accountability). Describe the target type only —
      // never write the raw phone number into the log (no PII in the audit trail).
      const banTarget = [table ? `table ${table}` : "", phone ? "a phone" : "", device ? "a device" : "", memberId ? "a guest" : ""].filter(Boolean).join(", ") || "a guest";
      await log("editor", "blocklist_add", { restaurant_id: rid, detail: `banned ${banTarget}${body.reason ? ` · ${String(body.reason).slice(0, 60)}` : ""}`, device_id: dev });
      return ok(row || null);
    }

    // ── PRINT RELIABILITY (mig 269, owner 2026-08-04) ────────────────────────────────
    // BEFORE the generic /:kind upsert below — that block answers every unknown
    // single-segment POST itself (404 "unknown kind"), so anything after it is unreachable.
    // print-jobs — "Reprint in kitchen": the manager's reprint becomes a ROW the kitchen
    // screen claims and prints (with the DUPLICATE banner). Nothing prints here. Rides the
    // outbox + withIdempotency like every editor write, so a reprint tapped offline reaches
    // the kitchen exactly once when the connection returns.
    if (a === "print-jobs" && path.length === 1) {
      const orderId = String(body?.order_id || "");
      if (!orderId) return err("Missing order id — refresh and try again.");
      const o = must(await sb.from("orders").select("id, status, kot_no, deleted_at").eq("id", orderId).eq("restaurant_id", rid).maybeSingle());
      if (!o) return err("That KOT isn't on this restaurant's board any more.", 404);
      if (o.status === "cancelled") return err("That KOT was cancelled — there is nothing to reprint.");
      // A TOMBSTONED KOT IS NOT COOKED AGAIN (2026-08-11, T7 finding F11). The cancelled guard was
      // here and its other half was not, so an order removed from the books could still be pushed
      // to the kitchen printer — and a cook reading the ticket has no way to know. A soft delete
      // never removes the row (that is the point of lib/softDelete.ts), so the kitchen side's
      // `.filter((j) => j.order)` could not catch it either; both halves are checked now.
      if (o.deleted_at) return err("That KOT was deleted — it can't be sent to the kitchen.");
      must(await sb.from("print_jobs").insert({
        restaurant_id: rid, kind: "kot", order_id: orderId, reprint: true,
        requested_by: actorName || "Manager",
      }));
      await log("editor", "kot_reprint_sent", { order_id: orderId, detail: `KOT #${o.kot_no ?? "—"}`, device_id: dev, restaurant_id: rid });
      return ok({ ok: true });
    }

    // ── print-jobs/claim + /done — the manager screen as a printer (owner, 2026-08-17) ──────────
    // The same two steps the kitchen screen has always used, on the same shared implementation
    // (lib/printQueue.ts): win the row with ONE filtered UPDATE, print, then say what happened. A
    // claim is a PLAIN fetch on the panel side, never the offline outbox — a claim replayed hours
    // later would print a stale ticket behind everyone's back — while the done report does ride the
    // outbox, because it is idempotent and losing it would let the 2-minute reclaim reprint.
    if (a === "print-jobs" && b === "claim") {
      const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(String).slice(0, 20) : [];
      if (!ids.length) return ok({ won: [] });
      // WHO MAY PRINT IS RE-ASKED HERE, not taken from the caller. A counter screen left open from
      // before the admin changed the setting would otherwise keep claiming tickets the kitchen is
      // now supposed to print — the classic "the screen said yes, the server says no" fault.
      const t = await counterPrintTarget(rid);
      // …and the PERSON's own permission, and the ROUTE's own choice of panel/person/device. Three
      // separate questions, all re-asked here rather than trusted from the caller: is this person
      // allowed to be a printer at all (accessTree "print_here"), and is this the screen the owner
      // actually named on the Printing menu.
      const tgtK = await targetsFor(rid, ["kot"]);
      const mayK = screenMayPrint(tgtK.kot, { panel: "manager", personId: g.user?.id || null, deviceId: deviceIdFrom(req) });
      const allowedToPrint = g.user ? await managerCan(g, rid, "print_here") : true;
      if (!allowedToPrint) return ok({ won: [], refused: "not_allowed" });
      if (!mayK.ok) return ok({ won: [], refused: mayK.why === "computer" ? "helper" : mayK.why, printTarget: tgtK.kot });
      const gate = await mayClaim(rid, {
        deviceId: deviceIdFrom(req), panel: "editor", label: "Counter · manager screen",
        auto: t.mayPrint, roomAllowed: t.mayPrint, by: actorName || null,
      });
      if (!gate.ok) return ok({ won: [], refused: gate.reason, station: gate.station });
      return ok({ won: await claimKotJobs(rid, ids, { minAgeMs: 0 }), station: gate.station });
    }

    if (a === "print-jobs" && c === "done") {
      const okPrint = !!(body && body.ok === true);
      const r = await finishKotJob(rid, String(b), okPrint, body?.error ? String(body.error) : undefined);
      if (!r.found) return err("That print job is gone.", 404);
      // Same two diary lines the kitchen writes, so the Activity log reads the same whichever screen
      // the paper came out of — it names the panel, and that is the only difference.
      if (okPrint) {
        await log("editor", "kot_printed", {
          order_id: r.orderId, table_number: r.tableNumber, device_id: dev, restaurant_id: rid,
          detail: `${r.reprint ? "reprinted" : "printed"} KOT${r.kotNo != null ? ` #${r.kotNo}` : ""} on this screen`,
        });
        return ok({ ok: true });
      }
      await log("editor", "kot_print_failed", {
        order_id: r.orderId, device_id: dev, restaurant_id: rid,
        level: r.parked ? "warn" : "info",
        detail: r.parked
          ? `gave up after ${r.attempts} tries — ${String(body?.error || "print failed").slice(0, 120)}`
          : `try ${r.attempts} failed — ${String(body?.error || "print failed").slice(0, 120)}`,
      });
      return ok({ ok: true, attempts: r.attempts });
    }

    // ── SETTING THE PRINTERS UP, FROM THE COMPUTER THAT HAS THEM (mig 367) ──────────────────────
    //
    // Every verb below asks managerCan("print_setup") FIRST, before it reads or writes a single row.
    // The screen hides the buttons too, but that is decoration: this is the gate.
    //
    // AND EVERY VERB IS SCOPED TO THIS BROWSER'S OWN COMPUTER. A person with the permission can set
    // up the machine they are sitting at and route paper to it; they cannot rename, re-code or
    // remove another restaurant's machine, or another machine in their own restaurant. Anything
    // wider than "this computer" stays with the admin, which is what the owner asked for — the
    // device does the setting up, Aevidine keeps the whole board.
    if (a === "printing") {
      if (g.user && !(await managerCan(g, rid, "print_setup"))) return permDenied("set the printers up");
      const dv = deviceIdFrom(req);
      if (!dv) return err("This browser has no device id yet — reload the page and try again.", 400);

      // ── "This is the computer with the printer" ───────────────────────────────────────────────
      // Registers THIS browser's machine and hands back the one-time code. A second call from the
      // same browser does not make a second computer: it renames the one it already has, because a
      // person pressing the button twice means "I am setting this machine up", not "I have two".
      if (b === "this-computer") {
        const name = String((body as Record<string, unknown>)?.name || "").trim().slice(0, 60)
          || (g.user?.name || g.user?.username || "This computer");
        // ── "I AM THAT COMPUTER" ─────────────────────────────────────────────────────────────
        // The link between a browser and its helper is the panel's own device id, and a device id
        // does not survive a cleared browser, a new profile, or a machine that was set up from the
        // admin console in the first place. Without a way back, the person sitting at the printer
        // would see "this computer is not set up yet" beside a helper that is plainly running, and
        // the only way out would be a SECOND registration of the same machine — two rows, one
        // printer, and half the tickets in the wrong room.
        //
        // So a computer can be adopted: pick the one you are sitting at, and this browser becomes
        // its screen. It never steals a machine from another live browser silently — the row's old
        // device is replaced, and the change is audited like every other printing change.
        const adopt = String((body as Record<string, unknown>)?.adopt || "");
        if (adopt) {
          const row = (await sb.from("print_agents").select("id, name").eq("id", adopt)
            .eq("restaurant_id", rid).is("revoked_at", null).maybeSingle()).data as { id: string; name: string } | null;
          if (!row) return err("That computer is not one of this restaurant's.", 404);
          await sb.from("print_agents").update({ owner_device: dv, owner_user: g.user?.id || null })
            .eq("id", row.id).eq("restaurant_id", rid);
          await logAction("editor", "print_routes_changed", {
            restaurant_id: rid, device_id: dv,
            ...(g.user ? {} : { actor: "Aevidine admin", actor_id: ADMIN_VIEW_ACTOR_ID }),
            detail: `this screen now manages the computer “${row.name}”`,
          });
          return ok({ adopted: true, id: row.id, name: row.name });
        }
        const mine = await agentForDevice(rid, dv);
        if (mine) {
          if (name !== mine.name) {
            const up = await sb.from("print_agents").update({ name }).eq("id", mine.id).eq("restaurant_id", rid).select("id").maybeSingle();
            if (up.error) return err(up.error.code === "23505" ? "There is already a computer with that name." : "Could not rename it.", 400);
          }
          return ok({ already: true, id: mine.id, name });
        }
        const made = await createAgent(rid, name, { deviceId: dv, userId: g.user?.id || null });
        if ("error" in made) return err(made.error, 400);
        await logAction("editor", "print_helper_added", {
          restaurant_id: rid, device_id: dv,
          ...(g.user ? {} : { actor: "Aevidine admin", actor_id: ADMIN_VIEW_ACTOR_ID }),
          detail: `computer “${name}” set itself up to print`,
        });
        return ok({ id: made.id, name, code: made.token, scripts: panelScriptsFor(originOfReq(req), made.token, name) });
      }

      // ── UNLINK THIS COMPUTER ──────────────────────────────────────────────────────────────────
      // It replaces "newcode" (mig 368). Minting a fresh token to be carried to a machine by hand was
      // the whole ritual the pairing handshake removed, and once the file stopped carrying a token
      // there was nowhere left to show one — a button that mints a credential nothing displays is
      // worse than no button.
      //
      // Re-linking is now ONE path, the same one as a first-time setup: unlink here, double-click the
      // file there, press Allow. Routes pointing at it are emptied in the same breath, because a route
      // naming a machine that can no longer print would leave paper silently unprinted, and an EMPTY
      // line at least says "no printer chosen" on screen.
      if (b === "unlink") {
        const mine = await agentForDevice(rid, dv);
        if (!mine) return err("This computer is not set up here.", 404);
        await sb.from("print_agents").update({ revoked_at: new Date().toISOString() })
          .eq("id", mine.id).eq("restaurant_id", rid);
        const routes = await readRoutes(rid);
        const patch: Record<string, unknown> = {};
        for (const k of ROUTABLE_KINDS) {
          if (routes[k].agent === mine.id) patch[k] = null;   // no backup line to fall back to
        }
        if (Object.keys(patch).length) await writeRoutes(rid, patch);
        await logAction("editor", "print_helper_removed", {
          restaurant_id: rid, device_id: dv,
          ...(g.user ? {} : { actor: "Aevidine admin", actor_id: ADMIN_VIEW_ACTOR_ID }),
          detail: `“${mine.name}” was unlinked and can no longer print`,
        });
        return ok({ ok: true, cleared: Object.keys(patch) });
      }

// ── THE "mode" VERB IS GONE HERE TOO (owner, 2026-08-31) ─────────────────────────────────
      // Same reason as the admin console: there is no mechanism left to choose. A manager who wants
      // the slips on their own screen names themselves on the kitchen-slip line below ("a screen"),
      // which is the same act with one fewer step and no stored copy to contradict it.

            // ── who prints one kind of paper ──────────────────────────────────────────────────────────
      // One line at a time, and only three answers: this computer, a screen, or nobody. A screen
      // route from here always means THIS panel and THIS person — narrowing it to somebody else's
      // screen is an admin act, and letting a manager do it from their own settings would be a way
      // to move another person's paper without telling them.
      if (b === "route") {
        const kind = String((body as Record<string, unknown>)?.kind || "");
        if (!isRoutableKind(kind)) return err("There is no such kind of paper.", 400);
        const who = String((body as Record<string, unknown>)?.who || "");
        const mine = await agentForDevice(rid, dv);
        let patch: Record<string, unknown>;
        if (who === "computer") {
          // WHICH machine, not necessarily THIS one. The board's dropdown is grouped by computer, so
          // a restaurant with two machines can send the bills to the counter and the slips to the
          // kitchen from either screen. It still falls back to this computer when none is named, so
          // the older one-machine flow is unchanged.
          const named = String((body as Record<string, unknown>)?.agent || "");
          const agentId = named || mine?.id || "";
          if (!agentId) return err("Set this computer up first — it has to tell us its printers before it can be given any.", 400);
          const printer = String((body as Record<string, unknown>)?.printer || "");
          if (!printer) return err("Which printer?", 400);
          // NO BACKUP FIELDS (owner, 2026-08-30 — there is no backup printer). This still ACCEPTED
          // `backupAgent` / `backupPrinter` off the request body and wrote them onto the route, weeks
          // after everything that READ them was deleted. Nothing acted on them, so nothing looked
          // wrong: it quietly stamped `backupAgent: null` onto every route it saved, and a caller
          // passing a real one would have had it stored and silently ignored. A field that can still
          // be WRITTEN is not a deleted field — it is a deleted field waiting to be read again.
          // (T25 round 3 found the same two lines independently, an hour later, by re-running four old
          // ledger rows that were still defending the backup printer — P12488, P27231, P27232, P27586.
          // Two lanes, one leftover: the guard that now watches every file is verify:print-queue's
          // twelve-file walk, and verify:print-helper block 8h checks the whole tree including the
          // panels, with the one named shim.)
          patch = {
            agent: agentId, printer,
            paper: (body as Record<string, unknown>)?.paper ?? undefined,
          };
        } else if (who === "screen") {
          // NO `device` HERE, deliberately. A per-paper "On" must produce the SAME shape as naming a
          // person on the admin board — otherwise one line would be narrowed to this one PC and the
          // others not, which is a difference nobody asked for and nothing shows.
          //
          // THE PANEL FOLLOWS THE PERSON, and it is no longer hard-coded (2026-08-31). This said
          // `panel: "manager"` outright, which is the same fault he reported on the admin picker
          // ("choosing a person, there is not kitchen panel available"): writeRoutes then refuses a
          // cook for not being a manager, so a cook pressing "print them on this screen" from the
          // kitchen panel was told their own screen was not the kitchen panel. panelForRole is the
          // one place that answers this, and it answers it for every role that has a screen.
          patch = { via: "screen", panel: panelForRole(g.user?.role), person: g.user?.id || null };
        } else if (who === "off") {
          patch = { via: "off" };
        } else if (who === "none") {
          // "— no printer chosen yet —". A real answer, and a different one from "nobody": the line
          // is simply unanswered again, and every screen says so instead of going quiet.
          patch = null as unknown as Record<string, unknown>;
        } else {
          return err("Say who prints it — this computer, a screen, or nobody.", 400);
        }
        const saved = await writeRoutes(rid, { [kind]: patch });
        if ("error" in saved) return err(saved.error, 400);
        // KITCHEN SLIPS AND auto_print_kot ARE ONE DECISION (see lib/printHelpers → syncKotSwitch).
        // Without this the trigger would keep filling the basket with slips nobody could claim,
        // behind a switch that said off — and the two boards would disagree again, which is the
        // exact fault the owner reported.
        if (kind === "kot") await syncKotSwitch(rid, who !== "off");
        await logAction("editor", "print_routes_changed", {
          restaurant_id: rid, device_id: dv,
          ...(g.user ? {} : { actor: "Aevidine admin", actor_id: ADMIN_VIEW_ACTOR_ID }),
          detail: `${kind === "kot" ? "kitchen slips" : kind === "bill" ? "bills" : "banquet sheets"} → ${
            who === "computer" ? `${String((body as Record<string, unknown>)?.printer || "")} on ${mine?.name || "this computer"}`
              : who === "screen" ? "this screen" : "nobody"}`,
        });
        return ok({ routes: saved.routes });
      }

      // ── a test page on one of THIS computer's printers ────────────────────────────────────────
      if (b === "test") {
        const mine = await agentForDevice(rid, dv);
        if (!mine) return err("Set this computer up first.", 400);
        const printer = String((body as Record<string, unknown>)?.printer || "");
        if (!mine.printers.some((x) => x.name === printer)) return err("This computer has no printer by that name.", 400);
        const q = await queueJob(rid, "test", { by: g.user?.name || g.user?.username || "manager" },
          { requestedBy: "test page", agentId: mine.id, printer });
        if ("error" in q) return err("Could not send the test page.", 500);
        await logAction("editor", "print_test", {
          restaurant_id: rid, device_id: dv,
          ...(g.user ? {} : { actor: "Aevidine admin", actor_id: ADMIN_VIEW_ACTOR_ID }),
          detail: `test page to ${printer}`,
        });
        return ok({ queued: true, note: mine.connected ? `Sent to ${printer}.` : `Saved — it prints as soon as this computer's helper is running.` });
      }

      return err("Unknown printing request.", 404);
    }

    // ── print-station/take · /release — "print HERE instead" from the counter screen (mig 338) ──
    // One tap moves the restaurant's printing to the screen the person is standing at, and the other
    // screen finds out on its next read. Refused when the admin has not opened the counter screen at
    // all, so the button can never promise something the server will not honour.
    if (a === "print-station" && b === "take") {
      const dv2 = deviceIdFrom(req);
      if (!dv2) return err("This browser has no device id yet — reload the panel and try again.", 409);
      const t2 = await counterPrintTarget(rid);
      if (!t2.mayPrint) return err("Kitchen tickets are not set to print on a counter screen. Your admin sets that.", 409);
      const view = await takeStation(rid, { deviceId: dv2, label: "Counter · manager screen", panel: "editor", by: actorName || null });
      await log("editor", "print_station_take", { device_id: dv2, restaurant_id: rid, detail: "this counter screen is now the printer" });
      return ok({ ok: true, station: view });
    }
    if (a === "print-station" && b === "release") {
      const dv3 = deviceIdFrom(req);
      if (dv3) await releaseStation(rid, dv3);
      await log("editor", "print_station_release", { device_id: dv3, restaurant_id: rid, detail: "this counter screen stopped printing" });
      return ok({ ok: true, station: await stationView(rid, dv3) });
    }

    // print-jobs/:id/dismiss — the manager handled a stuck/failed reprint another way
    // (usually "Print here instead"), so it must stop being offered to the kitchen AND
    // stop showing as a problem. Only live states can be dismissed; 'done' stays done.
    if (a === "print-jobs" && c === "dismiss") {
      must(await sb.from("print_jobs").update({ status: "dismissed", done_at: nowIso() })
        .eq("id", b).eq("restaurant_id", rid).in("status", ["queued", "printing", "failed"]));
      return ok({ ok: true });
    }

    // printer-events/:id/resolve — the manager says the printer problem is handled.
    // (The other resolver is automatic: any successful kitchen print closes all open events.)
    if (a === "printer-events" && c === "resolve") {
      must(await sb.from("printer_events").update({ status: "resolved", resolved_at: nowIso() })
        .eq("id", b).eq("restaurant_id", rid).eq("status", "open"));
      await log("editor", "printer_problem_resolved", { detail: b, device_id: dev, restaurant_id: rid });
      return ok({ ok: true });
    }

    // generic upsert: POST /:kind  (items | categories | filters | settings)
    if (path.length === 1) {
      const t = TABLES[a];
      if (!t) return err("unknown kind", 404);
      if ((a === "items" || a === "categories" || a === "filters") && !(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the menu");
      // Is the client CREATING a brand-new row vs EDITING an existing one? Read + strip the
      // transient hint once for every kind (it's never a real column). Lets a create refuse
      // to silently overwrite an existing row via the upsert's DO UPDATE arm.
      const isCreate = !!(body && typeof body === "object" && (body as Record<string, unknown>).__create === true);
      if (body && typeof body === "object") delete (body as Record<string, unknown>).__create;
      // Granular edit-menu sub-option gate (non-breaking; only a restricted manager is stopped).
      // Resolved ONCE — a dish save asks about five of the nine parts below.
      const parts = (a === "items" || a === "categories" || a === "filters")
        ? await menuPartsFor(g, rid) : null;
      if (a === "categories") { if (!parts!.manage_categories) return permDenied("manage categories"); }
      else if (a === "filters") { if (!parts!.manage_filters) return permDenied("manage filters"); }
      else if (a === "items" && isCreate) { if (!parts!.add_dish) return permDenied("add a new dish"); }
      if (a === "items" && body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        const drop = (...ks: string[]) => { for (const k of ks) if (k in b) delete b[k]; };
        // WHICH FIELDS EACH PART OWNS. Everything not claimed by a narrower part belongs to
        // "Edit dish info" — so a column added later lands in the CONSERVATIVE bucket rather
        // than in a hole nobody gates.
        // tax_mode (mig 270) belongs to "Change a price": it decides whether the typed number
        // is net, gross or final, so it moves what the guest pays exactly as the price does.
        // Whoever may not change a price may not change this either.
        const PRICE_KEYS = ["price", "open_price", "tax_mode"];
        const D3_KEYS = ["is4d", "model_folder", "model_small_url", "model_optimized_url"];
        const OPT_KEYS = ["options"];
        // 3D and Customisation are stripped on a CREATE too — a part that is off must not be
        // reachable through the one door that skipped it. `is4d` joined the 3D list today: it
        // is the switch that puts the model in front of guests, so leaving it writable meant
        // "Attach a 3D model · off" did not actually hold.
        if (!parts!.edit_3d) drop(...D3_KEYS);
        if (!parts!.edit_options) drop(...OPT_KEYS);
        // EDITING an existing dish. Until today this was one all-or-nothing question — no
        // edit_dish meant the whole save was refused, which made "Change a price" and "Mark as
        // sold out" unusable on their own even though the model lists them as separate rows
        // (and describes edit_dish as "name, description, photo, tags, allergens"). Now each
        // part is enforced on its own: the fields a person may not change are dropped from the
        // UPDATE (so the stored value simply stands — the panel's own upsert-vs-update split
        // already relies on an absent column meaning "leave it alone"), and the save is refused
        // outright only when they may change nothing at all.
        if (!isCreate && g.user && g.user.role === "manager") {
          if (!parts!.edit_dish && !parts!.edit_price && !parts!.mark_86 && !parts!.edit_options && !parts!.edit_3d)
            return permDenied("edit dishes");
          if (!parts!.edit_price) drop(...PRICE_KEYS);
          // `tags` is shared: the filter chips are edit_dish, the "sold-out" member is mark_86.
          // Whoever may not touch their half has it restored from the stored row, so the other
          // half of the same array still saves.
          if (Array.isArray(b.tags) && (!parts!.edit_dish || !parts!.mark_86)) {
            const cur = (await sb.from(t.name).select("tags").eq("restaurant_id", rid).eq("id", String(b.id ?? "")).maybeSingle()).data as
              { tags?: string[] | null } | null;
            const stored = Array.isArray(cur?.tags) ? cur!.tags! : [];
            if (cur) {
              const sent = b.tags as string[];
              const sold = parts!.mark_86 ? sent.includes("sold-out") : stored.includes("sold-out");
              const rest = (parts!.edit_dish ? sent : stored).filter((x) => x !== "sold-out");
              b.tags = sold ? [...rest, "sold-out"] : rest;
            }
          }
          // Everything left over is dish INFO — title, description, image, category, allergens,
          // ingredients, nutrition… Dropped wholesale rather than listed, so nothing new leaks in.
          if (!parts!.edit_dish) {
            const KEEP = new Set(["id", "restaurant_id", "tags", ...PRICE_KEYS, ...D3_KEYS, ...OPT_KEYS]);
            for (const k of Object.keys(b)) if (!KEEP.has(k)) delete b[k];
          }
        }
      }
      // A new category/filter must not clobber an existing one with the same slug (the upsert
      // keys on (restaurant_id,slug), so a dup-slug create would DO UPDATE over it — silent
      // data loss, 2026-07-06). Tell the user instead.
      if (isCreate && (a === "categories" || a === "filters") && body && typeof body === "object" && body.slug) {
        const clash = (await sb.from(t.name).select("slug").eq("restaurant_id", rid).eq("slug", String(body.slug)).maybeSingle()).data;
        if (clash) return err(`A ${a === "categories" ? "category" : "filter"} with that name already exists.`, 409);
      }
      // Same required-column courtesy the dish create gets: categories/filters need slug + name
      // (both NOT NULL, no default). Without this a create that omitted one reached the DB as a
      // raw "null value in column ... violates not-null constraint" 500. (2026-07-30)
      if (isCreate && (a === "categories" || a === "filters") && body && typeof body === "object") {
        const kindWord = a === "categories" ? "category" : "tag";
        const nm = (body as { name?: unknown }).name;
        const nameEmpty = nm == null
          || (typeof nm === "string" && !nm.trim())
          || (typeof nm === "object" && !Object.values(nm as Record<string, unknown>).some((v) => String(v ?? "").trim()));
        if (nameEmpty) return err(`Give the ${kindWord} a name first.`, 400);
        if (!String((body as { slug?: unknown }).slug ?? "").trim()) return err(`Give the ${kindWord} a name first.`, 400);
      }
      // Settings save is owner-only unless the owner has granted a manager the power
      // (owner role always passes managerCan). Previously this endpoint had NO gate — any
      // authenticated staff could PATCH the settings row. (2026-07-04 audit #4)
      // "Change restaurant settings" is GONE as a permission (owner, 2026-08-01) — there is no
      // restaurant configuration left for a manager to change from here. What remains under this
      // path is the FLOOR: table names, seats and how many sit on a row. Each is its own switch
      // under Access → Manager → What a manager can manage → The floor, and they are checked per
      // FIELD, so a manager allowed to rename a table cannot quietly change the layout too.
      // A settings section that is switched off must REFUSE, not merely vanish from the sidebar.
        // RETENTION IS ANSWERED FIRST, AND WITH THE TRUE REASON (owner, 2026-08-21).
        //
        // WHAT THIS IS NOT: it is not a silent-save fix. I first assumed the strip list below made
        // a manager's retention write vanish quietly, and CHECKED by removing this block — a
        // manager sending only `oplog_retention_days` already got a 403, because the "refuse any
        // key a manager sends" loop further down runs BEFORE that strip. So nothing was ever saved
        // silently, and the strip list never even reached retention for a manager.
        //
        // WHAT WAS ACTUALLY WRONG: the refusal was `permDenied("change that setting")`, whose
        // wording is "your owner hasn't given managers permission…". For retention that sentence is
        // untrue — there is NO permission an owner can grant here, by design, so the manager was
        // sent to ask for something nobody can give. And the panel drew an editable dropdown for
        // them anyway, so the only thing it could ever produce was that refusal.
        //
        // A refusal now carries a CODE, so the panel can say which of the two real reasons it is.
        //
        // IT HAS TO SIT ABOVE EVERY MANAGER GATE BELOW, not next to the strip list. Placed lower it
        // was unreachable: a manager hits `permDenied("change that setting")` first, which says
        // "your owner hasn't given managers permission" — and for retention that sentence is simply
        // untrue. There IS no permission an owner can grant for this, so the reason has to be the
        // real one before any grant is consulted.
        if (a === "settings" && body && typeof body === "object"
          && ("oplog_retention_days" in body || "custlog_retention_days" in body)) {
          const may = canSetRetention(g, await retentionLock());
          if (!may.ok) {
            return NextResponse.json({
              error: may.code === "retention_locked"
                ? "Aevidine has locked how long logs are kept. You can see the window, but only Aevidine can change it."
                : "Only the restaurant's owner can change how long logs are kept.",
              code: may.code,
            }, { status: 403 });
          }
        }
      if (a === "settings" && g.user && g.user.role === "manager") {
        const offList = managerSettingsOff((await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config);
        const touches = (ks: string[]) => body && typeof body === "object" && ks.some((k) => k in (body as object));
        if (offList.includes("tables") && touches(["table_names", "table_seats"]))
          return permDenied("change the tables");
        // THE "billing" AND "sessions" BRANCHES LEFT HERE ON 2026-08-06. managerSettingsOff() can
        // only ever return tables / users / access (MANAGER_SETTINGS), so neither could fire —
        // and the allow-list a few lines below already refuses a manager sending any of those
        // fields at all. Two refusals for switches the model retired imply those switches still
        // exist, which is exactly how a future session "restores" one.
      }
      if (a === "settings" && g.user && g.user.role === "manager" && body && typeof body === "object") {
        // THE `table_assign.manager_opts` GATE LEFT THIS BLOCK (sweep T6, 2026-08-06). It read
        // access_config.table_assign.manager_opts.tables and refused a rename when it was false —
        // and NO screen can write that path: `table_assign` is not in the access tree's HAS_IDS,
        // CONFIG_OPTS, CONFIG_LIMITS or CONFIG_TABLET, so the write route can never touch it. It
        // answered `true` for every restaurant, which is the only reason nothing was broken; a
        // restaurant carrying an old stored `false` would have had a manager refused a table
        // rename with nothing anywhere able to undo it. That is the stranded-switch shape the
        // access rebuild exists to remove. The LIVE switch for this exact act is
        // `menus.mgrset.tables`, checked by managerSettingsOff() a few lines above — one switch,
        // one screen, one refusal.
        // THE WHOLE FLOOR LAYOUT IS ADMIN-ONLY, AND IT IS NOT A PERMISSION (owner, 2026-08-02:
        // "in the manager panel there shouldn't be option of number of table per row… you cannot
        // on it and off it, that will be only set by admin"). Both fields are refused outright:
        //   • floor_layout_mode — Classic vs Custom; a Custom plan is written by hand per
        //     restaurant, so a manager switching to it could point their floor at a plan that
        //     does not exist.
        //   • floor_per_row — how many boxes sit on a line. It briefly WAS the manager's own
        //     setting (2026-08-01) and is his again to decide: one number, set in /aevinite.
        // Deliberately NOT gated by a switch: there is no row for either on the Access screen, so
        // an `opt("layout")` read would answer "true" for every restaurant and hand it straight
        // back — the dead-switch shape the access rebuild exists to remove.
        // The message says WHO sets it, not "your owner hasn't given you permission" — there is
        // no permission to give, so the usual wording would send a manager to ask for a switch
        // that does not exist.
        if ("floor_layout_mode" in body || "floor_per_row" in body)
          return err("How the floor is laid out — including how many tables sit on a row — is set by the admin only.", 403);
        // …AND SO ARE THE TABLES THEMSELVES (owner, 2026-08-06: "manager or owner can't change
        // table name and stuff — we set it up for them, cuz if they change, the name will be
        // gone"). Naming and seating the floor is part of setting a restaurant UP, not part of
        // running a shift: the names are printed on KOTs, spoken on the floor and quoted back in
        // every refusal, so one person renaming T5 to "Patio" mid-service changes what every
        // other screen and every ticket says, and the old name is simply gone with nothing to
        // restore it from. The whole floor definition is admin-owned now — layout, row width,
        // names and seats — which is also what makes it consistent: it was odd that a manager
        // could rename a table but not move it.
        // Same wording shape as the line above: say WHO sets it, never "you don't have
        // permission", because there is no permission to ask anyone for.
        if ("table_names" in body || "table_seats" in body)
          return err("Table names and seat counts are set by the admin only — ask them to change the floor.", 403);
        // …and with names and seats gone there is nothing left a manager may send here at all.
        // The allow-list is deliberately not kept as an empty Set: an empty allow-list reads like
        // an oversight, and the next person to add a manager-editable setting should have to
        // think about WHERE it belongs rather than dropping a key into a list that survived only
        // because nobody deleted it. If one is ever wanted again, bring the Set back with it.
        for (const k of Object.keys(body)) {
          if (k === "id" || k === "restaurant_id") continue;
          return permDenied("change that setting");
        }
      }
      if (a === "settings" && body && typeof body === "object") {
        // settings is ONE row per restaurant (UNIQUE restaurant_id) whose PRIMARY KEY id is
        // legacy ('site' for #1, the slug for others). It must NEVER come from the client:
        // the retention save sent id:'site', which collided with #1's PK on every OTHER
        // restaurant and 500'd the save (2026-07-06). Always use the EXISTING row's real id
        // (looked up by restaurant_id) so the upsert UPDATEs the right row; for a brand-new
        // restaurant with no row yet, fall back to the restaurant id (guaranteed unique, so
        // the INSERT can't collide with 'site').
        const existingSet = (await sb.from("settings").select("id").eq("restaurant_id", rid).maybeSingle()).data as { id?: string } | null;
        (body as Record<string, unknown>).id = existingSet?.id || rid;
        // Admin-only ENTITLEMENTS (mig 107, e.g. auto_print_kot_allowed) are granted ONLY
        // from the admin panel (/aevinite). Strip them here so a manager/owner can't
        // self-grant an entitlement the admin controls. Any `*_allowed` flag is admin-only.
        for (const k of Object.keys(body)) if (/_allowed$/.test(k)) delete (body as Record<string, unknown>)[k];
        // The feature ladder's higher rungs are not editable from this panel either:
        // table_tags_owner_control is the ADMIN's power-transfer switch; table_tags_enabled
        // is the OWNER's toggle (owner panel) — a manager must not flip rungs above them. (mig 166)
        delete (body as Record<string, unknown>).table_tags_owner_control;
        delete (body as Record<string, unknown>).table_tags_enabled;
        // Admin/owner-only settings (owner 2026-07-28): a REAL MANAGER may edit only per-table
        // NAME + seats + auto-close from this panel — never the billing identity, KOT printing,
        // the dining-session system, or the table COUNT. Those live in the admin panel
        // (components/admin/RestaurantSettings.tsx). The manager UI hides them (XRAY_CONTROLS in
        // public/panels/editor/app.js); this is the matching SERVER guard so the limit holds even
        // if the hidden control is forced. Admin (no staff cookie) and owner (role "owner") keep
        // full access — only a real manager's patch is stripped.
        if (g.user && g.user.role !== "owner") {
          const MANAGER_BLOCKED_SETTINGS = [
            // How many tables EXIST and how the floor is LAID OUT are both admin-owned (mig 226).
            // "Tables per row" was briefly the manager's own setting (2026-08-01) and came back
            // here on 2026-08-02 at the owner's word — "that will be only set by admin". A real
            // manager is refused outright above (a stripped field would save silently and snap
            // back on the next refresh, which is worse than being told no); this list is the
            // second net, and it covers any non-owner role that ever reaches this handler.
            "table_count", "floor_layout_mode", "floor_per_row",
            "tax_label", "restaurant_name", "restaurant_address", "restaurant_phone",
            "gstin", "invoice_prefix", "bill_footer", "tax_components", "tax_rate",
            "auto_print_kot",
            "sessions_enabled", "require_location", "require_otp", "geo_lat", "geo_lng", "geo_radius_m",
            // How long the activity log and customer log are KEPT. A manager must never be able
            // to shorten the record that audits them — dropping this to 1 day makes the nightly
            // cleanup (mig 053) erase the evidence of a discount/void/delete they made yesterday.
            // docs/COMPLIANCE-GUARDRAILS.md §3: the audit log has no "off" switch — and a
            // retention dial the audited party controls is an off switch with extra steps.
            // Owner + admin keep it (the owner is the one being protected, not policed).
            "oplog_retention_days", "custlog_retention_days",
          ];
          for (const k of MANAGER_BLOCKED_SETTINGS) delete (body as Record<string, unknown>)[k];
          // A manager must not renumber invoices — the series is the thing an audit
          // checks, and the audited party doesn't get to set it (same reasoning as the
          // log-retention block above). Owner + admin may. (mig 237)
          for (const k of ["banquet_bill_prefix", "banquet_bill_style", "banquet_bill_next"]) delete (body as Record<string, unknown>)[k];
        }
        // WHAT a restaurant is asked for, and WHICH paper it prints on, are the ADMIN's
        // (owner 2026-07-31: "one info-format option in banquet in Access & permissions
        // in the admin panel"). Strip them from ANY staff-cookie save — manager or owner
        // — so the only way in is the admin route. (mig 237)
        if (g.user) {
          for (const k of Object.keys(body)) if (k === "banquet_fields" || k === "banquet_tax_components" || /^banquet_paper/.test(k)) delete (body as Record<string, unknown>)[k];
        }
        // The banquet series: shape it here so a bad value can never reach the CHECK
        // constraint, and REFUSE (never silently drop) a start-number change once bills
        // exist — the counter is the part that must stay gapless.
        if ("banquet_bill_prefix" in body) {
          body.banquet_bill_prefix = String(body.banquet_bill_prefix || "BQB").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "BQB";
        }
        if ("banquet_bill_style" in body) {
          const st = String(body.banquet_bill_style || "fy");
          body.banquet_bill_style = ["fy", "date", "plain"].includes(st) ? st : "fy";
        }
        if ("banquet_bill_next" in body) {
          const n = Math.round(Number(body.banquet_bill_next));
          const issued = await sb.from("banquet_bills").select("id", { count: "exact", head: true }).eq("restaurant_id", rid);
          const already = Number(issued.count) || 0;
          const current = Number((await sb.from("settings").select("banquet_bill_next").eq("restaurant_id", rid).maybeSingle()).data?.banquet_bill_next) || 1;
          if (already > 0 && Number.isFinite(n) && n !== current) {
            return err(`${already} banquet ${already === 1 ? "bill has" : "bills have"} already been issued, so the starting number can't be changed. The prefix and the style can.`, 409);
          }
          body.banquet_bill_next = Number.isFinite(n) ? Math.min(Math.max(n, 1), 99_999_999) : 1;
        }
        // settings is one row per restaurant (UNIQUE restaurant_id); matched by
        // restaurant_id at the upsert below — don't force the legacy id='site'
        // (that only ever matches restaurant #1's row).
        if ("table_count" in body) {
          const n = Math.round(Number(body.table_count));
          body.table_count = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 12;
        }
        // Same clamp as the admin route (mig 226 also has a CHECK constraint) — an
        // owner/admin saving through this path can't write an out-of-range number either.
        if ("floor_per_row" in body) body.floor_per_row = clampPerRow(body.floor_per_row);
        if ("floor_layout_mode" in body) body.floor_layout_mode = body.floor_layout_mode === "custom" ? "custom" : "classic";
        for (const k of ["sessions_enabled", "require_location", "require_otp", "auto_print_kot"]) {
          if (k in body) body[k] = body[k] === true || body[k] === "true";
        }
        for (const g of ["geo_lat", "geo_lng"]) {
          if (g in body) { const v = parseFloat(body[g]); body[g] = Number.isFinite(v) ? v : null; }
        }
        if ("geo_radius_m" in body) {
          const n = Math.round(Number(body.geo_radius_m));
          body.geo_radius_m = Number.isFinite(n) ? Math.min(Math.max(n, 20), 5000) : 250;
        }
        // Log retention (in days): clamp to 1..90. 90 = the "3 months" max the UI
        // offers. The nightly cleanup job (migration 053) reads these each run.
        for (const rk of ["oplog_retention_days", "custlog_retention_days"]) {
          if (rk in body) {
            const n = Math.round(Number(body[rk]));
            body[rk] = Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 90;
          }
        }
        // GUEST FEATURE SWITCHES ARE NOT THIS ENDPOINT'S TO WRITE (sweep T6, 2026-08-06).
        //
        // This used to merge whatever `features` bag it was sent into settings.features, filtered
        // by nothing but "is it a boolean" — so ANY key at all could be stored, including the four
        // the model says stay invisible in every UI (verification / payments / aggregators /
        // gst_invoice). It was the one settings write in the product with no key list, and the
        // only thing that ever sent it was the manager panel's Features tab, which has been dead
        // code behind no tab for a long time and is deleted in the same change.
        //
        // Guest features belong to ONE screen — /aevinite/access — whose route allow-lists them
        // from the model (WRITEABLE_FEATURES) AND purges the guest menu cache so a switch reaches
        // diners immediately. Neither was true here. Refused, in the panel's own voice, rather
        // than dropped silently: a request that changes nothing must never answer "Saved".
        if ("features" in body)
          return err("Guest features are set by the admin on Access & permissions, not from this panel.", 403);
        // "Table setting" — per-table seat counts, keyed by table number ("1", "2", …).
        // Rebuild from scratch rather than trust the client shape: drops non-numeric
        // keys/values and clamps seats to 1..30, so a malformed request can't write an
        // array (setPath's array-vs-object ambiguity) or garbage into this JSONB column.
        // tax_components — the named tax breakdown [{label,rate%},…] (mig 117). Rebuild from
        // scratch (don't trust client shape): keep only entries with a non-empty label + a
        // finite rate in 0..100, cap the label length and the count (max 6 taxes), so a
        // malformed request can't write garbage into this JSONB column. Empty array = "not
        // configured" (the app falls back to tax_rate/5%).
        if ("tax_components" in body) {
          const raw = Array.isArray(body.tax_components) ? body.tax_components : [];
          body.tax_components = raw
            .map((c: any) => ({ label: String(c && c.label || "").trim().slice(0, 24), rate: Math.round((Number(c && c.rate) || 0) * 100) / 100 }))
            .filter((c: { label: string; rate: number }) => c.label && c.rate > 0 && c.rate <= 100)
            .slice(0, 6);
        }
        // bill_footer — free-text sign-off printed at the bottom of the customer bill
        // (mig 124). Blank/whitespace → null so the print falls back to its default.
        if ("bill_footer" in body) {
          const v = String(body.bill_footer ?? "").trim().slice(0, 200);
          body.bill_footer = v || null;
        }
        // tax_label — the word the ON-SCREEN merged tax line uses ("Tax"/"GST"/"VAT"…,
        // mig 125). Blank → null = the neutral default "Tax". Print is unaffected.
        if ("tax_label" in body) {
          const v = String(body.tax_label ?? "").trim().slice(0, 20);
          body.tax_label = v || null;
        }
        if ("table_seats" in body) {
          const raw = body.table_seats;
          const clean: Record<string, number> = {};
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            for (const [k, v] of Object.entries(raw)) {
              const n = Math.round(Number(v));
              if (!Number.isFinite(n)) continue;
              const seats = Math.min(Math.max(n, 1), 30);
              // "default" = how many people fit at a NORMAL table on this floor (owner,
              // 2026-08-01). It lives in this same JSONB beside the per-table numbers so the
              // floor-wide answer needs no new column in either database. Anything else must
              // be a table number; a stray key is dropped, as before.
              if (k === "default") { clean.default = seats; continue; }
              const tn = parseInt(k, 10);
              if (Number.isFinite(tn) && tn >= 1) clean[String(tn)] = seats;
            }
          }
          body.table_seats = clean;
        }
        // table_names (mig 131) — display labels per table. Trimmed, capped at 24
        // chars; blank entries are dropped (the panel falls back to "T<n>").
        if ("table_names" in body) {
          const raw = body.table_names;
          const clean: Record<string, string> = {};
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            for (const [k, v] of Object.entries(raw)) {
              const tn = parseInt(k, 10);
              const name = String(v ?? "").trim().slice(0, 24);
              if (Number.isFinite(tn) && tn >= 1 && name) clean[String(tn)] = name;
            }
          }
          body.table_names = clean;
        }
      }
      if (a === "items" && body && typeof body === "object") {
        // isCreate (create vs edit) was resolved + stripped above, shared across kinds.
        const slugify = (s: string) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        if (!body.slug && body.title) body.slug = slugify(body.title);
        // Price sanity (B7): the price column is read downstream as ::numeric, so a blank, negative,
        // or multi-separator value ("", "12.5.5", "1,299") either sold the dish for ₹0 or CRASHED
        // every guest order that included it. Validate + normalise to one clean number here. Only
        // when a price is actually being set (a tag-only edit omits it, so partial saves still work).
        if ("price" in body) {
          const cleaned = String(body.price ?? "").replace(/[^0-9.]/g, "");
          const n = Number(cleaned);
          if (cleaned === "" || !Number.isFinite(n) || n < 0 || (cleaned.match(/\./g) || []).length > 1) {
            return err("Enter a valid price — a number like 1299 or 129.99.", 400);
          }
          body.price = String(Math.round(n * 100) / 100);
        }
        // tax_mode (mig 270). Two guards, and the second is the one that matters:
        //   · an unknown value is REFUSED here rather than left to the CHECK constraint, which
        //     would come back as a raw 23514 and a 500 the manager can do nothing with;
        //   · while the ADMIN has per-dish modes switched off for this restaurant, the key is
        //     DROPPED. The form builds no control in that state, but hiding is never the only
        //     guard (docs/ACCESS-MODEL.md) — and a stored value nothing reads looks granted
        //     and isn't: flip the master switch on a year later and every dish would silently
        //     start behaving the way somebody set it while the feature was off.
        if ("tax_mode" in body) {
          const TAX_MODES = ["default", "excl", "incl", "mrp", "none"];
          const allowed = (await sb.from("settings").select("item_tax_modes_allowed").eq("restaurant_id", rid).maybeSingle()).data?.item_tax_modes_allowed === true;
          if (!allowed) delete body.tax_mode;
          else if (!TAX_MODES.includes(String(body.tax_mode ?? ""))) {
            return err("Pick one of: Default, On top, Inside, MRP, None.", 400);
          }
        }
        // menu_items.id is the GLOBAL primary key. A bare slug-as-id would let a save
        // silently OVERWRITE another restaurant's (or this restaurant's own existing)
        // dish that happens to share the name. So we never trust a client-supplied id
        // to decide create-vs-overwrite:
        //   • CREATE → mint an id that is unique across ALL restaurants (namespaced for
        //     non-default tenants) and a slug unique WITHIN this restaurant, so a new
        //     dish can never clobber an existing row.
        //   • EDIT   → keep the id, but refuse if that id belongs to a DIFFERENT tenant.
        if (isCreate) {
          const base = body.slug || slugify(body.title) || "item";
          const nsBase = rid === DEFAULT_RESTAURANT_ID ? base : `${base}__${rid.slice(0, 8)}`;
          let candidate = nsBase, n = 1;
          // id is a global PK → the candidate must be free for EVERY restaurant.
          while ((await sb.from("menu_items").select("id").eq("id", candidate).maybeSingle()).data) {
            n += 1; candidate = `${nsBase}-${n}`;
          }
          body.id = candidate;
          // Keep the guest-facing slug unique within this restaurant so /item/<slug> is 1:1.
          let slugCand = body.slug || base, m = 1;
          while ((await sb.from("menu_items").select("id").eq("restaurant_id", rid).eq("slug", slugCand).maybeSingle()).data) {
            m += 1; slugCand = `${body.slug || base}-${m}`;
          }
          body.slug = slugCand;
        } else {
          if (!body.id) {
            const base = body.slug || slugify(body.title);
            body.id = rid === DEFAULT_RESTAURANT_ID ? base : `${base}__${rid.slice(0, 8)}`;
          }
          const owner = (await sb.from("menu_items").select("restaurant_id").eq("id", String(body.id)).maybeSingle()).data as { restaurant_id?: string } | null;
          // No such dish → it was deleted (another device removed it while this one had it open, or a
          // tag-toggle raced a delete). Refuse with a friendly message instead of letting the upsert
          // INSERT a partial row (missing title/slug/price → a raw NOT NULL 500). (B21)
          if (!owner) return err("That dish was removed — reload to see the current menu.", 404);
          if (owner.restaurant_id !== rid) return err("That dish belongs to another restaurant", 409);
        }
        // Required-column safety net (B26): menu_items has NOT NULL, no-default columns
        // (title, price, image, category — slug/id are already set above). A CREATE that
        // omitted one, or an EDIT that sent an explicit null, used to reach the DB as a raw
        // "null value in column X" 500 (the reported image-on-create + slug crashes — often a
        // programmatic/restore save that skips a field). Coalesce/validate here so a save
        // either succeeds or returns a friendly message, never a scary constraint error.
        if (isCreate) {
          if (!String(body.title ?? "").trim()) return err("Give the dish a name first.", 400);
          if (!("price" in body)) return err("Enter a price for the dish.", 400);
          if (body.image == null) body.image = "";      // no photo → saves blank; the panel shows the default mark (owner 2026-07-24)
          if (body.category == null) body.category = ""; // uncategorised bucket, not a crash
        } else {
          // EDIT: never let an explicit null wipe a required column — drop the key so the
          // upsert keeps the stored value (a tag-only / partial save already omits these).
          for (const k of ["title", "price", "image", "category", "slug"] as const) {
            if (k in body && (body as Record<string, unknown>)[k] == null) delete (body as Record<string, unknown>)[k];
          }
        }
      }
      // Sort order (B20): the "Sort order" box is a number input, so clearing it sends "" —
      // which the numeric sort_order column rejects (a raw 500) or stores as null (the row
      // then sorts unpredictably and can vanish to the bottom). Coalesce a blank/invalid
      // value to 0 so a save never breaks the list order. Only when the field is actually
      // present, so a partial save (e.g. a tag-only toggle) leaves the stored value alone.
      if ((a === "items" || a === "categories" || a === "filters") && body && typeof body === "object" && "sort_order" in body) {
        const so = Number((body as { sort_order?: unknown }).sort_order);
        (body as { sort_order?: number }).sort_order = Number.isFinite(so) ? Math.round(so) : 0;
      }
      // Stamp ownership + match the per-restaurant unique key: categories/filters are
      // keyed (restaurant_id, slug); settings is keyed (restaurant_id); menu_items
      // keeps its global id PK. So a save only ever touches THIS restaurant's row.
      body.restaurant_id = rid;
      const onConflict = a === "settings" ? "restaurant_id"
        : (a === "categories" || a === "filters") ? "restaurant_id,slug"
        : t.key;
      // EDITING an existing row UPDATEs it; only a genuinely new row goes through upsert.
      //
      // WHY (crash fixed 2026-07-30): an upsert is an INSERT with ON CONFLICT, so PostgREST
      // has to build a COMPLETE row — and Postgres checks NOT NULL while forming that row,
      // before the conflict is resolved. So any PARTIAL save of an existing row (a sold-out /
      // tag toggle, a reorder, an active flip — all of which send just a few columns) blew up
      // with a raw `null value in column "title"/"slug"/"image" violates not-null constraint`
      // 500 instead of saving. Reproduced against the dev DB: the same body as an UPDATE
      // returns 200, as an upsert it returns 23502. It hit a live client's menu on 2026-07-30.
      // menu_items requires id, slug, title, price, image, category; categories/filters
      // require slug + name — so all three kinds were exposed. An UPDATE only touches the
      // columns actually sent, which is what a partial save means.
      const existingRow = (a === "items" || a === "categories" || a === "filters") && !isCreate
        ? (a === "items"
            ? (await sb.from(t.name).select("id").eq("restaurant_id", rid).eq("id", String(body.id ?? "")).maybeSingle()).data
            : (await sb.from(t.name).select("slug").eq("restaurant_id", rid).eq("slug", String(body.slug ?? "")).maybeSingle()).data)
        : null;
      const data = must(existingRow
        ? await (a === "items"
            ? sb.from(t.name).update(body).eq("restaurant_id", rid).eq("id", String(body.id)).select()
            : sb.from(t.name).update(body).eq("restaurant_id", rid).eq("slug", String(body.slug)).select())
        : await sb.from(t.name).upsert(body, { onConflict }).select());
      // Any of items/categories/filters/settings changes the SHARED guest menu →
      // bust this restaurant's cached bundle so guests see it within seconds.
      bustMenuCache(rid);
      // Record menu changes in the operation log (B25) — dish/category/tag creates + edits now leave a
      // "who changed the menu, and when" trail, like orders/bans/payments/discounts already do.
      if (a === "items" || a === "categories" || a === "filters") {
        const kind = a === "items" ? "dish" : a === "categories" ? "category" : "tag";
        const label = String(body.title || (body.name && (body.name.en || body.name)) || body.slug || (data[0] && data[0].id) || "").slice(0, 80);
        await log("manager", isCreate ? "menu_create" : "menu_edit", { restaurant_id: rid, detail: `${isCreate ? "added" : "edited"} ${kind}: ${label}`, device_id: dev });
      }
      // A settings save echoes the saved ROW back, so it is the same payload as /all and gets the
      // same strip — otherwise the one column we just removed from the boot bundle would come
      // straight back on the next Save. (T17 sweep, 2026-08-13)
      return ok(a === "settings" ? panelSafeSettings(data[0]) : data[0]);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    // Record the unexpected failure as an error-level diary line (mig 159) so it shows red in
    // the admin log and can drive the alert / nightly-fix tooling. Fire-and-forget.
    if (worthLogging(e)) logError("manager", "route_error", e, { restaurant_id: rid, detail: `POST ${path.join("/") || "/"}` });
    return panelFailure(e);
  }
}

// ── PATCH ────────────────────────────────────────────────────────────────────
export const PATCH = withIdempotency(invalidateFloorAfter(patchImpl), "editor");
async function patchImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const actorName = g.user?.name || g.user?.username || null;
  // Admin panel-view actions (no staff cookie) get the actor_id='admin:view' marker so the
  // ADMIN's log surfaces can attribute them; staff/owner log reads mask it (owner 2026-07-28).
  // actor_id (the STABLE staff uuid) rides along too, not just the display name: a rename
  // used to orphan every past row, and "what did this person do" / the performance report
  // can only join on an id. (2026-07-29)
  const log = (...a: Parameters<typeof logAction>) => logAction(a[0], a[1], { actor: actorName, ...(g.user ? { actor_id: g.user.id } : { actor_id: ADMIN_VIEW_ACTOR_ID }), ...(a[2] || {}) });
  const rid = await editorScope(req, g);
  if (rid instanceof NextResponse) return rid;
  // A write to this restaurant drops its shared floor snapshot, so the very next read
  // recomputes. Dropping it HERE is not enough on its own (a poll landing between this line
  // and the write re-shares the old floor) — invalidateFloorAfter() drops it again once the
  // handler has finished, which is what makes "read your own write" actually true.
  invalidateFloor(rid);
  writeRid.set(req, rid);
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  // Manager's-menu rung: refuse a tab this restaurant switched off (see tabGate).
  { const tg = await tabGate(g, rid, path, req.method); if (tg) return tg; }
  try {
    const [a, id] = path;
    // "undefined"/"null"/"NaN" id → clean 400 (a truthy string would slip past `&& id` below).
    if (emptyIdSegment(id)) return err("Missing id — please refresh and try again.");
    const body = await readBody(req);

    // ── OFFLINE REPLAY CLASH + NO SILENT OVERWRITES ───────────────────────────────
    // The SAME two gates postImpl runs, and they belong here just as much. PATCH was left out
    // when they were written, yet the manager panel queues PATCHes through the outbox exactly
    // like POSTs — "mark this bill paid", "un-pay it", "archive the table", "restore it to the
    // live floor". So a change saved on a device with no signal was replayed twenty minutes
    // later with nothing checking whether the ground had moved: a bill that another device had
    // since settled and closed could be re-opened as unpaid (the thing lib/clash.ts's own
    // header calls what must never happen), and an `archived: true` could land on the NEW
    // party's live order. A live write carries no replay marker, so this costs it nothing.
    const clash = await replayClash(req, rid, a, id, path[2], body as Record<string, unknown> | null);
    if (clash) return clashJson(clash);
    const overwrite = await expectClash(req, rid);
    if (overwrite) return clashJson(overwrite);

    if (a === "orders" && id) {

      const patch: any = {};
      if (body.status !== undefined) {
        if (!ORDER_STATUSES.includes(body.status)) return err("invalid status");
        patch.status = body.status;
      }
      if (body.payment_status !== undefined) {
        if (!["pending", "paid"].includes(body.payment_status)) return err("invalid payment_status");
        // "Mark a bill paid (and undo)" — the other Access row that wrote a key no code read.
        // Deliberately ONE permission covering BOTH directions, so undoing a payment is never
        // easier than taking it. Default ON; only an admin switching it off changes anything.
        if (!(await managerCan(g, rid, "mark_paid"))) return permDenied("mark a bill paid");
        patch.payment_status = body.payment_status;
        // How the money came in — asked by the "Mark paid" flow (owner, 2026-07-01). Optional:
        // the per-order correction toggle doesn't pass it, and that's fine — it buckets under
        // "Not recorded" in the payment-method breakdown (see lfh_owner_payment_breakdown).
        if (body.payment_status === "paid" && body.payment_method !== undefined) {
          if (!PAYMENT_METHODS.includes(body.payment_method)) return err("invalid payment_method");
          patch.payment_method = body.payment_method;
          patch.payment_note = String(body.payment_note || "").slice(0, 200) || null;
        }
      }
      if (body.archived !== undefined) patch.archived = body.archived === true;
      if (!Object.keys(patch).length) return err("nothing to update");
      // session_id is read here so a payment revert can reverse THAT party's customer visit
      // (mig 233) instead of whoever is sitting at the table by the time it happens.
      // khata_at is read because the archive rule below must NOT cancel a parked pay-later tab —
      // that is money still to be collected (mig 232's own stated exception).
      const cur = must(await sb.from("orders").select("status,payment_status,archived,paid_at,archived_at,cancelled_at,khata_at,table_number,session_id").eq("id", id).eq("restaurant_id", rid).single());
      if (patch.status === "cancelled" && cur.payment_status === "paid")
        return err("Can't cancel a paid order — mark it unpaid (refund) first.", 409);
      // ── ONCE THE INVOICE IS PRINTED, NOTHING COMES OFF THE BILL (owner, 2026-08-26) ───────────
      // His words: *"whenever the invoice has been printed — like you have clicked the print button
      // — after [that] you won't be able to delete the thing."*
      //
      // Until now the only bars on cancelling a KOT were "is it paid?" and, in the panel, "has any
      // dish been served?". An INVOICED but not-yet-paid bill fell through both: a manager could
      // print a tax invoice, hand it to the guest, and then void a KOT off it. The paper in the
      // guest's hand and the record would then disagree, and the invoice number would be carrying a
      // total that no longer exists anywhere — which is the shape of a silent downward revision,
      // the thing docs/COMPLIANCE-GUARDRAILS.md §2 refuses outright.
      //
      // The legal route after an invoice exists is unchanged and already built: REOPEN the bill
      // (which voids the invoice, retires its number and records why — mig 189), change what needs
      // changing, and print again for a new number; or, once settled, a CREDIT NOTE. Both keep the
      // sale on the books. So this refuses and names the door rather than just saying no.
      //
      // Here and not only in the panel because three doors reach this route (manager, tablet, and
      // the admin console acting as a restaurant), and a guard in one screen is a guard one caller
      // obeys.
      //
      // ONE RULE, ONE PLACE: invoiceLockedByOrder() is the same helper that already locks the
      // per-dish delete, the quantity stepper and the discount. A live invoice number locks the
      // bill; a VOIDED one does not, because the bill was deliberately reopened and is editable
      // again. Reusing it is what stops "invoiced" meaning four slightly different things.
      if (patch.status === "cancelled" && await invoiceLockedByOrder(id, rid)) {
        return err("This bill's invoice has already been printed, so no KOT can be taken off it. Reopen the bill first — that retires the invoice number and records why — or issue a credit note if it is already settled.", 409);
      }
      // CANCELLING A TICKET IS NOT GATED (restored 2026-08-02, and here is why it changed twice).
      // On 2026-07-31 it was put behind void_bills, reasoning that a cancel voids money. Then on
      // 2026-08-02 the owner made "Reopen a bill" default OFF for every restaurant — and because
      // both hung off that ONE flag, a manager could suddenly not clear a walk-out or a mistaken
      // ticket at all. The floor's normal correction became impossible by default, which is worse
      // than the risk it was guarding.
      //
      // The access model settles it: a capability the owner did not list has NO switch and is
      // permanently on for whoever's panel owns it (docs/ACCESS-MODEL.md). He listed three money
      // rows — delete a bill, reopen a bill, discount a bill — and cancelling a ticket is none of
      // them; it is how a kitchen mistake and a walk-out are cleared. What protects it is the
      // RECORD, not a refusal: every cancel now writes an Audit row naming the person, the reason,
      // the KOT and the bill (below), so nothing can be cancelled quietly.
      //
      // AND DELETING A BILL IS NOT A POWER THIS RESTAURANT HAS AT ALL — do not read the paragraph
      // above as saying it is. R27 (owner, 2026-08-16, re-confirmed 2026-08-21) retired the
      // grantable "Delete a bill" row outright: *"I don't want to give permission to the restaurant
      // owner to delete the bill because he will fake the bill and delete the bill"*. Cancel is the
      // only route out of a bill for a manager AND for the owner; `canDeleteBill()` answers true for
      // the Aevidine admin console only, and `npm run verify:one-bill-delete` asserts exactly that.
      // This comment said the OPPOSITE until 2026-08-28 (sweep #7, T30) — written before R27 and
      // never re-read, which is how a permission the owner refused gets rebuilt by somebody
      // trusting a comment. The guard now fails if that wording ever comes back.
      if (patch.payment_status === "paid" && cur.status === "cancelled")
        return err("Can't take payment on a cancelled order.", 409);
      // RULE (owner 2026-06-29): a bill can only be paid once the order is ACCEPTED (gone to
      // prepare). A brand-new 'received' order must be accepted first — you can't take payment
      // on something the kitchen hasn't confirmed. (No payment system yet; when one is added it
      // will auto-accept on payment and skip this phase — not now.)
      if (patch.payment_status === "paid" && cur.status === "received")
        return err("Accept the order first — a bill can only be paid once the order is accepted.", 409);
      // A settled bill (paid / freed / cancelled) can only be undone within a 30-min
      // grace window — after that it's aged into "Today's bills" for good (owner,
      // 2026-07-02). NULL timestamp (never settled, or settled before this shipped)
      // fails closed: treated as expired, not as "always restorable".
      const RESTORE_WINDOW_MS = 30 * 60 * 1000;
      const tooOld = (iso: string | null | undefined) =>
        !iso || (Date.now() - new Date(iso).getTime()) > RESTORE_WINDOW_MS;
      // Reverting a PAID bill to unpaid is a refund/correction, not a routine edit:
      // require a reason and ALWAYS log it, so collected cash can't be quietly
      // un-booked without a trace (theft control).
      if (patch.payment_status === "pending" && cur.payment_status === "paid") {
        if (tooOld(cur.paid_at)) return err("This bill was marked paid more than 30 minutes ago and can no longer be reverted.", 409);
        const reason = String((body && body.revert_reason) || "").trim();
        if (!reason) return err("Reverting a PAID bill needs a reason (refund/correction).", 409);
        // A SPLIT settle's payment LEGS have to be reversed here too (mig 285). This path never
        // touched session_payments at all, so after a manager undid a split the trail went on
        // saying "₹200 UPI + ₹200 cash collected" against a bill now marked unpaid — while the
        // waiter panel's twin hard-DELETED them. One shared helper, one behaviour, nothing erased.
        if (cur.session_id) {
          try {
            const legs = await reverseSplitLegs(sb, {
              rid, sessionId: cur.session_id, since: new Date(Date.now() - RESTORE_WINDOW_MS).toISOString(),
              actor: actorName, reason,
            });
            if (legs.reversed) await log("editor", "payment_legs_reversed", {
              restaurant_id: rid, order_id: id,
              detail: `${legs.reversed} leg(s) · ₹${legs.amount} · ${reason}`, device_id: deviceIdFrom(req),
            });
          } catch (e) {
            // The person must know the trail could not be corrected — never silent.
            return err(e instanceof Error ? e.message : "Couldn't reverse the split payment record.", 500);
          }
        }
        await log("editor", "payment_revert", { restaurant_id: rid, order_id: id, detail: reason, device_id: deviceIdFrom(req) });
        // Un-booking collected money belongs in the Audit, not only in the activity log — it is
        // the same question ("who took money off this bill, and why?"). The reason is already
        // required above, so this row always carries one.
        await recordRemoval({
          rid, kind: "payment_reverted", reason: { note: reason }, user: g.user,
          deviceId: deviceIdFrom(req), orderId: id, sessionId: cur.session_id ?? null,
          tableNumber: cur.table_number != null ? String(cur.table_number) : null,
          meta: { was_paid_at: cur.paid_at ?? null },
        });
        // Reversing the settle reverses the visit it counted (Customer CRM, mig 212).
        // Idempotent per session, so reverting each order of a multi-order bill is safe.
        // Reverse THIS bill's visit — the order row already tells us whose party it was.
        // Without the session id this deleted the visit of whoever is sitting there NOW (mig 233).
        if (cur.table_number != null || cur.session_id) {
          await sb.rpc("lfh_uncapture_customer", {
            p_restaurant_id: rid,
            p_table: cur.table_number != null ? String(cur.table_number) : "",
            p_session: cur.session_id ?? null,
          });
        }
      }
      if (patch.archived === false && cur.archived === true) {
        if (tooOld(cur.archived_at)) return err("This bill was freed more than 30 minutes ago and can no longer be restored.", 409);
      }
      if (patch.status === "received" && cur.status === "cancelled") {
        if (tooOld(cur.cancelled_at)) return err("This order was cancelled more than 30 minutes ago and can no longer be restored.", 409);
      }
      // Stamp/clear the settle timestamps as their gating flags flip.
      if (patch.payment_status === "paid") patch.paid_at = new Date().toISOString();
      // Reverting to unpaid un-collects the payment — the TIP went with that payment, so
      // clear it too. Otherwise a re-pay without a new tip leaves the old tip on the order
      // and the Z-report's "tips collected" (SUM orders.tip over paid) counts it again. (sweep C2)
      if (patch.payment_status === "pending") { patch.paid_at = null; patch.tip = 0; }
      if (patch.archived === true) patch.archived_at = new Date().toISOString();
      if (patch.archived === false) patch.archived_at = null;
      // The person's answer to "was the food made?", acted on AFTER the update below (see the note in
      // the cancel block). null = it was not asked, which stays UNANSWERED rather than being guessed.
      let classifyMade: boolean | null = null;
      // Whether the ✕ below was forced by the archive rather than asked for directly — it goes
      // into the audit row so a later reader knows this was "table freed with food unpaid",
      // not somebody deliberately cancelling a ticket.
      let archiveForcedTheCancel = false;
      // ── ARCHIVING UNPAID FOOD MUST STILL LEAVE A ✕ (T16 sweep, 2026-08-05) ─────────────
      // Migration 232 installed the rule "an order can never outlive its session": when a party
      // ends, unpaid non-khata work becomes a VISIBLE ✕ cancelled record and everything else is
      // merely archived. It lives on the session status change so EVERY close honours it.
      //
      // This PATCH is a different door into the same outcome, and it did not honour it. It set
      // `archived` and left `status` alone, so an unpaid, still-cooking order could leave the
      // floor as "preparing" — off the live view, with no cancellation, no cancelled_at, and
      // nothing recording that a walk-out happened. FOUND IN THE DATA, not by reading: 9 such
      // orders on French House (two of ₹4,189.50), all archived by hand; Aangan, which is only
      // ever read, had none. The panel's freeTable() calls exactly this and its own comment
      // ASSUMES "the orders left here are cancelled/settled" — nothing enforced it.
      //
      // Same decision as lib/sessionClose.ts, in the one place every caller passes through
      // (panel button, a script, the offline replay, a future screen). Deliberately narrow:
      //   · only when the caller did NOT set a status itself — `serve-all` archives a served
      //     round on purpose and must keep saying 'served';
      //   · khata is money still to collect, so it is never cancelled (mig 232's own exception);
      //   · a paid or already-cancelled order is untouched — archive-only, exactly as before.
      // Nothing is deleted or hidden: a ✕ row stays in Bills and in every report.
      if (
        patch.archived === true &&
        patch.status === undefined &&
        cur.status !== "cancelled" &&
        cur.payment_status !== "paid" &&
        !(cur as { khata_at?: string | null }).khata_at
      ) {
        patch.status = "cancelled";
        archiveForcedTheCancel = true;
      }
      if (patch.status === "cancelled") patch.cancelled_at = new Date().toISOString();
      if (patch.status === "received" && cur.status === "cancelled") patch.cancelled_at = null;
      // Cancelling takes a bill OUT of revenue, so it is a money-affecting action and must name
      // a person — it was previously the ONE such action that wrote no log line at all (only the
      // row's cancelled_at showed it happened, with no actor). Cancel stays UNGATED for managers
      // on purpose (it's routine floor work; only DELETE needs the power) — this records it, it
      // does not restrict it. Un-cancelling is logged too, so a cancel/restore pair can't be used
      // to move a bill in and out of the takings unobserved. (docs/COMPLIANCE-GUARDRAILS.md §3)
      if (patch.status === "cancelled" && cur.status !== "cancelled") {
        await log("editor", "order_cancel", { restaurant_id: rid, order_id: id, table_number: cur.table_number ?? null, detail: `cancelled${cur.payment_status === "paid" ? " (was marked paid)" : ""}`, device_id: deviceIdFrom(req) });
        // …and the AUDIT row, written HERE rather than by the browser afterwards (2026-08-02).
        // It used to be app.js's job (POST /audit after the action), which meant the waiter panel
        // recorded nothing and any future caller would record nothing. The reason the panel asked
        // for now travels WITH the action, so one round trip does both.
        await recordRemoval({
          rid, kind: "order_cancelled", reason: reasonFromBody(body), user: g.user,
          deviceId: deviceIdFrom(req), orderId: id, sessionId: cur.session_id ?? null,
          tableNumber: cur.table_number != null ? String(cur.table_number) : null,
          meta: { was_paid: cur.payment_status === "paid", ...(archiveForcedTheCancel ? { auto: "unpaid food archived off the floor" } : {}) },
        });
        // ── WAS THE FOOD ACTUALLY MADE? (owner, 2026-08-18 — docs/CANCEL-AND-LOSS-SPEC.md) ────────
        // A cancelled order is two different events wearing one name. The panel now asks, in red, and
        // the answer travels WITH the cancel so one round trip does everything:
        //   true  → the food was cooked. The kitchen-fire consumption stands (the stock really is
        //           gone) and the ingredient cost becomes a `food_loss` expense.
        //   false → never started. The consumption is reversed line for line, so the ingredients go
        //           back on the shelf — which is what NOTHING did before this: cancelling reversed
        //           nothing, so a mis-keyed order ate its ingredients for ever.
        // An absent answer is left UNANSWERED on purpose rather than guessed — an old row, an offline
        // replay from a panel that predates this, or lib/sessionClose's automatic archive all land
        // there, and the Audit screen is where a person fixes it (P3).
        // ORDER OF OPERATIONS, and it cost me a wrong test to find: at THIS point the row has not
        // been updated yet — the UPDATE runs at the bottom of this handler. lfh_cancel_classify
        // refuses an order that is not cancelled yet, which is the right guard, so calling it here
        // returned {ok:false,'not_cancelled'} and did nothing. So only REMEMBER the answer here and
        // act on it after the write lands.
        const madeAns = (body as { made?: unknown } | null)?.made;
        if (typeof madeAns === "boolean") classifyMade = madeAns;
        // …and, once a day at most, tell the owner when the day's voids look unusual (lib/cancelWatch.ts).
        // Cancel is the ONLY way a bill leaves the working list now, so the level of cancelling is
        // the thing worth watching — but this never blocks or questions the cancel itself, which is
        // ordinary restaurant work. Awaited only so it shares this request's connection; it cannot
        // throw. The common case costs a rows-free count.
        await watchCancellations(rid);
      } else if (patch.status === "received" && cur.status === "cancelled") {
        await log("editor", "order_uncancel", { restaurant_id: rid, order_id: id, table_number: cur.table_number ?? null, detail: "cancel undone — back on the floor", device_id: deviceIdFrom(req) });
      }
      // Only session_id is needed (for auto-settle on pay); the client discards the body → no full row.
      const data = must(await sb.from("orders").update(patch).eq("id", id).eq("restaurant_id", rid).select("session_id"));
      // ── NOW the row is cancelled, so the answer can do its work (mig 337) ──────────────────────
      // made=true keeps the kitchen-fire consumption and prices it as a food_loss expense;
      // made=false reverses the consumption so the ingredients go back on the shelf. Best-effort: the
      // cancel itself has already succeeded and must never look failed because the costing hiccuped —
      // but a refusal is LOGGED rather than swallowed, because a silent one is what hid the ordering
      // mistake this comment exists to explain.
      if (classifyMade !== null) {
        const cls = await sb.rpc("lfh_cancel_classify", {
          p_restaurant: rid, p_order: id, p_made: classifyMade,
          p_actor: g.user?.name || g.user?.username || "Admin (Aevidine)",
          p_actor_id: g.user?.id ?? null, p_actor_role: g.user?.role || "admin", p_audit_id: null,
        });
        const bad = cls.error ? cls.error.message : (cls.data as { ok?: boolean; reason?: string } | null)?.ok === false
          ? `refused: ${(cls.data as { reason?: string }).reason}` : null;
        if (bad) {
          await log("editor", "cancel_classify_failed", {
            restaurant_id: rid, order_id: id, level: "error",
            detail: `could not record whether the food was made — ${bad}`,
            device_id: deviceIdFrom(req),
          });
        }
      }
      return ok({ ok: true });
    }

    if (a === "calls" && id) {
      const data = must(await sb.from("waiter_calls").update({ resolved: body?.resolved === true }).eq("id", id).eq("restaurant_id", rid).select());
      // A TAP THAT MOVED NOTHING MUST NOT REPORT SUCCESS (2026-08-06, T4 sweep). The manager's floor
      // can hard-delete a waiter call, so a second device still showing it would tick it off, get a
      // 200, and be offered an undo for a call that no longer exists. The tablet's twin of this
      // endpoint (calls/:id/attend + /reopen) was fixed in the same pass; this is the same answer.
      if (!data[0]) return err("That call is no longer on the board — refresh and try again.", 404);
      return ok(data[0]);
    }

    return err("unknown PATCH endpoint", 404);
  } catch (e) {
    // Record the unexpected failure as an error-level diary line (mig 159) so it shows red in
    // the admin log and can drive the alert / nightly-fix tooling. Fire-and-forget.
    if (worthLogging(e)) logError("manager", "route_error", e, { restaurant_id: rid, detail: `PATCH ${path.join("/") || "/"}` });
    return panelFailure(e);
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export const DELETE = withIdempotency(invalidateFloorAfter(deleteImpl), "editor");
async function deleteImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const actorName = g.user?.name || g.user?.username || null;
  // Admin panel-view actions (no staff cookie) get the actor_id='admin:view' marker so the
  // ADMIN's log surfaces can attribute them; staff/owner log reads mask it (owner 2026-07-28).
  // actor_id (the STABLE staff uuid) rides along too, not just the display name: a rename
  // used to orphan every past row, and "what did this person do" / the performance report
  // can only join on an id. (2026-07-29)
  const log = (...a: Parameters<typeof logAction>) => logAction(a[0], a[1], { actor: actorName, ...(g.user ? { actor_id: g.user.id } : { actor_id: ADMIN_VIEW_ACTOR_ID }), ...(a[2] || {}) });
  const rid = await editorScope(req, g);
  if (rid instanceof NextResponse) return rid;
  // A write to this restaurant drops its shared floor snapshot, so the very next read
  // recomputes. Dropping it HERE is not enough on its own (a poll landing between this line
  // and the write re-shares the old floor) — invalidateFloorAfter() drops it again once the
  // handler has finished, which is what makes "read your own write" actually true.
  invalidateFloor(rid);
  writeRid.set(req, rid);
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  // Manager's-menu rung: refuse a tab this restaurant switched off (see tabGate).
  { const tg = await tabGate(g, rid, path, req.method); if (tg) return tg; }
  try {
    const [a, id] = path;
    // "undefined"/"null"/"NaN" id → clean 400 (a truthy string would slip past `&& id` below).
    if (emptyIdSegment(id)) return err("Missing id — please refresh and try again.");

    // ── OFFLINE REPLAY CLASH ──────────────────────────────────────────────────────
    // Same reasoning as PATCH above: `api("DELETE", …)` goes through the outbox too, so a
    // "delete this bill" tapped with no signal is replayed later. Without this gate it was
    // applied to whatever that table looks like NOW — including a table that has since been
    // closed, billed and reseated. A deletion is the least reversible thing in this file
    // (it is a soft delete, but it still takes a bill off the floor and out of Today), so
    // "the ground moved, ask a person" is the only safe answer.
    // No expectClash here: a DELETE names a row, it does not carry a value it edited FROM.
    const clash = await replayClash(req, rid, a, id, path[2], null);
    if (clash) return clashJson(clash);

    if (a === "orders" && id) {
      // Bill deletion is owner-gated (least-privilege) + always logged — same rule as the
      // bulk clear above. A manager can still CANCEL an order without this power. This is a
      // SOFT delete (mig 188): the row is stamped, never erased, so the bill is retained for
      // tax/audit and shows as a tombstone in the admin ledger; a restore brings it back.
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("delete bills");
      if (!(await canDeleteBill(g, rid))) return permDenied("delete bills");
      const cur = must(await sb.from("orders").select("payment_status,status").eq("id", id).eq("restaurant_id", rid).single());
      if (cur && cur.payment_status === "paid" && cur.status !== "cancelled")
        return err("Won't delete a PAID bill — it's a financial record. Mark it unpaid or void it first.", 409);
      // Reason from the client (?reason=) → onto the tombstone + into the log so the audit shows WHY.
      const delReason = (req.nextUrl.searchParams.get("reason") || "").trim().slice(0, 200);
      // Read the bill's worth BEFORE the soft delete, so the Audit row says what left the reports.
      const wasWorth = (await sb.from("orders").select("total, session_id, table_number").eq("id", id).eq("restaurant_id", rid).maybeSingle()).data as
        { total: number | null; session_id: string | null; table_number: string | null } | null;
      await softDeleteOrders(rid, [id], { actor: actorName, actorId: g.user?.id ?? null, reason: delReason });
      await log("editor", "order_delete", { restaurant_id: rid, order_id: id, detail: delReason || undefined, device_id: deviceIdFrom(req) });
      // Server-side Audit row (was the browser's job — see the cancel path above).
      await recordRemoval({
        rid, kind: "order_deleted",
        reason: { code: (req.nextUrl.searchParams.get("reason_code") || "").trim() || null, note: delReason || null },
        user: g.user, deviceId: deviceIdFrom(req), orderId: id,
        sessionId: wasWorth?.session_id ?? null, tableNumber: wasWorth?.table_number ?? null,
        amount: Number(wasWorth?.total) || 0,
      });
      return ok({ ok: true });
    }

    if (a === "calls" && id) {
      must(await sb.from("waiter_calls").delete().eq("id", id).eq("restaurant_id", rid));
      return ok({ ok: true });
    }

    if (a === "blocklist" && id) {
      const existing = must(await sb.from("blocklist").select("*").eq("id", id).eq("restaurant_id", rid).limit(1));
      must(await sb.from("blocklist").delete().eq("id", id).eq("restaurant_id", rid));
      const phone = existing[0] && existing[0].phone;
      if (phone) {
        const others = must(await sb.from("blocklist").select("id").eq("phone", phone).eq("restaurant_id", rid).limit(1));
        if (!others.length) await sb.from("customers").update({ blocked: false }).eq("phone", phone).eq("restaurant_id", rid);
      }
      // Unbanning is recorded too, so a ban that's quietly lifted still leaves a trace.
      await log("editor", "blocklist_remove", { restaurant_id: rid, detail: "unbanned", device_id: deviceIdFrom(req) });
      return ok({ ok: true });
    }

    // generic delete: DELETE /:kind/:id  (items | categories | filters | settings)
    if (a && id) {
      const t = TABLES[a];
      if (!t) return err("unknown kind", 404);
      if ((a === "items" || a === "categories" || a === "filters") && !(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the menu");
      // Granular delete gate (non-breaking): a restricted manager can be blocked from deleting.
      if (a === "items" && !(await menuSubAllowed(g, rid, "delete_dish"))) return permDenied("delete dishes");
      if (a === "categories" && !(await menuSubAllowed(g, rid, "manage_categories"))) return permDenied("manage categories");
      if (a === "filters" && !(await menuSubAllowed(g, rid, "manage_filters"))) return permDenied("manage filters");
      // What it was CALLED, read before it goes — an Audit row saying "dish: 7f3c-…" names
      // nothing a person recognises (2026-08-02).
      const gonesTitle = ((await sb.from(t.name).select("title").eq(t.key, id).eq("restaurant_id", rid).maybeSingle()).data as { title?: string } | null)?.title || "";
      // slug is unique only PER restaurant now (categories/filters), so a delete by
      // key MUST also pin the restaurant or it would wipe that slug everywhere.
      must(await sb.from(t.name).delete().eq(t.key, id).eq("restaurant_id", rid));
      // Reconcile dishes that still referenced the deleted category/filter, else they'd
      // keep a dead slug (a category chip that no longer exists / an orphan tag) — 2026-07-06.
      // Best-effort (the delete already succeeded): never fail the request on cleanup.
      try {
        if (a === "categories") {
          await sb.from("menu_items").update({ category: null }).eq("restaurant_id", rid).eq("category", id);
        } else if (a === "filters") {
          const { data: tagged } = await sb.from("menu_items").select("id,tags").eq("restaurant_id", rid).contains("tags", [id]);
          for (const d of ((tagged || []) as { id: string; tags: string[] | null }[])) {
            await sb.from("menu_items").update({ tags: (d.tags || []).filter((x) => x !== id) }).eq("id", d.id).eq("restaurant_id", rid);
          }
        }
      } catch { /* orphan cleanup is best-effort */ }
      // Record the menu deletion in the operation log (B25) — like create/edit above.
      if (a === "items" || a === "categories" || a === "filters") {
        const what = a === "items" ? "dish" : a === "categories" ? "category" : "tag";
        await log("manager", "menu_delete", { restaurant_id: rid, detail: `deleted ${what}: ${id}`, device_id: deviceIdFrom(req) });
        // …and in the AUDIT. Migration 251 promised this in its own opening comment ("every item,
        // it's been deleted from the menu … it should ask for the reason") and nothing ever wrote
        // it, so a dish could leave the menu with no reason recorded anywhere (fixed 2026-08-02).
        await recordRemoval({
          rid, kind: "menu_item_deleted",
          reason: { code: (req.nextUrl.searchParams.get("reason_code") || "").trim() || null,
                    note: (req.nextUrl.searchParams.get("reason") || "").trim() || null },
          user: g.user, deviceId: deviceIdFrom(req),
          itemTitle: `${what}: ${gonesTitle || id}`,
          meta: { kind_of_thing: what, key: id },
        });
      }
      // Deleting a dish/category/filter changes the SHARED guest menu → bust cache.
      bustMenuCache(rid);
      return ok({ ok: true });
    }

    return err("unknown DELETE endpoint", 404);
  } catch (e) {
    // Record the unexpected failure as an error-level diary line (mig 159) so it shows red in
    // the admin log and can drive the alert / nightly-fix tooling. Fire-and-forget.
    if (worthLogging(e)) logError("manager", "route_error", e, { restaurant_id: rid, detail: `DELETE ${path.join("/") || "/"}` });
    return panelFailure(e);
  }
}
