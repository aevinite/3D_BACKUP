// /api/admin/printing/* — the admin console's Printing menu.
//
// Everything about a restaurant's printing lives behind this one door: the computers that can print
// (print_agents, mig 341), the address book that says which kind of paper goes to which printer, the
// install text for a new computer, and a test page. It is the admin's screen because printing is
// hardware: the owner is offered what the admin allows and nothing else.
//
// ADMIN-GATED like all its siblings — tokenIsValid BEFORE any database call, on every verb.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
// Read every row of a one-row-per-restaurant table, past PostgREST's cap — see lib/pageAll.ts.
import { pageAll } from "@/lib/pageAll";
// Plain words for the console; the database's own words stay in the body + the log (lib/adminFail).
import { adminFail } from "@/lib/adminFail";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import {
  agentsView, createAgent, readRoutes, writeRoutes, mintAgentToken,
  PRINT_KINDS, HELPER_STALE_MS, ROUTE_PANELS, syncKotSwitch,
} from "@/lib/printHelpers";
// The board itself — headings, words, paper sizes and the four steps — is shared with the panel, so
// the two screens cannot drift into two different products (owner, 2026-08-27: "the UI/UX is also
// not identical"). lib/printBoard.ts is the single copy.
import { printBoardState, helperFiles, stationFiles } from "@/lib/printBoard";
import { STUCK_AFTER_MS } from "@/lib/printQueue";
import { managerHasFlag } from "@/lib/managerCan";
import { helperScript, HELPER_FILENAME, HELPER_AUTOSTART, type HelperOs } from "@/lib/printHelperScript";
import { queueJob } from "@/lib/printHelpers";

export const dynamic = "force-dynamic";

// AWAIT IT. tokenIsValid is async, and `if (!admin(req))` tests a PROMISE — which is always truthy,
// so the gate never fired and an uncookied request got a restaurant's printing state, its helper
// names and its routes (found on the deployed site 2026-08-20, minutes after shipping). Every
// sibling admin route writes `if (!(await admin(req)))`; this one now does too, and
// verify:print-helper fails if the await is ever dropped again.
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const OS_LIST: HelperOs[] = ["mac", "windows", "linux"];
// THE ID'S SHAPE, BEFORE IT REACHES A UUID COLUMN (T19 sweep #7, 2026-09-01). Every sibling admin
// route checks this and this one did not: `?rid=nonsense` went straight into
// `.eq("restaurant_id", rid)`, so every read behind the board was refused by the database and the
// screen rendered as a restaurant with no computers and no printers, rather than saying the link was
// wrong. A stale bookmark is the ordinary way that happens.
const RID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const needRid = (rid: string) => (!rid ? "Which restaurant?" : !RID_UUID.test(rid) ? "That isn't a restaurant." : null);

/** The install text for every operating system, with this machine's own code already in it. Shown
 *  ONCE, when the code is minted or replaced: the code is stored only as a hash, so it cannot be
 *  read back later — a lost code is REPLACED, never recovered. That is deliberate, and the screen
 *  says so beside the button. */
const scriptsFor = (origin: string, code: string, label: string) =>
  Object.fromEntries(OS_LIST.map((os) => [os, {
    filename: HELPER_FILENAME[os], autostart: HELPER_AUTOSTART[os],
    text: helperScript(os, { origin, code, label }),
  }]));

// The site the helper must talk to: THIS deployment, taken from the request rather than a constant,
// so a code minted on backup points at backup and one minted on the live site points at the live
// site. A helper aimed at the wrong site is a machine that never prints and says nothing.
const originOf = (req: NextRequest) => {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await admin(req))) return err("Not authorised", 401);
  const { path } = await ctx.params;
  const seg = (path || []).map(String);
  // ── EVERY RESTAURANT, ONE ROW ─────────────────────────────────────────────────────────────
  // Owner, 2026-08-27: *"it will be messy when there will be too much restaurants… I could be able
  // to differentiate all the restaurants."* He was right — the board showed ONE restaurant at a
  // time, chosen from a dropdown, so finding out whose printer was down meant clicking through all
  // of them.
  //
  // FOUR READS FOR THE WHOLE PLATFORM, not four per restaurant. Every one is a whole-table read with
  // a column list, grouped in memory: the alternative (a loop of per-restaurant queries) is the
  // N+1 shape the egress rule exists to refuse, and it would get slower with every client signed.
  if (seg[0] === "overview") {
    const [rests, agents, sets, jobs] = await Promise.all([
      // ── PAGED — THE COMBINED VERSION (T28 + T20, 2026-08-31) ────────────────────────────────────
      // Two sessions fixed this line independently. T28 added `.limit(400)` to match its three
      // siblings below, with the right diagnosis: without a ceiling PostgREST applies its own default
      // cap and silently returns a SHORT list, so the overview would stop showing later restaurants
      // with no error anywhere. T20 moved it onto lib/pageAll.
      //
      // Paging wins here for one reason: this list IS the board — every row on the Printing overview
      // is one of these restaurants — so a ceiling of any size is still a board that silently stops
      // being the whole platform, which is the exact fault being fixed, moved to a different number.
      // The comment above the batch is right that four whole-platform reads beat an N+1 loop; paging
      // keeps that (no extra round trip below a thousand restaurants) and removes the silent cut.
      pageAll<{ id: string; name: string; slug: string }>("restaurants", (from, to) =>
        sb.from("restaurants").select("id, name, slug").order("name").range(from, to)),
      sb.from("print_agents").select("id, restaurant_id, name, last_seen_at, printers")
        .is("revoked_at", null).limit(400),
      sb.from("settings").select("restaurant_id, auto_print_kot, auto_print_kot_allowed, modules").limit(400),
      // Only what is STILL WAITING, and only the two columns needed to count it and age it.
      sb.from("print_jobs").select("restaurant_id, kind, created_at")
        .in("status", ["queued", "printing"]).eq("kind", "kot").limit(2000),
    ]);
    // …AND THE OTHER THREE, for the same reason one line down (item 20, T19 sweep #7, 2026-09-01).
    // The restaurants read was checked; these were not, and each one silently redraws the board as a
    // different lie: with `agents` failed every restaurant reads "no computer", with `settings` failed
    // printing reads as switched off everywhere, and with `jobs` failed nothing is ever waiting. This
    // is a HARDWARE board — the answer decides whether he goes and looks at a shop's PC — so a wrong
    // picture is worse than an error. Nothing here is partial-renderable: the rows are the board.
    // AN EMPTY BOARD IS NOT "NO RESTAURANTS". Every row below is built from this list, so a failed
    // read answered a 200 with `rows: []` — a Printing overview showing nothing at all, which reads
    // as a healthy platform with nobody printing. Same rule as its neighbours in this console.
    if (rests.error) return adminFail("the printing overview", rests.error as { message?: string }, { action: "load" });
    if (agents.error) return adminFail("the printing overview", agents.error, { action: "load" });
    if (sets.error) return adminFail("the printing overview", sets.error, { action: "load" });
    if (jobs.error) return adminFail("the printing overview", jobs.error, { action: "load" });
    const now = Date.now();
    const byRest = new Map<string, { n: number; oldest: number | null }>();
    for (const j of (jobs.data || []) as { restaurant_id: string; created_at: string }[]) {
      const cur = byRest.get(j.restaurant_id) || { n: 0, oldest: null };
      cur.n++;
      const age = now - new Date(j.created_at).getTime();
      if (cur.oldest == null || age > cur.oldest) cur.oldest = age;
      byRest.set(j.restaurant_id, cur);
    }
    const agentsBy = new Map<string, { id: string; name: string; last_seen_at: string | null; printers: unknown }[]>();
    for (const a of (agents.data || []) as { restaurant_id: string; id: string; name: string; last_seen_at: string | null; printers: unknown }[]) {
      const arr = agentsBy.get(a.restaurant_id) || []; arr.push(a); agentsBy.set(a.restaurant_id, arr);
    }
    const setBy = new Map((((sets.data || []) as { restaurant_id: string }[])).map((x) => [x.restaurant_id, x as Record<string, unknown>]));

    const rows = ((rests.rows || [])).map((r) => {
      const mine = agentsBy.get(r.id) || [];
      const alive = mine.filter((a) => a.last_seen_at && now - new Date(a.last_seen_at).getTime() < HELPER_STALE_MS);
      const st = setBy.get(r.id) || {};
      const bag = (st.modules && typeof st.modules === "object" ? st.modules as Record<string, Record<string, unknown>> : {})["printing"];
      const routes = (bag && typeof bag.routes === "object" ? bag.routes as Record<string, unknown> : {});
      const w = byRest.get(r.id) || { n: 0, oldest: null };
      return {
        id: r.id, slug: r.slug, name: r.name,
        allowed: st.auto_print_kot_allowed === true,
        on: st.auto_print_kot === true,
        computers: mine.length,
        connected: alive.length,
        // The freshest "seen", because "is ANY of their computers alive" is the question.
        secondsAgo: mine.length
          ? Math.min(...mine.map((a) => a.last_seen_at ? Math.round((now - new Date(a.last_seen_at).getTime()) / 1000) : 10 ** 9))
          : null,
        names: mine.map((a) => a.name).slice(0, 4),
        routed: Object.keys(routes).filter((k) => {
          const v = routes[k] as Record<string, unknown> | null;
          return !!v && (v.via === "off" || v.via === "screen" || !!v.agent);
        }).length,
        waiting: w.n,
        oldestMs: w.oldest,
      };
    });
    return NextResponse.json({ rows, staleMs: HELPER_STALE_MS, stuckAfterMs: STUCK_AFTER_MS });
  }

  // THE OVERVIEW IS ASKED FIRST, because it is the one read with no restaurant behind it. It used to
  // sit below this line and every request answered 400 — the page rendered nothing and said nothing
  // (caught by driving it, 2026-08-27).
  const rid = new URL(req.url).searchParams.get("rid") || "";
  const ridBad = needRid(rid);
  if (ridBad) return err(ridBad);

  if (!seg.length || seg[0] === "state") {
    // ONE read of the shared board — the same call the restaurant's own Settings → Printing makes,
    // so neither screen can show a fact the other does not have.
    const board = await printBoardState(rid, { recent: 12 });
    // ── WHO can be picked as the printing SCREEN, and WHICH PC ────────────────────────────────
    // The owner asked to choose the panel, the person and the machine ("which particular manager…
    // which owner panel… which PC will be open"). All three lists are read from real rows, so the
    // pickers can only ever offer people and machines that exist:
    //   · people — this restaurant's staff, with the roles that can stand at each panel, and for a
    //     manager ONLY if their own "May be the printer" permission is on (accessTree "print_here").
    //     A person switched off is not offered, which is what makes that permission mean something.
    //   · devices — the screens that have actually been the printer before (print_stations), so "that
    //     same PC" is a thing he recognises rather than a hex id he has to guess at.
    // CHECKED, because an empty picker is a sentence about the restaurant (item 20, 2026-09-01). With
    // this read's failure swallowed, `people` came back empty and the board said "there is no kitchen
    // panel available" — the exact words the note below records the owner hitting for real, from a
    // different cause. An empty list and an unreadable list must not look the same on a screen whose
    // job is choosing who prints.
    const staffQ = await sb.from("staff_users").select("id, name, username, role, active, permissions")
      // A CEILING, so PostgREST's own default cannot silently shorten this picker (T17 sweep #7,
      // 2026-08-27). One restaurant's staff, and every other read in this file already states one.
      .eq("restaurant_id", rid).order("role").limit(500);
    if (staffQ.error) return adminFail("this restaurant's printing board", staffQ.error, { action: "load" });
    const staff = (staffQ.data || []) as
      { id: string; name?: string | null; username?: string | null; role?: string | null; active?: boolean | null;
        permissions?: Record<string, string> | null }[];
    // ── PER PERSON, NOT PER RESTAURANT (owner's review, 2026-08-28) ───────────────────────────
    // This resolved "may be the printer" from the restaurant-wide grant ALONE, while the comment
    // above claimed it was each person's own permission. So a manager switched off INDIVIDUALLY was
    // still offered here — pick them, the board says their screen is the printer, and their screen
    // is refused by managerCan: the kitchen never gets the paper and neither screen says why. It
    // failed the other way too — a manager allowed individually could not be picked at all while the
    // restaurant default was off.
    //
    // Both sides call managerHasFlag() now, so the picker and the gate cannot disagree. `access_config`
    // is read as well because it is the CAP: switched off there, nobody may, whatever their own
    // setting says. Still ONE extra column on a query already being made.
    // Checked too: this row is the CAP on who may print, so reading it as absent would offer people
    // the gate then refuses — the very disagreement the note above was written to end.
    const permsQ = await sb.from("restaurants").select("manager_permissions, access_config").eq("id", rid).maybeSingle();
    if (permsQ.error) return adminFail("this restaurant's printing board", permsQ.error, { action: "load" });
    const perms = permsQ.data as
      { manager_permissions?: Record<string, unknown> | null; access_config?: Record<string, { on?: boolean }> | null } | null;
    const mayBePrinter = (u: { role?: string | null; permissions?: Record<string, string> | null }) =>
      managerHasFlag("print_here", {
        accessConfig: perms?.access_config,
        managerPermissions: perms?.manager_permissions,
        ownOverride: u.permissions?.["print_here"],
      });
    // EVERY ACTIVE PERSON IS OFFERED, and the panel is simply the screen they stand at.
    //
    // It used to hide any manager whose "May be the printer" permission was off, which is how the
    // owner ended up being sent to Access & permissions in the middle of setting a printer up —
    // and, when the kitchen was the only role never gated, why he found "there is not kitchen panel
    // available" for the people he most wanted to name. Naming somebody here IS the permission now
    // (the pending gate honours an explicit choice), so the picker's job is only to list who exists.
    const people = staff.filter((u) => u.active !== false).map((u) => {
      const role = String(u.role || "");
      const panels = role === "kitchen" ? ["kitchen"]
        : role === "owner" ? ["manager", "owner"]
        : role === "tablet" || role === "waiter" ? ["tablet"]
        : role === "manager" ? ["manager"] : [];
      return { id: u.id, name: String(u.name || u.username || "").slice(0, 80), role, panels };
    }).filter((u) => u.panels.length);
    // The remembered screens are the one TOLERATED read here: an empty "which PC" list only costs a
    // convenience (he can still name the panel), and the board does not claim it is complete.
    const devicesQ = await sb.from("print_stations").select("device_id, label, panel, last_seen_at")
      .eq("restaurant_id", rid).order("last_seen_at", { ascending: false }).limit(12);
    if (devicesQ.error) console.error("[admin/printing] the remembered screens could not be read:", devicesQ.error.message);
    const devices = devicesQ.data || [];

    return NextResponse.json({
      ...board,
      // The ONE generic file, shown on the board itself. There is nothing secret in it, so it does
      // not need a "shown only once" ceremony any more — that whole dance existed because the old
      // file carried a token (mig 368).
      files: helperFiles(originOf(req)),
      // MODE B's launcher, sent alongside. Both are plain text with nothing secret in them, so the
      // board can show whichever one the mode calls for without a second round trip.
      stationFiles: stationFiles(originOf(req)),
      staleMs: HELPER_STALE_MS,
      panels: ROUTE_PANELS, people, devices,
      // Stated so the screen can say it rather than implying it: a manager whose permission is off is
      // missing from `people` on purpose, and this is the link that explains where to switch it on.
      // "Is ANY manager offered?" — used only to explain an empty picker. Per person now, so a
      // restaurant where the default is off but one manager is allowed no longer says "nobody".
      managerMayPrint: staff.some((u) => u.active !== false && String(u.role || "") === "manager" && mayBePrinter(u)),
      // `target` has left this payload (mig 369). It was the coarse kitchen|counter|both answer, it
      // asked the same question as the Kitchen slips line in older and vaguer words, and the two
      // could contradict each other — the printing sweep caught the OLDER one winning, so an owner
      // who named the manager screen was refused by a setting an admin had touched months before.
      // Everything it expressed is a screen route naming ONE room now (the backup went, 2026-08-30).
      printing: board.printing,
    });
  }
  return err("Unknown request", 404);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await admin(req))) return err("Not authorised", 401);
  const { path } = await ctx.params;
  const seg = (path || []).map(String);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const rid = String(body.rid || "");
  const ridBad = needRid(rid);
  if (ridBad) return err(ridBad);

  // ── add a computer ────────────────────────────────────────────────────────────────────────
  if (seg[0] === "agents" && seg.length === 1) {
    const name = String(body.name || "").trim();
    if (!name) return err("Give the computer a name — “Shop's computer”, “My Mac”.");
    const made = await createAgent(rid, name);
    if ("error" in made) return err(made.error);
    await logAction("admin", "print_helper_added", { restaurant_id: rid, detail: `computer “${name}” may now print` });
    return NextResponse.json({ id: made.id, name, code: made.token, scripts: scriptsFor(originOf(req), made.token, name) });
  }

  if (seg[0] === "agents" && seg[1] && seg[2] === "rename") {
    const name = String(body.name || "").trim();
    if (!name) return err("Give the computer a name.");
    const up = await sb.from("print_agents").update({ name }).eq("id", seg[1]).eq("restaurant_id", rid).select("id").maybeSingle();
    if (up.error) return err(up.error.code === "23505" ? "There is already a computer with that name." : "Could not rename it.");
    return NextResponse.json({ ok: true });
  }

  // ── replace a lost code ───────────────────────────────────────────────────────────────────
  // The old one stops working the instant this returns, which is also how a stolen or sold machine
  // is dealt with: give the code to nobody and it is simply dead.
  if (seg[0] === "agents" && seg[1] && seg[2] === "newcode") {
    const row = (await sb.from("print_agents").select("id, name").eq("id", seg[1]).eq("restaurant_id", rid).maybeSingle()).data as { id: string; name: string } | null;
    if (!row) return err("No such computer.", 404);
    const { token, hash } = mintAgentToken();
    // The fingerprint is cleared with the code: the next machine to use it is the machine it now
    // belongs to, so a replaced code does not inherit an old "used on two computers" warning.
    await sb.from("print_agents").update({ token_hash: hash, fingerprint: null, seen_fingerprints: [] }).eq("id", row.id).eq("restaurant_id", rid);
    await logAction("admin", "print_helper_recoded", { restaurant_id: rid, detail: `new printing code for “${row.name}”` });
    return NextResponse.json({ code: token, scripts: scriptsFor(originOf(req), token, row.name) });
  }

  // ── remove a computer ─────────────────────────────────────────────────────────────────────
  // Marked revoked, never deleted: the record of which machine printed which ticket has to stay
  // readable, and a row nobody can look up is not a record.
  if (seg[0] === "agents" && seg[1] && seg[2] === "revoke") {
    const row = (await sb.from("print_agents").select("id, name").eq("id", seg[1]).eq("restaurant_id", rid).maybeSingle()).data as { id: string; name: string } | null;
    if (!row) return err("No such computer.", 404);
    await sb.from("print_agents").update({ revoked_at: new Date().toISOString() }).eq("id", row.id).eq("restaurant_id", rid);
    // Any route pointing at it is emptied in the same breath — a route naming a machine that can no
    // longer print would leave paper silently unprinted, and an EMPTY line at least says so on the
    // screen ("Kitchen slips: no printer chosen").
    const routes = await readRoutes(rid);
    const patch: Record<string, unknown> = {};
    for (const k of PRINT_KINDS) {
      // Removing a computer clears the lines it owned. There is no second branch for "it was the
      // BACKUP of this line" any more — there is no backup (owner, 2026-08-30).
      if (routes[k].agent === row.id) patch[k] = null;
    }
    if (Object.keys(patch).length) await writeRoutes(rid, patch);
    await logAction("admin", "print_helper_removed", { restaurant_id: rid, detail: `“${row.name}” can no longer print` });
    return NextResponse.json({ ok: true, routesCleared: Object.keys(patch) });
  }

  // ── the address book ──────────────────────────────────────────────────────────────────────
  if (seg[0] === "routes") {
    const patch = (body.routes && typeof body.routes === "object" ? body.routes : {}) as Record<string, unknown>;
    if (!Object.keys(patch).length) return err("Nothing to save.");
    const saved = await writeRoutes(rid, patch);
    if ("error" in saved) return err(saved.error);
    // The kitchen-slip line IS settings.auto_print_kot — one decision, one column, one control
    // (lib/printHelpers → syncKotSwitch). Without this the two boards drift apart again: the address
    // book would say "nobody prints kitchen slips" while the trigger went on queueing them.
    if (Object.prototype.hasOwnProperty.call(patch, "kot")) {
      const k = patch.kot as Record<string, unknown> | null;
      // ⚠️ CLEARING THE LINE IS NOT SWITCHING PRINTING OFF (2026-08-31). This treated `null` — "no
      // printer chosen yet" — the same as `via:"off"` — "we do not print this" — and switched
      // auto-print off for both. That was defensible while an unanswered line meant nobody in
      // particular. It is wrong now: an unanswered kitchen-slip line resolves to the KITCHEN SCREEN
      // (lib/printHelpers → resolveTarget), so clearing it hands the slips to the kitchen rather than
      // stopping them. Left as it was, "take the printer off this line" quietly stopped the
      // restaurant printing, the trigger stopped queueing, and the board still said the kitchen
      // screen was doing it. ONLY a deliberate "Nobody" turns it off.
      await syncKotSwitch(rid, k?.via !== "off");
    }
    await logAction("admin", "print_routes_changed", { restaurant_id: rid, detail: `printing routes updated: ${Object.keys(patch).join(", ")}` });
    return NextResponse.json({ routes: saved.routes });
  }

  // ── the two switches, in the same place as everything else about printing ──────────────────
  if (seg[0] === "switch") {
    const patch: Record<string, boolean> = {};
    if (typeof body.allowed === "boolean") patch.auto_print_kot_allowed = body.allowed;
    if (typeof body.on === "boolean") patch.auto_print_kot = body.on;
    // THE THIRD THING THIS VERB USED TO TAKE IS GONE (mig 369): `target`, the coarse
    // kitchen|counter|both answer. It is a screen route naming ONE room now — 'both' went with the
    // backup screen (2026-08-30) — saved through `routes` above like every other printing decision:
    // one door, not two.
    if (!Object.keys(patch).length) return err("Nothing to change.");
    const up = await sb.from("settings").update(patch).eq("restaurant_id", rid).select("restaurant_id").maybeSingle();
    if (up.error) return err("Could not save that.");
    await logAction("admin", "print_switch", { restaurant_id: rid, detail: Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(" ") });
    return NextResponse.json({ ok: true });
  }

// ── THE "mode" VERB IS GONE (owner, 2026-08-31) ───────────────────────────────────────────
  // *"in admin panel also we don't need toggle."* There is nothing to switch: a computer prints if
  // one is set up and named, and if none is, the kitchen screen does. The three paper lines are the
  // only answer, written one at a time through `routes` below — which is where they always really
  // lived. `writeMode` existed to keep a stored copy of the choice in step with those lines; with no
  // stored copy there is nothing to keep in step. Do not re-add a mode: it can only ever disagree
  // with the routes, and the routes are what the paper obeys.

    // ── send one page to a printer ────────────────────────────────────────────────────────────
  // A REAL job on the real road (kind='test'), because a test that takes a different path can pass
  // while the path that matters is broken.
  // ── THE QUEUE'S OWN CONTROLS (owner, 2026-08-29) ──────────────────────────────────────────
  // "Make a button also in the printing queue — you can delete one of the prints from the queue, or
  // maybe you can stop the queue, restart the queue."
  //
  // A TICKET IS NEVER DELETED, it is DISMISSED: the row and its reason stay, so "why did table 6's
  // slip never come out" has an answer months later. This is the same rule the bills live under and
  // it costs nothing to keep.
  if (seg[0] === "job" && seg[1] && seg[2] === "cancel") {
    const upd = await sb.from("print_jobs")
      .update({ status: "dismissed", done_at: new Date().toISOString(), error: "cancelled by Aevidine from the printing queue" })
      .eq("id", seg[1]).eq("restaurant_id", rid).in("status", ["queued", "printing", "failed"])
      .select("id, kind").maybeSingle();
    if (upd.error) return err("Could not take that one out of the queue.");
    if (!upd.data) return err("That ticket has already printed or is not this restaurant's.", 404);
    await logAction("admin", "print_switch", { restaurant_id: rid, detail: `cancelled a ${(upd.data as { kind?: string }).kind || "print"} from the queue` });
    return NextResponse.json({ ok: true });
  }
  // PUT IT BACK IN THE QUEUE — for one that gave up after five tries. Its attempt count resets,
  // because the thing that was wrong (paper, power, a cable) has presumably been fixed.
  if (seg[0] === "job" && seg[1] && seg[2] === "retry") {
    const upd = await sb.from("print_jobs")
      .update({ status: "queued", attempts: 0, claimed_at: null, error: null })
      .eq("id", seg[1]).eq("restaurant_id", rid).in("status", ["failed", "dismissed"])
      .select("id").maybeSingle();
    if (upd.error) return err("Could not put that one back in the queue.");
    if (!upd.data) return err("Only a ticket that failed or was cancelled can go back in.", 404);
    await logAction("admin", "print_switch", { restaurant_id: rid, detail: "put a ticket back in the printing queue" });
    return NextResponse.json({ ok: true });
  }
  // STOP / RESTART THE WHOLE QUEUE. Deliberately NOT the same as switching printing off: tickets go
  // on being made and go on waiting, and the moment it restarts they come out. Switching printing
  // off instead would stop them being made at all, and the paper for those orders would never exist.
  if (seg[0] === "queue") {
    const paused = body.paused === true;
    const cur = (await sb.from("settings").select("modules").eq("restaurant_id", rid).maybeSingle()).data as { modules?: Record<string, Record<string, unknown>> } | null;
    const bag = { ...(cur?.modules || {}) };
    bag["printing"] = { ...(bag["printing"] || {}), paused };
    const up = await sb.from("settings").update({ modules: bag }).eq("restaurant_id", rid).select("restaurant_id").maybeSingle();
    if (up.error) return err("Could not change the queue.");
    await logAction("admin", "print_switch", { restaurant_id: rid, detail: paused ? "printing queue STOPPED — tickets wait" : "printing queue restarted" });
    return NextResponse.json({ ok: true, paused });
  }

  if (seg[0] === "test") {
    const agentId = String(body.agentId || ""), printer = String(body.printer || "");
    if (!agentId || !printer) return err("Pick a computer and one of its printers.");
    const agents = await agentsView(rid);
    const a = agents.find((x) => x.id === agentId);
    if (!a) return err("That computer is not one of this restaurant's.");
    if (!a.printers.some((p) => p.name === printer)) return err(`${a.name} has no printer called “${printer}”.`);
    const q = await queueJob(rid, "test", { by: "admin" }, { requestedBy: "admin test page", agentId, printer });
    if ("error" in q) return err("Could not queue the test page.");
    await logAction("admin", "print_test", { restaurant_id: rid, detail: `test page sent to “${printer}” on ${a.name}` });
    return NextResponse.json({
      ok: true, id: q.id,
      // Said plainly, because the honest answer is "it is on its way": the helper polls, so paper
      // appears a second or two later, and if the machine is asleep it appears when it wakes.
      note: a.connected ? "Sent — paper should appear in a moment." : `Sent, but ${a.name} was last seen ${a.secondsAgo ?? "?"}s ago. It will print when that computer is back.`,
    });
  }

  return err("Unknown request", 404);
}
