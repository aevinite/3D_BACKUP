// Kitchen API — the kitchen/server.js surface, ported into one Next catch-all so
// it runs inside the single app (no separate :4002 server). Faithful to the
// original: same paths (under /api/kitchen/*), shapes, and rollup logic. Uses the
// server-only service-role client. The kitchen UI calls fetch("/api/kitchen"+path).

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { menuTag } from "@/lib/menuDataServer";
import { withIdempotency } from "@/lib/idempotency";
import { replayClash, clashJson, expectClash } from "@/lib/clash";
import { logAction, logError, deviceIdFrom, deviceBlocked } from "@/lib/oplog";
import { ADMIN_VIEW_ACTOR_ID } from "@/lib/logMarks";
import { liveOrdersAndItems, stripPlacedBy } from "@/lib/liveBoard";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { notifyAggregator } from "@/lib/aggregators";
import { platformLadder, parcelLadder, tableTagsLadder } from "@/lib/tableTags";
import { panelRestaurantId, emptyIdSegment } from "@/lib/panelScope";
import { invalidateFloor } from "@/lib/floorSummary";
import { raiseIssue } from "@/lib/issues";
import { worthLogging } from "@/lib/dbRefusal";
// ONE answer for a caught failure, so a database that didn't reply is told apart from a bug
// and the device can fall back to what it already has (lib/panelFailure.ts).
import { panelFailure } from "@/lib/panelFailure";
import { viewAsPerson, personLabel } from "@/lib/viewAsPerson";
// The print queue itself (mig 269 + 335) — shared with the manager route so two panels can never
// drift into two different ideas of what "claimed" means.
import { pendingKotJobs, claimKotJobs, finishKotJob, ordersAlreadyQueued, stationView, takeStation, releaseStation, mayClaim, waitingToPrint, STUCK_AFTER_MS} from "@/lib/printQueue";
// WHEN A COMPUTER OWNS THE PAPER, A SCREEN MUST NOT ALSO PRINT IT (mig 341). A helper prints on the
// printer the address book names; a screen prints on whatever that machine's default printer is. Both
// printing means the same ticket in two places — and the screen's copy is the one that comes out in
// the wrong room.
import { helperFor, targetFor, screenMayPrint } from "@/lib/printHelpers";

export const dynamic = "force-dynamic";

// Gate: only a logged-in KITCHEN user (or the admin super-user) may touch this.
async function gate(req: NextRequest): Promise<{ user: StaffUser | null } | NextResponse> {
  const g = await requireRole(req, "kitchen");
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
//  also honours the admin's "view as" restaurant.)

const nowIso = () => new Date().toISOString();

// The station heartbeat rides the board read, and it must never be the reason a board read fails —
// a screen that cannot say "still here" should still show its tickets.
async function touchStationSafe(rid: string, dev: string | null) {
  if (!dev) return;
  try { const { touchStation } = await import("@/lib/printQueue"); await touchStation(rid, dev); } catch { /* the next read tries again */ }
}

// Which tables carry a special mark right now — { "6": "vip", "12": "family" }.
//
// The kitchen ticket draws a 👑 VIP / 🏠 FAMILY / 🤝 GUEST badge so a cook can pull a marked
// table's food forward. It used to read `o.tag`, a column that does not exist on `orders`, so the
// badge never once rendered (T4 sweep, 2026-08-06). Orders don't carry the mark — the TABLE does —
// so the board ships the map and the panel looks the ticket's table up in it.
//
// Empty when the module isn't effective for this restaurant, matching the manager floor and the
// waiter tablet: a mark nobody can set or clear must not appear on paper or on the pass. Only
// marked tables have a row here, so this is a handful of rows at most.
async function tableTagMap(rid: string): Promise<Record<string, string>> {
  try {
    if (!(await tableTagsLadder(rid)).effective) return {};
    const rows = (await sb.from("table_tags").select("table_number, tag")
      .eq("restaurant_id", rid).limit(500)).data as { table_number: unknown; tag: unknown }[] | null;
    const out: Record<string, string> = {};
    for (const r of rows || []) {
      const t = String(r?.table_number ?? "").trim();
      const tag = String(r?.tag ?? "").trim();
      if (t && tag) out[t] = tag;
    }
    return out;
  } catch {
    // A mark is decoration on a cooking ticket. If this read fails the board must still arrive —
    // losing a badge is survivable, losing the pass is not.
    return {};
  }
}
 
// Keep the SQLSTATE on the thrown error: lib/dbRefusal reads it to tell a refused VALUE (400,
// the person must see it) from the server failing to answer (500, saved and retried).
const must = (r: any) => {
  if (r.error) { const e: any = new Error(r.error.message); e.code = r.error.code; e.details = r.error.details; throw e; }
  return r.data;
};
 
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
 
async function readBody(req: NextRequest): Promise<any> { try { return await req.json(); } catch { return {}; } }

type Ctx = { params: Promise<{ path?: string[] }> };

// ── GET /api/kitchen/board — today's live orders + items + dishes ────────────
// ── A BLOCKED DEVICE GOES DARK, IT DOES NOT JUST LOSE ITS BUTTONS (owner, 2026-08-18) ────────────
//
// Every WRITE on this route has checked `deviceBlocked(dev, rid)` since blocking shipped. The READ
// never did — so a screen the staff had deliberately blocked went on showing the live board in full
// and could only be stopped by pulling it off the wifi. The owner's word when this was put to him:
// **"do 9th goees completely black"**. Blocked now means blocked: the board refuses, and the panel
// paints a full-screen wall over everything (public/panels/<panel>/app.js → the `device_blocked`
// branch), so the device shows nothing at all.
//
// `reason: "device_blocked"` is a CODE, not prose — the panel branches on codes, never on wording
// (the house rule), so this can be re-worded any time without breaking the wall.
//
// MEMOISED FOR 30 SECONDS, and that is the whole cost of this feature. `deviceBlocked` is one small
// indexed read, but a board read is the most frequent thing this panel does — a realtime burst can
// fire several a second — and the egress rules are explicit that a hot path does not get a new
// per-request query. 30s is the same TTL the panel-entitlement cache uses (lib/userAuth.ts), and it
// means a block takes hold within half a minute, which is what "we blocked that screen" means in a
// real kitchen. A WRITE is never memoised: it still asks every time, exactly as before.
const blockMemo = new Map<string, { at: number; blocked: boolean }>();
const BLOCK_TTL_MS = 30_000;
async function blockedForRead(dev: string | null, rid: string): Promise<boolean> {
  if (!dev) return false;
  const key = `${rid}:${dev}`;
  const hit = blockMemo.get(key);
  if (hit && Date.now() - hit.at < BLOCK_TTL_MS) return hit.blocked;
  const blocked = await deviceBlocked(dev, rid);
  blockMemo.set(key, { at: Date.now(), blocked });
  // Bounded: a busy restaurant has a handful of devices, but nothing should grow without a ceiling.
  if (blockMemo.size > 500) for (const [k, v] of blockMemo) { if (Date.now() - v.at > BLOCK_TTL_MS) blockMemo.delete(k); }
  return blocked;
}
const BLOCKED_READ = () => NextResponse.json(
  { error: "This device has been blocked by staff.", reason: "device_blocked", blocked: true },
  { status: 403 },
);

export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
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
  // Blocked device → the whole screen goes dark (see the note by blockedForRead above).
  if (await blockedForRead(deviceIdFrom(req), rid)) return BLOCKED_READ();
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  try {

    // whoami — boot signal for the kitchen's hierarchy X-ray ribbon (Phase 4,
    // 2026-07-06). The kitchen has no permission-gated actions (yet), so this only
    // drives the "Admin view" marker; add capability maps here when kitchen gets any.
    if (path.join("/") === "whoami") {
      // ACTUAL-VIEW mode (owner, 2026-07-28): ?view=real on an admin-view tab is answered
      // as the real kitchen screen; simulated keeps the client's ribbon (the way back).
      // ?as=<staff id> (owner, 2026-08-02) names WHOSE screen this is — opened from that
      // person's profile. The KDS has no per-person settings, so the pin only puts their
      // name on the ribbon; nothing else differs. It does NOT flip to the real view (owner,
      // same day): the toggle is the only thing that does that, on every panel alike — and
      // here the two views are identical anyway, which the ribbon says out loud rather than
      // showing an empty "0 things off" list.
      const asPerson = await viewAsPerson(req, rid, g, "kitchen");
      const simulate = !g.user && new URL(req.url).searchParams.get("view") === "real";
      const actor = g.user ? g.user.role : simulate ? "kitchen" : "admin"; // no staff cookie = admin super-user
      return ok({ actor, higherView: !g.user && !simulate, simulated: simulate, asName: personLabel(asPerson) }); // admin-only, like the tablet's
    }

    if (path.join("/") === "board") {
      // TARGETED REFETCH (owner 2026-06-26 — egress cut): when a realtime breadcrumb names
      // ONE table, the kitchen asks for just that table's orders+items (?table=N) instead of
      // re-reading the whole board. Dishes/platform/settings are table-agnostic and a
      // platform/menu event always forces a FULL pass, so a targeted slice returns ONLY
      // { orders, items } — the panel merges them into the cached board. No param = full board.
      // ?table= must be a NUMBER (a non-numeric value reached the query and Postgres threw
      // "invalid input syntax for type integer", turning a refetch into a 500). A bad param
      // means "no targeted table" — a full, correct refresh — never an error.
      const tblRaw = new URL(req.url).searchParams.get("table");
      const tbl = tblRaw !== null && /^\d{1,6}$/.test(tblRaw.trim()) ? tblRaw.trim() : null;
      if (tbl) {
        // activeOnly=true: the kitchen board only shows received/preparing orders (a served
        // one has left the board), so we filter server-side — no point shipping served rows.
        // tableTags rides along on the TARGETED path too, and it has to: marking a table VIP
        // writes `table_tags`, whose breadcrumb carries that table's number, so the kitchen
        // answers it with THIS slice — not a full board read. Leave the tags out here and the
        // badge only appears on the next full refresh (up to 60s later), which is the whole
        // point of the mark. It's a two-column read of a table that only holds MARKED tables,
        // so it is far smaller than the orders it travels with.
        // ── AND THE PRINT QUEUE, WHEN THIS SCREEN IS THE PRINTER (mig 335, ?jobs=1) ──────────
        // A NEW ORDER'S BREADCRUMB NAMES ITS TABLE, so a new order is answered by THIS targeted
        // slice — not by a full board read. That is the right thing for egress and it was silently
        // wrong for printing: the queued ticket was only seen on the next FULL pass, i.e. up to 60
        // seconds later on the 60s backstop (measured, 2026-08-18, while building this). A KOT that
        // reaches the pass a minute after the order does is not auto-printing.
        // So the slice carries the queue too — but only when the panel says it is printing
        // (`jobs=1`, sent only while auto-print is on for this restaurant), so an ordinary kitchen
        // display's targeted refetch is exactly as cheap as it was. One indexed read
        // (print_jobs_active_idx) on the one device per restaurant that prints.
        const wantJobs = new URL(req.url).searchParams.get("jobs") === "1";
        const [live, tags, sliceJobs] = await Promise.all([
          liveOrdersAndItems(rid, [tbl], true),
          tableTagMap(rid),
          wantJobs ? pendingKotJobs(rid, { includeAuto: true }) : Promise.resolve([]),
        ]);
        // `guest: 1` rides along so a guest's own order can ring; the raw who-punched-it columns never leave the server (stripPlacedBy)
        return ok({ orders: stripPlacedBy(live.orders, true), items: live.items, tableTags: tags, printJobs: sliceJobs });
      }
      // Orders + dishes from the shared "live board" helper — today's tickets PLUS
      // any still-open session's, so a dish left cooking on an overnight table keeps
      // showing here (and matches the manager). Was a day-clipped fetch before.
      const [live, dishes, platform, settings, restaurant, platL, parcL, tableTags] = await Promise.all([
        liveOrdersAndItems(rid, undefined, true), // activeOnly: received/preparing only (board never shows served)
        sb.from("menu_items").select("id,title,category,tags").eq("restaurant_id", rid).order("category").limit(2000),
        // active platform (Zomato/Swiggy/takeaway) tickets — separate table, so dine-in is untouched.
        // Explicit columns (egress): the kitchen renders source/items/status/kot_no/created_at/
        // customer_name and NEVER reads `payload` (the raw webhook JSON) or `status_history` — the
        // two big JSON columns — so we drop ONLY those and keep every small column (verified unused
        // in the route + kitchen/app.js, so the board looks identical). (owner 2026-06-29)
        sb.from("aggregator_orders").select("id, source, external_id, status, order_id, created_at, customer_name, customer_phone, items, total, kot_no, accepted_at, accepted_by, updated_at, restaurant_id").eq("restaurant_id", rid).in("status", ["new", "accepted", "preparing", "ready"]).order("created_at").limit(500),
        // table_names (mig 131): the restaurant's own name for each table ("A1", "Patio"). The
        // kitchen shows it on the ticket AND prints it on the KOT — a cook/waiter must read the
        // SAME table label the floor uses, not the raw number (owner 2026-07-29). Small JSONB,
        // one row, table-agnostic — the targeted ?table=N slice never re-reads it.
        sb.from("settings").select("kitchen_can_accept_platform, auto_print_kot, auto_print_kot_allowed, platform_channels, table_names").eq("restaurant_id", rid).maybeSingle(),
        // THIS restaurant's identity, so the kitchen header shows which restaurant the
        // panel is scoped to (multi-tenant — never a hardcoded brand). Single-row PK lookup.
        sb.from("restaurants").select("id, slug, name, logo_text, accent_color").eq("id", rid).maybeSingle(),
        platformLadder(rid),
        parcelLadder(rid),
        // SPECIAL TABLE TYPES (mig 166) — 👑 VIP / 🏠 Family / 🤝 Owner's guest.
        //
        // The kitchen ticket has always TRIED to draw this badge, from `o.tag`. There is no such
        // column on `orders` and this board never joined `table_tags`, so `TAG_BADGE[undefined]`
        // was undefined and the badge was silently never rendered — for the whole life of the
        // feature (T4 sweep, 2026-08-06). The manager floor and the waiter tablet both read the
        // mark off the floor summary's per-tile `tag`; the kitchen renders ORDERS, not tiles, so
        // it needs the map keyed by table number instead.
        //
        // Gated by the same ladder the other two panels use, so a restaurant that has the module
        // switched off shows nothing rather than a mark nobody can clear.
        tableTagMap(rid),
      ]);
      // Only surface tickets whose feature is live (mig 209): delivery channels (zomato/swiggy/
      // website=takeaway) when the platform module is effective AND that channel is on; parcels
      // when the parcel module is effective. Belt-and-braces — if the admin switches a channel
      // off while tickets are still cooking, they drop off the kitchen board too.
      const kChan = ((must(settings) || {}) as { platform_channels?: Record<string, { on?: boolean }> }).platform_channels || {};
      const kOn = (k: string) => kChan?.[k]?.on === true;
      const kSources = new Set<string>();
      if (platL.effective) { if (kOn("zomato")) kSources.add("zomato"); if (kOn("swiggy")) kSources.add("swiggy"); if (kOn("website")) kSources.add("takeaway"); }
      if (parcL.effective) kSources.add("parcel");
      const platformRows = ((must(platform) || []) as { source?: string }[]).filter((r) => kSources.has(String(r.source)));
      // ── PRINT JOBS WAITING FOR THIS KITCHEN SCREEN (mig 269, widened by mig 335) ───
      // The durable queue: a ticket to print is a ROW, and this ride-along is how it reaches the
      // printer — on the very board read the order's own breadcrumb already triggers, so there is
      // NO new poll and nothing to time. A job 'printing' for over two minutes is offered again:
      // that means a tab died mid-print (closed, crashed, power), and abandoning it silently would
      // lose the ticket. The reading/claiming/reporting itself now lives in lib/printQueue.ts,
      // shared with the manager route so a second claimant can never drift from this one.
      //
      // `?autojobs=1` IS A PANEL-VERSION HANDSHAKE, not a preference. A kitchen panel from before
      // mig 335 prints new orders by diffing its own board; hand that panel the new auto rows as
      // well and every ticket comes out twice. Only a panel that has GIVEN UP its board diff asks
      // for them — and staff can legitimately be running a weeks-old panel
      // (verify:panel-cache / docs: "Staff can run a WEEKS-OLD panel"), so this has to be safe by
      // construction rather than by everyone updating at once.
      const autoJobs = new URL(req.url).searchParams.get("autojobs") === "1";
      // ── AND WHETHER THIS ROOM IS THE ONE THAT PRINTS ──────────────────────────────────────
      // The Kitchen slips ROUTE decides it, and nothing else does (mig 369). Until then this read
      // ALSO consulted mig 336's coarse `kot_print_target`, and the two could disagree — the sweep
      // caught the older one winning, so an owner who named the manager screen was refused by a
      // setting an admin had touched months before. One question, one answer.
      //
      // Why it matters that this room can be told NO: with the printer at the till, a kitchen screen
      // that also printed would put the same ticket in two rooms — measured, with a kitchen panel
      // left open on the same restaurant printing every ticket the counter was set to print.
      // A MANUAL REPRINT IS DIFFERENT and always reaches the kitchen: the manager pressing "Reprint
      // in kitchen" is naming this printer on purpose, whatever the automatic routing says.
      let kitchenMayAuto = true;
      // …AND WHETHER A COMPUTER HAS THE JOB AT ALL. With a helper named for kitchen slips, this
      // screen goes back to being an ordinary display: it stops being offered tickets, stops
      // healing, and says on its own printer sheet where the paper is coming out instead.
      const helper = await helperFor(rid, "kot");
      // WHO PRINTS, decided in ONE place (lib/printHelpers.screenMayPrint) — and now it can be narrowed
      // to a panel, a person and a device, because the owner asked to decide exactly that: "if I want
      // to print from kitchen panel or maybe from manager panel and which particular manager… which PC
      // will be open and from that same PC the print is going to happen".
      const target = await targetFor(rid, "kot");
      // The same precedence as the manager route: a route that NAMES a panel is the decision, and the
      // old coarse kitchen|counter|both target only speaks when no route does. Without this a route
      // saying "the kitchen screen prints" was still vetoed by an admin who had set "counter" months
      // ago — two settings, opposite answers, and the newer one losing (printing sweep, 2026-08-26).
      // A screen route names ONE room, and that is the whole answer. "The kitchen prints and the
      // counter picks up what it leaves" is gone with the backup screen (owner, 2026-08-30): paper
      // appearing in a room nobody is standing in is worse than paper that has not appeared,
      // because nobody learns the printer is broken. (This sentence was left spliced in half by
      // that edit — it still said "`backupPanel` counts too" and then contradicted itself.)
      if (target.kind === "screen") kitchenMayAuto = target.panel === "kitchen";
      else if (target.kind === "off" || target.kind === "computer") kitchenMayAuto = false;
      const mayI = screenMayPrint(target, { panel: "kitchen", personId: g.user?.id || null, deviceId: deviceIdFrom(req) });
      const screenPrints = kitchenMayAuto && mayI.ok;
      const printJobs = await pendingKotJobs(rid, { includeAuto: autoJobs && screenPrints });
      // WHICH ORDERS THE QUEUE HAS IN HAND — the panel's self-healing net (see lib/printQueue.ts →
      // ordersAlreadyQueued). Only asked when auto-print is on AND the panel is new enough to use
      // it: on a database that has not had mig 335 yet, nothing is queued, the panel sees these
      // orders are unclaimed by anyone and prints them the old way instead of going quiet.
      const autoOn = !!((must(settings) || {}).auto_print_kot && (must(settings) || {}).auto_print_kot_allowed);
      // The net must also stand down when this room isn't the printer, or it would "heal" a ticket
      // the counter is about to print.
      const queuedFor = autoJobs && autoOn && screenPrints
        ? await ordersAlreadyQueued(rid, (live.orders as { id: string; status?: string }[])
            .filter((o) => o.status === "received" || o.status === "preparing").map((o) => o.id))
        : [];
      // WHO IS PRINTING (mig 338). Every screen needs it, not just the printer: a cook whose tickets
      // are coming out at the counter should be able to read that on this screen instead of asking.
      // One tiny indexed read, and it doubles as this station's heartbeat when the station is us.
      const boardDev = deviceIdFrom(req);
      const station = await stationView(rid, boardDev);
      if (station.mine) await touchStationSafe(rid, boardDev);
      // HOW FAR BEHIND THE PRINTER IS (owner, 2026-08-27). It cannot be counted from `printJobs`
      // above, and that is the whole point: when a helper owns the kitchen slips this screen is
      // handed NOTHING on purpose, which is exactly the moment a cook needs to know that eleven
      // tickets are stacked up behind a dead printer. One round trip, count only, no rows.
      const waiting = await waitingToPrint(rid, "kot");
      return ok({
        printJobs, queuedFor, station,
        // { n, oldestMs } — and the threshold travels with it, so the panel never has to hold its
        // own copy of "how long is too long" (a second copy is how two screens start disagreeing
        // about whether the same printer is stuck).
        waiting, stuckAfterMs: STUCK_AFTER_MS,
        // same as the slice: `guest: 1` for a guest's own order, and the raw columns never leave
        orders: stripPlacedBy(live.orders, true), items: live.items, dishes: must(dishes),
        platform: platformRows,
        platformAccept: !!(must(settings) || {}).kitchen_can_accept_platform,
        // Auto-print KOT is ON only when the ADMIN allowed it AND the owner toggled it on
        // (mig 107). The kitchen panel prints a ticket for each brand-new order when true.
        // Auto-print is ON for this SCREEN only when the restaurant has it on AND this room is the
        // one the admin chose to print (mig 336). The panel uses it for the printer heartbeat too —
        // a kitchen screen that isn't printing goes back to being an ordinary display.
        autoPrintKot: autoOn && screenPrints,
        // Kept for the 🖨 sheet's plain-words line, but DERIVED from the route now — never stored.
        // A panel that is weeks old still reads this key, so it keeps its name and its three values.
        kotPrintTarget: target.kind === "screen"
          ? (target.panel === "manager" ? "counter" : "kitchen")
          : "kitchen",   // "both" retired with the backup screen
        // Who really prints, so the sheet can say "Kitchen slips print at: Shop's computer →
        // Printer_POS_80" instead of leaving a cook to guess why this screen is quiet.
        helper,
        // …and, when a SCREEN is the chosen printer, WHICH screen — so a kitchen tablet that is not
        // the named one says "printing happens on Rishi's manager screen" rather than going silent.
        printTarget: target, printRefused: mayI.ok ? null : mayI.why,
        // { "1": "A1", … } — display names only; every id/bill still uses the number.
        tableNames: ((must(settings) || {}) as { table_names?: Record<string, string> }).table_names || {},
        // { "6": "vip", … } — which tables are marked, so a cook can see a priority ticket.
        tableTags,
        restaurant: must(restaurant) || null,
      });
    }
    return err("unknown GET endpoint", 404);
  } catch (e) {
    if (worthLogging(e)) logError("kitchen", "route_error", e, { restaurant_id: rid, detail: `GET ${path.join("/") || "/"}` });
    return panelFailure(e);
  }
}

// Drop this restaurant's shared floor snapshot AFTER the write has landed, as well as before it
// (the long note is on the same wrapper in app/api/editor/[...path]/route.ts). Dropping it only
// at the start leaves a gap in which another device's whole-floor poll re-shares the pre-write
// floor for up to 1.5s — so a dish marked ready in the kitchen can still show as cooking on the
// manager's and waiter's tiles for a moment afterwards. The rid rides on a WeakMap keyed by the
// request object, so concurrent requests never mix. (sweep 2026-08-04)
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

// ── POST: accept / ready / item status / sold-out ────────────────────────────
// Wrapped so a replayed offline action runs at most once (see lib/idempotency.ts).
export const POST = withIdempotency(invalidateFloorAfter(postImpl), "kitchen");
async function postImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  // A write to this restaurant drops its shared floor snapshot, so the very next read
  // recomputes — no device can be handed a floor computed before the kitchen acted. The
  // manager and tablet routes have always done this; the kitchen never did, across all five
  // of its write paths (accept / ready / item status / platform status / sold-out), and the
  // guard that enforces the rule only ever looked at the other two routes.
  // Dropping it HERE is not enough on its own — invalidateFloorAfter() above drops it again
  // once the handler has finished, which is what makes "read your own write" actually true.
  if (rid) { invalidateFloor(rid); writeRid.set(req, rid); }
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  try {
    const [a, b, c] = path;
    // A missing client id arrives as literal "undefined"/"null"/"NaN" — reject before it
    // reaches a uuid query and throws the "invalid input syntax for type uuid" route_error.
    if (emptyIdSegment(b) || emptyIdSegment(c)) return err("Missing id — please refresh and try again.");
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which device (kitchen screen) is acting
    // Admin panel-view actions (no staff cookie) get the actor_id='admin:view' marker so the
    // ADMIN's log surfaces can attribute them; staff/owner reads mask it (owner 2026-07-28).
    // The signed-in kitchen user's name + stable id ride along so the Operation log says WHO
    // accepted/readied a ticket, not just "kitchen". (Kitchen has no staff PROFILE — the owner
    // ruled that out 2026-07-29 — but the log itself should still be honest about who acted.)
    const adminMark = g.user
      ? { actor: g.user.name || g.user.username, actor_id: g.user.id }
      : { actor_id: ADMIN_VIEW_ACTOR_ID };
    // A staff-blocked device can't do anything from the kitchen screen — but only where it was
    // BLOCKED. `rid` is resolved above (the route already refuses without one), so the ban is read
    // against this restaurant instead of platform-wide; see the note on deviceBlocked in lib/oplog.ts.
    if (await deviceBlocked(dev, rid)) return err("This device has been blocked by staff.", 403);

    // ── OFFLINE REPLAY CLASH (offline sync 2026-07-30) ────────────────────────────
    // A change saved on a screen with no signal, arriving only now, must not be applied
    // if the ground moved underneath it (the table was closed and billed, or a different
    // party is sitting there now). We refuse with a plain reason and the panel asks a
    // person to redo it — never a silent overwrite, never a silent drop. See lib/clash.ts.
    // A LIVE write carries no replay marker, so this returns without a single query.
    const clash = await replayClash(req, rid, a, b, c, body as Record<string, unknown> | null);
    if (clash) return clashJson(clash);

    // ── NO SILENT OVERWRITES (owner, 2026-07-30) ──────────────────────────────────
    // If the screen told us what it was editing FROM, refuse when someone else has since
    // changed it — and tell that person what it says now. One gate for every action here.
    const overwrite = await expectClash(req, rid);
    if (overwrite) return clashJson(overwrite);

    // ── Raise an issue / complaint (photo + voice note optional) ────────────────
    // The kitchen flags a problem (equipment, stock…) for THIS restaurant; owner +
    // admin see it. Media is uploaded first via /api/issue-media; the URLs arrive here.
    if (a === "issue") {
      const ib = body as { subject?: string; body?: string; image_url?: string; audio_url?: string };
      try {
        await raiseIssue({
          rid, subject: String(ib?.subject || ""), body: ib?.body,
          raisedBy: g.user?.name || g.user?.username || "Kitchen",
          raisedRole: g.user?.role || "kitchen",
          imageUrl: ib?.image_url, audioUrl: ib?.audio_url,
        });
      } catch (e) { return err(e instanceof Error ? e.message : "Couldn't raise the issue.", 400); }
      return ok({ ok: true });
    }

    // orders/:id/accept — everything not served → preparing
    if (a === "orders" && c === "accept") {
      // .eq(restaurant_id, rid) on EVERY by-id write: sb is the service-role client (RLS
      // bypassed), so this filter is the ONLY tenant boundary — without it a stale/foreign
      // order id would be actioned across restaurants (owner's isolation concern, 2026-07-03).
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!cur) return err("That order isn't on this restaurant's board any more.", 404);
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      // return=minimal: the client discards the body and re-fetches the board, so we skip
      // BOTH the .select() on the update and the full-row re-read (server↔DB egress saver).
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("restaurant_id", rid).eq("status", "received");
      await logAction("kitchen", "order_accept", { ...adminMark, order_id: b, device_id: dev, restaurant_id: rid });
      return ok({ ok: true });
    }

    // orders/:id/ready — kitchen finished the whole order: every dish → READY
    // (cooked, waiting for the waiter to carry it out). NOT served — serving is
    // the waiter's action on the tablet. Order stays "preparing" until served.
    if (a === "orders" && c === "ready") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!cur) return err("That order isn't on this restaurant's board any more.", 404);
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "ready" })) : [];
      // return=minimal: client discards the body and re-fetches the board → skip the full-row re-read.
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "ready" }).eq("order_id", b).eq("restaurant_id", rid).neq("status", "served");
      await logAction("kitchen", "order_ready", { ...adminMark, order_id: b, device_id: dev, restaurant_id: rid });
      return ok({ ok: true });
    }

    // orders/:id/unready — TAKE BACK an "ALL READY" in ONE request (owner-picked improvement,
    // 2026-08-07). The undo bar used to replay the snapshot one dish at a time — `for (const s of
    // snap) await api(...)` — so taking back a 12-dish ticket was 12 sequential round trips on
    // restaurant wifi, on the one action a cook reaches for immediately after a mistake. It is now
    // the exact mirror of /ready above.
    //
    // It restores each dish to the status it ACTUALLY had, not a blanket value: the body carries the
    // snapshot the panel captured before it flipped anything ([{ id, prev }]), because a ticket can
    // hold a mix — one dish still 'received', another already 'preparing' — and a blanket write would
    // quietly promote or demote the others. Ids are scoped to THIS order and this restaurant, so a
    // hand-formed body cannot reach another ticket's dishes.
    //
    // A dish that has since been SERVED is deliberately left alone: the waiter has already carried it
    // out, and un-serving it is a different, explicit action (the tablet's "↩ Send back to kitchen").
    if (a === "orders" && c === "unready") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!cur) return err("That order isn't on this restaurant's board any more.", 404);
      const raw = Array.isArray(body?.dishes) ? body.dishes : [];
      const VALID = ["received", "preparing", "ready"];
      // Normalise + drop anything unusable, then cap: a ticket has tens of lines, never thousands.
      const snap = raw
        .map((d: any) => ({ id: String(d?.id ?? ""), prev: String(d?.prev ?? "") }))
        .filter((d: { id: string; prev: string }) => d.id && VALID.includes(d.prev))
        .slice(0, 200);
      if (!snap.length) return err("Nothing to take back — refresh the board and try again.", 400);
      // Only rows that really belong to THIS order in THIS restaurant may be touched.
      const mine = must(await sb.from("order_items").select("id, status")
        .eq("order_id", b).eq("restaurant_id", rid)
        .in("id", snap.map((d: { id: string }) => d.id))) as { id: string; status: string }[];
      const byId = new Map(mine.map((r) => [r.id, r.status]));
      // Group by target status so a mixed ticket costs ONE update per distinct status (at most three)
      // instead of one per dish — which is the whole point of this endpoint.
      const groups = new Map<string, string[]>();
      for (const d of snap) {
        const wasNow = byId.get(d.id);
        if (wasNow === undefined) continue;          // gone, or not ours
        if (wasNow === "served") continue;           // already carried out — see the note above
        if (wasNow === d.prev) continue;             // nothing to change
        if (!groups.has(d.prev)) groups.set(d.prev, []);
        groups.get(d.prev)!.push(d.id);
      }
      if (!groups.size) return err("Those dishes have already moved on — refresh the board.", 409);
      let moved = 0;
      for (const [status, ids] of groups) {
        // served_at back to null: these are all pre-served states, and a row must never keep a
        // "served at" time it no longer earns (same rule as items/:id/status).
        must(await sb.from("order_items").update({ status, served_at: null })
          .in("id", ids).eq("order_id", b).eq("restaurant_id", rid).select("id"));
        moved += ids.length;
      }
      // Roll the parent order up from what the rows now say — identical to the items/:id/status
      // rollup below, so the two paths can never leave the order disagreeing with its dishes.
      const rows = must(await sb.from("order_items").select("status").eq("order_id", b).eq("restaurant_id", rid));
      const served = rows.filter((r: any) => r.status === "served").length;
      const anyActive = rows.some((r: any) => ["preparing", "ready", "served"].includes(r.status));
      const overall = served === rows.length && rows.length > 0 ? "served" : anyActive ? "preparing" : "received";
      const its = Array.isArray(cur.items)
        ? cur.items.map((i: any) => (i.status === "served" ? i : { ...i, status: overall === "received" ? "received" : "preparing" }))
        : [];
      must(await sb.from("orders").update({ items: its, status: overall }).eq("id", b).eq("restaurant_id", rid));
      await logAction("kitchen", "order_unready", { ...adminMark, order_id: b, detail: `${moved} ${moved === 1 ? "dish" : "dishes"} taken back`, device_id: dev, restaurant_id: rid });
      return ok({ ok: true, count: moved });
    }

    // items/:id/status — one dish moved along, with order rollup. The kitchen
    // sends "ready" (cooked); the tablet sends "served" (delivered).
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "ready", "served"].includes(status)) return err("invalid status");

      const patch: any = { status };
      // Serving stamps served_at; sending a dish back to a pre-served state (undo a
      // mis-tap) must clear it again so the row never keeps a stale time (2026-07-22).
      patch.served_at = status === "served" ? nowIso() : null;
      // Only need order_id to roll the parent up; the client discards the body → no full row.
      // Scoped by rid so a foreign dish id can't be advanced (service-role bypasses RLS).
      const updated = must(await sb.from("order_items").update(patch).eq("id", b).eq("restaurant_id", rid).select("order_id"));
      const item = updated[0];
      // A TAP THAT MOVED NOTHING MUST NOT REPORT SUCCESS (sweep 2026-08-04). The update is scoped by
      // rid, so it matches no row when the dish is gone — a stale board, a KOT the manager just
      // cancelled, another restaurant's id. This used to fall through to `ok({ ok: true })`: the cook
      // saw the dish go green and the waiter never saw it. The sibling accept/ready branches above
      // have always 404'd here; this is the same answer, in the same words a person can act on.
      if (!item) return err("That dish isn't on this restaurant's board any more — refresh and try again.", 404);
      if (item.order_id) {
        const rows = must(await sb.from("order_items").select("status").eq("order_id", item.order_id).eq("restaurant_id", rid));

        const served = rows.filter((r: any) => r.status === "served").length;

        const anyActive = rows.some((r: any) => ["preparing", "ready", "served"].includes(r.status));
        const overall = served === rows.length && rows.length > 0 ? "served" : anyActive ? "preparing" : "received";
        await sb.from("orders").update({ status: overall }).eq("id", item.order_id).eq("restaurant_id", rid);
      }
      // Moving ONE dish along is the kitchen's most frequent action and it was the only one here with
      // no record — so "who marked this ready, and when?" had no answer, and a cook's own Activity
      // under-counted their shift. Every sibling action in this file already logs.
      await logAction("kitchen", "item_status", { ...adminMark, order_id: item.order_id ?? null, detail: status, device_id: dev, restaurant_id: rid });
      return ok({ ok: true });
    }

    // platform/:id/status — kitchen advances a platform (Zomato/Swiggy/takeaway)
    // order. ACCEPTING is gated by the manager's "kitchen can accept platform
    // orders" toggle; once it's in the queue, cooking it through is the kitchen's job.
    if (a === "platform" && c === "status") {
      const status = body && body.status;
      if (!["accepted", "preparing", "ready", "handed_over"].includes(status)) return err("invalid status");
      // lfh_platform_set_status updates by id with NO tenant scope (mig 071), so confirm
      // this platform order belongs to THIS restaurant first (service-role bypasses RLS).
      // Also read its CURRENT status for the accept-gate below.
      const owns = must(await sb.from("aggregator_orders").select("id, status").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!owns) return err("That platform order isn't for this restaurant.", 404);
      // The MANAGER owns ACCEPTING (moving a still-'new' order forward). If the kitchen isn't
      // allowed to accept platform orders, it may not advance a 'new' one by ANY status — not
      // just the literal "accepted" (audit 2026-07-07: the old gate only checked
      // status==='accepted', and the RPC has no from-state guard). Once past 'new', cooking it
      // through is the kitchen's job. The UI already hides the button; this is belt-and-braces.
      if (owns.status === "new") {
        const s = await sb.from("settings").select("kitchen_can_accept_platform").eq("restaurant_id", rid).maybeSingle();
        if (!(s.data && s.data.kitchen_can_accept_platform)) {
          return err("The kitchen isn't allowed to accept platform orders — the manager accepts them.", 403);
        }
      }
      const { data, error } = await sb.rpc("lfh_platform_set_status", { p_id: b, p_status: status, p_by: "kitchen" });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      void notifyAggregator(row?.source, row?.external_id, status); // best-effort push back to the platform (dormant w/o keys)
      await logAction("kitchen", "platform_status", { ...adminMark, detail: status, device_id: dev, restaurant_id: rid });
      return ok(row);
    }

    // dishes/:id/sold-out — toggle the 'sold-out' tag (the 86 board)
    if (a === "dishes" && c === "sold-out") {
      const value = !!(body && body.value === true);
      const cur = must(await sb.from("menu_items").select("tags").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!cur) return err("That dish isn't on this restaurant's menu.", 404);
      const tags = Array.isArray(cur.tags) ? cur.tags.filter((t: string) => t !== "sold-out") : [];
      if (value) tags.push("sold-out");
      const row = must(await sb.from("menu_items").update({ tags }).eq("id", b).eq("restaurant_id", rid).select());
      // AND TELL THE GUESTS (T13 sweep, 2026-08-05). The guest menu does NOT read menu_items — it
      // reads the server-side cached bundle (lib/menuDataServer.ts), and the ONLY thing that gets a
      // change in front of a guest promptly is purging that restaurant's tag. The manager panel's
      // sold-out toggle goes through the editor route's upsert, which busts it; the 86 board is the
      // same action from the other side and never did. So a cook marked a dish sold out, the
      // breadcrumb this UPDATE raises made every guest phone refetch — and each refetch was handed
      // the same stale bundle, which still said the dish was available. Guests kept ordering it and
      // kept being refused at Place Order, with the waiter's tablet and this board both showing it
      // correctly, so nobody on the floor could see why. The backstop is `revalidate: 86400`, so
      // "eventually" meant up to 24 HOURS, not the 120s an old comment promised.
      // Best-effort on purpose: a bust failure must never fail the 86 itself.
      // `{ expire: 0 }` — see the note on bustMenuCache in the editor route: the "max" profile hands
      // the OLD bundle to the next reader, which on a sold-out is the one thing we cannot do.
      try { revalidateTag(menuTag(rid), { expire: 0 }); } catch { /* the revalidate window is the backstop */ }
      await logAction("kitchen", value ? "sold_out_on" : "sold_out_off", { ...adminMark, detail: b, device_id: dev, restaurant_id: rid });
      return ok(row[0] || null);
    }

    // ── print-jobs/claim — atomically win the queued jobs this screen is about to print ──
    // (mig 269). The single UPDATE with a status filter IS the lock: with two kitchen tabs
    // open, the second one's update matches zero rows, so a ticket can never print twice.
    // A 'printing' row whose claim is over 2 minutes old is winnable again — its tab died.
    if (a === "print-jobs" && b === "claim") {
      const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(String).slice(0, 20) : [];
      if (!ids.length) return ok({ won: [] });
      // ── ONE SCREEN IS THE PRINTER (mig 338) ────────────────────────────────────────────────
      // Asked HERE, not on the panel: two entitled kitchen tabs used to both claim and the winner
      // was a coin flip. The gate also TAKES the station when nobody holds it (so a kitchen that has
      // always just printed keeps doing exactly that) and refuses when a live screen elsewhere holds
      // it, telling this one where the paper is coming out.
      const st = must(await sb.from("settings").select("auto_print_kot, auto_print_kot_allowed").eq("restaurant_id", rid).maybeSingle()) as
        { auto_print_kot?: boolean; auto_print_kot_allowed?: boolean } | null;
      // A COMPUTER OWNS IT — a screen may not take it (mig 341). Checked here as well as on the
      // board read, because a panel that was open BEFORE the route was set still holds tickets it
      // believes are its to print: a gate that lives only in the board read is a gate a stale tab
      // walks straight through. The reason travels back so the sheet can say where it prints now.
      // The claim is checked against the same resolver, with the person and device taken from the
      // REQUEST — never from the panel's word for itself. A tab opened before the setting changed
      // walks into this, which is the whole reason the check lives here as well as on the board read.
      const tgt = await targetFor(rid, "kot");
      const may = screenMayPrint(tgt, { panel: "kitchen", personId: g.user?.id || null, deviceId: dev });
      if (!may.ok) {
        return ok({ won: [], refused: may.why === "computer" ? "helper" : may.why, printTarget: tgt,
                    helper: await helperFor(rid, "kot"), station: await stationView(rid, dev) });
      }
      const gate = await mayClaim(rid, {
        deviceId: dev, panel: "kitchen", label: "Kitchen screen",
        auto: st?.auto_print_kot === true && st?.auto_print_kot_allowed === true,
        // screenMayPrint above has already answered this for the route (mig 369) — including the
        // backup case — so by the time we reach here the room IS allowed. Passing the answer rather
        // than re-deriving it from a retired column is what stops the two drifting apart again.
        roomAllowed: true,
        by: g.user?.name || g.user?.username || null,
      });
      if (!gate.ok) return ok({ won: [], refused: gate.reason, station: gate.station });
      return ok({ won: await claimKotJobs(rid, ids), station: gate.station });
    }

    // ── print-station/take · /release — "print HERE instead", and "stop printing here" ──────────
    // The one tap that moves a restaurant's printing to the screen the person is standing at. It is a
    // write, so it rides the outbox like every other panel write; replaying it late is harmless (the
    // worst case is the station moving to a screen that then goes quiet, and quiet stations are
    // taken over automatically after a few minutes).
    if (a === "print-station" && b === "take") {
      if (!dev) return err("This browser has no device id yet — reload the panel and try again.", 409);
      const st2 = must(await sb.from("settings").select("auto_print_kot, auto_print_kot_allowed").eq("restaurant_id", rid).maybeSingle()) as
        { auto_print_kot?: boolean; auto_print_kot_allowed?: boolean } | null;
      if (!(st2?.auto_print_kot === true && st2?.auto_print_kot_allowed === true)) return err("Automatic printing is switched off for this restaurant.", 409);
      // The ROUTE decides whether this room may hold printing at all (mig 369), asked through the one
      // resolver every other path uses — with the person and device from the REQUEST, so a narrowed
      // route ("only Rishi's counter PC") refuses a kitchen screen here too.
      const tgTake = await targetFor(rid, "kot");
      const mayTake = screenMayPrint(tgTake, { panel: "kitchen", personId: g.user?.id || null, deviceId: dev });
      if (!mayTake.ok) return err(
        tgTake.kind === "computer" ? "A computer prints this restaurant's kitchen slips — no screen needs to."
        : tgTake.kind === "off" ? "Kitchen slips are switched off for this restaurant."
        : "Kitchen slips are set to print on another screen.", 409);
      const view = await takeStation(rid, { deviceId: dev, label: "Kitchen screen", panel: "kitchen", by: g.user?.name || g.user?.username || null });
      await logAction("kitchen", "print_station_take", { ...adminMark, device_id: dev, restaurant_id: rid, detail: "this kitchen screen is now the printer" });
      return ok({ ok: true, station: view });
    }
    if (a === "print-station" && b === "release") {
      if (dev) await releaseStation(rid, dev);
      await logAction("kitchen", "print_station_release", { ...adminMark, device_id: dev, restaurant_id: rid, detail: "this kitchen screen stopped printing" });
      return ok({ ok: true, station: await stationView(rid, dev) });
    }

    // ── print-jobs/:id/done — the printed/failed report closes the loop ──────────────
    // ok:true also RESOLVES every open printer problem: a sheet of paper coming out is the
    // one proof the printer works, so the manager's warning clears itself (the auto-solve
    // the owner asked for, 2026-08-04). ok:false re-queues with a counted attempt; after 5
    // the job parks as 'failed', which is what the manager's floor strip surfaces.
    if (a === "print-jobs" && c === "done") {
      const okPrint = !!(body && body.ok === true);
      // One shared implementation (lib/printQueue.ts) does the row work and hands back what was on
      // the paper, so the diary line can name the KOT and the table instead of a job uuid nobody
      // can look up.
      const r = await finishKotJob(rid, String(b), okPrint, body?.error ? String(body.error) : undefined);
      if (!r.found) return err("That print job is gone.", 404);
      if (okPrint) {
        // ── A TICKET COMING OUT OF THE PRINTER IS AN EVENT WORTH KEEPING (owner, 2026-08-14) ─────
        // The printer had exactly one kind of Activity row — `printer_problem`, raised by a person
        // tapping "paper out". So the log could say the printer was complained about and never that
        // it worked, which makes "was the printer playing up on Saturday?" unanswerable from the one
        // screen built to answer questions like that.
        // Deliberately `info`: a ticket printing is normal service, not a notable event, so it never
        // colours a row or rings the bell — it is there to be counted and filtered.
        await logAction("kitchen", "kot_printed", {
          ...adminMark, order_id: r.orderId, table_number: r.tableNumber,
          device_id: dev, restaurant_id: rid,
          detail: `${r.reprint ? "reprinted" : "printed"} KOT${r.kotNo != null ? ` #${r.kotNo}` : ""}`,
        });
        return ok({ ok: true });
      }
      // The other half of the same story. `warn` once it has given up after five tries — that IS
      // notable, it means a ticket never reached the pass — and plain `info` while it is still
      // retrying, so a flaky first attempt doesn't colour the log red.
      await logAction("kitchen", "kot_print_failed", {
        ...adminMark, order_id: r.orderId, device_id: dev, restaurant_id: rid,
        level: r.parked ? "warn" : "info",
        detail: r.parked
          ? `gave up after ${r.attempts} tries — ${String(body?.error || "print failed").slice(0, 120)}`
          : `try ${r.attempts} failed — ${String(body?.error || "print failed").slice(0, 120)}`,
      });
      return ok({ ok: true, attempts: r.attempts });
    }

    // ── printer-events — a printer problem, reported by a person or by the code ──────
    // One tap in the kitchen (paper out / half print / jam — the faults a browser
    // genuinely cannot see) or the automatic 'auto_fail' when a print call throws. An
    // already-open event of the same kind is MERGED (count+1), never duplicated — a rush
    // with a dead printer must not bury the manager's floor in rows.
    if (a === "printer-events" && path.length === 1) {
      const kinds = ["paper_out", "half_print", "jam", "other", "auto_fail"];
      const kind = String(body?.kind || "");
      if (!kinds.includes(kind)) return err("invalid problem kind");
      const note = typeof body?.note === "string" ? body.note.trim().slice(0, 300) : null;
      const by = g.user?.name || g.user?.username || "Kitchen";
      // WHICH PRINTER IS THIS ABOUT (mig 351). A cook reporting "paper out" is standing at ONE
      // printer — the one this restaurant's address book sends kitchen slips to. Recording it is what
      // lets a later successful print close this complaint and NOT the bill printer's, and what lets
      // the manager's floor say which printer to go and look at.
      // The complaint may also name the printer explicitly (a screen that knows better); a null
      // stays null, and the old restaurant-wide behaviour applies to it, deliberately.
      const own = await helperFor(rid, "kot");
      const aboutPrinter = (typeof body?.printer === "string" && body.printer.trim().slice(0, 120)) || own.printer || null;
      // Merged per KIND *and per printer*: two printers out of paper are two problems, and burying one
      // inside the other's count is how the second one never gets looked at.
      let openQ = sb.from("printer_events").select("id, count").eq("restaurant_id", rid).eq("status", "open").eq("kind", kind);
      openQ = aboutPrinter ? openQ.eq("printer", aboutPrinter) : openQ.is("printer", null);
      const open = must(await openQ.limit(1));
      if (open && open.length) {
        must(await sb.from("printer_events").update({ count: (open[0].count || 1) + 1, last_at: nowIso(), ...(note ? { note } : {}) }).eq("id", open[0].id).eq("restaurant_id", rid));
      } else {
        must(await sb.from("printer_events").insert({ restaurant_id: rid, kind, note, reported_by: by, printer: aboutPrinter }));
      }
      await logAction("kitchen", "printer_problem", { ...adminMark, detail: kind, device_id: dev, restaurant_id: rid });
      return ok({ ok: true });
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    if (worthLogging(e)) logError("kitchen", "route_error", e, { restaurant_id: rid, detail: `POST ${path.join("/") || "/"}` });
    return panelFailure(e);
  }
}
