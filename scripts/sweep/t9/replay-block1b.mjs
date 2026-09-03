// Replay of LEDGER/T6.md block 1, second half — P02601–P02700.
import { row, APP, APPC, HTML, has, hasRe, lacks, lacksRe } from "./lib.mjs";

const slice = (from, to) => { const a = APPC(); const i = a.indexOf(from); const j = a.indexOf(to); return i < 0 || j < 0 ? "" : a.slice(i, j); };

// ── reconcileList — P02601–P02607 ────────────────────────────────────────────
const RECON = () => slice("function reconcileList(", "function forgetCardHtml(");
row("P02601", "reconcileList() writes the empty placeholder only when it is not already the sole child", () =>
  hasRe(RECON(), /if \(!\(container\.children\.length === 1 && container\.firstElementChild && container\.firstElementChild\.classList\.contains\("empty"\)\)\)/));
row("P02602", "reconcileList() reuses a card node whose html is unchanged", () =>
  hasRe(RECON(), /if \(node\.__kdsHtml !== d\.html\) \{/));
row("P02603", "reconcileList() stamps __kdsHtml on every node it creates or replaces", () =>
  ((RECON().match(/__kdsHtml = d\.html/g) || []).length >= 2) || "fewer than two stamp sites");
row("P02604", "reconcileList() keeps DOM order matching the desired list", () =>
  hasRe(RECON(), /const target = prev \? prev\.nextSibling : container\.firstChild;[\s\S]{0,120}insertBefore\(node, target\)/));
row("P02605", "reconcileList() removes every card that left the board", () =>
  hasRe(RECON(), /for \(const node of existing\.values\(\)\) node\.remove\(\);/));
row("P02606", "reconcileList() removes strays with no data-ticket instead of leaving them wedged in", () =>
  hasRe(RECON(), /if \(id != null\) existing\.set\(id, node\); else node\.remove\(\);/));
row("P02607", "reconcileList() counts a replacement in __lfhPerf so a rebuild-everything regression is visible", () =>
  hasRe(RECON(), /window\.__lfhPerf\.tilesPatched\+\+; window\.__lfhPerf\.patches\+\+/));

// ── the two views — P02608–P02619 ────────────────────────────────────────────
row("P02608", "renderColumns() draws dine-in tickets then platform tickets in each lane", () =>
  hasRe(slice("const draw = (key, list, plist)", 'draw("new", buckets.new'), /const desired = list\.map\([\s\S]{0,200}\.concat\(\(plist \|\| \[\]\)\.map\(/));
row("P02609", "renderColumns() writes \"0\" rather than a blank pill for an empty lane", () =>
  hasRe(APPC(), /\$\("#count-" \+ key\)\.textContent = String\(list\.length \+ \(plist \? plist\.length : 0\)\)/));
row("P02610", "renderColumns() never collapses an empty lane on a phone (R3)", () => {
  const a = APPC();
  const fn = slice("function renderColumns()", "function renderWall()");
  return (lacksRe(fn, /hidden = true|display\s*=\s*"none"/) === true) || "a lane is being hidden";
});
row("P02611", "renderWall() drops served tickets", () =>
  hasRe(slice("function renderWall()", "function render()"), /if \(phase !== "served"\) live\.push/));
row("P02612", "renderWall() sinks fully-ready tickets to the end", () =>
  hasRe(slice("function renderWall()", "function render()"), /desired\.sort\(\(a, b\) => \(a\.ready - b\.ready\) \|\| cmpTime\(a\.at, b\.at\)\)/));
row("P02613", "the wall is first-come-first-served across EVERY live ticket, including platform ones", () => {
  const fn = slice("function renderWall()", "function render()");
  return (/\.concat\(\(state\.platform \|\| \[\]\)\.map\(/.test(fn) && /cmpTime\(a\.at, b\.at\)/.test(fn)) || "platform tickets are not in the same sort";
});
row("P02614", "render() measures each paint into __lfhPerf.lastMs", () =>
  hasRe(slice("function render()", "function applyView()"), /window\.__lfhPerf\.lastMs = performance\.now\(\) - _t0/));
row("P02615", "applyView() toggles the two <main>s by the hidden attribute", () =>
  hasRe(APPC(), /\$\("#cols"\)\.hidden = wall; \$\("#wall"\)\.hidden = !wall/));
row("P02616", "applyView() sets the toggle's icon and word separately so the phone spans survive", () =>
  hasRe(APPC(), /ic\.textContent = wall \? "▭" : "▦"; w\.textContent = wall \? "Columns" : "Wall view"/));
row("P02617", "applyView() has a text fallback if the two spans are ever removed", () =>
  hasRe(APPC(), /else b\.textContent = wall \? "▭ Columns" : "▦ Wall view"/));
row("P02618", "applyView() empties the inactive view so its nodes cannot be reused by the reconciler", () =>
  hasRe(APPC(), /if \(wall\) \{ \$\("#list-new"\)\.innerHTML = \$\("#list-cooking"\)\.innerHTML = \$\("#list-ready"\)\.innerHTML = ""; \}\s*\n?\s*else \{ \$\("#wall"\)\.innerHTML = ""; \}/));
row("P02619", "the view choice persists per device", () =>
  (hasRe(APPC(), /localStorage\.setItem\("kds_view", view\)/) === true && hasRe(APPC(), /localStorage\.getItem\("kds_view"\) === "wall"/) === true) || "the layout choice is not both written and read back");

// ── act() and the ready paths — P02620–P02655 ────────────────────────────────
row("P02620", "act() refreshes with freshLoad(), not load(), because it follows a write", () =>
  hasRe(APPC(), /const act = async \(fn\) => \{ try \{ await fn\(\); await freshLoad\(\); \}/));
row("P02621", "act() keeps the plain `Failed: <message>` wording R21 settled on", () =>
  hasRe(APPC(), /const act = async \(fn\) => \{[\s\S]{0,120}toast\("Failed: " \+ e\.message\)/));
row("P02622", "scheduleReadyReconcile() debounces to one refetch 2.5s after the last tap", () => {
  const fn = slice("function scheduleReadyReconcile()", "function setLocalReady(");
  return (/if \(readyReconcileTimer\) clearTimeout\(readyReconcileTimer\)/.test(fn) && /\}, 2500\)/.test(fn)) || "the debounce has drifted";
});
row("P02623", "scheduleReadyReconcile() refetches FIRST and clears the overlay only after the fetch settles", () =>
  hasRe(slice("function scheduleReadyReconcile()", "function setLocalReady("), /freshLoad\(\)\.catch\(\(\) => \{\}\)\.finally\(\(\) => \{ pendingReady\.clear\(\); pendingReadyOrders\.clear\(\); \}\)/));
row("P02624", "scheduleReadyReconcile() uses freshLoad() so it cannot be handed a read that predates the tap", () =>
  (lacksRe(slice("function scheduleReadyReconcile()", "function setLocalReady("), /(?<!fresh)\bload\(\)/) === true) || "a shared load() is used here");
row("P02625", "setLocalReady() never downgrades a SERVED dish", () =>
  hasRe(slice("function setLocalReady(", "function markItemReady("), /if \(i\.status !== "served" && matches\(i\)\)/));
row("P02626", "setLocalReady() also flips a legacy order's JSON items", () =>
  hasRe(slice("function setLocalReady(", "function markItemReady("), /\(state\.orders \|\| \[\]\)\.forEach\(\(o\) => \{ if \(Array\.isArray\(o\.items\)\)/));
row("P02627", "setLocalReady() adopts the optimistic state as lastSig so a same-data refetch cannot rebuild", () =>
  hasRe(slice("function setLocalReady(", "function markItemReady("), /lastSig = boardSig\(\{ orders: state\.orders, items: state\.items/));
row("P02628", "setLocalReady() deliberately does NOT call render()", () =>
  (lacksRe(slice("function setLocalReady(", "function markItemReady("), /\brender\(\)/) === true) || "setLocalReady repaints the whole board");
const MIR = () => slice("function markItemReady(", "async function undoReady(");
row("P02629", "markItemReady() says something when the dish is no longer in state instead of returning in silence", () =>
  hasRe(MIR(), /if \(!it\) \{ toast\("That dish just changed — refreshing the board\."\); load\(\)\.catch\(\(\) => \{\}\); return; \}/));
row("P02630", "markItemReady() refuses an already-served dish by name", () =>
  hasRe(MIR(), /if \(it\.status === "served"\) \{ toast\(`\$\{it\.title \|\| "That dish"\} is already served\.`\); return; \}/));
row("P02631", "markItemReady() snapshots the previous status before flipping, for the undo bar", () =>
  hasRe(MIR(), /const prev = it\.status;[\s\S]{0,120}it\.status = "ready"; pendingReady\.add\(id\)/));
row("P02632", "markItemReady() patches only the tapped line, never the whole board", () => {
  const fn = MIR();
  return (/btn\.outerHTML = '<span class="done rdy">ready<\/span>'/.test(fn) && !/\brender\(\)/.test(fn)) || "it repaints instead of patching";
});
row("P02633", "markItemReady() slides the card to Ready only when THIS tick finished the ticket", () =>
  hasRe(MIR(), /if \(o && orderPhase\(o\) === "ready"\) moveCardToReady\(o\)/));
row("P02634", "markItemReady() reports a queued (offline) write and skips the reconcile", () =>
  hasRe(MIR(), /if \(r && r\.queued\) \{ toast\("Saved on this device ✓ — it will send by itself\."\); return; \}/));
row("P02635", "markItemReady() offers the undo bar with the dish name and the table", () =>
  hasRe(MIR(), /sub: o \? `\$\{tlong\(o\.table_number\)\} · tap undo to put it back`/));
row("P02636", "a FAILED markItemReady() drops its optimistic overlay, so the dish cannot stay green for ever", () => {
  const fn = MIR();
  const c = fn.slice(fn.indexOf("}).catch("));
  return (/pendingReady\.delete\(id\)/.test(c) && /if \(it\.status !== "served"\) it\.status = prev/.test(c) && /forgetCardHtml\(/.test(c)) || "the refused path does not fully undo";
});
const UNDO = () => slice("async function undoReady(", "function moveCardToReady(");
row("P02637", "undoReady() removes each dish from pendingReady before restoring it", () =>
  hasRe(UNDO(), /pendingReady\.delete\(s\.id\);[\s\S]{0,160}it\.status = s\.prev/));
row("P02638", "undoReady() never un-serves a dish", () => hasRe(UNDO(), /if \(it && it\.status !== "served"\)/));
row("P02639", "undoReady() sends ONE request for a whole-ticket take-back", () =>
  hasRe(UNDO(), /if \(orderId != null && snap\.length > 1\) \{[\s\S]{0,200}\/orders\/\$\{orderId\}\/unready/));
row("P02640", "undoReady() keeps the per-dish loop for the single-✓ case, which has no order id", () =>
  hasRe(UNDO(), /\} else \{\s*\n?\s*for \(const s of snap\) await api\("POST", `\/items\/\$\{s\.id\}\/status`, \{ status: s\.prev \}\);/));
row("P02641", "undoReady() finishes with a post-write refresh, since a write just landed", () =>
  hasRe(UNDO(), /refreshQuietly\(\);/));
row("P02642", "undoReady() reports a queued bulk take-back rather than looking like nothing happened", () =>
  hasRe(UNDO(), /if \(r && r\.queued\) \{ toast\("Saved on this device ✓ — it will send by itself\."\); return; \}/));
const MOVE = () => slice("function moveCardToReady(", "function markOrderReady(");
row("P02643", "moveCardToReady() bails when the card is not on screen", () => hasRe(MOVE(), /if \(!card\) return;/));
row("P02644", "moveCardToReady() stamps __kdsHtml on the replacement so the reconciler stays in step", () =>
  hasRe(MOVE(), /fresh\.__kdsHtml = html;/));
row("P02645", "moveCardToReady() refreshes in place in wall view rather than re-sorting the whole grid per tap", () =>
  hasRe(MOVE(), /if \(view === "wall"\) \{ card\.replaceWith\(fresh\); return; \}/));
row("P02646", "moveCardToReady() removes the Ready lane's \"Nothing here\" before appending", () =>
  hasRe(MOVE(), /readyList\.querySelector\("\.empty"\)\?\.remove\(\);/));
row("P02647", "moveCardToReady() recounts all three lanes and restores an empty placeholder where needed", () => {
  const fn = MOVE();
  return (/\["new", "cooking", "ready"\]\.forEach/.test(fn) && /if \(n === 0 && !list\.querySelector\("\.empty"\)\)/.test(fn)) || "the recount or the placeholder is missing";
});
row("P02648", "moveCardToReady() writes \"0\" on an emptied lane, matching the full-render pill", () =>
  hasRe(MOVE(), /c\.textContent = String\(n\)/));
const MOR = () => slice("function markOrderReady(", "function reprintOrder(");
row("P02649", "markOrderReady() snapshots every not-served dish BEFORE flipping", () =>
  hasRe(MOR(), /const snap = \(state\.items \|\| \[\]\)[\s\S]{0,200}\.map\(\(i\) => \(\{ id: i\.id, prev: i\.status \}\)\);[\s\S]{0,200}setLocalReady\(/));
row("P02650", "markOrderReady() adds the order to pendingReadyOrders so a legacy ticket cannot revert", () =>
  hasRe(MOR(), /pendingReadyOrders\.add\(orderId\)/));
row("P02651", "markOrderReady() moves just the one card, never a whole-board repaint", () => {
  const fn = MOR();
  return (/moveCardToReady\(o\)/.test(fn) && !/\brender\(\)/.test(fn)) || "it repaints the whole board";
});
row("P02652", "markOrderReady() has a defensive branch for a ticket that is somehow still cooking", () =>
  hasRe(MOR(), /else \{ \/\/|else \{ \s*\n?\s*const card = document\.querySelector/));
row("P02653", "markOrderReady() skips the undo bar for a legacy order with no per-dish ids", () =>
  hasRe(MOR(), /if \(snap\.length && window\.LFH_UNDO\)/));
row("P02654", "markOrderReady()'s undo bar pluralises dish/dishes correctly", () =>
  hasRe(MOR(), /\$\{snap\.length\} dish\$\{snap\.length > 1 \? "es" : ""\}/));
row("P02655", "a FAILED markOrderReady() drops both optimistic overlays", () => {
  const fn = MOR();
  const c = fn.slice(fn.indexOf("}).catch("));
  return (/pendingReadyOrders\.delete\(orderId\)/.test(c) && /snap\.forEach\(\(s\) => pendingReady\.delete\(s\.id\)\)/.test(c)) || "one of the two overlays survives a refusal";
});

// ── reprint + the 86 board — P02656–P02673 ───────────────────────────────────
const RE = () => slice("function reprintOrder(", "function renderDishes(");
row("P02656", "reprintOrder() says so when the order has left the board instead of failing silently", () =>
  hasRe(RE(), /if \(!o\) \{ toast\("That order isn't on the board any more\."\); return; \}/));
row("P02657", "reprintOrder() only stamps DUPLICATE when this screen has printed the ticket before", () =>
  hasRe(RE(), /const dup = printedIds\.has\(o\.id\);/));
row("P02658", "a manual FIRST print is recorded, so the NEXT tap is honestly a duplicate", () =>
  hasRe(RE(), /if \(!dup\) \{ printedIds\.add\(o\.id\); savePrintedIds\(\); \}/));
row("P02659", "reprintOrder() tells the cook when the print did not happen", () =>
  hasRe(RE(), /else toast\(`Couldn't print KOT #\$\{o\.kot_no \?\? "—"\} — check the printer, then try again\.`\)/));
row("P02660", "reprintOrder() names the KOT number and the table in its toast", () =>
  hasRe(RE(), /KOT #\$\{o\.kot_no \?\? "—"\} · \$\{tlong\(o\.table_number\)\}/));
const RD = () => slice("function renderDishes(", "const RT_VOLATILE");
row("P02661", "renderDishes() trims the search box, so a spaces-only query is not a real search", () =>
  hasRe(RD(), /const q = \(\$\("#dishSearch"\)\.value \|\| ""\)\.trim\(\)\.toLowerCase\(\);/));
row("P02662", "renderDishes() shows an honest message for a search with no matches", () =>
  hasRe(RD(), /No dishes match “\$\{esc\(q\)\}”/));
row("P02663", "renderDishes() distinguishes \"no match\" from \"no dishes yet\"", () =>
  hasRe(RD(), /q \? `No dishes match “\$\{esc\(q\)\}”` : "No dishes on the menu yet"/));
row("P02664", "renderDishes() skips the rebuild when the html is unchanged, so the caret is not lost", () =>
  hasRe(RD(), /if \(\$\("#dishList"\)\.__kdsHtml === html\) return;/));
row("P02665", "set86() updates the local dish tag even when the button is filtered out of view", () => {
  const fn = RD();
  const s = fn.slice(fn.indexOf("const set86 ="));
  return (s.indexOf("dish.tags = [...tags]") < s.indexOf("if (!btn) return")) || "the tag write happens after the early return";
});
row("P02666", "set86() re-queries the live button by id rather than holding a possibly detached node", () =>
  hasRe(RD(), /const btn = document\.querySelector\(`\[data-86="\$\{window\.CSS && CSS\.escape \? CSS\.escape\(id\) : id\}"\]`\)/));
row("P02667", "set86() escapes the id for the attribute selector where CSS.escape exists", () =>
  hasRe(RD(), /CSS\.escape \? CSS\.escape\(id\) : id/));
row("P02668", "the 86 toggle disables its button while sending, so a double-tap cannot fire twice", () => {
  const fn = RD();
  return (/if \(b\.disabled\) return;/.test(fn) && /b\.disabled = true;/.test(fn) && /finally \{ b\.disabled = false; \}/.test(fn)) || "the double-tap guard is incomplete";
});
row("P02669", "the 86 toggle rolls back the optimistic flip on failure", () =>
  hasRe(RD(), /\} catch \(e\) \{\s*\n?\s*set86\(id, wasOut\);/));
row("P02670", "the 86 toggle reports a queued (offline) write", () =>
  hasRe(RD(), /if \(r && r\.queued\) toast\("Saved on this device ✓ — it will send by itself\."\)/));
row("P02671", "the 86 toggle always offers an UNDO, with a plain-toast fallback", () => {
  const fn = RD();
  return (/if \(window\.LFH_UNDO\) LFH_UNDO\.show\(\{/.test(fn) && /else toast\(`\$\{dish \? dish\.title : "Dish"\}[^`]*`, undo86\)/.test(fn)) || "the fallback is missing";
});
row("P02672", "the 86 UNDO targets the dish by id and re-queries the button", () =>
  hasRe(RD(), /const undo86 = async \(\) => \{\s*\n?\s*set86\(id, wasOut\);/));
row("P02673", "the 86 UNDO rolls itself back and says so if the undo write fails", () =>
  hasRe(RD(), /catch \(e\) \{ set86\(id, nowOut\); toast\("Undo failed: " \+ e\.message\); \}/));

// ── boardSig, names, loadTables, loadImpl — P02674–P02700 ────────────────────
row("P02674", "RT_VOLATILE holds only heartbeat/derived columns", () => {
  const m = APPC().match(/const RT_VOLATILE = new Set\(\[([^\]]*)\]\)/);
  if (!m) return "RT_VOLATILE not found";
  const keys = m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
  const allowed = new Set(["last_activity_at", "updated_at", "cart_updated_at", "served_at"]);
  const extra = keys.filter((k) => !allowed.has(k));
  return extra.length === 0 || `non-heartbeat columns excluded from the redraw fingerprint: ${extra.join(", ")}`;
});
row("P02675", "stableRow() keeps every key that is not volatile — it is not a hand-picked allow-list", () =>
  hasRe(APPC(), /const stableRow = \(row\) => \{ const o = \{\}; for \(const k in \(row \|\| \{\}\)\) if \(!RT_VOLATILE\.has\(k\)\) o\[k\] = row\[k\]; return o; \}/));
row("P02676", "boardSig() hashes orders, items, dishes, platform and the platform-accept flag", () => {
  const fn = slice("function boardSig(", "let lastSig = null");
  for (const k of ["d.orders", "d.items", "d.dishes", "d.platform", "d.platformAccept"]) if (!fn.includes(k)) return `missing ${k}`;
  return true;
});
row("P02677", "boardSig() also hashes autoPrintKot, since it decides whether the 🖨 button draws", () =>
  hasRe(slice("function boardSig(", "let lastSig = null"), /state\.autoPrintKot/));
row("P02678", "boardSig() also hashes tableNames and tableTags, both drawn on the ticket head", () => {
  const fn = slice("function boardSig(", "let lastSig = null");
  return (fn.includes("state.tableNames") && fn.includes("state.tableTags")) || "one of the two is not in the fingerprint";
});
row("P02679", "restDisplayName() prefers the short brand label, then English, then any translation", () => {
  const fn = slice("function restDisplayName(", "function setRestName(");
  const iLogo = fn.indexOf("r.logo_text"), iEn = fn.indexOf("n.en"), iAny = fn.indexOf("Object.values(n)");
  return (iLogo > 0 && iEn > iLogo && iAny > iEn) || "the precedence has drifted";
});
row("P02680", "restDisplayName() returns \"\" for nothing loaded and never the string undefined", () => {
  const fn = slice("function restDisplayName(", "function setRestName(");
  return (/if \(!r\) return "";/.test(fn) && /return "Restaurant";/.test(fn)) || "the empty/fallback answers have drifted";
});
row("P02681", "restDisplayName() never hard-codes a brand", () => {
  const fn = slice("function restDisplayName(", "function setRestName(");
  return lacksRe(fn, /French House|Aangan|La Fiesta|LFH\b/);
});
row("P02682", "setRestName() strips the * wordmark markers", () =>
  hasRe(slice("function setRestName(", "async function loadTables("), /\.replace\(\/\\\*\/g, ""\)/));
const LT = () => slice("async function loadTables(", "function printKot(");
row("P02683", "loadTables() falls back to a full read when it has no baseline yet", () =>
  hasRe(LT(), /if \(!state\.knownIds\) return load\(\);/));
row("P02684", "loadTables() falls back to a full read on any fetch failure", () =>
  hasRe(LT(), /\} catch \(e\) \{ return load\(\); \}/));
row("P02685", "loadTables() applies prints, the chime and the merge even when superseded, gating only the paint", () => {
  const fn = LT();
  return (fn.indexOf("if (newReceived.length) chime();") < fn.indexOf("if (seq !== loadSeq) return;")) || "the staleness guard sits before the side-effects again";
});
row("P02686", "loadTables() de-duplicates by row id so a shifted table cannot double a ticket", () =>
  hasRe(LT(), /const dedupeById = \(arr\) => \{ const m = new Map\(\); for \(const x of arr\) if \(x && x\.id != null\) m\.set\(x\.id, x\); return \[\.\.\.m\.values\(\)\]; \}/));
row("P02687", "loadTables() takes the whole tag map, so a mark being REMOVED disappears too", () =>
  hasRe(LT(), /const freshTags = slices\.map\(\(s\) => s && s\.tableTags\)[\s\S]{0,90}\.pop\(\);[\s\S]{0,80}state\.tableTags = freshTags/));
row("P02688", "loadTables() chimes for a brand-new guest order born preparing as well as received", () =>
  hasRe(LT(), /o\.status === "received" \|\| \(o\.status === "preparing" && guestPlaced\(o\)\)/));
row("P02689", "loadTables() stays silent for a waiter-placed order", () =>
  hasRe(APPC(), /const guestPlaced = \(o\) => !!o && o\.guest === 1;/));
row("P02690", "loadTables() adds fresh ids to knownIds rather than replacing it", () =>
  hasRe(LT(), /for \(const o of freshOrders\) state\.knownIds\.add\(o\.id\);/));
row("P02691", "loadTables() purges the changed tables' cached orders AND the slice's ids before merging", () => {
  const fn = LT();
  return (/const purgedOrderIds = new Set\(freshOrders\.map\(\(o\) => o\.id\)\);/.test(fn) &&
          /if \(changedTables\.has\(String\(o\.table_number\)\)\) purgedOrderIds\.add\(o\.id\);/.test(fn)) || "one half of the purge is missing";
});
row("P02692", "loadTables() sorts merged orders ascending by created_at, matching the server helper", () =>
  hasRe(LT(), /orders\.sort\(\(a, b\) => String\(a\.created_at \|\| ""\)\.localeCompare\(String\(b\.created_at \|\| ""\)\)\)/));
row("P02693", "loadTables() re-applies both optimistic overlays after the merge", () => {
  const fn = LT();
  return (/state\.orders = pendingReadyOrders\.size/.test(fn) && /state\.items = pendingReady\.size/.test(fn)) || "one overlay is not re-applied";
});
row("P02694", "loadTables() keeps the 86 drawer fresh while it is open", () =>
  hasRe(LT(), /if \(!\$\("#drawerOverlay"\)\.hidden\) renderDishes\(\);/));
row("P02695", "loadTables() skips the repaint when the signature is unchanged", () =>
  hasRe(LT(), /if \(sig === lastSig\) return;[\s\S]{0,60}lastSig = sig;\s*\n?\s*render\(\);/));
const LI = () => slice("async function loadImpl()", '$("#muteBtn").textContent');
row("P02696", "loadImpl() drops a superseded response before touching state", () => {
  const fn = LI();
  return (fn.indexOf("if (seq !== loadSeq) return;") < fn.indexOf("state.tableNames =")) || "state is written before the staleness check";
});
row("P02697", "loadImpl() sets table names and tags BEFORE any auto-print", () => {
  const fn = LI();
  return (fn.indexOf("state.tableTags = data.tableTags") < fn.indexOf("autoPrintNet(")) || "auto-print runs before the labels are known";
});
row("P02698", "loadImpl() never chimes on the very first paint", () =>
  hasRe(LI(), /if \(state\.knownIds\) \{[\s\S]{0,400}chime\(\);/));
row("P02699", "loadImpl() seeds printedIds only when auto-print is actually on", () =>
  hasRe(LI(), /if \(data\.autoPrintKot\) \{\s*\n?\s*for \(const o of data\.orders\) \{/));
row("P02700", "loadImpl() still prints an order that arrived during the boot fetch", () =>
  hasRe(LI(), /if \(!Number\.isFinite\(t\) \|\| t < BOOT_TS\) printedIds\.add\(o\.id\);/));
