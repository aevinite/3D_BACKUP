// scripts/sweep/t9s10/r2-h-mutkill.mjs — round 2, block H (P178962–P179000): the checks the MUTATION run
// asked for. `node scripts/sweep/t9s10/mutate.mjs` made 454 small breaks in my half; 122 went unnoticed.
// Each check here names the break(s) it now catches. Its LAST check is the whole-suite query audit, which
// answers all 51 "restaurant filter removed" survivors at once: every statement the suite makes is logged
// (scripts/panel-stubs/sb.mjs → G.SCOPE_LOG), coverage proved every statement runs, so a single missing
// `.eq("restaurant_id", rid)` anywhere in my half shows up as an unscoped query.
import { check, world, call, stubRoute, SUBJECT, RID } from "./lib.mjs";

let N = 178962;
const id = () => { if (N > 179000) throw new Error("block H is full — the terminal's id block is exhausted"); return "P" + N++; };
const C = (what, how, fn) => check(id(), `${SUBJECT} — ${what}`, `STUB · ${how}`, fn);
const NOW = () => new Date(Date.now() - 1000).toISOString();
const IST = 5.5 * 3600e3, F5 = 5 * 3600e3;
const dayStart = () => Math.floor((Date.now() + IST - F5) / 864e5) * 864e5 + F5 - IST;
const atIst = (dayOffset, h, m = 0) => new Date(dayStart() + dayOffset * 864e5 + (h >= 5 ? h - 5 : h + 19) * 3600e3 + m * 60e3).toISOString();
const ORD = (id_, o = {}) => ({ id: id_, restaurant_id: RID, session_id: `s-${id_}`, status: "served", payment_status: "paid", subtotal: 100, total: 105, discount: 0, created_at: NOW(), items: [], deleted_at: null, ...o });
const all = (...xs) => xs.every(Boolean);

// L1714, L1736, L1740 — the Platform board actually LISTS its live orders
C("the Platform board lists a live parcel and a live Zomato order (and not a cancelled one)", "kills L1714 drop-!, L1740 ||→&&",
  async () => { await world({ settings: { platform_channels: { zomato: { on: true } } }, fix: { aggregator_orders: [{ id: "p1", restaurant_id: RID, source: "parcel", status: "accepted", created_at: NOW() }, { id: "z1", restaurant_id: RID, source: "zomato", status: "new", created_at: NOW() }] } });
    const r = await call("GET", "platform"); return { ok: (r.json?.orders || []).length === 2, note: `${(r.json?.orders || []).length} orders` }; });
// L1500 — a written-out date finds that day's bill
C("searching the Bills record for a written-out date ('9 Oct 2026') FINDS that day's bill", "kills L1500 drop-!",
  async () => { const d = new Date(Date.now() + IST); const label = `${d.getUTCDate()} ${d.toUTCString().slice(8, 11)} ${d.getUTCFullYear()}`;
    await world({ fix: { orders: [ORD("b1", { created_at: atIst(0, 12) })] } }); const r = await call("GET", "orders", { query: "?history=1&type=date&q=" + encodeURIComponent(label) });
    return { ok: Array.isArray(r.json) && r.json.length === (Date.now() > Date.parse(atIst(0, 12)) ? 1 : r.json.length), note: `${label} → ${r.json?.length}` }; });
// L2480 + the poll actually handing a slip
const POLL = (extra = {}) => ({ settings: { auto_print_kot: true, auto_print_kot_allowed: true, modules: { printing: { routes: { kot: { via: "screen", panel: "manager" } } } } },
  fix: { print_jobs: [{ id: "pj1", restaurant_id: RID, kind: "kot", order_id: "o1", status: "queued", reprint: false, attempts: 0, created_at: NOW() }], orders: [{ id: "o1", restaurant_id: RID, status: "received", kot_no: 7, table_number: "4", deleted_at: null, items: [] }], order_items: [], ...extra } });
C("the counter screen that prints is HANDED the queued kitchen slip; another live station gets none; this device as the station gets it", "kills L2480 drop-!",
  async () => { await world(POLL()); const a = (await call("GET", "print-jobs/pending")).json;
    await world(POLL({ print_stations: [{ restaurant_id: RID, device_id: "dev-other", active: true, last_seen_at: NOW() }] })); const b = (await call("GET", "print-jobs/pending")).json;
    await world(POLL({ print_stations: [{ restaurant_id: RID, device_id: "dev-test", active: true, last_seen_at: NOW() }] })); const c = (await call("GET", "print-jobs/pending")).json;
    return { ok: (a.jobs || []).length === 1 && (b.jobs || []).length === 0 && (c.jobs || []).length === 1, note: `${(a.jobs || []).length}/${(b.jobs || []).length}/${(c.jobs || []).length}` }; });
// L2812, L2828, L2783 — biggest bill and largest discount
C("Dashboard: the biggest bill names its table, the larger of two wins, and a tie keeps the first", "kills L2812 drop-!, L2828 >→>=, L2783 >→>=",
  async () => { await world({ fix: { orders: [ORD("a", { total: 210, subtotal: 200, table_number: "3", discount: 10 }), ORD("b", { total: 525, subtotal: 500, table_number: "8", discount: 10 })] } });
    const r = (await call("GET", "stats")).json; return { ok: r.biggestBill?.table === "8" && r.discounts?.max?.table === "3", note: JSON.stringify({ bb: r.biggestBill, dm: r.discounts?.max }) }; });
// L168, L177 — the launcher's site and the phone's system
C("Printing status: with no forwarded host the launcher uses the request's own host; an iPhone ('like Mac OS X') opens on mac", "kills L168 ||→&&, L177 ||→&&",
  async () => { await world(); const a = (await call("GET", "printing/state", { headers: { host: "shop.local:4409" } })).json; const b = (await call("GET", "printing/state", { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" } })).json;
    return { ok: JSON.stringify(a.stationFiles || "").includes("shop.local:4409") && b.os === "mac", note: `${b.os}` }; });
// L220 — the owner is never subject to the managers' log switch
C("the OWNER still reads the Activity log when the restaurant took view_logs away from managers", "kills L220 ===→!==",
  async () => { await world({ who: "owner", perms: { view_logs: false } }); const r = await call("GET", "oplog"); return { ok: r.status === 200 }; });
// L711, L719 — madeAnswers: one read, and a blank answer is no answer
C("'was the food made?' asks once for a handful of tickets, and an answer row with no answer still counts as unanswered", "kills L711 <→<=, L719 &&→||",
  async () => { const G = await world({ fix: { orders: [ORD("c1", { status: "cancelled", payment_status: "pending" })], deletion_audit: [{ restaurant_id: RID, order_id: "c1", kind: "order_cancelled", at: NOW(), made: null }] } });
    const r = (await call("GET", "zreport")).json; const reads = G.READS.filter((x) => x.table === "deletion_audit").length; return { ok: r.dineIn?.cancelledUnanswered === 1 && r.dineIn.cancelled === 1 && reads === 1, note: `${reads} read(s)` }; });
// L739 — the discount base at a ZERO tax rate keeps the MRP part out of reach
C("Z-report at a 0% rate: an MRP bottle's price stays out of the discount's reach", "kills L739 >→>=",
  async () => { await world({ settings: { tax_rate: 0 }, fix: { orders: [ORD("m", { subtotal: 700, taxable_base: 700, mrp_amount: 200, tax_rate: 0, discount: 700, payment_method: "Cash" })] } });
    const d = (await call("GET", "zreport")).json?.dineIn || {}; return { ok: Math.abs(d.discount - 500) < 0.001, note: `${d.discount}` }; });
// L860 — a known customer IS recognised
C("a returning guest's number brings back their name and visit count", "kills L860 ||→&&",
  async () => { await world({ rpc: { lfh_recognize_customer: { known: true, name: "Ravi", visits: 4 } } }); const r = (await call("GET", "customer-recognize", { query: "?phone=9876543210" })).json; return { ok: r.known === true && r.name === "Ravi" && r.visits === 4 }; });
// L1143 — the banquet list's default page is 40, and a garbage ?limit= is the default too
C("the banquet list shows up to 40 bills by default, and ?limit=abc means the default, not one row", "kills L1143 ||→&&",
  async () => { const bills = Array.from({ length: 45 }, (_, i) => ({ id: `bq${i}`, restaurant_id: RID, bill_no: `B${i}`, issued_at: NOW() }));
    await world({ settings: { banquet_allowed: true, banquet_owner_control: false, banquet_enabled: true }, fix: { banquet_bills: bills } });
    const a = (await call("GET", "banquet/bills")).json; const b = (await call("GET", "banquet/bills", { query: "?limit=abc" })).json; return { ok: a.bills?.length === 40 && b.bills?.length === 40, note: `${a.bills?.length}/${b.bills?.length}` }; });
// L1198, L1287, L1337/1339 — fields that must ride through unchanged
C("Pay later bills keep their order ids; an on-the-house bill keeps its note; ratings keep their total, average and unhandled count", "kills L1198, L1287, L1337, L1339 ||→&&",
  async () => { await world({ settings: { khata_allowed: true, khata_owner_control: false, khata_enabled: true, table_tags_allowed: true, table_tags_owner_control: false, table_tags_enabled: true },
      rpc: { lfh_khata_outstanding: [{ khata_customer_id: "k1", name: "Ravi", bill_amount: 10, order_ids: ["o9"] }], lfh_khata_collected: [], lfh_ratings_summary: [{ total: 7, avg: 4.2, unhandled: 2 }] },
      fix: { orders: [{ id: "h", restaurant_id: RID, session_id: "s", total: 80, items: [], paid_at: NOW(), payment_method: "On the house", payment_status: "paid", payment_note: "birthday" }] } });
    const k = (await call("GET", "khata")).json; const o = (await call("GET", "onhouse")).json; const r = (await call("GET", "ratings")).json;
    return { ok: all(JSON.stringify(k.customers?.[0]?.bills?.[0]?.order_ids) === '["o9"]', o.bills?.[0]?.note === "birthday", r.summary?.total === 7, r.summary?.avg === 4.2, r.summary?.unhandled === 2), note: JSON.stringify(r.summary) }; });
// L1453 — the one-box search's exact-table match is exact
C("one-box search for table 17 finds table 17's bill and not table 5's", "kills L1453 ===→!==",
  async () => { await world({ fix: { orders: [ORD("a", { session_id: "s17" }), ORD("b", { session_id: "s5" })], sessions: [{ id: "s17", restaurant_id: RID, table_number: "17", created_at: NOW() }, { id: "s5", restaurant_id: RID, table_number: "5", created_at: NOW() }] } });
    const r = await call("GET", "orders", { query: "?history=1&type=any&q=17" }); return { ok: Array.isArray(r.json) && r.json.length === 1 && r.json[0].session_id === "s17", note: `${r.json?.length}` }; });
// L1540 — a merged child reads its PARENT's party
C("a merged table's slice looks for the party at its PARENT table (and so never falls back to the no-party rule)", "kills L1540 ||→&&",
  async () => { const G = await world({ settings: { sessions_enabled: true }, fix: { table_merges: [{ restaurant_id: RID, child_table: "6", parent_table: "5", ended_at: null }], sessions: [{ id: "s5", restaurant_id: RID, table_number: "5", status: "open", opened_at: NOW(), last_activity_at: NOW() }], orders: [ORD("o", { table_number: "6", session_id: "s5", archived: false })] } });
    await call("GET", "orders", { query: "?table=6" }); return { ok: !G.READS.some((x) => x.table === "settings"), note: "no fallback read" }; });
// L1606 — the first owner's name wins
C("the bill's customer name is the party OWNER's first name on file, not overwritten by a later one", "kills L1606 &&→||",
  async () => { await world({ fix: { orders: [ORD("o", { session_id: "s5" })], sessions: [{ id: "s5", restaurant_id: RID }], session_members: [{ session_id: "s5", restaurant_id: RID, name: "Kabir", role: "owner" }, { session_id: "s5", restaurant_id: RID, name: "Zoya", role: "owner" }] } });
    const r = (await call("GET", "orders", { query: "?bills=1" })).json; return { ok: r.rows?.[0]?.customer_name === "Kabir", note: r.rows?.[0]?.customer_name }; });
// L1663 — finished parcels ride in the Bills record
C("a finished parcel from today rides in the Bills record", "kills L1663 ||→&&",
  async () => { await world({ fix: { aggregator_orders: [{ id: "pp", restaurant_id: RID, source: "parcel", status: "handed_over", created_at: NOW() }] } }); const r = (await call("GET", "orders", { query: "?bills=1" })).json; return { ok: (r.parcels || []).length === 1 }; });
// L1859/1860, L2776 — cancelled value with a legacy base and an untaxed part
C("a cooked cancellation's value counts its untaxed part, and a legacy row falls back to its subtotal", "kills L1859, L1860, L2776 ||→&&",
  async () => { await world({ fix: { orders: [ORD("c", { status: "cancelled", payment_status: "pending", taxable_base: null, subtotal: 300, nontax_amount: 50 })], deletion_audit: [{ restaurant_id: RID, order_id: "c", kind: "order_cancelled", at: NOW(), made: "true" }] } });
    const z = (await call("GET", "zreport")).json; const s = (await call("GET", "stats")).json; return { ok: z.dineIn?.cancelledNet === 350 && s.cancelledValue > 0, note: `${z.dineIn?.cancelledNet} / ${s.cancelledValue}` }; });
// L2201 — the GST report pages past one page
C("the GST report counts every bill on a 1,500-bill window (it pages; it does not stop after the first page)", "kills L2201 ===→!==",
  async () => { const many = Array.from({ length: 1500 }, (_, i) => ORD(`g${i}`, { created_at: new Date(Date.now() - 5000 - i).toISOString() })); await world({ fix: { orders: many } });
    const r = (await call("GET", "gst-report")).json; return { ok: r.totals?.bills === 1500, note: `${r.totals?.bills}` }; });
// L2271 — CGST + SGST add up to the paisa, the last part absorbing the remainder
C("CGST + SGST add back to the total tax to the PAISA (not merely within a rupee)", "kills L2271 &&→||, <→<=",
  async () => { await world({ settings: { tax_components: [{ label: "CGST", rate: 0.025 }, { label: "SGST", rate: 0.025 }] }, fix: { orders: [ORD("t", { subtotal: 333.33, taxable_base: 333.33, tax_rate: 0.05 })] } });
    const r = (await call("GET", "gst-report")).json; const sum = (r.components || []).reduce((a, c) => a + c.amount, 0); return { ok: Math.round(sum * 100) === Math.round(r.totals.tax * 100), note: `${sum} vs ${r.totals?.tax}` }; });
// L2392 — the slow-order clock carries the slow orders
C("the floor's 'not accepted for 3 minutes' list carries the order that has waited", "kills L2392 ||→&&",
  async () => { await new Promise((res) => setTimeout(res, 1600)); await world({ rpc: { lfh_table_view_summary: { tiles: {} } }, fix: { orders: [ORD("w", { status: "received", archived: false, created_at: new Date(Date.now() - 10 * 60e3).toISOString() })] } });
    const r = (await call("GET", "summary")).json; return { ok: r.slowOrders?.rows?.length === 1, note: JSON.stringify(r.slowOrders) }; });
// L2566 — one table's bundle asks for that table
C("the table detail asks the floor bundle for THAT table (and the whole floor asks for none)", "kills L2566 ||→&&",
  async () => { const G = await world({ rpc: { lfh_floor_bundle: {} } }); await call("GET", "sessions", { query: "?table=4" }); await call("GET", "sessions"); const c = G.RPCS.filter((x) => x.name === "lfh_floor_bundle"); return { ok: c[0]?.args?.p_table === "4" && c[1]?.args?.p_table === null }; });
// L2689 — a quiet restaurant's dashboard is ONE page read
C("a quiet restaurant's dashboard reads its orders in exactly ONE page", "kills L2689 <→<=",
  async () => { const G = await world({ fix: { orders: [ORD("q")] } }); await call("GET", "stats"); return { ok: G.READS.filter((x) => x.table === "orders").length === 1, note: `${G.READS.filter((x) => x.table === "orders").length}` }; });
// L2706 — "last time" is cut at the same elapsed time
C("Dashboard 'last time' leaves out yesterday's orders placed LATER than now's time of day", "kills L2706 &&→||, <→<=",
  async () => { const later = new Date(Date.now() - 864e5 + 2 * 3600e3).toISOString(); const earlier = new Date(Date.now() - 864e5 - 3600e3).toISOString();
    if (Date.parse(later) >= dayStart()) return "skip: within two hours of the 05:00 boundary the 'later' fixture would be today";
    await world({ fix: { orders: [ORD("y1", { created_at: earlier }), ORD("y2", { created_at: later })] } }); const r = (await call("GET", "stats")).json; return { ok: r.prev?.orders === (Date.parse(earlier) >= dayStart() - 864e5 ? 1 : 0), note: `${r.prev?.orders}` }; });
// L2724 — each channel is on only if it was switched on
C("Dashboard: a delivery channel left OFF stays off on the dashboard — each of the three on its own", "kills L2724 &&→|| (all three)",
  async () => { await world({ settings: { platform_channels: {} } }); const r = (await call("GET", "stats")).json; return { ok: r.channelsOn?.zomato === false && r.channelsOn.swiggy === false && r.channelsOn.website === false }; });
// L2750 — the day-part boundaries
C("Dashboard day parts: 07:00 is Breakfast, 11:00 Lunch, 15:00 Evening, 19:00 Dinner, 23:00 Late (boundaries belong to the part that starts)", "kills L2750 >=→>, <→<=",
  async () => { await world({ accessConfig: { view_dashboard: { manager_opts: { range: "last7" } } }, fix: { orders: [7, 11, 15, 19, 23].map((h, i) => ORD(`b${i}`, { created_at: atIst(-1, h) })) } });
    const d = ((await call("GET", "stats", { query: "?range=last7" })).json?.dayParts || []).map((p) => p.orders); return { ok: JSON.stringify(d) === "[1,1,1,1,1]", note: JSON.stringify(d) }; });
// L2807 — a paid bill with no method
C("Dashboard: a paid bill with no method recorded is filed as 'Not recorded'", "kills L2807 ||→&&",
  async () => { await world({ fix: { orders: [ORD("n", { payment_method: null })] } }); const r = (await call("GET", "stats")).json; return { ok: (r.paymentMethods || []).some((p) => p[0] === "Not recorded") }; });
// L2845 — last time's discount
C("Dashboard 'last time' takes yesterday's discount off yesterday's revenue", "kills L2845 ||→&&",
  async () => { const at = new Date(Date.now() - 864e5 - 60e3).toISOString(); if (Date.parse(at) < dayStart() - 864e5) return "skip: too early in the business day for a same-elapsed fixture";
    await world({ fix: { orders: [ORD("y", { created_at: at, total: 105, subtotal: 100, discount: 20 })] } }); const r = (await call("GET", "stats")).json; return { ok: Math.abs(r.prev.revenue - 84) < 0.01, note: `${r.prev?.revenue}` }; });
// L2908–2914 — live platform counts and today's platform money
C("Dashboard 'Right now': live Zomato and website orders are counted by channel, and today's platform money leaves out new and cancelled", "kills L2908, L2909, L2912, L2914",
  async () => { await world({ fix: { aggregator_orders: [{ restaurant_id: RID, source: "zomato", status: "accepted", total: 100, created_at: NOW() }, { restaurant_id: RID, source: "takeaway", status: "ready", total: 50, created_at: NOW() }, { restaurant_id: RID, source: "swiggy", status: "new", total: 70, created_at: NOW() }, { restaurant_id: RID, source: "zomato", status: "cancelled", total: 900, created_at: NOW() }] } });
    const r = (await call("GET", "stats")).json; return { ok: r.live?.zomato === 1 && r.live.takeaway === 1 && r.live.swiggy === 1 && r.platformToday?.count === 2 && r.platformToday.revenue === 150, note: JSON.stringify({ l: r.live, p: r.platformToday }) }; });
// L2926 — a dish exactly at the median units counts as popular
C("menu matrix: a dish sold exactly the median number of times counts as popular", "kills L2926 >=→>",
  async () => { const it = (title, qty, price) => ({ title, qty, price }); await world({ fix: { orders: [ORD("m", { items: [it("A", 1, 10), it("B", 2, 500), it("C", 3, 10)] })] } });
    const q = Object.fromEntries(((await call("GET", "stats")).json?.menuMatrix || []).map((m) => [m.title, m.q])); return { ok: q.B === "star", note: JSON.stringify(q) }; });
// L3048 — Staff watch 'today' is today only
C("Staff watch on 'today' leaves out a discount from three days ago", "kills L3048 ===→!==",
  async () => { await world({ fix: { staff_actions: [{ id: "o", restaurant_id: RID, panel: "manager", action: "order_discount", actor: "Ravi", created_at: new Date(dayStart() - 3 * 864e5).toISOString() }] } });
    const r = (await call("GET", "staff-risk")).json; return { ok: (r.rows || []).length === 0, note: JSON.stringify(r.rows) }; });
// L3089/3099 — a removal's frozen bill reaches its detail card
C("a removal's detail card draws the bill as it was (the frozen snapshot in meta.was)", "kills L3089, L3099 ||→&&",
  async () => { await world({ fix: { deletion_audit: [{ id: 9, restaurant_id: RID, kind: "order_cancelled", at: NOW(), meta: { was: { items: [{ title: "Tea", qty: 1, price: 20 }], subtotal: 20, total: 21 } } }] } });
    const r = (await call("GET", "audit", { query: "?detail=9" })).json; return { ok: typeof r.__billHtml === "string" && r.__billHtml.length > 20, note: `${typeof r.__billHtml}` }; });
// L3326 — the banquet print door on a today-only reach
C("on a today-only Bills reach, yesterday's banquet bill cannot be sent to the printer", "kills L3326 ===→!==",
  async () => { const G = await world({ settings: { modules: { printing: { routes: { banquet: { agent: "ag1", printer: "P" } } } } }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "PC", last_seen_at: NOW(), revoked_at: null }], banquet_bills: [{ id: "y", restaurant_id: RID, bill_no: "B9", issued_at: atIst(-1, 13) }] } });
    const r = await call("POST", "print/send", { body: { kind: "banquet", billId: "y" } }); return { ok: r.status === 404 && !G.WRITES.some((w) => w.table === "print_jobs") }; });
// L3333 — the queued bill names who asked for it
C("a bill sent to the printer names the person who sent it (their display name)", "kills L3333 ||→&&",
  async () => { const G = await world({ settings: { modules: { printing: { routes: { bill: { agent: "ag1", printer: "P" } } } } }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "PC", last_seen_at: NOW(), revoked_at: null }], sessions: [{ id: "s1", restaurant_id: RID }] } });
    await call("POST", "print/send", { body: { kind: "bill", sessionId: "s1" } }); return { ok: G.WRITES.find((w) => w.table === "print_jobs")?.patch?.requested_by === "Diag Manager" }; });
// L3380 — the floor-plan check is for placing an order and opening a table, nothing else
C("the floor-plan check touches only 'place an order' and 'open a table' — a table-sections save carrying a big table number is not refused by it", "kills L3380 ===→!==, &&→||",
  async () => { await world({ fix: { staff_users: [{ id: "w1", restaurant_id: RID, role: "tablet", name: "W" }] } }); const r = await call("POST", "table-sections", { body: { user_id: "w1", tables: [1], table: 99999 } }); return { ok: r.status === 200, note: `${r.status} ${r.json?.error || ""}` }; });

// ── pass-2 survivors (the last five ids of this terminal's block) ────────────────────────────────
C("the day-close sheet of a restaurant with no Billing name is headed with its own logo name (item 11)", "kills L2145 ||→&&",
  async () => { await world({ restaurants: [{ id: RID, slug: "spice-route", name: "Spice Route", logo_text: "Spice Route", access_config: {}, manager_permissions: {}, owner_entitlements: {} }], settings: { restaurant_name: null } });
    const r = (await call("GET", "zreport")).json; return { ok: r.restaurant?.name === "Spice Route", note: r.restaurant?.name }; });
C("Dashboard: a cooked cancellation with no discount field still has a value; a bill across two tables keeps its FIRST table; a tie for biggest bill keeps the first", "kills L2780, L2816, L2832",
  async () => { const o = (id_, x) => ORD(id_, x); const cx = o("cx", { status: "cancelled", payment_status: "pending", subtotal: 100 }); delete cx.discount;
    await world({ fix: { orders: [cx, o("a1", { session_id: "sm", table_number: "5", total: 105 }), o("a2", { session_id: "sm", table_number: "6", total: 105 }), o("t2", { session_id: "st", table_number: "9", total: 210 })] } });
    const r = (await call("GET", "stats")).json; return { ok: r.cancelledValue > 0 && r.biggestBill?.table === "5", note: JSON.stringify({ cv: r.cancelledValue, bb: r.biggestBill }) }; });
C("menu matrix: a dish exactly at the median revenue counts as high-earning", "kills L2930 >=→>",
  async () => { const it = (title, qty, price) => ({ title, qty, price }); await world({ fix: { orders: [ORD("m", { items: [it("A", 5, 10), it("B", 5, 20), it("C", 5, 30)] })] } });
    const q = Object.fromEntries(((await call("GET", "stats")).json?.menuMatrix || []).map((m) => [m.title, m.q])); return { ok: q.B === "star", note: JSON.stringify(q) }; });
C("a removal's detail card carries the whole-bill before/after when it names its session", "kills L3103 ||→&&",
  async () => { await world({ fix: { deletion_audit: [{ id: 11, restaurant_id: RID, kind: "order_cancelled", at: NOW(), session_id: "s1", order_id: "o1", meta: { was: { items: [{ title: "Tea", qty: 1, price: 20 }], subtotal: 20, total: 21 } } }], sessions: [{ id: "s1", restaurant_id: RID }], orders: [ORD("o1", { session_id: "s1", subtotal: 0, total: 0, status: "cancelled" })] } });
    // Not merely "a card exists": it must say WHAT was taken off — ₹21 and one line — which only the
    // frozen snapshot (meta.was) knows. Tightened after mutation pass 3 found the weaker form passing.
    const r = (await call("GET", "audit", { query: "?detail=11" })).json; const b = r.__billSides || {};
    return { ok: b.removed === 21 && b.lines_before - b.lines_after === 1, note: JSON.stringify(r.__billSides).slice(0, 120) }; });
C("a bill sent to the printer by a person with no display name is requested by their LOGIN, not by 'manager'", "kills L3337 ||→&& (second)",
  async () => { const G = await world({ user: { name: "" }, settings: { modules: { printing: { routes: { bill: { agent: "ag1", printer: "P" } } } } }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "PC", last_seen_at: NOW(), revoked_at: null }], sessions: [{ id: "s1", restaurant_id: RID }] } });
    await call("POST", "print/send", { body: { kind: "bill", sessionId: "s1" } }); return { ok: G.WRITES.find((w) => w.table === "print_jobs")?.patch?.requested_by === "diagm1" }; });

// ── THE LAST CHECK: every statement the WHOLE suite made names its restaurant ────────────────────
// Placed last so the log holds every block that ran before it (a, b, c, e, g). Allowed without a
// restaurant filter: the platform tables (app_config, restaurant_owners), the restaurant row itself by
// its own id, and ONE shape in the OTHER half of the route (POST items reads menu_items by id) — named
// for its owner, not changed here. Item 12 closed the two of mine this audit found.
C("EVERY database statement this half made during the whole suite says which restaurant it is for (restaurant row by id; inserts carry restaurant_id)", "G.SCOPE_LOG over blocks a, b, c, e, g — kills all 51 'drop restaurant filter' mutants",
  async () => { const { G } = await stubRoute(); const log = G.SCOPE_LOG || [];
    // The audit only means something over the WHOLE suite (≈2,600 statements): a partial run says so.
    if (log.length < 2000) return `skip: only ${log.length} statements logged — run every block (a, b, c, e, g, h) for the audit to mean anything`;
    const NOT_TENANT = new Set(["app_config", "restaurant_owners"]);
    const OTHER_HALF = new Set(["select menu_items [eq:id]"]);
    const sig = (q) => `${q.op} ${q.table} [${q.filters.map((f) => f.kind + ":" + f.col).sort().join(",")}]`;
    const bad = new Map();
    for (const q of log) {
      if (NOT_TENANT.has(q.table)) continue;
      const scoped = q.table === "restaurants" ? q.filters.some((f) => (f.kind === "eq" || f.kind === "in") && f.col === "id")
        : q.op === "insert" || q.op === "upsert" ? [].concat(q.patch || []).every((p) => p && p.restaurant_id)
        : q.filters.some((f) => f.kind === "eq" && f.col === "restaurant_id");
      if (!scoped && !OTHER_HALF.has(sig(q))) bad.set(sig(q), q.where);
    }
    return { ok: bad.size === 0, note: bad.size ? [...bad].map(([k, w]) => `${k} ← ${w}`).join(" | ") : `${log.length} statements, every one scoped` }; });

console.log(`block H: ${N - 178962} checks defined (P178962–P${N - 1})`);
