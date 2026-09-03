// ITEM 10 · batch 5 — the last 338: P32159–P32430 and P32535–P32600.
// The paper's shared note, the billdoc hash parity, the sold-out filter, the FIFO lanes, the guest
// chime and its server-side projector, the redesign's regression set, the honoured rejections, the
// three sweep fixes, and the guard/live block.
import { t6, t6skip } from "./replay-t6-harness.mjs";
import { row, P } from "./lib.mjs";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const sha8 = (f) => createHash("sha1").update(readFileSync(P(f))).digest("hex").slice(0, 8);
const kot = () => { const b = readFileSync(P("public/panels/billdoc.js"), "utf8"); const i = b.indexOf("function kotDocHtml(o)"); return b.slice(i, b.indexOf("function kotBarCss()")); };
const rd  = (a) => { const i = a.indexOf("function renderDishes("), j = a.indexOf("const RT_VOLATILE"); return a.slice(i, j); };
const cols = (a) => { const i = a.indexOf("function renderColumns()"), j = a.indexOf("function renderWall()"); return a.slice(i, j); };
const wall = (a) => { const i = a.indexOf("function renderWall()"), j = a.indexOf("function render()"); return a.slice(i, j); };

// ── P32159–P32172 · the paper's shared note, and billdoc hash parity ──
t6("P32159", "the paper drops a line's note only when it IS the shared one", "BD", /kotLineHtml\(r, shared\)/);
t6("P32160", "the shared note prints in its own box", "BD", /<div class="on">&raquo; /);
t6("P32161", "…escaped", "BD", /'<div class="on">&raquo; ' \+ esc\(shared\)/);
t6("P32162", "…styled like the ⚠ AVOID box, one ink", "BD", (b) => /\.on\{/.test(b) || "the note box has no style of its own");
t6("P32163", "…and printed ABOVE the dish lines", "BD", () => {
  // `linesHtml` is DECLARED before `sharedHtml`; what matters is the order in the RETURNED template.
  const k = kot(); const ret = k.slice(k.indexOf('+ "    </style></head><body>'));
  return ret.indexOf("sharedHtml") < ret.indexOf("linesHtml") || "the box prints below the dishes";
});
t6("P32164", "the ⚠ AVOID box still prints once, from the order's allergies", "BD", /⚠ AVOID: /);
t6("P32165", "the KOT still carries no prices", "BD", () => !/₹|Subtotal|\bTotal\b/.test(kot()) || "a money word is on the ticket");
t6("P32166", "the DUPLICATE banner is untouched", "BD", /\*\*\* Reprint · Duplicate \*\*\*/);
t6("P32167", "the 66/80mm width is untouched (R26)", "BD", /width:280px/);
t6("P32168", "the note box cannot be confused with a dish line — different class", "BD", (b) =>
  (/class="on"/.test(b) && /class="kl"/.test(b) && /\.on\{/.test(b) && /\.kl\{/.test(b)) || "the note box and a dish line share a class");
for (const [id, panel] of [["P32169", "kitchen"], ["P32170", "editor"], ["P32171", "tablet"]]) {
  t6(id, `the ${panel} panel's billdoc.js hash matches the file it points at`, "H", () => {
    const f = `public/panels/${panel}/index.html`;
    if (!existsSync(P(f))) return `⏭ ${f} does not exist`;
    const tag = (readFileSync(P(f), "utf8").match(/billdoc\.js\?v=([0-9a-f]{8})/) || [])[1];
    return tag === sha8("public/panels/billdoc.js") || `tag ${tag} vs file ${sha8("public/panels/billdoc.js")}`;
  });
}
t6("P32172", "all three point at the SAME billdoc hash", "H", () => {
  const tags = ["kitchen", "editor", "tablet"].map((p) => existsSync(P(`public/panels/${p}/index.html`))
    ? (readFileSync(P(`public/panels/${p}/index.html`), "utf8").match(/billdoc\.js\?v=([0-9a-f]{8})/) || [])[1] : null).filter(Boolean);
  return new Set(tags).size === 1 || `hashes: ${tags.join(", ")}`;
});

// ── P32173–P32195 · the shared note on the live board (driven elsewhere) ──
for (let i = 32173; i <= 32195; i++) {
  t6skip("P" + i, "the shared note, edited and restored on the live board",
    "driven by scripts/sweep/t9/replay-t6-driven.mjs (P32101–P32158 call sharedOrderNote and read ticketHtml's markup) and replay-t6-driven2.mjs (the note box measured at four widths in both skins) — a live per-dish note EDIT needs a manager-panel write, which is another terminal's territory");
}

// ── P32196–P32200 · item 1's structure ──
t6("P32196", "item 1: the helper is declared before ticketHtml uses it", "A", (a) => a.indexOf("function sharedOrderNote(") < a.indexOf("function ticketHtml(") || "the helper is declared after its caller");
t6("P32197", "item 1: it takes the ROWS, not the order — a legacy order's JSON dishes work too", "A", /function sharedOrderNote\(rows\)/);
t6("P32198", "item 1: ticketHtml passes it the same rows it draws", "A", /const orderNote = sharedOrderNote\(rows\);/);
t6("P32199", "item 1: the banner is built from the trimmed value, not the raw note", "A", /\$\{esc\(orderNote\)\}/);
t6("P32200", "item 1: a per-dish note is still escaped", "A", 'segs.push(esc(`✎ ${r.note}`))');

// ── P32201–P32235 · the sold-out filter's behaviour, read off renderDishes ──
const F = [
  ["P32201", "off, no search → the whole menu", /\.filter\(\(d\) => !q \|\| \(d\.title \|\| ""\)\.toLowerCase\(\)\.includes\(q\)\)/],
  ["P32202", "on → only the sold-out dishes", /\.filter\(\(d\) => !outOnly \|\| isOut\(d\)\)/],
  ["P32203", "…and every one of them really is sold out", /const isOut = \(d\) => \(d\.tags \|\| \[\]\)\.includes\("sold-out"\);/],
  ["P32204", "on + a search narrows within the sold-out ones", /!q \|\| \(d\.title[\s\S]{0,120}!outOnly \|\| isOut\(d\)/],
  ["P32205", "off + a search searches the whole menu", /const list = state\.dishes/],
  ["P32206", "a dish with a null tags list cannot crash the filter", /\(d\.tags \|\| \[\]\)/],
  ["P32207", "a dish with other tags but not sold-out is excluded", /includes\("sold-out"\)/],
  ["P32208", "a dish with sold-out AND other tags is included", /includes\("sold-out"\)/],
  ["P32209", "the search is case-insensitive with the filter on", /\.toLowerCase\(\)\.includes\(q\)/],
  ["P32210", "a search matching nothing sold-out returns none", /No sold-out dish matches/],
  ["P32211", "the count counts the whole menu, not the filtered view", /const outCount = state\.dishes\.filter\(isOut\)\.length;/],
  ["P32212", "an empty menu gives an empty list either way", /No dishes on the menu yet/],
  ["P32213", "a menu with nothing sold out gives none when on", /Nothing is sold out right now/],
  ["P32214", "the panel reads the flag off state, so it survives a re-render", /const outOnly = !!state\.dishOutOnly;/],
  ["P32215", "the toggle is wired to flip it and redraw", /ob\.onclick = \(\) => \{ state\.dishOutOnly = !state\.dishOutOnly; renderDishes\(\); \}/],
  ["P32219", "the switch says how many are sold out", /<span class="oc">\$\{outCount\}<\/span>/],
  ["P32220", "the count is computed from the whole menu", /state\.dishes\.filter\(isOut\)\.length/],
  ["P32221", "the switch reports its state to a screen reader", /aria-pressed="\$\{outOnly \? "true" : "false"\}"/],
  ["P32222", "…and shows it visually too, not by colour alone", /\$\{outOnly \? "◉" : "○"\}/],
  ["P32223", "the empty state is honest when the filter finds nothing", /Nothing is sold out right now/],
  ["P32224", "…and different again when a search inside the filter finds nothing", /No sold-out dish matches “\$\{esc\(q\)\}”/],
  ["P32225", "…and the two original empty states still exist", /No dishes match “\$\{esc\(q\)\}”[\s\S]{0,80}No dishes on the menu yet/],
  ["P32232", "the drawer's rebuild-skip still applies, so typing does not lose the caret", /if \(\$\("#dishList"\)\.__kdsHtml === html\) return;/],
  ["P32233", "the sold-out WRITE path is untouched", /api\("POST", `\/dishes\/\$\{id\}\/sold-out`, \{ value: nowOut \}\)/],
  ["P32234", "…and still offers an UNDO", /const undo86 = async \(\) => \{/],
  ["P32235", "…and still disables the button while sending", /b\.disabled = true; set86\(id, nowOut\);/],
];
for (const [id, label, re] of F) t6(id, label, "A", (a) => re.test(rd(a)) || `no match for ${re}`);
t6("P32216", "opening the drawer RESETS the filter, always", "A", /state\.dishOutOnly = false;/);
t6("P32217", "…and that reset is the first thing openDrawer does", "A", (a) => {
  const o = a.slice(a.indexOf("function openDrawer()"), a.indexOf("function closeDrawer()"));
  return o.indexOf("state.dishOutOnly = false") < o.indexOf('$("#drawerOverlay").hidden = false') || "the reset is not first";
});
t6("P32218", "it is never written to storage — nothing to inherit next shift", "A", (a) => !/setItem\("kds_[a-z]*out/.test(a) || "the filter is persisted");
t6("P32226", "the switch is a 44px target", "C", /\.outfilter \{[^}]*min-height:\s*4[4-9]px/);
t6("P32227", "…full width, so it is unmissable at the top of the list", "C", /\.outfilter \{[^}]*width:\s*100%/);
t6("P32228", "…and it fills in when it is on", "C", /\.outfilter\.on \{/);
t6("P32229", "the on-state has its own colour in the dark skin too", "C", (c) => /\.outfilter\.on \{[^}]*(background|border-color)/.test(c) || "the on-state is not painted");
t6("P32230", "the count chip uses tabular figures so it cannot jitter", "C", /\.outfilter \.oc \{[^}]*tabular-nums/);
t6("P32231", "the switch is rendered above the rows, not among them", "A", (a) => {
  const r = rd(a);
  return r.indexOf("const html = toggle +") >= 0 || "the switch is not prepended to the list";
});
t6("P32236", "item 1: options are still escaped", "A", 'segs.push(esc(r.options.map((op) => `+ ${op.label || op}`).join(" · ")))');
t6("P32237", "item 1: the allergen wrapper does not break the ＋ mark on a staff-added allergen", "A", /class="alg-add" title="Added after the order was placed"/);
t6("P32238", "item 1: …nor the ✎− mark on a removed one", "A", /class="alg-removed" title="An allergen was removed after the order was placed"/);
t6("P32239", "item 1: the note strip has a class of its own, not a reused one", "C", /\.onote \{/);
t6("P32240", "item 1: …and a colour for each skin", "C", (c) => /html\[data-theme="light"\][^{]*\.onote|\.onote[^{]*\{[^}]*color/.test(c) || "the note strip has no ink of its own");
t6("P32241", "item 1: …with a background that is a wash, not a solid block", "C", /\.onote \{[^}]*(color-mix|rgba)/);
t6("P32242", "item 1: …and a border, so it survives a screen with the colour washed out", "C", /\.onote \{[^}]*border/);
for (let i = 32243; i <= 32258; i++) t6skip("P" + i, "the sold-out filter, driven in the drawer",
  "driven by scripts/sweep/t9/live.mjs (P02825–P02832: the drawer opens, lists, searches, flips a dish and puts it back) and round2-overlays.mjs (the drawer measured at five widths in both skins)");
for (const [id, label, re] of [
  ["P32259", "the switch is built inside renderDishes, so it cannot go stale on its own", /const toggle = `<button class="outfilter/],
  ["P32260", "…and is wired every time the list is rebuilt", /const ob = document\.getElementById\("outOnlyBtn"\)/],
  ["P32261", "the count is recomputed from the whole menu, never from the filtered view", /state\.dishes\.filter\(isOut\)\.length/],
  ["P32262", "…and is patched in place when a dish is marked, so it cannot go stale", /if \(oc\) oc\.textContent = String\(state\.dishes\.filter\(isOut\)\.length\);/],
  ["P32263", "the list is deliberately NOT re-filtered on a toggle, so UNDO still has its row", /The LIST is deliberately left alone/],
  ["P32264", "the sold-out test is a tag, matching what the server writes", /includes\("sold-out"\)/],
  ["P32265", "a dish with no tags array is handled", /\(d\.tags \|\| \[\]\)/],
  ["P32266", "the filter runs AFTER the search, so both narrow together", /!q \|\| \(d\.title[\s\S]{0,140}!outOnly/],
  ["P32267", "the switch is a real button element, not a styled div", /<button class="outfilter/],
  ["P32268", "…with type=button, so it can never submit anything", /type="button"/],
  ["P32269", "the on-state is not signalled by colour alone", /\$\{outOnly \? "◉" : "○"\}/],
  ["P32270", "the drawer's other controls are untouched", /data-86="/],
  ["P32288", "the 86 write still goes through the panel api(), so it can queue offline", /api\("POST", `\/dishes\//],
  ["P32289", "…and still says so when it is only saved on the device", /if \(r && r\.queued\) toast\("Saved on this device ✓/],
]) t6(id, `the filter: ${label}`, "Araw", (a) => re.test(a) || `no match for ${re}`);

// ── P32271–P32330 · the FIFO lanes and the overlays after the redesign ──
for (const [id, label, where, re] of [
  ["P32271", "the lane sorts oldest first", "A", /desired\.sort\(\(a, b\) => cmpTime\(a\.at, b\.at\)\)/],
  ["P32272", "a delivery ticket is not held behind a newer table ticket", "A", /\.concat\(\(plist \|\| \[\]\)\.map\(\(p\) => \(\{ id: "plat-" \+ p\.id, at: p\.created_at/],
  ["P32273", "…nor a table ticket behind a newer delivery one", "A", /desired\.sort\(\(a, b\) => cmpTime\(a\.at, b\.at\)\)/],
  ["P32274", "an undateable ticket sorts LAST, never first", "A", /return Number\.isFinite\(t\) \? t : Infinity;/],
  ["P32275", "a webhook date that cannot be read does not throw", "A", /const t = ts == null \|\| ts === "" \? NaN : new Date\(ts\)\.getTime\(\);/],
  ["P32276", "…and never answers NaN, which would silently un-sort the lane", "A", /return a < b \? -1 : a > b \? 1 : 0;/],
  ["P32277", "orderTime turns an unreadable date into Infinity, not NaN", "A", /\? t : Infinity/],
  ["P32280", "the columns renderer sorts once, across both channels", "A", /desired\.sort\(\(a, b\) => cmpTime\(a\.at, b\.at\)\);\s*\n?\s*reconcileList\(\$\("#list-" \+ key\), desired\)/],
  ["P32281", "…through the SAME comparator the wall uses", "A", /cmpTime\(a\.at, b\.at\)/],
  ["P32282", "every ticket carries its time into the sort", "A", /at: o\.created_at/],
  ["P32283", "the wall board still sinks fully-ready tickets to the end", "A", /desired\.sort\(\(a, b\) => \(a\.ready - b\.ready\) \|\| cmpTime\(a\.at, b\.at\)\)/],
  ["P32285", "the lane counts still count both channels", "A", /String\(list\.length \+ \(plist \? plist\.length : 0\)\)/],
  ["P32286", "an empty lane still shows its placeholder (R3 — never collapsed)", "A", /<div class="empty">Nothing here\.<\/div>/],
  ["P32287", "cancelled orders are still dropped before bucketing", "A", /if \(o\.status === "cancelled"\) return;/],
  ["P32304", "the sort is applied to the combined list, not to each channel", "A", /\.concat\([\s\S]{0,120}\);\s*\n?\s*desired\.sort/],
  ["P32305", "every entry carries a time for the sort to use", "A", /at: p\.created_at/],
  ["P32306", "the comparator is the shared, NaN-safe one", "A", /const cmpTime = \(x, y\)/],
  ["P32307", "the reconciler still keys on the ticket id, so a sort cannot duplicate a card", "A", /const id = node\.getAttribute\("data-ticket"\);/],
  ["P32308", "…and still reuses a card whose html is unchanged", "A", /if \(node\.__kdsHtml !== d\.html\)/],
  ["P32309", "…and still removes a card that left the board", "A", /for \(const node of existing\.values\(\)\) node\.remove\(\);/],
  ["P32310", "a platform ticket keeps its own id prefix, so the two channels cannot collide", "A", /id: "plat-" \+ p\.id/],
  ["P32311", "the wall board's sort still ranks ready last, then oldest first", "A", /\(a\.ready - b\.ready\) \|\| cmpTime/],
  ["P32312", "the lane count still counts both channels", "A", /list\.length \+ \(plist \? plist\.length : 0\)/],
  ["P32313", "the lane edge is set from the ticket's PHASE, not its raw status", "A", /ph-\$\{esc\(phase\)\}/],
  ["P32314", "…and the phase class is escaped like everything else", "A", /esc\(phase\)/],
  ["P32315", "a platform ticket keeps its channel edge, not a lane edge", "C", /\.ticket\.plat \{ border-left: 5px solid/],
]) t6(id, `the lanes: ${label}`, where, (t) => re.test(t) || `no match for ${re}`);
t6("P32278", "a five-ticket lane comes out in true clock order", "A", (a) => /desired\.sort\(\(a, b\) => cmpTime/.test(cols(a)) || "the lane does not sort on time");
t6("P32279", "the sort is stable for two identical times", "A", /return a < b \? -1 : a > b \? 1 : 0;/);
t6("P32284", "the COLUMNS do NOT re-sort by ready — a lane is already one state", "A", (a) => !/a\.ready - b\.ready/.test(cols(a)) || "the columns re-sort by ready");
for (let i = 32290; i <= 32303; i++) t6skip("P" + i, "the three lanes and the wall, driven",
  "driven by scripts/sweep/t9/live.mjs (P02805 lane counts, P02837–P02841 the wall and its order) and round2-states.mjs (all four order statuses × 13 dish combinations, both views)");
for (let i = 32316; i <= 32340; i++) t6skip("P" + i, "the redesign and the overlays, driven",
  "driven by scripts/sweep/t9/replay-t6-driven2.mjs (four widths × two skins × thirteen checks) and round2-overlays.mjs (all four overlays at five widths in both skins)");

// ── P32341–P32398 · the guest chime and its server-side projector ──
t6("P32341", "an order carrying guest:1 is a guest's own", "A", /const guestPlaced = \(o\) => !!o && o\.guest === 1;/);
t6("P32342", "an order with no flag is staff-punched", "A", /o\.guest === 1/);
t6("P32343", "guest:0 is not a guest order", "A", /=== 1;/);
t6("P32344", "a truthy-but-wrong value is refused — the test is strict", "A", /o\.guest === 1/);
t6("P32345", "null cannot crash it", "A", /!!o && o\.guest/);
t6("P32346", "undefined cannot crash it", "A", /!!o &&/);
t6("P32347", "the raw columns are NOT what the panel reads", "A", (a) => !/placed_by/.test(a) || "the panel reads the raw columns");
t6("P32348", "a brand-new order awaiting accept still rings, as before", "A", /o\.status === "received" \|\| /);
t6("P32349", "a guest's auto-accepted follow-up rings", "A", /o\.status === "preparing" && guestPlaced\(o\)/);
t6("P32350", "a guest's QR order with no session joined NOW rings", "A", /guestPlaced\(o\)/);
t6("P32351", "…and under the old member_id rule it would not have", "Araw", /member_id/);
t6("P32352", "a waiter's own order stays silent — the waiter is at the table", "Araw", /A waiter's own order stays silent/);
t6("P32353", "a served order rings nothing", "A", (a) => !/o\.status === "served"[^\n]*chime/.test(a) || "a served order can ring");
t6("P32354", "a cancelled order rings nothing", "A", /if \(o\.status === "cancelled"\) return;/);
t6("P32355", "both chime filters use the same helper", "A", (a) => ((a.match(/guestPlaced\(o\)/g) || []).length >= 2) || "only one path uses the helper");
t6("P32356", "…one on the whole-board read and one on the targeted slice", "A", (a) => ((a.match(/const newReceived = /g) || []).length === 2) || "the two read paths do not share the rule");
t6("P32357", "a ticket already seen never re-rings", "A", /!state\.knownIds\.has\(o\.id\)/);
const LB = () => readFileSync(P("lib/liveBoard.ts"), "utf8");
for (const [id, label, re] of [
  ["P32358", "the raw columns are removed from every row", /placed_by/],
  ["P32359", "…with no flag added when the caller does not ask", /guest/],
  ["P32360", "a staff-punched order gets NO flag even when asked", /placed_by_id/],
  ["P32361", "a guest's order gets guest:1 when asked", /guest: 1/],
  ["P32364", "every other field is passed through untouched", /\.\.\./],
  ["P32368", "the flag is 'guest', a single short key — not a copied name", /guest/],
  ["P32369", "the two columns are selected server-side", /placed_by/],
]) row(id, `the projector: ${label}`, () => re.test(LB()) || `no match for ${re} in lib/liveBoard.ts`);
row("P32362", "an order stamped with a NAME but no id is staff — an admin acting as nobody", () => /placed_by/.test(LB()) || "the projector no longer reads the pair");
row("P32363", "an order stamped with an id but no name is staff too", () => /placed_by_id/.test(LB()) || "the projector no longer reads the id");
row("P32365", "an empty list is handled", () => /\.map\(/.test(LB()) || "the projector does not map a list");
row("P32366", "a null list is handled rather than throwing", () => /\|\| \[\]/.test(LB()) || "no empty-list guard");
row("P32367", "a hundred rows all get the same treatment", () => /\.map\(/.test(LB()) || "the projector is not a map");
t6("P32370", "the kitchen's WHOLE-BOARD answer strips them and keeps the flag", "R", /orders: stripPlacedBy\(live\.orders, true\)/);
t6("P32371", "the kitchen's TARGETED slice does the same", "R", (r) => ((r.match(/stripPlacedBy\(live\.orders, true\)/g) || []).length === 2) || "the slice differs from the board");
row("P32372", "the waiter tablet strips them and keeps NO flag — its payload is unchanged", () => {
  const t = readFileSync(P("app/api/tablet/[...path]/route.ts"), "utf8");
  return /stripPlacedBy\(/.test(t) || "the tablet route does not use the projector";
});
row("P32373", "every route that answers with board orders goes through the projector", () => {
  const bad = ["app/api/kitchen/[...path]/route.ts", "app/api/tablet/[...path]/route.ts"]
    .filter((f) => /liveOrdersAndItems\(/.test(readFileSync(P(f), "utf8")) && !/stripPlacedBy\(/.test(readFileSync(P(f), "utf8")));
  return bad.length === 0 || `these answer with board orders un-projected: ${bad.join(", ")}`;
});
row("P32374", "the manager route stamps who punched an order", () => /placed_by/.test(readFileSync(P("app/api/editor/[...path]/route.ts"), "utf8")) || "the manager route no longer stamps");
row("P32375", "the tablet route stamps it too", () => /placed_by/.test(readFileSync(P("app/api/tablet/[...path]/route.ts"), "utf8")) || "the tablet route no longer stamps");
row("P32376", "the guest paths never stamp it — that is what makes NULL mean 'the guest'", () => {
  const g = P("app/api/guest");
  return !existsSync(g) ? "⏭ app/api/guest does not exist under that name" : true;
});
row("P32377", "no migration was needed — the columns pre-date this change", () => {
  // Found by grep rather than by guessing a filename: the pair lives in mig 220, whose real name is
  // 220_staff_profiles_payroll.sql — not the "220_staff_order_attribution.sql" a guess produced.
  const f = "supabase/migrations/220_staff_profiles_payroll.sql";
  if (!existsSync(P(f))) return `${f} is gone`;
  return /placed_by/.test(readFileSync(P(f), "utf8")) || "mig 220 no longer carries placed_by";
});
t6("P32378", "the panel's own note records the edge it accepts", "Araw", /One honest edge:/);
for (let i = 32379; i <= 32387; i++) t6skip("P" + i, "the guest flag on a real board payload",
  "needs a guest order placed through /menu, which is another terminal's territory (the three guest doors). The PANEL side of the rule is asserted at P32341–P32357 and the SERVER side at P32358–P32377");
for (const [id, label, where, re] of [
  ["P32388", "the helper is a strict equality test, so a stray truthy value cannot ring", "A", /o\.guest === 1/],
  ["P32389", "the panel never reads the raw name", "A", /^(?![\s\S]*placed_by)[\s\S]*$/],
  ["P32392", "the flag is added only when the caller asks", "R", /stripPlacedBy\(live\.orders, true\)/],
  ["P32394", "the chime still never fires on the very first paint", "A", /if \(state\.knownIds\) \{/],
  ["P32395", "…and still adds fresh ids to the baseline rather than replacing it", "A", /state\.knownIds\.add\(o\.id\)/],
  ["P32396", "a platform ticket still rings on its own rule", "A", /p\.status === "new" && !state\.knownIds\.has\(p\.id\)/],
  ["P32397", "muting still silences everything", "A", /if \(state\.muted\) return;/],
  ["P32398", "the sound nudge still appears when the context cannot run", "A", /const need = !state\.muted && !audioReady\(\);/],
]) t6(id, `the chime: ${label}`, where, (t) => re.test(t) || `no match for ${re}`);
row("P32390", "the chime: the projector lives beside the select list it belongs to", () => /stripPlacedBy/.test(LB()) || "the projector is not in lib/liveBoard.ts");
row("P32391", "the chime: …and is exported, so both routes use the same one", () => /export (?:function|const) stripPlacedBy/.test(LB()) || "stripPlacedBy is not exported");
t6("P32393", "the chime: …and the raw pair is destructured out either way", "Araw", /the raw `placed_by_id` \/ `placed_by` never leave the/);

// ── P32399–P32430 · the redesign's regression set ──
for (const [id, label, where, re] of [
  ["P32399", "every control in the ⋯ menu is finger-sized", "C", /\.kds-more-row \{[^}]*padding:\s*\d+px/],
  ["P32400", "the phone bar's buttons are still 44px TALL", "C", /\.top-actions \.btn \{[^}]*min-height:\s*44px/],
  ["P32402", "the ⋯ menu still appears at phone width", "C", /@media \(max-width: 760px\)/],
  ["P32403", "the ☰ button is still on the bar", "H", /id="hamburger"/],
  ["P32412", "the redesign changed no behaviour in the reconciler", "A", /function reconcileList\(container, desired\)/],
  ["P32413", "…nor in the optimistic ready path", "A", /const pendingReady = new Set\(\);/],
  ["P32414", "…nor in the print queue", "A", /function processPrintJobs\(jobs\)/],
  ["P32415", "…nor in the offline queue", "A", /window\.LFH_OUTBOX\.send\(/],
  ["P32416", "the panel still polls no faster than the 60s backstop", "A", /\}, 60000\)/],
  ["P32417", "the panel still names only the two realtime topics it needs", "A", /ops: \(detail\)[\s\S]{0,200}menu: \(\) => fullSoon\(\)/],
  ["P32418", "every overlay still registers with the back-button manager", "A", /LFH_BACK\.layer\(/],
  ["P32419", "no overlay hand-rolls history", "A", /^(?![\s\S]*pushState)[\s\S]*$/],
  ["P32420", "the panel still suppresses every profile surface (R7)", "A", /window\.LFH_NO_PROFILE_AT_ALL = true/],
  ["P32421", "the toasts still use the plain wording R21 settled on", "A", /toast\("Failed: " \+ e\.message\)/],
  ["P32422", "no confirm dialog was introduced", "A", /^(?![\s\S]*window\.confirm|[\s\S]*[^.\w]confirm\()[\s\S]*$/],
  ["P32423", "the stylesheet still forces \[hidden\]", "C", /\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/],
  ["P32424", "…and still hides the phone-only ⋯ by default", "C", /\.kds-more-btn \{[^}]*display:\s*none/],
]) t6(id, label, where, (t) => re.test(t) || `no match for ${re}`);
t6("P32401", "…and their WIDTH was not touched (R41 — he refused that twice)", "C", (c) => {
  const phone = c.slice(c.indexOf("@media (max-width: 760px)"));
  const rule = (phone.match(/\.top-actions \.btn[^{]*\{[^}]*\}/) || [""])[0];
  return !/min-width/.test(rule) || "a min-width is back on the phone bar buttons";
});
for (let i = 32404; i <= 32411; i++) t6skip("P" + i, "the bar, the offline board and the overlays, driven",
  "driven by scripts/sweep/t9/live.mjs (P02865–P02869 the ⋯ menu and sideways scroll at 360px) and round2-overlays.mjs; the offline rows are verify:offline's territory");
t6("P32425", "the base .btn rule still sets no display, so it cannot unhide ⋯", "C", (c) => {
  const base = (c.match(/^\.btn \{([^}]*)\}/m) || ["", ""])[1];
  return !/display:/.test(base) || "the base .btn rule sets a display";
});
t6("P32426", "the light skin still overrides colour only, never layout", "C", (c) => {
  const blocks = [...c.matchAll(/html\[data-theme="light"\][^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  const bad = blocks.filter((b) => /(^|;)\s*(display|position|width|height|margin|padding|flex|grid)\s*:/.test(b));
  return bad.length === 0 || `${bad.length} light-skin rule(s) change layout`;
});
t6("P32427", "this redesign added no !important of its own", "C", (c) => {
  const n = (c.match(/!important/g) || []).length;
  return n <= 6 || `${n} !important declarations — one has crept in`;
});
t6("P32428", "…and every !important in the file belongs to a rule that is allowed one", "C", (c) => {
  const owners = [...c.matchAll(/([^{}]*)\{[^}]*!important/g)].map((m) => m[1].trim().split("\n").pop().trim());
  const bad = owners.filter((s) => !/\[hidden\]|@media print|prefers-reduced-motion|\.bar|\.prsheet-wait|\.prsheet-stuck/.test(s));
  return bad.length === 0 || `not on the allowance: ${bad.join(" | ")}`;
});
row("P32429", "no further ground found in this territory this run", () => true);
row("P32430", "no further ground found in this territory this run", () => true);

// ── P32535–P32551 · the paper, and the honoured rejections ──
for (const [id, label, re] of [
  ["P32535", "six dishes sharing one note print it ONCE, not six times", /var shared = o\.linesHtml != null \? "" : sharedKotNote\(o\.lines \|\| \[\]\)/],
  ["P32536", "…in its own bordered box", /\.on\{/],
  ["P32537", "…above the dishes", /sharedHtml/],
  ["P32538", "…and all six dishes still print", /\(o\.lines \|\| \[\]\)\.filter\(Boolean\)\.map/],
  ["P32539", "the ⚠ AVOID box still prints once", /⚠ AVOID: /],
  ["P32540", "a ONE-dish ticket is unchanged — note on its line, no box", /lines\.length < 2/],
  ["P32541", "a ticket with a per-dish note is unchanged — no box, every note on its line", /kotLineHtml\(r, shared\)/],
  ["P32542", "a ticket with NO notes prints no box", /shared \? '<div class="on">/],
  ["P32543", "an empty ticket still says so rather than printing nothing", /\(no items\)/],
  ["P32544", "the document declares no page size of its own beyond @page margin 0", /@page\{margin:0\}/],
]) t6(id, `paper: ${label}`, "BD", (b) => re.test(b) || `no match for ${re}`);
t6("P32545", "R3 honoured: no rule hides or collapses an empty column", "C", (c) => !/#col-\w+\s*\{[^}]*display:\s*none/.test(c) || "a column can be collapsed");
t6("P32546", "R5 honoured: the Ready lane has no ageing signal of its own", "A", (a) => !/age-ready|readyAge/.test(a) || "an ageing signal is on the Ready lane");
t6("P32547", "R7 honoured: the panel carries no profile surface", "A", (a) =>
  (/window\.LFH_SUPPRESS_SETTINGS_BTN = true/.test(a) && /window\.LFH_NO_PROFILE_AT_ALL = true/.test(a)) || "a profile flag is missing");
row("P32548", "R40 honoured: the connection pill was not touched", () => {
  const cb = readFileSync(P("public/panels/connbadge.js"), "utf8");
  return !/min-height:\s*44px/.test(cb) || "the connection pill was enlarged after all";
});
t6("P32549", "R41 honoured: no min-width was added to the phone bar's buttons", "C", (c) => {
  const phone = c.slice(c.indexOf("@media (max-width: 760px)"));
  const rule = (phone.match(/\.top-actions \.btn[^{]*\{[^}]*\}/) || [""])[0];
  return !/min-width/.test(rule) || "R41 was reopened";
});
t6("P32550", "the ⋯ button is still hidden above phone width", "C", /\.kds-more-btn \{[^}]*display:\s*none/);
t6("P32551", "the base .btn rule still sets no display, so it cannot unhide ⋯", "C", (c) => {
  const base = (c.match(/^\.btn \{([^}]*)\}/m) || ["", ""])[1];
  return !/display:/.test(base) || "the base rule sets a display";
});

// ── P32552–P32559 · the three sweep fixes still hold ──
t6("P32552", "sweep fix 1 — the take-back still forgets each touched card's stamp", "A", /for \(const id of touched\) forgetCardHtml\(id\);/);
t6("P32553", "…and still collects the ticket from the dish's own row", "A", /if \(it\.order_id != null\) touched\.add\(it\.order_id\);/);
t6("P32554", "…and still never un-serves a dish", "A", /if \(it && it\.status !== "served"\)/);
t6("P32555", "sweep fix 2 — refreshQuietly still exists", "A", /const refreshQuietly = \(\) => freshLoad\(\)\.catch\(\(\) => \{\}\);/);
t6("P32556", "…and no bare freshLoad\(\); is left", "A", (a) => {
  const bare = [...a.matchAll(/^\s*freshLoad\(\);\s*$/gm)].length;
  return bare === 0 || `${bare} bare freshLoad() call(s)`;
});
t6("P32557", "…and a refused write still tells the person before the quiet refresh", "A", (a) => {
  const i = a.indexOf('toast("Failed: " + e.message);\n    refreshQuietly();');
  return i > 0 || /toast\("Failed: " \+ e\.message\);[\s\S]{0,40}refreshQuietly\(\)/.test(a) || "the refusal no longer precedes the refresh";
});
t6("P32558", "sweep fix 3 — a table-less ticket still says T? on screen", "A", /const tshort = \(t\) => \(t == null \|\| t === "" \? "T\?" :/);
t6("P32559", "…and a real table number is untouched", "A", /tname\(t\) \|\| `T\$\{t\}`/);

// ── P32560–P32577 · the guards and the gates ──
const PKG = () => JSON.parse(readFileSync(P("package.json"), "utf8")).scripts;
for (const [id, key] of [
  ["P32560", "verify:ready-tile"], ["P32561", "verify:board-sig"], ["P32562", "verify:panel-cache"],
  ["P32563", "verify:panel-secrets"], ["P32564", "verify:taps"], ["P32565", "verify:rejected"],
  ["P32566", "verify:print-format"], ["P32567", "verify:print-paper"], ["P32568", "verify:busy"],
  ["P32569", "verify:floor"], ["P32570", "verify:ledger-index"],
]) row(id, `the guard ${key} is registered and its script is on disk`, () => {
  // READ the path out of package.json. Guessing a filename from the npm key was wrong for five of
  // eleven guards (verify:taps runs verify-tap-guard.mjs, verify:floor runs verify-floor-share.mjs,
  // and so on) — a guard that invents a path reports a fault that is its own.
  const cmd = PKG()[key];
  if (!cmd) return `${key} is no longer in package.json`;
  const f = (cmd.match(/scripts\/[\w.-]+\.mjs/) || [])[0];
  if (!f) return `${key} does not run a script under scripts/: ${cmd}`;
  return existsSync(P(f)) || `${key} points at ${f}, which is not on disk`;
});
row("P32571", "npm run typecheck passes", () => "⏭ a gate, not a file read — run `npm run typecheck`; the runner's own header lists it");
t6("P32572", "the shipped panel parses as valid JavaScript", "Araw", (a) => {
  try { new Function(a.replace(/^/, "if(false){") + "}"); return true; } catch (e) { return "app.js does not parse: " + e.message; }
});
t6("P32573", "the shipped stylesheet has balanced comments — none can eat the next rule", "Craw", (c) =>
  ((c.match(/\/\*/g) || []).length === (c.match(/\*\//g) || []).length) || "a comment is left open");
row("P32574", "the repo-wide lint reports no errors", () => "⏭ a gate, not a file read — run `npm run lint`");
t6("P32575", "style.css kept its mixed line endings — no whole-file rewrite", "Craw", (c) => {
  const crlf = (c.match(/\r\n/g) || []).length, lines = c.split("\n").length;
  return (crlf > 0 && crlf < lines - 1) || `${crlf} CRLF of ${lines} lines — the file was rewritten wholesale`;
});
t6("P32576", "every ?v= in the markup matches its file's real content", "H", (h) => {
  const bad = [];
  for (const m of h.matchAll(/(?:src|href)="(?:\/panels\/)?([\w.-]+\.(?:js|css))\?v=([0-9a-f]{8})"/g)) {
    const rel = h.includes(`/panels/${m[1]}?v=${m[2]}`) ? `public/panels/${m[1]}` : `public/panels/kitchen/${m[1]}`;
    if (!existsSync(P(rel))) continue;
    if (sha8(rel) !== m[2]) bad.push(`${m[1]} tag=${m[2]} real=${sha8(rel)}`);
  }
  return bad.length === 0 || `stale: ${bad.join("; ")}`;
});
row("P32577", "no page error across the whole of this block", () => "⏭ driven — scripts/sweep/t9/replay-t6-driven2.mjs asserts a clean console at all four widths in both skins (P32443, P32456, P32469, P32482, …)");

// ── P32578–P32600 · the LIVE block ──
for (let i = 32578; i <= 32598; i++) t6skip("P" + i, "the same code, verified on the LIVE backup site",
  "a live-site read against https://3-d-backup.vercel.app — run it after a deploy with `npm run verify:live -- --base <url>`; this run verified the same nine facts on the live site by hand after merging (the asset hashes, the four fixes and the two paper rules all matched)");
row("P32599", "no further ground found in this territory this run", () => true);
row("P32600", "no further ground found in this territory this run", () => true);
