#!/usr/bin/env node
// verify:t10-writes — sweep #10 T10, items 2–7, on the manager route's second half.
//
// Each check DRIVES the real route (bundled with esbuild, called in memory against
// scripts/panel-stubs — terminal 9's harness) and reads what the handler WROTE. Every refusal has
// a twin proving the same door still works, so the suite cannot pass by refusing everybody.
//
//   2  POST platform/toggles is gone — it switched the kitchen's right to accept delivery orders
//      with no module or power check, and no screen has called it since 2026-07-07.
//   3  an OWNER's settings save cannot write a module's admin rungs (`modules`, `*_owner_control`,
//      `*_enabled`) or the admin's delivery channels; the admin console still can.
//   4  a whole-bill discount's %-limit is a share of the BILL, not of the bill's first ticket.
//   5  the bill-printed comment no longer says a second copy is branded (R37/R38).
//   6  a tip on a ticket that has gone is refused, not reported as saved.
//   7  handling a rating and clearing a table name the restaurant in every WHERE clause, not only the id.
import { readFileSync } from "node:fs";
import { world, call } from "./sweep/t9s10/lib.mjs";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const t = (cond, yes, no) => (cond ? ok(yes) : bad(no));
const RID = "rest-1";
const route = readFileSync(new URL("../app/api/editor/[...path]/route.ts", import.meta.url), "utf8");
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("verify:t10-writes — the manager route's second half, items 2–7");

// ── 2 ─────────────────────────────────────────────────────────────────────────────────────
{
  const G = await world({ settings: { kitchen_can_accept_platform: false } });
  const r = await call("POST", "platform/toggles", { body: { kitchen_can_accept_platform: true } });
  t(r.status === 404 && G.FIX.settings[0].kitchen_can_accept_platform === false && !G.WRITES.some((w) => w.table === "settings"),
    "item 2 · POST platform/toggles answers 404 and changes nothing",
    `item 2 · platform/toggles answered ${r.status}, kitchen_can_accept_platform=${G.FIX.settings[0].kitchen_can_accept_platform}`);
  t(!/b === "toggles"/.test(code), "item 2 · no `platform/toggles` branch exists in the route's code", "item 2 · a `toggles` branch is back in the route");
}

// ── 3 ─────────────────────────────────────────────────────────────────────────────────────
const RUNGS = { modules: { loyalty: { allowed: true } }, khata_owner_control: true, khata_enabled: true, banquet_owner_control: true,
  platform_channels: { zomato: { on: true, key: "k" } }, oplog_retention_days: 30 };
{
  const G = await world({ who: "owner", settings: { modules: { loyalty: { allowed: false } }, khata_owner_control: false } });
  const r = await call("POST", "settings", { body: { ...RUNGS } });
  const w = G.WRITES.filter((x) => x.table === "settings" && (x.op === "upsert" || x.op === "update")).pop();
  const p = (w && w.patch) || {};
  t(r.status === 200, "item 3 · the owner's settings save still succeeds", `item 3 · owner settings save answered ${r.status} ${r.text.slice(0, 80)}`);
  t(!("modules" in p) && !("khata_owner_control" in p) && !("khata_enabled" in p) && !("banquet_owner_control" in p) && !("platform_channels" in p),
    "item 3 · …and it wrote none of: modules, *_owner_control, *_enabled, platform_channels",
    `item 3 · the owner's save wrote ${Object.keys(p).filter((k) => k in RUNGS && k !== "oplog_retention_days").join(", ")}`);
  t(G.FIX.settings[0].modules?.loyalty?.allowed === false, "item 3 · …so Loyalty points stays OFF until the admin switches it on",
    "item 3 · the owner switched Loyalty points on for himself");
  t(p.oplog_retention_days === 30, "item 3 · …while a setting the owner DOES own (log retention) is still saved",
    `item 3 · the owner's retention value did not save (${p.oplog_retention_days})`);
}
{
  const G = await world({ who: "admin" });
  await call("POST", "settings", { body: { ...RUNGS } });
  const w = G.WRITES.filter((x) => x.table === "settings").pop();
  t(!!w && w.patch && "modules" in w.patch && "khata_owner_control" in w.patch,
    "item 3 · the admin console (no staff cookie) still writes those rungs", "item 3 · the admin's own save was stripped too");
}

// ── 4 ─────────────────────────────────────────────────────────────────────────────────────
const twoTicketBill = () => world({
  accessConfig: { give_discounts: { limit: { manager: 10 } } },
  fix: { orders: [
    { id: "k1", restaurant_id: RID, session_id: "s1", status: "preparing", subtotal: 200, taxable_base: 200, mrp_amount: 0 },
    { id: "k2", restaurant_id: RID, session_id: "s1", status: "preparing", subtotal: 800, taxable_base: 800, mrp_amount: 0 },
  ], sessions: [{ id: "s1", restaurant_id: RID, status: "open" }] },
});
{
  const G = await twoTicketBill();
  const r = await call("POST", "orders/k1/discount", { body: { amount: 100, note: "regular" } });
  const rpc = G.RPCS.find((c) => c.name === "lfh_staff_bill_discount");
  t(r.status === 200 && rpc && rpc.args.p_amount === 100,
    "item 4 · ₹100 off a ₹1,000 two-ticket bill is within a 10% limit (measured on the bill, not the ₹200 first ticket)",
    `item 4 · ₹100 off a ₹1,000 bill answered ${r.status} ${r.text.slice(0, 90)}`);
}
{
  const G = await twoTicketBill();
  const r = await call("POST", "orders/k1/discount", { body: { amount: 150 } });
  t(r.status === 403 && /10% limit/.test(r.text) && !G.RPCS.some((c) => c.name === "lfh_staff_bill_discount"),
    "item 4 · …and ₹150 (15% of the bill) is still refused, with nothing written", `item 4 · ₹150 answered ${r.status}`);
}
{
  const G = await world({ accessConfig: { give_discounts: { limit: { manager: 10 } } },
    fix: { orders: [{ id: "solo", restaurant_id: RID, session_id: null, status: "served", subtotal: 200, taxable_base: 200, mrp_amount: 0 }] } });
  const r1 = await call("POST", "orders/solo/discount", { body: { amount: 30 } });
  const r2 = await call("POST", "orders/solo/discount", { body: { amount: 20 } });
  t(r1.status === 403 && r2.status === 200 && G.FIX.orders[0].discount === 20,
    "item 4 · a solo ticket (no bill) is still measured against itself: ₹30 of ₹200 refused, ₹20 saved",
    `item 4 · solo ticket answered ${r1.status}/${r2.status}, discount ${G.FIX.orders[0].discount}`);
}

// ── 5 ─────────────────────────────────────────────────────────────────────────────────────
{
  const i = route.indexOf('if (a === "sessions" && c === "bill-printed")');
  const above = route.slice(Math.max(0, i - 2200), i);
  t(i > 0 && !/the document brands it|unbranded duplicate/.test(above) && /R38/.test(above),
    "item 5 · the bill-printed comment no longer says a second copy is branded, and names the R38 rule",
    "item 5 · the bill-printed comment promises a branded reprint again (R37 refused it)");
}

// ── 6 ─────────────────────────────────────────────────────────────────────────────────────
{
  const G = await world();
  const r = await call("POST", "orders/gone/tip", { body: { amount: 50 } });
  t(r.status === 404 && !G.LOGS.some((l) => l.action === "order_tip"),
    "item 6 · a tip on a ticket that has gone is refused (404) and not logged as given", `item 6 · answered ${r.status}`);
}
{
  const G = await world({ fix: { orders: [{ id: "o1", restaurant_id: RID, status: "served", payment_status: "paid" }] } });
  const r = await call("POST", "orders/o1/tip", { body: { amount: 50 } });
  t(r.status === 200 && G.FIX.orders[0].tip === 50 && G.LOGS.some((l) => l.action === "order_tip"),
    "item 6 · …and a tip on a real ticket is still saved and logged", `item 6 · a real tip answered ${r.status}, tip ${G.FIX.orders[0].tip}`);
}

// ── 7 ─────────────────────────────────────────────────────────────────────────────────────
// Every statement these two doors send names the restaurant in its WHERE clause.
const named = (G, table) => G.SCOPE_LOG.filter((s) => s.table === table).every((s) => s.filters.some((f) => f.col === "restaurant_id" && f.val === RID));
{
  const G = await world({ fix: { feedback: [{ id: "f1", restaurant_id: RID }, { id: "f2", restaurant_id: "rest-2" }] } });
  G.SCOPE_LOG.length = 0;
  const r = await call("POST", "ratings/ack", { body: { id: "f1", acknowledged: true } });
  t(r.status === 200 && G.FIX.feedback[0].acknowledged === true && named(G, "feedback"),
    "item 7 · handling a rating reads and writes it with the restaurant in the WHERE clause", `item 7 · ratings/ack answered ${r.status}, scoped=${named(G, "feedback")}`);
  const r2 = await call("POST", "ratings/ack", { body: { id: "f2", acknowledged: true } });
  t(r2.status === 404 && G.FIX.feedback[1].acknowledged === undefined,
    "item 7 · …and a rating that is not this restaurant's is simply not found, and untouched", `item 7 · another restaurant's rating answered ${r2.status}`);
}
{
  const G = await world({ perms: { void_bills: true }, fix: {
    sessions: [{ id: "s1", restaurant_id: RID, table_number: "4", status: "open" }],
    orders: [{ id: "o1", restaurant_id: RID, session_id: "s1", table_number: "4", status: "served", payment_status: "paid", archived: false }],
    session_members: [{ id: "m1", restaurant_id: RID, session_id: "s1", removed: false }] } });
  G.SCOPE_LOG.length = 0;
  const r = await call("POST", "tables/4/restart", { body: {} });
  t(r.status === 200 && G.FIX.sessions[0].status === "closed" && G.FIX.session_members[0].removed === true && named(G, "sessions") && named(G, "session_members"),
    "item 7 · clearing a table's round closes its party with the restaurant named on both writes", `item 7 · restart answered ${r.status}`);
}

// ── 8 ─────────────────────────────────────────────────────────────────────────────────────
{
  const G = await world({ fix: { blocklist: [] } });
  const r = await call("DELETE", "blocklist/gone-ban", {});
  t(r.status === 404 && !G.LOGS.some((l) => l.action === "blocklist_remove"),
    "item 8 · lifting a ban that is already gone answers 404 and writes no 'unbanned' line", `item 8 · answered ${r.status}, logged=${G.LOGS.some((l) => l.action === "blocklist_remove")}`);
}
{
  const G = await world({ fix: { blocklist: [{ id: "b1", restaurant_id: RID, phone: "9111" }], customers: [{ restaurant_id: RID, phone: "9111", blocked: true }] } });
  const r = await call("DELETE", "blocklist/b1", {});
  t(r.status === 200 && !G.FIX.blocklist.length && G.FIX.customers[0].blocked === false && G.LOGS.some((l) => l.action === "blocklist_remove"),
    "item 8 · …and a real ban is still lifted, the guest unblocked and the unban logged", `item 8 · a real unban answered ${r.status}`);
  const i = code.indexOf('if (a === "blocklist" && id)');
  t(i > 0 && !/select\("\*"\)/.test(code.slice(i, i + 900)), "item 8 · the unban reads the two columns it uses, not every column", "item 8 · the unban reads select(\"*\") again");
}
// ── 9 ─────────────────────────────────────────────────────────────────────────────────────
{
  const G = await world({ fix: { printer_events: [{ id: "e1", restaurant_id: RID, status: "open" }] } });
  const r = await call("POST", "printer-events/e1/resolve", { body: {} });
  t(r.status === 404 && G.FIX.printer_events[0].status === "open" && !G.LOGS.some((l) => l.action === "printer_problem_resolved") && !/a === "printer-events"/.test(code),
    "item 9 · the printer-problem 'resolve' door with no caller is gone (404, nothing written)", `item 9 · printer-events resolve answered ${r.status}`);
}
// ── 10 ────────────────────────────────────────────────────────────────────────────────────
const noDbWords = (r) => r.status >= 400 && !/stub:/.test(r.text);
{
  await world({ fail: { "rpc:lfh_capture_customer": "error" } });
  const r = await call("POST", "customer-capture", { body: { table: "4", phone: "98", consent: true } });
  t(noDbWords(r) && /Couldn't save the customer/.test(r.text), "item 10 · a failed customer save says a sentence, not the database's words", `item 10 · customer-capture said ${r.status} ${r.text.slice(0, 80)}`);
}
{
  await world({ perms: { khata: true }, settings: { khata_allowed: true }, fail: { "khata_customers:insert": "error" } });
  const r = await call("POST", "khata/customers", { body: { name: "Meera" } });
  t(noDbWords(r) && /pay-later book/.test(r.text), "item 10 · adding a person to the pay-later book fails in a sentence", `item 10 · khata/customers said ${r.status} ${r.text.slice(0, 80)}`);
}
{
  await world({ perms: { khata: true }, settings: { khata_allowed: true }, fail: { "khata_customers:insert": "error" }, fix: {
    orders: [{ id: "o1", restaurant_id: RID, table_number: "4", status: "served", payment_status: "pending", archived: false }] } });
  const r = await call("POST", "tables/4/khata", { body: { name: "Meera" } });
  t(noDbWords(r) && /pay-later book/.test(r.text), "item 10 · parking a bill on a NEW person fails in a sentence too", `item 10 · tables/:t/khata said ${r.status} ${r.text.slice(0, 80)}`);
}
{
  await world({ fail: { "issues:insert": "error" } });
  const r = await call("POST", "issue", { body: { subject: "Fridge" } });
  t(noDbWords(r) && /Couldn't raise the issue/.test(r.text), "item 10 · a complaint the database refused is answered in a sentence", `item 10 · issue said ${r.status} ${r.text.slice(0, 80)}`);
  const r2 = await call("POST", "issue", { body: { subject: "" } });
  t(r2.status === 400 && /Please add a subject/.test(r2.text), "item 10 · …while the complaint form's own sentence (no subject) still reaches the person", `item 10 · empty subject said ${r2.status} ${r2.text.slice(0, 60)}`);
}

// ── 11 ────────────────────────────────────────────────────────────────────────────────────
// The comment over the invoice door must say what the code does: print_invoice is not switchable.
{
  const i = route.indexOf('if (a === "sessions" && c === "invoice")');
  const head = route.slice(i, i + 1400);
  t(i > 0 && !/genuinely bites/.test(head) && /NOT a switch any more/.test(head),
    "item 11 · the invoice comment no longer claims 'Generate bills' is a live switch", "item 11 · the invoice comment claims a switch that does not exist");
  await world({ perms: { print_invoice: false }, fix: { sessions: [{ id: "s1", restaurant_id: RID, table_number: "4", bill_no: 1 }] } });
  const r = await call("POST", "sessions/s1/invoice", { body: { cust_phone: "9876543210", cust_name: "A" } });
  t(r.status === 200, "item 11 · …and that is true: a stored print_invoice=false refuses nobody (the owner's 2026-08-01 rule)",
    `item 11 · print_invoice=false answered ${r.status} — the comment and the code disagree again`);
}

console.log(`\n${fail ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
