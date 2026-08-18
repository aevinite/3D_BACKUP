// verify-merged-floor.mjs — A REAL FLOOR, not a unit test (owner, 2026-08-01: "run simultaneous
// 4 table merge with 3 separate and all the stuff like real restaurant, and every button should work
// … conduct that test and if found fix, test again, until 0 error").
//
// It runs a four-table merged party (11+12+13+14) AT THE SAME TIME as three independent tables
// (21, 22, 23), drives every whole-party button from a JOINED table (13, never the one holding the
// bill), and after each step asserts BOTH halves:
//   · the party moved together (all four accepted / served / settled / unmerged / freed), and
//   · the three separate tables did NOT move — that is the half that catches a "fix" which quietly
//     applies a party action to the whole floor.
// It cleans up its own fixture. Run: node scripts/verify-merged-floor.mjs   (dev server on :4937)
// tables (21, 22, 23). Every whole-party button is driven from a JOINED table, and after each step we
// assert BOTH that the party moved together AND that the three separate tables did not move at all —
// that second half is the "don't break other things" test.
import { chromium } from "playwright";
import { loginAs } from "./sweep/login.mjs";
import fs from "node:fs";
// --base <url> so the same simulation can be pointed at a DEPLOYED site, not just the dev server
// (owner, 2026-08-02: "diagnose everything that you have built, it is working fine or not").
const ARG = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const B = ARG("--base", "http://localhost:4937");
const env = fs.readFileSync("/Users/aevinite/Documents/Projects/backup_Menu/.env.local", "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
// The database follows the site: backup-2 runs its own Supabase project, so testing that URL against
// backup-1's database would assert on rows the site never sees. --db picks the project ref.
const TOK = g("SUPABASE_ACCESS_TOKEN"), RID = "00000000-0000-0000-0000-000000000001";
const REF = ARG("--db", "wnsfcizclkbobwzcxqsf");
const q = async (sql) => { const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST", headers: { Authorization: "Bearer " + TOK, "content-type": "application/json" }, body: JSON.stringify({ query: sql }) });
  const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 160)); return JSON.parse(t); };
const PARTY = ["11", "12", "13", "14"], SOLO = ["21", "22", "23"];
const list = (a) => a.map((x) => `'${x}'`).join(",");
let fails = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? " — " + detail : ""}`); if (!ok) fails++; };
const snap = async () => {
  const o = await q(`select table_number, status, payment_status from orders where restaurant_id='${RID}'
    and table_number in (${list([...PARTY, ...SOLO])}) and not archived and status<>'cancelled' order by table_number`);
  const m = await q(`select child_table from table_merges where restaurant_id='${RID}' and ended_at is null and child_table in (${list(PARTY)})`);
  const s = await q(`select table_number from sessions where restaurant_id='${RID}' and status='open' and table_number in (${list([...PARTY, ...SOLO])})`);
  const by = {}; o.forEach((r) => { by[r.table_number] = `${r.status}/${r.payment_status || "pending"}`; });
  return { by, merges: m.map((x) => x.child_table), open: s.map((x) => x.table_number) };
};
// ── fixture
const dish = (await q(`select id from menu_items where restaurant_id='${RID}' limit 1`))[0].id;
await q(`delete from table_merges where restaurant_id='${RID}' and child_table in (${list([...PARTY, ...SOLO])})`);
await q(`update orders set status='cancelled',archived=true,archived_at=now() where restaurant_id='${RID}' and table_number in (${list([...PARTY, ...SOLO])}) and not archived`);
await q(`update sessions set status='closed',closed_at=now() where restaurant_id='${RID}' and table_number in (${list([...PARTY, ...SOLO])}) and status='open'`);
for (const t of [...PARTY, ...SOLO]) await q(`select lfh_staff_place_order('${t}','[{"id":"${dish}","qty":2}]'::jsonb,'{}',null,'${RID}',true)`);
const sid = async (t) => (await q(`select id from sessions where restaurant_id='${RID}' and table_number='${t}' and status='open' order by created_at desc limit 1`))[0]?.id;
for (const t of ["12", "13", "14"]) await q(`select lfh_staff_merge_tables('${await sid(t)}','11','${RID}')`);
// Orders 2..n of a party are born 'preparing' (mig 164 auto-accept), so a fixture built by placing
// several orders has nothing left to Accept — which looks like a missing button. Put them all back to
// 'received' so the Accept-all step is actually exercised.
await q(`update orders set status='received' where restaurant_id='${RID}'
  and table_number in (${list([...PARTY, ...SOLO])}) and not archived and status<>'cancelled'`);
let st = await snap();
check("fixture: 4-table party merged", st.merges.sort().join() === "12,13,14", "merges " + st.merges.join());
check("fixture: 3 separate tables open", SOLO.every((t) => st.open.includes(t)), "open " + st.open.join());

// ── drive the party from a JOINED table (13)
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
await loginAs(ctx, "manager", B, { username: "diagm1", password: "diag-mgr-2026", route: "/manager" });
const p = await ctx.newPage(); const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
await p.goto(B + "/manager", { waitUntil: "networkidle", timeout: 120000 });
await p.waitForTimeout(4500);
const fr = p.frameLocator("iframe").first();
try { await fr.locator('.tab[data-tab="tables"]').first().click({ timeout: 25000 }); } catch {}
await p.waitForTimeout(6500);
// tiles: all four purple and naming the others; the three separate ones untouched
for (const t of PARTY) {
  const d = await fr.locator(`.ftile[data-floor-table="${t}"]`).evaluate((el) => ({ c: getComputedStyle(el).getPropertyValue("--c").trim(), txt: el.innerText.replace(/\s+/g, " ") }));
  check(`T${t} tile purple + names the party`, d.c === "#a855f7" && /⇄ with/.test(d.txt), d.txt.slice(0, 40));
}
for (const t of SOLO) {
  const d = await fr.locator(`.ftile[data-floor-table="${t}"]`).evaluate((el) => ({ c: getComputedStyle(el).getPropertyValue("--c").trim(), txt: el.innerText.replace(/\s+/g, " ") }));
  check(`T${t} (separate) not purple, no merge text`, d.c !== "#a855f7" && !/⇄ with/.test(d.txt), d.txt.slice(0, 30));
}
await fr.locator('.ftile[data-floor-table="13"]').click({ force: true });
await p.waitForTimeout(5000);
const det = await fr.locator('[data-floating-table="13"]').evaluate((el) => ({
  title: (el.querySelector(".sx-party-title")?.textContent || "").trim(), kots: (el.innerText.match(/KOT #\d+/g) || []).length,
  unmerge: el.querySelectorAll(".sx-unmerge-row [data-unmerge]").length, loading: !!el.querySelector(".sx-loading") }));
check("joined table's detail: party title, all 4 tickets, unmerge at bottom", det.title === "T11 + T12 + T13 + T14" && det.kots === 4 && det.unmerge === 1 && !det.loading, JSON.stringify(det));
// accept all
const acc = fr.locator("[data-accept-all]").first();
check("accept-all counts the whole party", (await acc.count()) > 0 && /\(4\)/.test(await acc.innerText()), await acc.innerText().catch(() => "missing"));
await acc.click({ force: true }); await p.waitForTimeout(8000);
st = await snap();
check("accept all → all 4 preparing", PARTY.every((t) => st.by[t] === "preparing/pending"), JSON.stringify(st.by));
check("accept all → the 3 separate tables untouched", SOLO.every((t) => st.by[t] === "received/pending"), SOLO.map((t) => t + ":" + st.by[t]).join(" "));
// serve all
const sa = fr.locator("[data-serve-all-orders]").first();
check("serve-all offered", (await sa.count()) > 0);
await sa.click({ force: true }); await p.waitForTimeout(8000);
st = await snap();
check("serve all → all 4 served", PARTY.every((t) => st.by[t] === "served/pending"), JSON.stringify(st.by));
check("serve all → separate tables still received", SOLO.every((t) => st.by[t] === "received/pending"));
// mark paid
const pay = fr.locator("#sxPayAll").first();
check("mark-paid offered", (await pay.count()) > 0);
await pay.click({ force: true }); await p.waitForTimeout(2500);
const cash = fr.locator('button:has-text("Cash")').first();
if (await cash.count()) { await cash.click({ force: true }); }
// WAIT FOR THE MONEY, DON'T GUESS AT IT (T5 sweep, 2026-08-17). This was a flat 10-second sleep,
// and a party's bill is settled one order at a time — four requests, plus the invoice afterwards.
// On a dev database answering in ~450ms, or one that hands back a 503 and makes the panel's queue
// retry (which is the panel behaving correctly), that is longer than 10s, and the check failed on a
// run where the payment had simply not landed YET. A guard that flaps teaches people to re-run it
// until it is green, which is the opposite of what it is for. Same assertion, polled: up to 30s.
for (let i = 0; i < 30; i++) {
  st = await snap();
  if (PARTY.every((t) => (st.by[t] || "").endsWith("/paid"))) break;
  await p.waitForTimeout(1000);
}
// A TABLE IS NEVER ENDED BY THE APP (mig 254, owner 2026-08-02: "all the serve has been done
// and all the mark-as-paid has been done … the table restarts. I don't want that"). These three
// checks were written the same day and still asserted the OLD auto-close behaviour — that
// paying made the party vanish, unmerge and free its tables. That behaviour was deliberately
// DELETED: a paid party is usually still sitting there finishing their coffee, and the manager
// frees the table with the ✓ Close control when they actually leave.
// So the rule to hold the line on now is the opposite one: paying settles the money and
// changes NOTHING about who is sitting where.
check("mark paid → the whole party is paid", PARTY.every((t) => (st.by[t] || "").endsWith("/paid")), JSON.stringify(st.by));
check("mark paid → the party stays ONE bill until someone closes it", st.merges.length > 0, "merges: " + st.merges.join());
// Only the PARTY HEAD holds an open session — a merged child is served by its parent's, which
// is the whole point of a merge. So "nothing ended itself" means the head is still open.
check("mark paid → no table ended itself (mig 254)", st.open.includes(PARTY[0]), "open " + st.open.join());
check("mark paid → the 3 separate tables STILL open and unpaid", SOLO.every((t) => st.open.includes(t) && st.by[t] === "received/pending"), SOLO.map((t) => t + ":" + st.by[t]).join(" "));
// a separate table's own flow must still work end to end
await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(5000);
const fr2 = p.frameLocator("iframe").first();
try { await fr2.locator('.tab[data-tab="tables"]').first().click({ timeout: 25000 }); } catch {}
await p.waitForTimeout(6000);
await fr2.locator('.ftile[data-floor-table="21"]').click({ force: true }); await p.waitForTimeout(4500);
const a2 = fr2.locator("[data-accept-all]").first();
check("separate table's accept-all counts only itself", (await a2.count()) > 0 && /\(1\)|prepare$/.test((await a2.innerText()).trim()), await a2.innerText().catch(() => "missing"));
await a2.click({ force: true }); await p.waitForTimeout(7000);
st = await snap();
check("separate table accepted alone", st.by["21"] === "preparing/pending" && st.by["22"] === "received/pending" && st.by["23"] === "received/pending", SOLO.map((t) => t + ":" + st.by[t]).join(" "));
console.log("\npage errors:", errs.length ? errs : "none");
console.log(fails === 0 && errs.length === 0 ? "\n✅ ALL CHECKS PASSED" : `\n❌ ${fails} check(s) failed, ${errs.length} console error(s)`);
await b.close();
process.exit(fails === 0 && errs.length === 0 ? 0 : 1);
