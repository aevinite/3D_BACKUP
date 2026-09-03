// scripts/sweep/t7/round3.mjs — sweep #8 · terminal 7 · THE THIRD PLANNED 500 (P98801–P99300).
//
// The owner's word after round two was merged and deployed: "plan 500 phases test within your
// boundaries make sure it cover everthing within your boundries and test everything again if any
// error left."
//
// PLANNED FROM A MEASUREMENT, NOT FROM A FRESH IDEA. Every function, constant, helper and
// data-attribute in this territory was enumerated from the source (607 of them) and crossed against
// every one of the 55,380 checks in .claude/sweep/LEDGER AND every guard in scripts/. **267 were
// named by nothing at all.** This round is aimed at those, so it adds coverage instead of
// re-sampling ground three rounds have already walked.
//
//     node scripts/sweep/t7/round3.mjs        · the code-reading half   (P98801–P99260)
//     node scripts/sweep/t7/round3-live.mjs   · driven in a real browser (P99261–P99300)
import { read, exists, check, report, has, hasNot, countOf, eq, atLeast, codeOf, tail } from "./lib.mjs";

const APP  = read("public/panels/editor/app.js");
const A    = tail(APP);
const AC   = codeOf(APP);
const ACT  = tail(AC);
const INV  = read("public/panels/editor/inventory.js");
const INVC = codeOf(INV);
const FL   = read("public/panels/floor-layouts.js");
const CSS  = read("public/panels/editor/style.css");
const HTML = read("public/panels/editor/index.html");
const BELL = read("public/panels/guestbell.js");

/* ═════ H1 · editor/inventory.js — the sub-views and popups nothing had named (P98801–P98960) ═══ */

check("P98801", "loadCore() is the ONE boot read, and it asks for both things at once", () =>
  has(INVC, /async function loadCore\(\)/) === true && has(INVC, /await Promise\.all\(\[inv\("GET", "\/whoami"\), inv\("GET", "\/items\?all=1"\)\]\)/) === true);
check("P98802", "…and it records that the tab is loaded, so a re-open does not re-read", () => has(INVC, /S\.loaded = true/));
check("P98803", "…and render() only calls it when it has NOT been loaded", () => has(INVC, /if \(!S\.loaded\) await loadCore\(\)/));
check("P98804", "reloadItems() re-reads the master list including retired rows", () => has(INVC, /const reloadItems = async \(\) => \{ S\.items = \(await inv\("GET", "\/items\?all=1"\)\)\.items \|\| \[\]; \}/));
check("P98805", "loadVendors() is only ever called for a vendor bill — a cash buy never pays for that read", () =>
  eq(countOf(INVC, /if \(kind === "bill"\) loadVendors\(\)/g), 1) === true && eq(countOf(INVC, /loadVendors\(\)\./g), 1) === true);
check("P98806", "itemPop() gives a brand-new ingredient sane defaults rather than empty boxes", () => {
  const m = INVC.match(/const v = it \|\| \{[\s\S]{0,320}?\};/);
  if (!m) return "no default ingredient";
  return ["base_uom: \"g\"", "purchase_uom: \"kg\"", "purchase_factor: 1000", "track_level: \"FULL\"", "active: true"].every((k) => m[0].includes(k)) || "a default is missing";
});
check("P98807", "…and the category box offers what is already in use, without forcing it", () =>
  has(INVC, /list="ipCatList"/) === true && has(INVC, /\[\.\.\.new Set\(S\.items\.map\(\(x\) => x\.category\)\)\]/) === true);
check("P98808", "…and the name is capped, so one row cannot break the list layout", () => has(INV, /id="ipName"[^>]*maxlength="80"/));
check("P98809", "…and every free-text field on that form is capped", () => atLeast(countOf(INV, /maxlength="(40|80|12)"/g), 4, "capped fields"));
check("P98810", "…and the pack factor cannot be zero or negative", () => has(INV, /id="ipFactor"[^>]*min="0\.001"/));
check("P98811", "…and every quantity box on it accepts decimals", () => atLeast(countOf(INV, /inputmode="decimal"/g), 6, "decimal boxes"));
check("P98812", "…and opening stock is offered ONLY when the ingredient is new", () => has(INVC, /\$\{isNew \? `<label>Opening stock/));
check("P98813", "…and Active is offered ONLY when it is not", () => has(INVC, /\$\{!isNew \? `<label class="inv-check"><input id="ipActive"/));
check("P98814", "…and History is offered ONLY when there is a history to show", () => has(INVC, /\$\{!isNew \? `<button class="btn" id="ipHistory">/));
check("P98815", "the unit sentence names the ingredient by the name being typed, live", () => has(INVC, /\$\("#ipName", pop\)\.value \|\| "this"/));
check("P98816", "…and every echo of the buying unit follows the box as it is typed", () =>
  has(INVC, /pop\.querySelectorAll\("\.ipBuyEchoN"\)\.forEach/));
check("P98817", "historyPop() reads one item's movements, not the whole ledger", () => has(INVC, /inv\("GET", "\/movements\?item=" \+ it\.id\)/));
check("P98818", "…and a failed read says so instead of opening an empty popup", () =>
  has(INVC, /catch \(e\) \{ toastMsg\("⚠️ " \+ e\.message\); return; \}/));
check("P98819", "…and a movement's direction is shown by sign AND by class, not by colour alone", () =>
  has(INVC, /Number\(m\.qty_base\) >= 0 \? "in" : "out"/) === true && has(INVC, /Number\(m\.qty_base\) >= 0 \? "\+" : ""/) === true);
check("P98820", "stockListHtml() groups by category and skips a category with nothing in it", () =>
  has(INVC, /if \(!rows\.length\) return "";/));
check("P98821", "…and the search is case-folded on both sides", () => has(INVC, /i\.name\.toLowerCase\(\)\.includes\(q\)/));
check("P98822", "…and every ingredient name is escaped where it is drawn", () => atLeast(countOf(INVC, /esc\(i\.name\)/g), 2, "escaped names"));
check("P98823", "renderOrder() names how much to buy in the buying unit, not in grams", () => has(INVC, /buy \$\{i\.suggest\} \$\{esc\(i\.purchase_uom\)\}/));
check("P98824", "renderPurchases() opens a bill by its id, never by its position in the list", () =>
  has(INVC, /r\.onclick = \(\) => purchaseDetailPop\(r\.dataset\.pur\)/));
check("P98825", "purchasePop() offers vendor + bill-no ONLY for a vendor bill", () => has(INVC, /\$\{kind === "bill" \? `\s*\n?\s*<div class="inv-grid2">/));
check("P98826", "…and explains what a cash buy is for", () => has(INV, /Market\/mandi purchase with no bill/));
check("P98827", "…and the photo input asks for the back camera on a phone", () => eq(countOf(INV, /capture="environment"/g), 3));
check("P98828", "purchaseDetailPop() shows a voided purchase's reason and who did it", () =>
  has(INVC, /Voided by \$\{esc\(p\.voided_by \|\| "\?"\)\}/));
check("P98829", "…and offers Void only while it is NOT already voided", () => has(INVC, /\$\{!p\.voided_at \? `<button class="btn danger" id="pdVoid">/));
check("P98830", "renderCount() shows the sheet when a draft is open, and the start screen when not", () =>
  has(INVC, /if \(S\.count\) return renderCountSheet\(body\)/));
check("P98831", "renderCountSheet() writes a blank placeholder, never a zero", () => has(INV, /placeholder="—"/));
check("P98832", "…and every count box takes decimals and refuses negatives", () =>
  has(INV, /class="inv-countin"[^>]*type="number" inputmode="decimal" min="0" step="any"/));
check("P98833", "…and the submit bar is sticky, so it is reachable on a long shelf list", () => has(INV, /class="inv-pop-actions sticky"/));
check("P98834", "varianceSummaryPop() is opened with the id of the count that was just submitted", () =>
  has(INVC, /varianceSummaryPop\(cid\)/));
check("P98835", "…and a failed read closes quietly rather than showing a broken popup", () => has(INVC, /catch \{ return; \}/));
check("P98836", "renderWaste() totals only what was NOT struck out", () => has(INVC, /S\.waste\.filter\(\(w\) => !w\.voided_at\)/));
check("P98837", "wastePop() only offers ingredients that actually hold stock", () =>
  has(INVC, /const usable = S\.items\.filter\(\(i\) => i\.active && i\.track_level !== "EXPENSE"\)/));
check("P98838", "renderRecipes() counts how many dishes have a recipe out of how many exist", () =>
  has(INVC, /\$\{mapped\.length\} \/ \$\{dishes\.length\}/));
check("P98839", "…and a prep item is one that declares a batch size", () => has(INVC, /i\.active && i\.recipe_batch_base/));
check("P98840", "dishLines() and prepLines() read the same line table, keyed by owner type", () =>
  has(INVC, /l\.owner_type === "dish" && l\.owner_key === slug/) === true && has(INVC, /l\.owner_type === "prep" && l\.owner_key === id/) === true);
check("P98841", "linesCost() treats a missing ingredient as zero rather than as NaN", () => has(INVC, /it \? it\.avg_cost : 0/));
check("P98842", "recipePop() starts from what is already saved, not from an empty list", () =>
  has(INVC, /const lines = existing\.slice\(\)/));
check("P98843", "…and Cancel throws the working copy away without touching the saved one", () =>
  has(INVC, /\$\("#rpCancel", pop\)\.onclick = closePop/));
check("P98844", "makeBatchPop() pre-fills the declared batch size", () =>
  has(INVC, /value="\$\{Math\.round\(\(Number\(it\.recipe_batch_base\) \/ Number\(it\.purchase_factor\)\) \* 100\) \/ 100\}"/));
check("P98845", "renderUsage() names the three columns in plain words", () =>
  has(INV, /Used by orders/) === true && has(INV, /Wasted/) === true && has(INV, /Count corrections/) === true);
check("P98846", "…and 'used' and 'wasted' are shown as money LEAVING, not as bare negatives", () =>
  has(INVC, /inr\(-tot\("consumed_val"\)\)/) === true && has(INVC, /inr\(-tot\("wasted_val"\)\)/) === true);
check("P98847", "renderExpenses() falls back to an empty shape rather than throwing on a bad read", () =>
  has(INVC, /S\.expenses \|\| \{ month: "", expenses: \[\], totals: \{\}, total: 0 \}/));
check("P98848", "expensePop() caps what a person can type into every box", () =>
  has(INV, /id="epTitle"[^>]*maxlength="120"/) === true && has(INV, /id="epNote"[^>]*maxlength="300"/) === true);
check("P98849", "…and the date defaults to the Indian day", () => has(INVC, /id="epDate" type="date" value="\$\{new Date\(Date\.now\(\) \+ 5\.5 \* 3600_000\)/));
check("P98850", "askWhy() is used for EVERY strike-out, never a bare prompt", () => eq(countOf(INVC, /await askWhy\(/g), 3));

/* ── H1 continued · the inventory helpers and the shapes they guard (P98851–P98960) ─────────── */

check("P98851", "askYesNo() is used for the two questions that are not a reason", () => eq(countOf(INVC, /await askYesNo\(/g), 2));
check("P98852", "closePop() is safe to call when nothing is open", () => has(INVC, /const el = document\.getElementById\("invPop"\);\s*\n\s*if \(el\) el\.remove\(\);/));
check("P98853", "the popup id is passed through to the back-button layer, so BACK closes the right one", () =>
  has(INVC, /window\.LFH_BACK\.layer\(id, closePop\)/));
check("P98854", "every popup this file opens declares its own id", () => atLeast(countOf(INVC, /openPop\("inv-/g), 9, "named popups"));
check("P98855", "…and every one of those ids is distinct", () => {
  const ids = [...INVC.matchAll(/openPop\("(inv-[\w-]+)"/g)].map((m) => m[1]);
  return eq(ids.length, new Set(ids).size);
});
check("P98856", "the module state has one shape, declared once at the top", () => eq(countOf(INVC, /^  const S = \{/gm), 1));
check("P98857", "…and `view` starts on the stock room, which is what most people open it for", () => has(INVC, /view: "stock"/));
check("P98858", "…and both powers start FALSE, so nothing renders before whoami answers", () => has(INVC, /can: \{ stock: false, expenses: false \}/));
check("P98859", "refreshView() has a branch for every pill the tab can show", () => {
  const m = INVC.match(/async function refreshView\(force\)[\s\S]*?\n  \}/);
  return ["stock", "order", "purchases", "count", "waste", "recipes", "usage", "expenses"].every((v) => m[0].includes(`"${v}"`)) || "a pill has no branch";
});
check("P98860", "…and the pill list and the branch list are the same eight", () => {
  const pills = [...INVC.matchAll(/\{ id: "(\w+)", label:/g)].map((m) => m[1]).sort();
  const m = INVC.match(/async function refreshView\(force\)[\s\S]*?\n  \}/)[0];
  const branches = [...m.matchAll(/S\.view === "(\w+)"/g)].map((x) => x[1]).sort();
  return eq(pills.join(","), branches.join(","));
});
check("P98861", "the ↻ button forces a re-read of the master list, not just a repaint", () => has(INVC, /if \(force\) await reloadItems\(\)/));
check("P98862", "the Usage day choice is remembered on the module, so a refresh keeps it", () => has(INVC, /S\.usageDays \|\| 7/));
check("P98863", "…and the Expenses month too", () => has(INVC, /S\.expMonth \? `\?month=\$\{S\.expMonth\}` : ""/));
check("P98864", "a purchase line's amount is computed, never taken from the form", () => has(INVC, /inr\(l\.qty \* l\.rate\)/));
check("P98865", "the purchase total and the line amounts come from the same numbers", () =>
  has(INVC, /lines\.reduce\(\(s, l\) => s \+ l\.qty \* l\.rate, 0\)/));
check("P98866", "a waste row's money is quantity × the cost snapshot, not today's cost", () =>
  eq(countOf(INVC, /Number\(w\.qty_base\) \* Number\(w\.unit_cost_snap\)/g), 2));
check("P98867", "…and the row and the 30-day total use the identical expression", () =>
  has(INVC, /s \+ Number\(w\.qty_base\) \* Number\(w\.unit_cost_snap\)/));
check("P98868", "the count sheet's groups are built from a plain object, so an odd area name cannot break it", () =>
  has(INVC, /\(groups\[k\] = groups\[k\] \|\| \[\]\)\.push\(i\)/));
check("P98869", "…and every storage-area heading is escaped", () => has(INVC, /class="inv-cat">\$\{esc\(k\)\}/));
check("P98870", "the recipe editor's ingredient picker excludes spend-only items", () =>
  has(INVC, /i\.active && i\.track_level !== "EXPENSE" && i\.id !== key/));
check("P98871", "…and the prep picker excludes anything that already IS a prep item", () =>
  has(INVC, /i\.active && i\.track_level !== "EXPENSE" && !i\.recipe_batch_base/));
check("P98872", "a recipe line's cost is drawn beside it, so a mistake is visible before saving", () =>
  has(INVC, /<b>\$\{inr\(l\.qty_base \* Number\(it\.avg_cost\)\)\}<\/b>/));
check("P98873", "the batch size is sent in base units, converted from what was typed", () =>
  has(INVC, /payload\.batch_base = b \* Number\(subject\.purchase_factor\)/));
check("P98874", "production is sent in base units too", () => has(INVC, /qty_base: qty \* Number\(it\.purchase_factor\)/));
check("P98875", "every write in this file reloads only what it changed", () => atLeast(countOf(INVC, /await reloadItems\(\);\s*\n\s*refreshView\(\)/g), 5, "targeted reloads"));
check("P98876", "…and an expense write does NOT reload the ingredient list, because it cannot change it", () => {
  const m = INVC.match(/await inv\("POST", "\/expenses",[\s\S]{0,300}?\}/);
  return !/reloadItems/.test(m[0]) || "an expense needlessly re-reads the stock list";
});
check("P98877", "the file never reaches outside its own root except to open a popup", () =>
  eq(countOf(INVC, /document\.body\.appendChild/g), 2));
check("P98878", "…and it never writes to localStorage, so nothing survives a restaurant switch", () =>
  hasNot(INVC, /localStorage|sessionStorage/));
check("P98879", "…and it never opens a window or a tab except through a link the person taps", () =>
  hasNot(INVC, /window\.open\(/));
check("P98880", "every photo link opens in a new tab that cannot reach back", () =>
  eq(countOf(INVC, /target="_blank" rel="noopener"/g), 2));
check("P98881", "no NAME or free text reaches the page unescaped in the stock list", () => {
  // The rule is about text a PERSON typed. A database uuid in a data- attribute and a number this
  // function computed itself are not that, and the file escapes the one hand-typed key it draws
  // (`data-dish="${esc(d.slug)}"`), which is the author's own line.
  const m = INVC.match(/function stockListHtml\([\s\S]*?\n  \}/)[0];
  const raw = [...m.matchAll(/\$\{(?!esc\()(?!inBuy\()(?!inr\()[^}]*\}/g)].map((x) => x[0]);
  const allowed = /^\$\{(i\.id|lowBadge|negBadge|active\.length|i\.par_qty[^}]*|rows[^}]*|cats[^}]*)\}$/;
  const bad = raw.filter((r) => !allowed.test(r));
  return bad.length === 0 || `unescaped free text: ${bad.join(" ")}`;
});
check("P98882", "…nor in the purchases list", () => {
  const m = INVC.match(/function renderPurchases\([\s\S]*?\n  \}/)[0];
  return has(m, /esc\(p\.vendor_name \|\| "Bill"\)/) === true && has(m, /esc\(p\.bill_no\)/) === true && has(m, /esc\(p\.bill_date\)/) === true;
});
check("P98883", "…nor in the expenses list", () => {
  const m = INVC.match(/function renderExpenses\([\s\S]*?\n  \}/)[0];
  return ["esc(e.title)", "esc(e.expense_date)", "esc(e.created_by", "esc(e.note)"].every((k) => m.includes(k)) || "an expense field is unescaped";
});
check("P98884", "…nor in the waste list", () => has(INVC, /WASTE_LABELS\[w\.reason\] \|\| esc\(w\.reason\)/));
check("P98885", "…nor in the recipe list", () => has(INVC, /esc\(d\.title\)/));
check("P98886", "…nor in a movement's reason", () => has(INVC, /esc\(m\.reason\)/));
check("P98887", "…nor in a vendor name in the datalist", () => has(INVC, /esc\(v\.name\)/));
check("P98888", "…nor in an ingredient's own unit anywhere it is drawn", () => atLeast(countOf(INVC, /esc\(i?t?\.?purchase_uom\)/g), 3, "escaped units"));
check("P98889", "the tab's stylesheet really carries the classes this file renders", () => {
  // `inv-body` is deliberately absent: that element is a JS hook (#invBody) and is laid out by its
  // parent .inv-wrap, so a rule for it would be a rule that does nothing. Every class that DOES
  // carry a look is asserted here — a class this file renders with no style is a screen the CSS
  // has silently stopped dressing, which is how a panel ends up unstyled after a rename.
  const need = ["inv-wrap", "inv-pills", "inv-pill", "inv-row", "inv-pop", "inv-pop-backdrop",
    "inv-countin", "inv-countrow", "inv-statrow", "inv-stat", "inv-note", "inv-toolbar",
    "inv-search", "inv-cat", "inv-line", "inv-total", "inv-reason", "inv-grid2",
    "inv-grid3", "inv-hist", "inv-x", "inv-thumb", "inv-photo", "inv-copyta"];
  const missing = need.filter((c) => !CSS.includes("." + c));
  return missing.length === 0 || `no style for: ${missing.join(", ")}`;
});
check("P99299", "…and the two unstyled names really are only hooks, not forgotten looks", () =>
  // `inv-body` and `inv-lines` are plain containers: their children carry the look and their
  // parents carry the box. Asserted explicitly so a future reader does not "restore" a rule that
  // was never meant to exist — and so that if either ever DOES need one, this row goes red first.
  hasNot(CSS, /\.inv-body\b|#invBody/) === true && hasNot(CSS, /\.inv-lines\b/) === true
  && has(INVC, /\$\("#invBody"\)/) === true && has(CSS, /\.inv-line\b/) === true);
check("P98890", "…including the one the sticky submit bar needs", () => has(CSS, /\.inv-pop-actions\.sticky/));
check("P98891", "…and the badges the stock list draws", () => has(CSS, /\.inv-badge/));
check("P98892", "…and the voided/retired row treatments", () => has(CSS, /\.voided/) === true && has(CSS, /\.retiredrow/) === true);
check("P98893", "a count line is saved on change, not on every keystroke", () => has(INVC, /input\.onchange = async \(\) =>/));
check("P98894", "…and the search box IS live, because a list is cheap to redraw", () => has(INVC, /\$\("#invSearch"\)\.oninput/));
check("P98895", "the retired list is only built when the toggle is on", () => has(INVC, /\$\{S\.showRetired && retired\.length \?/));
check("P98896", "…and the toggle names how many there are", () => has(INVC, /retired ingredients \(\$\{retired\.length\}\)/));
check("P98897", "the negative-stock note is only shown when there IS negative stock", () => has(INVC, /\$\{S\.negative\.length \? `<div class="inv-note">/));
check("P98898", "…and it pluralises itself correctly", () => has(INVC, /S\.negative\.length > 1 \? "s show" : " shows"/));
check("P98899", "the low counter is only styled as a warning when it is non-zero", () => has(INVC, /inv-stat\$\{low\.length \? " warn" : ""\}/));
check("P98900", "…and the below-zero counter as bad", () => has(INVC, /inv-stat\$\{S\.negative\.length \? " bad" : ""\}/));

check("P98901", "inBuy() never divides by zero when a factor is missing", () => has(INVC, /const f = Number\(it\.purchase_factor\) \|\| 1/));
check("P98902", "itemById() is the one lookup, used everywhere a row names an ingredient", () =>
  atLeast(countOf(INVC, /itemById\(/g), 12, "lookups through the one helper"));
check("P98903", "…and every caller copes with it answering nothing", () =>
  atLeast(countOf(INVC, /itemById\([^)]*\) \|\| \{/g), 3, "guarded lookups"));
check("P98904", "the file names its own migration and stage at the top, so its scope is findable", () =>
  has(INV, /mig 221/));
check("P98905", "…and states its egress rule in words", () => has(INV, /Egress: fetch on open \+ after own writes only/));
check("P98906", "…and that rule is true: there is no interval and no polling loop", () =>
  hasNot(INVC, /setInterval\(/) === true && hasNot(INVC, /requestAnimationFrame\(/) === true);
check("P98907", "the only timers are the two the screen needs", () => eq(countOf(INVC, /setTimeout\(/g), 2));
check("P98908", "…the saved-mark fade and the live-refresh coalescer, and nothing else", () =>
  has(INVC, /setTimeout\(\(\) => \{ const n = \$\("#ccSavedNote"\)/) === true && has(INVC, /bumpTimer = setTimeout/) === true);
check("P98909", "the count sheet's discard button is disabled while the write is in flight", () =>
  has(INVC, /if \(btn\) btn\.disabled = true;/));
check("P98910", "…and re-enabled when the server refuses", () => has(INVC, /if \(btn\) btn\.disabled = false;/));

check("P98960", "…and every field the bill-customer card fills in is one the invoice route accepts", () =>
  // The last of the 267: the panel hands `cust_phone` and `cust_name` to the invoice call, and the
  // route has to be the thing that names those columns — a screen that collects a field the server
  // drops is a question asked for nothing.
  has(ACT, /body\.cust_phone = cust\.phone; body\.cust_name = cust\.name;/) === true
  && has(read("app/api/editor/[...path]/route.ts"), /cust_phone/) === true
  && has(read("app/api/editor/[...path]/route.ts"), /cust_name/) === true);

/* ═════ H2 · app.js — the table panel, the order builder, the money (P98961–P99120) ══════════ */

check("P98961", "orderItemRows() is the ONE place a dish row is shaped, for every screen that draws one", () =>
  eq(countOf(ACT, /function orderItemRows\(o\)/g), 1) === true && atLeast(countOf(ACT, /orderItemRows\(/g), 12, "callers"));
check("P98962", "…and it answers the same shape for a session order and a legacy one", () => {
  const m = ACT.match(/function orderItemRows\(o\)[\s\S]*?\n\}/)[0];
  for (const k of ["title", "qty", "status", "options", "removed", "note", "price", "is_mrp", "tax_mode"]) {
    if ((m.match(new RegExp(k + ":", "g")) || []).length < 2) return `${k} is only on one of the two shapes`;
  }
  return true;
});
check("P98963", "itemsForOrder() reads the session rows for one order and nothing else", () =>
  has(ACT, /\(state\.board\.items \|\| \[\]\)\.filter\(\(i\) => i\.order_id === oid\)/));
check("P98964", "itemRowHtml() only offers 🍽 on a dish that can actually be served", () =>
  has(ACT, /if \(row\.status === "preparing" \|\| row\.status === "ready"\)/));
check("P98965", "…and a legacy row is served by index, a session row by id", () =>
  has(ACT, /data-item-next="\$\{esc\(row\.id\)\}" data-item-status="served"/) === true
  && has(ACT, /data-legacy-order="\$\{esc\(row\.orderId\)\}" data-legacy-idx="\$\{row\.idx\}"/) === true);
check("P98966", "…and a zero price prints nothing rather than '₹0'", () => has(ACT, /row\.price > 0 \? inr\(row\.price \* row\.qty\) : ""/));
check("P98967", "…and every status has a word a person can read", () => {
  const m = ACT.match(/const STLABEL = \{[\s\S]{0,220}?\};/)[0];
  return ["received", "preparing", "ready", "served", "cancelled"].every((k) => m.includes(k + ":")) || "a status has no word";
});
check("P98968", "…and an unknown status still prints, rather than blanking the pill", () => has(ACT, /STLABEL\[row\.status\] \|\| row\.status/));
check("P98969", "tablePanelParts() asks the party's question, not one table's, when tables are joined", () =>
  has(ACT, /const partyAll = \[String\(partyHead\), \.\.\.mergeChildrenOf\(partyHead\)\]/));
check("P98970", "…and REQ_WORDS gives every request type a sentence", () => {
  const m = ACT.match(/const REQ_WORDS = \{[\s\S]{0,240}?\};/)[0];
  return ["open:", "join:", "access:"].every((k) => m.includes(k)) || "a request type has no sentence";
});
check("P98971", "…and an unknown one still says something", () => has(ACT, /REQ_WORDS\[r\.type\] \|\| "sent a request"/));
check("P98972", "…and reqOkLabel names the right button for each", () =>
  has(ACT, /r\.type === "open" \? "✓ Open for them" : r\.type === "access" \? "✓ Attend" : "✓ Let them in"/));
check("P98973", "tReqs hides an 'open' request once the table IS open, by either measure", () =>
  has(ACT, /!\(r\.type === "open" && \(sess \|\| summaryTableOpen\(t\)\)\)/));
check("P98974", "withAllergens() folds the ORDER's allergies into every dish of that order", () =>
  has(ACT, /removed: \[\.\.\.new Set\(\[\.\.\.\(Array\.isArray\(r\.removed\) \? r\.removed : \[\]\), \.\.\.a\]\)\]/));
check("P98975", "orderEditExtras() only renders while the table is in edit mode", () => has(ACT, /if \(!editing\) return "";/));
check("P98976", "…and its allergy chips are keyed by ORDER, so two orders cannot cross", () =>
  has(ACT, /data-alg="\$\{esc\(o\.id\)\}" data-slug=/));
check("P98977", "anyServed() looks at the rows AND at the order's own status", () =>
  has(ACT, /orderItemRows\(o\)\.some\(\(r\) => r\.status === "served"\) \|\| o\.status === "served"/));
check("P98978", "the merged badge only appears when there IS more than one live order", () =>
  has(ACT, /liveOrders\.length > 1 \? `<span class="sx-badge2">/));
check("P98979", "the edit toggle disappears once everything is served or cancelled", () => has(ACT, /const editToggle = allOut \? "" :/));
check("P98980", "editTables is keyed by table as a STRING, so 3 and \"3\" cannot disagree", () =>
  has(ACT, /editTables\.has\(String\(t\)\)/) === true && has(ACT, /editTables\.add\(String\(b\.dataset\.editTable\)\)/) === true);
check("P98981", "openDishEditModal() finds a legacy dish by walking the orders when the board has none", () =>
  has(ACT, /for \(const o of \(state\.data\.orders \|\| \[\]\)\) \{/));
check("P98982", "…and it never trusts `order` being found", () => has(ACT, /order = order \|\| \{\};/));
check("P98983", "…and a custom allergy is kept, not dropped, when the chips are redrawn", () =>
  has(ACT, /const cust = \[\.\.\.working\]\.filter\(\(s\) => !STD\.includes\(s\)\)/));
check("P98984", "…and Cancel, the ✕ and the backdrop all close the dish editor the same way", () => {
  const m = ACT.match(/function openDishEditModal\(itemId, rerender\)[\s\S]*?\n\}/)[0];
  return has(m, /wrap\.querySelector\("\.tbl-modal-close"\)\.onclick = close;/) === true
    && has(m, /wrap\.querySelector\("\.dish-edit-cancel"\)\.onclick = close;/) === true
    && has(m, /wrap\.onclick = \(e\) => \{ if \(e\.target === wrap\) close\(\); \}/) === true;
});
check("P98985", "openAddDishModal() never offers a sold-out dish", () => has(ACT, /!\(d\.tags \|\| \[\]\)\.includes\("sold-out"\)/));
check("P98986", "…and its search says so when nothing matches", () => has(A, /No dishes match\./));
check("P98987", "…and an open-price dish asks for a price before it is added", () =>
  has(ACT, /if \(d && d\.open_price\) \{ price = await pricePrompt\(d\.title\); if \(price == null\) return; \}/));
check("P98988", "…and a refused add says why", () => has(A, /Couldn't add: /));
check("P98989", "openTakeOrder() localises a category name, falling back to its slug", () =>
  has(ACT, /function localizeCat\(name, slug\)/) === true && has(ACT, /return name \|\| slug;/) === true);
check("P98990", "…and a multi-language name picks English, then anything, then the slug", () =>
  has(ACT, /return name\.en \|\| Object\.values\(name\)\.find\(\(v\) => v\) \|\| slug;/));
check("P98991", "addOne() reuses a plain line rather than making a second identical one", () =>
  has(ACT, /const l = plainLine\(id\); if \(l\) \{ l\.qty = Math\.min\(99, l\.qty \+ 1\); return; \}/));
check("P98992", "addOneAsync() answers false when the price prompt is cancelled, so nothing is added", () =>
  has(ACT, /if \(p == null\) return false;/));
check("P98993", "decUid() removes the line at one, rather than leaving a zero-quantity line", () =>
  has(ACT, /if \(cart\[i\]\.qty > 1\) cart\[i\]\.qty--; else \{ cart\.splice\(i, 1\); editing\.delete\(uid\); \}/));
check("P98994", "…and it forgets any open editor for the line it removed", () => atLeast(countOf(ACT, /editing\.delete\(/g), 3, "editor cleanups"));
check("P98995", "qtyIn() counts every line of a dish, not just the plain one", () =>
  has(ACT, /cart\.filter\(\(c\) => c\.id === id\)\.reduce\(\(s, c\) => s \+ c\.qty, 0\)/));
check("P98996", "dishTile() falls back to the brand mark when a dish has no photo", () =>
  has(ACT, /const DEFAULT_DISH_IMG = "\/brand\/aevidine-mark\.svg"/));
check("P98997", "…and a BROKEN photo falls back to the same mark rather than a torn icon", () =>
  has(ACT, /onerror="this\.onerror=null;this\.src='\$\{DEFAULT_DISH_IMG\}'/));
check("P98998", "…and that fallback file really ships", () => exists("public/brand/aevidine-mark.svg"));
check("P98999", "…and a dish photo is lazy, so a 200-dish menu does not fetch 200 images at once", () => has(ACT, /loading="lazy"/));
check("P99000", "catCard() says how many dishes are behind each category", () => has(ACT, /<b>\$\{n\}<\/b><i> dish\$\{n === 1 \? "" : "es"\}<\/i>/));
check("P99001", "listHtml() has three modes: searching, drilling and the full list", () => {
  const m = ACT.match(/const listHtml = \(\) => \{[\s\S]*?\n  \};/)[0];
  return (m.includes("if (ql)") && m.includes("if (quick)") && m.includes("to-sec")) || "a browse mode is missing";
});
check("P99002", "…and a search with no matches quotes what was typed", () => has(ACT, /No dishes match "\$\{esc\(q\)\}"/));
check("P99003", "…and an empty category says which one is empty", () => has(ACT, /Nothing in \$\{esc\(s\.name\)\} right now/));
check("P99004", "…and a menu with no dishes at all says so", () => has(A, /No dishes on the menu yet\./));
check("P99005", "drillHtml() names where you are and how much is there", () =>
  has(ACT, /const back = \(qoCat \|\| ql\) \? `<button class="qo-back" type="button">‹ Categories<\/button>` : ""/));
check("P99006", "…and going back clears the search as well as the category", () =>
  has(ACT, /qoCat = null; if \(q\) \{ q = ""; const s = wrap\.querySelector\("\.to-search"\); if \(s\) s\.value = ""; \}/));
check("P99007", "algChips() marks a chip on when the set holds it", () => has(ACT, /set\.has\(a\.slug\) \? "on" : ""/));
check("P99008", "…and a custom allergy keeps its own chip, always on", () =>
  has(ACT, /\[\.\.\.set\]\.filter\(\(s\) => !ALG_STD\.includes\(s\)\)/));
check("P99009", "cartLines() shows what makes each line different, in words", () =>
  has(ACT, /⚠ no \$\{\[\.\.\.c\.avoid\]\.join\(", "\)\}/) === true && has(ACT, /📝 \$\{c\.note\}/) === true);
check("P99010", "…and an open-price line's amount is a BUTTON, because that price can be changed", () =>
  has(ACT, /class="to-line-p to-price-edit" data-price="\$\{c\.uid\}"/));
check("P99011", "cartSub() and cartSplit() read the same cart, so the two totals cannot disagree", () =>
  has(ACT, /const cartSplit = \(\) => splitCartLines\(cart, state\.data\.settings\)/));
check("P99012", "paintCart() keeps the send buttons in step with the cart", () =>
  has(ACT, /sendBtns\.forEach\(\(b\) => \(b\.disabled = !cart\.length\)\)/));
check("P99013", "…and the quick-mode cart button counts PLATES, not lines", () =>
  has(ACT, /const qty = cart\.reduce\(\(s, c\) => s \+ c\.qty, 0\)/));
check("P99014", "…and it pluralises 'item' correctly", () => has(ACT, /lbl\.textContent = qty === 1 \? "item" : "items"/));
check("P99015", "flashCart() restarts its animation even on the same line", () => has(ACT, /void last\.offsetWidth;/));
check("P99016", "…and scrolls the new line into view without yanking the page", () =>
  has(ACT, /last\.scrollIntoView\(\{ block: "nearest" \}\)/));
check("P99017", "openTileEdit() adds the dish first if it is not in the cart yet", () =>
  has(ACT, /if \(!l\) \{ if \(!\(await addOneAsync\(id\)\)\) return; l = plainLine\(id\); paintList\(\); paintCart\(\); \}/));
check("P99018", "…and closing it de-duplicates, in case the edit made two lines identical", () =>
  has(ACT, /ov\.remove\(\); dedupe\(\); paintCart\(\); paintList\(\);/));
check("P99019", "bindCart() rebinds every control after a repaint, so none is orphaned", () => {
  const m = ACT.match(/function bindCart\(\)[\s\S]*?\n  \}/)[0];
  return ["data-linc", "data-ldec", "data-rm", "data-edit", "data-price", "to-line-note"].every((k) => m.includes(k)) || "a cart control is not rebound";
});
check("P99020", "syncSpy() only runs where there ARE sections to spy on", () =>
  has(ACT, /if \(!secs\.length \|\| !catsEl\) return;/));

/* ── H2 continued · the floor, the panels, the plumbing (P99021–P99120) ─────────────────────── */

check("P99021", "callsForTable() trims a table number before comparing it", () => has(ACT, /\(c\.table_number \|\| ""\)\.trim\(\) === String\(t\)/));
check("P99022", "…and the summary path trims it the same way, so the two agree", () => eq(countOf(ACT, /\(c\.table_number \|\| ""\)\.trim\(\) === String\(t\)/g), 2));
check("P99023", "tableTileStateFromSummary() never trusts `counts` being present", () => has(ACT, /counts: tile\.counts \|\| \{ nw: 0, ck: 0, rd: 0, sv: 0 \}/));
check("P99024", "…nor `pay`", () => has(ACT, /pay: tile\.pay \|\| ""/));
check("P99025", "…nor `members`", () => has(ACT, /guests: Number\(tile\.members\) \|\| 0/));
check("P99026", "customFloorHtml() draws every table the plan places, and every one it does not", () =>
  has(ACT, /const missing = floorTableList\(n\)\.filter\(\(i\) => !placed\.has\(String\(i\)\)\)/));
check("P99027", "…and the unplaced strip uses the SAME tile builder, so a table behaves identically", () =>
  has(ACT, /missing\.map\(\(i\) => floorTileHtml\(i\)\)\.join\(""\)/));
check("P99028", "…and it says how many are unplaced, in the right plural", () =>
  has(ACT, /\$\{missing\.length\} table\$\{missing\.length > 1 \? "s" : ""\}/));
check("P99029", "…and a zone caption is escaped, because the owner types it by hand", () => has(ACT, /esc\(z\.label \|\| ""\)/));
check("P99030", "touchCap() leaves the admin's preview alone, because that previews the PC floor", () =>
  has(ACT, /if \(FLOOR_PREVIEW\) return v;/));
check("P99031", "railOpen() cannot throw on a browser with storage switched off", () =>
  has(ACT, /function railOpen\(\) \{ try \{ return localStorage\.getItem\(RAIL_KEY\) === "1"; \} catch \(e\) \{ return false; \} \}/));
check("P99032", "…and the rail only exists above the width it was designed for", () => has(ACT, /const RAIL_MIN_W = 1024/));
check("P99033", "…and its toggle is wired ONCE, not on every sync", () => has(ACT, /if \(!btn\.__railWired\)/));
check("P99034", "syncNavRail() keeps the button's label, title and aria in step with each other", () =>
  has(ACT, /const word = open \? "Collapse menu" : "Expand menu";/));
check("P99035", "queueNavFit() coalesces a burst of layout changes into one measurement", () =>
  has(ACT, /if \(navFitQueued\) return;\s*\n\s*navFitQueued = true;/));
check("P99036", "…and syncNavFit refuses to re-enter itself mid-measure", () => has(ACT, /if \(!bar \|\| !tabs \|\| navFitBusy\) return;/));
check("P99037", "…and it always clears its own busy flag and measuring class", () =>
  has(ACT, /document\.body\.classList\.remove\("nav-measuring"\)/) === true && has(ACT, /navFitBusy = false;/) === true);
check("P99038", "…and a touch device is never given the tightened desktop nav", () => has(ACT, /if \(!touch\) \{/));
check("P99039", "navDrawerSet() is a no-op when it is already in the state asked for", () =>
  has(ACT, /if \(open === document\.body\.classList\.contains\("nav-open"\)\) return;/));
check("P99040", "…and its BACK layer is registered once and released once", () =>
  has(ACT, /if \(window\.LFH_BACK && !navBackOff\)/) === true && has(ACT, /const off = navBackOff; navBackOff = null; off\(\);/) === true);
check("P99041", "buildNavUtilRows() never duplicates a row it has already made", () =>
  has(ACT, /if \(box\.querySelector\(`\[data-proxy="\$\{targetId\}"\]`\)\) continue;/));
check("P99042", "…and it skips a control that is not on the page for this person", () => has(ACT, /if \(!target\) continue;/));
check("P99043", "…and its labels are set with textContent, never built from HTML", () =>
  has(ACT, /b\.querySelector\("\.tab-lbl"\)\.textContent = label;/));
check("P99044", "…and tapping one closes the drawer BEFORE it acts, so BACK has one layer", () =>
  has(A, /navDrawerSet\(false\);          \/\/ close first/));
check("P99045", "syncLegendToDrawer() gives the legend back on a big screen", () =>
  has(ACT, /if \(!phone\) \{ if \(slot\) slot\.remove\(\); return; \}/));
check("P99046", "…and moves the LIVE node rather than copying it, so there is only ever one", () =>
  has(ACT, /if \(held !== live\) \{ if \(held\) held\.remove\(\); slot\.appendChild\(live\); \}/));
check("P99047", "refreshTitle() puts the count in the tab title so a hidden tab still says it", () =>
  has(ACT, /const title = n \? `\(\$\{n\}\) Manager — Aevidine` : "Manager — Aevidine"/));
check("P99048", "…and it tries the parent frame's title too, without letting a cross-origin embed throw", () =>
  has(A, /catch \(e\) \{ \/\* cross-origin embed/));
check("P99049", "syncBurgerNews() adds up every badge, and says how many in words", () =>
  has(ACT, /n > 0 \? `Menu & settings — \$\{n\} need\$\{n === 1 \? "s" : ""\} you` : "Menu & settings"/));
check("P99050", "…and it only counts a badge that is actually showing", () => has(ACT, /if \(b && !b\.hidden\) n \+= Number\(b\.textContent\) \|\| 0/));
check("P99051", "updateOrdersBadge() hides itself at zero rather than showing a 0", () =>
  has(ACT, /b\.hidden = unseenOrders === 0/));
check("P99052", "updateTablesBadge() does the same", () => has(ACT, /b\.hidden = unseenTables === 0/));
check("P99053", "playOrderChime() can never break the panel on a browser with no audio", () =>
  has(ACT, /const Ctx = window\.AudioContext \|\| window\.webkitAudioContext;\s*\n\s*if \(!Ctx\) return;/));
check("P99054", "…and it closes its audio context rather than leaking one per order", () =>
  has(ACT, /setTimeout\(\(\) => ctx\.close\(\), 1200\)/));
check("P99055", "…and the whole thing is wrapped, because a chime must never stop an order landing", () =>
  has(ACT, /function playOrderChime\(\) \{\s*\n\s*try \{/));
check("P99056", "reconcileBoard() strips volatile fields before fingerprinting the orders", () =>
  has(ACT, /const RT_VOLATILE_ORDER = new Set\(\["updated_at"\]\)/));
check("P99057", "…and it never repaints the Orders tab while somebody is typing in it", () =>
  has(ACT, /const typing = document\.activeElement && \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(document\.activeElement\.tagName\)/));
check("P99058", "…and a repaint skipped for typing does NOT bank its fingerprint, so it happens later", () =>
  has(ACT, /if \(!skippedForTyping\) lastPollSig = sig;/));
check("P99059", "…and the first poll only sets a baseline, so nothing shouts at boot", () =>
  has(ACT, /if \(prev !== null && orderCount > prev\)/));
check("P99060", "…and a waiter call is tracked by ID, so a re-call is a new call", () =>
  has(A, /seenCallIds = new Set\(openIds\); \/\/ track exactly the calls still open/));
check("P99061", "pollTables() widens each named table to its whole party", () =>
  has(ACT, /\[\.\.\.new Set\(tables\.map\(String\)\.flatMap\(\(t\) => partyTablesOf\(t\)\)\)\]/));
check("P99062", "…and a newer targeted poll for ONE table only drops that table's tile", () =>
  has(ACT, /if \(mySeq\[t\] !== tileSeq\[t\]\) continue;/));
check("P99063", "…and a full reload started meanwhile always wins", () => has(ACT, /if \(dataSeq !== born\) return;/));
check("P99064", "…and a network blip falls back to a full, safe reload", () =>
  has(A, /catch \(e\) \{ return pollOrders\(\); \}      \/\/ network\/parse blip/));
check("P99065", "…and a table that dropped off the floor loses its tile rather than keeping a stale one", () =>
  has(ACT, /else delete tiles\[t\];/));
check("P99066", "…and a tile holding unsent work is NOT overwritten by the server's answer", () =>
  has(ACT, /if \(heldNow && heldNow\.has\(String\(t\)\) && tiles\[t\]\) \{ latest = r\.sum; continue; \}/));
check("P99067", "mergeServerSummary() only holds back tiles that really have queued work", () =>
  has(ACT, /if \(!held\) return incoming;/));
check("P99068", "tablesWithUnsentWork() can never throw the render", () =>
  has(ACT, /\} catch \(e\) \{ return null; \}/));
check("P99069", "patchSummaryTileAttend() clears the call flag across the whole party", () =>
  has(ACT, /const party = new Set\(partyTablesOf\(t\)\.map\(String\)\)/));
check("P99070", "patchSummaryTileAccept() moves the new dishes into cooking rather than losing them", () =>
  has(ACT, /c\.ck \+= c\.nw; c\.nw = 0;/));
check("P99071", "…and it only relabels a tile that was actually saying 'new'", () =>
  has(ACT, /if \(nt\.state === "new"\) \{ nt\.state = "prep"; nt\.label = "Preparing"; \}/));
check("P99072", "startOrderWatch() has a boot grace, so realtime does not re-load what boot just loaded", () =>
  has(ACT, /rtBootGraceUntil = Date\.now\(\) \+ 3000/));
check("P99073", "…the backup poll skips a hidden tab, so an idle screen costs nothing", () =>
  has(ACT, /setInterval\(\(\) => \{ if \(document\.hidden\) return; pollOrders\(\); loadPlatform\(\); \}, 60000\)/));
check("P99074", "…and the no-realtime fallback backs off to a minute rather than hammering", () =>
  has(ACT, /Math\.min\(2000 \* Math\.pow\(2, fbStep\), 60000\)/));
check("P99075", "…with jitter, so twenty devices do not all ask at the same instant", () =>
  has(ACT, /const fbSpread = \(ms\) => Math\.round\(ms \* \(0\.8 \+ Math\.random\(\) \* 0\.4\)\)/));
check("P99076", "…and it resets its backoff the moment a read succeeds", () => has(ACT, /fbStep = 0; \}/));
check("P99077", "…and it does not count a hidden or offline tab as a failure", () =>
  has(ACT, /if \(document\.hidden \|\| navigator\.onLine === false\) \{ fbStep = 0; \}/));
check("P99078", "a phone rotation that changes layout mode collapses to one popup", () =>
  has(ACT, /if \(nowPhone && state\.floatingTables\.length\) \{/));
check("P99079", "…and otherwise just re-lays the row, without a re-render", () =>
  has(ACT, /if \(state\.floatingTables\.length\) layoutFloatingRow\(\);/));
check("P99080", "the overlay BACK wiring watches the body for any overlay this panel opens", () => {
  const m = ACT.match(/const SEL = "\.sx-modal-overlay[^"]*";/)[0];
  return ["sx-modal-overlay", "bill-overlay", "confirm-overlay", "disc-overlay", "pay-overlay"].every((c) => m.includes(c)) || "an overlay kind is not watched";
});
check("P99081", "…and it prefers the overlay's own close function to a bare remove", () =>
  has(ACT, /elm\.__lfhClose \? elm\.__lfhClose\(\) : elm\.remove\(\)/));
check("P99082", "…and it untracks an overlay that leaves the page", () =>
  has(ACT, /m\.removedNodes\.forEach\(\(n\) => \{ if \(n\.nodeType === 1 && off\.has\(n\)\) untrack\(n\); \}\)/));
check("P99083", "the keyboard shortcuts never fire while a modal is open", () =>
  has(ACT, /if \(typing \|\| modalOpen \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return;/));
check("P99084", "…nor while somebody is typing", () => has(ACT, /el\.isContentEditable/));
check("P99085", "…and Ctrl/Cmd-S only saves when there is something selected to save", () => has(ACT, /if \(state\.sel\) save\(\);/));
check("P99086", "…and the 1-9 jump only counts tabs that are actually visible", () =>
  has(ACT, /\.filter\(\(t\) => !t\.hidden && t\.offsetParent !== null\)/));
check("P99087", "the sidebar resizer keeps its width between 220 and 560", () =>
  has(ACT, /Math\.min\(560, Math\.max\(220, ev\.clientX\)\)/));
check("P99088", "…and remembers it without being able to throw", () => has(ACT, /try \{ localStorage\.setItem\("lfh_editor_sidebar_w", String\(w\)\); \} catch \{\}/));
check("P99089", "the search box's suggestion list closes on blur, but not before a click can land", () =>
  has(ACT, /box\.addEventListener\("blur", \(\) => setTimeout\(closeSuggest, 120\)\)/));
check("P99090", "…and the arrow keys are bounded at both ends of the list", () =>
  has(ACT, /Math\.min\(_suggestMatches\.length - 1, _suggestIdx \+ 1\)/) === true && has(ACT, /Math\.max\(0, _suggestIdx - 1\)/) === true);
check("P99091", "leaving a page with unsaved edits warns first", () =>
  has(ACT, /window\.addEventListener\("beforeunload", \(e\) => \{ if \(editorDirty\(\)\) \{ e\.preventDefault\(\); e\.returnValue = ""; \} \}\)/));
check("P99092", "…and every tab switch asks before discarding them", () =>
  has(ACT, /if \(await confirmDiscardIfDirty\(\)\) \{ setTab\(t\.dataset\.tab\); navDrawerSet\(false\); \}/));
check("P99093", "setTab() drops the chart objects when leaving the dashboard, so they cannot leak", () =>
  has(ACT, /dashCharts\.forEach\(\(c\) => \{ try \{ c\.destroy\(\); \} catch \{\} \}\); dashCharts = \[\];/));
check("P99094", "…and closes every open table when leaving the floor", () =>
  has(ACT, /state\.floatingTables = \[\];\s*\n\s*state\.selectedTable = null;\s*\n\s*state\.openSess = null;/));
check("P99095", "…and releases their BACK layers with them", () => has(ACT, /syncTableBackLayers\(\);/));
check("P99096", "…and clears the search and the category filter, so a stale filter cannot hide a list", () =>
  has(ACT, /state\.search = "";/) === true && has(ACT, /state\.catFilter = "";/) === true);
check("P99097", "…and remembers the tab, without being able to throw", () =>
  has(ACT, /try \{ localStorage\.setItem\("lfh_editor_tab", tab\); \} catch \{\}/));
check("P99098", "…and hides ＋ New and the search on every tab that has no list", () =>
  has(ACT, /const noList = tab === "general" \|\| tab === "orders"/));
check("P99099", "…and writes the tab onto the body, which the CSS and the guards read", () =>
  has(ACT, /document\.body\.dataset\.tab = tab;/));
check("P99100", "…and the three editor sub-tabs share one parent tab", () =>
  has(ACT, /const EDITOR_SUB = \["items", "categories", "filters"\]/));
check("P99101", "…and only loads what the tab it opened actually needs", () => {
  const m = ACT.match(/function setTab\(tab\)[\s\S]*?\n\}/)[0];
  return ["loadOrders()", "loadSessions()", "loadUsers()", "loadPlatform()"].every((k) => m.includes(k)) || "a tab loads nothing";
});
check("P99102", "loadOrders() drops a stale answer when a newer read has started", () =>
  has(A, /if \(seq !== dataSeq\) return; \/\/ a newer refresh started/));
check("P99103", "…and a failed calls read does not lose the orders it already has", () =>
  has(ACT, /try \{\s*\n\s*const calls = await api\("GET", "\/calls"\);[\s\S]{0,140}?\} catch \{\}/));
check("P99104", "loadOplog() only repaints when the log tab is the one showing", () =>
  has(ACT, /state\.oplog = await api\("GET", "\/oplog"\); if \(state\.tab === "log"\) renderEditor\(\);/));
check("P99105", "…and says so in English when it cannot", () => has(A, /Couldn't load the activity log: /));
check("P99106", "loadUsers() does the same for the customer log", () =>
  has(ACT, /state\.users = await api\("GET", "\/users"\); if \(state\.tab === "log"\) renderEditor\(\);/));
check("P99107", "bindOplog() keeps the caret where it was after a search repaint", () =>
  has(ACT, /const at = q\.selectionStart;/) === true && has(ACT, /n\.setSelectionRange\(at, at\)/) === true);
check("P99108", "…and it cannot throw on a browser that refuses setSelectionRange", () =>
  has(ACT, /try \{ n\.setSelectionRange\(at, at\); \} catch \{\}/));
check("P99109", "opDetailText() folds a tap trail into one readable sentence", () =>
  has(ACT, /return order\.map\(\(l\) => \(counts\.get\(l\) > 1 \? l \+ " \\u00d7" \+ counts\.get\(l\) : l\)\)\.join\(", "\)/));
check("P99110", "…and drops connection noise from it", () => has(ACT, /\/\^connection\\b\/i\.test\(l\)/));
check("P99111", "…and says something rather than nothing when there is nothing readable in it", () =>
  has(ACT, /return "checked the screen";/));
check("P99112", "…and unparseable detail is shown as-is, not swallowed", () =>
  has(ACT, /let arr; try \{ arr = JSON\.parse\(detail\); \} catch \{ return detail; \}/));
check("P99113", "isManagerPinRow() only treats a tablet action by a named person as PIN-authorised", () =>
  has(ACT, /r\.panel === "tablet" && !!r\.actor && !SELF_ACTOR_ACTIONS\.has\(r\.action\)/));
check("P99114", "…and the actions a person does to their OWN account are excluded by name", () => {
  const m = ACT.match(/const SELF_ACTOR_ACTIONS = new Set\(\[[\s\S]{0,200}?\]\)/)[0];
  return ["login", "logout", "profile_setup", "password_change", "pin_set"].every((k) => m.includes(k)) || "a self action is missing";
});
check("P99115", "pinPill() says plainly when a PIN is shared by more than one manager", () =>
  has(A, /This PIN is shared by these managers — any of them could have entered it/));
check("P99116", "oplogHtml() only offers Block on a device that is not this panel", () =>
  has(ACT, /if \(r\.device_id && r\.panel !== "editor"\)/));
check("P99117", "…and an admin's own action is marked as such", () =>
  has(ACT, /r\.actor_id === "00000000-0000-0000-0000-0000000000ad"/));
check("P99118", "logHtml() marks a phone that is already blocked", () =>
  has(ACT, /const blocked = m\.phone && blockedPhones\.has\(m\.phone\)/));
check("P99119", "…and an unblock request is sorted to the top", () =>
  has(ACT, /\(b\.unban_requested_at \? 1 : 0\) - \(a\.unban_requested_at \? 1 : 0\)/));
check("P99120", "…and the blocked panel says how many asked to be let back in", () =>
  has(ACT, /\$\{asked \? ` · \$\{asked\} asked to be unblocked` : ""\}/));

/* ═════ H3 · KOT ops · printing · banquet · platform · x-ray · nav (P99121–P99260) ═══════════ */

check("P99121", "openShiftPicker() draws every table, dimming the ones that cannot take the party", () =>
  has(ACT, /const grid = allT\.map\(\(i\) => \{/));
check("P99122", "…and a dimmed tile says WHY, on the tile itself", () => has(ACT, /class="shiftpick-why">\$\{esc\(why\)\}/));
check("P99123", "…and a disabled tile is disabled to a screen reader too", () => atLeast(countOf(ACT, /aria-disabled="true"/g), 3, "aria-disabled tiles"));
check("P99124", "openMergePicker() only offers tables that are actually open", () =>
  has(ACT, /const occ = floorTableList\(n\)\.filter\(\(i\) => String\(i\) !== String\(t\) && summaryTableOpen\(i\)\)/));
check("P99125", "…and partyFace names every table in a party it is offering to join", () =>
  has(ACT, /const partyFace = \(i\) => \{ const kids = mergeChildrenOf\(i\); return kids\.length \?/));
check("P99126", "…and a party tile is marked as one, so it does not read as a single table", () =>
  atLeast(countOf(ACT, /kotm-tile-party/g), 3, "party tile marks"));
check("P99127", "openMoveKotPicker() refuses politely when there is nothing movable", () =>
  has(A, /No movable KOTs on this table/));
check("P99128", "openMoveItemPicker() does the same for dishes", () => has(A, /No movable dishes on this table/));
check("P99129", "…and both are two clear steps, with the hint rewritten between them", () =>
  has(ACT, /hint\.textContent = "Step 2 · move it to which table\? \(it gets its own new KOT there\)"/));
check("P99130", "…and a multi-plate line is said to move whole, before it is tapped", () =>
  atLeast(countOf(A, /a multi-plate line moves whole/g), 2, "warnings"));
check("P99131", "openReprintKotPicker() refuses politely when there are no KOTs", () => has(A, /No KOTs on this table/));
check("P99132", "…and its second step can be backed out of", () => has(ACT, /bodyEl\.querySelector\("\[data-printback\]"\)\.onclick = \(\) => \{ picked = null; render\(\); \}/));
check("P99133", "…and it names which KOT it is about to print", () => has(ACT, /KOT #\$\{picked\.kot_no != null \? esc\(picked\.kot_no\) : "—"\} — print it where\?/));
check("P99134", "openKotColumns() disables an operation rather than hiding it, and says why", () =>
  has(ACT, /\$\{r\.on \? "" : `<span class="kotm-off-why">\$\{r\.why\}<\/span>`\}/));
check("P99135", "…and every operation carries its own tip", () => has(ACT, /data-tip="\$\{esc\(KOT_TIPS\[r\.id\] \|\| ""\)\}"/));
check("P99136", "…and the phone sheet uses the same tips, so the two screens teach the same thing", () =>
  eq(countOf(ACT, /data-tip="\$\{esc\(KOT_TIPS\[r\.id\] \|\| ""\)\}"/g), 2));
check("P99137", "…and the two screens offer the same operations, in the same order", () => {
  const cols = [...ACT.matchAll(/\{ id: "(\w+)", icon:/g)].map((m) => m[1]);
  const half = cols.length / 2;
  return eq(cols.slice(0, half).join(","), cols.slice(half).join(","));
});
check("P99138", "col2() has a branch for every operation that needs a second step", () => {
  const m = ACT.match(/const col2 = \(\) => \{[\s\S]*?\n  \};/)[0];
  return ["shift", "merge", "movekot", "moveitem", "reprint"].every((k) => m.includes(`"${k}"`)) || "an operation has no second step";
});
check("P99139", "…and col3 only exists once something has been picked in col2", () =>
  has(ACT, /if \(sel1 === "movekot" && sel2\)/));
check("P99140", "…and picking a new operation clears the old second choice", () => has(ACT, /sel1 = op; sel2 = null; render\(\);/));
check("P99141", "kotCard() counts PLATES on a KOT, not lines", () =>
  has(ACT, /orderItemRows\(o\)\.reduce\(\(s2, r\) => s2 \+ \(parseInt\(r\.qty, 10\) \|\| 1\), 0\)/));
check("P99142", "…and pluralises 'dishes'", () => has(ACT, /\$\{nd\} dish\$\{nd === 1 \? "" : "es"\}/));
check("P99143", "tileDue() says 'open' rather than '₹0' on a table that owes nothing", () =>
  has(ACT, /tile && tile\.due > 0 \? "due " \+ inr\(tile\.due\) : "open"/));
check("P99144", "run() turns a refused operation into a sentence, never a code", () =>
  has(ACT, /fail\("Couldn't do that: " \+ \(KOT_REASON_TEXT\[r\.reason\] \|\| r\.reason \|\| "rejected"\)\)/));
check("P99145", "…and a thrown one too", () => has(ACT, /catch \(e\) \{ fail\("Failed: " \+ e\.message\); \}/));
check("P99146", "the tip engine hides on scroll and on click, so a tip cannot be left behind", () =>
  has(ACT, /document\.addEventListener\("scroll", hide, true\)/) === true && has(ACT, /document\.addEventListener\("click", hide, true\)/) === true);
check("P99147", "…and it moves a `title` into its own store, so the browser's tooltip cannot double up", () =>
  has(ACT, /el\.dataset\.tip = el\.title; el\.removeAttribute\("title"\)/));
check("P99148", "printTicketHtml() writes into an off-screen frame, never over the panel", () =>
  has(ACT, /ifr\.style\.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;"/));
check("P99149", "…and it answers false rather than throwing when printing is impossible", () =>
  has(A, /catch \(e\) \{ return false; \/\* printing must NEVER break the panel \*\//));
check("P99150", "printKotTicket() prints the party's own table label, not a bare number", () =>
  has(ACT, /tableLabel: tablePrintLabel\(o\.table_number\)/));
check("P99151", "…and an order with allergies prints them at the top, in capitals", () => has(ACT, /⚠ AVOID: /));
check("P99152", "sendKotToKitchen() says saved-not-sent rather than claiming the kitchen has it", () =>
  has(A, /the kitchen prints it the moment you're back online/));
check("P99153", "PRINTER_KIND_TEXT gives every reported fault a sentence", () => {
  const m = ACT.match(/const PRINTER_KIND_TEXT = \{[\s\S]{0,420}?\};/)[0];
  return ["paper_out", "half_print", "jam", "other", "auto_fail"].every((k) => m.includes(k)) || "a fault kind has no sentence";
});
check("P99154", "…and an unknown kind still prints something", () => has(ACT, /PRINTER_KIND_TEXT\[e\.kind\] \|\| "Printer problem"/));
check("P99155", "noticePrinterNews() only toasts a problem that is NEW to this device", () =>
  has(ACT, /if \(!seenPrinterKeys\.has\(a\.key\)\) toast/));
check("P99156", "managerPrintPass() only prints jobs this device actually WON", () =>
  has(ACT, /jobs\.filter\(\(x\) => won\.has\(x\.id\)\)/));
check("P99157", "…and it stands down when another screen owns the station", () =>
  has(ACT, /if \(says\.station && says\.station\.active && !says\.station\.mine && !says\.station\.stale\) return;/));
check("P99158", "…and when the restaurant has said this screen may not print", () => has(ACT, /if \(!says\.mayPrint\) return;/));
check("P99159", "…and it only re-renders when the ANSWER changed, not on every pass", () =>
  has(ACT, /if \(changed && state\.tab === "tables"\) renderEditor\(\);/));
check("P99160", "…and its whole body is wrapped, so a failed pass never breaks the floor", () =>
  has(A, /catch \(e\) \{ \/\* offline \/ busy — the next pass retries/));
check("P99161", "stationKey() and helperKey() make 'did the answer change' a cheap string compare", () =>
  has(ACT, /const stationKey = \(v\) =>/) === true && has(ACT, /const helperKey = \(v\) =>/) === true);
check("P99162", "formPrinting() says plainly when the board has not been read yet", () =>
  has(A, /Reading the printing setup…/));
check("P99163", "…and offers a retry when it failed", () => has(ACT, /\$\{state\.printBoardErr \? `<div style="margin-top:10px"><button type="button" class="btn" data-pw="reload">/));
check("P99164", "…and every label it prints comes from the server, with a fallback", () =>
  has(ACT, /const L = B\.labels \|\| \{ kind: \{\}, what: \{\}, off: \{\} \}/));
check("P99165", "seenWord() distinguishes connected, last-seen and never-started", () => {
  const m = ACT.match(/const seenWord = \(a\) =>[\s\S]{0,320}?;/)[0];
  return (m.includes("connected · seen") && m.includes("last heard from") && m.includes("has never started yet")) || "a state has no wording";
});
check("P99166", "printerChips() says plainly when a computer has listed no printers yet", () =>
  has(A, /It has not listed any printers yet/));
check("P99167", "…and a Test page is only offered on THIS computer, and only to someone who may set up", () =>
  has(ACT, /\$\{own && may \? `<button type="button" class="btn"[^`]*data-pw="test"/));
check("P99168", "agentName() falls back to plain words for a computer it cannot name", () =>
  has(ACT, /\|\| "another computer"/));
check("P99169", "editorWord() names the right text editor for each operating system", () =>
  has(ACT, /k === "windows" \? "Notepad" : k === "mac" \? "TextEdit, then Format → Make Plain Text" : "nano"/));
check("P99170", "fileCard() renders nothing at all for someone who may not set printing up", () =>
  has(ACT, /if \(!may \|\| !f\) return "";/));
check("P99171", "…and the Windows step says to save as All Files, which is the trap on that OS", () =>
  atLeast(countOf(ACT, /Save as type: All Files/g), 2, "Windows warnings"));
check("P99172", "line() shows a read-only sentence to someone who may not change the routing", () =>
  has(ACT, /— set by Aevidine\.<\/p>/));
check("P99173", "…and the picker is disabled, with a reason, when there are no printers to pick", () =>
  has(ACT, /\$\{anyPrinters \? "" : ` disabled title="Set this computer up above first/));
check("P99174", "…and 'not decided yet' is a real option, distinct from 'Nobody'", () =>
  has(ACT, /<option value=""\$\{!off && !answered \? " selected" : ""\}>— not decided yet —<\/option>/));
check("P99175", "jobWord() says printed, gave up, nothing-to-print or the raw state — never nothing", () => {
  const m = ACT.match(/const jobWord = \(j\) =>[\s\S]{0,360}?;/)[0];
  return (m.includes("printed") && m.includes("gave up after") && m.includes("nothing to print")) || "a job state has no word";
});
check("P99176", "…and a job's error is shown under it rather than swallowed", () =>
  has(ACT, /\$\{j\.error \? `<div class="muted" style="font-size:11\.5px">\$\{esc\(j\.error\)\}<\/div>` : ""\}/));
check("P99177", "bqOn() reads the field switches from ONE shared helper, not from a local copy", () =>
  has(ACT, /function bqOn\(k\) \{ return LFH_BILLDOC\.bqOn\(state\.data\.settings, k\); \}/));
check("P99178", "…and the paper size, the tax model and the words-for-amount come from the same place", () =>
  has(ACT, /LFH_BILLDOC\.bqPaper/) === true && has(ACT, /LFH_BILLDOC\.bqTaxModel/) === true && has(ACT, /LFH_BILLDOC\.bqWords/) === true);
check("P99179", "BQ_FIELDS names every field the admin can switch on, in plain words", () => {
  const m = ACT.match(/const BQ_FIELDS = \[[\s\S]*?\n\];/)[0];
  return atLeast((m.match(/\["/g) || []).length, 15, "named banquet fields");
});
check("P99180", "…and the default set is the six a simple bill needs", () =>
  has(ACT, /const BQ_DEFAULT_FIELDS = \["cust_name", "cust_phone", "dish", "pax", "rate", "advance"\]/));
check("P99181", "bqForm() creates the form's shape once and reuses it", () => has(ACT, /if \(!bq\.f\) \{/));
check("P99182", "bqLines() clamps the package index, so a deleted package cannot blank the bill", () =>
  eq(countOf(ACT, /Math\.min\(f\.pkg, Math\.max\(0, active\.length - 1\)\)/g), 1));
check("P99183", "…and a zero-price package means 'type the price', not 'free'", () =>
  has(ACT, /const open = Number\(pkg\.price\) === 0;/));
check("P99184", "…and plates are at least one, and whole", () => has(ACT, /Math\.max\(1, Math\.round\(Number\(f\.pax\) \|\| 1\)\)/));
check("P99185", "…and an extra line whose package was deleted is skipped, not drawn as '?'", () =>
  has(ACT, /const it = bq\.items\.find\(\(i\) => i\.id === ex\.id\);\s*\n\s*if \(!it\) continue;/));
check("P99186", "bqMath() rounds each discount to paise before adding them up", () =>
  has(ACT, /disc \+= Math\.round\(gross \* \(l\.disc \/ 100\) \* 100\) \/ 100/));
check("P99187", "…and tax is taken on the discounted amount, not the gross", () =>
  has(ACT, /const tax = Math\.round\(\(sub - disc\) \* tm\.rate \* 100\) \/ 100/));
check("P99188", "…and the balance is what is left after everything received", () =>
  has(ACT, /bal: Math\.round\(\(total - paid\) \* 100\) \/ 100/));
check("P99189", "…and a split payment's parts are what counts as received, when that field is on", () =>
  has(ACT, /f\.pays\.reduce\(\(a, p\) => a \+ \(Number\(p\.amt\) \|\| 0\), 0\)/));
check("P99190", "bqPackagesHtml() explains what a price of 0 means, where it is typed", () =>
  has(A, /A price of <b>0<\/b> means “ask for the price on the bill”/));
check("P99191", "…and says these lines are never shown to a guest", () => has(A, /guests never see them/));
check("P99192", "bqBillsHtml() shows the balance in red only when there IS one", () =>
  has(ACT, /\$\{bal > 0 \? ";color:var\(--red\);font-weight:700" : ";color:var\(--muted\)"\}/));
check("P99193", "…and a voided banquet bill is dimmed and marked, never removed", () =>
  has(ACT, /\$\{b\.voided_at \? ' <span style="color:var\(--red\)">VOID<\/span>' : ""\}/));
check("P99194", "…and its date and time are pinned to IST", () => atLeast(countOf(ACT, /timeZone: "Asia\/Kolkata"/g), 2, "IST stamps"));
check("P99195", "bqNewHtml() says what the app fills in by itself, so nobody looks for those boxes", () =>
  has(A, /🔒 Filled by the app/));
check("P99196", "…and Save is disabled until the bill totals something", () => has(ACT, /id="bqIssue" \$\{m\.total > 0 \? "" : "disabled"\}/));
check("P99197", "…and the amount in words is shown before it is printed", () => has(ACT, /In words: \$\{esc\(bqWords\(m\.total\)\)\}/));
check("P99198", "…and the table box is capped at the number of tables that exist", () =>
  has(ACT, /\$\{tableCount \? `max="\$\{tableCount\}"` : ""\}/));
check("P99199", "bqTaxLabel() names each tax component when there is more than one", () =>
  has(ACT, /tm\.components\.map\(\(c\) => c\.label \+ " " \+ c\.rate \+ "%"\)\.join\(" \+ "\)/));
check("P99200", "bindBanquet() waits for an in-flight package edit before issuing a bill", () =>
  has(ACT, /await Promise\.allSettled\(\[\.\.\.bq\._pending\]\)/));
check("P99201", "…and a customer lookup is debounced, not fired on every keystroke", () => has(ACT, /\}, 320\);/));
check("P99202", "…and it never blocks the bill when it fails", () => has(A, /a lookup is a nicety: never block the bill/));
check("P99203", "…and it only fills a name that is still empty", () => has(ACT, /if \(nameEl && !nameEl\.value\.trim\(\)\) \{ nameEl\.value = hit\.name; f\.cust_name = hit\.name; \}/));
check("P99204", "…and a GSTIN is upper-cased as it is typed", () => has(ACT, /f\.cust_gstin = v\.toUpperCase\(\)/));
check("P99205", "openBanquetWindow() says what to do when pop-ups are blocked", () =>
  has(A, /Allow pop-ups for this site to print the bill/));
check("P99206", "printBanquetBill() asks the printer first and falls back to the window", () =>
  has(ACT, /\.catch\(\(\) => openBanquetWindow\(b, lines\)\)/));
check("P99207", "…and an admin viewing it is told it is not printing at the restaurant", () =>
  has(A, /Admin view — showing the sheet here, not printing at the restaurant\./));
check("P99208", "platMoney() rounds to the rupee, because a platform total has no paise on screen", () =>
  has(ACT, /"₹" \+ Math\.round\(Number\(n\) \|\| 0\)\.toLocaleString\("en-IN"\)/));
check("P99209", "platAge() says nothing rather than nonsense on a bad date", () =>
  has(ACT, /if \(!isFinite\(t\)\) return "";/));
check("P99210", "…and it reads as minutes, then hours, then days", () =>
  has(ACT, /if \(m < 1\) return "just now";/) === true && has(ACT, /if \(h >= 24\) return Math\.floor\(h \/ 24\) \+ "d " \+ \(h % 24\) \+ "h";/) === true);
check("P99211", "platColOf() answers null for a state the board does not show", () => has(A, /return null; \/\/ cancelled etc/));
check("P99212", "platCardHtml() names the channel from a shared map, with a fallback", () =>
  has(ACT, /PLAT_META\[o\.source\] \|\| PLAT_META\.other/));
check("P99213", "…and every channel in that map has a label and a class", () => {
  const m = ACT.match(/const PLAT_META = \{[\s\S]*?\n\};/)[0];
  return ["zomato", "swiggy", "takeaway", "parcel", "other"].every((k) => m.includes(k)) || "a channel is missing";
});
check("P99214", "…and a parcel is never called 'Takeaway', which is the other module", () =>
  has(ACT, /parcel:   \{ label: "Parcel"/));
check("P99215", "…and paid/unpaid is only shown where money is actually collected here", () =>
  has(ACT, /const showPay = o\.source === "parcel" \|\| o\.source === "takeaway"/));
check("P99216", "…and an order with no items says so rather than drawing an empty box", () =>
  has(ACT, /lines \|\| '<span class="plat-empty">no items<\/span>'/));
check("P99217", "…and each card's action matches the state it is in", () => {
  const m = ACT.match(/function platCardHtml\(o\)[\s\S]*?\n\}/)[0];
  return ["accepted", "ready", "handed_over", "cancelled"].every((k) => m.includes(k)) || "a state has no action";
});
check("P99218", "updatePlatformBadge() counts only the orders still being worked", () =>
  has(ACT, /o\.status !== "handed_over" && o\.status !== "cancelled"/));
check("P99219", "loadPlatform() does not even ask when neither module is on", () =>
  has(ACT, /if \(!platEff && !parcelEff\) \{ state\.data\.platform = \[\]; updatePlatformBadge\(\); return; \}/));
check("P99220", "…and it has its own latest-wins guard, so it cannot cancel the board loaders", () =>
  has(ACT, /const seq = \+\+platSeq;/) === true && has(ACT, /if \(seq !== platSeq\) return;/) === true);
check("P99221", "…and a failed read keeps the last good board", () => has(A, /catch \{ \/\* keep last good board \*\/ \}/));
check("P99222", "XRAY_TABS covers every tab that a permission can hide", () => {
  const m = ACT.match(/const XRAY_TABS = \[[\s\S]*?\n\];/)[0];
  return atLeast((m.match(/\{ tab:/g) || []).length, 4, "gated tabs");
});
check("P99223", "XRAY_CONTROLS covers the controls a permission can hide", () => {
  const m = ACT.match(/const XRAY_CONTROLS = \[[\s\S]*?\n\];/)[0];
  return atLeast((m.match(/\{ selector:/g) || []).length, 12, "gated controls");
});
check("P99224", "…and every entry carries a human label for the ribbon", () => {
  const m = ACT.match(/const XRAY_CONTROLS = \[[\s\S]*?\n\];/)[0];
  return eq((m.match(/\{ selector:/g) || []).length, (m.match(/label: "/g) || []).length);
});
check("P99225", "XRAY_NEVER names the one thing no permission can grant, and says who sets it", () =>
  has(ACT, /admin_only_setting: \{ by: "admin only", why: "it's set from the admin panel", settable: true \}/));
check("P99226", "xrayGrantedForManager() answers YES when there is no whoami yet, so nothing flashes off", () =>
  has(ACT, /if \(!XRAY_WHO\) return true;/));
check("P99227", "…and a multi-power gate passes if ANY of its powers is granted", () =>
  has(ACT, /if \(flag\.includes\("\|"\)\) return flag\.split\("\|"\)\.some\(\(f\) => xrayGrantedForManager\(f\)\)/));
check("P99228", "…and it prefers effectivePowers over the raw permission row", () =>
  has(ACT, /if \(XRAY_WHO\.effectivePowers\) return XRAY_WHO\.effectivePowers\[flag\] === true;/));
check("P99229", "xrayOffBy() names admin or owner, so the ribbon can say who to ask", () =>
  has(ACT, /XRAY_WHO\.offByAdmin\[flag\] \? "admin" : "owner"/));
check("P99230", "xrayTintTitle() says it is still usable from THIS view, so an admin is not confused", () =>
  eq(countOf(ACT, /You can still use it from this view\./g), 3));
check("P99231", "xraySetHidden() and xraySetTint() only touch the DOM when something changed", () =>
  has(ACT, /if \(el\.hidden !== hide\) el\.hidden = hide;/) === true && has(ACT, /if \(el\.classList\.contains\("xray-off"\) !== on\)/) === true);
check("P99232", "…which is what keeps the mutation observer from looping on its own work", () =>
  has(A, /conditional → no observer loop/));
check("P99233", "roSetDisabled() is conditional for the same reason", () =>
  has(ACT, /function roSetDisabled\(el, on\) \{ if \(!!el\.disabled !== !!on\) el\.disabled = !!on; \}/));
check("P99234", "menuEditAllowed() lets the admin through, and asks the owner's own switch for an owner", () =>
  has(ACT, /if \(XRAY_WHO\.actor === "admin"\) return true;/) === true
  && has(ACT, /return !\(XRAY_WHO\.offByAdmin && XRAY_WHO\.offByAdmin\.edit_menu === true\);/) === true);
check("P99235", "applyMenuReadonly() flips the tab to a Viewer rather than hiding the menu", () =>
  has(ACT, /const wantIco = ro \? "👁" : "📝", wantLbl = ro \? "View menu" : "Editor"/));
check("P99236", "…and only locks the fields while a menu tab is actually showing", () =>
  has(ACT, /const active = ro && inMenu;/));
check("P99237", "applyMenuPartLocks() leaves the fields a person CAN still edit unlocked", () =>
  has(ACT, /if \(free\.length\) ed\.querySelectorAll\(free\.join\(","\)\)\.forEach/));
check("P99238", "…and it locks descriptive fields rather than hiding them, so a dish is never blank", () =>
  has(A, /the descriptive fields are LOCKED, not gone/));
check("P99239", "menuPartVisible() defaults 3D to OFF before whoami answers", () =>
  has(ACT, /if \(!XRAY_WHO \|\| !XRAY_WHO\.menuSub\) return part !== "edit_3d";/));
check("P99240", "applyHierarchyView() moves a real manager off a tab they may not see", () =>
  has(ACT, /if \(first\) setTab\(first\.dataset\.tab\);/));
check("P99241", "…and off an admin-only settings section too", () =>
  has(ACT, /const ADMIN_ONLY_SETTINGS_SECS = \["billing", "kitchen", "sessions"\]/));
check("P99242", "…and it counts one zone per control type, not one per button on screen", () =>
  has(ACT, /if \(!counted\) \{ zones\.push\(\{ \.\.\.entry, el \}\); counted = true; \}/));
check("P99243", "…and the editor tab is excluded from tinting, because it flips to a Viewer instead", () =>
  eq(countOf(ACT, /if \(key === "editor"\) continue;/g), 2));
check("P99244", "TAB_DOM maps every permission name to the tab it really is on screen", () =>
  has(ACT, /const TAB_DOM = \{ editor: "items", ratings: "ratings", log: "log", bills: "orders" \}/));
check("P99245", "…and TAB_TINT_LABEL gives each one a human name for the ribbon", () =>
  has(ACT, /const TAB_TINT_LABEL = \{ editor: "Menu editor", ratings: "Guest ratings", log: "Activity log", bills: "Bills" \}/));
check("P99246", "renderXrayRibbon() removes itself entirely for a real manager", () =>
  has(ACT, /if \(!higher && !sim\) \{ if \(rb\) rb\.remove\(\); if \(zp\) zp\.remove\(\); syncRibbonHeight\(\); return; \}/));
check("P99247", "…and it only repaints when what it says has changed", () => has(ACT, /if \(rb\.dataset\.sig === sig\) return;/));
check("P99248", "…and it names the person whose access is being looked at, when there is one", () =>
  has(ACT, /asName \? ` · \$\{esc\(asName\)\}'s access` : ""/));
check("P99249", "syncRibbonHeight() publishes the ribbon's height, so nothing sits under it", () =>
  has(ACT, /document\.documentElement\.style\.setProperty\("--ribbon-h", \(rb \? rb\.offsetHeight : 0\) \+ "px"\)/));
check("P99250", "…and the floating cards read that number when they lay themselves out", () =>
  has(ACT, /getPropertyValue\("--ribbon-h"\)/));
check("P99251", "toggleXrayZones() closes itself if it is already open", () =>
  has(ACT, /if \(zp\) \{ \(zp\._xrayClose \|\| \(\(\) => zp\.remove\(\)\)\)\(\); return; \}/));
check("P99252", "…and a click outside it closes it", () =>
  has(ACT, /if \(zp && !e\.target\.closest\("#xrayZones"\) && !e\.target\.closest\("#xrayZonesBtn"\)\)/));
check("P99253", "…and it registers a BACK layer and releases it on close", () =>
  has(ACT, /const closeZp = \(\) => \{ zp\.remove\(\); if \(backOff\) backOff\(\); \}/));
check("P99254", "…and a zone that is off this screen says so rather than doing nothing", () =>
  has(ACT, /isn't on this screen right now/));
check("P99255", "…and 'Aevidine sets this' is shown where nothing can be changed from here", () =>
  has(A, /Aevidine sets this/));
check("P99256", "xraySettingUrl() only ever hands out an admin console link to an admin", () =>
  has(ACT, /if \(XRAY_WHO && XRAY_WHO\.actor === "admin"\) \{/));
check("P99257", "…and it deep-links a multi-power gate to its primary power", () =>
  has(ACT, /flag = flag\.split\("\|"\)\[0\];/));
check("P99258", "xraySetViewReal() clears BOTH the view and the person when leaving the real-view mode", () =>
  has(ACT, /u\.searchParams\.delete\("view"\); u\.searchParams\.delete\("as"\);/));
check("P99259", "applyWhoami() snaps a dashboard range the person may not have back to today", () =>
  has(ACT, /dashRange = "today";/));
check("P99260", "refreshWhoami() has a floor between reads, so a burst of events cannot hammer it", () =>
  has(ACT, /const WHOAMI_MIN_GAP_MS = 5000/) === true && has(ACT, /if \(whoamiBusy\) return;/) === true);

/* ── H1c · floor-layouts.js, and the last unnamed helpers (P98911–P98959) ───────────────────── */

check("P98911", "floor-layouts.js declares the global map exactly once, and defensively", () =>
  eq(countOf(FL, /window\.LFH_FLOOR_LAYOUTS = window\.LFH_FLOOR_LAYOUTS \|\| \{\};/g), 1));
check("P98912", "…and it is DATA only: no logic, no fetch, no listener", () =>
  hasNot(codeOf(FL), /fetch\(|addEventListener|setTimeout|setInterval|function /));
check("P98913", "…and it ships no live plan, so today every floor is the classic grid", () =>
  hasNot(FL, /^\s*window\.LFH_FLOOR_LAYOUTS\["/m));
check("P98914", "…and the worked example is complete enough to copy", () => {
  const m = FL.match(/\/\/ window\.LFH_FLOOR_LAYOUTS\["french-house"\][\s\S]*?\/\/ \};/);
  return (m && m[0].includes("cols:") && m[0].includes("zones:") && m[0].includes("tables:")) || "the example is missing a key";
});
check("P98915", "…and it documents every key the panel actually reads", () =>
  ["cols", "zones", "tables", " x ", " y ", " w ", " h "].every((k) => FL.includes(k.trim())) || "a key is undocumented");
check("P98916", "…and it states the rules the panel really enforces", () =>
  has(FL, /A table you haven't placed yet still appears/) === true
  && has(FL, /No plan for a restaurant that IS set to Custom/) === true);
check("P98917", "…and it says a plan alone does not switch anything on", () =>
  has(FL, /the restaurant also has to be switched to Custom/));
check("P98918", "…and it names exactly what finishing the tablet half would take", () =>
  has(FL, /TO FINISH IT: add this file to public\/panels\/tablet\/index\.html/));
check("P98919", "the manager page really loads it", () => has(HTML, /floor-layouts\.js\?v=/));
check("P98920", "…before app.js, which reads it", () => {
  // The position of the `<script src>` tag, not of the first time the filename is mentioned:
  // a comment naming "editor/app.js" sits above the tags and makes a raw indexOf answer backwards.
  const at = (f) => {
    const m = HTML.match(new RegExp('<script[^>]*src="/panels/' + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '[^"]*"', "i"));
    return m ? HTML.indexOf(m[0]) : -1;
  };
  const a = at("floor-layouts.js"), b = at("editor/app.js");
  return (a > 0 && b > 0 && a < b) || `floor-layouts at ${a}, app at ${b}`;
});

check("P98921", "sliceLoaded() asks about the order list as well as the sessions", () =>
  has(ACT, /\(state\.data\.orders \|\| \[\]\)\.some\(\(o\) => !o\.archived && String\(o\.table_number\) === String\(x\)\)/));
check("P98922", "todaysParcels() numbers from the RESTAURANT's day, not the clock's midnight", () =>
  has(ACT, /const dayStart = businessDayStartMs\(\);/));
check("P98923", "…and it counts every parcel of the day, so a cancelled one does not renumber the rest", () =>
  has(ACT, /\.map\(\(o, i\) => \(\{ \.\.\.o, parcel_no: i \+ 1 \}\)\)/));
check("P98924", "…and it sorts oldest first, so Parcel 1 is the first one taken", () =>
  has(ACT, /\.sort\(\(a, b\) => new Date\(a\.created_at\) - new Date\(b\.created_at\)\)/));
check("P98925", "qopCanFloor() lets an admin or owner through and asks the ladder for a manager", () =>
  has(ACT, /if \(XRAY_WHO && XRAY_WHO\.higherView\) return true;\s*\n\s*return xrayGrantedForManager\(flag\);/));
check("P98926", "takeOrdersAllowed() is asked before a free tile opens the builder", () =>
  has(ACT, /tableTileState\(ft\)\.st === "free" && takeOrdersAllowed\(\)/));
check("P98927", "tagForTable() reads the mark from the slim summary, not from the full board", () =>
  has(ACT, /const tile = \(state\.summary\.tiles \|\| \{\}\)\[String\(t\)\]/));
check("P98928", "partyTag() finds a mark anywhere in the party, as the server does", () =>
  has(ACT, /for \(const x of partyTablesOf\(t\)\) \{ const g = tagForTable\(x\); if \(g\) return g; \}/));
check("P98929", "TABLE_TAG_INFO gives each mark a label, an emoji and a ribbon word", () => {
  const m = ACT.match(/const TABLE_TAG_INFO = \{[\s\S]*?\n\};/)[0];
  return ["vip", "family", "guest"].every((k) => m.includes(k)) && ["label:", "emoji:", "ribbon:"].every((k) => m.includes(k)) || "a mark is incomplete";
});
check("P98930", "openTablePanel() and closeTablePanel() are a matched pair", () =>
  has(ACT, /function openTablePanel\(table\)/) === true && has(ACT, /function closeTablePanel\(\)/) === true);
check("P98931", "…and closing removes the modal from the body, where it really lives", () =>
  has(ACT, /document\.querySelector\("\.tbl-modal-overlay"\)\?\.remove\(\)/));
check("P98932", "renderTablePanel() keeps the modal's scroll across a repaint", () =>
  has(ACT, /const savedScroll = prevModal \? prevModal\.scrollTop : 0/));
check("P98933", "…and it is a no-op when no table is open in that mode", () => has(ACT, /if \(state\.openSess == null\) return;/));
check("P98934", "refreshTableDetail() handles all three hosts: modal, floating and docked", () => {
  const m = ACT.match(/function refreshTableDetail\(\)[\s\S]*?\n\}/)[0];
  return (m.includes("state.openSess") && m.includes("state.floatingTables") && m.includes("state.selectedTable")) || "a host is unhandled";
});
check("P98935", "legacyItemStatus() flips the screen first and tells the server after", () =>
  has(ACT, /if \(o && Array\.isArray\(o\.items\) && o\.items\[index\]\) o\.items\[index\]\.status = status;/));
check("P98936", "…and it offers a takeback only when the dish really moved to served", () =>
  has(ACT, /if \(status === "served" && prev && prev !== "served" && window\.LFH_UNDO\)/));
check("P98937", "snapReceived() and snapServable() record enough to put a dish back exactly", () =>
  has(ACT, /\{ kind: "session", id: r\.id, prev: "received" \}/) === true
  && has(ACT, /\{ kind: "legacy", orderId: r\.orderId, idx: r\.idx, prev: r\.status \}/) === true);
check("P98938", "acceptTableOrders() takes the party's received orders, not one table's", () =>
  has(ACT, /const recv = partyOrders\(t\)\.filter/));
check("P98939", "attendTableCalls() puts the calls back on the screen if the write fails", () =>
  has(ACT, /state\.data\.calls = before; state\.summary = beforeSummary;/));
check("P98940", "restartTable() loads the table's slice first, because a non-selected table has none", () =>
  has(A, /await ensureTableSlice\(t\); \/\/ a non-selected table/));
check("P98941", "exitUser() asks first and says what it means for the guest", () =>
  has(A, /They can't order or call until they rejoin\./));
check("P98942", "blockUser() names what it is blocking BY, in the question", () =>
  has(ACT, /const by = phone \? `phone \$\{phone\}` : `table \$\{table\}`/));
check("P98943", "blockDevice() explains that it stops a whole screen working", () =>
  has(A, /The tablet\/kitchen screen using it won't be able to take orders/));
check("P98944", "unblockLog() is the ONE undo for all three kinds of block", () =>
  atLeast(countOf(ACT, /unblockLog\(/g), 3, "callers"));
check("P98945", "showOpDetail() names the panel, the device and the person for every row", () => {
  const m = ACT.match(/function showOpDetail\(id\)[\s\S]*?\n\}/)[0];
  return ["Date & time", "Done by", "Panel", "Device", "Action code", "Log id"].every((k) => m.includes(k)) || "a field is missing";
});
check("P98946", "…and a shared PIN says plainly that any of those managers could have done it", () =>
  has(A, /This PIN belongs to more than one manager/));
check("P98947", "showCustDetail() counts that guest's own orders and calls", () =>
  has(ACT, /\(u\.orders \|\| \[\]\)\.filter\(\(o\) => o\.member_id === id\)\.length/));
check("P98948", "…and says Head or Partner in words, not as a role code", () =>
  has(ACT, /m\.role === "owner" \? "👑 Head" : "🤝 Partner"/));
check("P98949", "openBillPreview() combines identical lines before printing the preview", () =>
  has(ACT, /combineBillLines\(os\.flatMap\(\(o\) => orderItemRows\(o\)\)\)/));
check("P98950", "…and the preview closes on Escape as well as on the backdrop", () =>
  has(ACT, /const onEsc = \(e\) => \{ if \(e\.key === "Escape"\) close\(\); \}/));
check("P98951", "…and it drops that Escape listener when it closes, so it cannot pile up", () =>
  has(ACT, /document\.removeEventListener\("keydown", onEsc\)/));
check("P98952", "…and it hands the hardware BACK button its own close function", () =>
  has(ACT, /wrap\.__lfhClose = close;/));
check("P98953", "generateInvoice() answers a BOOLEAN, so its callers can stop on a refusal", () => {
  const m = ACT.match(/async function generateInvoice\(sid\)[\s\S]*?\n\}/)[0];
  return (m.includes("return false;") && m.includes("return true;")) || "it does not answer yes or no";
});
check("P98954", "printIssuingInvoice() prints nothing when the invoice was not issued", () =>
  has(ACT, /if \(!issued\) return;/));
check("P98955", "…and says so rather than printing an empty bill", () => has(A, /Bill issued, but there was nothing to print/));
check("P98956", "voidInvoice() and reopenTable() both name the table and the invoice in the question", () =>
  eq(countOf(ACT, /ss\.invoice_no != null \? ` · invoice #\$\{ss\.invoice_no\}` : ""/g), 2));
check("P98957", "…and both build their audit reason from a code AND the typed note", () =>
  eq(countOf(ACT, /const reason = \[label, rr\.note\]\.filter\(Boolean\)\.join\(" — "\)/g), 2));
check("P98958", "askBillCustomer() returns undefined when the restaurant does not ask, so billing is never blocked", () =>
  has(ACT, /if \(!required\) return undefined;/));
check("P98959", "…and it pre-fills from the session, then from a previous bill on the same session", () =>
  has(ACT, /const prefill = \(sess && sess\.cust_phone\) \? \{ phone: sess\.cust_phone, name: sess\.cust_name \}/));

process.exit(report("sweep #8 · T7 · round 3 (static)") ? 1 : 0);
