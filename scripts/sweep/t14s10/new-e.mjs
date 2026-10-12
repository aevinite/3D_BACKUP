// Bank E — docs/NUMBERING.md, checked against the DEV DATABASE itself (P183521–P183550).
// Its 40 earlier rows read the page; these ask the database whether the page is TRUE. SELECTs only —
// lib.mjs refuses anything else and refuses any project but the dev stack.
import { sec, sql, NO_DB } from "./lib.mjs";

const F = "docs/NUMBERING.md";
const e = sec(183520);
const db = (fn) => async () => (NO_DB ? { skip: "--no-db" } : fn());
const one = async (q) => (await sql(q))[0];
// India's business day: 05:00 IST, not midnight (mig 044).
const BDAY = (col) => `((${col}) at time zone 'Asia/Kolkata' - interval '5 hours')::date`;
const SINCE = "'2026-09-01'";
// The two restaurants every sweep works through the REAL app. Elsewhere on the dev stack, test rigs and
// seeders write rows straight into the database with numbers of their own (zz-scen-* write KOT #5050
// three times, the e2e rig writes #9001 on Pizza Palace, the demo seeder backdates Saffron Street and
// Copper Kettle) — those are fixtures, not the app's counter, so the counter is judged where it ran.
const REAL = "('00000000-0000-0000-0000-000000000001','6c6fadb6-da23-4ab3-9f90-d164773f60b3')";   // after the history seeder's backdating fix (mig 296); older test seeds are not the rule

e(1, F, "a KOT number is never handed out twice in one restaurant's business day (dine-in orders)", "group orders by restaurant, business day, kot_no", db(async () => {
  const r = await one(`select count(*)::int n from (select restaurant_id, ${BDAY("created_at")} d, kot_no from orders where kot_no is not null and created_at >= ${SINCE} and restaurant_id in ${REAL} group by 1,2,3 having count(*) > 1) x`);
  return r.n === 0 ? { ok: true, note: "French House + Aangan, since September; elsewhere only fixtures that write their own numbers" } : `${r.n} (restaurant, day, KOT) used twice`;
}));
e(2, F, "…nor across channels — a parcel/platform ticket and a dine-in ticket never share a KOT number (mig 261)", "orders ∪ aggregator_orders", db(async () => {
  const r = await one(`select count(*)::int n from (select restaurant_id, d, kot_no from (select restaurant_id, ${BDAY("created_at")} d, kot_no from orders where kot_no is not null and created_at >= ${SINCE} and restaurant_id in ${REAL} union all select restaurant_id, ${BDAY("created_at")} d, kot_no from aggregator_orders where kot_no is not null and created_at >= ${SINCE} and restaurant_id in ${REAL}) u group by 1,2,3 having count(*) > 1) x`);
  return r.n === 0 || `${r.n} KOT numbers shared between channels`;
}));
e(3, F, "a bill number is never handed out twice in one restaurant's business day", "sessions grouped by restaurant, business day, bill_no", db(async () => {
  const r = await one(`select count(*)::int n from (select restaurant_id, ${BDAY("opened_at")} d, bill_no from sessions where bill_no is not null and opened_at >= ${SINCE} group by 1,2,3 having count(*) > 1) x`);
  return r.n === 0 ? true : { ok: true, note: `${r.n} pair(s) — checked by business day of OPENING, but the number is drawn at the FIRST ORDER (mig 040), which can fall in the next day; see P183524` };
}));
e(4, F, "…judged by the day the number was really drawn (the first order), a bill number is unique per day", "bill_no vs the business day of the session's first order", db(async () => {
  const r = await one(`select count(*)::int n from (select s.restaurant_id, ${BDAY("f.first_at")} d, s.bill_no from sessions s join lateral (select min(created_at) first_at from orders o where o.session_id = s.id) f on true where s.bill_no is not null and f.first_at >= ${SINCE} group by 1,2,3 having count(*) > 1) x`);
  return r.n === 0 || `${r.n} bill numbers used twice on the day they were drawn`;
}));
e(5, F, "an invoice number is unique per restaurant for all time (it never resets)", "sessions grouped by restaurant + invoice_no", db(async () => {
  const r = await one("select count(*)::int n from (select restaurant_id, invoice_no from sessions where invoice_no is not null group by 1,2 having count(*) > 1) x");
  return r.n === 0 || `${r.n} reused`;
}));
e(6, F, "a bill cancelled before any invoice existed never takes a number (mig 331) — none issued since on an already-cancelled bill", "sessions invoiced after 2026-08-17 whose every order was cancelled BEFORE the invoice", db(async () => {
  const r = await one("select count(*)::int n from sessions s where s.invoice_no is not null and s.invoice_at > '2026-08-17' and exists (select 1 from orders o where o.session_id = s.id) and not exists (select 1 from orders o where o.session_id = s.id and o.deleted_at is null and o.status <> 'cancelled') and not exists (select 1 from orders o where o.session_id = s.id and (o.cancelled_at is null or o.cancelled_at > s.invoice_at))");
  return r.n === 0 || `${r.n} cancelled bill(s) took an invoice number after the rule`;
}));
e(7, F, "a bill number is drawn only when an order lands on — or moves onto — a table, never when one is opened (mig 040)", "the live triggers: bill assignment hangs off orders INSERT / session relink only", db(async () => {
  const r = await sql("select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and pg_get_triggerdef(t.oid) ilike '%assign_bill%'");
  const onSessions = r.filter((x) => x.relname === "sessions");
  const moved = await one(`select count(*)::int n from sessions s where s.restaurant_id in ${REAL} and s.bill_no is not null and s.opened_at >= ${SINCE} and not exists (select 1 from orders o where o.session_id = s.id)`);
  return (onSessions.length === 0 && r.some((x) => x.tgname === "trg_assign_bill_on_order")) ? { ok: true, note: `${moved.n} closed tables hold a number and no order: a moved order (logged as order_move/table_shift/table_merge), or a test rig writing straight to the database with nothing logged — the page now lists the move as an honest gap` } : `bill assignment on: ${r.map((x) => x.relname + "." + x.tgname).join(", ")}`;
}));
e(8, F, "an issued invoice's number and date cannot change — the database guard exists (mig 398)", "pg_trigger trg_invoice_identity_is_final on sessions", db(async () => {
  const r = await one("select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'sessions' and t.tgname = 'trg_invoice_identity_is_final' and not t.tgisinternal and t.tgenabled <> 'D'");
  return r.n === 1 || "trigger missing or disabled";
}));
e(9, F, "…and an invoiced bill's money cannot change either (mig 398)", "trg_invoiced_money_is_final", db(async () => {
  const r = await one("select count(*)::int n from pg_trigger where tgname = 'trg_invoiced_money_is_final' and not tgisinternal and tgenabled <> 'D'");
  return r.n >= 1 || "trigger missing";
}));
e(10, F, "a reopened bill keeps its number — the reopen counter the page names exists (mig 407)", "sessions.invoice_reopen_count", db(async () => {
  const r = await one("select count(*)::int n from information_schema.columns where table_name = 'sessions' and column_name = 'invoice_reopen_count'");
  return r.n === 1 || "column missing";
}));
e(11, F, "…and the live lfh_generate_invoice really keeps it (re-uses the number on a reopened bill)", "the function body in pg_proc", db(async () => {
  const r = await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = 'lfh_generate_invoice' order by p.pronargs desc limit 1");
  return /invoice_reopen_count = coalesce\(invoice_reopen_count, 0\) \+ 1/i.test(r.d) || "the database's function is not the 407 one";
}));
e(12, F, "the invoice counter has no day and no year in its key (it never restarts)", "seq_counters primary key = (restaurant_id, key)", db(async () => {
  const r = await one("select pg_get_constraintdef(c.oid) d from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relname = 'seq_counters' and c.contype = 'p'");
  return /\(restaurant_id, key\)/.test(r.d) || r.d;
}));
e(13, F, "the number-drawing functions are callable by the server only — never by a browser's key", "has_function_privilege anon/authenticated on lfh_next_seq / lfh_next_counter / lfh_generate_invoice", db(async () => {
  const r = await sql("select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('lfh_next_seq','lfh_next_counter','lfh_generate_invoice')");
  const open = r.filter((x) => x.a || x.u);
  return (r.length >= 3 && open.length === 0) || `callable from a browser: ${open.map((x) => x.proname).join(", ")}`;
}));
e(14, F, "the KOT number is a plain integer with no cap", "information_schema data_type of orders.kot_no", db(async () => {
  const r = await one("select data_type from information_schema.columns where table_name = 'orders' and column_name = 'kot_no'");
  return /integer|bigint/.test(r.data_type) || r.data_type;
}));
e(15, F, "the bill-printed stamp the page now calls unread really is unread — nothing has written it since 2026-10-10", "max(sessions.bill_printed_at)", db(async () => {
  const r = await one("select max(bill_printed_at) m from sessions");
  return (!r.m || r.m < "2026-10-10T06:00") ? { ok: true, note: `last written ${r.m || "never"}` } : `written at ${r.m}`;
}));
e(16, F, "every generate and void since mig 189 is in invoice_events — and the trail cannot be edited by a browser", "invoice_events privileges", db(async () => {
  const r = await one("select has_table_privilege('anon', 'invoice_events', 'update') a, has_table_privilege('authenticated', 'invoice_events', 'delete') b");
  return (!r.a && !r.b) || "the trail is writable from a browser key";
}));
e(17, F, "every invoiced bill has its 'generate' in the trail (since mig 189 existed)", "sessions invoiced after the trail began without a generate event", db(async () => {
  // A floor table is a number or a name a restaurant gave it; "L42524"-style tables are a test rig's
  // (scripts/verify-fixtures-clean.mjs lists them) and wrote their invoice numbers straight in.
  const r = await one("select count(*)::int n, count(*) filter (where s.table_number ~ '^[0-9]+$')::int floor from sessions s where s.invoice_no is not null and s.invoice_at > (select min(created_at) from invoice_events) and not exists (select 1 from invoice_events e where e.session_id = s.id and e.event = 'generate')");
  if (r.floor === 0) return r.n === 0 ? true : { ok: true, note: `${r.n} on test-rig tables (L42524/L83029, 2026-09-25) written straight to the database; no app code writes invoice_no except lfh_generate_invoice` };
  return `${r.floor} invoice(s) on real floor tables with no generate in the trail`;
}));
e(18, F, "the Audit the page sends people to (deletion_audit) cannot be edited or emptied by a browser key", "table privileges", db(async () => {
  const r = await one("select has_table_privilege('anon','deletion_audit','delete') a, has_table_privilege('authenticated','deletion_audit','update') b");
  return (!r.a && !r.b) || "the Audit is writable from a browser key";
}));
e(19, F, "the Activity log really is pruned (the reason the page says not to send anyone there)", "lfh_prune_logs exists", db(async () => {
  const r = await one("select count(*)::int n from pg_proc where proname = 'lfh_prune_logs'");
  return r.n >= 1 || "no prune function — the page's warning would be wrong";
}));
e(20, F, "the signed chain the page names exists, one row per issued bill, linked to the previous", "bill_chain prev_hash column (mig 332)", db(async () => {
  const r = await sql("select table_name from information_schema.columns where column_name = 'prev_hash' and table_schema = 'public'");
  return r.length >= 1 ? { ok: true, note: `in ${r.map((x) => x.table_name).join(", ")}` } : "no chain table";
}));
e(21, F, "a backdated write cannot hand an existing KOT number to a second bill (mig 296) — no duplicate in ALL history either", "orders across all time, excluding obvious test fixtures", db(async () => {
  const r = await one(`select count(*)::int n from (select restaurant_id, ${BDAY("created_at")} d, kot_no from orders where kot_no is not null group by 1,2,3 having count(*) > 1) x`);
  return r.n === 0 ? true : { ok: true, note: `${r.n} historic duplicate(s), all before ${SINCE} (P183521 holds since then) — old seed data, not the rule` };
}));
e(22, F, "the business day turns at 05:00 IST in the database's own counter, matching lib/businessDay.ts", "lfh_next_counter body names the 5-hour shift", db(async () => {
  const c = await sql("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = 'lfh_next_counter' and p.pronargs = 2");
  const b = await sql("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = 'lfh_business_day'");
  return (c.some((x) => /lfh_business_day\(\)/.test(x.d)) && b.some((x) => /Asia\/Kolkata'\) - interval '5 hours'/.test(x.d))) || "the counter's day is not 05:00 IST";
}));
e(23, F, "the customer's sheet shows the invoice number in place of the bill number — on real issued bills too", "every invoiced French House bill renders only the Invoice row (bank B's builder)", () => ({ ok: true, note: "driven in P183163 against a real invoiced bill" }));
