// Bank D · lib/printQueue.ts — the kitchen-slip queue (mig 335) and the one-screen station (mig 338).
// The real exports, bundled, against an in-memory database holding TWO restaurants, so every check
// that something changes also checks that the other restaurant's rows did not.
import { load, chk, assert, eq } from "./lib.mjs";
import { memDb } from "./memdb.mjs";

const F = "lib/printQueue.ts";
const H = "node: the real export, bundled, against an in-memory database with two restaurants";
const q = await load(F);
const RA = "rest-a", RB = "rest-b";
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const withDb = (init) => { const db = memDb(init); globalThis.__t15 = { sb: db, alerts: [] }; return db; };
const job = (o) => ({ kind: "kot", status: "queued", attempts: 0, reprint: false, claimed_at: null, created_at: ago(5000), ...o });
const order = (o) => ({ status: "placed", deleted_at: null, kot_no: 7, table_number: "T4", created_at: ago(9000), ...o });

await chk("P184166", F, "a claim older than two minutes counts as abandoned (STALE_CLAIM_MS)", H, () => eq(q.STALE_CLAIM_MS, 120000));
await chk("P184167", F, "the 'stuck' threshold every screen shares is one minute", H, () => eq(q.STUCK_AFTER_MS, 60000));
await chk("P184168", F, "a print station silent for three minutes may be taken over", H, () => eq(q.STATION_STALE_MS, 180000));

// ── waitingToPrint ──────────────────────────────────────────────────────────────────────────
await chk("P184169", F, "waitingToPrint counts this restaurant's queued + printing slips only", H, async () => {
  withDb({ print_jobs: [job({ id: "1", restaurant_id: RA }), job({ id: "2", restaurant_id: RA, status: "printing" }), job({ id: "3", restaurant_id: RB }), job({ id: "4", restaurant_id: RA, status: "done" })] });
  eq((await q.waitingToPrint(RA)).n, 2);
});
await chk("P184170", F, "…and measures from the OLDEST waiting slip", H, async () => {
  withDb({ print_jobs: [job({ id: "1", restaurant_id: RA, created_at: ago(30_000) }), job({ id: "2", restaurant_id: RA, created_at: ago(90_000) })] });
  const r = await q.waitingToPrint(RA); assert(r.oldestMs >= 89_000 && r.oldestMs < 100_000, String(r.oldestMs));
});
await chk("P184171", F, "…kind=null counts every kind of paper, kind='bill' only bills", H, async () => {
  withDb({ print_jobs: [job({ id: "1", restaurant_id: RA }), job({ id: "2", restaurant_id: RA, kind: "bill" })] });
  eq((await q.waitingToPrint(RA, null)).n, 2); eq((await q.waitingToPrint(RA, "bill")).n, 1);
});
await chk("P184172", F, "…nothing waiting reads as 0 and no age, not a stale age", H, async () => { withDb({ print_jobs: [] }); eq(await q.waitingToPrint(RA), { n: 0, oldestMs: null }); });

// ── pendingKotJobs ──────────────────────────────────────────────────────────────────────────
await chk("P184173", F, "pendingKotJobs offers this restaurant's live slips with their order and lines", H, async () => {
  withDb({ print_jobs: [job({ id: "j1", restaurant_id: RA, order_id: "o1" })], orders: [order({ id: "o1", restaurant_id: RA })],
    order_items: [{ id: "i1", order_id: "o1", restaurant_id: RA, title: "Dal", qty: 2, created_at: ago(1) }] });
  const r = await q.pendingKotJobs(RA); eq(r.length, 1); eq(r[0].order.kot_no, 7); eq(r[0].items.length, 1);
});
await chk("P184174", F, "…never another restaurant's slip, even with the same order id", H, async () => {
  withDb({ print_jobs: [job({ id: "j1", restaurant_id: RB, order_id: "o1" })], orders: [order({ id: "o1", restaurant_id: RB })], order_items: [] });
  eq((await q.pendingKotJobs(RA)).length, 0);
});
await chk("P184175", F, "…a slip whose order was DELETED is retired as dismissed, with the reason on it", H, async () => {
  const db = withDb({ print_jobs: [job({ id: "j1", restaurant_id: RA, order_id: "gone" })], orders: [], order_items: [] });
  eq((await q.pendingKotJobs(RA)).length, 0); const j = db.tables.print_jobs[0]; eq(j.status, "dismissed"); assert(/deleted/.test(j.error), j.error);
});
await chk("P184176", F, "…a soft-deleted order (deleted_at set) counts as deleted", H, async () => {
  const db = withDb({ print_jobs: [job({ id: "j1", restaurant_id: RA, order_id: "o1" })], orders: [order({ id: "o1", restaurant_id: RA, deleted_at: ago(1) })], order_items: [] });
  await q.pendingKotJobs(RA); eq(db.tables.print_jobs[0].status, "dismissed");
});
await chk("P184177", F, "…a CANCELLED order's slip is retired too — food nobody ordered is never printed", H, async () => {
  const db = withDb({ print_jobs: [job({ id: "j1", restaurant_id: RA, order_id: "o1" })], orders: [order({ id: "o1", restaurant_id: RA, status: "cancelled" })], order_items: [] });
  eq((await q.pendingKotJobs(RA)).length, 0); assert(/cancelled/.test(db.tables.print_jobs[0].error));
});
await chk("P184178", F, "…ten dead slips ahead of a live one do not block it (they are retired, the live one offered next)", H, async () => {
  const dead = Array.from({ length: 10 }, (_, i) => job({ id: "d" + i, restaurant_id: RA, order_id: "gone" + i, created_at: ago(60_000 - i) }));
  withDb({ print_jobs: [...dead, job({ id: "live", restaurant_id: RA, order_id: "o1", created_at: ago(1000) })], orders: [order({ id: "o1", restaurant_id: RA })], order_items: [] });
  await q.pendingKotJobs(RA); const r = await q.pendingKotJobs(RA); eq(r.map((x) => x.id), ["live"]);
});
await chk("P184179", F, "…retiring a dead slip never touches the other restaurant's rows", H, async () => {
  const db = withDb({ print_jobs: [job({ id: "j1", restaurant_id: RA, order_id: "gone" }), job({ id: "j2", restaurant_id: RB, order_id: "gone" })], orders: [], order_items: [] });
  await q.pendingKotJobs(RA); eq(db.tables.print_jobs.find((x) => x.id === "j2").status, "queued");
});
await chk("P184180", F, "…a slip claimed under two minutes ago is NOT offered again", H, async () => {
  withDb({ print_jobs: [job({ id: "j1", restaurant_id: RA, order_id: "o1", status: "printing", claimed_at: ago(30_000) })], orders: [order({ id: "o1", restaurant_id: RA })], order_items: [] });
  eq((await q.pendingKotJobs(RA)).length, 0);
});
await chk("P184181", F, "…a slip claimed over two minutes ago (its printer died) IS offered again", H, async () => {
  withDb({ print_jobs: [job({ id: "j1", restaurant_id: RA, order_id: "o1", status: "printing", claimed_at: ago(200_000) })], orders: [order({ id: "o1", restaurant_id: RA })], order_items: [] });
  eq((await q.pendingKotJobs(RA)).length, 1);
});
await chk("P184182", F, "…done, failed and dismissed slips are never offered", H, async () => {
  withDb({ print_jobs: ["done", "failed", "dismissed"].map((s, i) => job({ id: "x" + i, restaurant_id: RA, order_id: "o1", status: s })), orders: [order({ id: "o1", restaurant_id: RA })], order_items: [] });
  eq((await q.pendingKotJobs(RA)).length, 0);
});
await chk("P184183", F, "…includeAuto:false offers only reprints", H, async () => {
  withDb({ print_jobs: [job({ id: "a", restaurant_id: RA, order_id: "o1" }), job({ id: "r", restaurant_id: RA, order_id: "o1", reprint: true })], orders: [order({ id: "o1", restaurant_id: RA })], order_items: [] });
  eq((await q.pendingKotJobs(RA, { includeAuto: false })).map((x) => x.id), ["r"]);
});
await chk("P184184", F, "…minAgeMs holds back a slip younger than the window", H, async () => {
  withDb({ print_jobs: [job({ id: "young", restaurant_id: RA, order_id: "o1", created_at: ago(1000) }), job({ id: "old", restaurant_id: RA, order_id: "o1", created_at: ago(60_000) })], orders: [order({ id: "o1", restaurant_id: RA })], order_items: [] });
  eq((await q.pendingKotJobs(RA, { minAgeMs: 30_000 })).map((x) => x.id), ["old"]);
});
await chk("P184185", F, "…oldest first, so slips print in the order they were sent", H, async () => {
  withDb({ print_jobs: [job({ id: "b", restaurant_id: RA, order_id: "o1", created_at: ago(1000) }), job({ id: "a", restaurant_id: RA, order_id: "o1", created_at: ago(5000) })], orders: [order({ id: "o1", restaurant_id: RA })], order_items: [] });
  eq((await q.pendingKotJobs(RA)).map((x) => x.id), ["a", "b"]);
});
await chk("P184186", F, "…the offer is capped (20 by default) — a backlog never comes back as one huge read", H, async () => {
  withDb({ print_jobs: Array.from({ length: 60 }, (_, i) => job({ id: "j" + i, restaurant_id: RA, order_id: "o1", created_at: ago(100_000 - i) })), orders: [order({ id: "o1", restaurant_id: RA })], order_items: [] });
  eq((await q.pendingKotJobs(RA)).length, 20);
});
await chk("P184187", F, "…a slip with no order (a delivery-app slip, a sample) is left for the helper, not retired here", H, async () => {
  const db = withDb({ print_jobs: [job({ id: "agg", restaurant_id: RA, order_id: null, payload: { aggId: "x" } })], orders: [], order_items: [] });
  eq((await q.pendingKotJobs(RA)).length, 0); eq(db.tables.print_jobs[0].status, "queued");
});
await chk("P184188", F, "…each slip gets only ITS order's lines", H, async () => {
  withDb({ print_jobs: [job({ id: "j1", restaurant_id: RA, order_id: "o1" }), job({ id: "j2", restaurant_id: RA, order_id: "o2" })], orders: [order({ id: "o1", restaurant_id: RA }), order({ id: "o2", restaurant_id: RA })],
    order_items: [{ id: "i1", order_id: "o1", restaurant_id: RA, created_at: ago(2) }, { id: "i2", order_id: "o2", restaurant_id: RA, created_at: ago(1) }, { id: "i3", order_id: "o2", restaurant_id: RA, created_at: ago(1) }] });
  const r = await q.pendingKotJobs(RA); eq(r.map((x) => x.items.length), [1, 2]);
});

// ── claimKotJobs ────────────────────────────────────────────────────────────────────────────
await chk("P184189", F, "claimKotJobs wins only live slips and marks them printing with a claim time", H, async () => {
  const db = withDb({ print_jobs: [job({ id: "a", restaurant_id: RA }), job({ id: "b", restaurant_id: RA, status: "done" })] });
  eq(await q.claimKotJobs(RA, ["a", "b"]), ["a"]); const a = db.tables.print_jobs[0]; eq(a.status, "printing"); assert(a.claimed_at);
});
await chk("P184190", F, "…a second claimant of the same slip wins nothing (the claim is one filtered update)", H, async () => {
  withDb({ print_jobs: [job({ id: "a", restaurant_id: RA })] }); eq(await q.claimKotJobs(RA, ["a"]), ["a"]); eq(await q.claimKotJobs(RA, ["a"]), []);
});
await chk("P184191", F, "…another restaurant's slip id is never won", H, async () => { const db = withDb({ print_jobs: [job({ id: "a", restaurant_id: RB })] }); eq(await q.claimKotJobs(RA, ["a"]), []); eq(db.tables.print_jobs[0].status, "queued"); });
await chk("P184192", F, "…an empty or junk id list claims nothing and touches nothing", H, async () => { const db = withDb({ print_jobs: [] }); eq(await q.claimKotJobs(RA, []), []); eq(await q.claimKotJobs(RA, null), []); eq(db.log.length, 0); });
await chk("P184193", F, "…at most 20 ids are taken from one request", H, async () => {
  const db = withDb({ print_jobs: Array.from({ length: 30 }, (_, i) => job({ id: "j" + i, restaurant_id: RA })) });
  await q.claimKotJobs(RA, db.tables.print_jobs.map((x) => x.id)); eq(db.tables.print_jobs.filter((x) => x.status === "printing").length, 20);
});
await chk("P184194", F, "…minAgeMs is enforced in the CLAIM itself, not only in the read that offered it", H, async () => {
  withDb({ print_jobs: [job({ id: "young", restaurant_id: RA, created_at: ago(1000) })] }); eq(await q.claimKotJobs(RA, ["young"], { minAgeMs: 30_000 }), []);
});

// ── finishKotJob ────────────────────────────────────────────────────────────────────────────
const fin = (o = {}, extra = {}) => withDb({ print_jobs: [job({ id: "j", restaurant_id: RA, order_id: "o1", status: "printing", claimed_at: ago(1000), ...o })],
  orders: [order({ id: "o1", restaurant_id: RA })], printer_events: [], ...extra });
await chk("P184195", F, "a printed slip is marked done, with no error left on it", H, async () => {
  const db = fin({ error: "old" }); const r = await q.finishKotJob(RA, "j", true); eq(r.found, true); eq([db.tables.print_jobs[0].status, db.tables.print_jobs[0].error], ["done", null]);
});
await chk("P184196", F, "…and it closes the open printer problems for THAT printer", H, async () => {
  const db = fin({}, { printer_events: [{ id: "e1", restaurant_id: RA, status: "open", printer: "POS80" }, { id: "e2", restaurant_id: RA, status: "open", printer: "Bills" }] });
  await q.finishKotJob(RA, "j", true, "", "POS80"); eq(db.tables.printer_events.map((e) => e.status), ["resolved", "open"]);
});
await chk("P184197", F, "…and the problems that never named a printer", H, async () => {
  const db = fin({}, { printer_events: [{ id: "e1", restaurant_id: RA, status: "open", printer: null }] }); await q.finishKotJob(RA, "j", true, "", "POS80"); eq(db.tables.printer_events[0].status, "resolved");
});
await chk("P184198", F, "…never another restaurant's printer problem", H, async () => {
  const db = fin({}, { printer_events: [{ id: "e1", restaurant_id: RB, status: "open", printer: "POS80" }] }); await q.finishKotJob(RA, "j", true, "", "POS80"); eq(db.tables.printer_events[0].status, "open");
});
await chk("P184199", F, "…a printer name with SQL-looking text is matched as a value, never pasted into a filter", "read the statement the export sent", async () => {
  const db = fin({}, { printer_events: [{ id: "e1", restaurant_id: RA, status: "open", printer: "x),status.eq.open" }] });
  await q.finishKotJob(RA, "j", true, "", "x),status.eq.open");
  const stmts = db.log.filter((s) => s.table === "printer_events"); assert(stmts.every((s) => !s.ops.some(([k]) => k === "or")), "an or() filter string was built"); eq(db.tables.printer_events[0].status, "resolved");
});
await chk("P184200", F, "a failed slip goes back in the queue with its attempt counted and the reason kept", H, async () => {
  const db = fin(); const r = await q.finishKotJob(RA, "j", false, "paper jam"); const j = db.tables.print_jobs[0];
  eq([j.status, j.attempts, j.error, j.claimed_at], ["queued", 1, "paper jam", null]); eq(r.parked, false);
});
await chk("P184201", F, "…a long error is cut to 300 characters", H, async () => { const db = fin(); await q.finishKotJob(RA, "j", false, "x".repeat(5000)); eq(db.tables.print_jobs[0].error.length, 300); });
await chk("P184202", F, "…on the FIFTH failure it parks as failed", H, async () => { const db = fin({ attempts: 4 }); const r = await q.finishKotJob(RA, "j", false, "jam"); eq([db.tables.print_jobs[0].status, r.parked, r.attempts], ["failed", true, 5]); });
await chk("P184203", F, "…and only then is somebody told: a printer problem is filed and the owner pinged", H, async () => {
  const db = fin({ attempts: 4 }); await q.finishKotJob(RA, "j", false, "jam", "POS80");
  eq(db.tables.printer_events.length, 1); eq(db.tables.printer_events[0].printer, "POS80"); eq(globalThis.__t15.alerts.length, 1); assert(/#7/.test(db.tables.printer_events[0].note), db.tables.printer_events[0].note);
});
await chk("P184204", F, "…retries one to four tell nobody (four quiet retries are the queue doing its job)", H, async () => {
  for (let a = 0; a < 4; a++) { const db = fin({ attempts: a }); await q.finishKotJob(RA, "j", false, "jam"); eq(db.tables.printer_events.length, 0); eq(globalThis.__t15.alerts.length, 0); }
});
await chk("P184205", F, "…the owner's ping names the kind of paper and the printer, and is keyed so it does not repeat per ticket", H, async () => {
  fin({ attempts: 4 }); await q.finishKotJob(RA, "j", false, "jam", "POS80"); const [msg, key] = globalThis.__t15.alerts[0];
  assert(/kitchen ticket could not be printed on POS80/.test(msg), msg); eq(key, `print-failed:${RA}:kitchen ticket:POS80`);
});
await chk("P184206", F, "a slip TAKEN OUT before its failure report arrives stays taken out; only the claim is released", H, async () => {
  const db = fin({ status: "dismissed", error: "cleared from the Printing screen" }); const r = await q.finishKotJob(RA, "j", false, "jam");
  const j = db.tables.print_jobs[0]; eq([j.status, j.error, j.claimed_at], ["dismissed", "cleared from the Printing screen", null]); eq(r.parked, false);
});
await chk("P184207", F, "…and if it is taken out BETWEEN the status read and the requeue, the requeue still refuses it (item 2)", H, async () => {
  const db = fin(); let reads = 0;
  // the moment the function has READ the slip, somebody presses "Clear the waiting tickets"
  db.afterExec = (st) => { if (st.table === "print_jobs" && !st.ops.some(([k]) => k === "update") && ++reads === 1) { db.tables.print_jobs[0].status = "dismissed"; db.tables.print_jobs[0].error = "cleared"; } };
  await q.finishKotJob(RA, "j", false, "jam"); eq([db.tables.print_jobs[0].status, db.tables.print_jobs[0].error], ["dismissed", "cleared"]);
});
await chk("P184208", F, "…a duplicate failure report for a slip already printed does not put it back in the queue", H, async () => {
  const db = fin({ status: "done" }); await q.finishKotJob(RA, "j", false, "late report"); eq(db.tables.print_jobs[0].status, "done");
});
await chk("P184209", F, "a success for a slip that was taken out is still recorded as printed (if paper came out, the log says so)", H, async () => {
  const db = fin({ status: "dismissed" }); await q.finishKotJob(RA, "j", true); eq(db.tables.print_jobs[0].status, "done");
});
await chk("P184210", F, "another restaurant's job id is 'not found' and nothing is written", H, async () => {
  const db = withDb({ print_jobs: [job({ id: "j", restaurant_id: RB, status: "printing" })], orders: [], printer_events: [] });
  eq((await q.finishKotJob(RA, "j", true)).found, false); eq(db.tables.print_jobs[0].status, "printing");
});
await chk("P184211", F, "finishKotJob answers with the slip's KOT number and table, for the screen's own message", H, async () => {
  fin(); const r = await q.finishKotJob(RA, "j", true); eq([r.kotNo, r.tableNumber, r.orderId], [7, "T4", "o1"]);
});

// ── tellSomebodyItGaveUp ────────────────────────────────────────────────────────────────────
await chk("P184212", F, "tellSomebodyItGaveUp files a printer problem for THIS restaurant, worded in English", H, async () => {
  const db = withDb({ printer_events: [] }); await q.tellSomebodyItGaveUp(RA, { what: "A bill", alsoCalled: "bill", printer: "Bills", attempts: 5 });
  const e = db.tables.printer_events[0]; eq([e.restaurant_id, e.kind, e.printer], [RA, "auto_fail", "Bills"]); eq(e.note, "A bill gave up after 5 tries");
});
await chk("P184213", F, "…a failing insert or alert never throws into the print report", H, async () => {
  globalThis.__t15 = { sb: { from: () => { throw new Error("db down"); } }, alerts: [] };
  await q.tellSomebodyItGaveUp(RA, { what: "x", alsoCalled: "bill", printer: null, attempts: 5 });
});

// ── ordersAlreadyQueued ─────────────────────────────────────────────────────────────────────
await chk("P184214", F, "ordersAlreadyQueued names only orders that already have a slip in THIS restaurant", H, async () => {
  withDb({ print_jobs: [job({ id: "1", restaurant_id: RA, order_id: "o1" }), job({ id: "2", restaurant_id: RB, order_id: "o2" }), job({ id: "3", restaurant_id: RA, order_id: "o3", kind: "bill" })] });
  eq((await q.ordersAlreadyQueued(RA, ["o1", "o2", "o3"])).sort(), ["o1"]);
});
await chk("P184215", F, "…no ids asks nothing", H, async () => { const db = withDb({ print_jobs: [] }); eq(await q.ordersAlreadyQueued(RA, []), []); eq(db.log.length, 0); });
await chk("P184216", F, "…duplicates collapse, and at most 200 ids are asked about", H, async () => {
  const db = withDb({ print_jobs: [] }); await q.ordersAlreadyQueued(RA, [...Array.from({ length: 300 }, (_, i) => "o" + i), "o1", "o1"]);
  const ins = db.log[0].ops.find(([k, c]) => k === "in" && c === "order_id"); eq(ins[2].length, 200);
});

// ── the print station (mig 338) ─────────────────────────────────────────────────────────────
const st = (o) => ({ restaurant_id: RA, panel: "kitchen", label: "Kitchen", claimed_by: null, active: true, last_seen_at: ago(10_000), ...o });
await chk("P184217", F, "stationView says which screen is the printer, and whether that is this device", H, async () => {
  withDb({ print_stations: [st({ device_id: "d1" })] }); const v = await q.stationView(RA, "d1"); eq([v.active.device_id, v.mine, v.stale], ["d1", true, false]);
});
await chk("P184218", F, "…a station quiet for over three minutes reads as stale", H, async () => { withDb({ print_stations: [st({ device_id: "d1", last_seen_at: ago(200_000) })] }); eq((await q.stationView(RA, "d2")).stale, true); });
await chk("P184219", F, "…another restaurant's station is invisible", H, async () => { withDb({ print_stations: [st({ device_id: "d1", restaurant_id: RB })] }); eq((await q.stationView(RA, "d1")).active, null); });
await chk("P184220", F, "takeStation stands every other screen down, then this one up — one active station", H, async () => {
  const db = withDb({ print_stations: [st({ device_id: "d1" }), st({ device_id: "d9", restaurant_id: RB })] });
  await q.takeStation(RA, { deviceId: "d2", label: "Bar", panel: "editor" });
  const a = db.tables.print_stations.filter((x) => x.restaurant_id === RA && x.active); eq(a.map((x) => x.device_id), ["d2"]);
  eq(db.tables.print_stations.find((x) => x.device_id === "d9").active, true);
});
await chk("P184221", F, "…the label is capped at 60 characters", H, async () => { const db = withDb({ print_stations: [] }); await q.takeStation(RA, { deviceId: "d2", label: "L".repeat(200), panel: "kitchen" }); eq(db.tables.print_stations[0].label.length, 60); });
await chk("P184222", F, "releaseStation stands only THIS device down, in this restaurant", H, async () => {
  const db = withDb({ print_stations: [st({ device_id: "d1" }), st({ device_id: "d1", restaurant_id: RB })] }); await q.releaseStation(RA, "d1");
  eq(db.tables.print_stations.map((x) => x.active), [false, true]);
});
await chk("P184223", F, "mayClaim: auto-print off → refused with reason 'off'", H, async () => { withDb({ print_stations: [] }); eq((await q.mayClaim(RA, { deviceId: "d", panel: "kitchen", label: "K", auto: false, roomAllowed: true })).reason, "off"); });
await chk("P184224", F, "mayClaim: the wrong room → 'wrong_room'; no device → 'no_device'", H, async () => {
  withDb({ print_stations: [] }); eq((await q.mayClaim(RA, { deviceId: "d", panel: "kitchen", label: "K", auto: true, roomAllowed: false })).reason, "wrong_room");
  eq((await q.mayClaim(RA, { deviceId: null, panel: "kitchen", label: "K", auto: true, roomAllowed: true })).reason, "no_device");
});
await chk("P184225", F, "mayClaim: a LIVE other station holds it → 'other_station', and nothing is taken", H, async () => {
  const db = withDb({ print_stations: [st({ device_id: "d1" })] }); eq((await q.mayClaim(RA, { deviceId: "d2", panel: "kitchen", label: "K", auto: true, roomAllowed: true })).reason, "other_station");
  eq(db.tables.print_stations.filter((x) => x.active).map((x) => x.device_id), ["d1"]);
});
await chk("P184226", F, "mayClaim: a STALE other station is taken over automatically", H, async () => {
  const db = withDb({ print_stations: [st({ device_id: "d1", last_seen_at: ago(400_000) })] }); eq((await q.mayClaim(RA, { deviceId: "d2", panel: "kitchen", label: "K", auto: true, roomAllowed: true })).ok, true);
  eq(db.tables.print_stations.filter((x) => x.active).map((x) => x.device_id), ["d2"]);
});
await chk("P184227", F, "mayClaim: autoTake:false asks before taking over a stale one", H, async () => {
  withDb({ print_stations: [st({ device_id: "d1", last_seen_at: ago(400_000) })] }); eq((await q.mayClaim(RA, { deviceId: "d2", panel: "kitchen", label: "K", auto: true, roomAllowed: true, autoTake: false })).reason, "other_station");
});
await chk("P184228", F, "mayClaim: the station itself is let through and its heartbeat refreshed", H, async () => {
  const db = withDb({ print_stations: [st({ device_id: "d1", last_seen_at: ago(100_000) })] }); eq((await q.mayClaim(RA, { deviceId: "d1", panel: "kitchen", label: "K", auto: true, roomAllowed: true })).ok, true);
  assert(Date.now() - Date.parse(db.tables.print_stations[0].last_seen_at) < 5000, "heartbeat not refreshed");
});
await chk("P184229", F, "a lone screen with no station yet becomes the station on its first claim", H, async () => {
  const db = withDb({ print_stations: [] }); eq((await q.mayClaim(RA, { deviceId: "d1", panel: "kitchen", label: "K", auto: true, roomAllowed: true })).ok, true); eq(db.tables.print_stations.length, 1);
});
await chk("P184230", F, "wrote() logs a failed write instead of swallowing it, and hands the answer back unchanged", H, async () => {
  const seen = []; const orig = console.error; console.error = (...a) => seen.push(a.join(" "));
  try { const r = await q.wrote("x", Promise.resolve({ error: { message: "boom" } })); eq(r.error.message, "boom"); assert(seen.some((s) => /\[print-queue\] x failed: boom/.test(s)), seen.join("|")); }
  finally { console.error = orig; }
});
