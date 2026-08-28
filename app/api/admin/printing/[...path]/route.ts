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
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import {
  agentsView, createAgent, readRoutes, writeRoutes, mintAgentToken,
  PRINT_KINDS, HELPER_STALE_MS, ROUTE_PANELS, syncKotSwitch,
} from "@/lib/printHelpers";
// The board itself — headings, words, paper sizes and the four steps — is shared with the panel, so
// the two screens cannot drift into two different products (owner, 2026-08-27: "the UI/UX is also
// not identical"). lib/printBoard.ts is the single copy.
import { printBoardState, helperFiles } from "@/lib/printBoard";
import { STUCK_AFTER_MS } from "@/lib/printQueue";
import { managerGrantValue } from "@/lib/accessTree";
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
      sb.from("restaurants").select("id, name, slug").order("name"),
      sb.from("print_agents").select("id, restaurant_id, name, last_seen_at, printers")
        .is("revoked_at", null).limit(400),
      sb.from("settings").select("restaurant_id, auto_print_kot, auto_print_kot_allowed, modules").limit(400),
      // Only what is STILL WAITING, and only the two columns needed to count it and age it.
      sb.from("print_jobs").select("restaurant_id, kind, created_at")
        .in("status", ["queued", "printing"]).eq("kind", "kot").limit(2000),
    ]);
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

    const rows = (((rests.data || []) as { id: string; name: string; slug: string }[])).map((r) => {
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
  if (!rid) return err("Which restaurant?");

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
    const staff = ((await sb.from("staff_users").select("id, name, username, role, active")
      // A CEILING, so PostgREST's own default cannot silently shorten this picker (T17 sweep #7,
      // 2026-08-27). One restaurant's staff, and every other read in this file already states one.
      .eq("restaurant_id", rid).order("role").limit(500)).data || []) as
      { id: string; name?: string | null; username?: string | null; role?: string | null; active?: boolean | null }[];
    // The manager side of that permission, read the way every other route reads one: the stored value
    // if the admin set it, else what the Access screen shows as the default (managerGrantValue).
    const perms = (await sb.from("restaurants").select("manager_permissions").eq("id", rid).maybeSingle()).data as
      { manager_permissions?: Record<string, unknown> | null } | null;
    const mgrPerm = managerGrantValue("print_here", (perms?.manager_permissions || {})["print_here"]);
    const people = staff.filter((u) => u.active !== false).map((u) => {
      const role = String(u.role || "");
      const panels = role === "kitchen" ? ["kitchen"]
        : role === "manager" ? (mgrPerm ? ["manager"] : [])
        : role === "owner" ? ["owner", "manager"]
        : role === "tablet" || role === "waiter" ? ["tablet"] : [];
      return { id: u.id, name: String(u.name || u.username || "").slice(0, 80), role, panels };
    }).filter((u) => u.panels.length);
    const devices = ((await sb.from("print_stations").select("device_id, label, panel, last_seen_at")
      .eq("restaurant_id", rid).order("last_seen_at", { ascending: false }).limit(12)).data || []);

    return NextResponse.json({
      ...board,
      // The ONE generic file, shown on the board itself. There is nothing secret in it, so it does
      // not need a "shown only once" ceremony any more — that whole dance existed because the old
      // file carried a token (mig 368).
      files: helperFiles(originOf(req)),
      staleMs: HELPER_STALE_MS,
      panels: ROUTE_PANELS, people, devices,
      // Stated so the screen can say it rather than implying it: a manager whose permission is off is
      // missing from `people` on purpose, and this is the link that explains where to switch it on.
      managerMayPrint: mgrPerm,
      // `target` has left this payload (mig 369). It was the coarse kitchen|counter|both answer, it
      // asked the same question as the Kitchen slips line in older and vaguer words, and the two
      // could contradict each other — the printing sweep caught the OLDER one winning, so an owner
      // who named the manager screen was refused by a setting an admin had touched months before.
      // Everything it expressed is a screen route with an optional backupPanel now.
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
  if (!rid) return err("Which restaurant?");

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
      if (routes[k].agent === row.id) patch[k] = null;
      else if (routes[k].backupAgent === row.id) patch[k] = { agent: routes[k].agent, printer: routes[k].printer };
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
      await syncKotSwitch(rid, !(k === null || k?.via === "off"));
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
    // kitchen|counter|both answer. It is a screen route with an optional backupPanel now, saved
    // through `routes` above like every other printing decision — one door, not two.
    if (!Object.keys(patch).length) return err("Nothing to change.");
    const up = await sb.from("settings").update(patch).eq("restaurant_id", rid).select("restaurant_id").maybeSingle();
    if (up.error) return err("Could not save that.");
    await logAction("admin", "print_switch", { restaurant_id: rid, detail: Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(" ") });
    return NextResponse.json({ ok: true });
  }

  // ── send one page to a printer ────────────────────────────────────────────────────────────
  // A REAL job on the real road (kind='test'), because a test that takes a different path can pass
  // while the path that matters is broken.
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
