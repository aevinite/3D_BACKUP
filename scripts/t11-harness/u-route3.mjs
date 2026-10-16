// SWEEP #10 T11 ROUND 2 · THE BREAKS THE FIRST TWO SUITES DID NOT NOTICE, AND ITEM 16 — P180837–P180858.
// HERMETIC (same kit as u-route.mjs). scripts/t11-harness/mutate.mjs broke route.ts one small change at a time:
// 240 breaks, 184 noticed, 56 not. Most of the 56 shared one blind spot — a refusal was checked by its STATUS
// and not by its WORDS, and the words are what the cook reads (the panel shows `error`, else the bare status
// text). Each row below closes one or more of them; the ones that cannot change anything a person or another
// screen sees are listed as equivalent at the bottom, with the reason.
import { k, done, world, call, G, logs, ord, item, KF, RID_A, AGO, NOW, COOK } from "./lib.mjs";
const F = KF, st = (r) => r.status, er = (r) => String((r.json && r.json.error) || "");
const job = (id, o = {}) => ({ id, restaurant_id: RID_A, kind: "kot", status: "queued", order_id: "o1", reprint: false, attempts: 0, created_at: AGO(5000), ...o });
const helper = { modules: { printing: { routes: { kot: { agent: "a1", printer: "POS_80" } } } } };
const agent = { print_agents: [{ id: "a1", restaurant_id: RID_A, name: "Shop PC", revoked_at: null, created_at: AGO(9e6), last_seen_at: NOW(), printers: [] }] };
const AUTO = { auto_print_kot: true, auto_print_kot_allowed: true };
const TENANT = ["orders", "order_items", "menu_items", "aggregator_orders", "settings", "table_tags", "print_jobs", "printer_events", "print_stations", "print_agents", "blocklist"];
const unscoped = () => (G.SCOPE_LOG || []).filter((q) => TENANT.includes(q.table) && !q.filters.some((f) => f.col === "restaurant_id") && !(/insert|upsert/.test(q.op) && JSON.stringify(q.patch || {}).includes("restaurant_id")));

// ── 1 · every refusal carries the words the cook reads, not only a number — P180837–P180841 ──────
{ world(); const r = await call("GET", "nope"); k("P180837", F, "an unknown read answers 404 WITH its sentence (the screen shows `error`)", st(r) === 404 && er(r) === "unknown GET endpoint", er(r)); }
{ world(); const r = await call("POST", "orders/o1/ready", { who: "admin" }); k("P180838", F, "the console writing with no restaurant chosen: 400 and the sentence that says how to fix it", st(r) === 400 && /No restaurant scope/.test(er(r)), `${st(r)} ${er(r)}`); }
{ world({ fix: { blocklist: [{ id: "bl9", restaurant_id: RID_A, device_id: "dev-a" }] } }); const r = await call("POST", "orders/o1/ready"); k("P180839", F, "a blocked device's write: 403 and 'blocked by staff' in words", st(r) === 403 && /blocked by staff/.test(er(r)), `${st(r)} ${er(r)}`); }
{ const want = [
    ["POST", "orders/zz/ready", {}, 404, /isn't on this restaurant's board/],
    ["POST", "orders/zz/unready", { dishes: [{ id: "i1", prev: "preparing" }] }, 404, /isn't on this restaurant's board/],
    ["POST", "items/zz/status", { status: "ready" }, 404, /dish isn't on this restaurant's board/],
    ["POST", "dishes/zz/sold-out", { value: true }, 404, /isn't on this restaurant's menu/],
    ["POST", "print-jobs/zz/done", { ok: true }, 404, /print job is gone/],
  ]; const bad = [];
  for (const [v, p, j, s, re] of want) { world(); const r = await call(v, p, { json: j }); if (st(r) !== s || !re.test(er(r))) bad.push(`${p} → ${st(r)} ${er(r)}`); }
  k("P180840", F, "every 'it isn't here any more' answer is a 404 WITH its own sentence (five doors)", bad.length === 0, bad.join(" | ")); }
{ const bad = [];
  world({ fix: { orders: [ord("o1", { status: "cancelled" })] } }); let r = await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i1", prev: "preparing" }] } }); if (st(r) !== 409 || !/cancelled/.test(er(r))) bad.push("unready " + st(r));
  world({ fix: { orders: [ord("o1", { status: "cancelled" })] } }); r = await call("POST", "items/i1/status", { json: { status: "ready" } }); if (st(r) !== 409 || !/cancelled/.test(er(r))) bad.push("item " + st(r));
  world({ fix: { order_items: [item("i1", "o1", { status: "served" })] } }); r = await call("POST", "items/i1/status", { json: { status: "ready" } }); if (st(r) !== 409 || !/already been served/.test(er(r))) bad.push("served " + st(r));
  k("P180841", F, "a cancelled ticket and a served dish are refused 409 WITH the sentence that says why", bad.length === 0, bad.join(" | ")); }

// ── 2 · the targeted read carries what the printer and the chime need — P180842 ───────────────────
{ world({ settings: AUTO, fix: { orders: [ord("o1", { placed_by: null, placed_by_id: null })], print_jobs: [job("j1")] } });
  const r = await call("GET", "board", { query: "?table=4&jobs=1" }); const o = (r.json.orders || [])[0] || {};
  k("P180842", F, "a ?table= read with jobs=1 hands over the AUTOMATIC job too, and marks a guest's own order guest:1 (and nothing about who punched it)",
    st(r) === 200 && (r.json.printJobs || []).some((j) => j.id === "j1") && o.guest === 1 && !("placed_by" in o) && !("placed_by_id" in o), JSON.stringify({ jobs: (r.json.printJobs || []).map((j) => j.id), o })); }

// ── 3 · the self-healing net's list — P180843 ──────────────────────────────────────────────────────
{ world({ settings: AUTO, fix: { print_jobs: [job("j1", { order_id: "o1" }), job("j2", { order_id: "o2", status: "done" })] } });
  const a = await call("GET", "board", { query: "?autojobs=1" }); const b = await call("GET", "board");
  const q = (a.json.queuedFor || []).slice().sort().join(",");
  k("P180843", F, "queuedFor names every live ticket with a job in ANY state (cooking AND new), and an old panel that does not ask is handed none",
    q === "o1,o2" && (b.json.queuedFor || []).length === 0, `${q} | old panel: ${JSON.stringify(b.json.queuedFor)}`); }

// ── 4 · issue, print/send, platform: the doors answer only their own address — P180844–P180847 ──────
{ world(); const r = await call("POST", "issue", { who: "admin", cookies: { aevidine_admin_rid: RID_A }, json: { subject: "Fridge warm" } }); const row = ((G.WRITES.find((w) => w.table === "issues") || {}).patch) || (G.FIX.issues || [])[0] || {};
  k("P180844", F, "an issue raised while the console views the kitchen screen is filed as the KITCHEN's (never a blank role) and answers { ok: true }", st(r) === 200 && r.json?.ok === true && row.raised_role === "kitchen" && row.raised_by === "Kitchen", `${st(r)} ${JSON.stringify(row).slice(0, 160)}`); }
{ world(); const a = await call("POST", "print/nope", { json: { orderId: "o1" } }); const b = await call("POST", "platform/p1/other", { json: { status: "ready" } });
  k("P180845", F, "'print/<anything but send>' and 'platform/:id/<anything but status>' are 404, never a print or a status change",
    st(a) === 404 && st(b) === 404 && !G.FIX.print_jobs.length && !G.RPCS.some((x) => x.name === "lfh_platform_set_status"), `${st(a)} ${st(b)}`); }
{ world({ settings: helper, fix: agent }); await call("POST", "print/send", { json: { aggId: "p1", reprint: false } }); const first = G.FIX.print_jobs[0] || {};
  world({ settings: helper, fix: agent }); await call("POST", "print/send", { json: { aggId: "p1" } }); const again = G.FIX.print_jobs[0] || {};
  k("P180846", F, "a delivery slip sent to the computer: reprint:false is a first print (no DUPLICATE), anything else is a duplicate, and it is requested by the cook by name",
    first.reprint === false && again.reprint === true && first.requested_by === "Cook One" && first.payload?.aggId === "p1", JSON.stringify([first.reprint, again.reprint, first.requested_by])); }
{ const bad = [];
  for (const mode of ["error", "empty"]) for (const body of [{ orderId: "o1" }, { aggId: "p1" }]) {
    world({ settings: helper, fix: agent }); G.FAIL = { "print_jobs:insert": mode }; const r = await call("POST", "print/send", { json: body });
    if (st(r) !== 500 || er(r) !== "Could not send that to the printer.") bad.push(`${mode} ${JSON.stringify(body)} → ${st(r)} ${er(r)}`);
  }
  k("P180847", F, "a print job that could not be saved says so in words (500 → the screen prints here instead), for a table AND a delivery, whether the save errored or came back empty", bad.length === 0, bad.join(" | ")); }

// ── 5 · the take-back: every rule of the rollup — P180848–P180851 ─────────────────────────────────
{ world({ fix: { order_items: [item("i1", "o1"), item("i2", "o1")] } }); const r = await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i1", prev: "ready" }] } });
  k("P180848", F, "a take-back may put a dish back to READY (it was ready before the mis-tap) — ready is one of the three statuses it restores", st(r) === 200 && r.json?.count === 1 && G.FIX.order_items.find((x) => x.id === "i1").status === "ready", `${st(r)} ${er(r)}`); }
{ world({ fix: { order_items: [item("i1", "o1", { status: "served" }), item("i2", "o1", { status: "ready" })] } }); await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i2", prev: "received" }] } });
  const o1 = G.FIX.orders.find((x) => x.id === "o1");
  world({ fix: { order_items: [item("i1", "o1", { status: "ready" }), item("i2", "o1", { status: "ready" })] } }); await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i1", prev: "received" }, { id: "i2", prev: "received" }] } });
  const o1b = G.FIX.orders.find((x) => x.id === "o1");
  k("P180849", F, "after a take-back a ticket with one dish served stays COOKING (served counts as started); one with nothing started goes back to NEW", o1.status === "preparing" && o1b.status === "received", `${o1.status} / ${o1b.status}`); }
{ world({ fix: { order_items: [item("i1", "o1", { status: "ready" }), item("i2", "o1", { status: "ready" })] } }); await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i1", prev: "preparing" }] } }); const one = (logs("order_unready")[0] || {}).detail;
  world({ fix: { order_items: [item("i1", "o1", { status: "ready" }), item("i2", "o1", { status: "ready" })] } }); await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i1", prev: "preparing" }, { id: "i2", prev: "preparing" }] } }); const two = (logs("order_unready")[0] || {}).detail;
  k("P180850", F, "the take-back's log line reads '1 dish taken back' / '2 dishes taken back'", one === "1 dish taken back" && two === "2 dishes taken back", `${one} | ${two}`); }
{ const bad = [];
  world({ fix: { order_items: [item("i1", "o1", { status: "ready" }), item("i2", "o1", { status: "ready" })] } }); G.SCOPE_LOG = [];
  await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i1", prev: "preparing" }] } }); if (unscoped().length || !G.SCOPE_LOG.some((q) => q.table === "order_items" && q.op === "update")) bad.push("scope: " + unscoped().map((q) => q.table + ":" + q.op).join(","));
  world({ fix: { order_items: [item("i1", "o1", { status: "ready" })] } }); G.FAIL = { "order_items:update": "error" }; const r = await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i1", prev: "preparing" }] } });
  if (st(r) < 500 || G.FIX.orders.find((x) => x.id === "o1").status !== "preparing" || logs("order_unready").length) bad.push("failed write → " + st(r));
  k("P180851", F, "a take-back writes only inside this restaurant (dish AND ticket), and a dish write that fails is a 5xx with no ticket rollup and no 'taken back' log", bad.length === 0, bad.join(" | ")); }

// ── 6 · one dish's status: the ticket's rollup — P180852 ───────────────────────────────────────────
{ const res = [];
  world({ fix: { order_items: [item("i1", "o1", { status: "served" }), item("i2", "o1", { status: "ready" })] } }); await call("POST", "items/i2/status", { json: { status: "received" } }); res.push(G.FIX.orders.find((x) => x.id === "o1").status);
  world({ fix: { order_items: [item("i1", "o1", { status: "ready" }), item("i2", "o1", { status: "preparing" })] } }); await call("POST", "items/i2/status", { json: { status: "received" } }); res.push(G.FIX.orders.find((x) => x.id === "o1").status);
  world({ fix: { order_items: [item("i1", "o1", { status: "received" }), item("i2", "o1", { status: "preparing" })] } }); const r = await call("POST", "items/i2/status", { json: { status: "received" } }); res.push(G.FIX.orders.find((x) => x.id === "o1").status);
  k("P180852", F, "one dish moved: a ticket with a served OR a ready dish stays cooking; with every dish back to new it is new again; the door answers { ok: true }",
    res.join(",") === "preparing,preparing,received" && r.json?.ok === true, res.join(",")); }

// ── 7 · item 16: the kitchen only moves a delivery FORWARD — P180853–P180856 ──────────────────────
const plat = (status) => ({ fix: { aggregator_orders: [{ id: "p1", restaurant_id: RID_A, source: "zomato", status, kot_no: 40, created_at: AGO(60000), items: [], status_history: [] }] } });
{ const bad = [];
  for (const to of ["accepted", "preparing", "ready", "handed_over"]) { world(plat("cancelled")); const r = await call("POST", "platform/p1/status", { json: { status: to } }); if (st(r) !== 409 || !/was cancelled/.test(er(r)) || G.RPCS.some((x) => x.name === "lfh_platform_set_status")) bad.push(`${to} → ${st(r)} ${er(r)}`); }
  k("P180853", F, "item 16 · a CANCELLED delivery is never brought back by a kitchen tap — every move is 409 'was cancelled', nothing written", bad.length === 0, bad.join(" | ")); }
{ const bad = [];
  for (const [from, to] of [["handed_over", "ready"], ["handed_over", "accepted"], ["ready", "accepted"], ["ready", "preparing"], ["preparing", "accepted"]]) {
    world(plat(from)); const r = await call("POST", "platform/p1/status", { json: { status: to } });
    if (st(r) !== 409 || !/already moved on/.test(er(r)) || G.RPCS.some((x) => x.name === "lfh_platform_set_status")) bad.push(`${from}→${to}: ${st(r)}`);
  }
  k("P180854", F, "item 16 · the kitchen never moves a delivery BACKWARDS (a late tap after the rider took it) — 409 'already moved on', nothing written", bad.length === 0, bad.join(" | ")); }
{ world(plat("ready")); const r = await call("POST", "platform/p1/status", { json: { status: "ready" } });
  world(plat("ready")); const r2 = await call("POST", "platform/p1/status", { json: { status: "handed_over" } }); const fwd = G.RPCS.filter((x) => x.name === "lfh_platform_set_status").length;
  k("P180855", F, "item 16 · the same tap arriving twice is 'done' with NO second write (no doubled history, no second push to the platform); a forward move still goes through",
    st(r) === 200 && r.json?.unchanged === true && st(r2) === 200 && fwd === 1, `${st(r)} ${JSON.stringify(r.json)} fwd=${fwd}`); }
{ world(plat("accepted")); G.FAIL = { "rpc:lfh_platform_set_status": { message: "new row violates check constraint", code: "23514" } }; const a = await call("POST", "platform/p1/status", { json: { status: "ready" } });
  world(plat("accepted")); G.FAIL = { "rpc:lfh_platform_set_status": { message: "canceling statement due to statement timeout", code: "57014" } }; const b = await call("POST", "platform/p1/status", { json: { status: "ready" } });
  k("P180856", F, "item 16 · the platform function's own refusal keeps its reason: a refused value is 4xx (told, never resent for ever), a busy database is 503 (kept and resent)",
    st(a) >= 400 && st(a) < 500 && st(b) === 503, `${st(a)} ${er(a)} | ${st(b)}`); }

// ── 8 · the printer queue's last words — P180857–P180858 ───────────────────────────────────────────
{ const bad = [];
  world({ settings: { ...AUTO, modules: { printing: { routes: { kot: { via: "screen", panel: "kitchen", person: COOK.id } } } } }, fix: { print_jobs: [job("j1")] } });
  const r = await call("POST", "print-jobs/claim", { json: { ids: ["j1"] } }); const s = (G.FIX.print_stations || []).find((x) => x.active) || {};
  if (JSON.stringify(r.json?.won) !== '["j1"]' || s.claimed_by !== "Cook One") bad.push("named cook: " + JSON.stringify(r.json) + " by " + s.claimed_by);
  world({ settings: { auto_print_kot: true, auto_print_kot_allowed: false }, fix: { print_jobs: [job("j1")] } }); const r2 = await call("POST", "print-jobs/claim", { json: { ids: ["j1"] } });
  if ((r2.json?.won || []).length) bad.push("auto not allowed still won " + JSON.stringify(r2.json));
  world({ fix: { print_jobs: [job("j1", { status: "printing" })] } }); const r3 = await call("POST", "print-jobs/j1/done", { json: { ok: true } }); if (r3.json?.ok !== true) bad.push("done ok → " + JSON.stringify(r3.json));
  world({ fix: { print_jobs: [job("j1", { status: "printing" })] } }); const r4 = await call("POST", "print-jobs/j1/done", { json: { ok: false, error: "jam" } }); if (r4.json?.ok !== true || r4.json?.attempts !== 1) bad.push("done fail → " + JSON.stringify(r4.json));
  k("P180857", F, "the claim honours a route naming THIS cook (and records them as the printer), refuses when the admin has not allowed auto-print, and both 'done' answers say { ok: true } (+ attempts)", bad.length === 0, bad.join(" | ")); }
{ const bad = [];
  world({ fix: { printer_events: [{ id: "e1", restaurant_id: RID_A, kind: "jam", status: "open", count: 1, printer: null }] } }); G.SCOPE_LOG = [];
  const r = await call("POST", "printer-events", { json: { kind: "jam" } }); if (r.json?.ok !== true || unscoped().length) bad.push("merge: " + JSON.stringify(r.json) + " " + unscoped().map((q) => q.table + ":" + q.op).join(","));
  world(); G.FAIL = { "printer_events:insert": "error" }; const r2 = await call("POST", "printer-events", { json: { kind: "jam" } }); if (st(r2) < 500 || logs("printer_problem").length) bad.push("failed insert → " + st(r2));
  world({ fix: { aggregator_orders: [{ id: "p2", restaurant_id: RID_A, source: "parcel", status: "new", kot_no: 41, created_at: AGO(60000), items: [] }] }, settings: { kitchen_can_accept_platform: true } }); G.SCOPE_LOG = [];
  const r3 = await call("POST", "platform/p2/status", { json: { status: "accepted" } }); if (st(r3) !== 200 || unscoped().length || !G.SCOPE_LOG.some((q) => q.table === "settings")) bad.push("accept: " + st(r3) + " " + unscoped().map((q) => q.table + ":" + q.op).join(","));
  k("P180858", F, "a repeat printer problem merges inside this restaurant and answers { ok: true }; one that cannot be saved is a 5xx with no 'reported' log; the accept permission is read for this restaurant", bad.length === 0, bad.join(" | ")); }

// EQUIVALENT — breaks no check can notice because nothing a person or another screen sees changes:
//   · line ~153  `<` → `<=` in the block memo's 10s window (only differs at the exact same millisecond);
//   · line ~157  `>` → `>=` before pruning the memo (500 vs 501 remembered devices — the prune is only a size bound);
//   · lines ~336-337 kitchenMayAuto — fully decided again by screenMayPrint one line later (retired as item 17);
//   · the unready rollup's "every dish served" branch — a take-back always moves a dish OFF served, so the ticket
//     can never be all-served afterwards (`served`→`servedX` there changes nothing reachable);
//   · items/status `rows.length > 0` → `>= 0` — the dish just updated is one of the rows, so there is always ≥ 1.
done("u-route3");
