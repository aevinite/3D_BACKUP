#!/usr/bin/env node
// SWEEP #9 ROUND 2 · TERMINAL 3 — the basket and placing an order · P110001–P110380 (static)
//
//   node scripts/sweep/t3/s9r2-checks.mjs
//
// 500 phases, PLANNED BY MEASUREMENT (rule 2b), not by having an idea. Rows already on disk for
// each file this terminal owns, counted by SUBJECT across all 44 ledgers, against the file's size:
//
//   file                   lines   rows   rows/100 lines
//   CartPanel.tsx           1295     93            7.2   ← thinnest, and the biggest file
//   guest/call-waiter        196     21           10.7
//   OrderTracker.tsx         562     64           11.4
//   lib/menu.ts              932    118           12.7
//   guest/leave               75     11           14.7
//   guest/limit-hit           59      9           15.3
//   guestOutbox.ts          1055    162           15.4
//   guest/place-order        221     54           24.4   ← best covered
//
// So the weight goes to CartPanel. And reading its 93 existing rows showed something the density
// number alone does not: almost all of them are about LOGIC — the basket array, the at-most-once
// key, the money domains, the switches. The RENDERED half of that file is nearly untouched: the
// Live-status tab, the "Wrong table? Fix it" flow, the pairing card, the allergy chips, the MRP
// stamp, the bill rows, the two tabs and the scroll hand-off. That is where block A goes.
//
// Nothing here touches a database, a login or a deployed site.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };

let pass = 0; const fails = [];
export const P = (id, name, ok, extra) => {
  if (ok) { pass++; console.log(`ok   ${id} ${name}${extra !== undefined ? ` — ${extra}` : ""}`); }
  else { fails.push(`${id} ${name}`); console.log(`FAIL ${id} ${name}${extra !== undefined ? ` — got ${JSON.stringify(extra)}` : ""}`); }
};

const CART = read("components/CartPanel.tsx");
const TRACK = read("components/OrderTracker.tsx");
const MENU = read("lib/menu.ts");
const OUT = read("lib/guestOutbox.ts");
const PL = read("app/api/guest/place-order/route.ts");
const CW = read("app/api/guest/call-waiter/route.ts");
const LV = read("app/api/guest/leave/route.ts");
const LH = read("app/api/guest/limit-hit/route.ts");

// Strip comments so a check cannot be satisfied by the PROSE of a note that explains it.
// Line comments BEFORE block comments: a `/*` inside a `//` line otherwise hides everything after
// it (this project lost 190 lines to exactly that once).
const codeOf = (src) => src
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length))
  .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
const C_CART = codeOf(CART), C_TRACK = codeOf(TRACK), C_MENU = codeOf(MENU), C_OUT = codeOf(OUT);
const C_PL = codeOf(PL), C_CW = codeOf(CW), C_LV = codeOf(LV), C_LH = codeOf(LH);

// A guard that reads an empty file passes everything. Refuse to run on one.
for (const [n, s] of Object.entries({ CartPanel: CART, OrderTracker: TRACK, "lib/menu": MENU, guestOutbox: OUT, "place-order": PL, "call-waiter": CW, leave: LV, "limit-hit": LH })) {
  if (s.length < 400) { console.error(`REFUSING TO RUN: ${n} read as ${s.length} bytes — this guard would pass against nothing.`); process.exit(2); }
}

const has = (s, re) => re.test(s);
const countOf = (s, re) => (s.match(re) || []).length;

console.log("\n══ BLOCK A · components/CartPanel.tsx — the RENDERED bill (P110001–P110160) ══");

// ── A1 · the two tabs, and the red dot (P110001–P110014) ───────────────────────────────────────
P("P110001", "the bill has exactly two tabs, and one is current / one is live", countOf(C_CART, /className=\{!showHistory \? "active" : ""\}|className=\{showHistory \? "active" : ""\}/g) === 2);
P("P110002", "…they are buttons, so a keyboard reaches them", has(C_CART, /<button[^>]*onClick=\{\(\) => setShowHistory\(false\)\}/) && has(C_CART, /<button[^>]*onClick=\{\(\) => setShowHistory\(true\)\}/));
P("P110003", "…and each is type=\"button\", so neither can submit a form", countOf(C_CART, /type="button" className=\{!?showHistory/g) === 2);
P("P110004", "the live tab shows a COUNT only when something is live", has(C_CART, /liveOrders\.length \? ` \(\$\{liveOrders\.length\}\)` : ""/));
P("P110005", "…so an empty tab never reads '(0)'", !has(C_CART, /\(\$\{liveOrders\.length\}\)`\s*\}/) || has(C_CART, /liveOrders\.length \?/));
P("P110006", "a live order whose strip was HIDDEN still raises the tab's dot", has(C_CART, /const hiddenLive = liveOrders\.some\(\(o\) => o\.stripHidden && !isFinalStatus\(o\.status\)\)/));
P("P110007", "…and a FINISHED hidden order does not, so the dot cannot stick on for ever", has(C_CART, /!isFinalStatus\(o\.status\)/));
P("P110008", "…and the dot is labelled for a screen reader, not colour alone", has(C_CART, /tab-live-dot" aria-label=/));
P("P110009", "only ONE tab's content renders at a time", has(C_CART, /\{showHistory \? \(/) && has(C_CART, /\) : \(/));
P("P110010", "opening the bill always lands on the CURRENT tab, never on whatever was last open", has(C_CART, /setOpen\(true\); loadMenuOnce\(\); loadCart\(\); loadLive\(\); setShowHistory\(false\)/));
P("P110011", "…except when the tracker asks for the live tab by name", has(C_CART, /handleShowPrev = \(\) => \{ setOpen\(true\); loadMenuOnce\(\); setShowHistory\(true\)/));
P("P110012", "the panel carries the id the scroll hand-off looks for", has(C_CART, /id="cart-panel"/) && has(C_CART, /getElementById\("cart-panel"\)/));
P("P110013", "…and so does the list", has(C_CART, /id="cart-list"/) && has(C_CART, /getElementById\("cart-list"\)/));
P("P110014", "the header counts items, and says 'item' vs 'items' correctly", has(C_CART, /itemCount !== 1 \? "s" : ""/));

// ── A2 · the Live-status tab (P110015–P110040) ─────────────────────────────────────────────────
P("P110015", "the live tab shows the session bill when sessions are on", has(C_CART, /<SessionTableBill \/>/));
P("P110016", "…and the coarse 'Live now' list ONLY when they are off, so the two never duplicate", has(C_CART, /\{!sessionsEnabled && liveOrders\.length > 0 && \(/));
P("P110017", "…and the empty state is likewise only for the sessions-off case", has(C_CART, /\{!sessionsEnabled && liveOrders\.length === 0 && \(/));
P("P110018", "the empty state SAYS something rather than leaving a blank box", has(C_CART, /Nothing cooking right now/) && has(C_CART, /Your live orders will show up here/));
P("P110019", "each live order names its status in words, not a code", has(C_CART, /STATUS_COPY\[o\.status\]/) && has(C_CART, /cp\.label/) && has(C_CART, /cp\.sub/));
P("P110020", "…with the step dots only when the status is a real step", has(C_CART, /stepIndex >= 0 && \(/));
P("P110021", "…and the table number only when there is one", has(C_CART, /\{o\.tableNumber && <span className="live-order-table"/));
P("P110022", "…and its item list only when it has items", has(C_CART, /\{o\.items && o\.items\.length > 0 && \(/));
P("P110023", "a live order's total goes through the USD→display converter, not the raw number", has(C_CART, /live-order-total[\s\S]{0,80}showPrice\(o\.total\)/));
P("P110024", "'Wrong table? Fix it' appears only while the order is still early", has(C_CART, /\{\(o\.status === "received" \|\| o\.status === "preparing"\) && \(/));
P("P110025", "…so a SERVED order's table can no longer be moved (the kitchen already sent it)", !has(C_CART, /o\.status === "served"[\s\S]{0,120}live-order-fixlink/));
P("P110026", "the correction box takes digits only", has(C_CART, /setTableDraft\(e\.target\.value\.replace\(\/\\D\/g, ""\)\)/));
P("P110027", "…is capped at 4 characters, like the main table field", countOf(C_CART, /maxLength=\{4\}/g) >= 1);
P("P110028", "…focuses itself, so the diner can type straight away", has(C_CART, /aria-label="Correct table number" autoFocus/));
P("P110029", "…is labelled for a screen reader", has(C_CART, /aria-label="Correct table number"/));
P("P110030", "…and Enter saves it, so a phone keyboard's return key works", has(C_CART, /onKeyDown=\{\(e\) => \{ if \(e\.key === "Enter"\) saveOrderTable\(o\); \}\}/));
P("P110031", "the correction validates against THIS restaurant's table count before sending", has(C_CART, /const check = validateTable\(tableDraft, tableCount\);/));
P("P110032", "…and a refusal is SAID, never a silent no-op", has(C_CART, /if \(!check\.ok\) \{[\s\S]{0,200}lfh:toast/));
P("P110033", "…a no-op change closes the box instead of calling the server", has(C_CART, /check\.value === \(o\.tableNumber \|\| ""\)\.trim\(\)\) \{ setEditingTable\(null\); return; \}/));
P("P110034", "…a second tap while one is in flight is ignored", has(C_CART, /if \(savingTable\) return;/));
P("P110035", "…and the button says so while it works", has(C_CART, /\{savingTable \? "Saving…" : "Save"\}/));
P("P110036", "a server refusal names the likely reason instead of a bare failure", has(C_CART, /Couldn't move that order/) && has(C_CART, /it may already be served/));
P("P110037", "…and the in-flight flag is cleared on BOTH outcomes, so the box cannot wedge", has(C_CART, /setSavingTable\(false\);\s*\n\s*if \(!ok\)/));
P("P110038", "a successful move updates THIS device's copy so the strip and the list agree at once", has(C_CART, /writeActiveOrders\(list\);\s*\n\s*setLiveOrders\(liveActiveOrders\(list\)\)/));
P("P110039", "…tells the rest of the app", has(C_CART, /new Event\("lfh:orders-updated"\)/));
P("P110040", "…and confirms it in words a diner can trust", has(C_CART, /Moved to table \$\{check\.value\}/) && has(C_CART, /the kitchen has been told/));

// ── A3 · the pairing card (P110041–P110056) ────────────────────────────────────────────────────
P("P110041", "a pairing is only suggested when there is something in the basket", has(C_CART, /cart\.length > 0\s*\n?\s*\? menuItems/));
P("P110042", "…never a dish already on the bill", has(C_CART, /!cartIds\.has\(i\.id\)/));
P("P110043", "…only from the drink/dessert categories", has(C_CART, /PAIR_CATS = \["coffee", "beverages", "desserts"\]/));
P("P110044", "…and never a SOLD-OUT dish, which could not be ordered anyway", has(C_CART, /!\(i\.tags \|\| \[\]\)\.includes\("sold-out"\)/));
P("P110045", "…the best-rated one is chosen, not the first in the list", has(C_CART, /\.sort\(\(a, b\) => \(parseFloat\(b\.rating\) \|\| 0\) - \(parseFloat\(a\.rating\) \|\| 0\)\)\[0\]/));
P("P110046", "…and a missing rating cannot make the sort throw", has(C_CART, /parseFloat\(b\.rating\) \|\| 0/));
P("P110047", "…with `|| null` so an empty result renders nothing rather than `undefined`", has(C_CART, /\)\[0\] \|\| null/));
P("P110048", "the card renders only when a pairing was actually found", has(C_CART, /\{pairing && \(/));
P("P110049", "…and only inside the cart.length > 0 block, so it cannot sit under an empty bill", has(C_CART, /\{cart\.length > 0 && \([\s\S]{0,400}\{pairing && \(/));
P("P110050", "its image is optional, so a dish with none does not render a broken picture", has(C_CART, /\{pairing\.image && <img/));
P("P110051", "…and that image has an empty alt, being decorative beside the name", has(C_CART, /pairing\.image} alt="" className="pairing-img"/));
P("P110052", "its price gets the full MENU treatment, matching the dish card exactly", has(C_CART, /unitDisplay\(prettyUsd\(pairing\.price\), \[\], currency \|\| undefined\)/));
P("P110053", "adding it goes through the same table gate as every other add", has(C_CART, /const addPairing = \(it: MenuItem\) => \{\s*\n\s*gateAddToCart/));
P("P110054", "…and is capped at 99 like every other add path", has(C_CART, /addPairing[\s\S]{0,400}Math\.min\(99,/));
P("P110055", "…storing the CONFIDENT unit price, so the bill never re-rounds it", has(C_CART, /price: prettyUsd\(it\.price\)\.toFixed\(2\)/));
P("P110056", "…and it confirms in words that it was added", has(C_CART, /\$\{it\.title\} added/));

// ── A4 · the allergy section (P110057–P110078) ─────────────────────────────────────────────────
P("P110057", "the whole allergy section disappears when the restaurant switches it off", has(C_CART, /\{features\.allergies && \(\s*\n\s*<div className="allergy-section">/));
P("P110058", "every preset allergen is offered", has(C_CART, /ALLERGENS\.map\(\(a\) =>/));
P("P110059", "…each as a real toggle with a pressed state a screen reader can read", has(C_CART, /aria-pressed=\{declared\.includes\(a\.slug\)\}/));
P("P110060", "…and tapping one flips it both ways", has(C_CART, /d\.includes\(slug\) \? d\.filter\(\(x\) => x !== slug\) : \[\.\.\.d, slug\]/));
P("P110061", "a typed allergy becomes its own chip, so it can be seen and removed", has(C_CART, /declared\.filter\(\(s\) => !ALLERGENS\.some\(\(a\) => a\.slug === s\)\)\.map/));
P("P110062", "…keyed apart from the presets, so two lists cannot collide", has(C_CART, /key=\{`custom-\$\{s\}`\}/));
P("P110063", "…and it is pressed, because a chip that is there IS on", has(C_CART, /className="allergy-toggle on"\s*\n\s*aria-pressed=\{true\}/));
P("P110064", "the free-text field is its OWN switch, apart from the chips", has(C_CART, /\{features\.allergy_other && \(/));
P("P110065", "…and the field itself is gated on that switch too, not only the button", has(C_CART, /\{otherOpen && features\.allergy_other && \(/));
P("P110066", "…rendered conditionally rather than hidden with CSS, which the chip's own display would beat", !has(C_CART, /allergy-toggle[^>]*hidden=/));
P("P110067", "a typed allergy is normalised — trimmed, lowercased, and a leading 'no ' dropped", has(C_CART, /otherAllergy\.trim\(\)\.toLowerCase\(\)\.replace\(\/\^no\[\\s-\]\+\/, ""\)/));
P("P110068", "…a duplicate is not added twice", has(C_CART, /if \(v && !declared\.includes\(v\)\) setDeclared/));
P("P110069", "…the box is emptied after adding, ready for the next one", has(C_CART, /setOtherAllergy\(""\);/));
P("P110070", "…Enter does not submit anything else", has(C_CART, /e\.preventDefault\(\);/));
P("P110071", "…and the typed value is length-capped, so one field cannot carry an essay", has(C_CART, /maxLength=\{80\}/));
P("P110072", "the section explains that a tap applies to the WHOLE order, not one dish", has(C_CART, /removed from <b>all the dishes<\/b>/));
P("P110073", "a dish that conflicts with an avoided allergen is flagged on its own line", has(C_CART, /\{features\.allergies && c\.length > 0 && \(/));
P("P110074", "…and the whole order gets one summary warning, with no repeats", has(C_CART, /orderDeclaredHits = \[\.\.\.new Set\(cart\.flatMap/));
P("P110075", "…which only renders when something actually conflicts", has(C_CART, /\{orderDeclaredHits\.length > 0 && \(/));
P("P110076", "the per-dish allergen dots are hidden when the feature is off", has(C_CART, /\{features\.allergies && itemAllergens\(item\.id\)\.length > 0 && \(/));
P("P110077", "…and each dot says what it means on hover, not by icon alone", has(C_CART, /title=\{`Contains \$\{allergenLabel\(a\)\.toLowerCase\(\)\}`\}/));
P("P110078", "an allergen label is always rendered through the shared dictionary, never raw", !has(C_CART, /\{a\}<\/span>/) || has(C_CART, /allergenLabel/));

// ── A5 · the money rows a diner reads (P110079–P110100) ────────────────────────────────────────
P("P110079", "the bill prints a subtotal", has(C_CART, /<span>Subtotal<\/span><span>\{fmtDisp\(subtotal\)\}/));
P("P110080", "…and a grand total, marked as the grand one", has(C_CART, /className="bill-line grand"><span>Total<\/span><span>\{fmtDisp\(total\)\}/));
P("P110081", "the subtotal is the SUM OF THE PRINTED LINES, so the rows visibly add up", has(C_CART, /const subtotal = cart\.reduce\(\(sum, it\) => sum \+ lineDisp\(it\), 0\)/));
P("P110082", "…and each printed line is that same lineDisp, not a second formula", has(C_CART, /cart-item-price">\{fmtDisp\(lineDisp\(item\)\)\}/));
P("P110083", "the total is subtotal + tax, in the display domain only", has(C_CART, /const total = subtotal \+ tax;/));
P("P110084", "a GST row appears only when GST is really ADDED to what is printed above it", has(C_CART, /const showTaxRow = !dispSplit\.composition && tax > 0/));
P("P110085", "…so a composition restaurant never shows one", has(C_CART, /dispSplit\.composition \? 0 : toMinor/));
P("P110086", "…and the rate is printed to two decimals without floating-point dust", has(C_CART, /Math\.round\(taxRate \* 10000\) \/ 100/));
P("P110087", "when there is no GST row, the bill SAYS why rather than leaving a silent gap", has(C_CART, /\{!showTaxRow && !dispSplit\.composition && subtotal > 0 && \(/));
P("P110088", "…and it tells the two reasons apart: all-MRP versus tax-inclusive prices", has(C_CART, /nontaxDisp >= subtotal \? "No GST on these items" : "GST is already included in these prices"/));
P("P110089", "…and that line is suppressed on an empty bill, where it would mean nothing", has(C_CART, /subtotal > 0 && \(/));
P("P110090", "an MRP row is printed only when there is MRP money to separate out", has(C_CART, /\{nontaxDisp > 0 && \(/));
P("P110091", "…and never under composition, where nothing is MRP and the row would be a lie", has(C_CART, /const nontaxDisp = dispSplit\.composition \? 0 : dispSplit\.nontaxAmount/));
P("P110092", "the on-top GST base is the taxable base of the 'excl' lines ALONE", has(C_CART, /splitBill\(dispLines\.filter\(\(l\) => l\.tax_mode === "excl"\), taxRules\)\.taxableBase/));
P("P110093", "…so a tax-INSIDE price can never be charged its GST twice", has(C_CART, /l\.tax_mode === "excl"/));
P("P110094", "the stored record's money is a SEPARATE domain from the screen's", has(C_CART, /const usdLines = cart\.map/) && has(C_CART, /const dispLines = cart\.map/));
P("P110095", "…and both go through splitBill, never a hand-rolled second rule", countOf(C_CART, /splitBill\(/g) >= 3);
P("P110096", "…and the stored total keeps its original floating-point shape to the paisa", has(C_CART, /Math\.round\(\(usdOnTopBase \* \(1 \+ taxRate\) \+ \(subtotalUsd - usdOnTopBase\)\) \* 100\) \/ 100/));
P("P110097", "a line's behaviour is decided ONLY by the shared tax rule, never off the dish's raw setting", has(C_CART, /const behaviourOf = \(it: CartItem\) => resolveTaxMode\(dishMode\(it\.id\), taxRules\)/));
P("P110098", "…and a dish whose menu row has not loaded yet falls back to the restaurant's own mode", has(C_CART, /menuItems\.find\(\(m\) => m\.id === id\)\?\.taxMode/));
P("P110099", "the MRP stamp is purely presentational and asks the same shared rule", has(C_CART, /const isMrpLine = \(it: CartItem\) => isMrpDish\(dishMode\(it\.id\), taxRules\)/));
P("P110100", "…and it explains itself on hover, so a missing GST reads as correct rather than as a mistake", has(C_CART, /Maximum Retail Price — this price is final, no tax is added/));

// ── A6 · one line of the basket, as rendered (P110101–P110124) ─────────────────────────────────
P("P110101", "an empty basket says so instead of rendering a blank box", has(C_CART, /Your cart is empty/));
P("P110102", "…and everything below the list is hidden when there is nothing in it", has(C_CART, /\{cart\.length > 0 && \(/));
P("P110103", "each line's key includes its options signature, so two of one dish stay apart", has(C_CART, /key=\{`\$\{item\.id\}-\$\{item\.sig \|\| ""\}-\$\{idx\}`\}/));
P("P110104", "a SOLD-OUT line wears a badge in the basket", has(C_CART, /\{isSoldOut\(item\.id\) && \(/) && has(C_CART, /Sold out/));
P("P110105", "chosen options are listed under the dish name", has(C_CART, /\{item\.options && item\.options\.length > 0 && \(/));
P("P110106", "…removed allergens are shown, and marked apart in red", has(C_CART, /\{item\.removed && item\.removed\.length > 0 && \(/));
P("P110107", "…and each is named in words, not by its slug", has(C_CART, /item\.removed\.map\(\(r\) => allergenLabel\(r\)\.toLowerCase\(\)\)/));
P("P110108", "a kitchen note is shown in quotes, so it reads as the diner's own words", has(C_CART, /\{item\.note && <div className="cart-item-opts">“\{item\.note\}”/));
P("P110109", "the − and + buttons are 32px, the floor this product uses for adjacent taps", has(C_CART, /width: "32px", height: "32px"/));
P("P110110", "…and each names its dish for a screen reader, not just '+'", has(C_CART, /aria-label=\{`Decrease \$\{item\.title\}`\}/) && has(C_CART, /aria-label=\{`Increase \$\{item\.title\}`\}/));
P("P110111", "the remove button names its dish too", has(C_CART, /aria-label=\{`Remove \$\{item\.title\}`\}/));
P("P110112", "…and has real padding, so it is not an 18px icon to hit", has(C_CART, /remove-item"[\s\S]{0,160}padding: "8px"/));
P("P110113", "Edit is offered on every dish still on the menu, not only customisable ones", has(C_CART, /const canEdit = \(id: string\) => !!menuItems\.find\(\(m\) => m\.id === id\)/));
P("P110114", "…and hidden for a dish that has left it, where the popup would have nothing to open", has(C_CART, /\{canEdit\(item\.id\) && \(/));
P("P110115", "editing re-opens the popup PRE-FILLED with what the line already holds", has(C_CART, /preselect: \{ options: it\.options, removed: it\.removed, note: it\.note, qty: it\.qty \}/));
P("P110116", "…identified by the line's signature, so the right line is replaced", has(C_CART, /editSig: it\.sig \|\| "\[\]"/));
P("P110117", "…and it refuses rather than opening an empty popup for a dish that is gone", has(C_CART, /const dish = menuItems\.find\(\(m\) => m\.id === it\.id\);\s*\n\s*if \(!dish\) return;/));
P("P110118", "'−' at one removes the line rather than sitting at zero", has(C_CART, /else next\.splice\(idx, 1\);/));
P("P110119", "a line's value is qty × the unit, with add-ons rounded the way the popup rounds them", has(C_CART, /unitDisplay\(parseFloat\(it\.price\), \(it\.options \|\| \[\]\)\.map\(\(o\) => o\.price \|\| 0\), currency \|\| undefined\) \* it\.qty/));
P("P110120", "…and a missing add-on price counts as zero rather than NaN", has(C_CART, /o\.price \|\| 0/));
P("P110121", "the sold-out set is built from the dish's own tags, the same source the cards use", has(C_CART, /menuItems\.filter\(\(m\) => \(m\.tags \|\| \[\]\)\.includes\("sold-out"\)\)/));
P("P110122", "…and a dish with no tags cannot throw", has(C_CART, /\(m\.tags \|\| \[\]\)/));
P("P110123", "the basket list has its own scroll region", has(C_CART, /id="cart-list" className="cart-list"/));
P("P110124", "…and the wheel hand-off only runs on the tab that needs it", has(C_CART, /if \(!open \|\| showHistory\) return;/));

// ── A7 · the scroll hand-off, the timers and the listeners (P110125–P110144) ───────────────────
P("P110125", "the hand-off only takes over once the inner list can scroll no further", has(C_CART, /if \(\(goingDown && atBottom\) \|\| \(!goingDown && atTop\)\)/));
P("P110126", "…and it normalises wheel units, so a line- or page-scroll does not jump", has(C_CART, /e\.deltaMode === 1 \? 16 : e\.deltaMode === 2 \? panel\.clientHeight : 1/));
P("P110127", "…it is registered non-passive, or preventDefault would do nothing", has(C_CART, /\{ passive: false \}/));
P("P110128", "…and it is removed again on teardown", has(C_CART, /list\.removeEventListener\("wheel", onWheel\)/));
P("P110129", "…and it does nothing at all when the elements are not on screen", has(C_CART, /if \(!list \|\| !panel\) return;/));
P("P110130", "the live-order refresh timer runs ONLY while the bill is open", has(C_CART, /if \(!open\) return;\s*\n\s*const refreshLive/));
P("P110131", "…and is cleared when it closes, so a shut bill holds no timer", has(C_CART, /return \(\) => clearInterval\(iv\);\s*\n\s*\}, \[open\]\)/));
P("P110132", "every listener the setup effect adds is removed in its cleanup", (() => {
  const add = new Set([...C_CART.matchAll(/window\.addEventListener\("([^"]+)"/g)].map((m) => m[1]));
  const rem = new Set([...C_CART.matchAll(/window\.removeEventListener\("([^"]+)"/g)].map((m) => m[1]));
  return [...add].every((e) => rem.has(e));
})());
P("P110133", "…so re-running it on a restaurant change cannot double-subscribe", has(C_CART, /\}, \[restaurantId, features\.allergies\]\)/));
P("P110134", "the effect re-runs when the allergy SWITCH resolves, not only the restaurant", has(C_CART, /features\.allergies\]\)/));
P("P110135", "settings are re-read on every open, so a freshly-flipped toggle is respected", has(C_CART, /handleOpen[\s\S]{0,400}getSettings\(restaurantId\)\.then/));
P("P110136", "…and a failed settings read cannot stop the bill opening", has(C_CART, /getSettings\(restaurantId\)[\s\S]{0,200}\.catch\(\(\) => \{\}\)/));
P("P110137", "the back button closes the bill rather than leaving the site", has(C_CART, /useBackClose\("cart", open, \(\) => setOpen\(false\)\)/));
P("P110138", "…registered under its own name, so the popup above it closes first", has(C_CART, /useBackClose\("cart"/));
P("P110139", "the backdrop closes everything when tapped", has(C_CART, /className="overlay active" onClick=\{\(\) => window\.dispatchEvent\(new Event\("lfh:close-all"\)\)\}/));
P("P110140", "both top-bar controls close it too", countOf(C_CART, /new Event\("lfh:close-all"\)\)\}/g) >= 3);
P("P110141", "…and the ✕ is labelled, not an icon alone", has(C_CART, /aria-label="Close cart"/));
P("P110142", "the panel draws NOTHING at all while shut", has(C_CART, /if \(!open\) return null;/));
P("P110143", "…which is checked before any of the render work, not after it", C_CART.indexOf("if (!open) return null;") < C_CART.indexOf('className="overlay active"'));
P("P110144", "the Place Order button is disabled while one is being sent, and says so", has(C_CART, /disabled=\{placing\}/) && has(C_CART, /\{placing \? "Placing…" : "Place Order"\}/));

// ── A8 · the table field, and what the diner is told about it (P110145–P110160) ────────────────
P("P110145", "a seated diner's table is locked and read-only, not merely styled that way", has(C_CART, /disabled=\{!!lockedTable\} readOnly=\{!!lockedTable\}/));
P("P110146", "…and the value shown is the session's, not whatever was typed before", has(C_CART, /value=\{lockedTable \|\| tableNumber\}/));
P("P110147", "…with a note saying why it cannot be changed, and how to change it", has(C_CART, /You&apos;re at table \{lockedTable\}/) && has(C_CART, /Leave the table/));
P("P110148", "a QR-scanned table says where the number came from", has(C_CART, /from your table&apos;s QR/));
P("P110149", "…and that note appears only while the field still holds exactly that number", has(C_CART, /scannedTable && tableNumber === scannedTable/));
P("P110150", "only digits can reach the field", has(C_CART, /setTableNumber\(e\.target\.value\.replace\(\/\\D\/g, ""\)\)/));
P("P110151", "…it is capped at four characters", has(C_CART, /maxLength=\{4\}/));
P("P110152", "…it asks the phone for a number pad", has(C_CART, /inputMode="numeric" pattern="\[0-9\]\*"/));
P("P110153", "…and it is labelled for a screen reader beyond its placeholder", has(C_CART, /aria-label="Table number"/));
P("P110154", "a remembered table only ever fills an EMPTY field", has(C_CART, /setTableNumber\(\(cur\) => cur \|\| scanned\)/));
P("P110155", "…and is let go of when the diner clears it elsewhere", has(C_CART, /if \(previous\) setTableNumber\(\(cur\) => \(cur === previous \? "" : cur\)\)/));
P("P110156", "…never touching a number the diner typed into the bill itself", has(C_CART, /cur === previous \? "" : cur/));
P("P110157", "a bad table stops the send and FLAGS the field, rather than failing quietly", has(C_CART, /flagTableInput\("cart-table", check\.message!\)/));
P("P110158", "the owner's refusal of an offline table bound is recorded ON this field", has(CART, /REJECTED \(owner, 2026-09-14\)/));
P("P110159", "…and it points at the list where the decision lives", has(CART, /REJECTED-IDEAS\.md R55/));
P("P110160", "the placeholder still says the field is required, and fits a 360px phone", has(C_CART, /placeholder="Table number \(required\)"/));


console.log("\n══ BLOCK B · components/OrderTracker.tsx — the floating strip (P110161–P110230) ══");

// ── B1 · what the strip chooses to show (P110161–P110182) ──────────────────────────────────────
P("P110161", "the strip draws nothing when there is nothing live to show", has(C_TRACK, /if \(!order\) return null;/));
P("P110162", "…and it picks from the LIVE orders only, with hidden ones filtered out", has(C_TRACK, /liveActiveOrders\(orders\)\.filter\(\(o\) => !o\.stripHidden\)/));
P("P110163", "an unexpected status falls back to 'preparing' rather than crashing on a missing label", has(C_TRACK, /COPY\[order\.status\] \|\| COPY\.preparing/));
P("P110164", "…so a staff-only 'ready' never reaches a diner as a blank strip", has(C_TRACK, /COPY\.preparing/));
P("P110165", "several live orders turn the strip into a table-level summary", has(C_TRACK, /const multi = visible\.length >= 2 && !dismissing/));
P("P110166", "…but never while one is mid fly-out, which would swap the picture under the animation", has(C_TRACK, /&& !dismissing/));
P("P110167", "per-dish mode is used when the table's dish statuses are known", has(C_TRACK, /const dishMode = dishProg\.segs\.length > 0 && !dismissing/));
P("P110168", "…and it too stands down during the animation", countOf(C_TRACK, /&& !dismissing/g) >= 2);
P("P110169", "an order with NOTHING accepted yet stays amber, not blue", has(C_TRACK, /dishProg\.segs\.some\(\(s\) => s !== "received"\) \? "preparing" : "received"/));
P("P110170", "…and the same rule holds for the multi-order summary", has(C_TRACK, /visible\.some\(\(o\) => o\.status !== "received"\) \? "preparing" : "received"/));
P("P110171", "…green only once every one of them is served", has(C_TRACK, /servedCount === visible\.length \? "served"/));
P("P110172", "the three modes pick the strip's colour in one place, not three", has(C_TRACK, /const stripStatus = dishMode \? dishStatus : multi \? multiStatus : order\.status/));
P("P110173", "the summary counts dishes served out of the total", has(C_TRACK, /\$\{dishProg\.served\} of \$\{dishProg\.segs\.length\} dishes served/));
P("P110174", "…and orders served out of the total in the other mode", has(C_TRACK, /\$\{servedCount\} of \$\{visible\.length\} orders served/));
P("P110175", "one bar segment per dish, so the table sees WHICH are still cooking", has(C_TRACK, /dishProg\.segs\.map\(\(s, i\) =>/));
P("P110176", "…one per order in the other mode", has(C_TRACK, /visible\.map\(\(o\) =>/));
P("P110177", "…and the step dots only for a single order with a real step", has(C_TRACK, /stepIndex >= 0 && \(/));
P("P110178", "a guest never sees the staff-only 'ready' stage — it reads as still cooking", has(C_TRACK, /i\.status === "ready" \? "preparing" : i\.status/));
P("P110179", "…while the SERVED count is unaffected by that translation", has(C_TRACK, /sItems\.filter\(\(i\) => i\.status === "served"\)\.length/));
P("P110180", "the strip is a real button, so a keyboard can reach it", has(C_TRACK, /<button\s*\n?\s*type="button"\s*\n?\s*ref=\{stripRef\}/));
P("P110181", "…Enter and Space open it, and neither scrolls the page instead", has(C_TRACK, /if \(e\.key === "Enter" \|\| e\.key === " "\) \{ e\.preventDefault\(\); openDetail\(\); \}/));
P("P110182", "…and it says what it is and what can be done with it", has(C_TRACK, /aria-label="Order status — tap to view, drag onto the cross to hide"/));

// ── B2 · the table's shared progress (P110183–P110200) ─────────────────────────────────────────
P("P110183", "the table-wide pull only runs when this restaurant has sessions ON", has(C_TRACK, /on = \(await getSettings\(restaurantId\)\)\.sessionsEnabled/));
P("P110184", "…and a failed settings read cannot stop the widget", has(C_TRACK, /catch \{\}\s*\n\s*if \(!alive \|\| !on\) return;/));
P("P110185", "…and it stops the moment the widget goes away", has(C_TRACK, /if \(!alive\) return;/));
P("P110186", "no session means no per-dish bar, rather than a stale one", has(C_TRACK, /if \(!s\) \{ if \(alive\) setDishProg\(\{ served: 0, segs: \[\] \}\); return; \}/));
P("P110187", "a PENDING member sees no live progress at all", has(C_TRACK, /if \(!mem\?\.approved\) \{ setDishProg\(\{ served: 0, segs: \[\] \}\); return; \}/));
P("P110188", "…which mirrors the server withholding it, rather than replacing that guard", has(C_TRACK, /mem\?\.approved/));
P("P110189", "only three DEFINITIVE endings clear this device's orders", has(C_TRACK, /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/));
P("P110190", "…so a momentary network blip cannot wipe a live order", has(C_TRACK, /setDishProg\(\{ served: 0, segs: \[\] \}\);\s*\n\s*return;/));
P("P110191", "…and when they do fire, the strip is told to re-read and vanish", has(C_TRACK, /tremove\("lfh_active_orders"\);\s*\n\s*window\.dispatchEvent\(new Event\("lfh:order-placed"\)\)/));
P("P110192", "a partner's order is adopted so every member watches the same table", has(C_TRACK, /if \(have\.has\(o\.id\)\) continue;/));
P("P110193", "…without double-adding one this device already placed", has(C_TRACK, /const have = new Set\(list\.map\(\(o\) => o\.id\)\)/));
P("P110194", "…carrying the table the SESSION says, not whatever the phone remembered", has(C_TRACK, /const table = sess\?\.table_number \|\| s\.table/));
P("P110195", "…its real placed-at time, so it ages correctly", has(C_TRACK, /placedAt: Date\.parse\(o\.created_at\) \|\| Date\.now\(\)/));
P("P110196", "…a total that cannot become NaN", has(C_TRACK, /total: Number\(o\.total\) \|\| 0/));
P("P110197", "…and an item count summed from the quantities, not the line count", has(C_TRACK, /items\.reduce\(\(a, i\) => a \+ \(Number\(i\.qty\) \|\| 1\), 0\)/));
P("P110198", "…with a non-array items payload read as empty rather than throwing", has(C_TRACK, /Array\.isArray\(o\.items\) \? o\.items\.map/));
P("P110199", "the pull writes only when something actually changed", has(C_TRACK, /if \(changed\) \{ write\(list\); refresh\(\); broadcast\(\); \}/));
P("P110200", "…and both its timer and its listener are removed on teardown", has(C_TRACK, /if \(iv\) clearInterval\(iv\); if \(onTick\) window\.removeEventListener\("lfh:rt-tick", onTick\)/));

// ── B3 · the polling round, and what it is allowed to write (P110201–P110218) ──────────────────
P("P110201", "only orders still in progress are asked about", has(C_TRACK, /!o\.dismissed && !isFinal\(o\.status\)/));
P("P110202", "…and never one older than the age ceiling", has(C_TRACK, /Date\.now\(\) - o\.placedAt < MAX_AGE_MS/));
P("P110203", "…and a round with nothing to ask makes no request at all", has(C_TRACK, /if \(live\.length === 0\) return;/));
P("P110204", "what a round LEARNED is applied onto a FRESH read, never a stale copy", has(C_TRACK, /const fresh = read\(\)\.map\(\(o\) =>/));
P("P110205", "…so an order added or hidden mid-round keeps what it was given", has(C_TRACK, /const learned = new Map/));
P("P110206", "…and one that has since left the list is never resurrected", has(C_TRACK, /seen \? \{ \.\.\.o, status: seen\.status/));
P("P110207", "a missing order is NOT counted while the phone reports itself offline", has(C_TRACK, /if \(typeof navigator !== "undefined" && navigator\.onLine === false\) continue;/));
P("P110208", "…and only three consecutive online misses finalise it", has(C_TRACK, /nullCounts\.current\[o\.id\] >= 3 && !isFinal\(o\.status\)/));
P("P110209", "…with a real answer resetting the counter", has(C_TRACK, /nullCounts\.current\[o\.id\] = 0;/));
P("P110210", "…and the diner is TOLD when one is finalised that way", has(C_TRACK, /message: "Order no longer active"/));
P("P110211", "a status toast fires on the FIRST sighting of each status, not every poll", has(C_TRACK, /if \(lastStatus\.current\[o\.id\] !== res\.status\)/));
P("P110212", "…a cancellation is flavoured as an error, not a success", has(C_TRACK, /variant: res\.status === "cancelled" \? "error" : "success"/));
P("P110213", "…and tapping it opens the LIVE tab, not the bill", has(C_TRACK, /event: "lfh:show-previous-orders"/));
P("P110214", "a finish time is stamped once, and never overwritten", has(C_TRACK, /if \(isFinal\(res\.status\) && !o\.finalizedAt\) o\.finalizedAt = Date\.now\(\)/));
P("P110215", "…and an already-final order missing one is backfilled so it can auto-clear", has(C_TRACK, /if \(isFinal\(o\.status\) && !o\.finalizedAt\)/));
P("P110216", "…written back only if something was actually patched", has(C_TRACK, /if \(changed\) write\(list\);/));
P("P110217", "the one-shot redraw timer is armed only for a moment still in the FUTURE", has(C_TRACK, /\(o\.finalizedAt as number\) \+ SERVED_LINGER_MS > now/));
P("P110218", "…and not at all when nothing is pending, so a served order cannot loop the phone", has(C_TRACK, /if \(pending\.length === 0\) return;/));

// ── B4 · the drag, the drop and the animation (P110219–P110230) ────────────────────────────────
P("P110219", "the drop target only exists while a drag is happening", has(C_TRACK, /\{drag && \(/));
P("P110220", "…and is hidden from a screen reader, being a pointer affordance", /ot-dropzone[\s\S]{0,60}aria-hidden="true"/.test(C_TRACK));
P("P110221", "…and it says what releasing will do", has(C_TRACK, /drag\.over \? "Release to hide" : "Drop here to hide"/));
P("P110222", "a small wobble is a TAP, not a drag", has(C_TRACK, /if \(!d\.moved && Math\.hypot\(dx, dy\) < 8\) return;/));
P("P110223", "…and a tap opens the detail rather than hiding anything", has(C_TRACK, /if \(!d\.moved\) \{ openDetail\(\); return; \}/));
P("P110224", "the pointer is captured immediately, so a fast flick off the strip still lands", has(C_TRACK, /stripRef\.current\?\.setPointerCapture\(e\.pointerId\)/));
P("P110225", "…and released again on both end and cancel", countOf(C_TRACK, /releasePointerCapture/g) >= 2);
P("P110226", "the OS cancelling the gesture resets the strip cleanly", has(C_TRACK, /const onPointerCancel[\s\S]{0,300}setDrag\(null\)/));
P("P110227", "the order being flown into the cross is FROZEN, so a new one cannot swap in mid-animation", has(C_TRACK, /dismissingOrderRef\.current = order;/));
P("P110228", "…and released once it finishes", has(C_TRACK, /dismissingOrderRef\.current = null;/));
P("P110229", "hiding the combined strip hides ALL of its orders, not just the top one", has(C_TRACK, /if \(wasMulti\) \{ write\(read\(\)\.map\(\(o\) => \(allIds\.includes\(o\.id\)/));
P("P110230", "…and hiding is never cancelling — the order stays in the list", has(C_TRACK, /\{ \.\.\.o, stripHidden: true \}/) && !has(C_TRACK, /status: "cancelled"[\s\S]{0,80}stripHidden/));

console.log("\n══ BLOCK C · lib/menu.ts — the guest data layer (P110231–P110290) ══");

P("P110231", "a dish row is mapped defensively — every column has a default", has(C_MENU, /function mapRow\(row: any, agg\?: RatingAgg\): MenuItem/));
P("P110232", "…and a column the read did not ask for is filled, not left undefined", has(C_MENU, /const has = \(row: any, col: string\) => row != null && Object\.prototype\.hasOwnProperty\.call\(row, col\)/));
P("P110233", "the card read asks for a COLUMN LIST, never everything", has(C_MENU, /export const CARD_COLUMNS =/));
P("P110234", "…and the grid read is capped", has(C_MENU, /from\("menu_items"\)\.select\(columns\)[\s\S]{0,120}\.limit\(2000\)/));
P("P110235", "…scoped to one restaurant", has(C_MENU, /\.eq\("restaurant_id", restaurantId\)/));
P("P110236", "the ratings read is column-listed, scoped and capped too", has(C_MENU, /from\("item_ratings"\)\.select\("item_slug, avg_rating, review_count"\)\.eq\("restaurant_id", restaurantId\)\.limit\(2000\)/));
P("P110237", "…and a ratings failure never hides the menu", has(C_MENU, /aggBySlug = new Map<string, RatingAgg>\(\(\(ratings\.data as RatingAgg\[\] \| null\) \?\? \[\]\)/));
P("P110238", "…while a DISH read failure is raised, because an empty menu is not an answer", has(C_MENU, /if \(items\.error\) throw new Error\(`Failed to load menu/));
P("P110239", "the detail-only fields are stripped off the card payload", has(C_MENU, /const DETAIL_ONLY = \[/));
P("P110240", "…by an Omit, so a new column reaches the cards automatically", has(C_MENU, /export type MenuCardItem = Omit<MenuItem,/));
P("P110241", "…and the two lists cannot drift, because the mapper walks the same constant", has(C_MENU, /for \(const k of DETAIL_ONLY\) delete out\[k\]/));
P("P110242", "the category set is read once per burst, shared by simultaneous callers", has(C_MENU, /const catSetInflight = new Map<string, Promise<Set<string> \| null>>\(\)/));
P("P110243", "…and the in-flight entry is dropped the moment it settles, so nothing goes stale", has(C_MENU, /\.finally\(\(\) => \{ catSetInflight\.delete\(restaurantId\); \}\)/));
P("P110244", "…keyed per restaurant, so one tenant's answer cannot serve another", has(C_MENU, /catSetInflight\.get\(restaurantId\)/));
P("P110245", "…and that read is column-listed, scoped and capped", has(C_MENU, /from\("categories"\)\s*\n?\s*\.select\("slug"\)[\s\S]{0,160}\.limit\(300\)/));
P("P110246", "'we could not tell' is NULL and means do-not-filter, never blank-the-menu", has(C_MENU, /if \(error \|\| !data \|\| data\.length === 0\) return null;/));
P("P110247", "…and the filter honours that distinction", has(C_MENU, /return live \? items\.filter\(\(i\) => live\.has\(i\.category\)\) : items/));
P("P110248", "…and an already-fetched category list can be handed in to skip the read entirely", has(C_MENU, /liveCatsIn !== undefined \? liveCatsIn : activeCategorySlugs\(restaurantId\)/));
P("P110249", "…with `undefined` and `null` meaning different things, deliberately", has(C_MENU, /liveCatsIn\?: Set<string> \| null/));
P("P110250", "an OPEN-PRICE dish is kept off the guest menu", has(C_MENU, /\.filter\(\(it\) => !it\.openPrice && !isHidden\(it\.tags\)\)/));
P("P110251", "…and off its own page, so a kept link cannot reach one", has(C_MENU, /if \(mapped\.openPrice\) return null;/));
P("P110252", "a HIDDEN dish is dropped by the same filter", has(C_MENU, /isHidden\(it\.tags\)/));
P("P110253", "…and its page answers 'no such dish' too", has(C_MENU, /if \(isHidden\(mapped\.tags\)\) return null;/));
P("P110254", "…and a dish whose CATEGORY is off is unreachable by its own URL as well", has(C_MENU, /if \(liveCats && !liveCats\.has\(mapped\.category\)\) return null;/));
P("P110255", "…while a null category set hides nothing, which is the safe direction", has(C_MENU, /liveCats &&/));
P("P110256", "SOLD OUT is a tag, not a column, so it rides the editor's existing plumbing", has(C_MENU, /export const SOLD_OUT_TAG = "sold-out"/));
P("P110257", "…and a sold-out dish is still SHOWN, wearing its badge", !has(C_MENU, /includes\(SOLD_OUT_TAG\)\)[\s\S]{0,40}return null/));
P("P110258", "the dish page no longer pulls twenty review rows on every open", !has(C_MENU, /getMenuItem[\s\S]{0,600}from\("reviews"\)/));
P("P110259", "the review list read is column-listed and capped", has(C_MENU, /\.select\("name, stars, comment, device_id, created_at"\)[\s\S]{0,200}\.limit\(20\)/));
P("P110260", "the categories read is capped as well", has(C_MENU, /from\("categories"\)[\s\S]{0,200}\.limit\(300\)/));
P("P110261", "settings are cached per restaurant with a short TTL", has(C_MENU, /const SETTINGS_TTL_MS = 8000/));
P("P110262", "…simultaneous callers share ONE request", has(C_MENU, /const settingsInflight = new Map<string, Promise<Settings>>\(\)/));
P("P110263", "…and a breadcrumb can force a genuine re-read", has(C_MENU, /export function invalidateSettings/));
P("P110264", "…which drops BOTH maps, or a request already in flight would settle the old row back in", has(C_MENU, /settingsCache\.delete\(restaurantId\);\s*\n\s*settingsInflight\.delete\(restaurantId\)/));
P("P110265", "settings come through ONE definer function, not a table-wide read", has(C_MENU, /\.rpc\("lfh_guest_settings", \{ p_restaurant_id: restaurantId \}\)/));
P("P110266", "…so a key the function stops returning degrades instead of breaking the menu", has(C_MENU, /data \? data\.bubbles_enabled !== false : true/));
P("P110267", "a missing table count disables the upper-bound check rather than blocking every order", has(C_MENU, /Number\(data\.table_count\) \|\| 0/));
P("P110268", "flags that default ON use `!== false`, and flags that default OFF use `=== true`", has(C_MENU, /sessions_enabled === true/) && has(C_MENU, /require_location !== false/));
P("P110269", "a malformed feature override is ignored rather than trusted", has(C_MENU, /\.filter\(\(\[, v\]\) => typeof v === "boolean"\)/));
P("P110270", "…and a non-object features blob falls back to empty", has(C_MENU, /data && data\.features && typeof data\.features === "object"/));
P("P110271", "the tax rate comes from the shared rule, never a local formula", has(C_MENU, /taxRate: effectiveTaxRate\(data\)/));
P("P110272", "…and so do the three price behaviours", has(C_MENU, /priceTaxMode: priceTaxMode\(data \?\? \{\}\)/));
P("P110273", "…with a restaurant that has no row landing on today's behaviour", has(C_MENU, /data \?\? \{\}/));
P("P110274", "the camelCase Settings is translated into the DB-named tax shape in ONE adapter", has(C_MENU, /export function taxRulesOf\(s: Settings\): TaxRules/));
P("P110275", "…so a component never hand-builds it and never silently leaves a field out", has(C_MENU, /export type TaxRules = \{/));
P("P110276", "the defaults are today's behaviour exactly, so the quote never changes shape mid-load", has(C_MENU, /export const DEFAULT_TAX_RULES: TaxRules = \{/));
P("P110277", "a language list falls back to a sensible default rather than an empty picker", has(C_MENU, /strList\(data\?\.menu_languages, \["en"\]\)/));
P("P110278", "…and so does the currency list", has(C_MENU, /strList\(data\?\.menu_currencies, \["INR"\]\)/));
P("P110279", "…and that helper refuses a non-list", has(C_MENU, /function strList\(v: unknown, fallback: string\[\]\)/));
P("P110280", "dish NAMES are deliberately not machine-translated", has(MENU, /DISH NAMES AND DESCRIPTIONS ARE NOT TRANSLATED/));
P("P110281", "…and the localiser falls back rather than rendering an empty string", has(C_MENU, /export function localized\(text: LocalizedText \| undefined, lang: string\): string/));
P("P110282", "a guest order carries NO price to the server", !has(C_MENU, /items: o\.items[\s\S]{0,200}price/));
P("P110283", "…and its shape is id + qty + options + removed + note, nothing else", has(C_MENU, /items: \{ id: string; qty: number; options\?: \{ group: string; label: string \}\[\]; removed\?: string\[\]; note\?: string \}\[\]/));
P("P110284", "a table correction only works while the order is still open", has(C_MENU, /\.rpc\("set_order_table_number"/));
P("P110285", "…and proves a row was really updated before reporting success", has(C_MENU, /return !error && Array\.isArray\(data\) && data\.length > 0;/));
P("P110286", "…and it carries a deadline, so the Saving… button cannot wedge", has(C_MENU, /set_order_table_number[\s\S]{0,200}abortSignal/));
P("P110287", "the bell call carries one too", has(C_MENU, /lfh_call_waiter_table[\s\S]{0,200}abortSignal/));
P("P110288", "…and hands back the RPC's own answer so the popup can tell the truth", has(C_MENU, /return \{ ok: res\.ok !== false, reason: res\.reason \}/));
P("P110289", "…treating a missing ok as success, which is what the RPC means by it", has(C_MENU, /res\.ok !== false/));
P("P110290", "a real transport failure on the bell is raised, not swallowed as 'sent'", has(C_MENU, /if \(error\) throw new Error\(`Call failed/));


console.log("\n══ BLOCK D · lib/guestOutbox.ts — the saved-work queue (P110291–P110330) ══");

P("P110291", "the queue lives in IndexedDB, so it survives a reload", has(C_OUT, /indexedDB\.open\(DB_NAME, 1\)/));
P("P110292", "…with one store keyed by the at-most-once id", has(C_OUT, /createObjectStore\(STORE, \{ keyPath: "id" \}\)/));
P("P110293", "…and the database handle is opened once and shared", has(C_OUT, /if \(dbPromise\) return dbPromise;/));
P("P110294", "a read that cannot open the database answers empty rather than throwing", has(C_OUT, /async function idbAll\(\)[\s\S]{0,400}catch \{ return \[\]; \}/));
P("P110295", "a WRITE reports honestly whether it really reached storage", has(C_OUT, /function idbWrite\(fn: \(s: IDBObjectStore\) => void\): Promise<boolean>/));
P("P110296", "…resolving false on abort as well as on error", has(C_OUT, /tx\.onabort = \(\) => reject\(tx\.error\)/) && has(C_OUT, /\.catch\(\(\) => false\)/));
P("P110297", "…so the caller can avoid promising durability it does not have", has(C_OUT, /const persisted = await persist\(item\)/));
P("P110298", "the id is a real uuid where the browser can make one", has(C_OUT, /globalThis\.crypto\?\.randomUUID/));
P("P110299", "…with a fallback that still produces a v4-shaped id on an older phone", has(C_OUT, /xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx/));
P("P110300", "offline is read through a FUNCTION, so it is re-evaluated each pass", has(C_OUT, /const isOffline = \(\) => typeof navigator !== "undefined" && navigator\.onLine === false/));
P("P110301", "the snapshot handed to React is a fresh object each change", has(C_OUT, /function recompute\(\) \{ snapshot = \{ queued: queued\.slice\(\), failed: failed\.slice\(\)/));
P("P110302", "…so useSyncExternalStore actually re-renders", has(C_OUT, /export function useGuestOutbox\(\) \{ return useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\); \}/));
P("P110303", "…and the server snapshot is a STABLE constant, or React would loop", has(C_OUT, /const EMPTY = \{ queued: \[\] as GuestOrder\[\], failed: \[\] as GuestOrder\[\], count: 0 \}/));
P("P110304", "a listener that throws cannot stop the others being told", has(C_OUT, /listeners\.forEach\(\(l\) => \{ try \{ l\(\); \} catch \{/));
P("P110305", "…and the DOM event is best-effort too", has(C_OUT, /try \{ window\.dispatchEvent\(new CustomEvent\("lfh:guest-outbox-changed"\)\); \} catch/));
P("P110306", "a restore MERGES with what is already in memory, never replaces it", has(C_OUT, /const byId = new Map<string, GuestOrder>\(\)/));
P("P110307", "…memory wins for a row in both, because it may carry fresher attempt counters", has(C_OUT, /for \(const x of queued\) byId\.set\(x\.id, x\)/));
P("P110308", "…and the queue is re-sorted oldest-first, so it drains in the order it was placed", has(C_OUT, /\.sort\(\(a, b\) => a\.at - b\.at\)/));
P("P110309", "…failed rows are merged the same way, not dropped", has(C_OUT, /const failedById = new Map<string, GuestOrder>\(\)/));
P("P110310", "…and a restored queue gets a timer, not a single attempt", has(C_OUT, /ensureRetry\(\);\s*\n\s*void flushGuestOutbox\(\);/));
P("P110311", "a phone that never queued anything is not given a database", has(C_OUT, /indexedDB as \{ databases\?: \(\) => Promise<\{ name\?: string \}\[\]> \}/));
P("P110312", "…and where that cannot be asked, we open it, which is the safe direction", /\} catch \{[^}]*\}\s*restoreQueue\(\);/.test(C_OUT.replace(/\s+/g, " ").replace(/ \}/g, "}").replace(/\{ /g, "{")) || /restoreQueue\(\);/.test(C_OUT.split("catch").pop()));
P("P110313", "four wake-up signals are listened for, not three", ["online","visibilitychange","focus"].every((e) => has(C_OUT, new RegExp(`addEventListener\\("${e}"`))));
P("P110314", "…and visibility only wakes it when the tab became VISIBLE", has(C_OUT, /document\.visibilityState === "visible"/));
P("P110315", "the queue is started once, and never on the server", has(C_OUT, /if \(started \|\| typeof window === "undefined"\) return;/));
P("P110316", "a kind is one of exactly three things", has(C_OUT, /export type GuestKind = "order" \| "call" \| "leave"/));
P("P110317", "…and a row written before `kind` existed is read as an order", has(C_OUT, /const kindOf = \(it: GuestOrder\): GuestKind => \(isCall\(it\) \? "call" : isLeave\(it\) \? "leave" : "order"\)/));
P("P110318", "each kind has its own three 'we could not send this' sentences", has(C_OUT, /const CANT_SEND: Record<GuestKind, \{ unreachable: string; stillBusy: string; refused: string \}>/));
P("P110319", "…all three kinds are present, so a lookup can never be undefined", ["order:","call:","leave:"].every((k) => has(C_OUT, new RegExp(k))));
P("P110320", "…and the ORDER wording still ends in 'please order again', which three guards assert", has(C_OUT, /unreachable: "We couldn't reach the restaurant — please order again\."/));
P("P110321", "…while a call's ends in 'ask a member of staff', which is the advice that works", has(C_OUT, /unreachable: "We couldn't reach the restaurant — please ask a member of staff\."/));
P("P110322", "each kind goes to its OWN endpoint", has(C_OUT, /fetch\("\/api\/guest\/leave"/) && has(C_OUT, /fetch\("\/api\/guest\/call-waiter"/) && has(C_OUT, /fetch\("\/api\/guest\/place-order"/));
P("P110323", "…every one of them carrying the at-most-once header", countOf(C_OUT, /"X-LFH-Action-Id": item\.id/g) === 3);
P("P110324", "…and every one of them carrying a deadline", countOf(C_OUT, /signal: sendDeadline\(\)/g) === 3);
P("P110325", "only the ORDER replay carries the two markers that let the server refuse a moved-on table", has(C_OUT, /"X-LFH-Replay": "1"/) && countOf(C_OUT, /X-LFH-Replay/g) === 1);
P("P110326", "…stamped with when the diner actually saved it", has(C_OUT, /"X-LFH-Queued-At": new Date\(item\.at \|\| Date\.now\(\)\)\.toISOString\(\)/));
P("P110327", "a saved CALL sends when the diner TAPPED, not when the phone got round to it", has(C_OUT, /at: item\.at/));
P("P110328", "the three attempt ceilings are named constants, not numbers in the loop", ["SERVER_MAX_TRIES","NET_MAX_TRIES","BUSY_MAX_TRIES"].every((k) => has(C_OUT, new RegExp(`const ${k} = \\d`))));
P("P110329", "…and all three agree at six rounds", countOf(C_OUT, /_MAX_TRIES = 6/g) === 3);
P("P110330", "one phone cannot pile up unbounded saved work", has(C_OUT, /const MAX_QUEUED = 25/));

console.log("\n══ BLOCK E · app/api/guest/** — the four doors (P110331–P110380) ══");

const ROUTES = { "place-order": C_PL, "call-waiter": C_CW, leave: C_LV, "limit-hit": C_LH };
let i = 331;
for (const [name, src] of Object.entries(ROUTES)) {
  P(`P110${i++}`, `${name}: is force-dynamic, so no answer is ever cached`, has(src, /export const dynamic = "force-dynamic"/));
  P(`P110${i++}`, `${name}: sets no server-side timer or interval of its own`, !has(src, /setInterval\(|setTimeout\(/));
  P(`P110${i++}`, `${name}: never logs the diner's own words`, !has(src, /console\.(log|error|warn)\([^)]*b\.(reason|items|allergies)/));
  P(`P110${i++}`, `${name}: every read it makes is column-listed and capped`, !has(src, /\.select\("\*"\)/) && (!has(src, /\.from\(/) || has(src, /\.limit\(1\)/)));
}
P("P110347", "the three WRITING doors are at-most-once; the beacon deliberately is not", countOf(C_PL + C_CW + C_LV, /withIdempotency\(postImpl, "guest"\)/g) === 3 && !has(C_LH, /withIdempotency/));
P("P110348", "…all three under the same 'guest' scope, so one diner's replays share a namespace", countOf(C_PL + C_CW + C_LV, /"guest"\)/g) >= 3);
P("P110349", "a malformed body is a 400 with a CODE on all three writing doors", countOf(C_PL + C_CW + C_LV, /reason: "bad_body" \}, \{ status: 400 \}/g) === 3);
P("P110350", "…and the beacon answers 200 even to one, because it must never surface an error", has(C_LH, /try \{ b = await req\.json\(\); \} catch \{/) && has(C_LH, /return NextResponse\.json\(\{ ok: true \}\);/) && countOf(C_LH, /return NextResponse/g) === 1);
P("P110351", "a database that will not answer is BUSY on all three writing doors, never a refusal", countOf(C_PL + C_CW + C_LV, /reason: "server_busy"/g) === 3);
P("P110352", "…each answering 502, so the phone keeps the request", countOf(C_PL + C_CW + C_LV, /status: 502/g) === 3);
P("P110353", "…each sending a spread wait, so a thousand phones do not return together", countOf(C_PL + C_CW + C_LV, /20 \+ Math\.floor\(Math\.random\(\) \* 25\)/g) === 3);
P("P110354", "…as a real Retry-After header as well as a body field", countOf(C_PL + C_CW + C_LV, /"Retry-After": String\(retryAfter\)/g) === 3);
P("P110355", "the database's own words never travel to a diner from any door", !has(C_PL + C_CW + C_LV, /reason: error\.message/));
P("P110356", "…the detail stays in the server log instead", countOf(C_PL + C_CW + C_LV, /console\.error\("\[guest\//g) >= 3);
P("P110357", "a session order refuses a body with no token", has(C_PL, /if \(!b\.token\) return NextResponse\.json\(\{ ok: false, reason: "invalid_token" \}, \{ status: 400 \}\)/));
P("P110358", "…and so does a session call", has(C_CW, /if \(!b\.token\) return NextResponse\.json\(\{ ok: false, reason: "invalid_token" \}, \{ status: 400 \}\)/));
P("P110359", "…and leaving", has(C_LV, /if \(!b\.token \|\| typeof b\.token !== "string"\)/));
P("P110360", "a QR order that cannot say which restaurant is REFUSED, never guessed at", has(C_PL, /if \(!publicRid\) return NextResponse\.json\(\{ ok: false, reason: "unknown_restaurant" \}, \{ status: 400 \}\)/));
P("P110361", "…and so is a QR bell tap", has(C_CW, /if \(!rid\) return NextResponse\.json\(\{ ok: false, reason: "unknown_restaurant" \}, \{ status: 400 \}\)/));
P("P110362", "…the restaurant is validated as a real uuid, not merely present", countOf(C_PL + C_CW + C_LV, /isUuid = /g) === 3);
P("P110363", "an order carries a ceiling on its lines", has(C_PL, /const MAX_ITEMS = 200/));
P("P110364", "…on its allergy count", has(C_PL, /const MAX_ALLERGIES = 40/));
P("P110365", "…and on each allergy's length", has(C_PL, /const MAX_ALLERGY_LEN = 200/));
P("P110366", "…and going over is a REFUSAL, never a silent trim", has(C_PL, /if \(items\.length > MAX_ITEMS\) return/) && !has(C_PL, /items\.slice\(0, MAX_ITEMS\)/));
P("P110367", "a non-array items or allergies payload is read as empty rather than throwing", has(C_PL, /Array\.isArray\(b\.items\) \? b\.items : \[\]/));
P("P110368", "the waiter note is length-capped before it reaches the database", has(C_CW, /String\(b\.reason \|\| ""\)\.slice\(0, 200\)/));
P("P110369", "a saved call that has gone stale is refused on the server too", has(C_CW, /const STALE_CALL_MS = 10 \* 60 \* 1000/));
P("P110370", "…and that ceiling matches the one on the device", has(C_OUT, /const STALE_CALL_MS = 10 \* 60 \* 1000/));
P("P110371", "…an UNREADABLE timestamp is treated as too old, not waved through", has(C_CW, /if \(hasAt && !Number\.isFinite\(at\)\) return/));
P("P110372", "…while a body with no timestamp at all is an ordinary live call and goes straight through", has(C_CW, /const hasAt = rawAt !== undefined && rawAt !== null && rawAt !== ""/));
P("P110373", "…and it is a plain refusal, not an error, so the phone stops retrying it", has(C_CW, /reason: "call_too_old" \}\)/));
P("P110374", "a floor snapshot is dropped only when something really landed, on all three doors", has(C_PL, /dropFloorIfPlaced/) && has(C_CW, /callLanded/) && has(C_LV, /leaveLanded/));
P("P110375", "…and the three 'no new row' answers are named as codes, never as prose", has(C_CW, /\["already_sent", "capped", "rate_limited"\]/));
P("P110376", "…with the session path's own duplicate answer handled too", has(C_CW, /d\.already_active === true/));
P("P110377", "the restaurant is resolved from the TOKEN when neither the reply nor the body knows", countOf(C_PL + C_CW, /async function ridFromToken/g) === 2);
P("P110378", "…by two single-row, column-listed, capped reads", countOf(C_PL + C_CW, /\.select\("session_id"\)\.eq\("token", token\)\.limit\(1\)\.maybeSingle\(\)/g) === 2);
P("P110379", "…and a failed lookup never costs the diner their order", countOf(C_PL + C_CW, /catch \{ return ""; \}/g) === 2);
P("P110380", "the limit beacon counts per caller AND per limit, so one cannot eat another's budget", has(C_LH, /`limithit:\$\{key\}:\$\{capKeyFor\(req\)\}`/));


console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
if (fails.length) { console.log("\nFAILED:"); fails.forEach((f) => console.log("  " + f)); }
process.exit(fails.length ? 1 : 0);
