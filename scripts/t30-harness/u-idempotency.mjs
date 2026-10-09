// lib/idempotency.ts — withIdempotency, every branch, against the in-memory claims table.
import { suite, quiet, req } from "./lib.mjs";
import { W, world } from "./sb.mjs";
const t = suite("lib/idempotency.ts", 168461, 60);
const I = await import("@/lib/idempotency.ts");
let calls = 0;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const make = (fn) => I.withIdempotency(async (rq, ctx) => { calls++; return fn(rq, ctx); }, "editor");
const H = (id, cookies) => req(id ? { "x-lfh-action-id": id } : {}, cookies || { lfh_user: "session-1" });
const run = async (h, fn) => { calls = 0; const r = await quiet(() => make(fn)(h, {})); let j = null; try { j = await r.clone().json(); } catch {} return { r, j, calls }; };
world({ action_idempotency: [] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ const x = await run(H(null), () => json({ ok: true, order_id: "o1" }));
  t("no action id → the handler runs and nothing is claimed", x.calls === 1 && x.j.order_id === "o1" && (W.FIX.action_idempotency || []).length === 0); }
{ const x = await run(H("A1"), () => json({ ok: true, order_id: "o1", password: "pw" }));
  const row = W.FIX.action_idempotency.find((r) => r.action_id === "A1");
  t("a fresh action id → the handler runs once and its FULL reply reaches the caller", x.calls === 1 && x.j.order_id === "o1" && x.j.password === "pw");
  t("…the claim is stored done, with the panel", row && row.done === true && row.panel === "editor");
  t("…the kept copy has no password and carries the caller stamp (item 7 + item 11)", row && !("password" in row.result) && row.result.order_id === "o1" && typeof row.result.__by === "string" && row.result.__by.length === 32); }
{ const x = await run(H("A1"), () => json({ ok: true, order_id: "SHOULD-NOT-RUN" }));
  t("the same id again from the same person → the handler does NOT run; ok + duplicate + the original order id", x.calls === 0 && x.j.ok === true && x.j.duplicate === true && x.j.order_id === "o1");
  t("…and the duplicate carries neither the password nor the stamp", !("password" in x.j) && !("__by" in x.j)); }
{ const x = await run(H("A1", { lfh_user: "someone-else" }), () => json({ ok: true }));
  t("the same id from a DIFFERENT signed-in person → not run again, told it is done, but given none of the reply (item 11)", x.calls === 0 && x.j.duplicate === true && !("order_id" in x.j)); }
{ const x = await run(H("A1", { lfh_staff_auth: "admin-cookie" }), () => json({ ok: true }));
  t("…the same for the admin's cookie (a different caller)", x.calls === 0 && !("order_id" in x.j)); }
world({ action_idempotency: [{ action_id: "G1", panel: "guest", done: true, result: { ok: true, order_id: "g-1" }, created_at: new Date().toISOString() }] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ const x = await run(H("G1", {}), () => json({})); t("a row stored before the stamp existed still echoes its order id", x.calls === 0 && x.j.order_id === "g-1"); }
world({ action_idempotency: [{ action_id: "OLD", panel: "admin", done: true, result: { ok: true, password: "plain" }, created_at: new Date().toISOString() }] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ const x = await run(H("OLD"), () => json({})); t("an OLD stored reply that still holds a password never hands it back", x.calls === 0 && !("password" in x.j)); }
world({ action_idempotency: [{ action_id: "P1", panel: "editor", done: false, result: null, created_at: new Date().toISOString() }] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ const x = await run(H("P1"), () => json({ ok: true })); t("a claim still being processed → 409 sync_in_progress, retry:true, handler not run", x.calls === 0 && x.r.status === 409 && x.j.error === "sync_in_progress" && x.j.retry === true); }
world({ action_idempotency: [{ action_id: "S1", panel: "editor", done: false, result: null, created_at: new Date(Date.now() - 60000).toISOString() }] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ const x = await run(H("S1"), () => json({ ok: true, n: 1 })); t("a claim older than 30 s (a crashed attempt) is taken over and the handler runs", x.calls === 1 && x.j.n === 1 && W.FIX.action_idempotency[0].done === true); }
world({ action_idempotency: [{ action_id: "R1", panel: "guest", done: true, result: { ok: false, reason: "sold_out" }, created_at: new Date().toISOString() }] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ const x = await run(H("R1"), () => json({ ok: true, order_id: "now" })); t("a refusal that was wrongly stored as done heals: the handler runs again", x.calls === 1 && x.j.order_id === "now"); }
world({ action_idempotency: [] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ const x = await run(H("F4"), () => json({ error: "nope" }, 400)); t("a 4xx reply releases the claim (the next try genuinely retries)", x.calls === 1 && x.r.status === 400 && !W.FIX.action_idempotency.some((r) => r.action_id === "F4")); }
{ const x = await run(H("F5"), () => json({ ok: false, reason: "rate_limited" })); t("a 200 carrying ok:false releases the claim", x.calls === 1 && !W.FIX.action_idempotency.some((r) => r.action_id === "F5")); }
{ let threw = false; try { await quiet(() => make(() => { throw new Error("boom"); })(H("F6"), {})); } catch { threw = true; }
  t("a handler that throws: the claim is released and the error goes on up", threw && !W.FIX.action_idempotency.some((r) => r.action_id === "F6")); }
{ const x = await run(H("F7"), () => new Response("plain text", { status: 200 })); const row = W.FIX.action_idempotency.find((r) => r.action_id === "F7");
  t("a non-JSON success is remembered with only the caller stamp (nothing to echo)", x.calls === 1 && row && row.done === true && Object.keys(row.result).join() === "__by"); }
{ const x = await run(H("F7"), () => json({})); t("…and its duplicate is a plain ok + duplicate", x.calls === 0 && JSON.stringify(x.j) === '{"ok":true,"duplicate":true}'); }
{ const x = await run(H("F8"), () => json({ ok: true })); const body = await x.r.text(); t("the response the caller gets is still readable (the wrapper cloned it)", body === '{"ok":true}'); }
world({ action_idempotency: [] }); W.FAIL["action_idempotency:insert"] = { code: "42P01", message: "relation does not exist" };
{ const x = await run(H("X1"), () => json({ ok: true })); t("the claims table missing (any other error) → fails OPEN: the handler runs", x.calls === 1); }
world({ action_idempotency: [] }); W.FAIL["action_idempotency:insert"] = "throw";
{ const x = await run(H("X2"), () => json({ ok: true })); t("the claims table unreachable (throws) → fails OPEN: the handler runs", x.calls === 1); }
world({ action_idempotency: [{ action_id: "X3", done: true, result: {} }] }); W.UNIQUE = { action_idempotency: ["action_id"] }; W.FAIL["action_idempotency:select"] = { message: "down" };
{ const x = await run(H("X3"), () => json({ ok: true })); t("a duplicate whose claim row cannot be read back → fails open (runs)", x.calls === 1); }
world({ action_idempotency: [] }); W.FAIL["action_idempotency:update"] = "throw";
{ const x = await run(H("X4"), () => json({ ok: true, v: 2 })); t("if marking the claim done throws, the caller still gets the handler's answer", x.calls === 1 && x.j.v === 2); }
{ const sb = (await import("./sb.mjs")).supabaseAdmin; const real = Math.random; Math.random = () => 0; world({ action_idempotency: [] });
  await run(H("PR1"), () => json({ ok: true })); Math.random = real; await new Promise((r) => setTimeout(r, 5));
  t("one write in two hundred runs the bounded prune (lfh_prune_action_idempotency, no arguments)", W.RPCS.some((c) => c.name === "lfh_prune_action_idempotency")); void sb; }
{ const real = Math.random; Math.random = () => 0.5; world({ action_idempotency: [] }); await run(H("PR2"), () => json({ ok: true })); Math.random = real;
  t("…and the other 199 do not", !W.RPCS.some((c) => c.name === "lfh_prune_action_idempotency")); }
{ const real = Math.random; Math.random = () => 0; world({ action_idempotency: [] }); W.FAIL["rpc:lfh_prune_action_idempotency"] = "throw";
  const x = await run(H("PR3"), () => json({ ok: true, v: 3 })); Math.random = real; await new Promise((r) => setTimeout(r, 5));
  t("a prune that fails can never affect the write", x.calls === 1 && x.j.v === 3); }
world({ action_idempotency: [{ action_id: "NR", panel: "editor", done: true, created_at: new Date().toISOString() }] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ const x = await run(H("NR"), () => json({ ok: true })); t("a completed claim with no stored reply at all → ok + duplicate, handler not run", x.calls === 0 && JSON.stringify(x.j) === '{"ok":true,"duplicate":true}'); }
// round-2 mutation survivors, closed
world({ action_idempotency: [] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ await run(H("AD1", { lfh_staff_auth: "admin-one" }), () => json({ ok: true, secret_plan: "x", n: 1 }));
  const x = await run(H("AD1", { lfh_staff_auth: "admin-two" }), () => json({}));
  t("the stamp tells two different ADMIN sign-ins apart (admin-two gets no copy of admin-one's reply)", x.calls === 0 && !("n" in x.j)); }
world({ action_idempotency: [{ action_id: "HL", panel: "guest", done: true, result: { ok: false, reason: "sold_out" }, created_at: new Date().toISOString() }] }); W.UNIQUE = { action_idempotency: ["action_id"] };
{ W.WRITES.length = 0; await run(H("HL", {}), () => json({ ok: true }));
  const heal = W.WRITES.find((w) => w.table === "action_idempotency" && w.op === "update");
  t("healing a stored refusal re-opens the claim as IN PROGRESS (done:false), so a concurrent duplicate waits instead of echoing nothing", heal && heal.patch.done === false && heal.patch.result === null); }
{ const now = Date.parse("2026-10-09T12:00:00.000Z"); const realNow = Date.now; Date.now = () => now;
  try {
    world({ action_idempotency: [{ action_id: "T30", panel: "editor", done: false, result: null, created_at: new Date(now - 30000).toISOString() }] }); W.UNIQUE = { action_idempotency: ["action_id"] };
    const a = await run(H("T30"), () => json({ ok: true }));
    t("a claim EXACTLY 30 s old is still 'in progress' (409) — only OLDER than 30 s is taken over", a.calls === 0 && a.r.status === 409);
    world({ action_idempotency: [{ action_id: "T31", panel: "editor", done: false, result: null, created_at: new Date(now - 30001).toISOString() }] }); W.UNIQUE = { action_idempotency: ["action_id"] };
    const b = await run(H("T31"), () => json({ ok: true }));
    t("…30.001 s old is taken over and run", b.calls === 1);
  } finally { Date.now = realNow; } }
world({ action_idempotency: [{ action_id: "ND", done: true, result: {} }] }); W.UNIQUE = { action_idempotency: ["action_id"] }; W.FAIL["action_idempotency:select"] = "nodata";
{ const x = await run(H("ND"), () => json({ ok: true, v: 9 })); t("a duplicate whose claim row comes back EMPTY (no error) → fails open, the handler runs", x.calls === 1 && x.j.v === 9); }
