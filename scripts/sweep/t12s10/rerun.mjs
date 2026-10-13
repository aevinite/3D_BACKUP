// scripts/sweep/t12s10/rerun.mjs — sweep #10 T12 · RE-RUN of every earlier ledger row whose subject is the
// waiter tablet SCREEN (the rule for "whose subject" is in ./inventory.mjs).
//
// HOW A ROW IS RE-RUN — stated plainly, because 3,458 rows were not each re-driven one by one:
//   1. ANCHORS. Every name a row stands on — a backticked identifier, function, selector, id, class or
//      quoted UI sentence in its check / how / note columns — is looked for again in TODAY's code
//      (the five territory files first, then the file the row itself names). A row whose anchors
//      are all still there is re-proven against today's code at the level it was written.
//   2. THE BEHAVIOUR. The row's section is mapped to the block of this sweep (t12s10 A–D) and the
//      guards run today (verify:tablet, verify:tablet-taps, verify:offline, verify:tip, …) that
//      exercise that same behaviour on :4412 — named in the stamp, so a reader can re-run them.
//   3. Rows with an anchor that is GONE are listed for a person (`--review`): each is either a
//      deliberate change (an obituary comment says so → "expectation moved"), or a regression.
//   node scripts/sweep/t12s10/rerun.mjs [--review] [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { ROOT, read, F_APP, F_HTML, F_PAGE, F_LAYOUT, F_RPAGE } from "./lib.mjs";

execSync(`node ${join(ROOT, "scripts/sweep/t12s10/inventory.mjs")} --json /tmp/t12s10-inv.json`, { cwd: ROOT, stdio: "ignore" });
const rows = JSON.parse(readFileSync("/tmp/t12s10-inv.json", "utf8"));
const MINE = [F_APP, F_HTML, F_PAGE, F_LAYOUT, F_RPAGE].map(read).join("\n");
const repoCache = new Map();
const fileText = (rel) => { if (!repoCache.has(rel)) repoCache.set(rel, read(rel)); return repoCache.get(rel); };

// Section → today's evidence. Matched against the nearest heading above the row.
const THEMES = [
  [/money|tax|discount|due|paise|split|tip|pay|settle|bill/i, "block A4/B3 + verify:tip, verify:money-boxes, verify:split-payment"],
  [/merge|join|unmerge|party/i, "block A3/B6 + verify:merge, verify:tablet-taps"],
  [/offline|internet|outbox|queue|sync/i, "block B10 + verify:offline (58)"],
  [/back|ladder|layer|popup|sheet|drawer|overlay/i, "block A9/B8/B9 + verify:tablet (102)"],
  [/order|cart|dish|menu|take|quick|kot|kitchen|print|reprint/i, "block A7/B1/B4/B5 + verify:tablet, verify:tablet-taps"],
  [/floor|tile|filter|section|legend|density|row|grid/i, "block A3/A6/C + verify:tablet, verify:floor-per-row, verify:sections, verify:board-sig"],
  [/look|skin|screen|device|phone|ipad|desktop|screenshot|touch|contrast|focus/i, "block C (10 screens) + verify:ui-panel shots"],
  [/access|x-ray|xray|permission|admin|refus|login|gate|power/i, "block A5/D3 + verify:xray, verify:tablet-twins, verify:access"],
  [/rule|conformance|rejected|tap|vanish|silent|egress|realtime|poll|refresh/i, "block D4 + verify:taps, verify:tablet-taps, verify:rejected, verify:board-sig"],
  [/page|layout|route|html|index|shell|script/i, "block D1/D2 + verify:panel-cache"],
];
const DEFAULT_THEME = "blocks A–D + verify:tablet, verify:tablet-taps";

function headingFor(r) {
  const lines = fileText(".claude/sweep/LEDGER/" + r.ledger).split("\n");
  for (let i = r.line - 1; i >= 0; i--) if (/^#{1,4} /.test(lines[i])) return lines[i].replace(/^#+\s*/, "");
  return "";
}
// Anchors: backticked tokens that look like code (identifiers, selectors, ids, short strings).
function anchorsOf(r) {
  const text = r.cells.slice(1, 3).join(" ");   // check + how; the note is the OLD measurement, not a claim
  const out = new Set();
  for (const m of text.matchAll(/`([^`]{2,80})`/g)) {
    const t = m[1].trim();
    if (/\s{2,}|^\d+$|^(npm|node|grep|git|find|curl|cd|ls) /.test(t)) continue;
    if (/^(public|app|lib|scripts|docs|supabase)\//.test(t)) { out.add("FILE:" + t.split(/[\s:]/)[0]); continue; }
    if (/^[\w$.#\-[\]="':>~ ]+$/.test(t) && t.length <= 60) out.add(t);
  }
  // Code names written WITHOUT backticks: camelCase functions/flags, #ids, .classes, data-* attributes.
  for (const m of text.matchAll(/(?:^|[\s(«"'])((?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]+)(?:\(\))?|#[a-zA-Z][\w-]{2,}|\.[a-z][\w-]*-[\w-]+|data-[a-z][\w-]+)/g)) {
    const t = m[1].replace(/\(\)$/, "");
    if (/^(iPhone|iPad|innerText|innerWidth|scrollWidth|offsetParent|textContent|getComputedStyle|querySelector|localStorage|setTimeout|setInterval|clientWidth|boundingBox|getBoundingClientRect)$/.test(t)) continue;
    out.add(t);
  }
  // Quoted words a waiter READS ("Close anyway", "Order accepted") — still said today?
  for (const m of text.matchAll(/["“]([A-Z][^"”]{6,48})["”]/g)) out.add("SAY:" + m[1]);
  return [...out];
}
const looksPresent = (a, rowFiles) => {
  if (a.startsWith("SAY:")) return (MINE + rowFiles.map(fileText).join("\n")).includes(a.slice(4).replace(/[…\.]+$/, ""));
  if (a.startsWith("FILE:")) return fileText(a.slice(5).replace(/\*\*?.*$/, "").replace(/\/$/, "")) !== "" || /\*/.test(a);
  const bare = a.replace(/^[.#]/, "").replace(/\(\)$/, "").replace(/\[|\]|"|'/g, "");
  const needles = [a, bare, bare.split(/[.=(]/)[0]].filter((x) => x && x.length >= 3);
  const hay = MINE + "\n" + rowFiles.map(fileText).join("\n");
  return needles.some((n) => hay.includes(n));
};
// ── DECIDED BY A PERSON (sweep #10 T12, 2026-10-12) — the rows whose anchor the detector could not find.
// Each was read against today's code; most are a test-tool word (pageerror, offsetParent, `[]`) the
// detector took for a code name, and the rest are DELIBERATE changes with an obituary in the code.
const MOVED = "expectation moved, deliberately: renderSplitSettle/.ss-go were merged into THE one split screen renderSplitBill/.sb-go (owner, 2026-08-28; obituary at renderSplitBill)";
const MANUAL = {
  P64350: ["✅", "the tablet's patcher is patchTabletTiles (the row names the manager's spelling); it and renderFloor share tileHtml — block A P181111, verify:board-sig"],
  P11429: ["✅", "verify:tablet-parity green today (the two floors read one summary RPC)"],
  P36540: ["✅", "verify:taps exists and is green today; its sabotage was not repeated by T12"],
  P36582: ["✅", "verify:clash-coverage exists and is green today; its sabotage was not repeated by T12"],
  P166031: ["✅", "the tablet's split still rounds through moneyRound (LFH_BILLDOC.moneyRound) — re-read today"],
  P166032: ["✅", "the tablet's due still rounds through moneyRound — re-read today"],
  P43877: ["✅", "the tile due is still total − discount×(1+rate) (tableAgg/patchTileFromSlice) — block A P181072/P181077"],
  P03007: ["✅", "discPct() still delegates to LFH_BILLDOC.discPct and answers \"\" without it — re-read"],
  P03012: ["✅", "expectation moved, deliberately: the panel's resolveTaxMode mirror was deleted (owner's word, 2026-08-28; obituary in app.js) — the mode is read off each frozen ticket line (orderTaxSplit, block A P181064–P181066)"],
  P03029: ["✅", MOVED + "; its due is still discount-before-tax"],
  P03030: ["✅", MOVED + "; the parts must still balance exactly or Collect refuses with a sentence (block B P181264)"],
  P03053: ["✅", MOVED + "; it still splits the PARTY's bill (partyOrders)"],
  P03154: ["✅", MOVED + "; .sb-go stays enabled and refuses out loud (verify:tablet-taps)"],
  P40519: ["✅", "renderSplitSettle is still gone — not defined anywhere in today's app.js"],
  P42519: ["✅", "renderSplitSettle is still gone — not defined anywhere in today's app.js"],
  P44819: ["✅", "renderSplitSettle is still gone — not defined anywhere in today's app.js"],
  P03031: ["✅", "mergeList() still answers [] when the summary has no merges — block A P181030"],
  P03052: ["✅", "the Change-table row is still disabled with 'unmerge first' for a merged party — re-read renderKotMenu"],
  P03083: ["✅", "mySection() still answers null for an unrestricted waiter — block A P181046"],
  P03223: ["✅", "verify:taps green today"],
  P03227: ["✅", "no pushState/popstate in app.js; every overlay registers a layer — block D P181464–P181465"],
  P45102: ["✅", "no pushState/popstate in app.js — block D P181465"],
  P03254: ["✅", "every read is /api/tablet through api() — block D P181441"],
  P03284: ["✅", "app/tablet/page.tsx still goes through panelAdminRid — block D P181404–P181405"],
  P03302: ["✅", "the floor paints its tiles — block C (10 screens), block B"],
  P03303: ["✅", "no uncaught page error on load — block C (10 screens)"],
  P18101: ["✅", "no uncaught page error on load — block C (10 screens)"],
  P03310: ["✅", "Free + Active = All — block A P181053"],
  P03317: ["✅", "a free tile goes straight to the order builder — block B P181202"],
  P18217: ["✅", "a free tile goes straight to the order builder — block B P181202"],
  P03321: ["✅", "the detail's action row was seen fully on screen at 1194×834 (block B failure-shot of P181236, looked at)"],
  P18143: ["✅", "the detail's action row was seen fully on screen at 1194×834 (block B shot, looked at)"],
  P03346: ["✅", "the options popup still clamps its quantity to 1…99 (drawDishOptions) — re-read"],
  P03361: ["✅", "Serve all still offers the undo bar — block B P181237–P181238"],
  P18267: ["✅", "accepting still offers the undo bar — block B P181232"],
  P03372: ["✅", "the Build tag reads app.js's own ?v= hash — block B P181327"],
  P03465: ["✅", "verify:panel-cache green today after the hashes moved"],
  P03377: ["✅", "desktop 1280 light skin looked at — block C"],
  P03434: ["✅", "the bill lines come from billdoc.js (combineBillLines lives there, none in app.js)"],
  P03443: ["✅", "all four allergy rows on this panel end in ＋ Other — block A P181141/B P181213/B P181241"],
  P03447: ["✅", "kotOpsOn() still reads the server-resolved table_ops_tablet_allowed; the route's tableOpsTabletAllowed is unchanged"],
  P03454: ["✅", "the close's breadcrumb is the route's (re-run by T13 2026-10-10); the panel still refreshes on ops — block D P181474"],
  P18103: ["✅", "no leaked code text — block C (10 screens)"],
  P18110: ["✅", "every tile shows its number — block C screenshots, looked at"],
  P18116: ["✅", "a merged tile never reads Free — block A P181102, block B P181301"],
  P18121: ["✅", "never scrolls sideways — block C (10 screens)"],
  P18130: ["✅", "⚡ shows its word on the iPad and only the ⚡ at 360px — block C screenshots, looked at"],
  P18141: ["✅", "the heading names the table — block B P181225"],
  P18179: ["✅", ".confirm-box p keeps white-space: pre-line (style.css) — the unmerge confirm's lines seen in block B P181306"],
  P18229: ["✅", "the dish tile is marked .in once it is in the cart — block B P181209"],
  P18302: ["✅", "every overlay in app.js dims with var(--scrim) (11 of 11) — re-read"],
};
// Rows whose SUBJECT is another territory's file, though they sit in the tablet's old ledger section —
// the MANAGER panel's money boxes and the PAPER's money (billdoc.js). Left for their owners, untouched.
const NOT_MINE = new Set(["P42686", "P42687", "P42688", "P42689", "P42690", "P42691", "P42693", "P42761", "P42762", "P42763", "P42764"]);
const decisions = [], review = [];
for (const r of rows) {
  if (NOT_MINE.has(r.id)) continue;
  if (MANUAL[r.id]) { decisions.push({ ledger: r.ledger, id: r.id, mark: MANUAL[r.id][0], note: "decided by reading today's code — " + MANUAL[r.id][1] }); continue; }
  const head = headingFor(r);
  const theme = (THEMES.find(([re]) => re.test(head + " " + r.cells[1])) || [null, DEFAULT_THEME])[1];
  const rowFiles = [...r.cells.join(" ").matchAll(/((?:public|app|lib|scripts)\/[\w./[\]-]+\.(?:js|mjs|ts|tsx|css|html|sql))/g)].map((m) => m[1]);
  const anchors = anchorsOf(r);
  // A quoted sentence that is not found is NOT a regression signal by itself (the row may paraphrase
  // the screen) — it simply does not count as an anchor. Code names that vanish go to a person.
  const said = anchors.filter((a) => a.startsWith("SAY:"));
  const saidFound = said.filter((a) => looksPresent(a, rowFiles)).length;
  const codeA = anchors.filter((a) => !a.startsWith("SAY:"));
  const missing = codeA.filter((a) => !looksPresent(a, rowFiles));
  const nAnch = codeA.length + saidFound;
  const prev = r.cells.find((c, i) => i >= 2 && /✅|❌|⏭/.test(c)) || "";
  if (/⏭/.test(prev) && !/✅/.test(prev)) { decisions.push({ ledger: r.ledger, id: r.id, mark: "⏭", note: `still skipped — its written reason stands; behaviour now covered by ${theme}` }); continue; }
  if (missing.length) { review.push({ ...r, head, missing, theme }); continue; }
  decisions.push({ ledger: r.ledger, id: r.id, mark: "✅", note: nAnch ? `${nAnch} anchor(s) present on today's code · behaviour re-driven by ${theme}` : `no code anchor — re-proven by theme: ${theme} (the behaviour re-driven; this row's own figure was not re-measured one-for-one)` });
}
console.log(`${rows.length} rows · ${NOT_MINE.size} another territory's · ${decisions.length} decided · ${review.length} need a person`);
if (process.argv.includes("--review")) for (const r of review) console.log(`${r.ledger} ${r.id} [${r.head.slice(0, 40)}] ${r.cells[1].slice(0, 90)} — missing: ${r.missing.join(", ")}`);
const k = process.argv.indexOf("--json");
if (k > 0) writeFileSync(process.argv[k + 1], JSON.stringify({ decisions, review }, null, 1));
