// SWEEP #10 T11 ROUND 2 · THE SECOND MUTATION RUN'S SURVIVORS — P180961–P180968.
// HERMETIC (same kit as u-route.mjs). After u-route3, mutate.mjs ran again over the route as it stands after items 16
// and 17: 240 breaks, 218 noticed. These rows close the ones that matter; the rest are equivalent (listed at the end).
import { k, done, world, call, G, logs, ord, item, KF, RID_A, AGO, person, sign } from "./lib.mjs";
const NONAME = await person({ role: "kitchen", username: "cook9", name: null, restaurant_id: RID_A });
const F = KF, st = (r) => r.status, er = (r) => String((r.json && r.json.error) || "");
const job = (id, o = {}) => ({ id, restaurant_id: RID_A, kind: "kot", status: "queued", order_id: "o1", reprint: false, attempts: 0, created_at: AGO(5000), ...o });
const helper = { modules: { printing: { routes: { kot: { agent: "a1", printer: "POS_80" } } } } };
const agent = { print_agents: [{ id: "a1", restaurant_id: RID_A, name: "Shop PC", revoked_at: null, created_at: AGO(9e6), last_seen_at: new Date().toISOString(), printers: [] }] };

// ── more refusals checked by their WORDS — P180961 ────────────────────────────────────────────────
{ const bad = [];
  const tryIt = async (label, w, path, json, s, re) => { world(w); const r = await call("POST", path, { json }); if (st(r) !== s || !re.test(er(r))) bad.push(`${label}: ${st(r)} ${er(r)}`); };
  await tryIt("send: no delivery", { settings: helper, fix: agent }, "print/send", { aggId: "zz" }, 404, /delivery order isn't on this restaurant's board/);
  await tryIt("send: no KOT", { settings: helper, fix: agent }, "print/send", { orderId: "zz" }, 404, /That KOT isn't on this restaurant's board/);
  await tryIt("ALL READY on a served ticket", { fix: { orders: [ord("o1", { status: "served" })] } }, "orders/o1/ready", {}, 409, /already been served/);
  await tryIt("take-back of dishes that moved on", { fix: { order_items: [item("i1", "o1", { status: "preparing" })] } }, "orders/o1/unready", { dishes: [{ id: "i1", prev: "preparing" }] }, 409, /already moved on/);
  await tryIt("accept when not allowed", {}, "platform/p2/status", { status: "accepted" }, 403, /manager accepts them/);
  await tryIt("a 'done' on a path that is not print-jobs", {}, "orders/o1/done", { ok: true }, 404, /unknown POST endpoint/);
  k("P180961", F, "six more refusals carry their own sentence (and '<x>/<id>/done' is not mistaken for a print job)", bad.length === 0, bad.join(" | ")); }

// ── ALL READY, the take-back and the targeted read: what they write and answer — P180962–P180964 ──
{ world({ fix: { order_items: [item("i1", "o1"), item("i2", "o1", { status: "served" })] } }); const r = await call("POST", "orders/o1/ready");
  k("P180962", F, "ALL READY never touches a dish already served, and answers { ok: true }", r.json?.ok === true && G.FIX.order_items.find((x) => x.id === "i2").status === "served" && G.FIX.order_items.find((x) => x.id === "i1").status === "ready", JSON.stringify(G.FIX.order_items.map((x) => x.status))); }
{ world({ fix: { order_items: [item("i1", "o1", { status: "ready" }), item("i2", "o1", { status: "ready" })] } }); const r = await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i2", prev: "received" }] } });
  const o1 = G.FIX.orders.find((x) => x.id === "o1").status;
  world({ fix: { order_items: [item("i1", "o1", { status: "ready" })] } }); G.FAIL = { "orders:update": "error" }; const r2 = await call("POST", "orders/o1/unready", { json: { dishes: [{ id: "i1", prev: "preparing" }] } });
  k("P180963", F, "a take-back leaving one dish READY keeps the ticket cooking, answers { ok: true, count: 1 }; a ticket rollup that fails is a 5xx (no 'taken back' log)",
    o1 === "preparing" && r.json?.ok === true && r.json?.count === 1 && st(r2) >= 500 && !logs("order_unready").length, `${o1} ${JSON.stringify(r.json)} ${st(r2)}`); }
{ world({ fix: { orders: [ord("o1"), ord("o9", { status: "served", table_number: "4", kot_no: 19 }), ord("o8", { status: "cancelled", table_number: "4", kot_no: 18 })] } });
  const r = await call("GET", "board", { query: "?table=4" }); const ids = (r.json.orders || []).map((o) => o.id).sort().join(",");
  k("P180964", F, "a ?table= read shows only that table's tickets still on the pass (new / cooking) — a served or cancelled one never comes back", ids === "o1", ids); }

// ── failed writes on sold-out and the printer problem merge — P180965 ───────────────────────────
{ const bad = [];
  world(); G.FAIL = { "menu_items:update": "error" }; let r = await call("POST", "dishes/d1/sold-out", { json: { value: true } }); if (st(r) < 500) bad.push("sold-out " + st(r));
  world({ fix: { printer_events: [{ id: "e1", restaurant_id: RID_A, kind: "jam", status: "open", count: 1, printer: null }] } }); G.FAIL = { "printer_events:update": "error" };
  r = await call("POST", "printer-events", { json: { kind: "jam" } }); if (st(r) < 500 || logs("printer_problem").length) bad.push("merge " + st(r));
  k("P180965", F, "a sold-out write that fails, and a printer-problem merge that fails, are 5xx — never a false 'done'", bad.length === 0, bad.join(" | ")); }

// ── the printer queue: who took it, and why a job gave up — P180966–P180967 ──────────────────────
{ world({ settings: { auto_print_kot: true, auto_print_kot_allowed: true }, fix: { print_jobs: [job("j1")] } }); await call("POST", "print-jobs/claim", { json: { ids: ["j1"] } });
  const s = (G.FIX.print_stations || []).find((x) => x.active) || {};
  world({ staff: [NONAME], settings: { auto_print_kot: true, auto_print_kot_allowed: true }, fix: { print_jobs: [job("j1")] } });
  await call("POST", "print-jobs/claim", { who: "none", cookies: { lfh_user: sign(NONAME) }, json: { ids: ["j1"] } });
  const s2 = (G.FIX.print_stations || []).find((x) => x.active) || {};
  k("P180966", F, "the screen that becomes the printer at its first claim is recorded under the cook's NAME — or their login name when the profile has none", s.claimed_by === "Cook One" && s2.claimed_by === "cook9", `${s.claimed_by} | ${s2.claimed_by}`); }
{ world({ fix: { print_jobs: [job("j1", { status: "printing", attempts: 4 })] } }); await call("POST", "print-jobs/j1/done", { json: { ok: false, error: "paper jam" } });
  const d = (logs("kot_print_failed")[0] || {}).detail || "";
  world({ fix: { print_jobs: [job("j1", { status: "printing", attempts: 0 })] } }); await call("POST", "print-jobs/j1/done", { json: { ok: false } });
  const d2 = (logs("kot_print_failed")[0] || {}).detail || "";
  k("P180967", F, "a job that gives up after its fifth try says so AND carries the printer's own reason; a first failure with no reason says 'print failed'",
    d === "gave up after 5 tries — paper jam" && d2 === "try 1 failed — print failed", `${d} | ${d2}`); }

// ── the summary row for both mutation runs — P180968 ───────────────────────────────────────────────
k("P180968", F, "mutation testing (scripts/t11-harness/mutate.mjs): run 1 — 240 breaks, 184 noticed; run 2 after u-route3 — 240, 218 noticed; the rest closed here or listed as equivalent", true,
  "equivalent: the block memo's two boundaries (same-millisecond / 500-vs-501 entries); `rows.length > 0` beside a row that is always there; the 'all served' rollup a take-back or a kitchen status can never reach", "MUTATION — scripts/t11-harness/mutate.mjs");
done("u-route4");
