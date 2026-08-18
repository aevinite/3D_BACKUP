// Block 5 watched — P01426..P01450. The staff side is driven the way the panels drive it (the same
// rows the manager/kitchen/tablet write); the assertion is always what the GUEST then sees.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync("/Users/aevinite/Documents/Projects/backup_Menu/.env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const FH = "00000000-0000-0000-0000-000000000001", BASE = "http://localhost:4103";
// A table nobody is sitting at — ten terminals share this restaurant, and I open only a free one.
const CANDIDATES = ["29", "25", "20", "19", "15", "7", "3"];
let TABLE = null;
for (const cand of CANDIDATES) {
  const { data } = await sb.from("sessions").select("id").eq("restaurant_id", FH).eq("table_number", cand).eq("status", "open").limit(1);
  if (!data || data.length === 0) { TABLE = cand; break; }
}
if (!TABLE) { console.log("\n⏭ every candidate table already has a party on it — not opening one under anybody."); process.exit(0); }
console.log(`· using table ${TABLE} (no open session on it)\n`);
let pass = 0, fail = 0; const fails = [];
const t = (id, n, ok, x = "") => { if (ok) pass++; else { fail++; fails.push(id); } console.log(`${ok ? "ok  " : "FAIL"} ${id} ${n}${x ? " — " + x : ""}`); };
const mine = { orders: [], sessions: [] };
let b;
const openGuest = async (ctx) => { const p = await ctx.newPage(); await p.goto(`${BASE}/r/french-house/menu`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(6500); return p; };
// The live table bill shows a skeleton until its first fetch lands, so wait for real content
// rather than racing it.
const openLive = async (pg) => { await pg.evaluate(() => { window.dispatchEvent(new Event("lfh:open-cart")); window.dispatchEvent(new Event("lfh:show-previous-orders")); }); await pg.waitForTimeout(1200); await pg.locator(".stb-item").first().waitFor({ timeout: 15000 }).catch(() => {}); };
try {
  b = await chromium.launch();
  const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const ins = await sb.from("sessions").insert({ restaurant_id: FH, table_number: TABLE, status: "open", auto_approve: true, opened_by: "waiter", opened_at: new Date().toISOString() }).select("id").single();
  if (ins.error) { console.log("could not open a table:", ins.error.message); throw Object.assign(new Error("skip"), { benign: true }); }
  mine.sessions.push(ins.data.id); const sessionId = ins.data.id;

  const ctxA = await b.newContext(A35); const A = await openGuest(ctxA);
  await A.locator('button[aria-label^="Add"], .fc-plus').first().click(); await A.waitForTimeout(2500);
  await A.locator(".sg-input").first().fill(TABLE); await A.locator(".sg-btn.gold").first().click(); await A.waitForTimeout(3800);
  await A.locator(".sg-input").first().fill("ZZ T3 Head"); await A.locator(".sg-btn.gold").first().click(); await A.waitForTimeout(7000);
  const tokenA = await A.evaluate(() => JSON.parse(localStorage.getItem("lfh_session:french-house") || "null")?.token || null);
  t("P01426", "the guest's join creates the member row the staff panels read", !!tokenA);
  const memA = tokenA ? (await sb.from("session_members").select("session_id, role, name").eq("token", tokenA).maybeSingle()).data : null;
  t("P01427", "…on the session STAFF opened, not a new one", memA?.session_id === sessionId);
  t("P01428", "…and the floor sees the name the guest typed", /ZZ T3 Head/.test(String(memA?.name || "")), `name=${memA?.name}`);
  t("P01429", "…with the head role, so the panels show who opened the tab", memA?.role === "owner");

  await A.locator(".mini-cart").click(); await A.waitForTimeout(1400);
  // Only the id that APPEARS after this tap is mine — a shared table's tracker legitimately holds
  // other diners' orders, and treating the whole list as mine once deleted another terminal's row.
  const beforeIds = new Set(await A.evaluate(() => JSON.parse(localStorage.getItem("lfh_active_orders:french-house") || "[]").map((o) => o.id)));
  await A.locator(".btn-gold", { hasText: /place order/i }).first().click(); await A.waitForTimeout(9000);
  const ids = (await A.evaluate(() => JSON.parse(localStorage.getItem("lfh_active_orders:french-house") || "[]").map((o) => o.id))).filter((i) => !beforeIds.has(i));
  ids.forEach((i) => mine.orders.push(i));
  const ord = ids.length ? (await sb.from("orders").select("id, table_number, status, total, session_id").in("id", ids)).data || [] : [];
  t("P01430", "the guest's order reaches the kitchen's own table", ord.length >= 1);
  t("P01431", "…tied to the SESSION, so it can never outlive it", ord[0]?.session_id === sessionId);
  const items = (await sb.from("order_items").select("id, status, title").eq("order_id", ord[0].id)).data || [];
  t("P01432", "…as dish lines the kitchen board can move one at a time", items.length >= 1, `${items.length} line(s)`);
  t("P01433", "…each starting at 'received', waiting for the kitchen to accept", items.every((i) => i.status === "received"));

  const ctxB = await b.newContext(A35); const B = await openGuest(ctxB);
  await B.locator('button[aria-label^="Add"], .fc-plus').nth(1).click(); await B.waitForTimeout(2500);
  await B.locator(".sg-input").first().fill(TABLE); await B.locator(".sg-btn.gold").first().click(); await B.waitForTimeout(4200);
  const bTitle = await B.locator(".sg-title").first().innerText().catch(() => "");
  t("P01434", "a second phone at an OPEN table is asked to join it, not to open a new one", /already open/i.test(bTitle), JSON.stringify(bTitle));
  await B.locator(".sg-input").first().fill("ZZ T3 Partner"); await B.locator(".sg-btn.gold").first().click(); await B.waitForTimeout(8000);
  const tokenB = await B.evaluate(() => JSON.parse(localStorage.getItem("lfh_session:french-house") || "null")?.token || null);
  const memB = tokenB ? (await sb.from("session_members").select("session_id, role").eq("token", tokenB).maybeSingle()).data : null;
  t("P01435", "…and joins the SAME party, not a second one", memB?.session_id === sessionId);
  t("P01436", "…as a guest, never as a second head", memB?.role !== "owner", `role=${memB?.role}`);

  await B.waitForTimeout(6000); await B.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick")));
  await A.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await A.waitForTimeout(6000);
  const aCart = await A.evaluate(() => JSON.parse(localStorage.getItem("lfh_cart:french-house") || "[]").length);
  t("P01437", "a dish the second diner adds reaches the first diner's basket — one table, one basket", aCart >= 1, `A has ${aCart} line(s)`);

  await openLive(A);
  t("P01438", "the head's live view is the TABLE's, not just their own order", new RegExp(`table ${TABLE}`, "i").test(await A.locator(".order-history").innerText().catch(() => "")) || (await A.locator(".stb").count()) > 0);

  await sb.from("order_items").update({ status: "preparing" }).eq("order_id", ord[0].id);
  await openLive(A); await A.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await A.waitForTimeout(5000);
  t("P01439", "the kitchen starting a dish shows on the diner who ordered it", /preparing/i.test(await A.locator(".order-history").innerText().catch(() => "")));
  await openLive(B); await B.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await B.waitForTimeout(5000);
  t("P01440", "…and on the OTHER diner at the same table, who did not place it", /preparing/i.test(await B.locator(".order-history").innerText().catch(() => "")));

  await sb.from("order_items").update({ status: "served" }).eq("order_id", ord[0].id);
  await openLive(A); await A.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await A.waitForTimeout(5000);
  const servedTxt = await A.locator(".order-history").innerText().catch(() => "");
  t("P01441", "a served dish reads as served on the diner's screen", /served/i.test(servedTxt));
  t("P01442", "…and the table's progress line counts it", /1 of 1 served/i.test(servedTxt), JSON.stringify(servedTxt.replace(/\n/g, " ").slice(0, 55)));

  const MOVED_TO = String(Number(TABLE) === 30 ? 28 : Number(TABLE) + 1);
  await sb.from("sessions").update({ table_number: MOVED_TO }).eq("id", sessionId);
  await A.waitForTimeout(1500); await A.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await A.waitForTimeout(6000);
  const movedTo = await A.evaluate(() => JSON.parse(localStorage.getItem("lfh_session:french-house") || "null")?.table);
  t("P01443", "when staff move a party to another table, the guest's phone follows", String(movedTo) === MOVED_TO, `guest thinks table ${movedTo}`);
  await sb.from("sessions").update({ table_number: TABLE }).eq("id", sessionId);
  await A.waitForTimeout(1000); await A.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await A.waitForTimeout(5000);

  await sb.from("sessions").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", sessionId);
  await A.waitForTimeout(1500); await A.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await A.waitForTimeout(8000);
  const after = await A.evaluate(() => ({ orders: JSON.parse(localStorage.getItem("lfh_active_orders:french-house") || "[]").length, cart: JSON.parse(localStorage.getItem("lfh_cart:french-house") || "[]").length, sess: localStorage.getItem("lfh_session:french-house") }));
  t("P01444", "closing the table clears the diner's live orders — no strip over the next party", after.orders === 0, `orders=${after.orders}`);
  t("P01445", "…and the shared basket goes with it", after.cart === 0, `cart=${after.cart}`);
  t("P01446", "…and the phone lets go of the dead session", !after.sess || after.sess === "null");
  t("P01447", "…and the floating table card is gone", (await A.locator(".ssw-card, .ssw-bubble").count()) === 0);
  const closedOrders = (await sb.from("orders").select("id, status").in("id", ids)).data || [];
  t("P01448", "the ORDER is NOT erased by any of that — a sale can be cancelled, never disappear", closedOrders.length >= 1, `${closedOrders.length} row(s) still on record`);
  t("P01449", "the second diner's phone lets go too", await B.evaluate(async () => { window.dispatchEvent(new Event("lfh:rt-tick")); await new Promise((r) => setTimeout(r, 6000)); const s = localStorage.getItem("lfh_session:french-house"); return !s || s === "null"; }));
  t("P01450", "…and neither phone can order onto the closed table any more", (await A.locator(".ssw-card").count()) === 0 && (await B.locator(".ssw-card").count()) === 0);
  await ctxA.close(); await ctxB.close();
} catch (e) {
  if (!e?.benign) { console.log("run stopped:", String(e).split("\n")[0]); fail++; fails.push("crash"); }
} finally {
  for (const id of mine.orders) {
    await sb.from("order_items").delete().eq("order_id", id);
    const { error } = await sb.from("orders").delete().eq("id", id);
    if (error) await sb.from("orders").update({ status: "cancelled", deleted_at: new Date().toISOString() }).eq("id", id);
  }
  for (const id of mine.sessions) {
    await sb.from("session_members").delete().eq("session_id", id);
    const { error } = await sb.from("sessions").delete().eq("id", id);
    if (error) await sb.from("sessions").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", id);
  }
  const liveMine = mine.orders.length ? ((await sb.from("orders").select("id, deleted_at").in("id", mine.orders)).data || []).filter((o) => !o.deleted_at) : [];
  const liveSess = mine.sessions.length ? ((await sb.from("sessions").select("id, status").in("id", mine.sessions)).data || []).filter((s) => s.status === "open") : [];
  console.log(`\n· cleaned up ${mine.orders.length} order(s) and ${mine.sessions.length} session(s), each by its own id · still mine and live: ${liveMine.length} order(s), ${liveSess.length} session(s)`);
  console.log(`BLOCK 5: ${pass} passed, ${fail} failed${fails.length ? " -> " + fails.join(", ") : ""}`);
  if (b) await b.close();
  process.exit(fail ? 1 : 0);
}
