// verify-table-ownership.mjs — guards the rule "a table only ever shows ITS OWN party's
// orders, and an order can never outlive its session" (owner report, 2026-07-30).
//
// THE BUG THIS EXISTS FOR: the owner tapped Open on a FREE table and it came up instantly as
// "Preparing · 0/5 served · ₹1,150 due" with three KOTs — orders placed nine days earlier by a
// party whose session had long been closed. Two causes, one check each below:
//   • the panels decided "which orders are at this table?" by table_number alone, so a NEW
//     party inherited whatever live rows were lying around (Mark-all-paid / Generate-invoice
//     would have billed them);
//   • closing a session only archived its orders in the APP path, so any other close (a
//     maintenance script's bare UPDATE, a hand-run SQL fix, a future code path) left food on
//     the floor forever. Migration 232 moved that cleanup onto the status change itself.
//
//   node scripts/verify-table-ownership.mjs                  # A + B + C (no server needed)
//   node scripts/verify-table-ownership.mjs --base http://localhost:4000   # + D (real browser)
//
//   A. STATIC — both panels' order lookups are scoped by session id, not table_number.
//   B. DATA   — no live order anywhere belongs to a closed/missing session.
//   C. DB     — closing a session with a bare UPDATE cancels+archives its live orders, the
//               money record survives, and a reopened table starts empty.
//   D. BROWSER (opt-in) — a fresh party at a table with a leftover order sees NOTHING of it,
//               in the manager AND the waiter panel; and clicking from one table to the next
//               keeps every tile/detail showing its OWN table (owner, 2026-07-30: "click on
//               other tables, like from six to seven, and see the status of six").
//
// Never signs in more than once per role (scripts/sweep/login.mjs caches the session) — our
// own tests must never trip the login limit and ping the owner's phone.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) =>
  Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const baseArg = process.argv.indexOf("--base");
const BASE = baseArg > -1 ? process.argv[baseArg + 1] : process.env.VERIFY_BASE || "";

let failed = 0;
const pass = (m) => console.log("  ✓ " + m);
const fail = (m) => { console.log("  ✗ " + m); failed++; };
const head = (m) => console.log("\n" + m);

// ── A. STATIC: the panels' "whose orders are these?" rule ────────────────────
head("A. Panel source — order lookups scoped by SESSION, not table_number");
const src = (p) => readFileSync(join(root, p), "utf8");
const fnBody = (text, marker) => {
  const i = text.indexOf(marker);
  if (i === -1) return "";
  const end = text.indexOf("\n};", i);
  return text.slice(i, end === -1 ? i + 2000 : end);
};
const mgr = fnBody(src("public/panels/editor/app.js"), "const ordersForTable = (t) =>");
const tab = fnBody(src("public/panels/tablet/app.js"), "const ordersOf = (t) =>");
for (const [name, body] of [["manager ordersForTable", mgr], ["waiter ordersOf", tab]]) {
  if (!body) { fail(`${name} not found — did it get renamed? This guard must be updated with it.`); continue; }
  /o\.session_id/.test(body)
    ? pass(`${name} tests o.session_id (a new party can't inherit the last one's orders)`)
    : fail(`${name} filters by table_number only — that is the 2026-07-30 bug. Keep the session-id test.`);
  /!o\.archived|o\.archived/.test(body)
    ? pass(`${name} excludes archived rows`)
    : fail(`${name} doesn't exclude archived rows — closed-out food would show on the floor`);
}

// ── DB helpers ───────────────────────────────────────────────────────────────
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

// ── B. DATA: nothing on any floor belongs to a party that has left ───────────
head("B. Live data — no order left behind by a closed session");
{
  const live = must(await sb.from("orders").select("id,restaurant_id,table_number,session_id,status,payment_status")
    .eq("archived", false).is("deleted_at", null).neq("status", "cancelled").limit(5000));
  const sids = [...new Set(live.map((o) => o.session_id).filter(Boolean))];
  const sess = sids.length ? must(await sb.from("sessions").select("id,status").in("id", sids)) : [];
  const status = new Map(sess.map((s) => [s.id, s.status]));
  const ghosts = live.filter((o) => o.session_id && status.get(o.session_id) !== "open");
  ghosts.length === 0
    ? pass(`${live.length} live orders checked — every one belongs to an OPEN session`)
    : fail(`${ghosts.length} order(s) still on the floor after their party left: ` +
        JSON.stringify(ghosts.slice(0, 8).map((o) => `T${o.table_number} ${o.status}/${o.payment_status}`)) +
        " — the next guests at those tables would inherit them (mig 232 should have archived these)");
}

// ── C. DB: the close net itself ──────────────────────────────────────────────
head("C. Closing a session — its food leaves the floor with it");
{
  const rid = must(await sb.from("restaurants").select("id").is("deleted_at", null).order("created_at").limit(1))[0]?.id;
  if (!rid) fail("no restaurant to test against");
  else {
    const T = "OWNCHK"; // a name no real floor uses, so parallel sessions can't collide
    const s1 = must(await sb.from("sessions").insert({ restaurant_id: rid, table_number: T, status: "open", opened_by: "waiter", opened_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }).select("id"))[0];
    const mk = (status, pay, total) => sb.from("orders").insert({
      restaurant_id: rid, table_number: T, session_id: s1.id, status, payment_status: pay,
      subtotal: total, tax: 0, total, items: [{ title: "ownership check", qty: 1, price: total, status: status === "served" ? "served" : "preparing" }],
    }).select("id").single();
    const unpaidId = (await mk("preparing", "pending", 111)).data.id;
    const paidId = (await mk("served", "paid", 222)).data.id;
    try {
      // The exact move that made the owner's ghosts: close with a bare UPDATE, no app code.
      must(await sb.from("sessions").update({ status: "closed" }).eq("id", s1.id).select("id"));
      const rows = must(await sb.from("orders").select("id,total,status,payment_status,archived,cancelled_at").in("id", [unpaidId, paidId]));
      const u = rows.find((r) => Number(r.total) === 111), p = rows.find((r) => Number(r.total) === 222);
      u?.archived && u.status === "cancelled" && u.cancelled_at
        ? pass("unpaid, still-cooking order → ✕ cancelled AND archived (a visible walk-out record)")
        : fail(`unpaid order survived the close as ${u?.status}/archived=${u?.archived} — it would land on the next party's bill`);
      p?.archived && p.status === "served" && p.payment_status === "paid"
        ? pass("paid, served order → archived only; status + payment untouched (the sale is intact)")
        : fail(`paid order was altered: ${p?.status}/${p?.payment_status} — a settled sale must never change`);
      rows.length === 2
        ? pass("both rows still exist in the ledger (archived ≠ deleted — nothing is hidden)")
        : fail("an order row disappeared — that would be hiding a sale");
      // A new party at the same table starts clean.
      const s2 = must(await sb.from("sessions").insert({ restaurant_id: rid, table_number: T, status: "open", opened_by: "waiter", opened_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }).select("id"))[0];
      const tile = (await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: T })).data?.tiles?.[T];
      tile && tile.state === "waiting" && Number(tile.due) === 0 && tile.counts.ck === 0
        ? pass(`reopened → "${tile.label} · ${tile.meta}", 0 dishes, ₹0 due`)
        : fail(`reopened tile is "${tile?.label} · ${tile?.meta}" due=${tile?.due} counts=${JSON.stringify(tile?.counts)} — a new party must start empty`);
      await sb.from("sessions").update({ status: "closed" }).eq("id", s2.id);
      await sb.from("sessions").delete().eq("id", s2.id);
    } finally {
      // SOFT-delete: every order here gets a bill number, and the DB rightly refuses to
      // hard-delete an issued bill ("soft-delete it (deleted_at) instead"). Our test rows
      // obey the same rule, so they leave every view without breaking that guarantee.
      await sb.from("orders").update({ deleted_at: new Date().toISOString(), archived: true }).in("id", [unpaidId, paidId]);
      await sb.from("sessions").delete().eq("id", s1.id);
    }
  }
}

// ── D. BROWSER (opt-in): what the staff actually see ─────────────────────────
if (!BASE) {
  console.log("\nD. Browser checks SKIPPED (pass --base http://localhost:4000 with the app running)");
} else {
  head(`D. Real panels at ${BASE} — a fresh party inherits nothing, and each tile is its own table`);
  const { chromium } = await import("playwright");
  const { loginAs } = await import("./sweep/login.mjs");
  const rid = must(await sb.from("staff_users").select("restaurant_id").eq("username", "diagm1").limit(1))[0].restaurant_id;
  const count = must(await sb.from("settings").select("table_count").eq("restaurant_id", rid).limit(1))[0]?.table_count || 10;
  // A table is only usable for this test when NOTHING is on it — no open session and no live
  // order of any kind. (A table carrying a session-LESS live order, e.g. a banquet line, is
  // deliberately still shown by the panels — never hide an order — so it would muddy the
  // "starts empty" assertions.)
  const busy = new Set([
    ...must(await sb.from("sessions").select("table_number").eq("restaurant_id", rid).neq("status", "closed")).map((s) => String(s.table_number)),
    ...must(await sb.from("orders").select("table_number").eq("restaurant_id", rid).eq("archived", false).is("deleted_at", null).neq("status", "cancelled").limit(2000)).map((o) => String(o.table_number)),
  ]);
  const free = [...Array(count).keys()].map((n) => n + 1).reverse().find((n) => !busy.has(String(n)));
  if (!free) { console.log("  ! every table is occupied right now — browser checks skipped"); process.exit(failed ? 1 : 0); }
  const T = String(free);

  // The bad state, exactly as legacy rows look: a live order on an ALREADY-closed session
  // (an INSERT never fires the close trigger, so this reproduces pre-mig-232 data).
  const old = must(await sb.from("sessions").insert({ restaurant_id: rid, table_number: T, status: "closed", opened_by: "waiter", opened_at: new Date(Date.now() - 864e5).toISOString(), closed_at: new Date(Date.now() - 6e5).toISOString() }).select("id"))[0];
  const ghost = (await sb.from("orders").insert({
    restaurant_id: rid, table_number: T, session_id: old.id, status: "preparing", payment_status: "pending",
    subtotal: 999, tax: 0, total: 999, items: [{ title: "LEFTOVER check dish", qty: 5, price: 999, status: "preparing" }],
  }).select("id,kot_no").single()).data;
  const fresh = (await sb.rpc("lfh_staff_open_table", { p_restaurant_id: rid, p_table: T })).data;
  console.log(`  · T${T}: a closed session's live ₹999 order (KOT #${ghost.kot_no}), then a new party seated`);

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await loginAs(ctx, "manager", BASE);
    const page = await ctx.newPage();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`${BASE}/manager`, { waitUntil: "domcontentloaded" });
    const fr = page.frameLocator("iframe").first();
    // The panel opens on the EDITOR tab, so the floor tiles do not exist until Tables is
    // clicked — and clicking the instant the tab element appears is too early: the panel is
    // still booting and the click is lost, after which this waited 60s for a tile that was
    // never going to be drawn (a flaky guard that "failed" with no useful message). Click,
    // check, click again — up to three times — then say plainly what the screen showed.
    await fr.locator('.tab[data-tab="tables"]').waitFor({ timeout: 60000 });
    let floorUp = false;
    for (let attempt = 1; attempt <= 3 && !floorUp; attempt++) {
      await fr.locator('.tab[data-tab="tables"]').click().catch(() => {});
      try { await fr.locator(`.ftile[data-floor-table="${T}"]`).waitFor({ timeout: 20000 }); floorUp = true; }
      catch { await page.waitForTimeout(3000); }
    }
    if (!floorUp) {
      const seen = (await fr.locator("body").innerText().catch(() => "")).slice(0, 160).replace(/\n/g, " · ");
      fail(`the manager floor never drew table ${T} after three tries (screen: "${seen}")`);
      throw new Error("manager floor did not paint — the checks below cannot run");
    }

    const tile = (await fr.locator(`.ftile[data-floor-table="${T}"]`).innerText()).replace(/\n/g, " · ");
    /Open · waiting for guests/.test(tile) ? pass(`manager tile: "${tile}"`) : fail(`manager tile reads "${tile}" — expected the fresh "Open · waiting for guests"`);
    await fr.locator(`.ftile[data-floor-table="${T}"]`).click();
    await fr.locator("[data-table-detail]").waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500); // let the per-table slice land
    const detail = await fr.locator("[data-table-detail]").innerText();
    !/LEFTOVER check dish/.test(detail) ? pass("manager detail lists none of the old party's dishes") : fail("manager detail adopted the old order:\n" + detail.slice(0, 400));
    !/KOT #/.test(detail) ? pass("manager detail has no order rows at all (the table really is fresh)") : fail("manager detail lists order rows on a table nobody has ordered at:\n" + detail.slice(0, 300));
    !/Due ₹/.test(detail) ? pass("manager detail shows no money due on the new table") : fail("manager detail shows money due that isn't this party's");
    !/Preparing/.test(detail) ? pass('manager detail is not "Preparing"') : fail('manager detail says "Preparing" on a table nobody has ordered at');

    // TWO SEPARATE PROMISES, and they must BOTH hold:
    //  (a) the FLOOR slice (?table=) carries only the party sitting there now — since the
    //      server-side scoping, the browser isn't even sent another party's orders;
    //  (b) the RECORDS still contain that order (?history= / the Bills list) — off the floor
    //      must never mean hidden, or we'd be hiding a sale.
    const floorRows = await (await ctx.request.get(`${BASE}/api/editor/orders?table=${T}`)).json();
    const inFloor = Array.isArray(floorRows) && floorRows.some((o) => o.id === ghost.id);
    !inFloor
      ? pass(`the floor slice returned ${Array.isArray(floorRows) ? floorRows.length : "?"} row(s) and none of them is the old party's`)
      : fail("the floor slice still hands the panel the previous party's order — the panel must not have to filter it out");
    const recRows = await (await ctx.request.get(`${BASE}/api/editor/orders?history=1&type=table&q=${T}`)).json();
    Array.isArray(recRows) && recRows.some((o) => o.id === ghost.id)
      ? pass("the old order is still findable in the records (Bills search) — off the floor, not erased")
      : fail("the old order is not in the records search — taking it off the floor must never hide it");

    // CROSS-TABLE SWEEP (owner, 2026-07-30): walk tile → tile and check the detail always
    // describes the table you actually clicked, and its dish count matches that tile.
    const tiles = await fr.locator(".ftile").evaluateAll((els) => els.slice(0, 8).map((e) => ({
      t: e.getAttribute("data-floor-table"), text: e.innerText.replace(/\n/g, " · "),
    })));
    for (const { t, text } of tiles) {
      await fr.locator(`.ftile[data-floor-table="${t}"]`).click();
      await page.waitForTimeout(900);
      const d = await fr.locator("[data-table-detail]").innerText();
      const heading = (d.split("\n")[0] || "").trim();
      const okName = new RegExp(`(^|\\D)${t}(\\D|$)`).test(heading) || /Table/.test(heading);
      const tileFree = /Free · /.test(text) || /waiting for guests/.test(text);
      const detailBusy = /Due ₹|Preparing|Ready to serve/.test(d);
      if (!okName) fail(`clicked table ${t} but the detail is headed "${heading}"`);
      else if (tileFree && detailBusy) fail(`table ${t}'s tile says "${text}" while its detail shows orders/money — the panels disagree about whose food this is`);
      else pass(`table ${t}: tile "${text}" matches its own detail`);
    }
    errs.length ? fail("console errors: " + errs.slice(0, 3).join(" | ")) : pass("no console errors while clicking around the floor");

    // The waiter panel must agree.
    const tctx = await browser.newContext();
    await loginAs(tctx, "tablet", BASE);
    const tp = await tctx.newPage();
    await tp.goto(`${BASE}/tablet`, { waitUntil: "domcontentloaded" });
    const tfr = tp.frameLocator("iframe").first();
    // A waiter with NO section correctly sees an empty floor ("No tables assigned to you
    // yet"), so this tile would never appear and the whole script died on an unhandled
    // 60s timeout — taking the earlier passing checks down with it. Say what's wrong
    // instead of crashing: a guard that dies is indistinguishable from a guard that found
    // nothing (this actually happened, 2026-07-31).
    const wtile = tfr.locator(`.tile[data-t="${T}"]`);
    let waiterReady = true;
    try {
      await wtile.waitFor({ timeout: 45000 });
    } catch {
      waiterReady = false;
      const seen = await tfr.locator("body").innerText().catch(() => "");
      if (/No tables assigned to you yet/i.test(seen))
        fail("the waiter account has NO section, so its floor is correctly empty and this half cannot run — give it tables (staff_users.assigned_tables) and re-run");
      else fail(`the waiter floor never showed table ${T} (screen said: "${seen.slice(0, 120).replace(/\n/g, " · ")}")`);
    }
    if (waiterReady) {
      await wtile.click();
      await tp.waitForTimeout(4000);
      const wp = await tfr.locator("body").innerText();
      !/LEFTOVER check dish/.test(wp) ? pass("waiter panel lists none of the old party's dishes") : fail("waiter panel adopted the old order");
      !/₹4,995|₹999/.test(wp) ? pass("waiter panel shows none of the old party's money") : fail("waiter panel shows the old party's money");
    }
  } finally {
    await browser.close();
    await sb.from("orders").update({ deleted_at: new Date().toISOString(), archived: true }).eq("id", ghost.id);
    if (fresh?.id) { await sb.from("sessions").update({ status: "closed" }).eq("id", fresh.id); await sb.from("sessions").delete().eq("id", fresh.id); }
    await sb.from("sessions").delete().eq("id", old.id);
    console.log("  · test rows cleaned up");
  }
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : "\n✓ every table shows only its own party's orders");
process.exit(failed ? 1 : 0);
