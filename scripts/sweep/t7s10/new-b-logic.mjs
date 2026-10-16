// BLOCK B · from P176101 — THE PANEL'S OWN LOGIC, RUN INSIDE THE REAL PANEL WITH REAL INPUTS. Every
// helper my third declares that a screen depends on is called in the live frame (French House's
// manager, port 4407) with ordinary, edge and broken inputs. Busy tables are an in-memory party
// (fixture.mjs) — nothing is written. One batch per group so a hundred rows cost a handful of
// round trips; each row still asserts one thing and says what it got.
import { check, ev } from "./lib.mjs";
import { WITH } from "./fixture.mjs";

const F = "`public/panels/editor/app.js`";
let n = 176101;
const id = () => "P" + n++;
const groups = [];
// G(fn, cases): cases = [what, expr, expect(got) | value]. One page round trip per group.
function G(fn, cases, wrap = (body) => `(async () => { ${body} })()`) {
  const g = { cases, res: null };
  groups.push(g);
  const run = async () => {
    if (g.res) return g.res;
    const body = `const out = []; for (const f of [${cases.map((c) => `async () => { try { return (${c[1]}); } catch (e) { return "THREW: " + e.message; } }`).join(",")}]) out.push(await f()); return out;`;
    g.res = await ev(wrap(body));
    return g.res;
  };
  cases.forEach(([what, expr, want], i) => check(id(), `${F} → ${fn} — ${what}`, `LIVE: ${expr.length > 110 ? expr.slice(0, 107) + "…" : expr}`, async () => {
    const got = (await run())[i];
    const ok = typeof want === "function" ? !!want(got) : JSON.stringify(got) === JSON.stringify(want);
    return { ok, note: `got ${JSON.stringify(got)}`.slice(0, 220) };
  }));
}
const ago = (s) => `new Date(Date.now() - ${s} * 1000).toISOString()`;

G("timeAgo", [
  ["nothing → nothing", "timeAgo(null)", ""],
  ["30 s → 'just now'", `timeAgo(${ago(30)})`, "just now"],
  ["5 min → '5m ago'", `timeAgo(${ago(300)})`, "5m ago"],
  ["59 min → '59m ago', never '0h'", `timeAgo(${ago(3599)})`, "59m ago"],
  ["2 h → '2h ago'", `timeAgo(${ago(7300)})`, "2h ago"],
  ["3 days → '3d ago'", `timeAgo(${ago(3 * 86400 + 5)})`, "3d ago"],
  ["a clock a minute FAST on this device never reads as a negative age", `timeAgo(new Date(Date.now() + 60000).toISOString())`, "just now"],
]);
G("whenLabel", [
  ["nothing → nothing", "whenLabel(undefined)", ""],
  ["20 s → 'just now'", `whenLabel(${ago(20)})`, "just now"],
  ["one day → 'yesterday'", `whenLabel(${ago(86400 + 60)})`, "yesterday"],
  ["two days → '2 days ago'", `whenLabel(${ago(2 * 86400 + 60)})`, "2 days ago"],
  ["older than three days → a real calendar date, in India's day (item 3)", `whenLabel("2026-06-12T20:00:00Z")`, "13 Jun 2026"],
]);
G("fullWhen", [
  ["nothing → '—'", "fullWhen(null)", "—"],
  ["a UTC evening prints India's next-day date and time", `fullWhen("2026-06-12T20:00:00Z")`, (g) => /13 Jun 2026/.test(g) && /01:30/.test(g)],
]);
G("nameOf", [
  ["a plain string is itself", `nameOf("Starters", "x")`, "Starters"],
  ["a language map gives English first", `nameOf({ en: "Mains", hi: "मुख्य" }, "x")`, "Mains"],
  ["no English → the first language that has words", `nameOf({ hi: "मिठाई" }, "x")`, "मिठाई"],
  ["blank everywhere → the slug", `nameOf({ en: "  " }, "desserts")`, "desserts"],
  ["nothing at all → ''", `nameOf(null)`, ""],
]);
G("actLabel", [
  ["an empty action reads '—'", "actLabel('')", "—"],
  ["a known action reads its sentence", "actLabel('blocklist_add')", "Added to the blocklist"],
  ["an UNKNOWN action still reads as words, never the raw code", "actLabel('table_shift_undo')", "Table shift undo"],
  ["surrounding spaces do not defeat the lookup", "actLabel('  blocklist_remove ')", "Removed from the blocklist"],
]);
G("slugifyKey", [
  ["'Main Courses' → 'main-courses'", "slugifyKey('Main Courses')", "main-courses"],
  ["punctuation and accents collapse to single dashes", "slugifyKey('Crème  Brûlée!!')", "cr-me-br-l-e"],
  ["leading/trailing junk is trimmed", "slugifyKey('  --Soup--  ')", "soup"],
  ["nothing → ''", "slugifyKey(null)", ""],
  ["a name in Hindi alone gives an EMPTY slug — save() then asks for one by name ('Slug is required')", "slugifyKey('पनीर टिक्का')", ""],
]);
G("localizeCat", [
  ["a language map gives English", "localizeCat({ en: 'Breads' }, 'b')", "Breads"],
  ["no English → the first non-empty language", "localizeCat({ en: '', hi: 'रोटी' }, 'b')", "रोटी"],
  ["no name → the slug", "localizeCat(null, 'breads')", "breads"],
]);
G("callEmoji", [
  ["water → 💧", "callEmoji('Water please')", "💧"],
  ["cutlery / fork / spoon → 🍴", "[callEmoji('cutlery'), callEmoji('a fork'), callEmoji('SPOON')].join('')", "🍴🍴🍴"],
  ["napkins → 🧻", "callEmoji('Napkins')", "🧻"],
  ["clean the table → 🧹", "callEmoji('clean table')", "🧹"],
  ["the bill → 🧾", "callEmoji('Bill please')", "🧾"],
  ["a plain call (no note) → 🙋", "callEmoji(null)", "🙋"],
]);
G("logPartsAllowed / allowedLogView", [
  ["with nothing switched off, all three views are allowed", "(() => { const k = XRAY_WHO.logParts; XRAY_WHO.logParts = {}; try { return logPartsAllowed(); } finally { XRAY_WHO.logParts = k; } })()", { removals: true, activity: true, customers: true }],
  ["a view switched off falls over to the next one still on", "(() => { const k = XRAY_WHO.logParts, v = state.logView; XRAY_WHO.logParts = { removals: false }; state.logView = 'audit'; try { return allowedLogView(); } finally { XRAY_WHO.logParts = k; state.logView = v; } })()", "operations"],
  ["all three off → null, which the tab turns into a sentence", "(() => { const k = XRAY_WHO.logParts; XRAY_WHO.logParts = { removals: false, activity: false, customers: false }; try { return allowedLogView(); } finally { XRAY_WHO.logParts = k; } })()", null],
]);
G("moduleOn / tableTagsOn / khataOn", [
  ["a module the admin has NOT allowed is off, whatever the owner says", "(() => { const s = state.data.settings, k = { ...s }; Object.assign(s, { parcel_allowed: false, parcel_enabled: true }); try { return moduleOn('parcel'); } finally { Object.assign(s, k); } })()", false],
  ["allowed and no owner control → on", "(() => { const s = state.data.settings, k = { ...s }; Object.assign(s, { parcel_allowed: true, parcel_owner_control: false }); try { return moduleOn('parcel'); } finally { Object.assign(s, k); } })()", true],
  ["allowed, owner controls it and switched it off → off", "(() => { const s = state.data.settings, k = { ...s }; Object.assign(s, { parcel_allowed: true, parcel_owner_control: true, parcel_enabled: false }); try { return moduleOn('parcel'); } finally { Object.assign(s, k); } })()", false],
  ["table types follow the same two-key rule", "(() => { const s = state.data.settings, k = { ...s }; Object.assign(s, { table_tags_allowed: true, table_tags_owner_control: true, table_tags_enabled: false }); try { return tableTagsOn(); } finally { Object.assign(s, k); } })()", false],
  ["…and the Pay Later book too", "(() => { const s = state.data.settings, k = { ...s }; Object.assign(s, { khata_allowed: true, khata_owner_control: false }); try { return khataOn(); } finally { Object.assign(s, k); } })()", true],
  ["splitBillOn reads the owner's split switch", "(() => { const s = state.data.settings, k = s.split_bill_enabled; s.split_bill_enabled = true; try { return splitBillOn(); } finally { s.split_bill_enabled = k; } })()", true],
]);
G("tagActionAllowed / takeOrdersAllowed / qopCanFloor", [
  ["the table-type picker is closed while table types are off, even for a granted manager", "(() => { const s = state.data.settings, k = { ...s }; Object.assign(s, { table_tags_allowed: false }); try { return tagActionAllowed('table_tags'); } finally { Object.assign(s, k); } })()", false],
  ["take-order follows the manager's grant (French House's manager is granted it)", "takeOrdersAllowed()", true],
  ["qopCanFloor answers a grant question without throwing on an unknown key", "typeof qopCanFloor('no_such_power')", "boolean"],
]);
G("floorPerRow / touchCap / floorShapeKnown", [
  ["a desktop takes the restaurant's number as it is", "(() => { const s = state.data.settings, k = s.floor_per_row; s.floor_per_row = 9; try { return floorPerRow(); } finally { s.floor_per_row = k; } })()", 9],
  ["a number above 12 is clamped to 12", "(() => { const s = state.data.settings, k = s.floor_per_row; s.floor_per_row = 40; try { return floorPerRow(); } finally { s.floor_per_row = k; } })()", 12],
  ["a number below 2 is clamped to 2", "(() => { const s = state.data.settings, k = s.floor_per_row; s.floor_per_row = 0; try { return floorPerRow(); } finally { s.floor_per_row = k; } })()", 2],
  ["junk falls back to the remembered or default number, never NaN", "(() => { const s = state.data.settings, k = s.floor_per_row; s.floor_per_row = 'lots'; try { return Number.isFinite(floorPerRow()); } finally { s.floor_per_row = k; } })()", true],
  ["the floor's shape is known once settings have arrived", "floorShapeKnown()", true],
]);
G("floorTableList", [
  ["30 tables and nothing above → exactly 1…30", "(() => { const k = state.summary; state.summary = { ...k, tiles: {} }; try { const l = floorTableList(30); return [l.length, l[0], l[29]]; } finally { state.summary = k; } })()", [30, 1, 30]],
  ["an OCCUPIED table above the count still earns a tile (its money cannot hide)", "(() => { const k = state.summary; state.summary = { ...k, tiles: { 34: { state: 'prep' } } }; try { return floorTableList(30).slice(-1)[0]; } finally { state.summary = k; } })()", 34],
  ["a FREE stray above the count earns none (two junk rows grew a floor to 32 once)", "(() => { const k = state.summary; state.summary = { ...k, tiles: { 9343531: { state: 'free' } } }; try { return floorTableList(30).length; } finally { state.summary = k; } })()", 30],
  ["a non-number tile key is ignored", "(() => { const k = state.summary; state.summary = { ...k, tiles: { patio: { state: 'prep' } } }; try { return floorTableList(5).length; } finally { state.summary = k; } })()", 5],
]);
G("invoiceLocksOrder", [
  ["no session → never locked", "invoiceLocksOrder(null, {})", false],
  ["no invoice number → not locked", "invoiceLocksOrder({ invoice_no: null }, {})", false],
  ["a LIVE invoice locks every ticket", "invoiceLocksOrder({ invoice_no: 7, invoice_voided: false }, { created_at: new Date().toISOString() })", true],
  ["a reopened invoice locks a ticket punched BEFORE it was issued", "invoiceLocksOrder({ invoice_no: 7, invoice_voided: true, invoice_at: '2026-10-16T10:00:00Z' }, { created_at: '2026-10-16T09:00:00Z' })", true],
  ["…and frees one punched AFTER the reopen", "invoiceLocksOrder({ invoice_no: 7, invoice_voided: true, invoice_at: '2026-10-16T10:00:00Z' }, { created_at: '2026-10-16T11:00:00Z' })", false],
  ["a missing timestamp is treated as ON the paper — never the thing that lets a line off", "invoiceLocksOrder({ invoice_no: 7, invoice_voided: true, invoice_at: null }, { created_at: '2026-10-16T11:00:00Z' })", true],
]);
G("courseOfRow / menuSeq", [
  ["a dish on the menu gets its course and a 3-letter mark", "(() => { const d = (state.data.items || [])[0]; const c = courseOfRow({ title: d.title }); return !!c.slug && c.abbr.length >= 1 && c.abbr.length <= 3; })()", true],
  ["the lookup ignores case and edge spaces", "(() => { const d = (state.data.items || [])[0]; return courseOfRow({ title: '  ' + d.title.toUpperCase() + ' ' }).slug === courseOfRow({ title: d.title }).slug; })()", true],
  ["a dish no longer on the menu sorts LAST and says so", "(() => { const c = courseOfRow({ title: 'Retired Dish zz' }); return [c.name, c.seq >= 9990]; })()", ["Not on the menu now", true]],
  ["every course has a tint (its own colour or the palette's)", "(() => { const m = menuSeq(); return [...m.catBySlug.values()].every((c) => !!c.tint); })()", true],
  ["courses are numbered 1… in the menu's own order", "(() => { const m = menuSeq(); const s = [...m.catBySlug.values()].map((c) => c.seq).sort((a, b) => a - b); return s[0] === 1 && s.every((v, i) => v === i + 1); })()", true],
]);
G("spineState", [
  ["it always hands back the five maps the popup reads, even on first use", "(() => { const k = state.spine; state.spine = null; try { const s = spineState(); return Object.keys(s).sort(); } finally { state.spine = k; } })()", ["cat", "guests", "open", "view", "wait"]],
  ["an older saved shape without `wait` is completed, not thrown on", "(() => { const k = state.spine; state.spine = { view: {}, cat: {}, open: {}, guests: {} }; try { return typeof spineState().wait; } finally { state.spine = k; } })()", "object"],
]);
G("normalizeTileState", [
  ["an open table nobody has joined reads 'Free' (open/close is gone)", "normalizeTileState({ st: 'waiting', label: 'Open', meta: 'x' }).label", "Free"],
  ["a free tile carries no meta line", "normalizeTileState({ st: 'free', label: 'Free', meta: 'tap to open' }).meta", ""],
  ["any other state passes through untouched", "normalizeTileState({ st: 'prep', label: 'Preparing', meta: '1/2 served' }).meta", "1/2 served"],
]);
G("mergeGroupLabel / mergeCredit (no merge on the floor today)", [
  ["a table with no merge has no group label", "mergeGroupLabel('5')", null],
  ["…and no 'joined by' credit", "mergeCredit('5')", ""],
]);
G("tableHasAnyParty / summaryTableOpen / sliceLoaded", [
  ["a table with no tile has no party", "(() => { const k = state.summary; state.summary = { ...k, tiles: {} }; try { return tableHasAnyParty('7'); } finally { state.summary = k; } })()", false],
  ["a 'Wants in' table is NOT a party yet", "(() => { const k = state.summary; state.summary = { ...k, tiles: { 7: { state: 'req' } } }; try { return tableHasAnyParty('7'); } finally { state.summary = k; } })()", false],
  ["a cooking table is", "(() => { const k = state.summary; state.summary = { ...k, tiles: { 7: { state: 'prep' } } }; try { return tableHasAnyParty('7'); } finally { state.summary = k; } })()", true],
  ["a free table is not 'open' for the streaming popup", "(() => { const k = state.summary; state.summary = { ...k, tiles: {} }; try { return summaryTableOpen('7'); } finally { state.summary = k; } })()", false],
]);
G("todaysParcels", [
  ["only TODAY's staff parcels count, numbered 1… in the order they came", "(() => { const k = state.data.platform; const now = Date.now(); state.data.platform = [{ id: 'b', source: 'parcel', created_at: new Date(now - 60000).toISOString() }, { id: 'a', source: 'parcel', created_at: new Date(now - 120000).toISOString() }, { id: 'z', source: 'zomato', created_at: new Date(now).toISOString() }, { id: 'y', source: 'parcel', created_at: '2020-01-01T00:00:00Z' }]; try { return todaysParcels().map((p) => p.id + p.parcel_no); } finally { state.data.platform = k; } })()", ["a1", "b2"]],
  ["a parcel with no time is left out, not dated 1970", "(() => { const k = state.data.platform; state.data.platform = [{ id: 'x', source: 'parcel' }]; try { return todaysParcels().length; } finally { state.data.platform = k; } })()", 0],
]);
G("buildEditExpect", [
  ["a brand-new record (no baseline) sends no expectation", "buildEditExpect('items', { price: 10 }, null)", null],
  ["an unknown kind sends none", "buildEditExpect('nope', { a: 1 }, JSON.stringify({ id: 'x', a: 0 }))", null],
  ["a dish edit names menu_items and the dish id", "(() => { const e = buildEditExpect('items', { price: 120 }, JSON.stringify({ id: 'd1', price: 100 })); return [e.table, e.id, e.fields.price]; })()", ["menu_items", "d1", 100]],
  ["a category is keyed by its SLUG (it has no id column)", "buildEditExpect('categories', { sort_order: 3 }, JSON.stringify({ slug: 'mains', sort_order: 2 })).id", "mains"],
  ["settings are keyed by the restaurant", "buildEditExpect('settings', { tax_rate: 0.05 }, JSON.stringify({ restaurant_id: 'r1', tax_rate: 0.18 })).id", "r1"],
  ["the money fields go first, so the 8-field cap can never drop the price", "Object.keys(buildEditExpect('items', { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1, a6: 1, a7: 1, a8: 1, price: 2 }, JSON.stringify({ id: 'd', a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, a7: 0, a8: 0, price: 1 })).fields)[0]", "price"],
  ["at most 8 fields travel (the server caps at 8 too)", "Object.keys(buildEditExpect('items', Object.fromEntries([...Array(12)].map((_, i) => ['f' + i, 1])), JSON.stringify({ id: 'd', ...Object.fromEntries([...Array(12)].map((_, i) => ['f' + i, 0])) })).fields).length", 8],
  ["an ordered LIST (a dish's options) is left out — a set compare would be wrong for it", "buildEditExpect('items', { options: [{ label: 'L' }] }, JSON.stringify({ id: 'd', options: [] }))", null],
  ["…but a dish's TAGS travel, as the set they are (item 6 — the kitchen's sold-out lives there)", "buildEditExpect('items', { tags: ['a'] }, JSON.stringify({ id: 'd', tags: ['b', 'sold-out'] })).fields.tags", ["b", "sold-out"]],
  ["a plain OBJECT field is protected (compared by content)", "buildEditExpect('settings', { table_names: { 1: 'Patio' } }, JSON.stringify({ restaurant_id: 'r', table_names: {} })).fields.table_names", {}],
  ["identity and control keys never travel as values", "Object.keys(buildEditExpect('items', { id: 'd', slug: 's', __create: false, price: 1 }, JSON.stringify({ id: 'd', slug: 's', price: 2 })).fields)", ["price"]],
  ["a field the baseline did not carry is skipped, not sent as undefined", "buildEditExpect('items', { brand_new: 1 }, JSON.stringify({ id: 'd' }))", null],
  ["a broken baseline sends nothing rather than throwing", "buildEditExpect('items', { price: 1 }, '{not json')", null],
]);
G("REMOVAL_REASONS / REOPEN_REASONS / AUDIT_KIND", [
  ["six removal reasons, each with a code, a label and an icon", "REMOVAL_REASONS.length === 6 && REMOVAL_REASONS.every((r) => r[0] && /^\\S+ \\S/.test(r[1]))", true],
  ["'other' is last and asks for words", "REMOVAL_REASONS[5][0] === 'other' && /below/.test(REMOVAL_REASONS[5][2])", true],
  ["the reopen reasons lead with 'more to add', the commonest", "/more|add/i.test(REOPEN_REASONS[0][1] + REOPEN_REASONS[0][0])", true],
  ["every audit kind has an icon AND a word", "Object.values(AUDIT_KIND).every((v) => Array.isArray(v) && v[0] && v[1])", true],
  ["the audit's reason text knows every removal code", "REMOVAL_REASONS.every((r) => typeof auditReasonTxt({ reason_code: r[0] }) === 'string' && auditReasonTxt({ reason_code: r[0] }).length > 0)", true],
]);
G("STLABEL_SP / SPINE_TINTS / TABLE_TAG_INFO", [
  ["every order status has a word on the bill", "['received','preparing','ready','served','cancelled'].every((k) => !!STLABEL_SP[k])", true],
  ["ten spine tints, all real colours", "SPINE_TINTS.length === 10 && SPINE_TINTS.every((c) => /^#[0-9a-f]{6}$/i.test(c))", true],
  ["every table type has an emoji, a label and a ribbon", "Object.values(TABLE_TAG_INFO).every((v) => v.emoji && v.label && v.ribbon)", true],
]);
G("partyOrders / openSessionForTable", [
  ["a party's orders are its OWN session's (the in-memory party at T30)", WITH({ orders: [{ status: "preparing", items: [{ title: "Croque Monsieur", price: 320 }] }] }, "return partyOrders(T).length;"), 1],
  ["…and the open session is found by table", WITH({ orders: [{ status: "preparing", items: [{ title: "Croque Monsieur", price: 320 }] }] }, "return openSessionForTable(T).id;"), "t7s10-sess-30"],
  ["an order from BEFORE the party sat down is not theirs (sessions on)", WITH({ settings: { sessions_enabled: true }, openedMins: 10, orders: [{ status: "preparing", mins: 300, items: [{ title: "Croque Monsieur", price: 320 }] }] }, "state.data.orders.find((o) => o.table_number === T).session_id = null; return ordersForTable(T).length;"), 0],
]);

// tableTileStateFromBoard — the colours and counts of a tile, from the full board (the parity reference)
const TS = (spec, body) => WITH(spec, body);
check(id(), `${F} → tableTileStateFromBoard — a table with nothing on it is Free`, "LIVE: fixture with no orders and no session", async () => { const g = await ev(TS({ noSession: true, orders: [] }, "return tableTileStateFromBoard(T).st;")); return { ok: g === "free", note: g }; });
check(id(), `${F} → tableTileStateFromBoard — a waiting ticket outranks everything: 'New order'`, "LIVE: one cooking + one received ticket", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "A", status: "ready" }] }, { status: "received", items: [{ title: "B", status: "received" }] }] }, "const s = tableTileStateFromBoard(T); return [s.st, s.label, s.hasNew];")); return { ok: JSON.stringify(g) === JSON.stringify(["new", "New order", true]), note: JSON.stringify(g) }; });
check(id(), `${F} → tableTileStateFromBoard — any dish READY turns it 'Ready to serve' even while others cook`, "LIVE: one ready, one preparing", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "A", status: "ready" }, { title: "B", status: "preparing" }] }] }, "return tableTileStateFromBoard(T).st;")); return { ok: g === "ready", note: g }; });
check(id(), `${F} → tableTileStateFromBoard — all served, unpaid → 'Served' with a red pay ring`, "LIVE: one served, pending", async () => { const g = await ev(TS({ orders: [{ status: "served", items: [{ title: "A", status: "served" }] }] }, "const s = tableTileStateFromBoard(T); return [s.st, s.pay, s.done];")); return { ok: JSON.stringify(g) === JSON.stringify(["bill", "red", false]), note: JSON.stringify(g) }; });
check(id(), `${F} → tableTileStateFromBoard — all served AND paid → 'Cleared', green, offered to close`, "LIVE: one served, paid", async () => { const g = await ev(TS({ orders: [{ status: "served", pay: "paid", items: [{ title: "A", status: "served" }] }] }, "const s = tableTileStateFromBoard(T); return [s.st, s.pay, s.done];")); return { ok: JSON.stringify(g) === JSON.stringify(["done", "green", true]), note: JSON.stringify(g) }; });
check(id(), `${F} → tableTileStateFromBoard — a cancelled ticket does not keep a table busy`, "LIVE: one cancelled order only", async () => { const g = await ev(TS({ orders: [{ status: "cancelled", items: [{ title: "A", status: "preparing" }] }] }, "return tableTileStateFromBoard(T).st;")); return { ok: g !== "prep" && g !== "new", note: g }; });
check(id(), `${F} → tableTileStateFromBoard — the counts add quantities, not lines (2× Soup = 2)`, "LIVE: one line of qty 2 preparing", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "Soup", qty: 2, status: "preparing" }] }] }, "return tableTileStateFromBoard(T).counts;")); return { ok: g.ck === 2, note: JSON.stringify(g) }; });
check(id(), `${F} → tableTileStateFromBoard — 'N/M served' and the money due are on the meta line`, "LIVE: one served + one cooking, unpaid", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "A", status: "served", price: 100 }, { title: "B", status: "preparing", price: 100 }] }] }, "return tableTileStateFromBoard(T).meta;")); return { ok: /^1\/2 served · ₹210\u00a0due$/.test(g), note: JSON.stringify(g) }; });
check(id(), `${F} → tableTileStateFromBoard — a waiting ticket's money is NOT in the due (it is not on the bill yet)`, "LIVE: one received ticket only", async () => { const g = await ev(TS({ orders: [{ status: "received", items: [{ title: "A", status: "received", price: 300 }] }] }, "return tableTileStateFromBoard(T).meta;")); return { ok: !/due/.test(g), note: JSON.stringify(g) }; });
check(id(), `${F} → tableTileStateFromBoard — a waiter call shows its emoji badge`, "LIVE: one cooking + a water call", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "A" }] }], calls: [{ mins: 1 }] }, "state.data.calls.find((c) => c.table_number === T).note = 'water'; const s = tableTileStateFromBoard(T); return [s.hasCall, /💧/.test(s.badges)];")); return { ok: JSON.stringify(g) === "[true,true]", note: JSON.stringify(g) }; });
check(id(), `${F} → tableTileStateFromBoard — more than three calls collapse into '+N'`, "LIVE: five calls", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "A" }] }], calls: [{}, {}, {}, {}, {}] }, "return tableTileStateFromBoard(T).badges;")); return { ok: /\+2</.test(g), note: g.slice(0, 160) }; });
check(id(), `${F} → tableTileStateFromBoard — a tile drawn from the summary agrees with the board for the same party (parity)`, "LIVE: tableTileStateFromSummary vs FromBoard", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "A", status: "served", price: 100 }, { title: "B", status: "preparing", price: 100 }] }] }, "const a = tableTileStateFromBoard(T), b = tableTileStateFromSummary(T); return [a.st === b.st, a.label === b.label, JSON.stringify(a.counts) === JSON.stringify(b.counts), a.pay === b.pay];")); return { ok: g.every(Boolean), note: JSON.stringify(g) }; });

// orderItemRows
check(id(), `${F} → orderItemRows — a session order's rows come from its own lines, each carrying the invoice lock`, "LIVE: fixture order with two lines", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "A" }, { title: "B" }] }] }, "const o = ordersForTable(T)[0]; const r = orderItemRows(o); return [r.length, r.every((x) => x.kind === 'session' && x.invoiceLive === false)];")); return { ok: JSON.stringify(g) === "[2,true]", note: JSON.stringify(g) }; });
check(id(), `${F} → orderItemRows — a legacy order with no line rows falls back to its items JSON, by index`, "LIVE: fixture order marked legacy", async () => { const g = await ev(TS({ orders: [{ status: "preparing", legacy: true, items: [{ title: "A" }, { title: "B" }] }] }, "const o = ordersForTable(T)[0]; const r = orderItemRows(o); return r.map((x) => x.kind + x.idx);")); return { ok: JSON.stringify(g) === JSON.stringify(["legacy0", "legacy1"]), note: JSON.stringify(g) }; });
check(id(), `${F} → orderItemRows — a price that is not a number becomes 0, never NaN on the bill`, "LIVE: a line priced 'abc'", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "A", price: "abc" }] }] }, "const o = ordersForTable(T)[0]; return orderItemRows(o)[0].price;")); return { ok: g === 0, note: JSON.stringify(g) }; });
check(id(), `${F} → orderItemRows — the MRP flag rides on the row (frozen on the sold line)`, "LIVE: a line marked is_mrp", async () => { const g = await ev(TS({ orders: [{ status: "preparing", items: [{ title: "Water", is_mrp: true }] }] }, "const o = ordersForTable(T)[0]; return orderItemRows(o)[0].is_mrp;")); return { ok: g === true, note: JSON.stringify(g) }; });

// floorStatsHtml
check(id(), `${F} → floorStatsHtml — 'Occupied' counts the fixture's busy tables over the table count`, "LIVE: three in-memory parties", async () => { const g = await ev(WITH({ t: 28, orders: [{ status: "preparing", items: [{ title: "A" }] }] }, `return await ${WITH({ t: 29, orders: [{ status: "served", items: [{ title: "B", status: "served" }] }] }, "const h = floorStatsHtml(); const d = document.createElement('div'); d.innerHTML = h; return d.querySelector('[data-fstat=occupied] .fstat-n').textContent;")};`)); return { ok: /^2\/\d+$/.test(g), note: g }; });
check(id(), `${F} → floorStatsHtml — 'To pay' counts the served-unpaid table`, "LIVE: one served-unpaid table", async () => { const g = await ev(WITH({ t: 29, orders: [{ status: "served", items: [{ title: "B", status: "served" }] }] }, "const d = document.createElement('div'); d.innerHTML = floorStatsHtml(); return d.querySelector('[data-fstat=pay] .fstat-n').textContent;")); return { ok: Number(g) >= 1, note: g }; });
check(id(), `${F} → floorStatsHtml — 'Needs you' counts TABLES: four calls at one table is 1`, "LIVE: one table, four calls", async () => { const g = await ev(WITH({ t: 27, orders: [{ status: "preparing", items: [{ title: "A" }] }], calls: [{}, {}, {}, {}] }, "const d = document.createElement('div'); d.innerHTML = floorStatsHtml(); return d.querySelector('[data-fstat=needy] .fstat-n').textContent;")); return { ok: g === "1", note: g }; });
check(id(), `${F} → floorStatsHtml — every chip carries its full words in its tooltip AND its aria-label`, "LIVE: read the three chips", async () => { const g = await ev("(() => { const d = document.createElement('div'); d.innerHTML = floorStatsHtml(); return [...d.querySelectorAll('.fstat')].map((b) => !!b.title && b.title === b.getAttribute('aria-label')); })()"); return { ok: g.length === 3 && g.every(Boolean), note: JSON.stringify(g) }; });
check(id(), `${F} → floorStatsHtml — the lists behind the numbers are kept for the tap (state.floorStatLists)`, "LIVE: one cooking table", async () => { const g = await ev(WITH({ t: 26, orders: [{ status: "preparing", items: [{ title: "A" }] }] }, "floorStatsHtml(); return state.floorStatLists.occupied.includes(T);")); return { ok: g === true, note: JSON.stringify(g) }; });
check(id(), `${F} → floorStatsHtml — R10: 'To pay' is a count, never a rupee figure`, "LIVE: one served-unpaid table", async () => { const g = await ev(WITH({ t: 29, orders: [{ status: "served", items: [{ title: "B", status: "served", price: 500 }] }] }, "const d = document.createElement('div'); d.innerHTML = floorStatsHtml(); return d.textContent;")); return { ok: !/₹/.test(g), note: g }; });
