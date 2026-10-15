// Round 3 · L2–L6 — the live behaviour checks (see ./live.mjs for the plan and how to start the app).
import { readFileSync } from "node:fs";
import { check } from "./h.mjs";
import { BASE, PROXY, FH_PATH, page, open, addTwo } from "./livelib.mjs";

const FH = "00000000-0000-0000-0000-000000000001";
const env = readFileSync(new URL("../../../../.env.local", import.meta.url), "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1].trim().replace(/^["']|["']$/g, "");
const SB = g("NEXT_PUBLIC_SUPABASE_URL"), SRK = g("SUPABASE_SERVICE_ROLE_KEY");
if (new URL(SB).hostname.split(".")[0] !== "wnsfcizclkbobwzcxqsf") throw new Error("live2: not the dev database");
const rest = async (path, opts = {}) => { const r = await fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) } }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const fault = (f) => fetch(PROXY + "/__fault", { method: "POST", body: JSON.stringify(f) });
const clearFaults = () => fetch(PROXY + "/__clear");
const toasts = async (p) => p.evaluate(() => (window.__t3toasts || []).map((t) => `${t.message || ""} | ${t.subtitle || ""}`));
const watchToasts = (p) => p.addInitScript(() => { window.__t3toasts = []; window.addEventListener("lfh:toast", (e) => window.__t3toasts.push(e.detail || {})); });
const SETTINGS_FAIL = (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }) });

// ── L2 · popups close the way a phone closes them ──────────────────────────────────────────────────
check("R3-L201", "L2", "the phone's BACK button closes the bell popup, the dish popup, the bill and the saved list — and leaves the diner on the menu", async () => {
  const { ctx, p } = await page(); const out = [];
  try {
    await open(p);
    for (const [name, openIt, sel] of [
      ["bell", () => p.locator(".chef-call").evaluate((el) => el.click()), "#chef-popup"],
      ["dish popup", () => p.evaluate(() => window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", { detail: { item: { id: "probe", title: "Tea", price: "1", image: "" }, options: [], allergens: [] } }))), ".order-confirm"],
      ["bill", () => p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))), "#cart-panel.open, #cart-panel"],
    ]) {
      await openIt(); await p.waitForTimeout(900); const was = await p.locator(sel).count();
      await p.goBack(); await p.waitForTimeout(900);
      const gone = name === "bill" ? !(await p.locator("#cart-panel.open").count()) : (await p.locator(sel).count()) === 0;
      out.push(was && gone && p.url().includes(FH_PATH) ? "·" : `✗ ${name}`);
    }
  } finally { await ctx.close(); }
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-L202", "L2", "Escape closes the bell popup and the dish popup on a laptop", async () => {
  const { ctx, p } = await page({ w: 1280, h: 800, touch: false }); const out = [];
  try {
    await open(p);
    await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(700); await p.keyboard.press("Escape"); await p.waitForTimeout(500);
    out.push((await p.locator("#chef-popup").count()) === 0 ? "·" : "✗ bell");
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", { detail: { item: { id: "probe", title: "Tea", price: "1", image: "" }, options: [], allergens: [] } }))); await p.waitForTimeout(700);
    await p.keyboard.press("Escape"); await p.waitForTimeout(500); out.push((await p.locator(".order-confirm").count()) === 0 ? "·" : "✗ dish popup");
  } finally { await ctx.close(); }
  return { ok: out.every((x) => x === "·"), note: out.join("") };
});
check("R3-L203", "L2", "the score pill follows every pick and starts at 0 (item 26)", async () => {
  const { ctx, p } = await page({ seed: false }); const seen = [];
  try {
    await open(p, "/r/french-house/item/espresso?cat=coffee"); await p.locator(".review-tab-btn").first().click(); await p.waitForTimeout(800);
    seen.push(await p.locator(".sr-score-num").innerText());
    for (const n of [4, 2, 5]) { await p.locator(".sr-toggle").nth(n - 1).click(); await p.waitForTimeout(1400); seen.push(await p.locator(".sr-score-num").innerText()); }
  } finally { await ctx.close(); }
  return { ok: seen.join(",") === "0,4,2,5", note: seen.join(" → ") };
});

// ── L3 · item 29: a table that does not exist cannot call ──────────────────────────────────────────
check("R3-L301", "L3", "with the phone unable to read the floor plan, the DATABASE refuses table 45 and the popup shows its sentence, staying open (item 29, migration 423)", async () => {
  const { ctx, p } = await page({ seed: false });
  try {
    await watchToasts(p); await p.route("**/rest/v1/rpc/lfh_guest_settings*", SETTINGS_FAIL);
    await open(p);
    await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(900);
    await p.locator("#chef-table").fill("45"); await p.locator(".chef-reason").first().click(); await p.waitForTimeout(3000);
    const t = await toasts(p); const stillOpen = (await p.locator("#chef-popup").count()) === 1;
    const rows = await rest(`waiter_calls?restaurant_id=eq.${FH}&table_number=eq.45&select=id`);
    return { ok: t.some((x) => /Table 45 doesn't exist — tables are 1–30/.test(x)) && stillOpen && Array.isArray(rows) && rows.length === 0, note: `${t.slice(-1)[0] || "no toast"} · open ${stillOpen} · ${rows.length} call rows` };
  } finally { await ctx.close(); }
});
check("R3-L302", "L3", "…and when the phone CAN read the floor plan, it says so itself before asking anyone (\"we have tables 1–30\")", async () => {
  const { ctx, p } = await page({ seed: false });
  try {
    await watchToasts(p); await open(p);
    await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(1500);
    await p.locator("#chef-table").fill("45"); await p.locator(".chef-reason").first().click(); await p.waitForTimeout(1200);
    const t = await toasts(p); return { ok: t.some((x) => /we have tables 1–30/.test(x)), note: t.slice(-1)[0] || "no toast" };
  } finally { await ctx.close(); }
});

// ── L4 · item 31: a tax rate nobody read is not a tax rate ─────────────────────────────────────────
check("R3-L401", "L4", "the bill with the settings read failing shows \"Total ₹… + any tax\" and why — no GST line, no guessed total (item 31)", async () => {
  const { ctx, p } = await page({ seed: false });
  try {
    await p.route("**/rest/v1/rpc/lfh_guest_settings*", SETTINGS_FAIL); await open(p); await addTwo(p);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1500);
    const rows = await p.locator(".bill-line").allInnerTexts();
    const anyTax = rows.some((r) => /\+ any tax/.test(r)), why = rows.some((r) => /couldn.t load this restaurant.s tax/.test(r)), gst = rows.some((r) => /^GST/.test(r));
    return { ok: anyTax && why && !gst, note: rows.join(" | ").replace(/\s+/g, " ").slice(0, 160) };
  } finally { await ctx.close(); }
});
check("R3-L402", "L4", "…and the moment the restaurant answers (the next realtime nudge), the real GST and total appear", async () => {
  const { ctx, p } = await page({ seed: false });
  try {
    let failing = true; await p.route("**/rest/v1/rpc/lfh_guest_settings*", (r) => (failing ? SETTINGS_FAIL(r) : r.continue()));
    await open(p); await addTwo(p); await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1200);
    failing = false; await p.waitForTimeout(8500);   // the 8 s settings copy is never a failure, so the next ask really asks
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:rt-tick"))); await p.waitForTimeout(1800);
    const rows = await p.locator(".bill-line").allInnerTexts(); const money = (s) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
    const val = (re) => money((rows.find((r) => re.test(r)) || "").split(/\s/).pop());
    const sub = val(/^Subtotal/), gst = val(/^GST/), total = val(/^Total/);
    return { ok: gst > 0 && sub + gst === total && !rows.some((r) => /any tax/.test(r)), note: `${sub} + ${gst} = ${total}` };
  } finally { await ctx.close(); }
});
check("R3-L403", "L4", "…and an order saved while the tax was unknown shows NO price on the saved list (never a guessed one)", async () => {
  const { ctx, p } = await page({ seed: false });
  try {
    await p.route("**/rest/v1/rpc/lfh_guest_settings*", SETTINGS_FAIL); await open(p); await addTwo(p);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1000);
    await p.locator("#cart-table").fill("4"); await ctx.setOffline(true); await p.locator(".cart-foot .btn-gold").click(); await p.waitForTimeout(1500);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all"))); await p.waitForTimeout(500); await p.locator(".gob-chip").click(); await p.waitForTimeout(800);
    const sheet = await p.locator(".gob-sheet").innerText();
    await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("lfh_guest_outbox"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
    return { ok: /Waiting to send/.test(sheet) && !/₹/.test(sheet), note: sheet.replace(/\s+/g, " ").slice(0, 120) };
  } finally { await ctx.close(); }
});
check("R3-L404", "L4", "a SERVER-side settings failure: the menu's error screen tries again by itself and the menu comes back (item 31)", async () => {
  await clearFaults(); await new Promise((r) => setTimeout(r, 9000));   // the server's 8 s settings copy must expire
  await fault({ match: "rpc/lfh_guest_settings", side: "server", mode: "57014", times: 2 });
  const { ctx, p } = await page({ seed: false });
  try {
    await p.goto(BASE + FH_PATH, { waitUntil: "domcontentloaded" }).catch(() => {});
    let sawError = false, menu = false;
    for (let i = 0; i < 60 && !menu; i++) { const s = await p.evaluate(() => ({ e: /couldn.t load this just now/i.test(document.body.innerText), m: !!document.querySelector('button[aria-label^="Add"]') })).catch(() => ({})); sawError ||= !!s.e; menu = !!s.m; if (!menu) await p.waitForTimeout(500); }
    return { ok: sawError && menu, note: `error screen ${sawError} · menu back ${menu}` };
  } finally { await ctx.close(); await clearFaults(); }
});

// ── L5 · the idle phone ───────────────────────────────────────────────────────────────────────────
check("R3-L501", "L5", "an open menu, bill and live tab left alone for 75 s: no request repeats faster than the 60 s backstop", async () => {
  const { ctx, p } = await page();
  try {
    await open(p); await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(800);
    await p.locator(".cart-tabs button", { hasText: "Live status" }).click(); await p.waitForTimeout(3000);
    const hits = new Map(); const t0 = Date.now();
    p.on("request", (r) => { const u = r.url(); if (!/\/rest\/v1\/|\/api\//.test(u)) return; const k = u.split("?")[0].replace(/^https?:\/\/[^/]+/, ""); (hits.get(k) || hits.set(k, []).get(k)).push(Date.now() - t0); });
    await p.waitForTimeout(75_000);
    const worst = [...hits.entries()].map(([k, ts]) => [k, ts.length]).sort((a, b) => b[1] - a[1]);
    return { ok: worst.every(([, n]) => n <= 2), note: worst.slice(0, 4).map(([k, n]) => `${k.split("/").pop()}×${n}`).join(", ") || "no requests at all" };
  } finally { await ctx.close(); }
});

// ── L6 · real journeys through the real database, one failure injected each, then put back ─────────
async function freeTable() {
  for (const t of ["27", "26", "24", "23", "22", "21"]) {
    const s = await rest(`sessions?restaurant_id=eq.${FH}&table_number=eq.${t}&status=eq.open&select=id&limit=1`);
    const o = await rest(`orders?restaurant_id=eq.${FH}&table_number=eq.${t}&archived=is.false&status=in.(received,preparing)&select=id&limit=1`);
    if (Array.isArray(s) && !s.length && Array.isArray(o) && !o.length) return t;
  }
  return null;
}
async function retireOrder(id) {
  const now = new Date().toISOString(); const [o] = await rest(`orders?id=eq.${id}&restaurant_id=eq.${FH}&select=session_id`);
  // each flag travels with its stamp (verify:test-safety): a report never sees an archived order with no date
  await rest(`orders?id=eq.${id}&restaurant_id=eq.${FH}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled", cancelled_at: now, archived: true, archived_at: now }) });
  if (o?.session_id) { const others = await rest(`orders?session_id=eq.${o.session_id}&id=neq.${id}&select=id&limit=1`); if (Array.isArray(others) && !others.length) await rest(`sessions?id=eq.${o.session_id}&restaurant_id=eq.${FH}&status=eq.open`, { method: "PATCH", body: JSON.stringify({ status: "closed", closed_at: now, deleted_at: now }) }); }
}
check("R3-L601", "L6", "a real QR order while the SERVER's database call fails once: saved, sent by itself, lands ONCE on the right table with the right dishes — then put back", async () => {
  const table = await freeTable(); if (!table) return "skip: no free floor table at French House right now";
  // ONLY orders made after this moment count: a window like "the last two minutes" once found the previous
  // run's retired order and reported a success this run never had
  await clearFaults(); const since = Date.now(); const sinceIso = new Date(since - 1000).toISOString();
  await fault({ match: "rpc/lfh_place_order_public", side: "server", mode: "57014", times: 1 });
  const { ctx, p } = await page({ seed: false }); let mine = [];
  try {
    await watchToasts(p); await open(p); await addTwo(p);
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:open-cart"))); await p.waitForTimeout(1200);
    await p.locator("#cart-table").fill(table); await p.locator(".cart-foot .btn-gold").click();
    let found = [];
    for (let i = 0; i < 30 && !found.length; i++) { await p.waitForTimeout(1000); found = await rest(`orders?restaurant_id=eq.${FH}&table_number=eq.${table}&created_at=gte.${sinceIso}&select=id,items,status`); if (!Array.isArray(found)) found = []; }
    mine = found.map((o) => o.id);
    const t = await toasts(p); const savedFirst = t.some((x) => /saved|on its way|send it|goes through/i.test(x));
    const qty = (found[0]?.items || []).reduce((n, it) => n + (Number(it.qty) || 0), 0);   // addTwo adds the first dish twice → 1 line × 2
    const hit = ((await (await fetch(PROXY + "/__log")).json()).log || []).filter((l) => l.at >= since && /lfh_place_order_public/.test(l.url) && l.side === "server").length;   // this run's only
    return { ok: found.length === 1 && savedFirst && qty === 2 && hit === 1, note: `${found.length} order(s) on table ${table} · ${qty} dishes · server failure injected ${hit}× · ${t.filter((x) => !/added/.test(x)).join(" / ").slice(0, 120)}` };
  } finally { await ctx.close(); await clearFaults(); for (const id of mine) await retireOrder(id); }
});
check("R3-L602", "L6", "a real waiter call while the phone's request fails once: saved, sent by itself, rings ONCE — then deleted", async () => {
  const table = await freeTable(); if (!table) return "skip: no free floor table at French House right now";
  await clearFaults(); const sinceIso = new Date(Date.now() - 1000).toISOString();   // only calls made from now on
  await fault({ match: "rpc/lfh_call_waiter_table", side: "browser", mode: "503", times: 1 });
  const { ctx, p } = await page({ seed: false }); let ids = [];
  try {
    await watchToasts(p); await open(p);
    await p.locator(".chef-call").evaluate((el) => el.click()); await p.waitForTimeout(1500);
    await p.locator("#chef-table").fill(table); await p.locator(".chef-reason").nth(1).click();   // Water
    let rows = [];
    for (let i = 0; i < 30 && !rows.length; i++) { await p.waitForTimeout(1000); rows = await rest(`waiter_calls?restaurant_id=eq.${FH}&table_number=eq.${table}&created_at=gte.${sinceIso}&select=id,note`); if (!Array.isArray(rows)) rows = []; }
    await p.waitForTimeout(3000); rows = await rest(`waiter_calls?restaurant_id=eq.${FH}&table_number=eq.${table}&created_at=gte.${sinceIso}&select=id,note`);
    ids = (Array.isArray(rows) ? rows : []).map((r) => r.id);
    const t = await toasts(p);
    return { ok: ids.length === 1 && rows[0].note === "Water" && t.some((x) => /Saved/i.test(x)), note: `${ids.length} call(s) · ${t.slice(0, 2).join(" / ").slice(0, 100)}` };
  } finally { await ctx.close(); await clearFaults(); for (const id of ids) await rest(`waiter_calls?id=eq.${id}&restaurant_id=eq.${FH}`, { method: "DELETE" }); }
});
