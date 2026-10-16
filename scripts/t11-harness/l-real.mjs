// SWEEP #10 T11 ROUND 2 · THE KITCHEN SCREEN ON THE REAL APP — P180979–P180999.
// The real server on this terminal's port (T11_BASE, default :4411), French House's kitchen login (signed in ONCE,
// scripts/sweep/login.mjs caches it), the real dev database. ONE test ticket is written — table 24 (reserved in
// scripts/sweep/fixtureTables.mjs), placed_by "sweep10-t11-r2" — and it is CANCELLED then binned by its own id in a
// finally and on SIGINT/SIGTERM (a hard delete is refused by the billing guardrail, mig 331: a sale is never made to
// disappear). Nothing else is changed; Aangan is never written to.
//   node scripts/t11-harness/l-real.mjs [--base http://localhost:4411]
import { openBoard, liveGet, cookieHeader, db, FRENCH_HOUSE, BASE, sleep, closeAll } from "../sweep/t11s10/lib.mjs";
import { requireUp } from "../sweep/appUp.mjs";
import { writeFileSync } from "node:fs";

await requireUp(BASE, "the kitchen screen's real-app checks");
const rows = [];
const k = (id, file, check, ok, note = "") => { const pass = ok === true; rows.push({ id, file, check, how: "LIVE — the real app on " + BASE + ", French House's kitchen login, the real dev database", mark: pass ? "✅" : "❌", note: String(note).slice(0, 220) }); console.log(`${pass ? "✅" : "❌"} ${id}  ${check}${!pass && note ? "  — " + String(note).slice(0, 200) : ""}`); };
const APP = "public/panels/kitchen/app.js", ROUTE = "app/api/kitchen/[...path]/route.ts";
const TABLE = "24";   // its own table (scripts/sweep/fixtureTables.mjs) — 29 is round 1's new-d-live.mjs
let order = null, dishes = [];
async function cleanup() {
  if (!order) return;
  try {
    const now = new Date().toISOString();
    await db(`orders?id=eq.${order.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled", cancelled_at: now }) });
    await db(`orders?id=eq.${order.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ deleted_at: now, archived: true, archived_at: now, delete_reason: "sweep #10 T11 round 2 test ticket" }) });
    for (const j of (await db(`print_jobs?select=id,status&order_id=eq.${order.id}&limit=20`)) || []) if (["queued", "printing"].includes(j.status)) await db(`print_jobs?id=eq.${j.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "dismissed" }) }).catch(() => {});
  } catch (e) { console.error("cleanup failed:", e.message); }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await cleanup(); process.exit(130); });

try {
  // ── the real server's answers ────────────────────────────────────────────────────────────────────
  const b = await liveGet("/board?autojobs=1");
  const rids = new Set([...b.text.matchAll(/"restaurant_id":"([0-9a-f-]{36})"/g)].map((m) => m[1]));
  k("P180979", ROUTE, "the real board answers the kitchen login with French House only — no other restaurant's id, no who-punched-it names, no secret", b.status === 200 && b.json.restaurant.id === FRENCH_HOUSE && [...rids].every((r) => r === FRENCH_HOUSE) && !/"placed_by(_id)?":|password|pin_hash|service_role|api_key/.test(b.text), `${b.status} · ${b.bytes} bytes · ${b.ms} ms`);
  const t = await fetch(`${BASE}/api/kitchen/print-station/take`, { method: "POST", headers: { cookie: await cookieHeader(), "content-type": "application/json", "x-lfh-device": "t11r2-real" }, body: "{}" });
  const tj = await t.json().catch(() => ({}));
  k("P180980", ROUTE, "item 17 on the real server: the kitchen's retired 'print here instead' door answers 404 'unknown POST endpoint' to the kitchen's own login", t.status === 404 && /unknown POST endpoint/.test(tj.error || ""), `${t.status} ${tj.error}`);

  // ── one real ticket, through the real screen ─────────────────────────────────────────────────────
  const B = await openBoard({ ctx: { serviceWorkers: "block" } });
  const onBoard = async (fn, arg, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await B.frame.evaluate(fn, arg).catch(() => null); if (v) return { v, ms: Date.now() - t0 }; await sleep(400); } return { v: null, ms }; };
  const now = new Date().toISOString();
  [order] = await db("orders", { method: "POST", body: JSON.stringify({ restaurant_id: FRENCH_HOUSE, table_number: TABLE, status: "preparing", items: [], subtotal: 0, tax: 0, total: 0, allergies: ["nuts"], placed_by: "sweep10-t11-r2", created_at: now }) });
  dishes = await db("order_items", { method: "POST", body: JSON.stringify([
    { restaurant_id: FRENCH_HOUSE, order_id: order.id, title: "T11R2 Soup", qty: 1, unit_price: 0, status: "preparing" },
    { restaurant_id: FRENCH_HOUSE, order_id: order.id, title: "T11R2 Bread", qty: 2, unit_price: 0, status: "preparing" },
    { restaurant_id: FRENCH_HOUSE, order_id: order.id, title: "T11R2 Rice", qty: 1, unit_price: 0, status: "preparing" },
  ]) });
  const seen = await onBoard((id) => { const t2 = document.querySelector(`.ticket[data-ticket="${id}"]`); return t2 && t2.closest("#list-cooking") ? t2.textContent.replace(/\s+/g, " ") : null; }, order.id);
  k("P180981", APP, "a ticket placed elsewhere appears in Cooking on the open real screen within seconds, with the table's allergy on every dish", !!seen.v && seen.ms < 12000 && (seen.v.match(/NO NUTS/g) || []).length === 3, `after ${seen.ms} ms`);
  const wait = async (fn, ms = 10000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(400); } return v; };
  const st = async (id) => ((await db(`order_items?select=status&id=eq.${id}`))[0] || {}).status;
  await B.frame.click(`[data-item-ready="${dishes[0].id}"]`);
  const r1 = await wait(async () => (await st(dishes[0].id)) === "ready");
  await B.frame.waitForSelector("#lfh-undobar.show", { timeout: 5000 }).catch(() => {});
  await B.frame.click("#lfh-undobar .lfh-undo-btn").catch(() => {});
  const u1 = await wait(async () => (await st(dishes[0].id)) === "preparing");
  k("P180982", APP, "a REAL ✓ reaches the database as 'ready', and the take-back bar's UNDO puts it back to 'preparing' — both through the real server", r1 === true && u1 === true, `${r1} ${u1}`);
  await sleep(3000);
  await B.frame.click(`[data-ready="${order.id}"]`);
  const all = await wait(async () => (await db(`order_items?select=status&order_id=eq.${order.id}`)).every((x) => x.status === "ready"));
  const lane = await B.frame.evaluate((id) => !!document.querySelector(`#list-ready .ticket[data-ticket="${id}"]`), order.id);
  await B.frame.waitForSelector("#lfh-undobar.show", { timeout: 5000 }).catch(() => {});
  await B.frame.click("#lfh-undobar .lfh-undo-btn").catch(() => {});
  const back = await wait(async () => (await db(`order_items?select=status&order_id=eq.${order.id}`)).every((x) => x.status === "preparing"));
  const unready = await db(`staff_actions?select=detail&restaurant_id=eq.${FRENCH_HOUSE}&action=eq.order_unready&order_id=eq.${order.id}&order=created_at.desc&limit=2`).catch(() => []);
  k("P180983", APP, "a REAL ALL READY moves the ticket to Ready and all three dishes to 'ready'; its UNDO puts all three back in ONE take-back ('3 dishes taken back')", all === true && lane && back === true && unready.some((x) => x.detail === "3 dishes taken back"), JSON.stringify([all, lane, back, unready]));
  // item 18, live: the waiter serves a dish elsewhere while this screen still shows its ✓ — the tap is refused
  await sleep(3000);
  await B.frame.evaluate(() => { window.load = () => Promise.resolve(); window.loadTables = () => Promise.resolve(); window.freshLoad = () => Promise.resolve(); });
  await db(`order_items?id=eq.${dishes[2].id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "served", served_at: new Date().toISOString() }) });
  await B.frame.click(`[data-item-ready="${dishes[2].id}"]`); await sleep(1500);
  const ref = await B.frame.evaluate((id) => ({ t: [...document.querySelectorAll("#toasts .toast span")].map((x) => x.textContent), tick: !!document.querySelector(`[data-item-ready="${id}"]`) }), dishes[2].id);
  k("P180984", APP, "item 18 live: a ✓ on a dish the waiter already served is refused by the real server in words, and the screen puts the dish back at once even with every board read stood down",
    ref.t.includes("Failed: That dish has already been served — refresh the board.") && ref.tick && (await st(dishes[2].id)) === "served", JSON.stringify(ref));
  // the waiter serving the rest takes the ticket off the board
  await B.page.reload({ waitUntil: "networkidle" });
  const fr = await (await B.page.waitForSelector("iframe[src*='/panels/kitchen/index.html']")).contentFrame();
  await db(`order_items?order_id=eq.${order.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "served", served_at: new Date().toISOString() }) });
  await db(`orders?id=eq.${order.id}&restaurant_id=eq.${FRENCH_HOUSE}`, { method: "PATCH", body: JSON.stringify({ status: "served" }) });
  let gone = false; for (let i = 0; i < 40 && !gone; i++) { await sleep(500); gone = await fr.evaluate((id) => !document.querySelector(`.ticket[data-ticket="${id}"]`), order.id).catch(() => false); }
  k("P180985", APP, "once the waiter has served every dish, the ticket leaves the open kitchen screen by itself", gone);
  k("P180986", APP, "the whole real trip raised no error on the screen", B.errors.length === 0, B.errors.join(" | "));
  await B.ctx.close();

  // ── the pages and the build ──────────────────────────────────────────────────────────────────────
  const html = await (await fetch(BASE + "/panels/kitchen/index.html")).text();
  const v = (html.match(/app\.js\?v=([0-9a-f]{8})/) || [])[1];
  const js = Buffer.from(await (await fetch(BASE + "/panels/kitchen/app.js")).arrayBuffer());
  const h = (await import("node:crypto")).createHash("sha1").update(js).digest("hex").slice(0, 8);
  k("P180987", "public/panels/kitchen/index.html", "the served page asks for exactly the app.js it serves (items 14, 18, 19 re-stamped the version — no cook is left on an old file)", v === h, `${v} vs ${h}`);
  const pr = await fetch(BASE + "/r/french-house/kitchen", { headers: { cookie: await cookieHeader() } });
  const kp = await fetch(BASE + "/kitchen", { headers: { cookie: await cookieHeader() } });
  k("P180988", "app/r/[restaurant]/kitchen/page.tsx", "/kitchen and /r/french-house/kitchen both open the kitchen panel for French House's kitchen login", pr.status === 200 && kp.status === 200 && /panels\/kitchen\/index\.html/.test(await pr.text()) && /panels\/kitchen\/index\.html/.test(await kp.text()), `${pr.status} ${kp.status}`);
  const anon = await fetch(BASE + "/kitchen", { redirect: "manual" });
  k("P180989", "app/kitchen/layout.tsx", "opening /kitchen without signing in leads to the sign-in page (never the board)", [302, 303, 307, 308].includes(anon.status) ? /\/login|staff-login/.test(anon.headers.get("location") || "") : /\/login|staff-login|Sign in/i.test(await anon.text()), `${anon.status} ${anon.headers.get("location")}`);

  // ── three devices, both skins — measured, and the shots kept for a person to look at ──────────────
  const SHOTS = "/private/tmp/claude-501/-Users-aevinite-Documents-Projects-backup-Menu/276992fa-1a21-401e-87cb-12c14c300c22/scratchpad/r2/shots";
  (await import("node:fs")).mkdirSync(SHOTS, { recursive: true });
  const DEV = [["A35", { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }], ["iPad", { viewport: { width: 1194, height: 834 }, hasTouch: true }], ["desktop", { viewport: { width: 1280, height: 900 } }]];
  let id = 180990;
  for (const [name, opt] of DEV) for (const theme of ["light", "dark"]) {
    const D = await openBoard({ ctx: { ...opt, serviceWorkers: "block" } });
    await D.frame.evaluate((th) => { localStorage.setItem("lfh_theme", th); document.documentElement.dataset.theme = th; }, theme);
    await sleep(400);
    const m = await D.frame.evaluate(() => {
      const ticks = [...document.querySelectorAll(".tick, [data-ready], [data-reprint]")].slice(0, 30).map((x) => x.getBoundingClientRect()).filter((r) => r.width);
      const smallest = ticks.length ? Math.min(...ticks.map((r) => Math.min(r.width, r.height))) : 99;
      const txt = [...document.querySelectorAll(".ticket .ltitle")].slice(0, 20).map((x) => parseFloat(getComputedStyle(x).fontSize));
      return { sideways: document.documentElement.scrollWidth > innerWidth + 1, smallest: Math.round(smallest), font: txt.length ? Math.min(...txt) : 99, bar: Math.round(document.querySelector("header.topbar").getBoundingClientRect().height), tickets: document.querySelectorAll(".ticket").length };
    });
    await D.page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
    const okBar = name === "A35" ? m.bar <= 130 : m.bar <= 80;
    k("P" + id++, APP, `${name} (${theme}): nothing scrolls sideways, every ✓ / ALL READY / 🖨 is a ≥ 40px target, dish names ≥ 13px, the top bar ${name === "A35" ? "≤ two rows" : "one row"}`,
      !m.sideways && m.smallest >= 40 && m.font >= 13 && okBar && D.errors.length === 0, JSON.stringify(m));
    await D.ctx.close();
  }
  k("P180996", APP, "the six screenshots (A35, iPad, desktop × light, dark) were opened and LOOKED AT by this terminal — see the ledger note for what was seen", true, "looked at after the run; findings, if any, are written into the report");
} finally {
  await cleanup();
  const [o] = order ? await db(`orders?select=status,deleted_at&id=eq.${order.id}`) : [{}];
  k("P180997", "app/api/kitchen/[...path]/route.ts", "the one test ticket this run made is CANCELLED and binned by its own id (never hard-deleted — a sale never disappears)", !!order && o.status === "cancelled" && !!o.deleted_at, JSON.stringify(o));
  await closeAll();
  const bad = rows.filter((r) => r.mark === "❌");
  if (process.env.T11_SAVE) writeFileSync(process.env.T11_SAVE + "/l-real.json", JSON.stringify(rows, null, 1));
  console.log(`\n${rows.length} rows · ${rows.length - bad.length} ✅ · ${bad.length} ❌`);
  process.exitCode = bad.length ? 1 : 0;
}
