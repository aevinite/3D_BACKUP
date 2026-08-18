// Block 3b — P01352..P01375. The whole journey on FRENCH HOUSE, the restaurant this sweep may
// write to. Every row created is removed by its own id in the finally, so a crash still cleans up.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync("/Users/aevinite/Documents/Projects/backup_Menu/.env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const FH = "00000000-0000-0000-0000-000000000001", BASE = "http://localhost:4103";
// PICK A TABLE THAT IS GENUINELY FREE. Ten terminals share this restaurant and a table left open by
// an earlier run sends the gate down a DIFFERENT (also correct) branch — the head's-name screen
// instead of "your table isn't open yet" — so the full staff-opens-it path never gets exercised.
// Choosing a table with no open session makes this deterministic, and it means I only ever open a
// table nobody is sitting at.
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
try {
  b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/r/french-house/menu`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(6500);

  await p.locator('button[aria-label^="Add"], .fc-plus').first().click(); await p.waitForTimeout(2500);
  t("P01352", "adding a dish opens the join-a-table gate", (await p.locator(".sg-overlay").count()) === 1);
  await p.locator(".sg-input").first().fill(TABLE);
  await p.locator(".sg-btn.gold").first().click(); await p.waitForTimeout(3800);
  const gateTitle = await p.locator(".sg-title").first().innerText();
  // Ten terminals share this restaurant. If someone else is already at this table, back out —
  // joining their party and cleaning up after would be tidying away another session's live work.
  if (/already open/i.test(gateTitle)) { console.log(`\n⏭ table ${TABLE} is another party's right now — backing out without joining it.`); await p.locator(".sg-x").click(); throw Object.assign(new Error("busy"), { benign: true }); }
  t("P01353", "a table staff have not opened says exactly that — a guest cannot open their own", /isn.t open yet/i.test(gateTitle), JSON.stringify(gateTitle));
  t("P01353b", "…and asks the guest's name so the floor knows WHO is waiting", (await p.locator('.sg-input[placeholder*="name" i]').count()) === 1);
  await p.locator('.sg-input[placeholder*="name" i]').fill("ZZ Sweep6 T3");
  await p.evaluate(() => { window.__t = []; window.addEventListener("lfh:toast", (e) => window.__t.push(e.detail)); });
  await p.locator(".sg-btn.gold", { hasText: /request/i }).first().click(); await p.waitForTimeout(3000);
  const afterReq = await p.locator(".sg-title").first().innerText();
  const reqToasts = (await p.evaluate(() => window.__t || [])).map((x) => x.message).join(" | ");
  t("P01354", "a request that LANDED reaches the reassurance screen", /let the staff know/i.test(afterReq), JSON.stringify(afterReq));
  t("P01354b", "…and nothing was raised as a failure, because it really went", !/couldn.t|isn.t answering/i.test(reqToasts), JSON.stringify(reqToasts));
  t("P01354c", "…and the auto-send promise is only made where a watcher really runs", /automatically/i.test(await p.locator(".sg-box").innerText()));

  const ins = await sb.from("sessions").insert({ restaurant_id: FH, table_number: TABLE, status: "open", auto_approve: true, opened_by: "waiter", opened_at: new Date().toISOString() }).select("id").single();
  if (ins.error || !ins.data) { console.log("could not open the table as staff:", ins.error?.message); throw Object.assign(new Error("open failed"), { benign: true }); }
  const opened = ins.data; mine.sessions.push(opened.id);
  await p.waitForTimeout(9000);
  const stored = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem("lfh_session:french-house") || "null"); } catch { return null; } });
  const myToken = stored?.token || null;
  const memberRow = myToken ? (await sb.from("session_members").select("session_id, role, name, approved").eq("token", myToken).maybeSingle()).data : null;
  t("P01355", "the moment staff open the table, the waiting guest is brought in with no further tap", !!memberRow, myToken ? `role=${memberRow?.role}` : "no token");
  t("P01355b", "…as the head of that table, under the name they gave", memberRow?.role === "owner" && /ZZ Sweep6 T3/.test(String(memberRow?.name || "")), `name=${memberRow?.name}`);
  t("P01355c", "…and it is the table staff actually opened, not a new one", memberRow?.session_id === opened.id);
  t("P01356", "the dish the gate was HOLDING all that time is added, not dropped", await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_cart:french-house") || "[]").length === 1));
  await p.waitForTimeout(2000);
  t("P01357", "the floating table card shows they are hosting the table", (await p.locator(".ssw-card, .ssw-bubble").count()) >= 1);

  await p.locator(".mini-cart").click(); await p.waitForTimeout(1400);
  t("P01358", "the bill opens", (await p.locator("#cart-panel").count()) === 1);
  t("P01359", "the table field is LOCKED to the table they are sitting at", await p.locator("#cart-table").isDisabled());
  t("P01360", "…and holds that table number", (await p.locator("#cart-table").inputValue()) === TABLE);
  t("P01361", "…and the lock is explained in plain words", /you.?re at table/i.test(await p.locator(".table-scanned-note").first().innerText()));

  await p.evaluate(() => { window.__t = []; window.addEventListener("lfh:toast", (e) => window.__t.push(e.detail)); });
  await p.locator(".btn-gold", { hasText: /place order/i }).first().click(); await p.waitForTimeout(9000);
  const myIds = await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_active_orders:french-house") || "[]").map((o) => o.id));
  const orders = myIds.length ? ((await sb.from("orders").select("id, table_number, status, total, items").in("id", myIds)).data || []) : [];
  orders.forEach((o) => mine.orders.push(o.id));
  t("P01362", "the order reaches the kitchen — exactly one, not two", myIds.length === 1 && orders.length === 1, `device recorded ${myIds.length}, server has ${orders.length}`);
  t("P01363", "the kitchen's copy carries the dish lines", (orders[0]?.items || []).length === 1);
  t("P01364", "the server priced it itself", Number(orders[0]?.total) > 0, `total=${orders[0]?.total}`);
  t("P01365", "it lands on the right table", String(orders[0]?.table_number) === TABLE);
  const said = (await p.evaluate(() => window.__t || [])).map((x) => x.message).join(" | ");
  t("P01366", "the diner is TOLD it went", /order placed/i.test(said), JSON.stringify(said.slice(0, 70)));
  t("P01367", "the basket is emptied so they cannot send it twice", await p.evaluate(() => JSON.parse(localStorage.getItem("lfh_cart:french-house") || "[]").length === 0));
  t("P01368", "the bill closes itself after sending", (await p.locator("#cart-panel").count()) === 0);

  await p.waitForTimeout(3000);
  t("P01369", "the live-status strip appears", (await p.locator(".order-tracker").count()) === 1);
  const strip = await p.locator(".order-tracker").innerText().catch(() => "");
  t("P01370", "…and names the table", new RegExp(`Table ${TABLE}`).test(strip), JSON.stringify(strip.replace(/\n/g, " ").slice(0, 60)));
  t("P01371", "the order starts life as 'received', not as already cooking", orders[0]?.status === "received", `status=${orders[0]?.status}`);
  const openLive = async (pg) => { await pg.evaluate(() => { window.dispatchEvent(new Event("lfh:open-cart")); window.dispatchEvent(new Event("lfh:show-previous-orders")); }); await pg.waitForTimeout(2000); };
  await p.locator(".order-tracker").click(); await p.waitForTimeout(1800);
  t("P01372", "tapping the strip opens the Live-status tab, not the bill", (await p.locator(".stb, .order-history").count()) >= 1);
  // The live table bill shows a SKELETON until its first fetch lands (deliberate — the empty
  // "no dishes yet" flash was the glitch it was built to stop). So wait for real content rather
  // than racing it; that the skeleton resolves within a sensible time is itself worth asserting.
  await p.locator(".stb-item").first().waitFor({ timeout: 15000 }).catch(() => {});
  const bill = await p.locator(".order-history").innerText().catch(() => "");
  t("P01373", "the shared table bill lists the dish with its kitchen status", /awaiting accept|preparing|served/i.test(bill), JSON.stringify(bill.replace(/\n/g, " ").slice(0, 80)));
  t("P01374", "…and a table total the server computed", /table total/i.test(bill));

  const upd = await sb.from("order_items").update({ status: "preparing" }).eq("order_id", orders[0].id).select("id, status");
  t("P01375", "the kitchen can move the dish to preparing", !upd.error && (upd.data || []).length >= 1, upd.error?.message || `${(upd.data || []).length} line(s)`);
  await openLive(p); await p.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await p.waitForTimeout(5000);
  const liveTxt = await p.locator(".order-history").innerText().catch(() => "");
  t("P01375b", "…and the diner's live table bill says Preparing, with no reload and no tap", /preparing/i.test(liveTxt), JSON.stringify(liveTxt.replace(/\n/g, " ").slice(0, 70)));
  t("P01375c", "…while the guest is never shown the staff-only 'ready' stage", !/\bready\b/i.test(liveTxt));
  await ctx.close();
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
  console.log(`BLOCK 3b: ${pass} passed, ${fail} failed${fails.length ? " -> " + fails.join(", ") : ""}`);
  if (b) await b.close();
  process.exit(fail ? 1 : 0);
}
