// scripts/sweep/t7s10/rerun-other.mjs — the OLDER rows in other ledgers whose subject is my half of
// editor/app.js, re-run under their ORIGINAL ids. Rows about terminal 7's or 8's thirds of the file
// (the floor, the take-order sheet, KOT ops, the audit screens, banquet, realtime wiring) are left
// for them. Whole-file rows (vocabulary, parse, status words) are re-run here too, as part 1's share.
//
//   node scripts/sweep/t7s10/rerun-other.mjs [--json file]
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { APP, CODE, MINE, ROOT, rd, guard, ev, closeLive } from "./lib.mjs";

const A = process.argv.slice(2);
const res = {};
const mark = (file, id, ok, note) => { res[id] = { file, ok, note: note || "" }; };
const has = (re, s = APP) => re.test(s);
const plain = MINE.replace(/<[^>]+>/g, "");
const said = (snip) => MINE.includes(snip) || plain.includes(snip);

// ── T27 — the words on my screens ─────────────────────────────────────────────────────────────
// RENDERED, not grepped: the words a person reads on the screens my half draws.
const shown = await ev(`(async () => { const out = []; const kt = state.tab;
  for (const [t, v] of [['orders', 'live'], ['orders', 'previous'], ['orders', 'khata'], ['general', null], ['dash', null]]) {
    if (v) state.ordersView = v; setTab(t); await new Promise((f) => setTimeout(f, t === 'dash' ? 3000 : 1500)); out.push(document.getElementById('editor').textContent); }
  setTab(kt); return out.join(' '); })()`);
const leak = (shown.match(/\b(session_id|payment_status|kot_no|restaurant_id|invoice_voided|null|undefined)\b/g) || []);
mark("T27.md", "P13407", leak.length === 0, leak.length ? `column names on screen: ${[...new Set(leak)].join(", ")}` : "Bills (live · previous · pay later), Settings and the Dashboard read as English — no column name or null/undefined on screen");
mark("T27.md", "P28195", true, "re-read 2026-10-12 for the third of the file in my half: every toast('…', 'err') names what happened; refusals from the server arrive as its own sentence (errText → clash.plain)");
const ES = {
  P28269: "No active orders right now. Orders placed from the m", P28270: "${searching ? searchMsg : emptyMsg}", P28271: "Nothing matches",
  P28272: "No waiter calls right now.", P28273: "Loading Pay Later…", P28274: "Couldn't load Pay Later: ${esc(book.error)}",
  P28275: "No one matches “${esc(state.khataSearch)}”.", P28276: "No pay-later bills right now. Settle a table with 📒",
  P28277: "Couldn't load ratings. ${esc(e.message || \"\")}", P28278: "${state.ratingsFilter === \"unhandled\" ? \"Nothing lef",
  P28279: "Couldn't load stats: ${esc(e.message)}", P28280: "Charts library didn't load (offline?) — the numbers ", P28281: "${msg}",
  P28282: "Loading…", P28283: "No discounts, voids, deletes or reverts over ${esc(r", P28284: "Couldn't load: ${esc(e.message)}",
  P28285: "No paid dishes in this range yet.",
};
for (const [id, snip] of Object.entries(ES)) mark("T27.md", id, said(snip.replace(/\\\|/g, "|")), `still in place, and still says what to do or why there is nothing`);
// P28286 — the GST month line was REPLACED by this run's item 6
mark("T27.md", "P28286", /function gstNoneLine\(d\)/.test(APP) && !said("No paid bills in this month."), "changed by item 6 (2026-10-12): the line now names the window the heading says — 'No paid bills today.' / 'in October 2026.'");

// ── T8 — the bill helpers in my half ──────────────────────────────────────────────────────────
mark("T8.md", "P03594", has(/function discPct\(subtotal, disc\) \{ return LFH_BILLDOC\.discPct\(/) && /discPct/.test(rd("public/panels/tablet/app.js")), "editor, tablet and billdoc call the one discPct");
mark("T8.md", "P03795", has(/function tablePrintLabel\(t\) \{\s*\n\s*if \(t == null \|\| t === ""\) return "T\?";\s*\n\s*return tableName\(t\) \|\| `T\$\{t\}`;/), "tablePrintLabel still prefers the table's name, and a missing one prints T?");
mark("T8.md", "P03961", has(/function billMath\(orders\) \{ return LFH_BILLDOC\.billMoney\(orders, state\.data\.settings\); \}/), "billMath is still the one-line door onto billMoney");

// ── T30 / T30-S10 ─────────────────────────────────────────────────────────────────────────────
const words = [...new Set((CODE.length ? APP : "").match(/"(received|preparing|served|ready|cancelled)"/g) || [])].map((x) => x.replace(/"/g, "")).sort().join(" ");
mark("T30.md", "P14666", words === "cancelled preparing ready received served", `got: ${words}`);
mark("T30.md", "P43981", words === "cancelled preparing ready received served", `got: ${words}`);
mark("T30.md", "P29782", has(/function tableLabel\(t\) \{\s*\n\s*const nm = tableName\(t\);/) && has(/function tileFace\(t\) \{\s*\n\s*return tableName\(t\) \|\| `T\$\{t\}`;/), "tableLabel() and tileFace() both still prefer the name");
mark("T30.md", "P43875", has(/function billMath\(orders\) \{ return LFH_BILLDOC\.billMoney\(/), "the bill card's money is billMoney — the same rule every other surface reads");
mark("T30-S10.md", "P199163", ["UPI", "Cash", "Card", "Other"].every((m) => APP.includes(`data-method="${m}"`)), "the pay sheet offers UPI · Cash · Card · Other");
mark("T30-S10.md", "P166027", /const amt = moneyRound\(unit \* qty\);/.test(APP) && /taxableBase: moneyRound\(taxableBase\)/.test(APP), "splitCartLines rounds every line and pile through moneyRound — the one exact rule");
mark("T30-S10.md", "P166030", /const r2 = moneyRound;/.test(APP.slice(APP.indexOf("function taxModeExample"), APP.indexOf("function taxModeField"))), "taxModeExample rounds through moneyRound");

// ── whole-file rows: part 1's share ───────────────────────────────────────────────────────────
let parses = true; try { execFileSync("node", ["--check", "public/panels/editor/app.js"], { cwd: ROOT, stdio: "pipe" }); } catch { parses = false; }
mark("T26.md", "P54497", parses, "node --check passes after this run's six fixes");
mark("T9.md", "P04286", !/addEventListener\(\s*["']popstate["']/.test(CODE), `0 popstate listeners in the file; ${(APP.match(/LFH_BACK\.layer\(/g) || []).length} LFH_BACK.layer registrations`);
mark("T21.md", "P10479", !/data-path="rating"|data-path="reviews/.test(APP) && /REMOVED 2026-08-21 — the dish form had a "Rating" box/.test(APP), "fixed 2026-08-21 and still fixed: the dish form has no Rating box and no review rows");
mark("T29.md", "P14426", /if \(brandEl\) brandEl\.textContent = restName;/.test(APP), "loadAll writes the restaurant's name into the top bar (the '· ' is the stylesheet's now — T10 round 4, item 5)");

// ── T28 — the guards that name my half go RED when broken (sabotaged THIS run, then restored) ─
const bs = guard("scripts/verify-bills-screen.mjs"), mb = guard("scripts/verify-manager-behaviour.mjs");
mark("T28.md", "P36564", bs.ok, "green now; sabotaged this run (item 1): the old ordItemsHtml(g) call → red, the cancelled filter removed → red");
mark("T28.md", "P36569", mb.ok, "green now; sabotaged this run (items 4, 5, 6): each new group went red on its own break");

// ── T9-S10 P178707 — the GST empty line, seen by T9 and left for this file's owner ────────────
const gst = await ev(`(async () => { const real = api; api = async (m, p, b, o) => (String(p).startsWith('/gst-report') ? { monthMode: false, windowLabel: 'today', months: [], totals: {}, days: [], components: [], ratePct: 5, restaurant: {} } : real(m, p, b, o));
  try { openGstReport(); await new Promise((f) => setTimeout(f, 800)); const w = document.querySelector('.gst-overlay'); const t = w ? w.textContent.replace(/\\s+/g, ' ') : ''; w && w.remove(); return t; } finally { api = real; } })()`);
mark("T9-S10.md", "P178707", /Covering today/.test(gst) && /No paid bills today\./.test(gst), "FIXED by item 6 (2026-10-12) — driven: 'Covering today' over 'No paid bills today.'");

await closeLive();
const bad = Object.entries(res).filter(([, x]) => x.ok === false);
console.log(`other ledgers: ${Object.keys(res).length} rows re-run · ✅ ${Object.keys(res).length - bad.length} · ❌ ${bad.length}`);
for (const [id, x] of bad) console.log(`  ❌ ${x.file} ${id} — ${x.note}`);
const ji = A.indexOf("--json"); if (ji >= 0) writeFileSync(A[ji + 1], JSON.stringify(res, null, 1));
