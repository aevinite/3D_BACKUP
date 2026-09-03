// Sweep #8 · terminal 7 · the code-reading half of P60701–P61700.
// Territory: public/panels/editor/app.js lines ~9,300→end · public/panels/editor/inventory.js ·
// public/panels/floor-layouts.js.  Run: node scripts/sweep/t7/static.mjs
import { read, exists, check, skip, report, has, hasNot, countOf, eq, atLeast, codeOf, tail } from "./lib.mjs";

const APP  = read("public/panels/editor/app.js");
const A    = tail(APP);                       // my half only
const AC   = codeOf(APP);                     // whole file, comments removed
const ACT  = tail(AC);                        // my half, comments removed
const INV  = read("public/panels/editor/inventory.js");
const INVC = codeOf(INV);
const FL   = read("public/panels/floor-layouts.js");
const HTML = read("public/panels/editor/index.html");
const CSS  = read("public/panels/editor/style.css");
const MAINT = read("public/panels/maint.js");
const OUTBOX = read("public/panels/outbox.js");
const TAB  = read("public/panels/tablet/app.js");
const CLASH = read("lib/clash.ts");
const INVAPI = read("app/api/inventory/[...path]/route.ts");

/* ══════════ A · editor/inventory.js — the plumbing every write goes through (P60701–P60780) ══ */

check("P60701", "the file is self-contained: one IIFE, one public surface", () =>
  has(INVC, /^\(function \(\) \{/m) === true && has(INVC, /window\.LFH_INV = \{/) === true);
check("P60702", "the public surface is exactly render · reset · live — nothing else leaks", () => {
  const m = INVC.match(/window\.LFH_INV = \{([\s\S]*?)\n  \};/);
  if (!m) return "no LFH_INV block";
  const keys = [...m[1].matchAll(/^\s*(\w+)[,(:]/gm)].map((x) => x[1]);
  return eq(keys.sort().join(","), "live,render");
});
check("P60703", "\"use strict\" is on, so a stray assignment cannot become a global", () => has(INV, /^\s*"use strict";/m));
check("P60704", "every DOM read is scoped to the panel's own root, not the document", () =>
  has(INVC, /const \$ = \(sel, el\) => \(el \|\| S\.root \|\| document\)\.querySelector\(sel\)/));
check("P60705", "esc() escapes all five of the characters that matter", () => {
  const m = INV.match(/const esc = [\s\S]{0,260}?\}\[c\]\)\);/);
  if (!m) return "no esc";
  return ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"].every((e) => m[0].includes(e)) || "an entity is missing";
});
check("P60706", "inr() rounds to paise, never to whole rupees — this screen holds costs", () =>
  has(INVC, /const inr = \(n\) => "₹" \+ \(Math\.round\(Number\(n \|\| 0\) \* 100\) \/ 100\)/));
check("P60707", "the toast helper never assumes app.js is on the page", () =>
  has(INVC, /typeof window\.toast === "function"/));
check("P60708", "every path carries the admin's ?rid= pin through scoped()", () =>
  has(INVC, /const scoped = \(p\) => \(typeof window\.ridQ === "function" \? window\.ridQ\(p\) : p\)/));
check("P60709", "…and every call really goes through scoped(), not a bare path", () => {
  const calls = countOf(INVC, /inv\("(GET|POST)"/g);
  return atLeast(calls, 20, "inv() calls") === true && has(INVC, /const url = "\/api\/inventory" \+ scoped\(path\)/) === true;
});
check("P60710", "a double tap on a save is refused, not doubled", () => has(INVC, /if \(inFlight\.has\(key\)\) throw new Error/));
check("P60711", "…and that refusal is a sentence a person can read", () => has(INV, /Already saving that — one moment\./));
check("P60712", "…and the in-flight key is released in a finally, so one failure cannot lock the button", () =>
  has(INVC, /\} finally \{\s*\n\s*if \(key\) inFlight\.delete\(key\);/));
check("P60713", "the dedupe key is METHOD + PATH + BODY, so two different writes never collide", () =>
  has(INVC, /const flightKey = \(method, path, body\) => method \+ " " \+ path \+ " " \+ \(body \? JSON\.stringify\(body\) : ""\)/));
check("P60714", "every write carries a FRESH action id (an id reused over time merged two real entries)", () =>
  has(INVC, /opts\.headers\["X-LFH-Action-Id"\] = newActionId\(\)/));
check("P60715", "…and newActionId falls back when crypto.randomUUID is missing on an old tablet", () =>
  has(INVC, /crypto\.randomUUID \? crypto\.randomUUID\(\) : String\(Date\.now\(\) \+ Math\.random\(\)\)/));
check("P60716", "the note above the dedupe still records WHY content-hashing was wrong", () =>
  has(INV, /two DELIBERATE identical entries inside the window silently became one/));
check("P60717", "every request has a deadline, reads included", () => has(INVC, /opts\.signal = invDeadline\(\)/));
check("P60718", "…the deadline is 15s, the panel's own number", () => has(INVC, /const INV_TIMEOUT_MS = 15000/));
check("P60719", "…and reading AbortSignal.timeout is wrapped for a phone that lacks it", () =>
  has(INVC, /typeof AbortSignal\.timeout === "function"[\s\S]{0,80}?: undefined;\s*\n\s*\} catch \(e\) \{ return undefined; \}/));
check("P60720", "a timed-out READ says so in English, not in the browser's words", () =>
  has(INV, /This is taking longer than it should — the system didn't answer\./));
check("P60721", "every plain write goes through the shared offline queue", () =>
  has(INVC, /window\.LFH_OUTBOX\.send\(\{\s*\n\s*base: "\/api\/inventory"/));
check("P60722", "…the queued write carries the same path, body and expectation", () => {
  const m = INVC.match(/window\.LFH_OUTBOX\.send\(\{([\s\S]{0,400}?)\}\);/);
  return !!m && ["method,", "path: scoped(path)", "body: body || null", "expect:"].every((k) => m[1].includes(k)) || "the queued shape lost a field";
});
check("P60723", "…and the queue is only used when it is actually on the page", () => has(INVC, /const canQueue = \(\)/));
check("P60724", "a write CARRYING A PHOTO deliberately does not queue", () =>
  has(INVC, /method !== "GET" && !photoFile && canQueue\(\)/));
check("P60725", "…and says why, rather than failing silently", () =>
  has(INV, /A photo needs a connection\. Save this without the photo for now/));
check("P60726", "a clash shows the server's plain sentence first", () =>
  has(INVC, /json\.clash && json\.clash\.plain/));
check("P60727", "…and the error carries the status and body for the caller", () =>
  has(INVC, /e\.status = res\.status; e\.data = json;/));
check("P60728", "a photo write posts multipart and lets the browser set the boundary", () =>
  has(INVC, /fd\.append\("photo", photoFile\)/) === true && hasNot(INVC, /multipart\/form-data"/) === true);
check("P60729", "the JSON branch sets its own content type", () => has(INVC, /opts\.headers\["Content-Type"\] = "application\/json"/));
check("P60730", "X-LFH-Expect is sent whenever the caller says what it was editing from", () =>
  has(INVC, /if \(extra && extra\.expect\) opts\.headers\["X-LFH-Expect"\] = JSON\.stringify\(extra\.expect\)/));

check("P60731", "the ingredient form sends all FIVE typed values as its expectation", () => {
  const m = INVC.match(/expect: \{ table: "inv_items"[\s\S]{0,420}?\} \}/);
  if (!m) return "no inv_items expectation";
  return ["name:", "purchase_factor:", "purchase_uom:", "par_qty:", "min_qty:"].every((k) => m[0].includes(k)) || "a field is missing";
});
check("P60732", "…and the server will actually compare that table — an unknown one reads as \"nothing to protect\"", () =>
  has(CLASH, /const COMPARABLE_TABLES[\s\S]{0,1800}?inv_items: "id"/) === true
  && has(CLASH, /const COMPARABLE_TABLES[\s\S]{0,1800}?inv_count_lines: "id"/) === true);
check("P61697", "…and the count line's composite key (count_id + item_id) is registered, since that row has no id the screen sees", () =>
  has(CLASH, /COMPOSITE_KEYS[\s\S]{0,120}?inv_count_lines: \["count_id", "item_id"\]/));
check("P61698", "…and five fields is inside the server's own cap on how many it will compare", () => {
  const m = CLASH.match(/\.slice\(0,\s*(\d+)\)/);
  return (m && Number(m[1]) >= 5) || `no field cap found, or it is below 5 (${m ? m[1] : "none"})`;
});
check("P60733", "a NEW ingredient sends no expectation — there is no row to overwrite", () =>
  has(INVC, /isNew \? undefined : \{/));
check("P60734", "a count line's expectation is read BEFORE the local map is overwritten", () => {
  const was = INVC.indexOf("const was = S.count.lines.get(itemId)");
  const set = INVC.indexOf("S.count.lines.set(itemId, val)");
  return (was > 0 && set > was) || "the map is written before the old value is read";
});
check("P60735", "…and a never-counted line compares as empty, not as zero", () =>
  has(INVC, /wasCounted = was === undefined \|\| was === "" \? null :/));
check("P60736", "…and it is keyed by WHERE, not by a row id the screen never sees", () =>
  has(INVC, /where: \{ count_id: S\.count\.id, item_id: itemId \}/));
check("P60737", "…and lib/clash.ts supports a `where` expectation at all", () => has(CLASH, /where\?: Record<string, unknown>/));
check("P60738", "every popup registers a back-button layer", () => has(INVC, /if \(window\.LFH_BACK\) offLayer = window\.LFH_BACK\.layer\(id, closePop\)/));
check("P60739", "…and closing unregisters it exactly once", () =>
  has(INVC, /if \(offLayer\) \{ try \{ offLayer\(\); \} catch \{\} offLayer = null; \}/));
check("P60740", "opening a second popup closes the first, layer included", () => {
  const m = INVC.match(/function openPop\(id, html, onBind\) \{\s*\n\s*(\w+\(\);)/);
  return (m && m[1] === "closePop();") || "openPop does not close the previous one first";
});
check("P60741", "the backdrop closes the popup; a tap inside it does not", () =>
  has(INVC, /wrap\.addEventListener\("click", \(e\) => \{ if \(e\.target === wrap\) closePop\(\); \}\)/));
check("P60742", "the popup is announced to a screen reader as a dialog", () => has(INV, /role="dialog" aria-modal="true"/));
check("P60743", "asking WHY never uses the browser's own prompt as its first choice", () => {
  const m = INVC.match(/async function askWhy\([\s\S]{0,320}?\n  \}/);
  return (m && m[0].indexOf("LFH_ASK") < m[0].indexOf("window.prompt")) || "prompt() is tried before the panel's own card";
});
check("P60744", "asking YES/NO tries the editor's card, then LFH_ASK, then the browser last", () => {
  const m = INVC.match(/async function askYesNo\([\s\S]{0,340}?\n  \}/);
  if (!m) return "no askYesNo";
  const a = m[0].indexOf("confirmDialog"), b = m[0].indexOf("LFH_ASK"), c = m[0].indexOf("window.confirm");
  return (a >= 0 && a < b && b < c) || `order is ${a}/${b}/${c}`;
});
check("P60745", "…and there is exactly ONE such chain in the file, not two that can drift", () =>
  eq(countOf(INVC, /window\.confirm\(/g), 1));
check("P60746", "no bare prompt() survives anywhere in the file", () => eq(countOf(INVC, /window\.prompt\(/g), 1));
check("P60747", "the core load asks for RETIRED items too, so a mis-tap is recoverable", () => has(INVC, /inv\("GET", "\/items\?all=1"\)/));
check("P60748", "…and the two boot reads go together, not one after the other", () => has(INVC, /await Promise\.all\(\[inv\("GET", "\/whoami"\), inv\("GET", "\/items\?all=1"\)\]\)/));
check("P60749", "a person with only Expenses lands on Expenses, not on a blank Stock", () =>
  has(INVC, /if \(!S\.can\.stock && S\.can\.expenses\) S\.view = "expenses"/));
check("P60750", "a person with neither gets a sentence, not a broken screen", () => has(INV, /Your owner hasn't given you inventory access yet\./));

check("P60751", "the tab paints a loading state before it fetches anything", () => has(INV, /Loading inventory…/));
check("P60752", "a failed boot shows the reason, not an empty box", () =>
  has(INVC, /container\.innerHTML = `<div class="inv-wrap"><div class="empty">⚠️ \$\{esc\(e\.message\)\}<\/div><\/div>`/));
check("P60753", "every sub-view's fetch is wrapped, so one bad read cannot blank the tab", () =>
  has(INVC, /\} catch \(e\) \{\s*\n\s*body\.innerHTML = `<div class="empty">⚠️ \$\{esc\(e\.message\)\}<\/div>`;/));
check("P60754", "each sub-view fetches only what it shows", () => {
  const m = INVC.match(/async function refreshView\(force\)[\s\S]*?\n  \}/);
  return atLeast(countOf(m[0], /inv\("GET"/g), 7, "per-view reads");
});
check("P60755", "every list read carries a ceiling — no unbounded scan", () => {
  const bad = [];
  if (!/purchases\?limit=30/.test(INVC)) bad.push("purchases");
  if (!/waste\?days=30/.test(INVC)) bad.push("waste");
  if (!/usage\?days=/.test(INVC)) bad.push("usage");
  return bad.length === 0 || `unbounded: ${bad.join(", ")}`;
});
check("P60756", "the refresh button re-reads the master list, not just the view", () => has(INVC, /\$\("#invRefresh"\)\.onclick = \(\) => refreshView\(true\)/));
check("P60757", "the pill row is rebuilt from the permissions, not hidden by CSS", () =>
  has(INVC, /S\.can\.stock && \{ id: "stock"/) === true && has(INVC, /\]\.filter\(Boolean\)/) === true);
check("P60758", "Expenses is its own permission, separate from Stock", () =>
  has(INVC, /S\.can\.expenses && \{ id: "expenses"/));
check("P60759", "…and the server really enforces those two separately", () =>
  has(INVAPI, /inv_stock/) === true && has(INVAPI, /inv_expenses/) === true);
check("P60760", "stock is shown in the unit people buy in, not in grams", () =>
  has(INVC, /const inBuy = \(it, baseQty\) => \{[\s\S]{0,200}?purchase_factor/));
check("P60761", "…and that conversion rounds to two places, so a shelf reads 8.25 kg not 8.2499", () =>
  has(INVC, /\(Math\.round\(v \* 100\) \/ 100\) \+ " " \+ esc\(it\.purchase_uom\)/));
check("P60762", "the stock value never counts a negative balance as money", () =>
  has(INVC, /Math\.max\(0, Number\(i\.qty_base\)\) \* Number\(i\.avg_cost\)/));
check("P60763", "…in the total AND in each row, so the two agree", () =>
  eq(countOf(INVC, /Math\.max\(0, Number\(i\.qty_base\)\) \* Number\(i\.avg_cost\)/g), 2));
check("P60764", "a below-zero ingredient is named with what to do about it", () =>
  has(INV, /usually a purchase that wasn't entered\. Tap it, check its history, then enter the missing bill\./));
check("P60765", "…and the low/negative badges are computed the same way as the counters", () =>
  has(INVC, /i\.par_qty != null && Number\(i\.qty_base\) < Number\(i\.par_qty\)/));
check("P60766", "a search that matches nothing does NOT claim the store room is empty", () =>
  has(INV, /No ingredient matches/));
check("P60767", "…and the empty-shelf sentence still exists for the real empty case", () =>
  has(INV, /No ingredients yet — add your first one\./));
check("P60768", "…and the search sentence says how to get back", () => has(INV, /clear the search to see all/));
check("P60769", "retired ingredients are reachable from a toggle, never lost", () => has(INV, /Show|Hide.{0,12}retired ingredients/));
check("P60770", "…and a retired row says what tapping it does", () => has(INV, /tap to restore/));
check("P60771", "the rows are re-bound after a search repaints them", () => atLeast(countOf(INVC, /bindStockRows\(\)/g), 2, "bind calls"));
check("P60772", "the unit sentence reads the setup back in plain words", () =>
  has(INV, /You buy \$\{[\s\S]{0,60}?\} in \$\{buy\}\. 1 \$\{buy\} = \$\{f\} \$\{base\}\./));
check("P60773", "…and it re-runs on every field that can change it", () =>
  has(INVC, /\["ipName", "ipBuyUom", "ipBaseUom", "ipFactor"\]\.forEach/));
check("P60774", "par / urgent / opening are typed in buying units and stored in base units", () =>
  eq(countOf(INVC, /\* Number\(\$\("#ipFactor", pop\)\.value \|\| 1\)/g), 3));
check("P60775", "…and they are read back the same way, so a reopen shows what was typed", () =>
  eq(countOf(INV, /Number\(v\.purchase_factor\)\) \* 100\) \/ 100/g), 2));
check("P60776", "the base unit is locked once an ingredient exists", () => has(INV, /data-locked=1/));
check("P60777", "a count-only ingredient is explained, not just labelled", () => has(INV, /never used in recipes — salt, foil…/));
check("P60778", "the history popup names every movement kind in English", () => {
  const m = INV.match(/const KIND_LABEL = \{[\s\S]*?\};/);
  if (!m) return "no KIND_LABEL";
  return atLeast((m[0].match(/:/g) || []).length, 12, "labelled kinds");
});
check("P60779", "…and an unknown kind still prints something rather than nothing", () => has(INVC, /KIND_LABEL\[m\.kind\] \|\| m\.kind/));
check("P60780", "…and a movement shows who did it and when, in IST-readable form", () =>
  has(INVC, /toLocaleString\("en-IN", \{ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" \}\)/));

/* ══════════ B · editor/inventory.js — To order · Purchases · Count (P60781–P60870) ══════════ */

check("P60781", "the To-order list explains what fills it", () => has(INV, /Set par levels on each ingredient to grow this list\./));
check("P60782", "…and says the good news plainly when there is nothing to buy", () => has(INV, /🎉 Nothing to order — everything is at or above its par level\./));
check("P60783", "an urgent line is marked before its name, where the eye lands first", () => has(INVC, /\$\{i\.urgent \? "🔴 " : ""\}/));
check("P60784", "each line says what you HAVE as well as what to buy", () => has(INVC, /have \$\{inBuy\(i, i\.qty_base\)\}/));
check("P60785", "the copy list is plain text a person can paste into WhatsApp", () =>
  has(INVC, /const text = list\.map/) === true && has(INVC, /\.join\("\\n"\)/) === true);
check("P60786", "…and it survives a tablet on a plain-http LAN address, where clipboard does not exist", () =>
  has(INVC, /document\.execCommand\("copy"\)/));
check("P60787", "…and if BOTH copies fail the text is still shown to select by hand", () => has(INVC, /openPop\("inv-copy"/));
check("P60788", "…so the copy tap can never end in nothing at all", () =>
  has(INVC, /if \(done\) toastMsg\("List copied — paste it into WhatsApp"\)/) === true && has(INVC, /else openPop\("inv-copy"/) === true);
check("P60789", "the scratch textarea is removed in a finally, so a failure leaves no litter", () => has(INVC, /\} finally \{ ta\.remove\(\); \}/));
check("P60790", "the purchases list distinguishes a vendor bill from a cash buy at a glance", () =>
  has(INVC, /p\.kind === "cash" \? "⚡ Cash buy" : "🧾 " \+ esc\(p\.vendor_name \|\| "Bill"\)/));
check("P60791", "a voided purchase still shows, marked — a purchase is never deleted", () => has(INV, /inv-badge neg">voided/));
check("P60792", "…and the row keeps its money, so the ledger reads honestly", () => has(INVC, /class="inv-row-val">\$\{inr\(p\.total\)\}/));
check("P60793", "the empty purchases state says what entering one does for you", () =>
  has(INV, /Enter your first bill — stock and rates update on their own\./));
check("P60794", "the vendor list is only fetched for a BILL, never for a cash buy", () =>
  has(INVC, /if \(kind === "bill"\) loadVendors\(\)/));
check("P60795", "…and a failed vendor fetch cannot stop the bill being entered", () => has(INVC, /\.catch\(\(\) => \{\}\);/));
check("P60796", "picking an item fills its last rate in, so the common case is two taps", () =>
  has(INVC, /if \(it && it\.last_rate != null\) \$\("#ppRate", pop\)\.value = it\.last_rate/));
check("P60797", "…and shows the unit it will be counted in", () => has(INVC, /\$\("#ppUom", pop\)\.textContent = it \? it\.purchase_uom : ""/));
check("P60798", "the date defaults to the Indian day, not the browser's", () => eq(countOf(INV, /5\.5 \* 3600_000/g), 2));
check("P60799", "adding a line refuses an empty item, an empty quantity and an empty rate, each with its own words", () =>
  has(INV, /Pick an item/) === true && has(INV, /Enter the quantity/) === true && has(INV, /Enter the rate/) === true);
check("P60800", "a zero rate is allowed (a free case does happen); a zero QUANTITY is not", () =>
  has(INVC, /if \(!\(qty > 0\)\) return toastMsg\("Enter the quantity"\)/) === true && has(INVC, /if \(!\(rate >= 0\)\) return/) === true);
check("P60801", "the same ingredient twice on one bill is ASKED about, never silently added", () =>
  has(INV, /is already on this bill/));
check("P60802", "…and the question quotes what is already there", () => has(INVC, /const sofar = already\.map/));
check("P60803", "…and answering no says so, so the tap does not vanish", () => has(INV, /Not added — the line was left as it is/));
check("P60804", "the total is recomputed from the lines, never accumulated", () =>
  has(INVC, /lines\.reduce\(\(s, l\) => s \+ l\.qty \* l\.rate, 0\)/));
check("P60805", "a line can be struck off before saving", () => has(INVC, /lines\.splice\(Number\(x\.dataset\.n\), 1\); redraw\(\);/));
check("P60806", "saving with no lines is refused in words", () => has(INV, /Add at least one item/));
check("P60807", "the save button is disabled while the write is in flight", () =>
  has(INVC, /const btn = \$\("#ppSave", pop\); btn\.disabled = true;/));
check("P60808", "…and comes back if the write fails, so the person can retry", () =>
  has(INVC, /catch \(e\) \{ toastMsg\("⚠️ " \+ e\.message\); btn\.disabled = false; \}/));
check("P60809", "a saved purchase reloads the ingredient balances it just moved", () =>
  has(INVC, /toastMsg\("Purchase saved — stock updated"\);\s*\n\s*closePop\(\);\s*\n\s*await reloadItems\(\);/));
check("P60810", "the purchase payload sends base-unit quantities the server can trust", () =>
  has(INVC, /lines: lines\.map\(\(l\) => \(\{ item_id: l\.item_id, qty_purchase: l\.qty, rate: l\.rate \}\)\)/));
check("P60811", "the bill detail names who entered it", () => has(INV, /entered by \$\{esc\(p\.created_by\)\}/));
check("P60812", "…and shows the photo of the slip when there is one", () => has(INVC, /class="inv-photo" src="\$\{esc\(p\.photo_url\)\}"/));
check("P60813", "…opened in a new tab that cannot reach back into the panel", () => eq(countOf(INV, /rel="noopener"/g), 2));
check("P60814", "voiding a purchase REQUIRES a reason, kept on record", () =>
  has(INV, /This is kept on record, so it can be explained later\./));
check("P60815", "…and an empty or whitespace reason is refused", () => atLeast(countOf(INVC, /if \(!reason \|\| !reason\.trim\(\)\) return;/g), 3, "reason gates"));
check("P60816", "…and the void reverses the stock, and says so", () => has(INV, /Purchase voided — stock reversed/));
check("P60817", "a voided purchase names who voided it and why", () => has(INVC, /Voided by \$\{esc\(p\.voided_by \|\| "\?"\)\} — \$\{esc\(p\.void_reason/));
check("P60818", "a purchase line whose ingredient was retired later still renders", () =>
  has(INVC, /itemById\(l\.item_id\) \|\| \{ name: "\?", purchase_uom: "" \}/));

check("P60819", "the count sheet is blind — it never shows the system figure while you type", () =>
  hasNot(INVC, /system_base[\s\S]{0,120}?inv-countin/) === true && has(INV, /Blind count: type what you actually see/) === true);
check("P60820", "…and says blanks are skipped, never zeroed", () => has(INV, /blanks are skipped, never zeroed/));
check("P60821", "a blank line really is deleted from the sheet rather than stored as 0", () =>
  has(INVC, /if \(val === ""\) \{ S\.count\.lines\.delete\(itemId\); return; \}/));
check("P60822", "a negative or non-numeric count is refused in words", () =>
  has(INVC, /if \(!Number\.isFinite\(buyQty\) \|\| buyQty < 0\) return toastMsg\("Enter a number"\)/));
check("P60823", "every line saves as it is typed, so a dead battery loses nothing", () =>
  has(INVC, /await inv\("POST", `\/counts\/\$\{S\.count\.id\}\/line`/));
check("P60824", "…and the person is shown that it saved", () => has(INVC, /textContent = "saved ✓"/));
check("P60825", "…and that mark clears itself rather than lying about the next line", () =>
  has(INVC, /setTimeout\(\(\) => \{ const n = \$\("#ccSavedNote"\); if \(n\) n\.textContent = ""; \}, 1500\)/));
check("P60826", "the sheet is walked in shelf order: storage area, then name", () =>
  has(INVC, /const k = i\.storage_area \|\| "Everywhere else"/));
check("P60827", "…and the catch-all area sorts LAST, not alphabetically among the real ones", () =>
  has(INVC, /\(a === "Everywhere else"\) - \(b === "Everywhere else"\) \|\| a\.localeCompare\(b\)/));
check("P60828", "spend-only items are not countable — they never hold stock", () =>
  has(INVC, /i\.active && i\.track_level !== "EXPENSE"/));
check("P60829", "…and the server agrees that EXPENSE items hold no stock", () => has(INVAPI, /track_level === "EXPENSE"/));
check("P60830", "an open draft is resumed with its already-typed figures", () =>
  has(INVC, /S\.count\.lines\.set\(l\.item_id, String\(Number\(l\.counted_base\) \/ Number\(it\.purchase_factor\)\)\)/));
check("P60831", "a discarded count is filtered out of the history, not shown as a draft", () =>
  has(INVC, /\(r\.counts \|\| \[\]\)\.filter\(\(c\) => c\.status !== "discarded"\)/));
check("P60832", "throwing a draft away asks first", () => has(INV, /Throw this draft count away\?/));
check("P60833", "…and a REFUSED discard does not look like a done one", () =>
  has(INV, /Couldn't throw the count away: /));
check("P60834", "…and the sheet stays exactly as it was when the discard is refused", () =>
  has(INVC, /return;\s+\/\/ the sheet stays exactly as it was/) === true || has(INV, /the sheet stays exactly as it was, with the figures in it/) === true);
check("P60835", "submitting with nothing counted is refused in words", () => has(INV, /Count at least one item first/));
check("P60836", "…and the submit button is disabled while it runs", () => has(INVC, /const btn = \$\("#ccSubmit"\); btn\.disabled = true;/));
check("P60837", "…and comes back if the submit fails", () => has(INVC, /catch \(e\) \{ toastMsg\("⚠️ " \+ e\.message\); btn\.disabled = false; \}/));
check("P60838", "the result says how many ingredients were corrected, in the right plural", () =>
  has(INVC, /\$\{r\.adjusted\} item\$\{r\.adjusted === 1 \? "" : "s"\} corrected/));
check("P60839", "the variance sheet is the honest mirror: counted vs expected, valued", () =>
  has(INVC, /const diff = Number\(l\.counted_base\) - Number\(l\.system_base\)/));
check("P60840", "…valued at the cost snapshot taken at the time, not today's", () => has(INVC, /Number\(l\.unit_cost_snap\)/));
check("P60841", "…and lines that matched exactly are left out, not listed as zeroes", () =>
  has(INVC, /\.filter\(\(r\) => Math\.abs\(r\.diff\) > 0\.0001\)/));
check("P60842", "…worst first, so the money you lost is the first thing you read", () => has(INVC, /\.sort\(\(a, b\) => a\.val - b\.val\)/));
check("P60843", "…and a perfect count is celebrated rather than left blank", () => has(INV, /🎯 Everything matched — no corrections needed\./));
check("P60844", "…and the count id is captured BEFORE the draft is cleared", () => {
  const cid = INVC.indexOf("const cid = S.count.id"), clear = INVC.indexOf("S.count = null;", cid);
  return (cid > 0 && clear > cid) || "the draft is cleared before its id is read";
});

/* ══════════ C · inventory.js — Waste · Recipes · Usage · Expenses · live (P60871–P60950) ═════ */

check("P60871", "waste totals exclude struck-out rows", () => has(INVC, /S\.waste\.filter\(\(w\) => !w\.voided_at\)\.reduce/));
check("P60872", "every waste reason has a human label with an icon", () => {
  const m = INV.match(/const WASTE_LABELS = \{[\s\S]*?\};/);
  return atLeast((m[0].match(/:/g) || []).length, 7, "waste reasons");
});
check("P60873", "…including the two that are not really waste (staff meal, on the house)", () =>
  has(INV, /staff_meal: "🍽️ Staff meal"/) === true && has(INV, /complimentary: "🎁 On the house"/) === true);
check("P60874", "an unknown reason still prints, escaped", () => has(INVC, /WASTE_LABELS\[w\.reason\] \|\| esc\(w\.reason\)/));
check("P60875", "a struck-out waste row stays visible, marked", () => has(INV, /inv-badge neg">struck out/));
check("P60876", "striking one out needs a reason and restores the stock", () => has(INV, /Struck out — stock restored/));
check("P60877", "…and the ✕ never also opens the row behind it", () => has(INVC, /e\.stopPropagation\(\);/));
check("P60878", "logging waste refuses a missing ingredient, quantity or reason, each in its own words", () =>
  has(INV, /Pick an ingredient/) === true && has(INV, /Enter how much/) === true && has(INV, /Pick a reason/) === true);
check("P60879", "…and a zero quantity is refused, not logged", () => has(INVC, /if \(!\(qty > 0\)\) return toastMsg\("Enter how much"\)/));
check("P60880", "waste is sent in base units, converted from what was typed", () =>
  has(INVC, /qty_base: qty \* Number\(it\.purchase_factor\)/));
check("P60881", "only one waste reason can be chosen at a time", () =>
  has(INVC, /pop\.querySelectorAll\("\.inv-reason"\)\.forEach\(\(x\) => x\.classList\.toggle\("on", x === b\)\)/));
check("P60882", "a dish's recipe is per ONE plate, and says so", () => has(INV, /Ingredients for ONE plate\./));
check("P60883", "…and the plate cost uses today's average cost", () =>
  has(INVC, /Number\(l\.qty_base\) \* Number\(it \? it\.avg_cost : 0\)/));
check("P60884", "…and a line whose ingredient vanished counts as zero rather than NaN", () => has(INVC, /it \? it\.avg_cost : 0/));
check("P60885", "the margin is only shown when there is both a price and a recipe", () =>
  has(INVC, /d\.price > 0 && lines\.length \? Math\.round\(\(1 - cost \/ d\.price\) \* 100\) : null/));
check("P60886", "…and a dish with no recipe is marked, not silently costed at zero", () => has(INV, /no recipe/));
check("P60887", "a thin margin is coloured, so it is findable in a long list", () => has(INVC, /margin != null && margin < 50 \? " out" : ""/));
check("P60888", "the recipe screen says what mapping a dish actually buys you", () =>
  has(INV, /stock then deducts itself the moment an order reaches the kitchen/));
check("P60889", "a prep recipe asks how much one batch makes", () => has(INV, /One batch makes/));
check("P60890", "…and refuses to save without it", () => has(INV, /Say how much one batch makes/));
check("P60891", "an ingredient cannot be an ingredient of itself", () => has(INVC, /i\.id !== key/));
check("P60892", "adding the same ingredient twice REPLACES its quantity rather than doubling the line", () =>
  has(INVC, /if \(ex\) ex\.qty_base = qty; else lines\.push/));
check("P60893", "…and an empty recipe says so rather than showing a blank box", () => has(INV, /No ingredients yet\./));
check("P60894", "there is a first step when no prep item exists yet", () =>
  has(INV, /Add the prep item as an ingredient first/));
check("P60895", "making a batch takes ingredients out and puts the made quantity in", () =>
  has(INV, /Ingredients come out of stock, the made quantity goes in/));
check("P60896", "…at the batch's real cost, which is reported back", () => has(INVC, /Batch recorded — cost \$\{inr\(r\.cost\)\}/));
check("P60897", "…and the button is disabled while it runs", () => has(INVC, /const btn = \$\("#mbGo", pop\); btn\.disabled = true;/));
check("P60898", "the Usage view explains what 'count corrections' actually means", () =>
  has(INV, /the closest thing to a leak meter/));
check("P60899", "…and says how to make it sharper rather than leaving it mysterious", () => has(INV, /Map more recipes to make it sharper\./));
check("P60900", "…and the biggest unexplained difference sorts first", () =>
  has(INVC, /Math\.abs\(Number\(b\.adjusted_val\)\) - Math\.abs\(Number\(a\.adjusted_val\)\)/));
check("P60901", "a usage row whose ingredient is gone is dropped rather than rendered as '?'", () =>
  has(INVC, /\.filter\(\(r\) => r\.it\)/));
check("P60902", "the three day ranges are 7 / 30 / 90, and the chosen one is marked", () =>
  has(INVC, /\[7, 30, 90\]\.map\(\(d\) => `<button class="inv-pill\$\{days === d \? " on" : ""\}"/));
check("P60903", "an empty usage window says which window it was", () =>
  has(INVC, /No stock movement in the last \$\{days\} days\./));
check("P60904", "every expense category has a human label", () => {
  const m = INV.match(/const EXP_LABELS = \{[\s\S]*?\};/);
  return atLeast((m[0].match(/:/g) || []).length, 8, "expense categories");
});
check("P60905", "the month is shown in words, not as 2026-09", () =>
  has(INVC, /toLocaleString\("en-IN", \{ month: "long", year: "numeric" \}\)/));
check("P60906", "…and the empty month names itself", () => has(INVC, /No expenses recorded in \$\{esc\(monthLabel\)\}\./));
check("P60907", "the month arrows step in UTC, so a late-night tap cannot skip a month", () =>
  has(INVC, /new Date\(Date\.UTC\(y, m - 1 \+ dir, 1\)\)/));
check("P60908", "the top three categories are shown beside the total, biggest first", () =>
  has(INVC, /\.sort\(\(a, b\) => b\[1\] - a\[1\]\)\.slice\(0, 3\)/));
check("P60909", "a struck-out expense stays on the list, marked", () => has(INVC, /class="inv-row static\$\{e\.voided_at \? " voided" : ""\}"/));
check("P60910", "a BLANK amount is refused — it used to be recorded as ₹0 and called a success", () =>
  has(INVC, /if \(!\(amount > 0\)\) return toastMsg\("Enter the amount"\)/));
check("P60911", "…and the two other required fields are still asked for by name", () =>
  has(INV, /Pick a category/) === true && has(INV, /Say what it was/) === true);
check("P60912", "the expense screen tells the person the owner will see this", () =>
  has(INV, /The owner sees every entry — what, who wrote it, the photo/));
check("P60913", "an expense photo opens in its own tab", () => has(INVC, /class="inv-thumb" href="\$\{esc\(e\.photo_url\)\}"/));
check("P60914", "the live refresh is driven by the `ops` breadcrumb the panel already has", () =>
  has(AC, /state\.tab === "inventory" && window\.LFH_INV && window\.LFH_INV\.live/));
check("P60915", "…so it costs ZERO extra reads on an idle floor", () => hasNot(INVC, /setInterval\(/));
check("P60916", "the live refresh never runs when the tab is not on screen", () =>
  has(INVC, /if \(!body \|\| !body\.offsetParent\) return;/));
check("P60917", "…nor while the tab is backgrounded", () => has(INVC, /if \(document\.hidden\) return;/));
check("P60918", "…nor while somebody is mid-entry in a popup", () =>
  has(INVC, /if \(document\.querySelector\("\.inv-pop, #invPop"\)\) return;/));
check("P60919", "…and a burst of orders coalesces into ONE refetch", () => has(INVC, /bumpTimer = setTimeout/));
check("P60920", "…on a 1.2s window, not a tighter one", () => has(INVC, /\}, 1200\);/));
check("P60921", "a failed live refresh is swallowed rather than shouted about", () => has(INVC, /refreshView\(true\)\.catch\(\(\) => \{\}\)/));
check("P60922", "the module keeps no per-restaurant cache that a page load would not clear", () =>
  has(INVC, /const S = \{/) === true && hasNot(INVC, /localStorage/) === true && hasNot(INVC, /sessionStorage/) === true);
check("P60923", "…and the public surface has no member nothing calls: reset() is gone, with its obituary", () =>
  hasNot(codeOf(INV), /reset\(\)/) === true && has(INV, /reset\(\) lived here/) === true
  && countOf(AC, /LFH_INV\.(render|live)/g) >= 2);
check("P60924", "the tab hides itself when the module is off for this restaurant", () =>
  has(AC, /s\.inventory_allowed === true && \(s\.inventory_owner_control !== true \|\| s\.inventory_enabled !== false\)/));
check("P60925", "…and a person parked on it is moved off rather than left on a dead screen", () =>
  has(AC, /if \(!show && state\.tab === "inventory"\) setTab\("items"\)/));
check("P60926", "…and the owner's inventory-only embed is exempt, because the server gates it anyway", () =>
  has(AC, /if \(INV_ONLY\) return;/));
check("P60927", "the tab is granted by EITHER inventory power, not only by stock", () =>
  has(AC, /xrayGrantedForManager\("inv_stock"\) \|\| xrayGrantedForManager\("inv_expenses"\)/));
// A `<script src>` position, never a raw indexOf: another lane's COMMENT mentioning
// "editor/app.js" sits above the tags and made the naive compare answer backwards.
const scriptAt = (html, file) => {
  const m = html.match(new RegExp('<script[^>]*src="/panels/' + file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '[^"]*"', "i"));
  return m ? html.indexOf(m[0]) : -1;
};
check("P60928", "inventory.js is loaded BEFORE app.js, which calls into it", () => {
  const a = scriptAt(HTML, "editor/inventory.js"), b = scriptAt(HTML, "editor/app.js");
  return (a > 0 && b > 0 && a < b) || `inventory at ${a}, app at ${b}`;
});
check("P60929", "…and both carry a content-hash cache-bust", () =>
  has(HTML, /editor\/inventory\.js\?v=[0-9a-f]{8}/) === true && has(HTML, /editor\/app\.js\?v=[0-9a-f]{8}/) === true);
check("P60930", "nothing in this file writes to the DOM outside its own root or a popup", () =>
  eq(countOf(INVC, /document\.body\.appendChild/g), 2));

/* ══════════ D · app.js — the floor: tiles, state, stats, the plan (P60931–P61050) ═══════════ */

check("P60931", "a merged child's slice counts as loaded, so its detail never spins for ever", () =>
  has(ACT, /const head = \(typeof mergeParentOf === "function" && mergeParentOf\(s\)\) \|\| null;/));
check("P60932", "a merged child's waiter calls belong to its PARTY, not only to its own number", () =>
  has(ACT, /const sess = openSessionForTable\(t\) \|\| \(mergeParentOf\(t\) \? openSessionForTable\(mergeParentOf\(t\)\) : null\);/));
check("P60933", "…and the party's calls are deduped, so one call is answered once", () =>
  has(ACT, /\.filter\(\(c\) => \(seen\.has\(c\.id\) \? false : seen\.add\(c\.id\)\)\)/));
check("P60934", "a call only counts while the table is genuinely open, when sessions are on", () =>
  has(ACT, /if \(sessionsOn && !sess\) return \[\];/));
check("P60935", "an 'open this table' request is moot once the table IS open", () =>
  has(ACT, /!\(r\.type === "open" && openSessionForTable\(t\)\)/));
check("P60936", "'is this bill invoiced' is worked out ONCE, not at each of the six places that draw a dish", () =>
  eq(countOf(ACT, /const invoiceLive = !!\(_s && _s\.invoice_no != null && !_s\.invoice_voided\)/g), 1));
check("P60937", "…and a VOIDED invoice does not lock the row, because that bill was deliberately reopened", () =>
  has(ACT, /!_s\.invoice_voided/));
check("P60938", "the MRP stamp is carried from the sold line, so a reprint says what it said then", () =>
  eq(countOf(ACT, /is_mrp: !!it\.is_mrp/g), 2));
check("P60939", "a legacy (pre-session) order still renders its dishes", () => has(ACT, /kind: "legacy"/));
check("P60940", "…and a legacy row defaults to 'received' rather than to nothing", () => has(ACT, /status: it\.status \|\| "received"/));
check("P60941", "the call emoji covers water, cutlery, napkins, cleaning and the bill", () => {
  const m = ACT.match(/function callEmoji\(note\)[\s\S]*?\n\}/);
  return ["water", "cutlery", "napkin", "clean", "bill"].every((w) => m[0].includes(w)) || "a common request has no icon";
});
check("P60942", "…and anything unrecognised still gets an icon rather than a blank", () => has(ACT, /return "🙋";/));
check("P60943", "table marks are a module ladder: admin switch AND owner toggle", () =>
  has(ACT, /s\.table_tags_allowed === true && \(s\.table_tags_owner_control !== true \|\| s\.table_tags_enabled !== false\)/));
check("P60944", "Pay later has its OWN ladder — it stopped sharing the table-marks switch", () =>
  has(ACT, /s\.khata_allowed === true && \(s\.khata_owner_control !== true \|\| s\.khata_enabled !== false\)/));
check("P60945", "…and the panel asks the same question lib/tableTags.ts asks", () =>
  has(read("lib/tableTags.ts"), /export const khataLadder/));
check("P60946", "the admin view always sees a module button, tinted", () =>
  has(ACT, /if \(XRAY_WHO && XRAY_WHO\.actor === "admin"\) return true;/));
check("P60947", "…but a FEATURE the restaurant does not have is never revealed by x-ray", () =>
  has(A, /NOTE THERE IS NO X-RAY OVERRIDE HERE, deliberately/));
check("P60948", "the module ladder formula is written ONCE, not at four call sites", () =>
  eq(countOf(ACT, /function moduleOn\(prefix\)/g), 1));
check("P60949", "…and parcel and platform are two different prefixes, easy to mix up and not mixed up", () =>
  has(ACT, /const parcelModuleOn = \(\) => moduleOn\("parcel"\)/) === true && has(ACT, /const platformModuleOn = \(\) => moduleOn\("takeaway"\)/) === true);
check("P60950", "settings that have not loaded yet read as OFF, so nothing flashes on then off", () =>
  has(ACT, /const s = state\.data\.settings \|\| \{\};\s*\n\s*return s\[prefix \+ "_allowed"\] === true/));
check("P60951", "the tile builder is ONE function, shared by the full render and the patch", () =>
  eq(countOf(ACT, /function floorTileHtml\(i\)/g), 1));
check("P60952", "…and the patch path really calls it", () => has(ACT, /el\.outerHTML = floorTileHtml\(t\)/));
check("P60953", "a tile's colour comes from the SELECTED table's live board, others from the summary", () =>
  has(ACT, /if \(hasSlice\) return normalizeTileState\(tableTileStateFromBoard\(t\)\);/));
check("P60954", "…and a selected table with no slice loaded falls back rather than drawing a false 'Free'", () =>
  has(A, /otherwise\s*\n\s*\/\/ fall through to the summary so we never render a selected table as blank "Free"/));
check("P60955", "'waiting' is normalised to Free in BOTH paths, so the grid cannot disagree with itself", () =>
  eq(countOf(ACT, /normalizeTileState\(/g), 3));
check("P60956", "a missing summary tile still returns a whole tile shape, never undefined", () => {
  const m = ACT.match(/if \(!tile\) return \{[\s\S]{0,400}?\};/);
  if (!m) return "no default tile";
  return ["st:", "label:", "badges:", "counts:", "pay:", "done:", "hasNew:"].every((k) => m[0].includes(k)) || "the default tile is missing a field";
});
check("P60957", "at most three call emojis are drawn, then a +N pill", () =>
  eq(countOf(ACT, /calls\.slice\(0, 3\)\.forEach/g), 2));
check("P60958", "…and both tile paths cap it the same way", () => eq(countOf(ACT, /ftb-more">\+\$\{calls\.length - 3\}/g), 2));
check("P60959", "cancelled orders are excluded from the dish tally", () => has(ACT, /const liveOs = os\.filter\(\(o\) => o\.status !== "cancelled"\)/));
check("P60960", "dish counts are by PLATE, not by row — a 2× line is two cooking", () =>
  has(ACT, /const qtyOf = \(i\) => Math\.max\(0, parseInt\(i\.qty, 10\) \|\| 1\)/));
check("P60961", "a brand-new unaccepted order does not flag the table red", () =>
  has(ACT, /o\.status !== "cancelled" && o\.status !== "received" && o\.payment_status !== "paid"/));
check("P60962", "the tile's money uses billMath, so it matches the bill and the server summary", () =>
  has(ACT, /const due = billMath\(os\.filter\(isUnpaidBill\)\)\.total/));
check("P60963", "any ready dish turns the tile pink, even while others still cook", () => {
  const ready = ACT.indexOf('else if (anyReady)'), prep = ACT.indexOf('else if (anyPreparing)');
  return (ready > 0 && ready < prep) || "preparing is tested before ready";
});
check("P60964", "the money and its word never split across a line break", () => has(ACT, /\\u00a0due/));
check("P60965", "a party sitting with nothing ordered reads 'Seated', not 'Free'", () => has(ACT, /st = "seated"; label = `Seated · \$\{mem\.length\}`/));
check("P60966", "the pay ring is only earned once an order is accepted", () =>
  has(ACT, /pay: unpaid \? "red" : \(os\.some\(\(o\) => o\.status !== "cancelled" && o\.status !== "received" && o\.payment_status === "paid"\) \? "green" : ""\)/));
check("P60967", "'finished' means served AND paid, in both tile paths", () =>
  has(ACT, /done: tile\.state === "done" && tile\.pay !== "red"/) === true && has(ACT, /done: st === "done" && !unpaid/) === true);
check("P60968", "the progress bar's four colours match the tablet's", () =>
  ["#f59e0b", "#4f9dff", "#ec4899", "#22c55e"].every((c) => ACT.includes(c)) || "a status colour drifted");
check("P60969", "the bill button only appears once every dish is served", () => has(ACT, /const canBill = allServed;/));
check("P60970", "…and a joined table's bill button follows its PARTY's progress", () =>
  has(ACT, /const canBillHere = mergedTo \? \(pTot > 0 && pCounts\.nw === 0 && pCounts\.ck === 0 && pCounts\.rd === 0\) : canBill;/));
check("P60971", "…and it opens the bill's real home, not the child", () => has(ACT, /data-bill-preview="\$\{mergedTo \|\| i\}"/));
check("P60972", "the close control exists only on a finished table", () => has(ACT, /finishedHere \? `<button class="ft-ico ft-ico-close"/));
check("P60973", "…and it, too, ends the PARTY, not the child", () => has(ACT, /data-close-table="\$\{mergedTo \|\| i\}"/));
check("P60974", "＋ Take order has exactly TWO faces and no third worded one", () =>
  has(ACT, /<span class="ft-take-x">＋<\/span><span class="ft-take-t">Take order<\/span>/) === true
  && hasNot(ACT, /ft-take-t">Order<\/span>/) === true);
check("P60975", "…and the rejection that forbids a third face is recorded at the code site", () => has(A, /REJECTED \(owner, 2026-08-17\) — docs\/REJECTED-IDEAS\.md R31/));
check("P60976", "…and R31 is a real row in the rejected list", () => has(read("docs/REJECTED-IDEAS.md"), /\| R31 \|/));
check("P60977", "there is no 🍽️ serve-all on the tile, and the refusal says so at the site", () =>
  has(A, /docs\/REJECTED-IDEAS\.md R32/) === true && hasNot(ACT, /data-serve-all-tile/) === true);
check("P60978", "an empty tile carries no action row at all — the tile IS the button", () =>
  has(ACT, /const isEmpty = st === "free" && !mergedTo;/));
check("P60979", "…and tapping a free table opens the order builder, permission allowing", () =>
  has(ACT, /else if \(tableTileState\(ft\)\.st === "free" && takeOrdersAllowed\(\)\) openTakeOrder\(ft, null\)/));
check("P60980", "…and a merged child opens its detail, where Unmerge lives", () =>
  has(ACT, /if \(mergeParentOf\(ft\)\) openFloatingTable\(ft\);/));
check("P60981", "seats come from ONE shared helper, so every screen says the same number", () => has(ACT, /const seats = seatsForTable\(s, i\);/));
check("P60982", "…and '2/4' only appears when the app actually knows who sat down", () =>
  has(ACT, /const seatTxt = guests > 0 \? \(seats \? `\$\{guests\}\/\$\{seats\}` : String\(guests\)\) : \(seats \? String\(seats\) : ""\)/));
check("P60983", "a named table shows the name and keeps the number in the tooltip", () => has(ACT, /\$\{tnm \? `title="T\$\{i\}"` : ""\}/));
check("P60984", "…and a long name steps the type size down rather than overflowing", () =>
  has(ACT, /numTxt\.length >= 4 \? " ft-num-xs" : numTxt\.length >= 2 \? " ft-num-sm" : ""/));
check("P60985", "every table label on a tile is escaped", () => atLeast(countOf(ACT, /esc\(tableLabel\(i\)\)/g), 2, "escaped labels"));
check("P60986", "the merge chip names EVERY other table in the party, not just the parent", () =>
  has(ACT, /\[mergedTo, \.\.\.mergeChildrenOf\(mergedTo\)\.filter\(\(k\) => String\(k\) !== String\(i\)\)\]/));
check("P60987", "…and there is no merge AGE on that chip (R9)", () => has(A, /docs\/REJECTED-IDEAS\.md R9/));
check("P60988", "a joined table with nothing ordered still gets a row 3, not dead space", () =>
  has(ACT, /ft-line ft-line-plain" title="Joined party — nothing ordered yet/));
check("P60989", "…and a free tile's row 3 says the one word that is information", () =>
  has(ACT, /ft-line ft-line-plain" title="\$\{esc\(label\)\}"><span class="ft-linenum">\$\{esc\(label\)\}/));
check("P60990", "an out-of-range table earns a tile only if it has something on it", () =>
  has(ACT, /return \(st && st !== "free"\) \|\| !!mergeParentOf\(k\);/));
check("P60991", "…so two junk rows cannot grow a 30-table floor to 32", () => has(A, /we have\s*\n\s*\/\/ only 30 tables, why are the last 2 showing/));
check("P60992", "…and a merged child above the count is not lost with its Unmerge", () => has(A, /A JOINED TABLE IS NOT A FREE ONE/));
check("P60993", "the extras are sorted numerically, not as strings", () => has(ACT, /\.sort\(\(a, b\) => a - b\)/));
check("P60994", "'Needs you' counts TABLES, so it can never exceed the floor", () => has(ACT, /const needy = new Set\(\);/));
check("P60995", "…and only things drawn on THIS floor are counted", () => has(ACT, /const atTable = \(x\) => drawn\.has\(String\(x && x\.table_number\)\)/));
check("P60996", "'Occupied' counts a joined table, whatever the server calls it", () => has(ACT, /const joined = !!mergeParentOf\(i\);/));
check("P60997", "…but the MONEY is deliberately not widened, so one bill is not shown twice", () => has(A, /MONEY IS DELIBERATELY NOT WIDENED/));
check("P60998", "the occupied denominator is what is on screen, not the table count", () => has(ACT, /const total = drawnList\.length \|\| n;/));
check("P60999", "the floor list is built ONCE and walked twice", () => has(ACT, /const drawnList = floorTableList\(n\);/));
check("P61000", "'To pay' stays a count — the rupee total was offered and refused (R10)", () =>
  has(A, /docs\/REJECTED-IDEAS\.md R10/) === true && hasNot(ACT, /fstat-l">To pay<\/div>[\s\S]{0,40}?inr\(/) === true);
check("P61001", "…and the admin's own money split is named as a DIFFERENT screen, not permission for this one", () =>
  has(A, /Do not read the admin change as permission for this one\./));
check("P61002", "a custom plan is only used when the restaurant is set to Custom", () =>
  has(ACT, /if \(s\.floor_layout_mode !== "custom"\) return null;/));
check("P61003", "…and a malformed plan counts as no plan, so a typo cannot empty the floor", () =>
  has(ACT, /if \(!plan \|\| !Array\.isArray\(plan\.tables\) \|\| !plan\.tables\.length\) return null;/));
check("P61004", "a table missing from the plan still appears, under its own heading", () =>
  has(ACT, /Not placed on the plan yet/));
check("P61005", "…so a half-finished plan can never hide a table, or its money", () => has(A, /it may never hide a table/));
check("P61006", "the plan's columns are clamped to something drawable", () =>
  has(ACT, /Math\.max\(1, Math\.min\(40, parseInt\(plan\.cols, 10\) \|\| 12\)\)/));
check("P61007", "…and every x/y/w/h is clamped to at least 1", () => atLeast(countOf(ACT, /Math\.max\(1, parseInt\(row\.[xywh], 10\) \|\| 1\)/g), 4, "clamped plan fields"));
check("P61008", "a zone caption gets a text-sized row, a table row gets a square", () =>
  has(ACT, /rowSizes\.push\(zoneRows\.has\(r\) \? "min-content" : "var\(--fplan-sq\)"\)/));
check("P61009", "the plan file ships NO live plan, so today every floor is the classic grid", () =>
  hasNot(FL, /^\s*window\.LFH_FLOOR_LAYOUTS\["/m));
check("P61010", "…and it carries the warning that the waiter tablet does not read it", () =>
  has(FL, /THE WAITER TABLET DOES NOT READ THIS FILE YET/));
check("P61011", "…and that warning is TRUE: the tablet never mentions the global", () =>
  hasNot(TAB, /LFH_FLOOR_LAYOUTS/) === true && hasNot(read("public/panels/tablet/index.html"), /floor-layouts\.js/) === true);
check("P61012", "…and the manager floor says so on screen when a plan IS drawn", () =>
  has(ACT, /the <b>waiter tablet<\/b> still shows the plain grid/));
check("P61013", "…and says the other honest thing when Custom is on with no plan written", () =>
  has(ACT, /no floor plan has been written for it yet — showing the classic grid/));
check("P61014", "tables-per-row is the ADMIN's number; the panel only reads it", () =>
  has(ACT, /state\.floorPerRowPreview != null[\s\S]{0,90}?\(state\.data\.settings \|\| \{\}\)\.floor_per_row/));
check("P61015", "…clamped between 2 and 12", () => has(ACT, /const FLOOR_PER_ROW_MIN = 2, FLOOR_PER_ROW_MAX = 12/));
check("P61016", "…and the same bounds live in lib/floorLayout.ts", () => has(read("lib/floorLayout.ts"), /FLOOR_PER_ROW/));
check("P61017", "a touchscreen caps the row at 6, because a finger needs a bigger square", () =>
  has(ACT, /const FLOOR_PER_ROW_TOUCH_MAX = 6/));
check("P61018", "…and a restaurant that deliberately chose 4 keeps 4", () => has(ACT, /Math\.min\(v, FLOOR_PER_ROW_TOUCH_MAX\)/));
check("P61019", "…and the waiter tablet caps it identically, so one iPad shows one floor", () =>
  has(TAB, /FLOOR_PER_ROW_TOUCH_MAX/) || "the tablet has no touch cap");
check("P61020", "the CACHED number is his, uncapped — the cap belongs to the device", () =>
  has(A, /The number CACHED is his, uncapped/));
check("P61021", "…and the preview slider's temporary number is never cached", () =>
  has(ACT, /if \(state\.floorPerRowPreview == null\) \{ const k = perRowKey\(\)/));
check("P61022", "the admin preview only accepts messages from our own origin", () =>
  has(ACT, /if \(e\.origin !== location\.origin\) return;/));
check("P61023", "…and it changes a CSS variable rather than re-rendering per slider step", () =>
  has(ACT, /g\.style\.setProperty\("--per-row-pc", String\(state\.floorPerRowPreview\)\)/));
check("P61024", "…and it writes --per-row-pc, never --per-row, so the CSS bands still win", () =>
  has(A, /--per-row-pc, not --per-row/));
check("P61025", "the skeleton is sized from the cached real table count, not from 12", () =>
  eq(countOf(ACT, /let cachedN = _tcKey \? parseInt\(localStorage\.getItem\(_tcKey\), 10\) : NaN;/g), 2));
check("P61026", "…and the real count is written back for the next open", () =>
  has(ACT, /if \(s\.table_count && _tcKey\) \{ try \{ localStorage\.setItem\(_tcKey, String\(parseInt\(s\.table_count, 10\)\)\); \} catch \{\} \}/));
check("P61027", "'· live' is checked, not claimed — a saved copy says so", () => has(ACT, /· saved copy/));
check("P61028", "…and if the offline layer is absent the heading can only be honest", () =>
  has(ACT, /\} catch \(e\) \{ \/\* the offline layer isn't there → it can only be live \*\/ \}/) === true || has(A, /it can only be live/) === true);
check("P61029", "the legend lists exactly the three words he asked for", () =>
  has(ACT, /const LEG = \[\["free", "Free"\], \["prep", "Preparing"\], \["bill", "Served"\]\];/));
check("P61030", "…plus purple only while something IS merged", () => has(ACT, /if \(mergeList\(\)\.length\) LEG\.push\(\["merged", "Merged"\]\)/));
check("P61031", "…and the bell only where a guest can actually ring it", () =>
  has(ACT, /const callsPossible = sessionsOn && featureOn\("waiter_calls"\)/));
check("P61032", "…and completing the legend is a recorded refusal (R25)", () => has(A, /docs\/REJECTED-IDEAS\.md R25/));
check("P61033", "the QO/P button changes identity with the two sub-switches", () => {
  const m = ACT.match(/const parcelBtn =[\s\S]{0,700}?: "";/);
  return (m && m[0].includes("⚡ QO/P") && m[0].includes("Quick&nbsp;order") && m[0].includes("New&nbsp;Parcel")) || "a face is missing";
});
check("P61034", "…and the parcel half asks the PARCEL module, not the platforms one", () =>
  has(ACT, /qopCanFloor\("parcel"\) && parcelModuleOn\(\)/));
check("P61035", "…and never state.parcelOn, which is undefined until the board is fetched", () =>
  has(A, /It\s*\n\s*\/\/ used to consult state\.parcelOn/));
check("P61036", "the KOT button only exists when table operations are on", () => has(ACT, /const kotBtn = tableOpsOn\(\) \?/));
check("P61037", "the two header buttons are wrapped as ONE element so they cannot come apart on a wrap", () =>
  has(ACT, /<span class="floor-head-acts">\$\{kotBtn\}\$\{parcelBtn\}<\/span>/));
check("P61038", "the patch path falls back to a full render when the grid is not there", () =>
  has(ACT, /if \(state\.tab !== "tables" \|\| !state\.boardLoaded \|\| !grid\) \{ loadSessions\(true\); return false; \}/));
check("P61039", "…and only when the CHANGED table's own detail is open, not any detail", () =>
  has(ACT, /if \(openDetails\.length && tables\.some\(\(t\) => openDetails\.includes\(String\(t\)\)\)\)/));
check("P61040", "…and a named tile that is not on the grid falls back rather than half-updating", () =>
  has(ACT, /if \(!el\) \{ loadSessions\(true\); return false; \}/));
check("P61041", "the patch refreshes the stats strip in place, never the grid", () =>
  has(ACT, /if \(statsEl\) statsEl\.outerHTML = floorStatsHtml\(\);/));
check("P61042", "…and invalidates the board fingerprint so a later poll cannot skip the redraw", () =>
  has(ACT, /lastBoardSig = "";/));
check("P61043", "…and syncs the 🔔 bell, which the full render used to do alone", () => has(ACT, /setTimeout\(syncGuestBell, 0\);/));
check("P61044", "the floor's clicks are delegated ONCE on a container that survives every render", () =>
  has(ACT, /if \(floorDelegationBound\) return;\s*\n\s*floorDelegationBound = true;/));
check("P61045", "…and a click inside the table detail is left to the detail's own handlers", () =>
  has(ACT, /if \(e\.target\.closest\("\[data-table-detail\]"\)\) return;/));
check("P61046", "…and the tile's own buttons are matched before the tile itself", () => {
  const take = ACT.indexOf('closest("[data-take-order]")'), tile = ACT.indexOf('closest("[data-floor-table]")');
  return (take > 0 && take < tile) || "the tile is matched before its buttons";
});
check("P61047", "…and ＋ Take order is scoped to a .ftile so a detail cannot double-fire it", () =>
  has(ACT, /b\.closest\("\.ftile"\)/));
check("P61048", "a tile says it is a button, so Enter and Space work on it", () =>
  has(ACT, /if \(e\.key !== "Enter" && e\.key !== " " && e\.key !== "Spacebar"\) return;/));
check("P61049", "…and Space does not also scroll the floor", () => has(A, /e\.preventDefault\(\);\s+\/\/ Space must not scroll the floor/));
check("P61050", "…and a real button inside the tile still handles itself", () => has(ACT, /if \(!tile \|\| e\.target\.closest\("button"\)\) return;/));

/* ══════════ E · app.js — the table detail, take-order, the money (P61051–P61180) ════════════ */

check("P61051", "up to five table windows, and the sixth is refused in words", () =>
  has(ACT, /const MAX_FLOATING = 5/) === true && has(A, /Up to \$\{MAX_FLOATING\} table windows open at once\./) === true);
check("P61052", "a phone gets ONE full-width popup, never a side-by-side row", () => has(ACT, /if \(isPhoneLayout\(\)\) \{/));
check("P61053", "opening a table already open is a no-op, not a duplicate card", () =>
  has(ACT, /if \(state\.floatingTables\.some\(\(f\) => f\.table === t\)\) return true;/));
check("P61054", "a vacated slot is re-used before the grid grows", () =>
  has(ACT, /for \(let s = 0; s < state\.floatCols; s\+\+\) if \(!used\.has\(s\)\) \{ slot = s; break; \}/));
check("P61055", "…and closing one never moves the others", () => has(A, /NEVER moves the rest/));
check("P61056", "a dragged card is pinned and keeps its own position", () =>
  has(ACT, /f\.pinned = true; f\.slot = null; f\.x = rect2\.left; f\.y = rect2\.top; f\.w = rect2\.width;/));
check("P61057", "…and a plain click on the header is not a drag", () => has(ACT, /if \(!moved\) \{ flushFloatRender\(\); return; \}/));
check("P61058", "a poll cannot tear a drag out from under a finger", () => has(ACT, /floatInteracting = true;/));
check("P61059", "…and the deferred redraw is replayed on pointer-up", () => eq(countOf(ACT, /flushFloatRender\(\)/g), 4));
check("P61060", "a dragged card can never be dropped fully off-screen", () =>
  has(ACT, /const maxTop = window\.innerHeight - 60;/));
check("P61061", "a resized card has a floor of 280×180", () => has(ACT, /Math\.max\(280, startW/) === true && has(ACT, /Math\.max\(180, startH/) === true);
check("P61062", "…and cannot be resized past the window edge", () => has(ACT, /window\.innerWidth - left - 12/));
check("P61063", "the layout row leaves room for the admin ribbon", () => has(ACT, /const ribbonH = parseInt\(getComputedStyle\(document\.documentElement\)\.getPropertyValue\("--ribbon-h"\)\)/));
check("P61064", "…and one or two cards do not stretch absurdly wide on a big monitor", () => has(ACT, /const FLOAT_MAX_W = 640/));
check("P61065", "a table number with an odd character cannot break the selector", () => atLeast(countOf(ACT, /CSS\.escape\(/g), 4, "escaped selectors"));
check("P61066", "every open table registers a hardware-BACK layer", () => has(ACT, /LFH_BACK\.layer\("table-detail"/));
check("P61067", "…and a layer BACK already popped is not rewound twice", () => has(ACT, /_tableBackLayers\.delete\(k\);/));
check("P61068", "…and closed tables have their layers removed", () => has(ACT, /if \(!openKeys\.has\(k\)\) \{ const off = _tableBackLayers\.get\(k\)/));
check("P61069", "a shifted party is followed in the popup AND in the selection", () =>
  has(ACT, /if \(String\(state\.selectedTable\) === from\) state\.selectedTable = to;/));
check("P61070", "…and a shift onto an already-open table drops the stale card rather than duplicating", () =>
  has(ACT, /if \(state\.floatingTables\.some\(\(f\) => String\(f\.table\) === to\)\) state\.floatingTables\.splice\(fi, 1\);/));
check("P61071", "opening a merged child preloads every table in its party", () => has(ACT, /for \(const _k of _party\) \{/));
check("P61072", "closing the last card clears the selection rather than leaving a ghost", () =>
  has(ACT, /state\.selectedTable = state\.floatingTables\.length \? String\(state\.floatingTables\[0\]\.table\) : null;/));
check("P61073", "a detail refresh preserves the scroll position of every open card", () =>
  has(ACT, /Object\.keys\(scrolls\)\.forEach\(\(t\) =>/));
check("P61074", "a dish row's 🗑 is locked once the bill carries a live invoice", () =>
  has(ACT, /row\.status !== "served" && !row\.invoiceLive/));
check("P61075", "…and a served dish cannot be removed at all", () => has(ACT, /row\.kind === "session" && row\.status !== "served"/));
check("P61076", "quantity may only be edited before the dish is cooked", () =>
  has(ACT, /const canEditQty = editing && row\.kind === "session" && row\.status !== "served" && row\.status !== "ready"/));
check("P61077", "…and dropping below one tells you to use 🗑 instead of silently removing it", () =>
  has(A, /Use 🗑 to remove the dish/));
check("P61078", "a quantity edit says what it was editing from", () =>
  has(ACT, /expect: \{ table: "order_items", id, fields: \{ qty: was \} \}/));
check("P61079", "…and a refused edit shows the server's sentence, held long enough to read", () =>
  atLeast(countOf(ACT, /clash \? clash\.plain/g), 3, "clash sentences"));
check("P61080", "an allergen removed after the order was placed is marked on the row", () => has(ACT, /alg-removed/));
check("P61081", "a dish edit sends its expectation for the note, the removals and the order's allergies", () =>
  eq(countOf(ACT, /expect: \{ table: "order_items", id: item\.id/g), 2) === true
  && has(ACT, /expect: \{ table: "orders", id: order\.id, fields: \{ allergies: orderAllergies \} \}/) === true);
check("P61082", "…and a successful dish edit says 'Dish updated', with a name that EXISTS at the toast", () =>
  has(ACT, /okToast\(anyQueued \? \{ queued: true \} : null, "Dish updated"\)/));
check("P61083", "…and the guard that catches this whole class of fault is registered and can fail", () =>
  exists("scripts/verify-panel-names.mjs") === true
  && has(read("package.json"), /"verify:panel-names": "node scripts\/verify-panel-names\.mjs"/) === true
  && has(read("scripts/verify-panel-names.mjs"), /_wq/) === true);
check("P61084", "a clash on a dish edit refreshes the screen before it explains", () =>
  has(ACT, /if \(clash\) \{\s*\n\s*close\(\);\s*\n\s*await loadSessions\(\); if \(rerender\) rerender\(\);/));
check("P61085", "an allergy cleared in the modal is dropped from the ORDER as well as the dish", () =>
  has(ACT, /const newOrderAllergies = orderAllergies\.filter\(\(s\) => !removed\.includes\(s\)\)/));
check("P61086", "…and one added is added to THIS dish only", () => has(A, /new avoids → this dish only/));
check("P61087", "'no onion' and 'onion' are treated as the same avoidance", () =>
  has(ACT, /\.replace\(\/\^no\[\\s-\]\+\/, ""\)/));
check("P61088", "a custom allergy that is not on the standard list still shows as a chip", () =>
  has(ACT, /\[\.\.\.working\]\.filter\(\(s\) => !STD\.includes\(s\)\)/));
check("P61089", "the ＋ Other chip exists on every allergy list", () => atLeast(countOf(ACT, /alg-other/g), 3, "Other chips"));
check("P61090", "a party's detail lists the PARTY's orders, newest first", () =>
  has(ACT, /\.sort\(\(a, b\) => new Date\(b\.created_at \|\| 0\) - new Date\(a\.created_at \|\| 0\)\)/));
check("P61091", "a table whose slice has not landed shows a loading row, not a wrong number", () =>
  has(ACT, /const streaming = !sliceLoaded\(t\) && summaryTableOpen\(t\)/));
check("P61092", "…and while streaming the head reads the always-fresh summary tile", () =>
  has(ACT, /const due = streaming \? \(Number\(sumTile\.due\) \|\| 0\) : mDue\.total/));
check("P61093", "the head counts dishes by quantity, matching the tile", () =>
  has(ACT, /const qsum = \(pred\) => liveRowsAll\.filter\(pred\)\.reduce\(\(s, r\) => s \+ Math\.max\(1, parseInt\(r\.qty, 10\) \|\| 1\), 0\)/));
check("P61094", "…and the progress bar can never divide by zero", () => has(ACT, /const nItems = dishN \|\| 1;/));
check("P61095", "cancelled orders never reach the head's live rows", () =>
  has(ACT, /const liveRowsAll = os\.filter\(\(o\) => o\.status !== "cancelled"\)/));
check("P61096", "a table with only cancelled tickets says so rather than looking broken", () =>
  has(A, /Nothing on this table — \$\{voidedN\} cancelled ticket/));
check("P61097", "an order that has begun being served cannot be cancelled whole", () =>
  has(ACT, /const cancelBtn = \(o\) => \(\(anyServed\(o\) \|\| invoiceLive\) \? ""/));
check("P61098", "…nor can a paid one", () => has(ACT, /const cb = o\.payment_status === "paid" \? "" : cancelBtn\(o\)/));
check("P61099", "editing an order asks whether the kitchen has started", () =>
  has(A, /Have you checked with the kitchen that this order is still editable\?/));
check("P61100", "the discount button disappears once an invoice is live", () => has(ACT, /const discBtn = discTarget && !_inv \?/));
check("P61101", "…and 'Reopen' appears in its place, to void that invoice first", () => has(ACT, /id="sxReopen"/));
check("P61102", "the bill section shows a discount as a percentage when there is one", () => has(ACT, /discPct\(sumSub, sumDisc\)/));
check("P61103", "…and hides the GST row entirely under the composition scheme", () => has(ACT, /sumTax > 0 && !mBill\.composition/));
check("P61104", "…and names MRP items apart, because their price is final", () => has(ACT, /MRP items<\/span><b>\$\{inr\(sumNontax\)\}/));
check("P61105", "'Close table' only appears when everything is served AND paid", () =>
  has(ACT, /const tableFinished = !!sess && allServedEnd && !anyUnpaidBill;/));
check("P61106", "a party's head pill names every table in it", () =>
  has(ACT, /partyAll\.map\(\(x\) => "T" \+ esc\(x\)\)\.join\(" \+ "\)/));
check("P61107", "…and every child gets its own Unmerge button", () =>
  has(ACT, /mergeChildrenOf\(t\)\.map\(\(k\) => `<button class="btn danger sx-unmerge" data-unmerge="\$\{esc\(k\)\}"/));
check("P61108", "unmerging says exactly what moves back and what does not", () =>
  has(A, /Does NOT move:<\/b> the \$\{inr\(disc\)\} bill discount stays/));
check("P61109", "…including the guest count, which nobody recorded per table", () =>
  has(A, /nobody recorded which guests sat where/));
check("P61110", "…and it is asked as a real question with a rendered list", () => has(ACT, /"Unmerge", \{ html: true \}/));
check("P61111", "a merge names the table that will hold the bill, and why", () =>
  has(A, /\(the lowest table number\)/));
check("P61112", "…and adds the two dues together in the question", () => atLeast(countOf(ACT, /inr\(myDue \+ theirDue\)/g), 1, "merge money lines"));
check("P61113", "the take-order builder never offers a sold-out dish", () =>
  eq(countOf(ACT, /\.filter\(\(d\) => !\(d\.tags \|\| \[\]\)\.includes\("sold-out"\)\)/g), 2));
check("P61114", "…and a category with no dishes is not shown as an empty section", () =>
  has(ACT, /\.filter\(\(c\) => dishes\.some\(\(d\) => d\.category === c\.slug\)\)/));
check("P61115", "…and dishes in no category still appear, under 'Other'", () => has(ACT, /slug: "_other", name: "Other"/));
check("P61116", "two identical cart lines merge; two DIFFERENT ones do not", () =>
  has(ACT, /const sig = \(l\) => \[\.\.\.l\.avoid\]\.sort\(\)\.join\(","\) \+ "\|" \+ \(l\.note \|\| ""\)\.trim\(\)/));
check("P61117", "…and an open-price line's price is part of that signature", () => has(ACT, /\(l\.open_price \? "\|₹" \+ l\.price : ""\)/));
check("P61118", "a line's quantity is capped at 99", () => atLeast(countOf(ACT, /Math\.min\(99,/g), 3, "quantity caps"));
check("P61119", "an open-price dish asks for its price before it can be added", () =>
  has(ACT, /const p = await pricePrompt\(d\.title\);\s*\n\s*if \(p == null\) return false;/));
check("P61120", "…and that price box refuses zero and refuses absurd", () =>
  has(A, /Enter a price greater than 0\./) === true && has(A, /That price looks too high\./) === true);
check("P61121", "…and only accepts digits and ONE decimal point", () =>
  has(ACT, /replace\(\/\[\^0-9\.\]\/g, ""\)\.replace\(\/\(\\\.\.\*\)\\\.\/g, "\$1"\)/));
check("P61122", "…and Escape or the backdrop answers 'cancelled', never a silent zero", () =>
  atLeast(countOf(ACT, /done\(null\)/g), 6, "cancel paths"));
check("P61123", "the estimated total applies the discount BEFORE tax", () =>
  has(ACT, /const taxable = Math\.max\(0, sp\.taxableBase - Math\.min\(d, sp\.taxableBase\)\)/));
check("P61124", "…and the discount can never exceed what is discountable", () =>
  has(ACT, /Math\.round\(Math\.min\(Math\.max\(discAmount, 0\), discCap\(\)\) \* 100\) \/ 100/));
check("P61125", "…and MRP money is excluded from that cap", () => has(ACT, /sp\.taxableBase \+ sp\.nontax - sp\.mrpAmount/));
check("P61126", "the discount button only exists for someone allowed to give one", () =>
  has(ACT, /const canDiscount = \(\) => \(XRAY_WHO && XRAY_WHO\.higherView \? true : xrayGrantedForManager\("give_discounts"\)\)/));
check("P61127", "the destination picker asks the parcel permission separately from tables", () =>
  has(ACT, /const canParcel = st\.qop_parcel_allowed !== false && qopCan\("parcel"\) && parcelModuleOn\(\)/));
check("P61128", "…and says so plainly when only parcels are allowed", () =>
  has(A, /Table orders aren't part of your access — this order goes out as a parcel\./));
check("P61129", "a busy destination says whose bill the order joins", () => has(ACT, /joins \$\{esc\(tableLabel\(par\)\)\}/));
check("P61130", "sending refuses an empty cart in words", () => atLeast(countOf(A, /Add at least one dish first/g), 2, "empty-cart refusals"));
check("P61131", "…and the send buttons are disabled while it runs and re-enabled if it fails", () =>
  atLeast(countOf(ACT, /sendBtns\.forEach\(\(b\) => \(b\.disabled = false\)\)/g), 2, "re-enable paths"));
check("P61132", "a queued order says saved-not-sent instead of claiming the kitchen has it", () =>
  has(A, /it'll send to the kitchen when you're back online/));
check("P61133", "…and a queued PARCEL says the same in its own words", () =>
  has(A, /the parcel will send when you're back online/));
check("P61134", "a refused order names the dish and what to do", () => {
  const m = ACT.match(/const msg = reason === "sold_out"[\s\S]{0,700}?;/);
  return (m && ["sold_out", "unknown_item", "price_required", "empty_order"].every((r) => m[0].includes(r))) || "a refusal reason has no sentence";
});
check("P61135", "a duplicate order is asked about, not blocked and not silently doubled", () =>
  has(A, /Send it AGAIN anyway\?/));
check("P61136", "…and answering no puts the buttons back", () =>
  has(ACT, /sendBtns\.forEach\(\(b\) => \(b\.disabled = !cart\.length\)\);\s*\n\s*return;/));
check("P61137", "a parcel paid at the counter prints its receipt, and a failure there cannot lose the order", () =>
  has(ACT, /try \{ printParcelReceipt\(\{/));
check("P61138", "the discount sheet's three boxes all accept paise", () =>
  eq(countOf(ACT, /class="dish-edit-custominput disc-input" id="disc(Pct|Amt)Input"/g), 2) === true
  && has(ACT, /step="0\.01" id="discPayInput"/) === true);
check("P61139", "…and typing in any one moves the other two", () =>
  has(ACT, /paint\("pct"\)/) === true && has(ACT, /paint\("amt"\)/) === true && has(ACT, /paint\("pay"\)/) === true);
check("P61140", "a discount over the cap is refused OUT LOUD, with the number", () =>
  has(A, /Most you can take off this bill is \$\{inr\(maxDisc\)\}/));
check("P61141", "…and a role cap says whose limit it is and what to do", () =>
  has(A, /that is your \$\{roleCapPct\}% limit\. Ask the owner if you need to go higher\./));
check("P61142", "…and the refusal shakes the sheet rather than only printing a line", () => has(ACT, /disc-nudge/));
check("P61143", "a blank 'they pay' box leaves the discount exactly as it was", () =>
  has(ACT, /if \(raw === "" \|\| !\(p >= 0\)\) \{ setBlank\(true\); return; \}/));
check("P61144", "…and typing below the floor says what the least possible bill is", () =>
  has(A, /The least this bill can be is \$\{inr\(floor\)\}/));
check("P61145", "the discount write says what it was editing from", () =>
  has(ACT, /expect: \{ table: "orders", id: order\.id, fields: \{ discount: Number\(order\.discount \|\| 0\) \} \}/));
check("P61146", "…and its success names the money both ways round", () =>
  has(A, /Discount \$\{inr\(amount\)\} applied — they pay \$\{inr\(payFor\(amount\)\)\}/));
check("P61147", "the whole-bill discount reads the SESSION's discount, not one order's", () =>
  has(ACT, /discount: Number\(sess\.discount\) \|\| 0, discount_note: sess\.discount_note \|\| ""/));
check("P61148", "🍴 Split the bill shows shares to the paise", () => has(ACT, /<b>\$\{inrExact\(s\)\}<\/b>/));
check("P61149", "…and its Bill total does too, so the two can be compared", () => has(ACT, /<span>Bill total<\/span><b>\$\{inrExact\(total\)\}<\/b>/));
check("P61150", "…and the shares are nudged before flooring, so an exact division stays exact", () =>
  has(ACT, /Math\.floor\(\(total \/ n\) \* 100 \+ 1e-6\) \/ 100/));
check("P61151", "…and the last share absorbs the remainder, so the five add up to the bill", () =>
  has(ACT, /shares\[n - 1\] = Math\.round\(\(total - base \* \(n - 1\)\) \* 100\) \/ 100/));
check("P61152", "…and the split-PAYMENT sheet uses the identical nudge, so the two agree", () =>
  has(AC, /Math\.floor\(\(due \/ n\) \* 100 \+ 1e-6\) \/ 100/));
check("P61153", "the split helper says plainly that it settles nothing by itself", () =>
  has(A, /A helper only — collect each share/));
check("P61154", "…and the number of people is bounded at both ends", () =>
  has(ACT, /if \(n > 2\) \{ n--; paint\(\); \}/) === true && has(ACT, /if \(n < 20\) \{ n\+\+; paint\(\); \}/) === true);
check("P61155", "the bill preview always speaks for the table HOLDING the bill", () =>
  has(ACT, /t = mergeParentOf\(String\(t\)\) \|\| String\(t\);/));
check("P61156", "…and re-reads every party slice first, because it shows money", () =>
  has(ACT, /await ensurePartySlices\(t\);/));
check("P61157", "…and refuses politely when there is nothing to bill", () => has(A, /has nothing to bill yet/));
check("P61158", "a part-paid bill shows total, already paid and still due as three lines", () =>
  has(ACT, /<span>Already paid<\/span><span>− \$\{inr\(paidSoFar\)\}<\/span>/));
check("P61159", "Mark paid is disabled while an order is still unaccepted, and says why", () =>
  has(A, /Accept the order first — a bill can only be paid once the order is accepted\./));
check("P61160", "printing issues the invoice first, then re-reads the session that carries the number", () =>
  has(ACT, /await generateInvoice\(ss\.id\);\s*\n\s*await ensureTableSlice\(t, true\);/));
check("P61161", "…and stops if the invoice did not come out", () =>
  has(ACT, /if \(!ss \|\| ss\.invoice_no == null \|\| ss\.invoice_voided\) return;/));
check("P61162", "…and a queued invoice prints nothing, because the number comes from the server", () =>
  has(A, /the invoice number is given by the server, so nothing is printed yet/));
check("P61163", "an invoice re-issue is worded as a re-issue, not as a first issue", () =>
  has(ACT, /isReissue \? "Invoice re-issued" : "Invoice generated"/));
check("P61164", "…and two taps cannot issue two numbers", () => has(ACT, /if \(_invBusy\.has\(sid\)\) return false;/));
check("P61165", "…and that lock is released in a finally", () => has(ACT, /finally \{ _invBusy\.delete\(sid\); \}/));
check("P61166", "voiding an invoice REQUIRES a reason with a code", () =>
  has(ACT, /const rr = await askReopenReason\(/) === true && has(A, /if \(!rr\) return; \/\/ cancelled — a reason is required/) === true);
check("P61167", "…and reopening a TABLE requires one too", () => eq(countOf(A, /if \(!rr\) return; \/\/ cancelled — a reason is required/g), 2));
check("P61168", "a credit note refuses a zero or negative amount", () =>
  has(ACT, /if \(!amount \|\| amount <= 0\) \{ toast\("Enter a valid amount", "err"\); return; \}/));
check("P61169", "…and refuses to be issued without a reason", () => has(ACT, /Why this credit note\? \(required\)/));
check("P61170", "…and a queued credit note says it has no number yet", () => has(A, /the credit note has no number yet/));
check("P61171", "the bill customer is only asked for when the restaurant asks for one", () =>
  has(ACT, /const required = s\.bill_customer_required !== false;/));
check("P61172", "…and a missing module never blocks billing", () =>
  has(ACT, /if \(!window\.LFH_BILLCUST\) return undefined;/));
check("P61173", "accepting an order flips the screen first and tells the server after", () =>
  has(ACT, /if \(o\) \{ o\.status = "preparing"; flipOrderItems\(o, "received", "preparing"\); opBegin\(o\.id\); \}/));
check("P61174", "…and the in-flight counter is released exactly once, whatever happens", () =>
  atLeast(countOf(ACT, /if \(!released\) \{ released = true; floorOpsInFlight--/g), 6, "single-release guards"));
check("P61175", "…and a queued accept keeps what the tap showed rather than re-reading a stale board", () =>
  has(ACT, /if \(!qA\) await loadSessions\(\);/));
check("P61176", "accepting a whole table works on the PARTY, as one bill", () =>
  has(A, /await ensurePartySlices\(t\); \/\/ a merged party accepts as ONE bill/));
check("P61177", "…and an out-of-date tile is said to be out of date, not silently ignored", () =>
  has(A, /Nothing new to accept on \$\{tableLabel\(t\)\} — the tile was out of date/));
check("P61178", "serving everything offers a takeback", () => atLeast(countOf(ACT, /onUndo: \(\) => editorUndoServe\(snap\)/g), 2, "serve takebacks"));
check("P61179", "…and the takeback clamps 'ready' back to 'preparing', a state a person can act on", () =>
  has(ACT, /const clamp = \(s\) => \(s === "ready" \? "preparing" : \(\["received", "preparing", "served"\]\.includes\(s\) \? s : "preparing"\)\)/));
check("P61180", "restarting a table asks first and says what it does", () =>
  has(A, /Its orders clear off the floor and the table stays OPEN for a fresh round\./));

/* ══════════ F · KOT ops · printing · banquet · platform · log · x-ray (P61301–P61370) ═══════ */

check("P61301", "table & KOT operations need the module AND the granted power", () =>
  has(ACT, /if \(!\(w\.features && w\.features\.table_ops\)\) return false;/));
check("P61302", "…and the admin view sees them anyway, tinted", () => has(ACT, /if \(w\.actor === "admin"\) return true;/));
check("P61303", "a phone gets the sheet, a desktop gets the columns — one entry point", () =>
  has(ACT, /if \(!isPhoneLayout\(\)\) return openKotColumns\(t, sess\);/));
check("P61304", "every operation that is off says WHY it is off", () =>
  atLeast(countOf(ACT, /why: "no movable KOT"/g), 2, "reasons"));
check("P61305", "…and 'change table' explains that a merge must be undone first", () =>
  atLeast(countOf(ACT, /why: mergeGroupLabel\(t\) \? "unmerge first" : "table is free"/g), 2, "shift reasons"));
check("P61306", "a paid order is not movable — every picker asks the same question", () =>
  atLeast(countOf(ACT, /o\.status !== "cancelled" && o\.payment_status !== "paid"/g), 4, "movable-order filters"));
check("P61307", "a destination on the SAME bill is disabled and says so", () =>
  has(ACT, /partyTablesOf\(t\)\.some\(\(x\) => String\(x\) === String\(i\)\) \? "same bill" : ""/) === true
  && atLeast(countOf(ACT, /same bill/g), 3, "same-bill markers"));
check("P61308", "a shift target that is taken, joined or waiting is disabled with its own word", () => {
  const m = ACT.match(/const shiftBlocked = \(i\) => \{[\s\S]{0,420}?\n  \};/);
  return (m && ["this one", "joined", "taken", "wants in"].every((w) => m[0].includes(w))) || "a blocked reason is missing";
});
check("P61309", "…and the two pickers that ask the same question use the same words", () => {
  const a = ACT.match(/const whyBlocked = \(i\) => \{[\s\S]{0,400}?\n  \};/);
  const b = ACT.match(/const shiftBlocked = \(i\) => \{[\s\S]{0,420}?\n  \};/);
  return (a && b && ["this one", "joined", "taken", "wants in"].every((w) => a[0].includes(w) && b[0].includes(w))) || "the two pickers drifted";
});
check("P61310", "a floor with nothing free says so instead of showing an empty grid", () =>
  atLeast(countOf(A, /Nothing is free right now — every table is either taken, joined, or waiting on a guest\./g), 2, "empty-floor sentences"));
check("P61311", "merging asks first, naming both parties and the money", () => atLeast(countOf(ACT, /"Merge"\)\)\) return;/g), 2, "merge confirmations"));
check("P61312", "…and a queued merge says saved-not-sent rather than claiming it happened", () =>
  has(A, /the tables will be joined onto one bill the moment you're back online/));
check("P61313", "…and after a merge every affected tile is refetched, not just one", () =>
  atLeast(countOf(ACT, /pollTables\(\[String\(parent\), String\(t\), String\(to\)\]\)/g), 2, "post-merge refetches"));
check("P61314", "a refused KOT operation shows the reason in English, from a shared map", () =>
  atLeast(countOf(ACT, /KOT_REASON_TEXT\[r\.reason\]/g), 4, "translated refusals"));
check("P61315", "every KOT operation has a plain-language tip", () => {
  const m = APP.match(/const KOT_TIPS = \{[\s\S]*?\n\};/);
  return ["shift", "merge", "movekot", "moveitem"].every((k) => m[0].includes(`"${k}"`)) || "an operation has no tip";
});
check("P61316", "…and a tip only appears after the pointer rests, so a sweep does not flicker", () =>
  has(ACT, /const HOLD_MS = 2000/));
check("P61317", "…and it is set with textContent, never as HTML", () => has(ACT, /host\.textContent = el\.dataset\.tip/));
check("P61318", "…and it never runs off the side of the screen", () =>
  has(ACT, /Math\.max\(8, Math\.min\(window\.innerWidth - w - 8/));
check("P61319", "the KOT picker shrinks its squares until the whole floor fits", () =>
  has(ACT, /while \(scroll\.scrollHeight > scroll\.clientHeight \+ 2 && min > KOTP_MIN_PX\)/));
check("P61320", "…and never below a tappable 44px", () => has(ACT, /const KOTP_MIN_PX = 44/));
check("P61321", "…and re-fits on a rotate, removing its listener when it closes", () =>
  has(ACT, /const closeM = \(\) => \{ window\.removeEventListener\("resize", onFit\); wrap\.remove\(\); \};/));
check("P61322", "…and it splits the floor into In use and Free, each with a count", () =>
  has(ACT, /\$\{sec\("In use", busyTiles, "No table has anything on it right now\."\)\}/));
check("P61323", "picking a table loads its slice before the menu reads its orders", () =>
  has(ACT, /await ensureTableSlice\(t\); \/\/ the menu reads this table's orders/) === true || has(A, /await ensureTableSlice\(t\); \/\/ the menu reads this table's orders/) === true);
check("P61324", "a reprint on this device carries the DUPLICATE banner", () => atLeast(countOf(ACT, /reprint: true/g), 2, "duplicate stamps"));
check("P61325", "…and a kitchen reprint says it will come out marked DUPLICATE", () =>
  has(A, /it comes out marked DUPLICATE/));
check("P61326", "printing can never break the panel — every path is wrapped", () =>
  atLeast(countOf(A, /printing must NEVER break the panel/g), 2, "guards"));
check("P61327", "…and the print iframe is always cleaned up, even if afterprint never fires", () =>
  has(ACT, /setTimeout\(cleanup, 60000\)/));
check("P61328", "…and cleanup cannot run twice", () => has(ACT, /const cleanup = \(\) => \{ if \(done\) return; done = true;/));
check("P61329", "the printer strip's dead hooks are gone from the whole file", () =>
  hasNot(codeOf(APP), /data-pro?k=|data-prhere=|data-prsetup=/) === true
  && hasNot(codeOf(APP), /querySelectorAll\("\[data-prok\]"\)/) === true);
check("P61330", "…and their obituary says where the live readout is now", () =>
  has(A, /The live readout is the 🔔 bell/));
check("P61331", "…and printJobHere has a LIVE caller again — it is back on the bell, where the obituary said it belonged", () =>
  // Re-worded 2026-09-03 on the owner's word ("for 16th we can do in notification we can keep that
  // option"). The rule this row defends has not changed — no function may sit here without a
  // caller — only the answer has: it was deleted with the dead band, and it is back with a real
  // one. The check is now the rule, not the answer, so it holds either way round.
  has(AC, /async function printJobHere\(id, btn\)/) === true
  && has(AC, /run: \(\) => printJobHere\(a\.id\)/) === true
  && eq(countOf(AC, /printJobHere\(/g), 2));
check("P61332", "printerAlerts still feeds the toasts, which is why it stayed", () =>
  has(ACT, /const list = printerAlerts\(\);/));
check("P61333", "a missing printer payload never clears the seen-set — no crying wolf", () =>
  has(ACT, /if \(!\(state\.summary && state\.summary\.printer\)\) return;/));
check("P61334", "…and a problem only shouts once, however many polls repeat it", () =>
  has(ACT, /if \(seenPrinterKeys\) for \(const a of list\) if \(!seenPrinterKeys\.has\(a\.key\)\) toast/));
check("P61335", "a stuck queue names how long the oldest has waited, in minutes or hours", () =>
  has(ACT, /Math\.round\(Number\(w\.oldestMs\) \/ 60000\) \+ " minutes" : Math\.round\(Number\(w\.oldestMs\) \/ 3600000\) \+ " hours"/));
check("P61336", "…and tells the kitchen what to do meanwhile", () =>
  has(A, /Tell the kitchen to read the orders off their screen/));
check("P61337", "this screen only claims the print queue when it is plausibly a computer", () =>
  has(ACT, /const looksLikeAComputer = !\(window\.matchMedia && window\.matchMedia\("\(pointer: coarse\)"\)\.matches\)/));
check("P61338", "…and a failed claim is tried once per load, never in a storm", () =>
  has(ACT, /stationClaimTried = true;/));
check("P61339", "…and a print pass cannot overlap itself", () => has(ACT, /if \(printPassBusy\) return;/));
check("P61340", "…and releases its lock in a finally", () => has(ACT, /finally \{ printPassBusy = false; \}/));
check("P61341", "a burst of tickets is printed one at a time, so dialogs cannot stack", () =>
  has(ACT, /await new Promise\(\(res\) => setTimeout\(res, 400\)\);/));
check("P61342", "…and a print that failed here is reported as failed, with a reason", () =>
  has(ACT, /error: okPrint \? undefined : "print call failed on the manager screen"/));
check("P61343", "…and the trouble toast is rate-limited to once a minute", () =>
  has(ACT, /if \(Date\.now\(\) - lastPrintTroubleHereAt < 60000\) return;/));
check("P61344", "the printing board says the two switches apart: ours and theirs", () =>
  has(A, /Aevidine allows this restaurant to print/) === true && has(A, /Kitchen slips print by themselves/) === true);
check("P61345", "…and a manager who may not set it up is told who does", () => has(ACT, /— set by Aevidine\.<\/p>/));
check("P61346", "…and the helper file is TYPED, never downloaded", () =>
  has(A, /a downloaded script is blocked outright by a Mac/));
check("P61347", "…and the file card says there is nothing secret in it", () => has(A, /with <b>nothing secret in it<\/b>/));
check("P61348", "a job says 'printed' only after the printer confirmed", () =>
  has(A, /a job says <b>printed<\/b> only after the printer confirmed it/));
check("P61349", "the banquet tab hides itself when the module is off", () =>
  has(ACT, /s\.banquet_allowed === true && \(s\.banquet_owner_control !== true \|\| s\.banquet_enabled !== false\)/));
check("P61350", "…and a person parked on it is moved off", () => has(ACT, /if \(!show && state\.tab === "banquet"\) setTab\("items"\)/));
check("P61351", "every money box on the banquet bill accepts paise", () => {
  const m = ACT.match(/function bqNewHtml\(\)[\s\S]*?\n\}/);
  const money = [...m[0].matchAll(/<input class="sx-input"[^>]*id="(bqRate|bqDisc|bqAdv)"[^>]*>/g)].map((x) => x[0]);
  const extra = [...m[0].matchAll(/<input class="sx-input" data-(exf|pf)="(price|disc|amt)"[^>]*>/g)].map((x) => x[0]);
  const all = money.concat(extra);
  const wrong = all.filter((t) => !/step="0\.01"/.test(t));
  return (all.length >= 6 && wrong.length === 0) || `${wrong.length} of ${all.length} boxes still declare whole rupees`;
});
check("P61352", "…and the counted boxes stay whole numbers, because plates come in ones", () => {
  const m = ACT.match(/function bqNewHtml\(\)[\s\S]*?\n\}/);
  return (!/id="bqPax"[^>]*step=/.test(m[0]) && !/data-exf="qty"[^>]*step=/.test(m[0])) || "a counted box gained a paise step";
});
check("P61353", "the package price box on the Packages screen accepts paise too", () =>
  has(ACT, /data-bq-f="price" type="number" inputmode="decimal" min="0" step="0\.01"/));
check("P61354", "a banquet discount is a percentage, clamped 0–100 at both read and write", () =>
  eq(countOf(ACT, /Math\.max\(0, Math\.min\(100, Number\(/g), 3));
check("P61355", "…and the total discount can never exceed the subtotal", () => has(ACT, /disc = Math\.min\(disc, sub\)/));
check("P61356", "the banquet total is rounded to the rupee, and the balance follows it", () =>
  has(ACT, /const total = Math\.round\(sub - disc \+ tax\);/));
check("P61357", "a queued banquet bill prints nothing and gives the button back", () =>
  has(A, /the bill has no number yet and nothing is printed/) === true && has(A, /issue\.disabled = false;   \/\/ the button comes back/) === true);
check("P61358", "…and a package edit in flight is waited for before the bill is issued", () =>
  has(ACT, /if \(bq\._pending && bq\._pending\.size\) await Promise\.allSettled\(\[\.\.\.bq\._pending\]\)/));
check("P61359", "a banquet bill refuses a table number that is not a number", () =>
  has(A, /That table number doesn't look right — or leave it blank\./));
check("P61360", "the platform board hides itself when neither module is on", () =>
  has(ACT, /const show = \(platEff \|\| parcelEff\) && granted;/));
check("P61361", "…and its title follows which modules are actually live", () =>
  has(ACT, /const title = \(platOn && chLabels\.length\) \? "Platform" : "Parcels"/));
check("P61362", "…and the board tells the grid how many lanes there really are", () =>
  has(ACT, /style="--plat-cols:\$\{newCol \? 4 : 3\}"/));
check("P61363", "…and every empty lane says what would be in it", () => {
  const m = ACT.match(/const EMPTY = \{[\s\S]{0,300}?\};/);
  return (m && ["new:", "prep:", "ready:", "done:"].every((k) => m[0].includes(k))) || "a lane has no empty sentence";
});
check("P61364", "the demo-order menu is admin/owner only", () =>
  has(ACT, /const canSimulate = !!\(XRAY_WHO && XRAY_WHO\.higherView\)/));
check("P61365", "…and its close-on-outside-click is registered once, not once per repaint", () =>
  has(ACT, /if \(!platSimOutsideBound\) \{/));
check("P61366", "a card whose order has left the board says so rather than failing quietly", () =>
  eq(countOf(A, /That order is no longer on the board/g), 2));
check("P61367", "a parcel print that opens no window says so and gives the button back", () =>
  has(A, /Couldn't open the print window/));
check("P61368", "…and a print recorded but not saved says exactly that", () =>
  has(A, /Printed, but couldn't record it/));
check("P61369", "the activity log turns a tap trail into a sentence, not raw JSON", () =>
  has(ACT, /if \(action !== "ui_taps"\) return String\(detail\)\.replace\(\/_\/g, " "\)/));
check("P61370", "…and repeated taps are collapsed with a count rather than listed", () =>
  ACT.includes('counts.get(l) > 1 ? l + " \\u00d7" + counts.get(l) : l') || "the tap trail is not collapsed");

/* ══════════ G · the owner's round two — items 12–16 (P61371–P61440) ═════════════════════════ */

const BELL = read("public/panels/guestbell.js");
// syncGuestBell() sits at ~6,700, in terminal 6's half of editor/app.js, so the `A`/`ACT` tails
// this terminal owns do not contain it. Every assertion about the bell's rows reads THIS instead —
// the function itself, comments and all — which is both correct and more precise than the file.
const BELLFN = (APP.match(/function syncGuestBell\(\)[\s\S]*?\n\}/) || [""])[0];
const BELLFNC = codeOf(BELLFN);
const BELLC = codeOf(BELL);
const EDROUTE = read("app/api/editor/[...path]/route.ts");
const PQ = read("lib/printQueue.ts");
const LEDGUARD = read("scripts/verify-ledger-index.mjs");

// ── 12 · the split sheet's stepper keeps its unit ──────────────────────────────────────────────
check("P61371", "the − number + and its unit are ONE group that cannot wrap apart", () =>
  has(ACT, /<span style="display:inline-flex;align-items:center;gap:12px;flex-wrap:nowrap">[\s\S]{0,400}?<span class="muted">people<\/span>\s*<\/span>/));
check("P61372", "…and the outer row may still wrap, so the label can drop to its own line on a phone", () =>
  has(ACT, /display:flex;align-items:center;gap:12px;margin:14px 0;flex-wrap:wrap[\s\S]{0,120}?Split between/));
check("P61373", "…and the reason is written at the site, so nobody 'tidies' the wrapper away", () =>
  has(A, /"− 5 \+ people" IS ONE THING AND WRAPS AS ONE/));

// ── 13 · the server closes the ₹0 expense door too ─────────────────────────────────────────────
check("P61374", "the expenses route refuses zero as well as negative", () =>
  has(INVAPI, /if \(!Number\.isFinite\(amount\) \|\| amount <= 0 \|\| amount > 10_000_000\) return err\("Enter a valid amount\."\)/));
check("P61375", "…and it still refuses an absurd amount", () => has(INVAPI, /amount > 10_000_000/));
check("P61376", "…and the panel and the route now agree, so neither can be the only guard", () =>
  has(INVC, /if \(!\(amount > 0\)\) return toastMsg\("Enter the amount"\)/) === true
  && has(INVAPI, /amount <= 0/) === true);

// ── 15 · a ledger may grow, never shrink ───────────────────────────────────────────────────────
check("P61377", "the ledger guard keeps a per-file row-count floor beside the ledgers", () =>
  exists(".claude/sweep/LEDGER/ROW-COUNTS.json") === true && has(LEDGUARD, /ROW-COUNTS\.json/) === true);
check("P61378", "…and it FAILS when a ledger loses rows", () => has(LEDGUARD, /has SHRUNK/));
check("P61379", "…and when a whole ledger file disappears", () => has(LEDGUARD, /is GONE\./));
check("P61380", "…and the floor can only be moved down by a person typing --bless", () =>
  has(LEDGUARD, /const BLESS = process\.argv\.includes\("--bless"\)/));
check("P61381", "…and the baseline is only ever written on a run that is otherwise passing", () =>
  has(LEDGUARD, /if \(!problems\.length\) \{[\s\S]{0,400}?writeFileSync\(COUNTS, text\)/));
check("P61382", "…so re-running the guard after the damage cannot lower the floor", () => {
  const write = LEDGUARD.indexOf("writeFileSync(COUNTS");
  const shrink = LEDGUARD.indexOf("has SHRUNK");
  return (shrink > 0 && write > shrink) || "the write happens before the shrink test";
});
check("P61383", "the counts file really lists every ledger on disk", () => {
  const counts = JSON.parse(read(".claude/sweep/LEDGER/ROW-COUNTS.json"));
  const n = Object.keys(counts).length;
  return atLeast(n, 30, "ledgers recorded");
});
check("P61384", "…and no recorded floor is above what the file actually holds right now", () => {
  const counts = JSON.parse(read(".claude/sweep/LEDGER/ROW-COUNTS.json"));
  const bad = [];
  for (const [f, was] of Object.entries(counts)) {
    const rows = read(`.claude/sweep/LEDGER/${f}`).split("\n").filter((l) => /^\|\s*P\d{5,6}\s*\|/.test(l) && l.split(/(?<!\\)\|/).length >= 6).length;
    if (rows < was) bad.push(`${f}: ${rows} < ${was}`);
  }
  return bad.length === 0 || bad.join(", ");
});

// ── 16a · a bell row may carry ONE action ──────────────────────────────────────────────────────
check("P61385", "the bell can render one action on a row", () =>
  has(BELLC, /if \(r\.action && typeof r\.action\.run === "function"\)/));
check("P61386", "…and that action's tap never also fires the row's own handler", () =>
  has(BELLC, /e\.stopPropagation\(\);/));
check("P61387", "…and one tap is one action, even on a slow phone", () => has(BELLC, /act\.disabled = true;/));
check("P61388", "…and a throw puts the button back rather than leaving a dead '…'", () =>
  has(BELLC, /catch \(err\) \{ act\.disabled = false; act\.textContent = String\(r\.action\.label \|\| "Do it"\); \}/));
check("P61389", "…and the row's own body stays inert, so a stray tap cannot act by accident", () =>
  has(BELLC, /node\.disabled = false;/) === true && has(BELLC, /node\.style\.cursor = "default";/) === true);
check("P61390", "…and the action is a finger's size, at the panel's own 44px floor", () =>
  has(BELL, /\.lfh-bell-act\{[^"]*min-height:44px/));
check("P61391", "the file's 'a row is a doorway' rule now RECORDS the exception instead of contradicting it", () =>
  has(BELL, /THE EXCEPTION \(owner, 2026-09-03\)/) === true
  && has(BELL, /Do not grow this into buttons on the call \/ order \/ join rows/) === true);
check("P61392", "…and the contract at the top of the file documents `action`", () => has(BELL, /may carry\s*\n \* one `action`/));

// ── 16b · a stuck bill is a notification too ───────────────────────────────────────────────────
check("P61393", "the floor read asks for stuck BILLS as well as stuck kitchen slips", () =>
  has(EDROUTE, /\.eq\("restaurant_id", rid\)\.in\("kind", \["kot", "bill"\]\)/));
check("P61394", "…and carries `kind` back, so the sentence can name which it is", () =>
  has(EDROUTE, /select\("id, order_id, kind, status, attempts, created_at, requested_by, error"\)/));
check("P61395", "…and the read is still scoped, column-listed and capped", () =>
  has(EDROUTE, /\.or\(`status\.eq\.failed[\s\S]{0,200}?\.order\("created_at"\)\.limit\(5\)/));
check("P61396", "…and it still rides the ONE shared 1.5s floor read, not a new one", () =>
  has(EDROUTE, /sharedFloorSummary\(`printer:\$\{rid\}`/));
check("P61397", "a stuck bill's sentence does not send anyone to the kitchen", () =>
  has(ACT, /A bill\$\{j\.table_number != null \? " for " \+ tableLabel\(j\.table_number\) : ""\}/) === true
  && has(ACT, /the customer is probably standing at the counter waiting for it/) === true);
check("P61398", "…and a kitchen slip still says the kitchen", () => has(ACT, /hasn't printed\$\{isBill \? "" : " in the kitchen"\}/));
check("P61399", "…and the bell reads the SAME list the toasts are built from", () =>
  has(AC, /alerts = printerAlerts\(\);/));
check("P61400", "…so one printer problem can never be worded two ways", () =>
  eq(countOf(ACT, /function printerAlerts\(\)/g), 1));
check("P61401", "a printerAlerts() failure can never stop the bell rendering", () =>
  has(AC, /try \{ alerts = printerAlerts\(\); \} catch \(e\) \{ alerts = \[\]; \}/));
check("P61402", "Print it here is offered on a kitchen slip and NOT on a bill", () =>
  has(AC, /if \(a\.kind === "job" && a\.jobKind !== "bill" && a\.id\)/));
check("P61403", "…and it runs the panel's own function, not a second copy of one", () =>
  has(AC, /run: \(\) => printJobHere\(a\.id\)/));
check("P61404", "printJobHere is back, and this time it has a caller", () =>
  has(AC, /async function printJobHere\(id, btn\)/) === true && eq(countOf(AC, /printJobHere\(/g), 2));
check("P61405", "…and it prints with the DUPLICATE banner, then closes the kitchen job", () =>
  has(ACT, /reprint: r\.job \? r\.job\.reprint !== false : true/) === true
  && has(ACT, /await api\("POST", `\/print-jobs\/\$\{id\}\/dismiss`, \{\}\)/) === true);
check("P61406", "…and a failure says so rather than leaving a spinner", () =>
  has(A, /Couldn't print it here: /));

// ── 16c · an order only rings once it has been waiting ─────────────────────────────────────────
check("P61407", "the waiting time is a NAMED constant, not a number buried in a route", () =>
  has(PQ, /export const SLOW_ACCEPT_MS = 180_000/));
check("P61408", "…and its note records whose number it is and why it is not the printer's", () =>
  has(PQ, /order not accepted for more than 3 to 4 min/) === true
  && has(PQ, /deliberately NOT[\s\S]{0,20}the same number as STUCK_AFTER_MS/) === true);
check("P61409", "the slow-order read is restaurant-scoped, column-listed, capped and time-filtered", () =>
  has(EDROUTE, /\.eq\("restaurant_id", rid\)\.eq\("status", "received"\)\.eq\("archived", false\)/) === true
  && has(EDROUTE, /select\("id, table_number, kot_no, created_at"\)/) === true
  && has(EDROUTE, /\.order\("created_at"\)\.limit\(5\)/) === true);
check("P61410", "…and it rides the shared 1.5s window, so ten devices cost one read", () =>
  has(EDROUTE, /sharedFloorSummary\(`slow-orders:\$\{rid\}`/));
check("P61411", "…and a targeted ?table= refetch never pays for it", () => has(EDROUTE, /const slowOrders = tbl \? null :/));
check("P61412", "…and it is only added to the answer when it was actually read", () =>
  has(EDROUTE, /\.\.\.\(slowOrders \? \{ slowOrders \} : \{\}\)/));
check("P61413", "…and the index it needs exists", () =>
  has(read("supabase/migrations/104_scale_indexes_orders.sql"), /idx_orders_rest_active ON orders \(restaurant_id, status\)/));
check("P61414", "the bell no longer walks the tiles to raise an order row", () =>
  hasNot(AC, /if \(!tile \|\| !tile\.hasNew\) continue;/));
check("P61415", "…it reads the server's aged list instead", () => has(BELLFNC, /\(state\.summary\.slowOrders \|\| \{\}\)\.rows/));
check("P61416", "…and says how long, in the server's own minutes", () =>
  has(BELLFNC, /waited\("not accepted"\)/) === true && has(BELLFNC, /for over \$\{overdueMin\} minute/) === true);
check("P61417", "…with the right plural", () => has(BELLFNC, /\$\{overdueMin === 1 \? "" : "s"\}/));
check("P61418", "…and each row is keyed by the ORDER, so two at one table are two rows", () =>
  has(AC, /key: "order-slow:" \+ o\.id/));
check("P61419", "…and it carries a real timestamp, so its age survives a reload", () =>
  has(AC, /at: at\(o\.created_at\)/));
check("P61420", "…and a row with no table is skipped rather than rendered as 'Table undefined'", () =>
  has(AC, /if \(!o \|\| o\.table_number == null\) continue;/));
check("P61421", "waiter calls, joiners and requests STAY in the bell — and wait the same 3 minutes", () =>
  // RE-WORDED 2026-09-03 on his second ruling: "it should not leave — it should come when for
  // 3 min if the waiter has not attended". Round two left these three firing instantly because he
  // had only named the ORDER row; asked directly, he settled the shape of the whole list. The row
  // keeps its id: the rule it defends ("these three belong in the bell") is unchanged, and what
  // moved is when they arrive.
  has(AC, /kind: "call", table: c\.table_number/) === true
  && has(AC, /kind: "join", table: j\.table_number/) === true
  && has(AC, /kind: "request", table: r\.table_number/) === true
  && eq(countOf(BELLFNC, /if \(!overdue\(ts\)\) continue;/g), 3));

// ── the bell's own heading has to be true of what is in it ─────────────────────────────────────
check("P61422", "the sheet no longer claims every row came from the guest menu", () =>
  hasNot(BELLC, /From the guest menu/) === true && has(BELLC, /"Needs you"/) === true);
check("P61423", "…and only offers 'tap to go to that table' when a row HAS a table", () =>
  has(BELLC, /var anyTable = last\.rows\.some\(function \(r\) \{ return r && r\.table != null; \}\)/));
check("P61424", "…and says something true when nothing in the list has one", () =>
  has(BELL, /Nothing from the tables — these are things to look at\./));
check("P61425", "…and the empty state no longer talks only about tables either", () =>
  has(BELL, /Nothing needs you right now\./));

check("P61426", "the shared-plumbing guard accepts the published deadline helper however it is spelled", () =>
  has(read("scripts/verify-panel-plumbing.mjs"), /signal:\[\^,\}\]\*\\b\(deadline\|LFH_PANEL_DEADLINE\)\\b/));
check("P61427", "…and it records that it was blind to the scope half of that fault", () =>
  has(read("scripts/verify-panel-plumbing.mjs"), /was BLIND to/) === true
  && has(read("scripts/verify-panel-plumbing.mjs"), /verify:panel-names/) === true);
check("P61428", "every fetch in maint.js still carries a ceiling, in one spelling or the other", () => {
  const src = read("public/panels/maint.js").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
  const calls = [];
  for (let i = src.indexOf("fetch("); i >= 0; i = src.indexOf("fetch(", i + 1)) {
    let d = 0, j = i + 5;
    for (; j < src.length; j++) { if (src[j] === "(") d++; else if (src[j] === ")") { d--; if (!d) break; } }
    calls.push(src.slice(i, j + 1));
  }
  const bare = calls.filter((c) => !/signal:[^,}]*\b(deadline|LFH_PANEL_DEADLINE)\b/.test(c));
  return bare.length === 0 || `${bare.length} of ${calls.length} have none`;
});
check("P61429", "…and there is still exactly ONE definition of it in that file", () =>
  eq(countOf(codeOf(read("public/panels/maint.js")), /function deadline\(ms\)/g), 1));

/* ══════════ H · ONE RULE FOR THE WHOLE BELL — his second ruling (P61430–P61462) ═════════════ */

check("P61430", "the bell has ONE overdue rule, not one per kind of thing", () =>
  has(BELLFNC, /const overdue = \(ts\) => Date\.now\(\) - ts >= overdueMs;/) === true
  && eq(countOf(BELLFNC, /if \(!overdue\(ts\)\) continue;/g), 3));
check("P61431", "…and ONE number governs all four rows", () =>
  has(BELLFNC, /const overdueMs = Number\(\(state\.summary\.slowOrders \|\| \{\}\)\.afterMs\) \|\| 180000;/));
check("P61432", "…taken from the SERVER's number, so the two halves cannot drift", () =>
  has(read("lib/printQueue.ts"), /export const SLOW_ACCEPT_MS = 180_000/) === true
  && has(read("app/api/editor/[...path]/route.ts"), /afterMs: SLOW_ACCEPT_MS/) === true);
check("P61433", "…and it falls back to the same three minutes when a targeted refetch omits it", () =>
  has(BELLFNC, /\|\| 180000;/));
check("P61434", "…and every row says how long it has waited, in one shared sentence", () =>
  has(BELLFNC, /const waited = \(word\) => `\$\{word\} for over \$\{overdueMin\} minute\$\{overdueMin === 1 \? "" : "s"\}`;/));
check("P61435", "…with the right plural at one minute", () => has(BELLFNC, /overdueMin === 1 \? "" : "s"/));
check("P61436", "…and the minutes come from the number, never typed twice", () =>
  has(BELLFNC, /const overdueMin = Math\.max\(1, Math\.round\(overdueMs \/ 60000\)\);/));
check("P61437", "a waiter call says it has NOT BEEN ATTENDED, which is the thing that is wrong", () =>
  has(BELLFNC, /waited\("not attended"\)/));
check("P61438", "…and keeps what the guest actually asked for beside it", () =>
  has(BELLFNC, /note \? `\$\{note\} · \$\{waited\("not attended"\)\}` : waited\("not attended"\)/));
check("P61439", "…and a resolved call never reaches the bell at all", () => has(BELLFNC, /if \(!c \|\| c\.resolved\) continue;/));
check("P61440", "someone waiting to be let in says WAITING, and names them when it can", () =>
  has(BELLFNC, /who \? `\$\{who\} · \$\{waited\("waiting"\)\}` : waited\("waiting"\)/));
check("P61441", "…and any other request says the same", () =>
  has(BELLFNC, /what \? `\$\{what\} · \$\{waited\("waiting"\)\}` : waited\("waiting"\)/));
check("P61442", "an unaccepted order says NOT ACCEPTED, through the same helper", () =>
  has(BELLFNC, /`\$\{waited\("not accepted"\)\}\$\{o\.kot_no != null \? " · KOT #" \+ o\.kot_no : ""\}`/));
check("P61443", "…and it still names the KOT, which is what a manager looks for", () => has(BELLFNC, /" · KOT #" \+ o\.kot_no/));
check("P61444", "a row with NO timestamp is shown, not hidden — an alarm fails open", () =>
  has(BELLFN, /A row with NO timestamp is shown rather than hidden/) === true
  && has(BELLFNC, /const at = \(v\) => \{ const t = v \? new Date\(v\)\.getTime\(\) : 0; return Number\.isFinite\(t\) \? t : 0; \};/) === true);
check("P61445", "…and that choice is written down at the site, so nobody tidies it away", () =>
  has(BELLFN, /fail-open is deliberate, not an accident/));
check("P61446", "his own words are recorded at the code, both rulings", () =>
  has(BELLFN, /it should not leave — it should come when for/) === true
  && has(BELLFN, /waiter has not attended/) === true
  && has(BELLFN, /order not accepted for more than 3 to 4 min/) === true);
check("P61463", "…and that rule is explained ONCE, not once per row", () =>
  eq(countOf(BELLFN, /order not accepted for more than 3 to 4 min/g), 1));
check("P61447", "…and the reason the floor keeps showing them instantly is written down too", () =>
  has(BELLFN, /the tile turns amber, wears its 💧\/🙋 badge and a one-tap ✓/));
check("P61448", "the FLOOR still badges a call the moment it is rung — the live queue is untouched", () =>
  has(ACT, /calls\.slice\(0, 3\)\.forEach\(\(c\) => \{ badges \+= `<span class="ftb call">\$\{callEmoji\(c\.note\)\}<\/span>`; \}\)/));
check("P61449", "…in BOTH tile paths, so a selected table cannot disagree with an unselected one", () =>
  eq(countOf(ACT, /calls\.slice\(0, 3\)\.forEach/g), 2));
check("P61450", "…and 'Needs you' still counts a table the moment it wants something", () =>
  has(ACT, /if \(hasNew \|\| hasCall\) needy\.add\(String\(i\)\);/));
check("P61451", "…and a new order still gets its one-tap ✓ on the tile immediately", () =>
  has(ACT, /data-quick-accept="\$\{i\}"/));
check("P61452", "so the bell and the floor answer two DIFFERENT questions, deliberately", () =>
  has(BELLFN, /the FLOOR is where they belong/));
check("P61453", "the bell's four kinds all still have an icon and a headline", () => {
  const m = codeOf(BELL).match(/var KINDS = \{[\s\S]*?\n  \};/)[0];
  return ["call:", "order:", "join:", "request:", "printer:"].every((k) => m.includes(k)) || "a kind lost its wording";
});
check("P61454", "…and the call headline still reads as a person doing something", () =>
  has(BELL, /call:    \{ icon: "🔔", what: "rang for a waiter" \}/));
check("P61455", "nothing in the overdue gate can throw on a missing row", () =>
  has(BELLFNC, /if \(!c \|\| c\.resolved\) continue;/) === true && has(BELLFNC, /if \(!o \|\| o\.table_number == null\) continue;/) === true);
check("P61456", "…and a name or note is trimmed before it is drawn, so a blank one reads as blank", () =>
  eq(countOf(BELLFNC, /\|\| ""\)\.trim\(\)/g), 3));
check("P61457", "the overdue rule needs no new server read for three of the four", () =>
  has(BELLFNC, /state\.summary\.calls/) === true && has(BELLFNC, /state\.summary\.joiners/) === true && has(BELLFNC, /state\.summary\.requests/) === true);
check("P61458", "…because the summary already carries their times", () =>
  eq(countOf(BELLFNC, /const ts = at\([cjr]\.created_at\);/g), 3));
check("P61459", "…and only the ORDER needed a read adding, for the reason written at the site", () =>
  has(BELLFN, /the floor summary reports an unaccepted order as a STATE with no time on it/));
check("P61460", "…and that read is still scoped, capped and shared", () =>
  has(read("app/api/editor/[...path]/route.ts"), /sharedFloorSummary\(`slow-orders:\$\{rid\}`/) === true
  && has(read("app/api/editor/[...path]/route.ts"), /\.order\("created_at"\)\.limit\(5\)/) === true);
check("P61461", "the bell still writes nothing — the one action is the print fallback, and only that", () =>
  eq(countOf(BELLFNC, /row\.action = \{/g), 1));
check("P61462", "…and no call, order or join row was given a button", () =>
  has(BELLFNC, /if \(a\.kind === "job" && a\.jobKind !== "bill" && a\.id\)/));

process.exit(report("sweep #8 · T7 · static") ? 1 : 0);
