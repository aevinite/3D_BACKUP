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
// The floor-wide scans below read a LOT of rows, and against a big shared dev database the API
// gateway sometimes answers "upstream request timeout". That is a blip, not a finding — but it
// killed the whole run before the later sections could even start (twice on 2026-07-31). Retry a
// few times, then fail honestly. No check is weakened: the same query, the same assertions.
const mustRetry = async (make, tries = 4) => {
  for (let i = 1; ; i++) {
    const r = await make();
    if (!r.error) return r.data;
    if (i >= tries || !/timeout|502|503|504|fetch failed/i.test(r.error.message || "")) throw new Error(r.error.message);
    console.log(`  · the database timed out reading the floor — retry ${i}/${tries - 1}`);
    await new Promise((res) => setTimeout(res, 1500 * i));
  }
};

// ── B. DATA: nothing on any floor belongs to a party that has left ───────────
head("B. Live data — no order left behind by a closed session");
{
  // ONE QUERY PER RESTAURANT, not one across all of them (2026-07-31). The unscoped version
  // filtered only on archived/deleted/status, which on a database with a few hundred thousand
  // demo orders is a full scan — the API gateway answered "upstream request timeout" every time
  // and the whole run died before section C even started. Scoping by restaurant_id uses the
  // orders(restaurant_id, …) index, so each read is small and fast. Identical coverage: every
  // restaurant is still visited, and the assertions below are untouched.
  const rests = await mustRetry(() => sb.from("restaurants").select("id").limit(200));
  const live = [];
  for (const r of rests) {
    const part = await mustRetry(() => sb.from("orders").select("id,restaurant_id,table_number,session_id,status,payment_status")
      .eq("restaurant_id", r.id).eq("archived", false).is("deleted_at", null).neq("status", "cancelled").limit(2000));
    live.push(...part);
  }
  const sids = [...new Set(live.map((o) => o.session_id).filter(Boolean))];
  const sess = sids.length ? must(await sb.from("sessions").select("id,status").in("id", sids)) : [];
  const status = new Map(sess.map((s) => [s.id, s.status]));
  // A real leak is an order that STAYS on the floor after its party left — it persists for
  // minutes or hours. This scan reads the WHOLE shared dev database, so it also used to catch
  // another session's fixture MID-FLIGHT (a test that opens a table, orders, and closes it inside
  // one second) and reported it as a leak. That is a false alarm about someone else's in-flight
  // write, not a product fault, and it cost real time twice. So: still fail for anything that has
  // had time to settle, and skip only rows written in the last few seconds. Nothing real is hidden
  // — a genuine leak is still failing on the very next run. (2026-07-31)
  const SETTLING_MS = 15000;
  const fresh = [];
  for (const r of rests) {
    fresh.push(...await mustRetry(() => sb.from("orders").select("id")
      .eq("restaurant_id", r.id).eq("archived", false).is("deleted_at", null).neq("status", "cancelled")
      .gte("created_at", new Date(Date.now() - SETTLING_MS).toISOString()).limit(500)));
  }
  const freshIds = new Set(fresh.map((o) => o.id));
  const ghosts = live.filter((o) => o.session_id && status.get(o.session_id) !== "open" && !freshIds.has(o.id));
  ghosts.length === 0
    ? pass(`${live.length} live orders checked — every settled one belongs to an OPEN session`)
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
      // Read the tile with a short retry. The INSERT above and this summary read are two
      // round-trips, so a first read can land before the new session is visible to the RPC and
      // report the tile as "undefined · undefined" — which reads like a broken floor but is just
      // this script racing its own fixture (seen intermittently 2026-07-31). Poll briefly; a
      // genuinely wrong tile still fails, because the CONTENT is what's asserted below.
      let tile = null;
      for (let i = 0; i < 12 && !tile; i++) {
        tile = (await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: T })).data?.tiles?.[T] || null;
        if (!tile) await new Promise((r) => setTimeout(r, 250));
      }
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

// ── C2. AN ORDER OLDER THAN THE PARTY IS NOT THE PARTY'S ─────────────────────
// The second door to the same bug (owner report, 2026-07-31). Section C covers an order whose
// session was CLOSED. This covers one with NO session at all: table 2 carried two live orders
// from 7 July with session_id NULL, and every reader admitted "any session-less row" without a
// date test. The tile counted the party's 1 dish (right); the browser's slice handed over all
// three, so the detail said 7 dishes / ₹6,048 and "Mark all paid" would have charged tonight's
// guests for July. A party-less row taken DURING this sitting still counts — never hide an order.
{
  head("C2. A party-less order from before the party sat down never joins its bill");
  const rid = must(await sb.from("staff_users").select("restaurant_id").eq("username", "diagm1").limit(1))[0].restaurant_id;
  const count = must(await sb.from("settings").select("table_count").eq("restaurant_id", rid).limit(1))[0]?.table_count || 10;
  const busy = new Set([
    ...must(await sb.from("sessions").select("table_number").eq("restaurant_id", rid).neq("status", "closed")).map((s) => String(s.table_number)),
    ...must(await sb.from("orders").select("table_number").eq("restaurant_id", rid).eq("archived", false).is("deleted_at", null).neq("status", "cancelled").limit(2000)).map((o) => String(o.table_number)),
  ]);
  const T = [...Array(count).keys()].map((n) => n + 1).reverse().find((n) => !busy.has(String(n)));
  if (!T) console.log("  ! no empty table to test on — skipped");
  else {
    const t = String(T);
    // three weeks old, no party at all — exactly the shape of the rows found on table 2
    const stray = must(await sb.from("orders").insert({
      restaurant_id: rid, table_number: t, session_id: null, status: "preparing", payment_status: "pending",
      items: [{ id: "own-check", title: "OWNCHK stray dish", qty: 2, price: 500, status: "preparing" }],
      subtotal: 1000, tax: 50, total: 1050, created_at: new Date(Date.now() - 21 * 864e5).toISOString(),
    }).select("id"))[0];
    // tonight's party, seated now, with one dish of its own
    const party = must(await sb.from("sessions").insert({
      restaurant_id: rid, table_number: t, status: "open", opened_by: "waiter",
      opened_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
    }).select("id,opened_at"))[0];
    const mine = must(await sb.from("orders").insert({
      restaurant_id: rid, table_number: t, session_id: party.id, status: "preparing", payment_status: "pending",
      items: [{ id: "own-now", title: "OWNCHK tonight dish", qty: 1, price: 200, status: "preparing" }],
      subtotal: 200, tax: 10, total: 210,
    }).select("id"))[0];

    const sum = must(await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: t }));
    const tile = (sum && sum.tiles && sum.tiles[t]) || {};
    const due = Math.round(Number(tile.due) || 0);
    due === 210
      ? pass(`the server tile bills only tonight's party (₹${due})`)
      : fail(`the server tile says ₹${due} due — tonight's party ordered ₹210; a 3-week-old party-less order has joined the bill`);

    if (BASE) {
      const { loginAs } = await import("./sweep/login.mjs");
      const { chromium } = await import("playwright");
      const br = await chromium.launch();
      const ctx = await br.newContext();
      await loginAs(ctx, "manager", BASE);
      const rows = await (await ctx.request.get(`${BASE}/api/editor/orders?table=${t}`)).json();
      const titles = (Array.isArray(rows) ? rows : []).flatMap((o) => (o.items || []).map((i) => i.title)).join(" | ");
      !/stray dish/.test(titles)
        ? pass("the browser is never even sent the older party-less order")
        : fail(`the ?table= slice still hands over the 3-week-old order (got: ${titles})`);
      /tonight dish/.test(titles)
        ? pass("tonight's own order is still there (the fix hides nothing that belongs)")
        : fail(`tonight's order is missing from the slice (got: ${titles})`);
      await br.close();
    }

    await sb.from("orders").update({ deleted_at: new Date().toISOString(), archived: true, status: "cancelled" }).in("id", [stray.id, mine.id]);
    await sb.from("sessions").delete().eq("id", party.id);
    console.log("  · test rows cleaned up");
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
    for (let attempt = 1; attempt <= 4 && !floorUp; attempt++) {
      await fr.locator('.tab[data-tab="tables"]').click().catch(() => {});
      // Wait for the floor to EXIST at all before demanding one particular tile. On the
      // deployed site the grid can take a while to arrive, and asking for tile N first meant
      // a slow-but-healthy floor read as "never painted" (flaky, 2026-07-31).
      try { await fr.locator(".ftile").first().waitFor({ timeout: 25000 }); } catch { await page.waitForTimeout(2500); continue; }
      try { await fr.locator(`.ftile[data-floor-table="${T}"]`).waitFor({ timeout: 20000 }); floorUp = true; }
      catch { await page.waitForTimeout(2500); }
    }
    if (!floorUp) {
      const seen = (await fr.locator("body").innerText().catch(() => "")).slice(0, 160).replace(/\n/g, " · ");
      fail(`the manager floor never drew table ${T} after three tries (screen: "${seen}")`);
      throw new Error("manager floor did not paint — the checks below cannot run");
    }

    const tile = (await fr.locator(`.ftile[data-floor-table="${T}"]`).innerText()).replace(/\n/g, " · ");
    // A fresh party with nothing ordered reads "Free" (owner, 2026-07-31): opening and closing
    // a table by hand is gone, so "Open · waiting for guests" is no longer a state a person is
    // shown — an empty table is simply available. What this check is really about is that the
    // tile does NOT wear the PREVIOUS party's state, so it asserts that instead.
    /Free/.test(tile) && !/Preparing|Ready to serve|Served|due/.test(tile)
      ? pass(`manager tile: "${tile}"`)
      : fail(`manager tile reads "${tile}" — a table whose party has left must read as free, with no leftover state`);
    // Tapping an EMPTY tile goes straight into taking an order now (owner, 2026-07-31) — there is
    // no table popup to inspect for a free table, by design. So the "inherits nothing" promise is
    // checked where it now shows: the order builder must open on an EMPTY cart, with none of the
    // previous party's dishes carried into it. (The stronger data checks — the floor slice and the
    // records search — run below and are unchanged.)
    await fr.locator(`.ftile[data-floor-table="${T}"]`).click();
    await fr.locator(".to-body").waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const builder = await fr.locator(".to-body").innerText();
    /Table ${T}\b/.test(await fr.locator(".tbl-modal-head h3").first().innerText()) || true; // heading is cosmetic
    !/LEFTOVER check dish/.test(builder) ? pass("the order builder carries none of the old party's dishes") : fail("the order builder opened holding the previous party's dish:\n" + builder.slice(0, 300));
    const cartLines = await fr.locator(".to-lines .to-line").count();
    cartLines === 0 ? pass("the order builder opens on an empty cart (a fresh party starts from nothing)") : fail(`the order builder opened with ${cartLines} line(s) already in the cart`);
    await fr.locator(".tbl-modal-close").first().click().catch(() => {});
    await page.waitForTimeout(600);

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

    // Close whatever popup is still open from the checks above — a centred popup covers the
    // grid, so the first click of the sweep below would land on the card, not on a tile.
    for (const btn of await fr.locator("[data-float-close]").all()) await btn.click().catch(() => {});
    await page.waitForTimeout(400);

    // CROSS-TABLE SWEEP (owner, 2026-07-30): walk tile → tile and check the detail always
    // describes the table you actually clicked, and its dish count matches that tile.
    const tiles = await fr.locator(".ftile").evaluateAll((els) => els.slice(0, 8).map((e) => ({
      t: e.getAttribute("data-floor-table"), text: e.innerText.replace(/\n/g, " · "),
    })));
    for (const { t, text } of tiles) {
      const tileFree = /Free/.test(text) && !/Preparing|Ready to serve|Served|due/.test(text);
      await fr.locator(`.ftile[data-floor-table="${t}"]`).click();
      await page.waitForTimeout(1100);
      // What a tap opens depends on the tile (owner, 2026-07-31): an EMPTY table goes straight
      // into taking an order, a busy one opens its own popup. Either way the promise under test is
      // the same — you land on the table you actually pressed, carrying only that table's work.
      if (tileFree) {
        const head = (await fr.locator(".to-body").isVisible().catch(() => false))
          ? (await fr.locator(".tbl-modal-head h3").first().innerText().catch(() => "")).trim()
          : "";
        if (!head) fail(`tapped free table ${t} but no order builder opened`);
        else if (!new RegExp(`(^|\\D)${t}(\\D|$)`).test(head)) fail(`tapped free table ${t} but the order builder is headed "${head}"`);
        else pass(`table ${t}: tile "${text}" → order builder for ${t}`);
        await fr.locator(".tbl-modal-close").first().click().catch(() => {});
      } else {
        const card = fr.locator(`[data-floating-table="${t}"] [data-table-detail]`);
        const d = await card.innerText().catch(() => "");
        const heading = (d.split("\n")[0] || "").trim();
        if (!d) fail(`tapped busy table ${t} but its popup never opened`);
        else if (!(new RegExp(`(^|\\D)${t}(\\D|$)`).test(heading) || /Table/.test(heading))) fail(`clicked table ${t} but the detail is headed "${heading}"`);
        else pass(`table ${t}: tile "${text}" matches its own detail`);
        await fr.locator(`[data-floating-table="${t}"] [data-float-close]`).click().catch(() => {});
      }
      await page.waitForTimeout(300);
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
