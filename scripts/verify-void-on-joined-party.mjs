// verify-void-on-joined-party.mjs — voiding ONE ticket on a joined party must not end the party.
//
// THE BUG THIS EXISTS FOR (T3 sweep, 2026-08-06). ✕ Cancel on a ticket is the sanctioned walk-out
// path, and when it voids the LAST live ticket at a table the app frees that table for the next
// guests. It decided "was that the last one?" by TABLE NUMBER — and a joined party's food keeps its
// own table number while living on the PARENT's session (mig 249). So on the table that HOLDS the
// bill the answer was always "nothing left", freeTable() force-closed the party's session, and
// migration 232's trigger cancelled + archived EVERY unpaid live order on it. Voiding one ticket at
// T27 took T28's cooking food and the party's whole bill with it, and nothing asked: freeTable is
// called with { silent: true }.
//
// It is checked end to end through the real UI because that is the only place the wrong question was
// asked; a unit test on the helpers would have passed on the broken build.
//
//   node scripts/verify-void-on-joined-party.mjs                            # dev server on :4937
//   node scripts/verify-void-on-joined-party.mjs --base http://localhost:4311
//
// It cleans up its own two tables, before AND after, and only ever touches the two it owns.
import { chromium } from "playwright";
import fs from "node:fs";
import { loginAs } from "./sweep/login.mjs";

const ARG = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const B = ARG("--base", "http://localhost:4937");
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
const TOK = g("SUPABASE_ACCESS_TOKEN"), RID = "00000000-0000-0000-0000-000000000001";
const REF = ARG("--db", "wnsfcizclkbobwzcxqsf");
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: "Bearer " + TOK, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 200)); return JSON.parse(t);
};
// PARENT holds the bill; CHILD is joined to it and is the one whose food must survive.
const PARENT = "27", CHILD = "28", BOTH = `'${PARENT}','${CHILD}'`;
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails++; };

const wipe = async () => {
  await q(`delete from table_merges where restaurant_id='${RID}' and (child_table in (${BOTH}) or parent_table in (${BOTH}))`);
  await q(`update orders set status='cancelled', archived=true, archived_at=now(), cancelled_at=now()
           where restaurant_id='${RID}' and table_number in (${BOTH}) and not archived`);
  await q(`update sessions set status='closed', closed_at=now()
           where restaurant_id='${RID}' and table_number in (${BOTH}) and status='open'`);
};
const snap = async () => {
  const o = await q(`select table_number, status, archived, payment_status from orders
    where restaurant_id='${RID}' and table_number in (${BOTH}) order by table_number, created_at`);
  const s = await q(`select table_number, status from sessions
    where restaurant_id='${RID}' and table_number in (${BOTH}) and status='open'`);
  const live = {};
  o.filter((r) => !r.archived && r.status !== "cancelled").forEach((r) => { live[r.table_number] = r.status; });
  return { live, open: s.map((x) => x.table_number).sort(), rows: o.length };
};

console.log(`\nVOID ON A JOINED PARTY — ${B}\n`);
await wipe();
const dish = (await q(`select id from menu_items where restaurant_id='${RID}' limit 1`))[0].id;
// One ticket on each table, then join the child onto the parent.
for (const t of [PARENT, CHILD]) await q(`select lfh_staff_place_order('${t}','[{"id":"${dish}","qty":2}]'::jsonb,'{}',null,'${RID}',true)`);
const sid = async (t) => (await q(`select id from sessions where restaurant_id='${RID}' and table_number='${t}' and status='open' order by created_at desc limit 1`))[0]?.id;
await q(`select lfh_staff_merge_tables('${await sid(CHILD)}','${PARENT}','${RID}')`);
// Nothing served anywhere — that is what makes ✕ Cancel available on the parent's ticket.
await q(`update orders set status='received' where restaurant_id='${RID}' and table_number in (${BOTH}) and not archived and status<>'cancelled'`);

let st = await snap();
check("fixture: both tables carry live food", !!st.live[PARENT] && !!st.live[CHILD], JSON.stringify(st.live));
check("fixture: they are ONE party (one open session, on the parent)", st.open.join() === PARENT, "open " + st.open.join());

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await loginAs(ctx, "manager", B, { username: "diagm1", password: "diag-mgr-2026", route: "/manager" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
await p.goto(B + "/manager", { waitUntil: "networkidle", timeout: 120000 });
await p.waitForTimeout(4500);
const fr = p.frameLocator("iframe").first();
try { await fr.locator('.tab[data-tab="tables"]').first().click({ timeout: 25000 }); } catch {}
await p.waitForTimeout(6500);

// ── while the party is up: does the HEADER agree with the tiles? (T3 sweep, 2026-08-06) ──────────
// A merged child has no session of its own, so lfh_table_view_summary reports its state as `free`.
// The tile knows better and paints it purple; the "Occupied" chip read the raw state and counted
// only the parent, so the header said "1/30" over two visibly full tables.
// Asserted against the TILES, not against a fixed number: this database is shared with other test
// fixtures, so "Occupied is 2" would be neither true nor stable. "The header equals what a person
// can see on the floor" is the real rule, and it bites — on the old code the child was drawn purple
// and busy while the header left it out.
{
  const d = await fr.locator(".floor-main").evaluate((root) => {
    const tiles = [...root.querySelectorAll(".ftile:not(.ftile-skel)")];
    const busy = tiles.filter((t) => {
      const purple = getComputedStyle(t).getPropertyValue("--c").trim() === "#a855f7";
      const free = t.classList.contains("ft-free") || t.classList.contains("ft-req");
      return purple || !free;
    }).length;
    const head = (root.querySelector(".floor-stats .fstat-n") || {}).textContent || "";
    return { busy, head: head.trim(), n: parseInt(head, 10) };
  });
  const purple = await fr.locator(`.ftile[data-floor-table="${CHILD}"]`).evaluate((el) => getComputedStyle(el).getPropertyValue("--c").trim());
  check("the joined child's tile is purple (it is not free)", purple === "#a855f7", purple);
  check("the header's Occupied equals the busy tiles a person can SEE", d.n === d.busy,
    `header "${d.head}" vs ${d.busy} busy tile(s) on screen`);
}

// Open the table that HOLDS the bill, and void ITS OWN ticket.
//
// Targeted by order id, never `.first()`: a joined table's detail lists the WHOLE party's tickets
// newest-first (owner: "every table will show every order"), so the first ✕ Cancel on screen belongs
// to whichever table ordered last — the CHILD here. Voiding that one exercises a different (and
// safe) path and the test would pass without ever touching the bug.
const parentOrderIdRows = await q(`select id from orders where restaurant_id='${RID}'
  and table_number='${PARENT}' and not archived and status<>'cancelled' order by created_at desc limit 1`);
// NEVER `[0].id` ON A LOOKUP THAT CAN COME BACK EMPTY (T28 sweep, 2026-08-22). When the fixture
// above fails to place its order, this line threw `TypeError: Cannot read properties of undefined`
// and the whole run died mid-way — no summary, no failing check, just a stack trace that says
// nothing about what went wrong. A guard must report; it must not crash.
if (!parentOrderIdRows[0]) {
  check(`fixture: table ${PARENT} has a live ticket to void`, false,
    "no un-archived, un-cancelled order on that table — the place_order above did not land, so "
    + "nothing below could run. Check its reply before reading this as a voiding fault.");
  { const bad = 1; console.log(`\n\u274c ${bad} check(s) failed — the fixture never landed`); process.exit(1); }
}
const parentOrderId = parentOrderIdRows[0].id;
await fr.locator(`.ftile[data-floor-table="${PARENT}"]`).click({ force: true });
await p.waitForTimeout(5000);
const cancelBtn = fr.locator(`[data-cancel-order="${parentOrderId}"]`).first();
check("the parent's own ticket offers ✕ Cancel", (await cancelBtn.count()) > 0);
if ((await cancelBtn.count()) > 0) {
  await cancelBtn.click({ force: true });
  await p.waitForTimeout(1500);
  // The reason sheet (mig 251): pick "By mistake", then Remove.
  //
  // ⚠ THE SHEET GREW A SECOND QUESTION AND THIS ONLY ANSWERED THE FIRST (T28 sweep, 2026-08-22).
  // Since 2026-08-18 it also asks "Was the food actually made?" (mig 340 — the answer decides whether
  // the ingredients count as a loss or go back into stock), and `askRemovalReason()` is explicit:
  // "Both questions must be answered when both are asked." `.rr-go` stays DISABLED until both are,
  // so clicking it did nothing — silently — and the void never happened. The failures then read
  // "the parent's ticket really was voided — {27:received, 28:received}", which looks exactly like
  // voiding being broken on a joined party: the very bug this file exists to catch. It was not; the
  // sheet was simply still open behind the assertion.
  //
  // Answer both. The ticket here is `received` — never cooked — so "No, never started" is the honest
  // answer and it records no false loss. Then ASSERT the button is really enabled before clicking,
  // so the next question added to this sheet fails loudly instead of silently.
  const reason = fr.locator('.rr-opt[data-code="mistake"]').first();
  await reason.waitFor({ timeout: 15000 });
  await reason.click({ force: true });
  await p.waitForTimeout(400);
  const madeNo = fr.locator('.rr-made-opt[data-made="0"]').first();
  if (await madeNo.count()) { await madeNo.click({ force: true }); await p.waitForTimeout(400); }
  const go = fr.locator(".rr-go").first();
  const goEnabled = await go.isEnabled().catch(() => false);
  check("the removal sheet's Remove button is enabled once every question is answered", goEnabled,
    "still disabled — the sheet is asking something this test has not answered");
  await go.click({ force: true });
  await p.waitForTimeout(11000);
}

st = await snap();
// THE TWO HALVES. The void must land, and it must land on ONE ticket only.
check("the parent's ticket really was voided", !st.live[PARENT], JSON.stringify(st.live));
check("the JOINED table's food SURVIVED", !!st.live[CHILD], `live: ${JSON.stringify(st.live)}`);
check("the party is STILL open (it was not force-closed)", st.open.length > 0, "open " + (st.open.join() || "(none)"));
check("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));

// ── AND THE ORDINARY WALK-OUT STILL WORKS ────────────────────────────────────────────────────────
// The fix above made "was that the last ticket?" a question about the PARTY instead of the table
// number. The common case is a table with no party at all, and that path is the reason this code
// exists — a solo table whose last ticket is voided must still free itself, with no confirm. If
// this half ever fails, the fix has been over-tightened and every walk-out leaves a table occupied.
console.log("\n  · and the plain solo walk-out:");
await wipe();
await q(`select lfh_staff_place_order('${PARENT}','[{"id":"${dish}","qty":1}]'::jsonb,'{}',null,'${RID}',true)`);
await q(`update orders set status='received' where restaurant_id='${RID}' and table_number='${PARENT}' and not archived and status<>'cancelled'`);
let solo = await snap();
check("fixture: one solo table with one live ticket", !!solo.live[PARENT] && !solo.live[CHILD] && solo.open.join() === PARENT, JSON.stringify(solo.live) + " open " + solo.open.join());
const soloOrderIdRows = await q(`select id from orders where restaurant_id='${RID}'
  and table_number='${PARENT}' and not archived and status<>'cancelled' order by created_at desc limit 1`);
// NEVER `[0].id` ON A LOOKUP THAT CAN COME BACK EMPTY (T28 sweep, 2026-08-22). When the fixture
// above fails to place its order, this line threw `TypeError: Cannot read properties of undefined`
// and the whole run died mid-way — no summary, no failing check, just a stack trace that says
// nothing about what went wrong. A guard must report; it must not crash.
if (!soloOrderIdRows[0]) {
  check(`fixture: table ${PARENT} has a live ticket to void`, false,
    "no un-archived, un-cancelled order on that table — the place_order above did not land, so "
    + "nothing below could run. Check its reply before reading this as a voiding fault.");
  { const bad = 1; console.log(`\n\u274c ${bad} check(s) failed — the fixture never landed`); process.exit(1); }
}
const soloOrderId = soloOrderIdRows[0].id;
await p.reload({ waitUntil: "networkidle", timeout: 120000 });
await p.waitForTimeout(5000);
try { await fr.locator('.tab[data-tab="tables"]').first().click({ timeout: 25000 }); } catch {}
await p.waitForTimeout(6500);
await fr.locator(`.ftile[data-floor-table="${PARENT}"]`).click({ force: true });
await p.waitForTimeout(5000);
const soloCancel = fr.locator(`[data-cancel-order="${soloOrderId}"]`).first();
check("the solo ticket offers ✕ Cancel", (await soloCancel.count()) > 0);
if ((await soloCancel.count()) > 0) {
  await soloCancel.click({ force: true });
  await p.waitForTimeout(1500);
  const r2 = fr.locator('.rr-opt[data-code="mistake"]').first();
  await r2.waitFor({ timeout: 15000 });
  await r2.click({ force: true });
  await p.waitForTimeout(400);
  // Both questions, same as the party half above — the sheet asks "was the food made?" since mig 340
  // and Remove stays disabled until it is answered.
  const made2 = fr.locator('.rr-made-opt[data-made="0"]').first();
  if (await made2.count()) { await made2.click({ force: true }); await p.waitForTimeout(400); }
  const go2 = fr.locator(".rr-go").first();
  check("the solo walk-out's Remove button is enabled once every question is answered",
    await go2.isEnabled().catch(() => false), "still disabled — an unanswered question on the sheet");
  await go2.click({ force: true });
  await p.waitForTimeout(11000);
}
solo = await snap();
check("the solo table freed itself (no live food left)", !solo.live[PARENT], JSON.stringify(solo.live));
// SCOPED TO THE TABLE THIS CHECK IS ABOUT (T5 sweep, 2026-08-17). It asserted that NEITHER of the
// two tables had an open session, so a guest order arriving on the OTHER table from anywhere else —
// another sweep lane, a real phone, the owner's own tab — failed a check about table 27's party.
// The sentence means "27's party ended", so that is what it asks.
check("…and its party was ended, so the next guests start clean", !solo.open.includes(PARENT), "open " + (solo.open.join() || "(none)"));

await browser.close();
await wipe();
console.log(`\n${fails ? `❌ ${fails} check(s) failed` : "✅ PASS — one void touches one ticket; a joined party survives; a solo table still frees itself"}\n`);
process.exit(fails ? 1 : 0);
