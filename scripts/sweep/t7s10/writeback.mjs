// scripts/sweep/t7s10/writeback.mjs — write terminal 7's re-run results back INTO the rows where
// they live, under their original ids. Each row's result column becomes today's mark and its last
// cell gains one "re-run 2026-10-16 (sweep #10, T7)" clause. Nothing else in any row is touched, and
// a row already carrying the clause is left alone (so a second run cannot double it).
//
//   node scripts/sweep/t7s10/writeback.mjs <t7s8.json> <t6s8.json> <t5.json> <live.json> [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const [f7, f6, f5, fl] = process.argv.slice(2);
const dry = process.argv.includes("--dry");
const J = (f) => JSON.parse(readFileSync(f, "utf8"));
const TAG = "re-run 2026-10-16 (sweep #10, T7)";
const updates = new Map();
const put = (file, id, mark, note) => updates.set(`${file}|${id}`, { mark, note });

// ── sweep #8 T7 (T7.md): rows whose pattern no longer lands, judged by hand against today's code ──
const JUDGED_T7 = {
  P60936: ["✅", "re-judged: 'is it invoiced' is still worked out ONCE — orderItemRows() calls invoiceLocksOrder(_s, o) and every row carries it"],
  P60937: ["✅", "changed BY THE OWNER (2026-09-25): a REOPENED bill now locks the tickets that were on the paper (invoiceLocksOrder, mig 407); the server agrees (invoiceLockedByOrder)"],
  P61041: ["✅", "re-judged: patchFloorTiles still swaps the stats strip in place — `statsEl.outerHTML = floorStatsHtml()` inside a block now"],
  P61064: ["✅", "changed BY THE OWNER (2026-09-17, 'portrait form only'): FLOAT_MAX_W = 392, a phone's width — the old 640 is gone on purpose"],
  P61074: ["✅", "re-judged on the Spine popup: spineSheet's canDel = session row && not served && !p.invoiceLive"],
  P61075: ["✅", "re-judged: canDel refuses a served dish"],
  P61076: ["✅", "re-judged: canQty = session row && not served && not ready && !invoiceLive"],
  P61097: ["✅", "re-judged: cancelBtn = (anyServed(o) || invoiceLocksOrder(sess, o) || paid) ? '' : ✕"],
  P61098: ["✅", "REGRESSION found today (❌, green 2026-09-03): the 2026-09-17 redesign dropped the paid check from the waiting box's ✕ Cancel, while 💳 Mark all paid settles a waiting ticket and the server refuses to cancel a paid one. FIXED, item 2 (verify:manager-behaviour M)"],
  P61100: ["✅", "re-judged: discBtn = discTarget && !_inv && !_allPaid"],
  P61104: ["✅", "re-judged: the Spine money line names MRP apart — '· MRP <b>₹…</b>'"],
  P61131: ["✅", "superseded BY THE OWNER (2026-09-17, 'I want it instantly'): the builder closes first and a refusal hands the cart back whole (handBack); the parcel path still re-enables its buttons on failure"],
  P61132: ["✅", "superseded: a queued dine-in order now says QUEUED_LINE, the one 'saved on this device' sentence the panel uses everywhere"],
  P61136: ["✅", "superseded: answering no to 'send it again?' re-opens the builder with the same cart (askDuplicate → openTakeOrder(…, { restore }))"],
  P98964: ["✅", "retired on purpose: itemRowHtml() was deleted 2026-09-17 with its obituary above openDishEditModal; serve now lives on each Spine line and its sheet"],
  P98965: ["✅", "retired with itemRowHtml(); the Spine sheet keeps the split — serveAttrOf: session row by id, legacy row by order+index"],
  P98966: ["✅", "retired with itemRowHtml(); a Spine line prints inr(price × qty), so a ₹0 line reads ₹0"],
  P98967: ["✅", "retired with itemRowHtml(); a Spine line shows status by its serve control and the progress legend"],
  P98968: ["✅", "retired with itemRowHtml()"],
};
const LIVE_T7 = { P61244: "live", P99261: "live", P99274: "live", P99277: "live" };
for (const r of J(f7)) {
  if (r.owner === "mine" && !LIVE_T7[r.id]) put("T7.md", r.id, r.ok ? "✅" : "❌", r.ok ? `${r.runner} — ${r.why}` : `${r.runner}: ${r.note}`);
  if (JUDGED_T7[r.id]) put("T7.md", r.id, ...JUDGED_T7[r.id]);
}
const L = J(fl);
const liveMark = (x) => (x.ok === "skip" ? "⏭" : x.ok ? "✅" : "❌");
for (const id of Object.keys(LIVE_T7)) if (L[id]) put("T7.md", id, liveMark(L[id]), (id === "P99277" ? "REGRESSION found today (❌, green 2026-09-03): the ✎ Edit button never drew — a per-row `allOut` function shadowed the table-wide boolean (2026-09-17). FIXED, item 1 (verify:manager-behaviour L). Now: " : "") + L[id].note);
// ── sweep #8 T6 (T6.md): the static rows whose subject is DECLARED in my third, and P60651 ──
for (const r of J(f6)) if (r.owner === "mine") put("T6.md", r.id, r.mark, r.id === "P60534"
  ? "NOT a product fault: unblock() has had no caller since the floor's Blocked card left (2026-07-31) — the Customer log's Unblock calls unblockLog(). A dead wrapper; listed for the owner, not deleted"
  : r.note);
if (L.P60651) put("T6.md", "P60651", liveMark(L.P60651), L.P60651.note);
// ── T5.md: the text rows whose pattern lands in my third, the ones whose pattern moved, and the
//    33 driven rows on my screens ──
const MOVED_T5 = {
  P02055: "re-judged: the stats strip is still swapped in place — `statsEl.outerHTML = floorStatsHtml()`, inside a block now (patchFloorTiles)",
  P02062: "re-judged: a joined table still counts as occupied — `if (joined || (st !== \"free\" && st !== \"req\")) { cOcc++; occList.push(…) }` (the list feeds the tap-a-number sheet)",
  P02130: "re-judged: a sold-out refusal still names the dish and hands the order back — '😕 <dish> just sold out — it was NOT sent. Remove it and send again.' (handBack, 2026-09-17)",
  P17330: "re-judged: as P02130 — the cart comes back whole (openTakeOrder restore) with the dish named",
  P17332: "re-judged: a queued order says QUEUED_LINE — 'Saved on this device ✓ — it'll send by itself the moment you're back online.'",
  P35146: "re-judged: ✕ Cancel is withheld through invoiceLocksOrder(sess, o) — the owner's 2026-09-25 narrowing (a reopened bill locks what was on the paper)",
  P35147: "re-judged: the dish's 🗑 (spineSheet canDel) checks !p.invoiceLive",
  P35148: "re-judged: invoiceLive is still worked out ONCE, in orderItemRows() (the comment now reads 'IS THIS ORDER LOCKED BY ITS BILL'S PAPER?')",
};
for (const x of J(f5)) {
  if (x.kind === "dsl" && x.owner === "mine") put("T5.md", x.id, x.ok ? "✅" : "❌", x.ok ? `pattern still lands in my third (line ${x.at})` : x.id === "P17162" ? "deliberate — the printer band's bindings were deleted (sweep #8 T7); the pattern lives on only in their obituary, and the live readout is the 🔔 bell" : `pattern lands in my third but the assertion FAILS${x.err ? " — " + x.err : ""}`);
  if (x.id === "P17162") put("T5.md", x.id, "✅", "deliberate — the printer band's bindings were deleted (sweep #8 T7); the pattern lives on only in their obituary (bindFloor), and the live readout is the 🔔 bell");
  if (MOVED_T5[x.id]) put("T5.md", x.id, "✅", MOVED_T5[x.id]);
}
const T5_LIVE = ["P02310", "P02317", "P02319", "P02335", "P02337", "P02338", "P02364", "P02370", "P02374", "P02375", "P02376", "P02399", "P02400", "P02401", "P02420", "P02423", "P02434", "P02444", "P02447", "P02458", "P02497", "P17505", "P17515", "P17516", "P17520", "P17521", "P17531", "P17538", "P17549", "P17552", "P17577", "P17583", "P17600"];
for (const id of T5_LIVE) if (L[id]) put("T5.md", id, liveMark(L[id]), L[id].note);
// ── four other ledgers, re-read by hand today ──
const HAND = {
  "T12.md": { P05933: "re-read: the owner's REMOVAL_REASON and the manager's REMOVAL_REASONS still carry the same six codes in the same words", P21000: "re-read: same six, same wording" },
  "T27.md": { P28287: "re-read: renderEditor's log tab still says 'None of the Audit & logs views are enabled for managers here — ask the restaurant's admin.'", P28293: "re-read: auditHtml's empty line still says why — 'Nothing matches that.' / 'Nothing of that kind — tap All…' / 'Nothing has been removed yet…'" },
  "T30.md": { P14586: "re-read: LFH_RT.start's handlers are still ops + menu only — no audit handler; the 60s backstop refreshes it (mig 267)", P29789: "re-read: floorTableList's extras filter keeps `|| !!mergeParentOf(k)`", P29794: "re-read: an occupied table above the count still earns a tile (extras with a non-free state)", P29839: "re-read: same merge test in floorTableList", P29851: "re-read: as P14586" },
  "T8.md": { P03717: "re-read: all four printParcelReceipt calls (parcel tile, take-order counter pay, the platform board, the queue) pass bill_no AND invoice_no" },
};
for (const [file, rows] of Object.entries(HAND)) for (const [id, note] of Object.entries(rows)) put(file, id, "✅", note);

// ── write ──
const byFile = new Map();
for (const [k, v] of updates) { const [file, id] = k.split("|"); if (!byFile.has(file)) byFile.set(file, new Map()); byFile.get(file).set(id, v); }
let total = 0;
const tally = {};
for (const [file, ids] of byFile) {
  const path = join(ROOT, ".claude/sweep/LEDGER", file);
  const lines = readFileSync(path, "utf8").split("\n");
  const left = new Set(ids.keys());
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\| (P\d{5,6}) \|/);
    if (!m || !left.has(m[1])) continue;
    const { mark, note } = ids.get(m[1]);
    const cells = lines[i].split(/(?<!\\)\|/);
    if (cells.length < 6) continue;
    left.delete(m[1]);
    if (lines[i].includes(TAG)) continue;
    cells[4] = ` ${mark} `;
    const clause = `**${TAG}: ${mark}${note ? " — " + String(note).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 400) : ""}**`;
    const last = cells.length - 2;
    cells[last] = `${cells[last].trimEnd()}${cells[last].trim() ? " · " : " "}${clause} `;
    lines[i] = cells.join("|");
    total++; tally[mark] = (tally[mark] || 0) + 1;
  }
  if (left.size) console.log(`  ${file}: ${left.size} id(s) not found as rows: ${[...left].slice(0, 6).join(" ")}`);
  if (!dry) writeFileSync(path, lines.join("\n"));
  console.log(`${file}: ${ids.size - left.size} row(s) written back`);
}
console.log(`TOTAL ${total} rows · ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(" · ")}${dry ? " (dry run — nothing written)" : ""}`);
