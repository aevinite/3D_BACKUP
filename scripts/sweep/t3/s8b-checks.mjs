#!/usr/bin/env node
// SWEEP #8 — TERMINAL 3's SECOND ROUND, STATIC ROWS: P57207..P57466 and P57587..P57646.
//
//   node scripts/sweep/t3/s8b-checks.mjs
//
// ── HOW THIS ROUND WAS PLANNED, AND WHY IT IS NOT ROUND 1 AGAIN ───────────────────────────────────
//
// The owner's word after round 1 was merged and deployed: *"plan 500 phases test within your
// boundaries make sure it cover everthing within your boundries and test everything again if any
// error left"*. So this round was planned by MEASURING the gap rather than by having another idea:
//
//   · every NAMED thing in the territory was enumerated from the source — exported functions,
//     constants, types, React state variables, event names, rendered class names, database function
//     names, refusal codes, feature flags and storage keys: **464 of them**;
//   · every one was then searched for across ALL existing checks — the 2,526 rows of T3.md and the
//     eight check scripts (s7, s7b, s7c, s8 static and live) and verify:basket;
//   · **129 were named by nothing at all.** That list, not a fresh idea, is what this round covers.
//
// The gap has a shape, and it is worth stating because it is where the risk actually was: round 1
// went deep on the saved-work queue and the four routes, and left almost the whole of the bill's
// LIVE-STATUS TAB, the pairing and allergy UI, the tracker's DRAG-TO-HIDE gesture and every one of
// their rendered class names unchecked, plus six of lib/menu's exports (reviews, feedback, order
// status, the category helpers).
//
// This file holds the reading half. The rendered half is scripts/sweep/t3/s8b-live.mjs.
//
// ONE ID SHORT OF 500, DELIBERATELY. This terminal's pre-allocated block is P56701–P57700 and round
// 1 used P56701–P57206, so **494 ids remain and this round is 494 phases, not 500**. The sweep rules
// say to stop and say so rather than take a neighbour's range, and two other terminals have already
// had to renumber off that shared mark today. 494 vs 500 changes no coverage.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "");

const F = {
  cart: read("components/CartPanel.tsx"),
  tracker: read("components/OrderTracker.tsx"),
  outbox: read("lib/guestOutbox.ts"),
  menu: read("lib/menu.ts"),
  place: read("app/api/guest/place-order/route.ts"),
  call: read("app/api/guest/call-waiter/route.ts"),
  leave: read("app/api/guest/leave/route.ts"),
  limit: read("app/api/guest/limit-hit/route.ts"),
  status: read("lib/orderStatus.ts"),
};

let pass = 0;
const fails = [];
const P = (id, name, ok) => {
  if (ok) { pass++; console.log(`ok   ${id} ${name}`); }
  else { fails.push(`${id} ${name}`); console.log(`FAIL ${id} ${name}`); }
};
const between = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return "";
  const rest = src.slice(a);
  const b = to ? rest.indexOf(to) : -1;
  return b > 0 ? rest.slice(0, b) : rest;
};
const count = (src, re) => (src.match(re) || []).length;
/** Is this class name actually RENDERED by the file (not just mentioned in a comment)? */
const renders = (src, cls) => new RegExp(`className=(?:"|\\{\`)[^"\`]*\\b${cls}\\b`).test(src);
const C = F.cart, T = F.tracker, O = F.outbox, M = F.menu;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK A1 — the bill's LIVE-STATUS TAB, by reading (P57207–P57266)
// The single largest blind spot round 1 left: 20 of its rendered pieces were named by nothing.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const liveTab = between(C, "/* ── LIVE-STATUS TAB ── */", "/* ── CURRENT BILL TAB ── */");

P("P57207", "the live tab exists as its own branch, not a second copy of the bill", liveTab.length > 1500);
P("P57208", "…and the two tabs are mutually exclusive, never both drawn", /\{showHistory \? \(/.test(C));
P("P57209", "the shared table bill is the FIRST thing on it, above this device's own orders", liveTab.indexOf("<SessionTableBill />") < liveTab.indexOf("live-orders"));
P("P57210", "the coarse 'Live now' strip is hidden when sessions are ON", /\{!sessionsEnabled && liveOrders\.length > 0 &&/.test(liveTab));
P("P57211", "…because the shared bill already shows per-dish progress there", /SessionTableBill above already shows live per-DISH progress/.test(C));
P("P57212", "…and the empty state is hidden in sessions mode for the same reason", /\{!sessionsEnabled && liveOrders\.length === 0 &&/.test(liveTab));
P("P57213", "the 'Live now' head renders", renders(liveTab, "live-orders-head"));
P("P57214", "…with a live dot", renders(liveTab, "live-dot"));
P("P57215", "…and a count", renders(liveTab, "live-count"));
P("P57216", "…that is the number of live orders, not the number of dishes", /<span className="live-count">\{liveOrders\.length\}<\/span>/.test(liveTab));
P("P57217", "each live order is keyed by its own id, so React cannot mix two up", /key=\{o\.id\}/.test(liveTab));
P("P57218", "…and carries its status in its class, so the colour follows the state", /className=\{`live-order status-\$\{o\.status\}`\}/.test(liveTab));
P("P57219", "each one renders its top row", renders(liveTab, "live-order-top"));
P("P57220", "…the status icon", renders(liveTab, "ot-icon"));
P("P57221", "…the label and subtitle block", renders(liveTab, "live-order-info"));
P("P57222", "…the label itself, from the ONE copy of the status wording", /<div className="live-order-label">\{cp\.label\}<\/div>/.test(liveTab));
P("P57223", "…and the subtitle from the same place", /<div className="live-order-sub">\{cp\.sub\}<\/div>/.test(liveTab));
P("P57224", "the wording comes from lib/orderStatus, never a second copy", /const cp = STATUS_COPY\[o\.status\];/.test(C));
P("P57225", "the table number is shown only when there is one", /\{o\.tableNumber && <span className="live-order-table">Table \{o\.tableNumber\}<\/span>\}/.test(liveTab));
P("P57226", "the step dots render", renders(liveTab, "ot-steps"));
P("P57227", "…only for a status that is ON the happy path", /\{stepIndex >= 0 && \(/.test(liveTab));
P("P57228", "…so a cancelled order draws no progress bar", /const stepIndex = STEPS\.indexOf\(o\.status\);/.test(liveTab));
P("P57229", "…and each dot knows whether it is done and whether it is the current one", /i <= stepIndex \? "done" : ""\} \$\{i === stepIndex \? "active" : ""\}/.test(liveTab));
P("P57230", "the dishes on the order are listed when there are any", /\{o\.items && o\.items\.length > 0 && \(/.test(liveTab));
P("P57231", "…in the same 'title ×qty' shape the tracker uses", /\$\{it\.title\} ×\$\{it\.qty\}/.test(liveTab));
P("P57232", "…inside their own element", renders(liveTab, "live-order-items"));
P("P57233", "the order's total is printed", renders(liveTab, "live-order-total"));
P("P57234", "…through showPrice, which converts the STORED USD at render time", /<span>\{showPrice\(o\.total\)\}<\/span>/.test(liveTab));
P("P57235", "…and showPrice never re-prettifies an order total into ₹10 hops", /const showPrice = \(n: number\) =>/.test(C) && /toMinor\(n \* currency\.rate, currency\)/.test(C));
P("P57236", "…falling back to dollars before the currency has loaded", /: `\$\$\{n\.toFixed\(2\)\}`/.test(C));
P("P57237", "'Wrong table? Fix it' appears only while the order is still early", /\{\(o\.status === "received" \|\| o\.status === "preparing"\) && \(/.test(liveTab));
P("P57238", "…so a served order's table can no longer be moved", !/o\.status === "served"[\s\S]{0,200}live-order-fixlink/.test(liveTab));
P("P57239", "…and it lives HERE because tapping the strip opens THIS tab", /This lives HERE because tapping the floating strip opens THIS tab/.test(C));
P("P57240", "the correction opens an inline editor, not a second popup", renders(liveTab, "live-order-fixtable"));
P("P57241", "…on the order it was tapped for, never on all of them at once", /editingTable === o\.id \? \(/.test(liveTab));
P("P57242", "…pre-filled with the table the order already has", /setTableDraft\(o\.tableNumber \|\| ""\)/.test(C));
P("P57243", "…numeric-only on a phone keyboard", /inputMode="numeric" pattern="\[0-9\]\*" maxLength=\{4\}/.test(liveTab));
P("P57244", "…digits only, whatever is pasted", /setTableDraft\(e\.target\.value\.replace\(\/\\D\/g, ""\)\)/.test(liveTab));
P("P57245", "…with an accessible label, since it has no visible one", /aria-label="Correct table number"/.test(liveTab));
P("P57246", "…focused on open, so a diner can just type", /autoFocus/.test(liveTab));
P("P57247", "…Enter saves it, like every other single-field form", /if \(e\.key === "Enter"\) saveOrderTable\(o\)/.test(liveTab));
P("P57248", "…the Save button is disabled while the save is in flight", /disabled=\{savingTable\}/.test(liveTab));
P("P57249", "…and says so, rather than looking idle", /\{savingTable \? "Saving…" : "Save"\}/.test(liveTab));
P("P57250", "…Cancel closes the editor and changes nothing", /onClick=\{\(\) => setEditingTable\(null\)\}/.test(liveTab));
P("P57251", "the fix link itself renders", renders(liveTab, "live-order-fixlink"));
P("P57252", "…and its words promise what actually happens", /Wrong table\? Fix it — the kitchen sees the change/.test(liveTab));
P("P57253", "the empty state is a sentence and an icon, not a blank panel", /Nothing cooking right now/.test(liveTab));
P("P57254", "…and it says where the orders WILL appear", /Your live orders will show up here/.test(liveTab));
P("P57255", "the live list is read through the ONE rule for what counts as live", /liveActiveOrders\(readActiveOrders\(\)\)/.test(C));
P("P57256", "…refreshed while the tab is open, because the linger is time-based", /const iv = setInterval\(refreshLive, 5000\)/.test(C));
P("P57257", "…and that timer is cleared when the panel closes", /return \(\) => clearInterval\(iv\)/.test(C));
P("P57258", "…and it does not run at all while the bill is shut", /if \(!open\) return;[\s\S]{0,200}const refreshLive/.test(C));
P("P57259", "the red dot on the tab means a live order whose strip was HIDDEN", /const hiddenLive = liveOrders\.some\(\(o\) => o\.stripHidden && !isFinalStatus\(o\.status\)\)/.test(C));
P("P57260", "…and it renders", renders(C, "tab-live-dot"));
P("P57261", "…with a label, because a bare dot means nothing to a screen reader", /aria-label="Live order in progress"/.test(C));
P("P57262", "the tab's own caption counts the live orders", /Live status\{liveOrders\.length \? ` \(\$\{liveOrders\.length\}\)` : ""\}/.test(C));
// s8b self-correction: `!/\(0\)/` matched `useState(0)` on line 93 — my own regex, not a fault.
// The rule is about the CAPTION, so assert the caption: the count is behind a truthiness test, so
// zero renders nothing at all rather than "(0)".
P("P57263", "…and prints nothing rather than '(0)' when there are none",
  /Live status\{liveOrders\.length \? ` \(\$\{liveOrders\.length\}\)` : ""\}/.test(C));
P("P57264", "saveOrderTable refuses a table the restaurant does not have", /const check = validateTable\(tableDraft, tableCount\)/.test(C));
P("P57265", "…and says why, rather than failing silently", /message: check\.message, kicker: "table", variant: "error"/.test(C));
P("P57266", "…and a successful move tells the diner the kitchen was told", /message: `Moved to table \$\{check\.value\}`[\s\S]{0,80}the kitchen has been told/.test(C));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK A2 — the pairing upsell and the allergy section, by reading (P57267–P57316)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
P("P57267", "a pairing is only suggested when there is something in the basket", /cart\.length > 0\s*\n?\s*\? menuItems/.test(C));
P("P57268", "…never a dish already on the bill", /!cartIds\.has\(i\.id\)/.test(C));
P("P57269", "…only from the pairing categories", /PAIR_CATS\.includes\(i\.category\)/.test(C));
P("P57270", "…and those categories are a named list, not inline strings", /const PAIR_CATS = \["coffee", "beverages", "desserts"\]/.test(C));
P("P57271", "…never a sold-out dish, so the '+ Add' can always work", /!\(i\.tags \|\| \[\]\)\.includes\("sold-out"\)/.test(C));
P("P57272", "…and the best-rated of what is left is chosen", /\.sort\(\(a, b\) => \(parseFloat\(b\.rating\) \|\| 0\) - \(parseFloat\(a\.rating\) \|\| 0\)\)\[0\]/.test(C));
P("P57273", "…with an unrated dish treated as zero rather than NaN", /parseFloat\(b\.rating\) \|\| 0/.test(C));
P("P57274", "…and null when there is nothing to suggest", /\|\| null\s*\n?\s*: null;/.test(C));
P("P57275", "the pairing block renders only when there is one", /\{pairing && \(/.test(C));
P("P57276", "…as its own card", renders(C, "pairing-card"));
P("P57277", "…with a label", renders(C, "pairing-label"));
P("P57278", "…the dish's name", renders(C, "pairing-name"));
P("P57279", "…its price", renders(C, "pairing-price"));
P("P57280", "…its picture, only if it has one", /\{pairing\.image && <img/.test(C));
P("P57281", "…with an empty alt, because the name is right beside it", /alt="" className="pairing-img"/.test(C));
P("P57282", "…and an Add button", renders(C, "pairing-add"));
P("P57283", "the pairing price gets the FULL menu treatment, so it matches the card", /unitDisplay\(prettyUsd\(pairing\.price\), \[\], currency \|\| undefined\)/.test(C));
P("P57284", "adding a pairing goes through the same table gate as every other Add", /gateAddToCart\(\(\) => \{/.test(C));
P("P57285", "…bumps the quantity when the dish is already there", /next\[idx\] = \{ \.\.\.next\[idx\], qty: Math\.min\(99, next\[idx\]\.qty \+ 1\) \}/.test(C));
P("P57286", "…capped at 99 like every other add path", /Math\.min\(99, next\[idx\]\.qty \+ 1\)/.test(C));
P("P57287", "…stores the CONFIDENT unit price, so the bill never re-rounds it", /price: prettyUsd\(it\.price\)\.toFixed\(2\)/.test(C));
P("P57288", "…marks it as a plain line so the menu card's +/- can manage it", /sig: "\[\]"/.test(C));
P("P57289", "…and confirms it", /message: `\$\{it\.title\} added`/.test(C));
P("P57290", "the allergy section is gone entirely when the feature is off", /\{features\.allergies && \(/.test(C));
P("P57291", "…and it is a real section with a heading", /Any allergies\? Tap what you avoid/.test(C));
P("P57292", "every preset allergen becomes a chip", /ALLERGENS\.map\(\(a\) => \(/.test(C));
P("P57293", "…keyed by its slug", /key=\{a\.slug\}/.test(C));
P("P57294", "…showing its icon and its label", /\{a\.icon\} \{a\.label\}/.test(C));
P("P57295", "…and its on/off state is announced, not only coloured", /aria-pressed=\{declared\.includes\(a\.slug\)\}/.test(C));
P("P57296", "a typed allergy becomes its OWN chip, so it can be removed again", /declared\.filter\(\(s\) => !ALLERGENS\.some\(\(a\) => a\.slug === s\)\)\.map/.test(C));
P("P57297", "…with a distinct key, so it cannot collide with a preset", /key=\{`custom-\$\{s\}`\}/.test(C));
P("P57298", "tapping a chip toggles it, never adds a duplicate", /const toggleDeclared = \(slug: string\) =>[\s\S]{0,140}d\.includes\(slug\) \? d\.filter/.test(C));
P("P57299", "the free-text box has its own switch, separate from allergies", /\{features\.allergy_other && \(/.test(C));
P("P57300", "…and it is a conditional render, not the hidden attribute", /Conditional render, NOT the `hidden` attribute/.test(C));
P("P57301", "…the box appears only once 'Other' is turned on", /\{otherOpen && features\.allergy_other && \(/.test(C));
P("P57302", "…Enter adds what was typed", /if \(e\.key === "Enter"\) \{/.test(C));
P("P57303", "…lower-cased, so 'Peanut' and 'peanut' are one allergy", /otherAllergy\.trim\(\)\.toLowerCase\(\)/.test(C));
P("P57304", "…with a leading 'no' stripped, so 'no peanuts' is not stored as a sentence", /\.replace\(\/\^no\[\\s-\]\+\/, ""\)/.test(C));
P("P57305", "…and never added twice", /if \(v && !declared\.includes\(v\)\) setDeclared/.test(C));
P("P57306", "…and the box is cleared afterwards, ready for the next one", /setOtherAllergy\(""\);/.test(C));
P("P57307", "…and it does not submit the page", /e\.preventDefault\(\);/.test(C));
P("P57308", "the order-wide rule is spelled out, so nobody thinks it is per-dish", /Anything you tap here is removed from/.test(C));
P("P57309", "…in its own note", renders(C, "allergy-note"));
P("P57310", "a conflict between the basket and the avoid list is warned about once", renders(C, "allergy-warning"));
P("P57311", "…listing every avoided allergen actually in the basket, without repeats", /const orderDeclaredHits = \[\.\.\.new Set\(cart\.flatMap\(\(it\) => conflicts\(it\.id\)\)\)\]/.test(C));
P("P57312", "…and only when there is one", /\{orderDeclaredHits\.length > 0 && \(/.test(C));
P("P57313", "each line also shows which of ITS allergens the diner avoids", /const conflicts = \(id: string\) => itemAllergens\(id\)\.filter\(\(a\) => declared\.includes\(a\)\)/.test(C));
P("P57314", "…as a per-line warning", renders(C, "cart-item-warn"));
P("P57315", "…and the dish's own allergens as dots", renders(C, "cart-item-allergens"));
P("P57316", "…with the avoided ones flagged", /allergen-dot \$\{declared\.includes\(a\) \? "flag" : ""\}/.test(C));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK A3 — the tracker's drag-to-hide gesture and its rendered pieces (P57317–P57376)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
P("P57317", "the drop target's position is a named constant, not a magic number", /const CROSS_Y = 0\.68;/.test(T));
P("P57318", "…and so is its hit radius", /const HIT = 90;/.test(T));
P("P57319", "…which is generous, because a finger is not a mouse", /generous hit radius/.test(T));
P("P57320", "the target's centre is computed from the CURRENT window, not cached", /const crossXY = \(\) => \(\{ x: window\.innerWidth \/ 2, y: window\.innerHeight \* CROSS_Y \}\)/.test(T));
P("P57321", "a press remembers where it started", /dragRef\.current = \{ sx: e\.clientX, sy: e\.clientY, pid: e\.pointerId, moved: false \}/.test(T));
P("P57322", "…and captures the pointer immediately, so a fast flick still lands", /setPointerCapture\(e\.pointerId\)/.test(T));
P("P57323", "…inside a try, because capture throws on a pointer that has already gone", /try \{ stripRef\.current\?\.setPointerCapture/.test(T));
P("P57324", "…and a press during the fly-out animation is ignored", /if \(dismissing\) return;/.test(T));
P("P57325", "a move under the jitter threshold is not a drag", /if \(!d\.moved && Math\.hypot\(dx, dy\) < 8\) return;/.test(T));
P("P57326", "…and past it, it becomes one, once", /if \(!d\.moved\) d\.moved = true;/.test(T));
P("P57327", "…and 'over the target' is a distance, not a hover event", /over: Math\.hypot\(e\.clientX - x, e\.clientY - y\) < HIT/.test(T));
P("P57328", "a release that never moved is a TAP, and opens the detail", /if \(!d\.moved\) \{ openDetail\(\); return; \}/.test(T));
P("P57329", "…and a release with no press recorded does nothing", /if \(!d\) return;/.test(T));
P("P57330", "the pointer is released on a normal end", /releasePointerCapture\(e\.pointerId\)/.test(T));
P("P57331", "…and also when the OS cancels the gesture", /const onPointerCancel = /.test(T));
P("P57332", "…which resets the drag state cleanly", /dragRef\.current = null;[\s\S]{0,200}setSnapping\(false\);[\s\S]{0,40}setDrag\(null\);/.test(T));
P("P57333", "a drop ON the target flies the strip into it", /setDismissing\(\{ tx, ty \}\)/.test(T));
P("P57334", "…computed from the strip's real box, so it lands on the cross", /const r = stripRef\.current\?\.getBoundingClientRect\(\)/.test(T));
P("P57335", "…and falls back to no offset if the box cannot be read", /const tx = r \? x - \(r\.left \+ r\.width \/ 2\) : 0/.test(T));
P("P57336", "…the order being animated is FROZEN, so a new one cannot swap in", /dismissingOrderRef\.current = order;/.test(T));
P("P57337", "…the strip stops taking taps during the flight", /pointerEvents: "none"/.test(T));
P("P57338", "…and the timeout matches the CSS transition, not a guess", /\}, 340\); \/\/ matches the 0\.34s CSS transition/.test(T));
P("P57339", "…after which the diner is told it was hidden, not cancelled", /message: "Tracker hidden", subtitle: "still in Previous orders"/.test(T));
P("P57340", "hiding the COMBINED strip hides every order behind it", /if \(wasMulti\) \{ write\(read\(\)\.map\(\(o\) => \(allIds\.includes\(o\.id\)/.test(T));
P("P57341", "…and the ids are captured BEFORE the animation, not read after it", /const allIds = visible\.map\(\(o\) => o\.id\);/.test(T));
P("P57342", "…and whether it was combined is captured then too", /const wasMulti = multi;/.test(T));
P("P57343", "hiding one order marks only that one", /const hideStrip = \(id: string\) =>/.test(T));
P("P57344", "…and does NOT cancel it — it stays in the live list", /stripHidden: true/.test(T) && /it is NOT cancelled or removed/.test(T));
P("P57345", "…onto a FRESH read, so a concurrent write is not reverted", /write\(read\(\)\.map\(\(o\) => \(o\.id === id \? \{ \.\.\.o, stripHidden: true \} : o\)\)\)/.test(T));
P("P57346", "…and the cart is told, so its dot and list agree", /broadcast\(\); \/\/ tell the cart to update its dot\/list/.test(T));
P("P57347", "a release AWAY from the target springs the strip back", /setSnapping\(true\);/.test(T));
P("P57348", "…animating to zero rather than jumping", /setDrag\(\{ dx: 0, dy: 0, over: false \}\)/.test(T));
P("P57349", "…and clearing the state afterwards", /setTimeout\(\(\) => \{ setSnapping\(false\); setDrag\(null\); \}, 260\)/.test(T));
P("P57350", "the drop zone is drawn only while a drag is happening", /\{drag && \(/.test(T));
P("P57351", "…as its own element", renders(T, "ot-dropzone"));
P("P57352", "…with a circle", renders(T, "ot-dropzone-circle"));
P("P57353", "…and a label that changes when the strip is over it", /\{drag\.over \? "Release to hide" : "Drop here to hide"\}/.test(T));
P("P57354", "…in its own element", renders(T, "ot-dropzone-label"));
P("P57355", "…and it is hidden from screen readers, being a pure gesture aid", /className=\{`ot-dropzone \$\{drag\.over \? "over" : ""\}`\} aria-hidden="true"/.test(T));
P("P57356", "the strip's transform is inline, and the entrance animation is switched off with it", /animation: "none"/.test(T));
P("P57357", "…because a filled CSS animation would beat an inline transform", /a running\/filled CSS\s*\n?\s*\/\/ animation overrides an inline transform/.test(T));
P("P57358", "…and touch scrolling is disabled on it, so a drag is a drag", /touchAction: "none"/.test(T));
P("P57359", "…and it shrinks a little when it is over the target", /scale\(\$\{drag\.over \? 0\.9 : 1\}\)/.test(T));
P("P57360", "the strip renders its own body", renders(T, "ot-body"));
P("P57361", "…a top row", renders(T, "ot-top"));
P("P57362", "…a label", renders(T, "ot-label"));
P("P57363", "…a subtitle", renders(T, "ot-sub"));
P("P57364", "…the table, when there is one", renders(T, "ot-table"));
P("P57365", "…and a grip, so the drag is discoverable", renders(T, "ot-grip"));
P("P57366", "per-dish mode draws one segment per DISH", renders(T, "ot-dishbar"));
P("P57367", "…each with its own status class", /className=\{`ot-dseg \$\{s\}`\}/.test(T));
P("P57368", "…and it is used only when the table's dish statuses are known", /const dishMode = dishProg\.segs\.length > 0 && !dismissing;/.test(T));
P("P57369", "combined mode draws one segment per ORDER instead", renders(T, "ot-orderbar"));
P("P57370", "…each keyed by its order id", /<span key=\{o\.id\} className=\{`ot-oseg \$\{o\.status\}`\} \/>/.test(T));
P("P57371", "the strip's colour is decided by one expression, in one place", /const stripStatus = dishMode \? dishStatus : multi \? multiStatus : order\.status;/.test(T));
P("P57372", "…and 'all served' is only true when every dish is", /const allDishesServed = dishMode && dishProg\.served === dishProg\.segs\.length;/.test(T));
P("P57373", "…and every order is, in combined mode", /servedCount === visible\.length \? "served"/.test(T));
P("P57374", "…where the served count is counted, not assumed", /const servedCount = visible\.filter\(\(o\) => o\.status === "served"\)\.length;/.test(T));
P("P57375", "the combined strip appears from two live orders up", /const multi = visible\.length >= 2 && !dismissing;/.test(T));
P("P57376", "…and shows a receipt icon rather than one order's status icon", /\{multi \? "fa-receipt" : c\.icon\}/.test(T));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK A4 — the bill's plumbing round 1 never named (P57377–P57426)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
P("P57377", "opening the bill refreshes everything it shows, in one handler", /const handleOpen = \(\) => \{/.test(C));
P("P57378", "…the basket", /handleOpen = \(\) => \{[\s\S]{0,200}loadCart\(\)/.test(C));
P("P57379", "…the live orders", /handleOpen = \(\) => \{[\s\S]{0,200}loadLive\(\)/.test(C));
P("P57380", "…the menu, once", /handleOpen = \(\) => \{[\s\S]{0,200}loadMenuOnce\(\)/.test(C));
P("P57381", "…the remembered table", /handleOpen = \(\) => \{[\s\S]{0,240}prefillScanned\(\)/.test(C));
P("P57382", "…the session lock", /handleOpen = \(\) => \{[\s\S]{0,260}syncSession\(\)/.test(C));
P("P57383", "…and it lands on the bill tab, never on the tab you left open", /handleOpen = \(\) => \{[\s\S]{0,220}setShowHistory\(false\)/.test(C));
P("P57384", "the tracker's tap opens straight to the LIVE tab instead", /const handleShowPrev = \(\) => \{ setOpen\(true\); loadMenuOnce\(\); setShowHistory\(true\); loadLive\(\); \}/.test(C));
P("P57385", "the bill closes on the app-wide close event", /const handleClose = \(\) => setOpen\(false\)/.test(C));
P("P57386", "a currency change re-reads the currency rather than reloading", /const handleCurrency = \(\) => setCurrencyState\(getCurrency\(\)\)/.test(C));
P("P57387", "an order placed anywhere re-reads the live list", /const handleOrdersChanged = \(\) => \{ loadLive\(\); \}/.test(C));
P("P57388", "a QR table scan re-runs the prefill", /const handleScanned = prefillScanned/.test(C));
P("P57389", "a basket change elsewhere re-reads it", /const handleCartUpdated = loadCart/.test(C));
P("P57390", "'avoid this in every dish' merges into the order-wide list", /const handleAvoidAll = \(e: Event\)/.test(C));
P("P57391", "…without duplicating what is already there", /Array\.from\(new Set\(\[\.\.\.d, \.\.\.list\]\)\)/.test(C));
P("P57392", "…and an empty payload is harmless", /\?\.allergens \|\| \[\]/.test(C));
P("P57393", "the basket is read defensively, so bad JSON cannot crash the bill", /const loadCart = \(\) => \{\s*\n\s*try \{/.test(C));
P("P57394", "…and a parse failure leaves an empty basket, not a broken screen", /\} catch \{\s*\n\s*setCart\(\[\]\);/.test(C));
P("P57395", "the live list is read through the shared rule, not a local filter", /const loadLive = \(\) => setLiveOrders\(liveActiveOrders\(readActiveOrders\(\)\)\)/.test(C));
P("P57396", "the session lock reads the stored session, not the URL", /const syncSession = \(\) => \{[\s\S]{0,120}getStoredSession\(\)/.test(C));
P("P57397", "…and a seated diner's table is forced into the field", /if \(ss\?\.table\) setTableNumber\(ss\.table\)/.test(C));
P("P57398", "the prefill remembers what it last filled, so it can tell a wipe from a first read", /const previous = scannedRef\.current;/.test(C));
P("P57399", "…and updates that memory every time", /scannedRef\.current = scanned;/.test(C));
P("P57400", "editing a line re-opens the customize popup pre-filled", /const editLine = \(it: CartItem\) =>/.test(C));
P("P57401", "…through the one event that popup listens on", /"lfh:open-order-confirm"/.test(C));
P("P57402", "…carrying the dish, its options and its allergens", /options: dish\.options,\s*\n\s*allergens: dish\.allergens,/.test(C));
P("P57403", "…and the line's own current choices", /preselect: \{ options: it\.options, removed: it\.removed, note: it\.note, qty: it\.qty \}/.test(C));
P("P57404", "…identified by its option signature, so the right line is replaced", /editSig: it\.sig \|\| "\[\]"/.test(C));
P("P57405", "…and it does nothing at all if the dish has left the menu", /const dish = menuItems\.find\(\(m\) => m\.id === it\.id\);\s*\n\s*if \(!dish\) return;/.test(C));
P("P57406", "Edit is offered on EVERY dish still on the menu, not only customizable ones", /const canEdit = \(id: string\) => !!menuItems\.find\(\(m\) => m\.id === id\)/.test(C));
P("P57407", "…and it renders as a button", renders(C, "cart-edit-btn"));
P("P57408", "…because even a plain dish can take a note or an allergy", /Even a plain dish with no options\/allergens can be customized/.test(C));
P("P57409", "sold-out lines are computed from the menu, once", /const soldOutIds = new Set\(menuItems\.filter\(\(m\) => \(m\.tags \|\| \[\]\)\.includes\("sold-out"\)\)\.map\(\(m\) => m\.id\)\)/.test(C));
P("P57410", "…and a line wears its own Sold out badge", /Sold out\s*\n?\s*<\/span>/.test(C));
P("P57411", "a line's chosen options are printed, when there are any", renders(C, "cart-item-opts"));
P("P57412", "…as their labels, joined, not as an object", /item\.options\.map\(\(o\) => o\.label\)\.join\(", "\)/.test(C));
P("P57413", "removed allergens are printed as 'No milk', in red", /No \{item\.removed\.map\(\(r\) => allergenLabel\(r\)\.toLowerCase\(\)\)\.join\(", "\)\}/.test(C));
P("P57414", "a kitchen note is printed in quotes, so it reads as the diner's words", /“\{item\.note\}”/.test(C));
P("P57415", "each line's price is its own value, not a share of the total", /\{fmtDisp\(lineDisp\(item\)\)\}/.test(C));
P("P57416", "…where lineDisp snaps the base and minor-rounds the add-ons, matching the popup", /const lineDisp = \(it: CartItem\) =>[\s\S]{0,200}unitDisplay\(parseFloat\(it\.price\)/.test(C));
P("P57417", "…times the quantity, so the lines sum to what is printed", /currency \|\| undefined\) \* it\.qty/.test(C));
P("P57418", "…and fmtDisp adds no conversion, only the symbol", /const fmtDisp = \(n: number\) => \(currency \? formatAmount\(n, currency\)/.test(C));
P("P57419", "the trash button removes exactly one line", /const removeFromCart = \(idx: number\)/.test(C));
P("P57420", "…and is labelled with the dish it removes", /aria-label=\{`Remove \$\{item\.title\}`\}/.test(C));
P("P57421", "'−' is labelled with the dish it decreases", /aria-label=\{`Decrease \$\{item\.title\}`\}/.test(C));
P("P57422", "'+' likewise", /aria-label=\{`Increase \$\{item\.title\}`\}/.test(C));
P("P57423", "the quantity buttons are 32px, the product's floor for adjacent controls", /width: "32px", height: "32px"/.test(C));
P("P57424", "…and that is written down as a decision, with the measurement", /32px, not 28px, and never smaller/.test(C));
P("P57425", "the close and back controls both just close, and are labelled", /aria-label="Close cart"/.test(C) && renders(C, "cart-back"));
P("P57426", "the backdrop closes everything when tapped", /className="overlay active" onClick=\{\(\) => window\.dispatchEvent\(new Event\("lfh:close-all"\)\)\}/.test(C));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK A5 — the six lib/menu exports and two queue internals nothing named (P57427–P57466)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
P("P57427", "a guest can read ONE order's status, and only through a definer function", /export async function getOrderStatus/.test(M));
P("P57428", "…and it hands back camelCase, so no caller learns the column names", /return \{ status: row\.status, tableNumber: row\.table_number, createdAt: row\.created_at \}/.test(M));
P("P57429", "…and an error and an unknown order are the same answer: null", /if \(error \|\| !Array\.isArray\(data\) \|\| data\.length === 0\) return null;/.test(M));
P("P57430", "one dish's reviews are read newest-first and capped", /export async function getItemReviews/.test(M) && /\.limit\(20\)/.test(M));
P("P57431", "…scoped to the dish AND the restaurant", /\.eq\("item_slug", slug\)/.test(M) && /\.eq\("restaurant_id", restaurantId\)/.test(M));
P("P57432", "…with a column list, never select *", /\.select\("name, stars, comment, device_id, created_at"\)/.test(M));
P("P57433", "…a nameless review reads as 'Guest', never as blank", /name: r\.name \|\| "Guest"/.test(M));
P("P57434", "…an empty comment reads as empty, not as 'null'", /text: r\.comment \|\| ""/.test(M));
P("P57435", "…and the device id rides along, so this phone can replace its own", /deviceId: r\.device_id/.test(M));
P("P57436", "…and a failure shows no reviews rather than breaking the dish page", /if \(error\) return \[\];/.test(M));
P("P57437", "submitting a review goes through a validating definer function", /export async function submitReview/.test(M) && /\.rpc\("lfh_submit_review"/.test(M));
P("P57438", "…which upserts, so re-rating never duplicates", /validates stars\/device\/dish and upserts/.test(M));
P("P57439", "…and an empty answer is a failure, not a silent success", /\{ ok: false, reason: "no response" \}/.test(M));
P("P57440", "renaming this device's own reviews is scoped to the device AND the restaurant", /export async function renameMyReviews/.test(M) && /p_device: deviceId, p_restaurant_id: restaurantId/.test(M));
P("P57441", "…and reports how many it changed", /renamed\?: number/.test(M));
P("P57442", "feedback is keyed on the order id, which is the proof of visit", /export async function leaveFeedback/.test(M) && /p_order: orderId/.test(M));
P("P57443", "…an optional comment and name are sent as null, not as empty strings", /p_comment: comment \|\| null, p_name: name \|\| null/.test(M));
P("P57444", "…and one order can only ever hold one feedback", /the server stores ONE feedback per order/.test(M));
P("P57445", "the live-category set can be derived from categories a caller already has", /export function liveCategorySetOf/.test(M));
P("P57446", "…and an empty list maps to 'cannot tell', matching the other path", /return categories\.length \? new Set\(categories\.map\(\(c\) => c\.slug\)\) : null;/.test(M));
P("P57447", "the category read itself is one function, so both callers share it", /async function fetchActiveCategorySlugs/.test(M));
P("P57448", "…column-listed, scoped and capped", /\.select\("slug"\)[\s\S]{0,120}\.eq\("active", true\)[\s\S]{0,40}\.limit\(300\)/.test(M));
P("P57449", "the order deadline is a named constant, not an inline number", /const ORDER_TIMEOUT_MS = 15000;/.test(M));
P("P57450", "…and it matches the queue's own send deadline", /const SEND_TIMEOUT_MS = 15_000;/.test(O));
P("P57451", "the busy error is a TYPE with a flag, so nobody matches on a sentence", /export type BusyError = Error & \{ busy: true \}/.test(M));
P("P57452", "…built in one place", /function busyError\(why: string\): BusyError/.test(M));
P("P57453", "the waiter-call result shape is declared, so a caller cannot invent a field", /export interface CallWaiterResult \{ ok: boolean; reason\?: string \}/.test(M));
P("P57454", "the reply shape the order path reads is declared too", /type OrderReply = \{/.test(M));
P("P57455", "…and it names `duplicate`, so a replayed answer is not read as a new order", /duplicate\?: boolean/.test(M));
P("P57456", "a dish's option groups are a declared shape, not free-form JSON", /export interface OptionGroup/.test(M));
P("P57457", "…with a single-or-multi kind", /type: "single" \| "multi"/.test(M));
P("P57458", "…and an add-on price per choice", /choices: \{ label: string; price: number \}\[\]/.test(M));
P("P57459", "a localized label is a declared map, not a string with separators", /export type LocalizedText = Record<string, string>/.test(M));
P("P57460", "the dish tax mode is imported, never re-declared here", /type DishTaxMode/.test(M));
P("P57461", "the queue's tracker payload is a declared shape", /export type GuestTrack = /.test(O));
P("P57462", "…and every field on it is optional, because an old saved row may lack any of them", /tableNumber\?: string; total\?: number; itemCount\?: number/.test(O));
P("P57463", "the queue's base retry beat is a named constant", /const RETRY_BASE_MS = 15_000;/.test(O));
P("P57464", "reading every saved row cannot throw, whatever storage does", /async function idbAll\(\)/.test(O) && /catch \{ return \[\]; \}/.test(O));
P("P57465", "the refusal codes for an empty, unapproved or unverified order are all worded", /case "empty_order"/.test(O) && /case "not_approved"/.test(O) && /case "otp_required"/.test(O));
P("P57466", "…and the one dish a refusal blames is resolved once, into a local", /const oneDish = dishFor\(j\?\.reason, j\?\.item, namedLines\(item\)\)/.test(O));

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BLOCK D — the money, the storage domains and the cross-panel truth, by reading (P57587–P57646)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
P("P57587", "the bill computes money twice, on purpose: once to show, once to store", /const dispLines = cart\.map/.test(C) && /const usdLines = cart\.map/.test(C));
P("P57588", "…and neither uses a second formula", count(C, /splitBill\(/g) >= 3);
P("P57589", "the display side passes the already-multiplied line with qty 1", /\{ price: lineDisp\(it\), qty: 1, tax_mode: behaviourOf\(it\) \}/.test(C));
P("P57590", "…so per-line rounding lands on exactly the figures printed above it", /keeps splitBill's per-line rounding on/.test(C));
P("P57591", "the stored side passes the raw unit and the real quantity", /\{ price: it\.price, qty: it\.qty, tax_mode: behaviourOf\(it\) \}/.test(C));
P("P57592", "GST is added only to lines priced NET", /dispLines\.filter\(\(l\) => l\.tax_mode === "excl"\)/.test(C));
P("P57593", "…and the same rule is used on the stored side", /usdLines\.filter\(\(l\) => l\.tax_mode === "excl"\)/.test(C));
P("P57594", "a composition restaurant is charged no GST at all", /taxRules\.price_tax_mode === "composition"\s*\n?\s*\? 0/.test(C));
P("P57595", "…and its GST row is removed rather than printed as zero", /const showTaxRow = !dispSplit\.composition && tax > 0;/.test(C));
P("P57596", "the behaviour of a line is decided ONLY by lib/tax", /const behaviourOf = \(it: CartItem\) => resolveTaxMode\(dishMode\(it\.id\), taxRules\)/.test(C));
P("P57597", "…never by branching on the dish's raw setting", /Never branch on the dish's raw setting instead of this/.test(C));
P("P57598", "…and a line whose dish has not loaded yet follows the restaurant", /reads as "default" = follow the restaurant/.test(C));
P("P57599", "the MRP stamp is purely presentational", /const isMrpLine = \(it: CartItem\) => isMrpDish\(dishMode\(it\.id\), taxRules\)/.test(C));
P("P57600", "…and it says why the price is final, on hover", /Maximum Retail Price — this price is final, no tax is added/.test(C));
P("P57601", "the MRP row appears only when there is MRP money on the bill", /\{nontaxDisp > 0 && \(/.test(C));
P("P57602", "…and never under the composition scheme, where it would be a lie", /const nontaxDisp = dispSplit\.composition \? 0 : dispSplit\.nontaxAmount;/.test(C));
P("P57603", "the tax-inclusive explanation appears only when there IS tax inside", /GST is already included in these prices/.test(C));
P("P57604", "…and the all-MRP case says something different and true", /No GST on these items/.test(C));
P("P57605", "the GST row prints the restaurant's real rate, to two decimals", /GST \(\{Math\.round\(taxRate \* 10000\) \/ 100\}%\)/.test(C));
P("P57606", "…which starts at today's behaviour until settings load", /const \[taxRate, setTaxRate\] = useState\(0\.05\)/.test(C));
P("P57607", "…and the rules do too", /const \[taxRules, setTaxRules\] = useState<TaxRules>\(DEFAULT_TAX_RULES\)/.test(C));
P("P57608", "the stored total keeps its old floating-point shape to the paisa", /usdOnTopBase \* \(1 \+ taxRate\) \+ \(subtotalUsd - usdOnTopBase\)/.test(C));
P("P57609", "…and is rounded to two decimals, once", /Math\.round\(\([\s\S]{0,120}\) \* 100\) \/ 100/.test(C));
P("P57610", "the subtotal shown is the sum of the printed lines, not a separate figure", /const subtotal = cart\.reduce\(\(sum, it\) => sum \+ lineDisp\(it\), 0\)/.test(C));
P("P57611", "the item count counts items, not lines", /const itemCount = cart\.reduce\(\(sum, it\) => sum \+ it\.qty, 0\)/.test(C));
P("P57612", "order records are stored in USD and converted at render, in one domain", /ORDER RECORDS are stored in USD/.test(C));
P("P57613", "…and the ₹48,550 scar is written down beside it", /₹48,550/.test(C));
P("P57614", "the tracker entry the bill writes carries the USD total", /total: totalUsd/.test(C));
P("P57615", "…and so does the one the queue writes", /total: item\.track\?\.total \?\? 0/.test(O));
P("P57616", "…and the one the shared table pull writes", /total: Number\(o\.total\) \|\| 0/.test(T));
P("P57617", "…so all three feed the ONE storage the tracker and the bill read", /export const ACTIVE_ORDERS_KEY = "lfh_active_orders";/.test(F.status));
P("P57618", "the queue's tracker entry lands under the ORDER's restaurant, not the tab's", /const slug = item\.restaurantSlug \|\| tenantSlug\(\);/.test(O));
P("P57619", "…and is written with the tenant-scoped setter", /tsetFor\("lfh_active_orders", slug, JSON\.stringify\(arr\)\)/.test(O));
P("P57620", "…and wakes the tracker", /window\.dispatchEvent\(new Event\("lfh:order-placed"\)\)/.test(O));
P("P57621", "a same-tab basket change is announced, because storage events do not fire locally", /"lfh:cart-updated"/.test(C));
P("P57622", "…and a cross-tab one is translated into that same announcement", /window\.addEventListener\("storage", handleStorageCart\)/.test(C));
P("P57623", "the tracker listens for a placed order from either tab", /window\.addEventListener\("storage", onPlaced\)/.test(T));
P("P57624", "…and stops listening on teardown", /window\.removeEventListener\("storage", onPlaced\)/.test(T));
P("P57625", "the tracker tells the open bill when a status moves", /const broadcast = \(\) => window\.dispatchEvent\(new Event\("lfh:orders-updated"\)\)/.test(T));
P("P57626", "…and the bill listens for exactly that", /window\.addEventListener\("lfh:orders-updated", handleOrdersChanged\)/.test(C));
P("P57627", "…so the strip and the Live tab can never disagree about a status", /Tell the open cart \(same tab\) that an order's status changed/.test(T));
P("P57628", "a definitive session ending clears this device's orders", /tremove\("lfh_active_orders"\)/.test(T));
P("P57629", "…on exactly the three reasons that mean it really ended", /reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"/.test(T));
P("P57630", "…and a transient blip keeps them", /transient network blip/.test(T));
P("P57631", "the guest never sees the kitchen's 'ready' stage", /i\.status === "ready" \? "preparing" : i\.status/.test(T));
P("P57632", "…and that is the owner's decision, dated", /owner, 2026-06-14/.test(T));
P("P57633", "an unapproved member sees no live progress at all", /if \(!mem\?\.approved\)/.test(T));
P("P57634", "…matching what the server already withholds", /migration 076/.test(T));
P("P57635", "the four guest routes never trust a price from the phone", !/p_price|p_amount|p_total/.test(F.place + F.call + F.leave + F.limit));
P("P57636", "…and the basket payload carries no price either", !/price/.test(between(C, "const orderItems = ()", "};")));
P("P57637", "the order route's ceilings are named constants", /const MAX_ITEMS = 200;/.test(F.place));
P("P57638", "…and going over any of them is a refusal, never a trim", !/\.slice\(0, MAX_ITEMS\)/.test(F.place));
P("P57639", "the call route caps the note before the database sees it", /\.slice\(0, 200\)/.test(F.call));
P("P57640", "the leave route needs nothing but a token", /type Body = \{ token\?: string; restaurantId\?: string \}/.test(F.leave));
P("P57641", "the beacon writes nothing at all", !/\.rpc\(|\.insert\(|\.update\(/.test(F.limit));
P("P57642", "…and its ceiling is per caller and per limit", /`limithit:\$\{key\}:\$\{capKeyFor\(req\)\}`/.test(F.limit));
P("P57643", "every one of the four routes is force-dynamic", ["place", "call", "leave", "limit"].every((k) => /export const dynamic = "force-dynamic";/.test(F[k])));
P("P57644", "…and the three that write are at-most-once", ["place", "call", "leave"].every((k) => /withIdempotency/.test(F[k])));
P("P57645", "no route in this territory holds a server-side timer", !/setInterval/.test(F.place + F.call + F.leave + F.limit));
P("P57646", "…and none of them logs a diner's own words", !/console\.log/.test(F.place + F.call + F.leave + F.limit));

console.log(`\n${pass} passed, ${fails.length} failed  (of ${pass + fails.length})`);
if (fails.length) { console.log("\nFAILED:"); for (const f of fails) console.log("  " + f); process.exit(1); }
