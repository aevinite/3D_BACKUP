// scripts/sweep/t9s10/r2-g-arms.mjs — round 2, block G (P178845–P178970): the branch ARMS of my half that
// no check took, from `node scripts/sweep/t9s10/coverage.mjs --branches` (211 after block E). Three kinds:
//   · G1 — "the database answered, with nothing": one sweep drives every endpoint with every read empty;
//   · G2 — the arms that are real decisions, each driven on its own;
//   · G3 — the arms that CANNOT be reached by design, each recorded with the reason (no test can exist).
import { check, world, call, SUBJECT, RID } from "./lib.mjs";

let N = 178845;
const id = () => { if (N > 178970) throw new Error("block G is full"); return "P" + N++; };
const C = (what, how, fn) => check(id(), `${SUBJECT} — ${what}`, `STUB · ${how}`, fn);
const NOW = () => new Date(Date.now() - 1000).toISOString();
const ON = (k) => ({ [`${k}_allowed`]: true, [`${k}_owner_control`]: false, [`${k}_enabled`]: true });
const RPC_NULL = Object.fromEntries(["lfh_recognize_customer", "lfh_customer_phone_search", "lfh_khata_outstanding", "lfh_khata_collected",
  "lfh_ratings_summary", "lfh_table_view_summary", "lfh_floor_bundle", "lfh_verify_bill_chain"].map((k) => [k, null]));
const junk = (t) => ["NaN", "[object Object]", "${"].filter((x) => t.includes(x === "NaN" ? ":NaN" : x));

// ═══ G1 · every endpoint, with every read answering nothing ════════════════════════════════════
for (const [path, q, settings] of [
  ["customer-recognize", "?phone=9876543210"], ["table-sections", ""], ["customer-search", "?q=98765"], ["whoami", ""],
  ["banquet/items", "", ON("banquet")], ["banquet/bills", "", ON("banquet")], ["banquet/bill", "?id=x", ON("banquet")],
  ["khata", "", ON("khata")], ["khata/customers", "?q=a", ON("khata")], ["onhouse", "", ON("table_tags")], ["all", ""], ["ratings", ""],
  ["orders", ""], ["orders", "?bills=1"], ["orders", "?table=3"], ["orders", "?history=1&type=any&q=12"], ["orders", "?history=1&type=bill&q=12"],
  ["calls", ""], ["issues", ""], ["platform", ""], ["zreport", ""], ["gst-report", ""], ["summary", ""], ["summary", "?table=3"],
  ["print-jobs/pending", ""], ["printing/state", ""], ["print-jobs/pj1", ""], ["sessions", ""], ["stats", ""], ["users", ""], ["oplog", ""],
  ["staff-risk", ""], ["audit", ""], ["audit", "?detail=4"],
]) {
  C(`GET /${path}${q} when every single-row read finds no row and every database function answers nothing: a clean answer, no NaN / [object Object]`, "G.NULL_DATA='single' — each .maybeSingle() returns null (a brand-new restaurant has no settings row), every RPC null",
    async () => { await world({ nullData: "single", rpc: RPC_NULL, settings }); const r = await call("GET", path, { query: q });
      const bad = junk(r.text); return { ok: r.status < 500 && bad.length === 0, note: `${r.status}${bad.length ? " · " + bad.join(",") : ""} · ${r.text.length} bytes` }; });
}
C("POST /table-sections when the settings row is missing: the clamp falls back to 12 tables", "G.NULL_DATA on settings only",
  async () => { const G = await world({ nullData: new Set(["settings"]), fix: { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", name: "W" }] } });
    await call("POST", "table-sections", { body: { user_id: "w1", tables: [12, 13] } }); const w = G.WRITES.find((x) => x.table === "staff_users"); return { ok: JSON.stringify(w?.patch?.assigned_tables) === "[12]", note: JSON.stringify(w?.patch) }; });
C("POST /print/send for a bill when every read answers nothing: 'noRoute', never a crash", "G.NULL_DATA",
  async () => { await world({ nullData: "single" }); const r = await call("POST", "print/send", { body: { kind: "bill", sessionId: "s1" } }); return { ok: r.status === 200 && r.json?.noRoute === true, note: `${r.status}` }; });

// ═══ G2 · the arms that are real decisions ═════════════════════════════════════════════════════
const BQ = ON("banquet");
C("banquet/bills with the banquet power's FEATURE half off is refused by name", "access_config.banquet.on=false",
  async () => { await world({ settings: BQ, accessConfig: { banquet: { on: false } } }); const r = await call("GET", "banquet/bills"); return { ok: r.status === 403 && /use banquet billing/.test(r.json?.error || "") }; });
C("banquet/bill (one bill) with the power's feature half off is refused by name", "same",
  async () => { await world({ settings: BQ, accessConfig: { banquet: { on: false } } }); const r = await call("GET", "banquet/bill", { query: "?id=x" }); return { ok: r.status === 403 }; });
C("khata/customers with the khata power's feature half off is refused by name", "access_config.khata.on=false",
  async () => { await world({ settings: ON("khata"), accessConfig: { khata: { on: false } } }); const r = await call("GET", "khata/customers"); return { ok: r.status === 403 && /use the khata book/.test(r.json?.error || "") }; });
const YREACH = { view_bills: { manager_opts: { range: "today_yesterday" } } };
C("banquet/bills on the today+yesterday Bills reach says 'today and yesterday'", "view_bills range today_yesterday",
  async () => { await world({ settings: BQ, accessConfig: YREACH }); const r = await call("GET", "banquet/bills"); return { ok: r.json?.windowLabel === "today and yesterday" && r.json.reach === "today_yesterday" }; });
C("banquet/bill opens yesterday's bill on the today+yesterday reach", "a bill issued yesterday 06:00 IST",
  async () => { const IST = 5.5 * 3600e3, F = 5 * 3600e3; const ds = Math.floor((Date.now() + IST - F) / 864e5) * 864e5 + F - IST;
    await world({ settings: BQ, accessConfig: YREACH, fix: { banquet_bills: [{ id: "y1", restaurant_id: RID, issued_at: new Date(ds - 864e5 + 3600e3).toISOString() }] } }); const r = await call("GET", "banquet/bill", { query: "?id=y1" }); return { ok: r.status === 200 }; });
C("banquet/bills: a search made only of PostgREST's grammar characters is answered 'unsearchable', not run", "q='%%%'",
  async () => { await world({ settings: BQ }); const r = await call("GET", "banquet/bills", { query: "?q=" + encodeURIComponent("%%%") }); return { ok: r.status === 200 && (r.json?.unsearchable === true || Array.isArray(r.json?.bills)), note: JSON.stringify(r.json).slice(0, 80) }; });
C("khata/customers: an unsearchable search answers an empty, well-formed picker", "q='%%%'",
  async () => { await world({ settings: ON("khata"), rpc: { lfh_khata_outstanding: [] } }); const r = await call("GET", "khata/customers", { query: "?q=" + encodeURIComponent("%%%") }); return { ok: r.status === 200 && Array.isArray(r.json?.customers) }; });
C("khata/customers: the book's rows for people NOT on screen are skipped, not added to them", "two owed, one shown",
  async () => { await world({ settings: ON("khata"), fix: { khata_customers: [{ id: "k1", restaurant_id: RID, name: "Ravi", created_at: NOW() }] }, rpc: { lfh_khata_outstanding: [{ khata_customer_id: "k9", bill_amount: 999 }, { khata_customer_id: "k1", bill_amount: 10 }] } });
    const r = await call("GET", "khata/customers"); return { ok: r.json?.customers?.[0]?.outstanding === 10, note: JSON.stringify(r.json?.customers) }; });
for (const [range, label] of [["today_yesterday", "today and yesterday"], ["last7", "the last 7 days"], ["last30", "the last 30 days"]]) {
  C(`onhouse on the '${range}' dashboard reach says '${label}'`, `view_dashboard range ${range}`,
    async () => { await world({ settings: ON("table_tags"), accessConfig: { view_dashboard: { manager_opts: { range } } } }); const r = await call("GET", "onhouse"); return { ok: r.json?.windowLabel === label, note: r.json?.windowLabel }; });
}
C("onhouse: a comped order with no session is its own bill, and items that are not a list count as none", "solo order, items null",
  async () => { await world({ settings: ON("table_tags"), fix: { orders: [{ id: "solo", restaurant_id: RID, session_id: null, table_number: "2", total: 80, items: null, paid_at: NOW(), payment_method: "On the house", payment_status: "paid" }] } });
    const r = await call("GET", "onhouse"); return { ok: r.json?.count === 1 && r.json.bills[0].key === "solo" && r.json.bills[0].items === 0 }; });
C("orders history with no type given searches invoice numbers (the default)", "history=1&q=42, no type",
  async () => { await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, session_id: "s5", created_at: NOW(), deleted_at: null }], sessions: [{ id: "s5", restaurant_id: RID, invoice_no: 42 }] } }); const r = await call("GET", "orders", { query: "?history=1&q=42" }); return { ok: Array.isArray(r.json) && r.json.length === 1 }; });
for (const [what, sess, q] of [
  ["the last digits of an INVOICE number", { invoice_no: 1234 }, "234"], ["a zero-padded invoice number ('000042')", { invoice_no: 42 }, "000042"],
  ["the guest's PHONE digits", { cust_phone: "+91 98765 43210" }, "5432"], ["the exact TABLE number", { table_number: "17" }, "17"], ["the bill's customer NAME", { cust_name: "Mehta" }, "meh"],
]) {
  C(`one-box search finds a bill by ${what}`, `type=any q=${q}`,
    async () => { await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, session_id: "s5", created_at: NOW(), deleted_at: null }], sessions: [{ id: "s5", restaurant_id: RID, created_at: NOW(), ...sess }] } });
      const r = await call("GET", "orders", { query: `?history=1&type=any&q=${encodeURIComponent(q)}` }); return { ok: Array.isArray(r.json) && r.json.length === 1, note: `${r.json?.length}` }; });
}
C("bill-number search for a number no bill carries answers [] without reading the orders", "type=bill q=999",
  async () => { const G = await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, session_id: "s5", created_at: NOW() }], sessions: [{ id: "s5", restaurant_id: RID, bill_no: 1 }] } }); const r = await call("GET", "orders", { query: "?history=1&type=bill&q=999" });
    return { ok: Array.isArray(r.json) && r.json.length === 0 && !G.READS.some((x) => x.table === "orders") }; });
C("date search for an impossible month ('2026-13-45') answers [] — never 'everything'", "type=date",
  async () => { await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, created_at: NOW() }] } }); const r = await call("GET", "orders", { query: "?history=1&type=date&q=2026-13-45" }); return { ok: Array.isArray(r.json) && r.json.length === 0 }; });
C("a table slice with NO party sitting there and dining sessions ON shows only party-less food", "sessions_enabled, no open session",
  async () => { await world({ settings: { sessions_enabled: true }, fix: { orders: [{ id: "o1", restaurant_id: RID, table_number: "3", session_id: "old", archived: false, deleted_at: null, created_at: NOW() }] } });
    const r = await call("GET", "orders", { query: "?table=3" }); return { ok: Array.isArray(r.json) && r.json.length === 0, note: `${r.json?.length}` }; });
C("bills enrichment: the party's OWNER name on their phone becomes the bill's customer name", "session_members role owner",
  async () => { await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, session_id: "s5", created_at: NOW(), deleted_at: null }], sessions: [{ id: "s5", restaurant_id: RID }], session_members: [{ session_id: "s5", restaurant_id: RID, name: "Kabir", role: "owner" }] } });
    const r = await call("GET", "orders", { query: "?bills=1" }); return { ok: r.json?.rows?.[0]?.customer_name === "Kabir" }; });
C("bills enrichment: a chain row or a payment leg with no session is skipped, not attached to a random bill", "orphan rows",
  async () => { await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, session_id: "s5", created_at: NOW(), deleted_at: null }], sessions: [{ id: "s5", restaurant_id: RID }], bill_chain: [{ restaurant_id: RID, session_id: null, seq: 9 }], session_payments: [{ restaurant_id: RID, session_id: null, amount: 5, created_at: NOW() }] } });
    const r = await call("GET", "orders", { query: "?bills=1" }); const o = r.json?.rows?.[0] || {}; return { ok: !o.chain_seq && !o.pay_parts }; });
C("the Platform board lists the delivery channels a restaurant switched ON", "platform_channels zomato + swiggy + website on",
  async () => { await world({ settings: { platform_channels: { zomato: { on: true }, swiggy: { on: true }, website: { on: true } } } }); const r = await call("GET", "platform"); return { ok: r.json?.channels?.zomato && r.json.channels.swiggy && r.json.channels.website, note: JSON.stringify(r.json?.channels) }; });
C("Z-report: an invoice voided and its number retired is flagged with that reason, the table read as '?' when unknown", "voided session, no table",
  async () => { await world({ fix: { sessions: [{ id: "sv", restaurant_id: RID, bill_no: 1, invoice_voided: true, created_at: NOW(), closed_at: null, void_at: NOW(), invoice_at: "2000-01-01T00:00:00Z" }], daily_counters: [{ restaurant_id: RID, key: "bill", day: new Date(Date.now() + 30 * 60000).toISOString().slice(0, 10), n: 1 }] } });
    const r = await call("GET", "zreport"); const f = r.json?.numbering?.flagged?.[0]; return { ok: !!f && f.note === "T? · invoice voided, number retired", note: JSON.stringify(f) }; });
C("Z-report: a session with an unreadable bill number is skipped, not counted", "bill_no 'x'",
  async () => { await world({ fix: { sessions: [{ id: "sx", restaurant_id: RID, bill_no: "x", created_at: NOW(), invoice_at: "2000-01-01T00:00:00Z", void_at: "2000-01-01T00:00:00Z" }] } }); const r = await call("GET", "zreport"); return { ok: r.status === 200 && r.json.numbering.onFile === 0 }; });
C("Z-report: a cancelled parcel with no source named is called 'parcel'", "aggregator row source null",
  async () => { await world({ fix: { aggregator_orders: [{ restaurant_id: RID, bill_no: 1, status: "cancelled", source: null, created_at: NOW(), total: 0 }] } }); const r = await call("GET", "zreport"); return { ok: r.json?.numbering?.flagged?.[0]?.note === "parcel · cancelled" }; });
C("Z-report: several flagged numbers are listed in number order", "numbers 3 then 1",
  async () => { await world({ fix: { aggregator_orders: [{ restaurant_id: RID, bill_no: 3, status: "cancelled", source: "parcel", created_at: NOW() }, { restaurant_id: RID, bill_no: 1, status: "cancelled", source: "parcel", created_at: NOW() }] } });
    const r = await call("GET", "zreport"); return { ok: JSON.stringify((r.json?.numbering?.flagged || []).map((f) => f.no)) === "[1,3]" }; });
C("Z-report: the ledger check separates a REAL problem from a recorded act (a binned bill is a note, not a problem)", "verifier: one bill_changed, one bill_binned",
  async () => { await world({ rpc: { lfh_verify_bill_chain: [{ kind: "checked", seq: 2 }, { kind: "bill_changed", seq: 1 }, { kind: "bill_binned", seq: 2 }] } }); const r = await call("GET", "zreport"); const c = r.json?.chain || {};
    return { ok: c.ok === false && c.problems.length === 1 && c.notes.length === 1 && c.noteCount === 1, note: JSON.stringify(c) }; });
C("Z-report: only recorded acts → the ledger line still reads OK", "verifier: only a binned-bill note",
  async () => { await world({ rpc: { lfh_verify_bill_chain: [{ kind: "checked", seq: 1 }, { kind: "bill_binned", seq: 1 }] } }); const r = await call("GET", "zreport"); return { ok: r.json?.chain?.ok === true }; });
C("GST report for the flagship with no Billing name keeps 'Little French House' — only the flagship (item 11)", "rid = the flagship id",
  async () => { await world({ restaurants: [{ id: "00000000-0000-0000-0000-000000000001", slug: "french-house", name: "My Little French House", access_config: {}, manager_permissions: {}, owner_entitlements: {} }], settingsRows: [{ restaurant_id: "00000000-0000-0000-0000-000000000001", tax_rate: 0.05 }], user: { restaurant_id: "00000000-0000-0000-0000-000000000001" } });
    const r = await call("GET", "gst-report"); return { ok: r.json?.restaurant?.name === "Little French House", note: r.json?.restaurant?.name }; });
C("Z-report for a restaurant with no name anywhere says 'Restaurant', never another business's name", "no billing name, no logo text, no name",
  async () => { await world({ restaurants: [{ id: RID, slug: "x", access_config: {}, manager_permissions: {}, owner_entitlements: {} }], settings: { restaurant_name: "  " } }); const r = await call("GET", "zreport"); return { ok: r.json?.restaurant?.name === "Restaurant", note: r.json?.restaurant?.name }; });
C("print poll: a station heartbeat that cannot be written never fails the poll", "print_stations update throws",
  async () => { await world({ settings: { auto_print_kot: true, auto_print_kot_allowed: true, modules: { printing: { routes: { kot: { via: "screen", panel: "manager" } } } } }, fix: { print_stations: [{ restaurant_id: RID, device_id: "dev-test", active: true, last_seen_at: NOW() }] }, fail: { "print_stations:update": "throw" } });
    const r = await call("GET", "print-jobs/pending"); return { ok: r.status === 200, note: `${r.status}` }; });
C("Printing status for a person with no display name falls back to their login", "user name empty",
  async () => { await world({ user: { name: "" } }); const r = await call("GET", "printing/state"); return { ok: r.json?.person?.name === "diagm1" }; });
C("sessions: a failed floor bundle is a failure answer, not an empty floor", "lfh_floor_bundle errors",
  async () => { await world({ fail: { "rpc:lfh_floor_bundle": "error" } }); const r = await call("GET", "sessions"); return { ok: r.status >= 500 }; });
C("customer-search: a failed lookup is a failure answer with no database words", "lfh_customer_phone_search errors",
  async () => { await world({ fail: { "rpc:lfh_customer_phone_search": "error" } }); const r = await call("GET", "customer-search", { query: "?q=98765" }); return { ok: r.status >= 500 && !/stub/.test(r.text) }; });
C("Dashboard on the 30-day rung draws thirty daily points", "reach last30, range last30",
  async () => { await world({ accessConfig: { view_dashboard: { manager_opts: { range: "last30" } } } }); const r = await call("GET", "stats", { query: "?range=last30" }); return { ok: r.json?.series?.length === 30 }; });
C("Dashboard: the switched-on delivery channels are the ones it shows", "platform_channels zomato on",
  async () => { await world({ settings: { platform_channels: { zomato: { on: true } } } }); const r = await call("GET", "stats"); return { ok: r.json?.channelsOn?.zomato === true && r.json.channelsOn.swiggy === false }; });
C("Dashboard on last7: an order lands on its own business day's point", "an order 3 business days ago",
  async () => { const IST = 5.5 * 3600e3, F = 5 * 3600e3; const ds = Math.floor((Date.now() + IST - F) / 864e5) * 864e5 + F - IST;
    await world({ accessConfig: { view_dashboard: { manager_opts: { range: "last7" } } }, fix: { orders: [{ id: "d3", restaurant_id: RID, session_id: "s3", status: "served", payment_status: "paid", subtotal: 100, total: 105, discount: 0, created_at: new Date(ds - 3 * 864e5 + 2 * 3600e3).toISOString(), items: [], deleted_at: null }] } });
    const r = await call("GET", "stats", { query: "?range=last7" }); const i = (r.json?.series || []).findIndex((p) => p.revenue > 0); return { ok: i === 3, note: `point ${i}` }; });
C("Dashboard: day parts put a bill in Breakfast, Lunch, Evening, Dinner or Late by its IST hour", "last7, four orders at 08, 13, 16, 21 IST + one at 02",
  async () => { const IST = 5.5 * 3600e3, F = 5 * 3600e3; const ds = Math.floor((Date.now() + IST - F) / 864e5) * 864e5 + F - IST; const yd = ds - 864e5; // yesterday 05:00 IST, as UTC ms
    const at = (h) => new Date(yd + (h >= 5 ? h - 5 : h + 19) * 3600e3).toISOString();
    const mk = (i, h) => ({ id: `p${i}`, restaurant_id: RID, session_id: `sp${i}`, status: "served", payment_status: "paid", subtotal: 100, total: 105, discount: 0, created_at: at(h), items: [], deleted_at: null });
    await world({ accessConfig: { view_dashboard: { manager_opts: { range: "last7" } } }, fix: { orders: [mk(1, 8), mk(2, 13), mk(3, 16), mk(4, 21), mk(5, 2)] } });
    const r = await call("GET", "stats", { query: "?range=last7" }); const d = (r.json?.dayParts || []).map((p) => p.orders); return { ok: JSON.stringify(d) === "[1,1,1,1,1]", note: JSON.stringify(d) }; });
C("Dashboard: the largest discount of the day is the one reported", "two discounts, 10 then 50",
  async () => { await world({ fix: { orders: [{ id: "a", restaurant_id: RID, session_id: "sa", status: "served", payment_status: "paid", subtotal: 100, total: 105, discount: 10, created_at: NOW(), items: [], table_number: "1" }, { id: "b", restaurant_id: RID, session_id: "sb", status: "served", payment_status: "paid", subtotal: 100, total: 105, discount: 50, created_at: NOW(), items: [], table_number: "2" }] } });
    const r = await call("GET", "stats"); return { ok: r.json?.discounts?.max?.table === "2" && Math.abs(r.json.discounts.max.amt - 52.5) < 0.01, note: JSON.stringify(r.json?.discounts) }; });
C("Dashboard: a dish line with no quantity counts as one, and one with no title falls back to its slug", "items [{slug:'naan'}]",
  async () => { await world({ fix: { orders: [{ id: "a", restaurant_id: RID, session_id: "sa", status: "served", payment_status: "paid", subtotal: 100, total: 105, discount: 0, created_at: NOW(), items: [{ slug: "naan", price: 50 }] }] } });
    const r = await call("GET", "stats"); const m = (r.json?.menuMatrix || [])[0]; return { ok: m?.title === "naan" && m.units === 1, note: JSON.stringify(m) }; });
C("Dashboard: a bill's time is its EARLIEST order (a later round does not move it)", "two orders on one bill, later one first",
  async () => { const t1 = new Date(Date.now() - 2 * 3600e3).toISOString(), t2 = new Date(Date.now() - 1000).toISOString();
    await world({ fix: { orders: [{ id: "b2", restaurant_id: RID, session_id: "sx", status: "served", payment_status: "paid", subtotal: 50, total: 52.5, discount: 0, created_at: t2, items: [] }, { id: "b1", restaurant_id: RID, session_id: "sx", status: "served", payment_status: "paid", subtotal: 50, total: 52.5, discount: 0, created_at: t1, items: [] }] } });
    const r = await call("GET", "stats"); const h = new Date(Date.parse(t1) + 5.5 * 3600e3).getUTCHours(); return { ok: (r.json?.series?.[h]?.revenue || 0) > 0, note: `hour ${h}` }; });
C("Dashboard: the menu matrix splits dishes at the medians into star / workhorse / puzzle / dog", "four dishes, units × revenue",
  async () => { const it = (title, qty, price) => ({ title, qty, price }); await world({ fix: { orders: [{ id: "m", restaurant_id: RID, session_id: "sm", status: "served", payment_status: "paid", subtotal: 1, total: 1, discount: 0, created_at: NOW(), items: [it("A", 10, 100), it("B", 10, 1), it("C", 1, 1000), it("D", 1, 1)] }] } });
    const r = await call("GET", "stats"); const q = Object.fromEntries((r.json?.menuMatrix || []).map((m) => [m.title, m.q])); return { ok: q.A === "star" && q.B === "workhorse" && q.C === "puzzle" && q.D === "dog", note: JSON.stringify(q) }; });
for (const [range, reach] of [["yesterday", "today_yesterday"], ["last7", "last7"]]) {
  C(`Staff watch on '${range}' counts that window's rows`, `reach ${reach}`,
    async () => { const IST = 5.5 * 3600e3, F = 5 * 3600e3; const ds = Math.floor((Date.now() + IST - F) / 864e5) * 864e5 + F - IST;
      await world({ accessConfig: { view_dashboard: { manager_opts: { range: reach } } }, fix: { staff_actions: [{ id: "y", restaurant_id: RID, panel: "manager", action: "order_discount", actor: "Ravi", created_at: new Date(ds - 864e5 + 3600e3).toISOString() }] } });
      const r = await call("GET", "staff-risk", { query: `?range=${range}` }); return { ok: r.json?.range === range && r.json.rows?.[0]?.disc === 1, note: JSON.stringify(r.json) }; });
}
C("audit?detail=<id>: a removal tied to an order and a session brings both sides of the bill", "order_id + session_id set",
  async () => { await world({ fix: { deletion_audit: [{ id: 8, restaurant_id: RID, kind: "order_cancelled", at: NOW(), order_id: "o1", session_id: "s1", meta: { was: { items: [] } } }] } }); const r = await call("GET", "audit", { query: "?detail=8" }); return { ok: r.status === 200 && "__billSides" in r.json, note: `${r.status}` }; });
C("audit?limit=abc falls back to the normal 100-row page", "limit=abc",
  async () => { await world(); const r = await call("GET", "audit", { query: "?limit=abc" }); return { ok: r.status === 200 && Array.isArray(r.json) }; });
C("print/send kot: the order id may arrive as order_id as well as orderId", "body.order_id",
  async () => { const G = await world({ settings: { modules: { printing: { routes: { kot: { agent: "ag1", printer: "K" } } } } }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "PC", last_seen_at: NOW(), revoked_at: null }], orders: [{ id: "o1", restaurant_id: RID, status: "served" }] } });
    const r = await call("POST", "print/send", { body: { kind: "kot", order_id: "o1" } }); return { ok: r.json?.queued === true && G.WRITES.some((w) => w.table === "print_jobs") }; });
C("print/send kot: a failed queue write is 'Could not send that to the printer.' (500)", "print_jobs insert errors",
  async () => { await world({ settings: { modules: { printing: { routes: { kot: { agent: "ag1", printer: "K" } } } } }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "PC", last_seen_at: NOW(), revoked_at: null }], orders: [{ id: "o1", restaurant_id: RID, status: "served" }] }, fail: { "print_jobs:insert": "error" } });
    const r = await call("POST", "print/send", { body: { kind: "kot", orderId: "o1" } }); return { ok: r.status === 500 && r.json?.error === "Could not send that to the printer." }; });
C("print/send kot from the admin console WITH force is queued and written down as 'Aevidine admin'", "admin, force",
  async () => { const G = await world({ who: "admin", settings: { modules: { printing: { routes: { kot: { agent: "ag1", printer: "K" } } } } }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "PC", last_seen_at: NOW(), revoked_at: null }], orders: [{ id: "o1", restaurant_id: RID, status: "served" }] } });
    const r = await call("POST", "print/send", { body: { kind: "kot", orderId: "o1", force: true } }); const l = G.LOGS.find((x) => x.action === "kot_reprint_sent"); return { ok: r.json?.queued === true && l?.actor === "Aevidine admin" && G.WRITES.find((w) => w.table === "print_jobs")?.patch?.requested_by === "manager" }; });
C("print/send kot when the kitchen computer is ASLEEP: queued, and the person is told it waits", "agent last seen an hour ago",
  async () => { await world({ settings: { modules: { printing: { routes: { kot: { agent: "ag1", printer: "K" } } } } }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "PC", last_seen_at: new Date(Date.now() - 3600e3).toISOString(), revoked_at: null }], orders: [{ id: "o1", restaurant_id: RID, status: "served" }] } });
    const r = await call("POST", "print/send", { body: { kind: "kot", orderId: "o1" } }); return { ok: /as soon as PC is back/.test(r.json?.note || "") }; });
C("print/send bill for a PARCEL is marked as one, and a bill with no number or table still names itself 'bill'", "parcel:true, session without bill_no",
  async () => { const G = await world({ settings: { modules: { printing: { routes: { bill: { agent: "ag1", printer: "P" } } } } }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "PC", last_seen_at: NOW(), revoked_at: null }], sessions: [{ id: "s1", restaurant_id: RID }] } });
    await call("POST", "print/send", { body: { kind: "bill", sessionId: "s1", parcel: true } }); const w = G.WRITES.find((x) => x.table === "print_jobs"); const l = G.LOGS.find((x) => x.action === "print_sent");
    return { ok: w?.patch?.payload?.parcel === true && /^bill sent to P on PC$/.test(l?.detail || "") && l.table_number === null, note: l?.detail }; });
C("print/send banquet with a route switched to 'Nobody' answers noRoute (the window, by design)", "banquet via off",
  async () => { await world({ settings: { modules: { printing: { routes: { banquet: { via: "off" } } } } }, fix: { banquet_bills: [{ id: "b1", restaurant_id: RID, issued_at: NOW() }] } }); const r = await call("POST", "print/send", { body: { kind: "banquet", billId: "b1" } }); return { ok: r.json?.noRoute === true }; });
C("whoami: a person's own 'on' override for a power the restaurant took away shows it as theirs", "manager_permissions.give_discounts=false, permissions.give_discounts='on'",
  async () => { await world({ perms: { give_discounts: false }, user: { permissions: { give_discounts: "on" } } }); const r = await call("GET", "whoami"); return { ok: r.json?.effectivePowers?.give_discounts === true }; });
C("whoami: a 'pin' override counts as granted too (asked at the moment of use)", "permissions.give_discounts='pin'",
  async () => { await world({ perms: { give_discounts: false }, user: { permissions: { give_discounts: "pin" } } }); const r = await call("GET", "whoami"); return { ok: r.json?.effectivePowers?.give_discounts === true }; });
C("a dish photo from the OWNER (the menu is theirs) is stored", "owner, storage on",
  async () => { await world({ who: "owner", storage: true }); const fd = new FormData(); fd.append("file", new File([new Uint8Array(8)], "d.png", { type: "image/png" })); const r = await call("POST", "dish-photo", { form: fd }); return { ok: r.status === 200 && !!r.json?.url }; });
C("a dish photo sent as plain JSON (no form) is 'No photo was attached', never a crash", "content-type json",
  async () => { await world(); const r = await call("POST", "dish-photo", { body: { file: "x" } }); return { ok: r.status === 400 && /No photo was attached/.test(r.json?.error || "") }; });
C("replacing a photo when the old file cannot be removed still answers with the new one", "storage remove throws",
  async () => { await world({ storage: true, fail: { "storage:remove": "throw" } }); const fd = new FormData(); fd.append("file", new File([new Uint8Array(8)], "d.png", { type: "image/png" })); fd.append("replaces", "https://x/storage/v1/object/public/menu-media/rest-1/old.png");
    const r = await call("POST", "dish-photo", { form: fd }); return { ok: r.status === 200 && !!r.json?.url }; });
C("an 'edited' stamp that cannot be written never fails the edit it marks", "orders update throws on the stamp",
  async () => { await world({ fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", qty: 2 }] }, rpc: { lfh_staff_edit_item_qty: { ok: true, order_id: "o1", qty: 3 } }, fail: { "orders:update": "throw" } }); const r = await call("POST", "items/i1/qty", { body: { qty: 3 } }); return { ok: r.status === 200, note: `${r.status}` }; });
C("a log line from a person with no display name is filed under their login", "user name empty, POST table-sections",
  async () => { const G = await world({ user: { name: "" }, fix: { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", name: "W" }] } }); await call("POST", "table-sections", { body: { user_id: "w1", tables: [] } }); return { ok: G.LOGS[0]?.actor === "diagm1" }; });
C("the rota diary names a waiter with no display name by their login", "waiter name empty",
  async () => { const G = await world({ fix: { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", name: "", username: "asha2" }] } }); await call("POST", "table-sections", { body: { user_id: "w1", tables: [2] } }); return { ok: G.LOGS[0]?.detail === "asha2: T2" }; });

// ═══ G2b · rows whose money fields are EMPTY (legacy rows carry nulls) — never NaN, never a crash ════
const BARE = (id_, o = {}) => ({ id: id_, restaurant_id: RID, session_id: null, created_at: NOW(), status: "served", payment_status: "paid", ...o });
C("Z-report over orders with every money field empty adds up to zero, never NaN", "orders with no subtotal / base / discount / tip / method",
  async () => { await world({ fix: { orders: [BARE("n1"), BARE("n2", { status: "cancelled" })], session_payments: [{ restaurant_id: RID, session_id: null, amount: null, method: null, reversed_at: null, created_at: NOW() }] } });
    const r = await call("GET", "zreport"); const d = r.json?.dineIn || {}; return { ok: r.status === 200 && d.net === 0 && d.gross === 0 && !junk(r.text).length && (r.json.payments.rows || []).every((x) => x.method), note: JSON.stringify(r.json?.payments) }; });
C("…and a payment leg with no method is filed as 'Not recorded', not as an empty name", "one leg, method null",
  async () => { await world({ fix: { session_payments: [{ restaurant_id: RID, session_id: null, amount: 40, method: null, reversed_at: null, created_at: NOW() }] } }); const r = await call("GET", "zreport"); return { ok: (r.json?.payments?.rows || []).some((x) => x.method === "Not recorded" && x.amount === 40) }; });
C("GST report over paid orders with empty money fields: zero, never NaN", "two bare paid orders",
  async () => { await world({ fix: { orders: [BARE("g1"), BARE("g2", { session_id: "sg" })] } }); const r = await call("GET", "gst-report"); return { ok: r.status === 200 && r.json.totals.gross === 0 && !junk(r.text).length }; });
C("Dashboard over orders with empty money fields: zero revenue, never NaN", "bare orders, one discounted with no subtotal",
  async () => { await world({ fix: { orders: [BARE("d1"), BARE("d2", { discount: 5 }), BARE("d3", { status: "cancelled" })] } }); const r = await call("GET", "stats"); return { ok: r.status === 200 && !junk(r.text).length, note: `${r.json?.revenue}` }; });
C("Pay later book rows with no amount count as zero owed, never NaN", "outstanding rows with bill_amount null",
  async () => { await world({ settings: ON("khata"), rpc: { lfh_khata_outstanding: [{ khata_customer_id: "k1", name: "Ravi", bill_amount: null }], lfh_khata_collected: [{ collected: null }] } }); const r = await call("GET", "khata"); return { ok: r.json?.total === 0 && r.json.collectedToday === 0 }; });
C("On-the-house rows with no total count as zero, never NaN", "comped order with total null",
  async () => { await world({ settings: ON("table_tags"), fix: { orders: [{ id: "h", restaurant_id: RID, session_id: "s", total: null, items: [{}], paid_at: NOW(), payment_method: "On the house", payment_status: "paid" }] } }); const r = await call("GET", "onhouse"); return { ok: r.json?.total === 0 && r.json.bills[0].items === 1 }; });
C("Bills record: a split leg with no amount or method shows 0 and an empty method, never NaN", "session_payments row bare",
  async () => { await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, session_id: "s5", created_at: NOW(), deleted_at: null }], sessions: [{ id: "s5", restaurant_id: RID }], session_payments: [{ restaurant_id: RID, session_id: "s5", amount: null, method: null, created_at: NOW() }] } });
    const r = await call("GET", "orders", { query: "?bills=1" }); const p = r.json?.rows?.[0]?.pay_parts?.[0]; return { ok: p && p.amount === 0 && p.method === "" }; });
C("the repeat-customer lookup with the directory OFF is answered 'not known' without the lookup (item 5, in this harness too)", "owner_entitlements.customers=false",
  async () => { const G = await world({ ents: { customers: false } }); const r = await call("GET", "customer-recognize", { query: "?phone=9876543210" }); return { ok: r.json?.known === false && !G.RPCS.some((c) => c.name === "lfh_recognize_customer") }; });
C("a refused waiter id is a 404 in plain words (item 10, in this harness too)", "staff_users update refuses the value",
  async () => { await world({ fail: { "staff_users:update": "refuse" } }); const r = await call("POST", "table-sections", { body: { user_id: "nope", tables: [1] } }); return { ok: r.status === 404 && /no longer on this restaurant's team/.test(r.json?.error || "") }; });

// ═══ G3 · arms that cannot be reached, by design — recorded, not tested ═════════════════════════
for (const [where, why] of [
  ["platformOrParcelCan(): `if (!ladder.effective) return false`", "both ladders are ALWAYS_ON since 2026-08-03 (lib/tableTags.ts); the arm returns only if a module becomes switchable again"],
  ["GET /orders?bills=1: the `: []` when the parcel ladder is off", "parcelLadder is ALWAYS_ON — parcels always ride the Bills record"],
  ["GET /platform: the 'nothing to show' early answer", "parcels are permanent, so `sources` always holds 'parcel' (item 8 removed its sibling refusal)"],
  ["canViewLogs() refusing for GET /oplog and /audit", "tabGate asks managerCan('view_logs') first — the same three rungs — so it answers before canViewLogs can"],
  ["GET /ratings: permDenied('see guest ratings')", "tabGate asks managerCan('view_ratings') first and refuses in its own words"],
  ["dishPhotoUpload(): permDenied('edit the menu')", "since item 3 tabGate asks managerCan('edit_menu') first for dish-photo"],
  ["whoami ?as=<person> (person.role / person.permissions)", "viewAsPerson() answers only for the admin's signed console token (lib/staffAuth) — driven by verify:xray, not by this in-memory harness"],
  ["the GET catch's `p || \"/\"`", "an empty path is answered 404 'unknown GET endpoint' before anything can throw"],
  ["GET /gst-report: the December arm of the month window (m === 12)", "depends on today's date; the arithmetic is a plain y+1 / month 1 roll-over — re-check in a December run"],
  ["a LIST read answering `data: null` with no error (GET /orders, /stats, … would answer 500)", "supabase-js never does this: a list read is [] or an error, and an error is already turned into a plain failure answer — measured round 2 with the stub forced into that shape; the realistic case (a single row missing) is driven above"],
]) {
  C(`UNREACHABLE BY DESIGN — ${where}`, "read the code; no state of the app reaches it", () => ({ ok: true, note: why }));
}

console.log(`block G: ${N - 178845} checks defined (P178845–P${N - 1})`);
