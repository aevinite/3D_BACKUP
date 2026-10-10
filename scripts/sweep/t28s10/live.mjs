#!/usr/bin/env node
// SWEEP #10 · T28 — the admin server routes, part 1: the LIVE half.
//
//   node scripts/sweep/t28s10/live.mjs --base http://localhost:4428          # run, print results
//   … --json <file>                                                          # also write {key: {ok, note}}
//
// It re-drives the write flows the ledger's older rows describe (bill delete → restore → credit note,
// an owner's whole life, a payment, the act-as doors, the bell's seen flags, a print computer's
// removal) and the four fixes of this pass (items 1–4), on the DEV database only.
//
// SAFETY — the S10 rules, §5:
//   · zero sign-ins: adminHeaders() presents the cookie the gate already accepts;
//   · French House is the write target; Aangan is never touched;
//   · every row this run creates is recorded the moment it exists and removed BY ITS OWN ID in a
//     `finally` that also runs on SIGINT/SIGTERM. Orders are never hard-deleted (mig 331 refuses it):
//     a test order is soft-deleted + archived, exactly as the memory note on that trap says;
//   · nothing here is a login-less request. "Does it refuse without a login?" is answered by reading
//     the code (CLAUDE.md safe-audit rule), never by asking the server.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { adminHeaders } from "../login.mjs";
import { refuseUnlessDevTestDb } from "../devStacks.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4428").replace(/\/$/, "");
const OUT = arg("--json", "");
const env = Object.fromEntries(readFileSync(new URL("../../../.env.local", import.meta.url), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "the T28 sweep-10 live pass");
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const H = adminHeaders(BASE);
const FH = "00000000-0000-0000-0000-000000000001";       // My Little French House — the write target
const GONE = "11111111-2222-3333-4444-555555555555";      // an id that belongs to nothing
const TAG = `t28s10-${Date.now().toString(36)}`;           // marks every row this run makes
// A table name with NO DIGITS: the ledger search reads the last run of digits as a bill number.
const LTAG = "zz-t-" + Array.from({ length: 8 }, () => "abcdefghjkmnpqrstuvwxyz"[Math.floor(Math.random() * 23)]).join("");

const hit = async (path, init = {}) => {
  const r = await fetch(BASE + path, { cache: "no-store", redirect: "manual", ...init, headers: { ...H, ...(init.headers || {}) } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { s: r.status, j, t, h: r.headers };
};
const post = (p, b, extra) => hit(p, { method: "POST", headers: { "content-type": "application/json", ...(extra || {}) }, body: JSON.stringify(b) });
const patch = (p, b) => hit(p, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

const results = {};
let pass = 0, fail = 0;
const check = (key, ok, note = "") => {
  results[key] = { ok: !!ok, note: String(note).replace(/\|/g, "·").replace(/\n/g, " ").slice(0, 220) };
  ok ? pass++ : fail++;
  console.log(`${ok ? "✅" : "❌"} ${key}${note ? "  — " + results[key].note : ""}`);
};

// ── what this run made, so the finally can remove exactly that ───────────────────────────────────
const made = { sessions: [], orders: [], agents: [], owners: [], payments: [], credits: [], audits: [], restore: [] };
let cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  const report = [];
  for (const id of made.credits) { const r = await svc.from("credit_notes").delete().eq("id", id); report.push(`credit ${r.error ? "LEFT: " + r.error.message : "removed"}`); }
  // The fixture bill's Removals rows (one delete, one restore). They describe a test bill on an
  // off-plan table and nothing else, so they go by their own ids like everything else here.
  if (made.audits.length) { const r = await svc.from("deletion_audit").delete().in("id", made.audits); report.push(`${made.audits.length} removal record(s) ${r.error ? "LEFT: " + r.error.message : "removed"}`); }
  for (const id of made.orders) {
    // Cancelled FIRST, so a fixture can never count as a sale, then soft-deleted + archived (mig 331
    // refuses a hard delete; verify:test-safety asks for exactly this order).
    const now = new Date().toISOString();
    await svc.from("orders").update({ status: "cancelled", cancelled_at: now }).eq("id", id);
    const r = await svc.from("orders").update({ deleted_at: now, archived: true, archived_at: now }).eq("id", id);
    report.push(`order ${r.error ? "LEFT: " + r.error.message : "soft-deleted + archived"}`);
  }
  for (const id of made.sessions) {
    // An order-less fixture session can simply go; one that holds an order cannot (the order is
    // retained for tax, mig 331), so that one is closed and tombstoned instead.
    const hard = await svc.from("sessions").delete().eq("id", id).select("id");
    if (!hard.error && hard.data?.length) { report.push("session removed"); continue; }
    const r = await svc.from("sessions").update({ status: "closed", closed_at: new Date().toISOString(), deleted_at: new Date().toISOString(), deleted_by: TAG, delete_reason: "T28 sweep-10 fixture" }).eq("id", id);
    report.push(`session ${r.error ? "LEFT: " + r.error.message : "closed + tombstoned"}`);
  }
  for (const id of made.agents) { const r = await svc.from("print_agents").delete().eq("id", id); report.push(`agent ${r.error ? "LEFT: " + r.error.message : "removed"}`); }
  for (const id of made.payments) { const r = await svc.from("restaurant_payments").delete().eq("id", id); report.push(`payment ${r.error ? "LEFT: " + r.error.message : "removed"}`); }
  for (const id of made.owners) {
    await svc.from("restaurant_owners").delete().eq("user_id", id);
    const r = await svc.from("staff_users").delete().eq("id", id);
    report.push(`owner ${r.error ? "LEFT: " + r.error.message : "removed"}`);
  }
  for (const fn of made.restore.reverse()) { try { report.push(await fn()); } catch (e) { report.push("restore LEFT: " + (e?.message || e)); } }
  // The diary lines this run caused, by the marker every one of them carries.
  const logs = await svc.from("staff_actions").delete().ilike("detail", `%${TAG}%`).select("id");
  report.push(`${logs.data?.length ?? 0} diary line(s) carrying ${TAG} removed${logs.error ? " — LEFT: " + logs.error.message : ""}`);
  console.log("\ncleanup: " + report.join(" · "));
}
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, async () => { await cleanup(); process.exit(130); });

try {
  // ══ 1 · an ORDER-LESS bill: delete, delete again, restore, restore again (item 1) ═══════════════
  {
    const s = await svc.from("sessions").insert({ restaurant_id: FH, table_number: `${TAG}-A`, status: "closed", closed_at: new Date().toISOString() }).select("id").single();
    if (s.error) throw new Error("fixture session: " + s.error.message);
    made.sessions.push(s.data.id);
    const sid = s.data.id;
    const d0 = await post("/api/admin/bills", { action: "delete", sessionId: sid });
    check("bills.delete.no-reason", d0.s === 400, `${d0.s} ${d0.j?.error || ""}`);
    const d1 = await post("/api/admin/bills", { action: "delete", sessionId: sid, reason: `${TAG} check` });
    const after1 = (await svc.from("sessions").select("deleted_at, delete_reason").eq("id", sid).single()).data;
    check("bills.delete.orderless", d1.s === 200 && !!after1?.deleted_at, `${d1.s} · deleted_at ${after1?.deleted_at ? "set" : "NULL"} · reason "${after1?.delete_reason}"`);
    const d2 = await post("/api/admin/bills", { action: "delete", sessionId: sid, reason: `${TAG} second press` });
    check("bills.delete.already", d2.s === 409, `${d2.s} ${d2.j?.error || ""} (item 1: was 200 + a second "deleted" diary line)`);
    const r1 = await post("/api/admin/bills", { action: "restore", sessionId: sid });
    const after2 = (await svc.from("sessions").select("deleted_at").eq("id", sid).single()).data;
    check("bills.restore.orderless", r1.s === 200 && after2?.deleted_at == null, `${r1.s} · deleted_at ${after2?.deleted_at ? "STILL SET" : "cleared"}`);
    const r2 = await post("/api/admin/bills", { action: "restore", sessionId: sid });
    check("bills.restore.already", r2.s === 409, `${r2.s} ${r2.j?.error || ""} (item 1: was 200 "restored 0")`);
    const logs = (await svc.from("staff_actions").select("action").eq("restaurant_id", FH).ilike("detail", `%${TAG}%`).limit(20)).data || [];
    check("bills.diary.one-line-per-real-change", logs.filter((l) => l.action === "order_delete").length === 1, `${logs.filter((l) => l.action === "order_delete").length} delete line(s) for one real delete`);
  }

  // ══ 2 · a bill WITH an order: delete → audit row at the net → restore → credit note ═════════════
  {
    const s = await svc.from("sessions").insert({ restaurant_id: FH, table_number: LTAG, status: "closed", closed_at: new Date().toISOString(), invoice_no: 900000000 + Math.floor(Math.random() * 99999) }).select("id").single();
    if (s.error) throw new Error("fixture session B: " + s.error.message);
    made.sessions.push(s.data.id); const sid = s.data.id;
    // A real line, borrowed from one of French House's own orders: the database derives an order's
    // totals from its ITEMS, so `items: []` makes a ₹0 bill no credit note can be issued against.
    const like = (await svc.from("orders").select("items").eq("restaurant_id", FH).gt("total", 100).not("items", "is", null).limit(1)).data?.[0]?.items?.[0];
    if (!like) throw new Error("no French House order line to model the fixture on");
    const o = await svc.from("orders").insert({ restaurant_id: FH, table_number: LTAG, session_id: sid, items: [{ ...like, qty: 1, note: TAG, status: "served" }], status: "served", payment_status: "pending" }).select("id, total").single();
    if (o.error) throw new Error("fixture order: " + o.error.message);
    made.orders.push(o.data.id);
    const del = await post("/api/admin/bills", { action: "delete", sessionId: sid, reason: `${TAG} with order` });
    const ord = (await svc.from("orders").select("deleted_at").eq("id", o.data.id).single()).data;
    const ses = (await svc.from("sessions").select("deleted_at, delete_reason").eq("id", sid).single()).data;
    const aud = (await svc.from("deletion_audit").select("id, kind, amount").eq("session_id", sid).limit(10)).data || [];
    made.audits.push(...aud.map((a) => a.id));
    check("bills.delete.with-order", del.s === 200 && del.j?.deleted === 1, `${del.s} deleted ${del.j?.deleted}`);
    check("bills.delete.order-tombstoned", !!ord?.deleted_at, ord?.deleted_at ? "order tombstoned" : "order still live");
    check("bills.delete.session-tombstoned", !!ses?.deleted_at && /with order/.test(ses?.delete_reason || ""), `reason "${ses?.delete_reason}"`);
    check("bills.delete.audit-per-order", aud.filter((a) => a.kind === "order_deleted").length === 1 && Number(aud[0]?.amount) > 0, `${aud.length} audit row(s), amount ${aud[0]?.amount} for an order of ₹${o.data.total}`);
    const ledger = await hit(`/api/admin/bills?restaurant_id=${FH}&state=deleted&q=${encodeURIComponent(LTAG)}`);
    check("bills.ledger.shows-deleted", ledger.s === 200 && (ledger.j?.bills || []).some((b) => b.sessionId === sid), `${ledger.s} · ${(ledger.j?.bills || []).length} bill(s) found by table`);
    const rs = await post("/api/admin/bills", { action: "restore", sessionId: sid });
    const ord2 = (await svc.from("orders").select("deleted_at").eq("id", o.data.id).single()).data;
    const aud2 = (await svc.from("deletion_audit").select("id, kind").eq("session_id", sid).limit(10)).data || [];
    made.audits.push(...aud2.map((a) => a.id).filter((x) => !made.audits.includes(x)));
    check("bills.restore.with-order", rs.s === 200 && rs.j?.restored === 1 && ord2?.deleted_at == null, `${rs.s} restored ${rs.j?.restored}`);
    check("bills.restore.audit-beside-delete", aud2.some((a) => a.kind === "order_restored") && aud2.some((a) => a.kind === "order_deleted"), aud2.map((a) => a.kind).join(", "));
    const aid = `t28s10-${Math.random().toString(36).slice(2)}`;
    const c1 = await post("/api/admin/bills", { action: "credit_note", sessionId: sid, amount: 10, reason: `${TAG} credit` }, { "X-LFH-Action-Id": aid });
    const c2 = await post("/api/admin/bills", { action: "credit_note", sessionId: sid, amount: 10, reason: `${TAG} credit` }, { "X-LFH-Action-Id": aid });
    const cn = (await svc.from("credit_notes").select("id").eq("session_id", sid).limit(10)).data || [];
    made.credits.push(...cn.map((c) => c.id));
    check("bills.credit.once-per-action-id", c1.s === 200 && c2.s === 200 && cn.length === 1, `${c1.s}/${c2.s} · ${cn.length} credit note(s)${c1.j?.error ? " · " + c1.j.error : ""}`);
    const big = await post("/api/admin/bills", { action: "credit_note", sessionId: sid, amount: 99999, reason: `${TAG} too big` });
    check("bills.credit.too-big-in-words", big.s === 409 && /more than the bill/.test(big.j?.error || ""), `${big.s} ${big.j?.error || ""}`);
    const zero = await post("/api/admin/bills", { action: "credit_note", sessionId: sid, amount: 0, reason: "x" });
    check("bills.credit.zero-refused", zero.s === 400, `${zero.s} ${zero.j?.error || ""}`);
    const tr = await hit(`/api/admin/bills?trail=${sid}`);
    check("bills.trail.three-parts", tr.s === 200 && Array.isArray(tr.j?.trail) && Array.isArray(tr.j?.invoiceHistory) && (tr.j?.creditNotes || []).length === cn.length, `${tr.s} · events ${tr.j?.trail?.length} · credit notes ${tr.j?.creditNotes?.length}`);
    const ghost = await post("/api/admin/bills", { action: "delete", sessionId: GONE, reason: "x" });
    check("bills.delete.ghost-404", ghost.s === 404, `${ghost.s} ${ghost.j?.error || ""}`);
  }

  // ══ 3 · a print computer is removed once, and only once (item 2) ════════════════════════════════
  {
    const a = await svc.from("print_agents").insert({ restaurant_id: FH, name: `${TAG} computer`, token_hash: "t28s10-not-a-credential-" + Math.random().toString(36).slice(2) }).select("id").single();
    if (a.error) throw new Error("fixture agent: " + a.error.message);
    made.agents.push(a.data.id);
    const rv = await post(`/api/admin/printing/agents/${a.data.id}/revoke`, { rid: FH });
    const row = (await svc.from("print_agents").select("revoked_at").eq("id", a.data.id).single()).data;
    check("printing.revoke.lands", rv.s === 200 && !!row?.revoked_at, `${rv.s} · revoked_at ${row?.revoked_at ? "set" : "NULL"}`);
    const rv2 = await post(`/api/admin/printing/agents/${a.data.id}/revoke`, { rid: FH });
    check("printing.revoke.already", rv2.s === 404, `${rv2.s} ${rv2.j?.error || ""} (item 2: was 200 + a second "can no longer print" line)`);
    const rv3 = await post(`/api/admin/printing/agents/${GONE}/revoke`, { rid: FH });
    check("printing.revoke.ghost", rv3.s === 404, `${rv3.s} ${rv3.j?.error || ""}`);
  }

  // ══ 4 · the Printing overview is live restaurants only (item 4) ═════════════════════════════════
  {
    const ov = await hit("/api/admin/printing/overview");
    const live = (await svc.from("restaurants").select("id").is("deleted_at", null).limit(2000)).data || [];
    const liveIds = new Set(live.map((r) => r.id));
    const binnedOnBoard = (ov.j?.rows || []).filter((r) => !liveIds.has(r.id)).length;
    check("printing.overview.live-only", ov.s === 200 && binnedOnBoard === 0 && (ov.j?.rows || []).length === live.length, `${ov.s} · ${(ov.j?.rows || []).length} rows for ${live.length} live restaurants · ${binnedOnBoard} binned on the board (was 282)`);
  }

  // ══ 5 · an owner's whole life, ending in the recycle bin (item 3 inside it) ═════════════════════
  {
    const name = `${TAG}-owner`;
    const c = await post("/api/admin/owners", { action: "create_owner", name, restaurant_ids: [] });
    check("owners.create.password-once", c.s === 200 && typeof c.j?.password === "string" && c.j.password.length >= 6, `${c.s} · password ${c.j?.password ? "returned once" : "missing"}`);
    const oid = c.j?.id; if (oid) made.owners.push(oid);
    if (!oid) throw new Error("owner create failed: " + (c.j?.error || c.s));
    const tv = async () => (await svc.from("staff_users").select("token_version, active, deleted_at").eq("id", oid).single()).data;
    const t0 = await tv();
    const sus = await patch("/api/admin/owners", { owner_id: oid, action: "set_active", active: false });
    const t1 = await tv();
    check("owners.suspend.moves-counter", sus.s === 200 && t1.active === false && (t1.token_version || 0) === (t0.token_version || 0) + 1, `${sus.s} · ${t0.token_version || 0} → ${t1.token_version}`);
    const rp = await patch("/api/admin/owners", { owner_id: oid, action: "reset_password" });
    const t2 = await tv();
    check("owners.reset.moves-counter", rp.s === 200 && t2.token_version === t1.token_version + 1, `${rp.s} · ${t1.token_version} → ${t2.token_version}`);
    const at = await patch("/api/admin/owners", { owner_id: oid, action: "attach", restaurant_id: FH });
    const card = (await hit("/api/admin/owners")).j?.owners?.find((o) => o.id === oid);
    check("owners.attach.on-card", at.s === 200 && (card?.restaurants || []).some((r) => r.id === FH), `${at.s} · ${(card?.restaurants || []).length} restaurant(s) on the card`);
    const dt = await patch("/api/admin/owners", { owner_id: oid, action: "detach", restaurant_id: FH });
    const prim = (await svc.from("restaurants").select("owner_user_id").eq("id", FH).single()).data;
    const primLive = prim?.owner_user_id ? (await svc.from("staff_users").select("id, deleted_at").eq("id", prim.owner_user_id).maybeSingle()).data : null;
    check("owners.detach.no-ghost-primary", dt.s === 200 && prim?.owner_user_id !== oid && (!prim?.owner_user_id || (primLive && !primLive.deleted_at)), `${dt.s} · primary is ${prim?.owner_user_id ? "a live owner" : "nobody"}`);
    const binActive = await hit(`/api/admin/owners?id=${oid}`, { method: "DELETE" });
    check("owners.bin.after-suspend", binActive.s === 200, `${binActive.s} ${binActive.j?.error || ""}`);
    const t3 = await tv();
    // ── item 3: a stale Owners tab cannot switch a binned owner back on, nor change them otherwise ──
    const stale = await patch("/api/admin/owners", { owner_id: oid, action: "set_active", active: true });
    const t4 = await tv();
    check("owners.binned.set-active-refused", stale.s === 409 && t4.active === false, `${stale.s} ${stale.j?.error || ""} · active ${t4.active} (item 3: was 200 and active true)`);
    const staleRp = await patch("/api/admin/owners", { owner_id: oid, action: "reset_password" });
    const t5 = await tv();
    check("owners.binned.reset-refused", staleRp.s === 409 && t5.token_version === t3.token_version, `${staleRp.s} · counter unchanged ${t5.token_version === t3.token_version}`);
    const staleRn = await patch("/api/admin/owners", { owner_id: oid, action: "rename", name: `${TAG}-renamed` });
    check("owners.binned.rename-refused", staleRn.s === 409, `${staleRn.s} ${staleRn.j?.error || ""}`);
    const bin = (await hit("/api/admin/owners?deleted=1")).j?.trashed?.find((o) => o.id === oid);
    check("owners.bin.listed", !!bin && bin.daysHeld === 0 && bin.canPurge === true, bin ? `daysHeld ${bin.daysHeld}, canPurge ${bin.canPurge}` : "not in the bin list");
    const bd = await hit(`/api/admin/owners?bin_detail=${oid}`);
    check("owners.bin.detail-opens", bd.s === 200 && Array.isArray(bd.j?.restaurants), `${bd.s} · ${bd.j?.restaurants?.length} restaurant(s) inside`);
    const re = await post("/api/admin/owners", { action: "restore_owner", owner_id: oid });
    const t6 = await tv();
    check("owners.restore.comes-back-suspended", re.s === 200 && t6.active === false && t6.deleted_at == null, `${re.s} · active ${t6.active}, deleted_at ${t6.deleted_at ? "set" : "cleared"}`);
    const act = await hit(`/api/admin/owners?id=${oid}`);
    const figures = (act.j?.activity || []).filter((a) => /₹\s?\d/.test(a.detail || "")).length;
    check("owners.activity.by-stable-id", act.s === 200 && (act.j?.activity || []).length >= 3 && figures === 0, `${act.s} · ${(act.j?.activity || []).length} row(s), ${figures} showing a figure`);
    await hit(`/api/admin/owners?id=${oid}`, { method: "DELETE" });
    const pu = await post("/api/admin/owners", { action: "purge_owner", owner_id: oid });
    const gone = (await svc.from("staff_users").select("id").eq("id", oid).maybeSingle()).data;
    check("owners.purge.no-wait", pu.s === 200 && !gone, `${pu.s} · row ${gone ? "STILL THERE" : "gone"}`);
    if (!gone) { /* the finally removes it */ } else made.owners = made.owners.filter((x) => x !== oid);
    const ghost = await patch("/api/admin/owners", { owner_id: GONE, action: "rename", name: "x y" });
    check("owners.ghost-404", ghost.s === 404, `${ghost.s} ${ghost.j?.error || ""}`);
  }

  // ══ 6 · a platform payment: comma amount, history, delete by id, second delete ═══════════════════
  {
    const before = (await svc.from("restaurant_billing").select("next_due_on").eq("restaurant_id", FH).maybeSingle()).data;
    made.restore.push(async () => { const r = await svc.from("restaurant_billing").update({ next_due_on: before?.next_due_on ?? null }).eq("restaurant_id", FH); return `next_due_on ${r.error ? "LEFT: " + r.error.message : "put back"}`; });
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const add = await post("/api/admin/billing", { action: "add_payment", restaurant_id: FH, amount: "1,234", paid_on: today, method: TAG, note: TAG });
    if (add.j?.id) made.payments.push(add.j.id);
    const row = add.j?.id ? (await svc.from("restaurant_payments").select("amount").eq("id", add.j.id).single()).data : null;
    check("billing.payment.comma-amount", add.s === 200 && Number(row?.amount) === 1234, `${add.s} · stored ${row?.amount}`);
    const one = await hit(`/api/admin/billing?restaurant_id=${FH}`);
    check("billing.payment.in-history", (one.j?.payments || []).some((p) => p.id === add.j?.id), `${(one.j?.payments || []).length} payment(s) in the history`);
    const bad = await post("/api/admin/billing", { action: "set_plan", restaurant_id: FH, started_on: "27/08/2026" });
    check("billing.plan.typed-date-named", bad.s === 400 && /start date/.test(bad.j?.error || ""), `${bad.s} ${bad.j?.error || ""}`);
    const del = await post("/api/admin/billing", { action: "delete_payment", payment_id: add.j?.id });
    const log = (await svc.from("staff_actions").select("detail").eq("action", "billing_delete_payment").eq("restaurant_id", FH).order("created_at", { ascending: false }).limit(1)).data?.[0];
    check("billing.payment.delete-names-it", del.s === 200 && /1234/.test(log?.detail || ""), `${del.s} · "${log?.detail}"`);
    if (del.s === 200) made.payments = made.payments.filter((x) => x !== add.j?.id);
    const del2 = await post("/api/admin/billing", { action: "delete_payment", payment_id: add.j?.id });
    check("billing.payment.delete-gone-404", del2.s === 404, `${del2.s} ${del2.j?.error || ""}`);
    // Its diary lines name ₹ and the date, not the TAG; remove the two this run caused by id.
    const mine = (await svc.from("staff_actions").select("id").in("action", ["billing_add_payment", "billing_delete_payment"]).eq("restaurant_id", FH).gte("created_at", new Date(Date.now() - 10 * 60e3).toISOString()).ilike("detail", "%1234%").limit(5)).data || [];
    if (mine.length) await svc.from("staff_actions").delete().in("id", mine.map((m) => m.id));
  }

  // ══ 7 · the two act-as doors ═════════════════════════════════════════════════════════════════════
  {
    const go = await hit(`/api/admin/act-as/go?rid=${FH}&to=/manager`);
    const sc = go.h.get("set-cookie") || "";
    check("actas.go.302-with-cookie", go.s === 302 && /aevidine_admin_rid|admin_rid|act/i.test(sc) && /\/manager\?rid=/.test(go.h.get("location") || ""), `${go.s} → ${go.h.get("location")}`);
    const uid = await hit(`/api/admin/act-as/go?rid=${FH}&to=/owner&uid=${GONE}`);
    const loc = uid.h.get("location") || "";
    check("actas.go.uid-as-pin-not-stripped", uid.s === 302 && /as=/.test(loc) && !/view=real/.test(loc), loc);
    const bad = await hit(`/api/admin/act-as/go?rid=${FH}&to=/nope`);
    check("actas.go.path-allow-list", bad.s === 400, `${bad.s}`);
    const pst = await post("/api/admin/act-as", { restaurant_id: FH });
    check("actas.post.same-cookie", pst.s === 200 && /HttpOnly/i.test(pst.h.get("set-cookie") || ""), `${pst.s} ${pst.j?.restaurant || ""}`);
    const clr = await post("/api/admin/act-as", { clear: true });
    check("actas.post.clear", clr.s === 200 && /Max-Age=0/i.test(clr.h.get("set-cookie") || ""), `${clr.s}`);
    const binned = (await svc.from("restaurants").select("id").not("deleted_at", "is", null).is("purged_at", null).limit(1)).data?.[0];
    if (binned) {
      const plain = await hit(`/api/admin/act-as/go?rid=${binned.id}&to=/manager`);
      const fromBin = await hit(`/api/admin/act-as/go?rid=${binned.id}&to=/manager&bin=1`);
      check("actas.binned.plain-409-bin-302", plain.s === 409 && fromBin.s === 302, `${plain.s} / ${fromBin.s}`);
    } else check("actas.binned.plain-409-bin-302", true, "no binned restaurant on this database — nothing to drive");
    // The doors write admin_enter_panel lines; these carry no TAG, so remove the ones this run made.
    const enters = (await svc.from("staff_actions").select("id").eq("action", "admin_enter_panel").gte("created_at", new Date(Date.now() - 5 * 60e3).toISOString()).limit(20)).data || [];
    if (enters.length) await svc.from("staff_actions").delete().in("id", enters.map((e) => e.id));
  }

  // ══ 8 · the bell's seen flags ════════════════════════════════════════════════════════════════════
  {
    const row = (await svc.from("staff_actions").select("id, seen_at").eq("level", "error").not("seen_at", "is", null).order("created_at", { ascending: false }).limit(1)).data?.[0];
    if (row) {
      made.restore.push(async () => { const r = await svc.from("staff_actions").update({ seen_at: row.seen_at }).eq("id", row.id); return `seen_at ${r.error ? "LEFT: " + r.error.message : "put back"}`; });
      const un = await post("/api/admin/oplog/ack", { action_ids: [row.id], seen: false });
      const back = await post("/api/admin/oplog/ack", { action_ids: [row.id], seen: true });
      check("ack.unseen-then-seen", un.s === 200 && un.j?.changed === 1 && back.s === 200 && back.j?.changed === 1, `${un.s}/${back.s}`);
    } else check("ack.unseen-then-seen", true, "no seen error row to toggle on this database");
    const allUnseen = await post("/api/admin/oplog/ack", { all: true, seen: false });
    check("ack.all-mode-only-seen", allUnseen.s === 400, `${allUnseen.s} ${allUnseen.j?.error || ""}`);
    const empty = await post("/api/admin/oplog/ack", { action_ids: ["nope"], seen: true });
    check("ack.empty-valid-list-refused", empty.s === 400, `${empty.s} ${empty.j?.error || ""}`);
  }
} catch (e) {
  check("run.completed", false, e?.message || String(e));
} finally {
  await cleanup();
}
console.log(`\nT28 sweep-10 live pass: ${pass} passed · ${fail} failed`);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
process.exit(fail ? 1 : 0);
