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
import { dismissTicketsForSql } from "./sweep/tickets.mjs";
import { requireUp } from "./sweep/appUp.mjs";

const ARG = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const B = ARG("--base", "http://localhost:4937");
const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
// Nothing answering = "could not run" (exit 2), said in plain words — never a raw ECONNREFUSED
// stack, which reads as "this guard is broken". (sweep #6 / T28, 2026-08-22)
await requireUp(B, "the void-on-a-party walk");
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

// THE REMOVAL SHEET ASKS **TWO** QUESTIONS NOW, AND BOTH ARE REQUIRED (owner, 2026-08-18: "while kot
// delete button there will be one thing order was mode and order was not made like in red they have to
// choose"). askRemovalReason(what, { askMade: true }) — which is what cancelOrder passes — adds "Was
// the food actually made?" above the reason grid, and its `sync()` keeps the Remove button disabled
// until BOTH are answered. `go.onclick` then returns early while disabled.
//
// This guard answered only the reason, clicked Remove into a dead button, and reported three failures
// on behaviour that is exactly right: "the parent's ticket really was voided" and both halves of the
// solo walk-out. The two answers do completely different things to the kitchen's stock — cooked means
// the ingredients are gone, never started puts them back — so neither may be guessed, and a guard that
// skips one is testing a flow no waiter can perform. Answer both, the way a waiter does.
async function answerRemovalSheet(fr, page, { made = false, code = "mistake" } = {}) {
  const madeBtn = fr.locator(`.rr-made-opt[data-made="${made ? 1 : 0}"]`).first();
  if (await madeBtn.count()) { await madeBtn.click({ force: true }); await page.waitForTimeout(400); }
  const reason = fr.locator(`.rr-opt[data-code="${code}"]`).first();
  await reason.waitFor({ timeout: 15000 });
  await reason.click({ force: true });
  await page.waitForTimeout(600);
  const go = fr.locator(".rr-go").first();
  // A disabled Remove means a question is still unanswered — say which, instead of clicking a dead
  // button and blaming the app eleven seconds later.
  if (await go.isDisabled().catch(() => false)) {
    const asked = (await fr.locator(".rr-modal").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error("the removal sheet still refuses Remove after both answers — it is asking something new: " + asked);
  }
  await go.click({ force: true });
}

const wipe = async () => {
  await q(`delete from table_merges where restaurant_id='${RID}' and (child_table in (${BOTH}) or parent_table in (${BOTH}))`);
  await q(`update orders set status='cancelled', archived=true, archived_at=now(), cancelled_at=now()
           where restaurant_id='${RID}' and table_number in (${BOTH}) and not archived`);
  await q(`update sessions set status='closed', closed_at=now()
           where restaurant_id='${RID}' and table_number in (${BOTH}) and status='open'`);
  // …and the kitchen tickets those orders queued. Nothing polls the print basket on a stack with no
  // kitchen screen open, so lib/printQueue's own "cancelled before this ticket printed" dismissal never
  // runs and the manager's floor keeps a red "hasn't printed" banner for each. (T28, 2026-08-22)
  await dismissTicketsForSql(q, RID, [PARENT, CHILD]);
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

// A FIXTURE THAT DID NOT LAND MUST SAY SO, HERE (sweep #6 / T28, 2026-08-22). These three calls threw
// their answer away, so when the RPC refused one — sold out, an unknown dish, a duplicate window — the
// first sign was "fixture: both tables carry live food — {}" four checks later, or a TypeError reading
// `.id` of undefined eighty lines further on. Neither names the cause. The RPC always answers
// { ok, reason }; read it.
const place = async (table, qty) => {
  const r = await q(`select lfh_staff_place_order('${table}','[{"id":"${dish}","qty":${qty}}]'::jsonb,'{}',null,'${RID}',true) as res`);
  const res = r[0] && r[0].res;
  if (!res || res.ok !== true) throw new Error(`could not seat the fixture on table ${table}: ${JSON.stringify(res)}`);
  return res;
};
for (const t of [PARENT, CHILD]) await place(t, 2);
const sid = async (t) => (await q(`select id from sessions where restaurant_id='${RID}' and table_number='${t}' and status='open' order by created_at desc limit 1`))[0]?.id;
{
  const childSid = await sid(CHILD);
  if (!childSid) throw new Error(`table ${CHILD} has no open session to merge — its fixture order did not land`);
  const m = await q(`select lfh_staff_merge_tables('${childSid}','${PARENT}','${RID}') as res`);
  const mr = m[0] && m[0].res;
  if (mr && mr.ok === false) throw new Error(`the two tables would not join: ${JSON.stringify(mr)}`);
}
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
// WAIT FOR THE FLOOR TO ACTUALLY SHOW THE PARTY (sweep #6 / T28, 2026-08-22). A fixed sleep is a guess,
// and on a busy dev box it was the wrong guess often enough that "the joined child's tile is purple"
// failed against a database that plainly said both tables were full and joined — the panel simply had
// not drawn them yet. That reads as a merge bug and is a stopwatch. Poll for the thing the next check
// is about, and if it never arrives, say THAT: a party the floor never draws is a real fault and it
// deserves its own sentence.
{
  let drawn = false;
  for (let i = 0; i < 30 && !drawn; i++) {
    drawn = await fr.locator(`.ftile[data-floor-table="${CHILD}"]`).evaluate(
      (el) => getComputedStyle(el).getPropertyValue("--c").trim() === "#a855f7").catch(() => false);
    if (!drawn) await p.waitForTimeout(1000);
  }
  if (!drawn) console.log(`  (the floor has not drawn table ${CHILD} as part of the party after 30s — the next checks say what that looks like)`);
}

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
const parentOrderId = (await q(`select id from orders where restaurant_id='${RID}'
  and table_number='${PARENT}' and not archived and status<>'cancelled' order by created_at desc limit 1`))[0].id;
await fr.locator(`.ftile[data-floor-table="${PARENT}"]`).click({ force: true });
await p.waitForTimeout(5000);
const cancelBtn = fr.locator(`[data-cancel-order="${parentOrderId}"]`).first();
check("the parent's own ticket offers ✕ Cancel", (await cancelBtn.count()) > 0);
if ((await cancelBtn.count()) > 0) {
  await cancelBtn.click({ force: true });
  await p.waitForTimeout(1500);
  await answerRemovalSheet(fr, p);
  // DID THE SHEET ACTUALLY CLOSE? Both answers given and Remove enabled is not the same as the action
  // going through, and "the parent's ticket really was voided — {27:received}" four lines later does not
  // say which half failed. If the sheet is still up, the tap was not answered; that is a different fault
  // from a void that ran and did nothing, and they need different fixes.
  const sheetGone = await fr.locator(".rr-overlay").first().waitFor({ state: "detached", timeout: 12000 }).then(() => true).catch(() => false);
  check("the removal sheet accepted both answers and closed", sheetGone,
    sheetGone ? "" : "Remove was enabled and clicked, but the sheet is still on screen — the tap was not answered");
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
// BUILD THIS FIXTURE WITH THE PANEL LOOKING AWAY (sweep #6 / T28, 2026-08-22). The manager panel is
// still open on the floor from the half above, and it is doing its job: `wipe()` cancels the party's
// last live ticket, the panel notices the table has nothing left on it, and frees the table — which is
// precisely the behaviour the check below is about. So the fixture kept vanishing between being placed
// and being read ("fixture: one solo table with one live ticket — {} open"), on a floor that was
// behaving perfectly. Reload the panel FIRST, so it starts from the wiped board and has no stale
// ticket to act on, and only then seat the new party. Intermittent before this, and the failure landed
// on the wrong line.
await wipe();
await p.reload({ waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => {});
await p.waitForTimeout(4000);
await place(PARENT, 1);
await q(`update orders set status='received' where restaurant_id='${RID}' and table_number='${PARENT}' and not archived and status<>'cancelled'`);
// One re-read if the board is still catching up — the fixture is real, the question is only whether
// this process can see it yet.
let solo = await snap();
if (!solo.live[PARENT]) { await p.waitForTimeout(2500); solo = await snap(); }
check("fixture: one solo table with one live ticket", !!solo.live[PARENT] && !solo.live[CHILD] && solo.open.join() === PARENT, JSON.stringify(solo.live) + " open " + solo.open.join());
const soloOrderId = (await q(`select id from orders where restaurant_id='${RID}'
  and table_number='${PARENT}' and not archived and status<>'cancelled' order by created_at desc limit 1`))[0].id;
await p.reload({ waitUntil: "networkidle", timeout: 120000 });
await p.waitForTimeout(5000);
try { await fr.locator('.tab[data-tab="tables"]').first().click({ timeout: 25000 }); } catch {}
await p.waitForTimeout(6500);
// WAIT FOR THE FLOOR TO ACTUALLY SHOW THE PARTY (sweep #6 / T28, 2026-08-22). A fixed sleep is a guess,
// and on a busy dev box it was the wrong guess often enough that "the joined child's tile is purple"
// failed against a database that plainly said both tables were full and joined — the panel simply had
// not drawn them yet. That reads as a merge bug and is a stopwatch. Poll for the thing the next check
// is about, and if it never arrives, say THAT: a party the floor never draws is a real fault and it
// deserves its own sentence.
{
  let drawn = false;
  for (let i = 0; i < 30 && !drawn; i++) {
    drawn = await fr.locator(`.ftile[data-floor-table="${CHILD}"]`).evaluate(
      (el) => getComputedStyle(el).getPropertyValue("--c").trim() === "#a855f7").catch(() => false);
    if (!drawn) await p.waitForTimeout(1000);
  }
  if (!drawn) console.log(`  (the floor has not drawn table ${CHILD} as part of the party after 30s — the next checks say what that looks like)`);
}
await fr.locator(`.ftile[data-floor-table="${PARENT}"]`).click({ force: true });
await p.waitForTimeout(5000);
const soloCancel = fr.locator(`[data-cancel-order="${soloOrderId}"]`).first();
check("the solo ticket offers ✕ Cancel", (await soloCancel.count()) > 0);
if ((await soloCancel.count()) > 0) {
  await soloCancel.click({ force: true });
  await p.waitForTimeout(1500);
  await answerRemovalSheet(fr, p);
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
