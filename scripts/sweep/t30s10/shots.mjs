// scripts/sweep/t30s10/shots.mjs — sweep #10 · terminal 30 · the screens the money libraries draw.
//   node scripts/sweep/t30s10/shots.mjs --base http://localhost:4430 [--out <dir>]
// Reuses the ONE sign-in per role (scripts/sweep/login.mjs caches it); the admin uses the
// adminCookie, which is no sign-in at all. Each shot is asserted by machine (no leaked code text, no
// sideways scroll, the money figures present) and the PNGs are written for a person to READ.
import { chromium } from "playwright";
import { loginAs, adminCookie } from "../login.mjs";
import { readFileSync } from "node:fs";
import { refuseUnlessDevTestDb } from "../devStacks.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4430");
const OUT = arg("--out", ".claude/sweep/shots/S10-T30");
const VP = {
  desktop: { viewport: { width: 1280, height: 800 } },
  a35: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 1194, height: 834 }, hasTouch: true },
};
const browser = await chromium.launch();
const results = [];
async function shoot(role, path, vpName, skin, name, mustSee) {
  const ctx = await browser.newContext(VP[vpName]);
  if (role === "admin") await ctx.addCookies([adminCookie(BASE)]); else await loginAs(ctx, role, BASE);
  if (skin) await ctx.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // The manager panel draws inside an iframe, so read every frame, not only the top document.
  let frameText = "";
  for (const f of page.frames()) { try { frameText += await f.evaluate(() => document.body ? document.body.innerText : ""); } catch { /* cross-origin or gone */ } }
  const info = await page.evaluate(() => {
    const txt = document.body.innerText || "";
    const leaks = (txt.match(/\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b|\$\{/g) || []);
    const doc = document.scrollingElement || document.documentElement;
    return { leaks, sideways: doc.scrollWidth - doc.clientWidth, len: txt.length, rupee: (txt.match(/₹/g) || []).length, text: txt.slice(0, 4000) };
  });
  const file = `${OUT}/${name}-${vpName}${skin ? "-" + skin : ""}.png`;
  await page.screenshot({ path: file });
  info.len = Math.max(info.len, frameText.length);
  info.leaks = info.leaks.concat(frameText.match(/\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b|\$\{/g) || []);
  const seen = mustSee ? mustSee.test(info.text + frameText) : true;
  results.push({ name: `${name} · ${vpName}${skin ? " · " + skin : ""}`, ok: !info.leaks.length && info.sideways <= 1 && info.len > 50 && seen && !errs.length, note: `leaks ${info.leaks.length}, sideways ${info.sideways}px, ₹×${info.rupee}, page errors ${errs.length}${errs.length ? " (" + errs[0] + ")" : ""}${seen ? "" : ", expected text missing"}`, file });
  await ctx.close();
}
for (const vp of ["desktop", "a35", "ipad"]) for (const skin of ["light", "dark"]) {
  await shoot("owner", "/owner/reports?open=tax", vp, skin, "owner-tax-report", /GST|Tax/i);
  await shoot("owner", "/owner", vp, skin, "owner-dashboard", /₹/);
}
for (const vp of ["desktop", "a35", "ipad"]) await shoot("admin", "/aevinite/billing", vp, null, "admin-billing", /plan|billing/i);
for (const vp of ["desktop", "a35"]) await shoot("manager", "/manager", vp, null, "manager-floor", null);
// round 3 (items 15–18, 24–27): the screens those changes feed — the manager floor reads FLOOR_COLS now
// (item 17), the owner screens answer a failed read honestly (item 15), the tablet undoes a split first.
for (const vp of ["desktop", "a35"]) {
  await shoot("owner", "/owner/settings", vp, null, "r3-owner-settings", /password|setting/i);
  await shoot("owner", "/owner/staff", vp, null, "r3-owner-staff", /staff|team|people/i);
  await shoot("owner", "/owner/inventory", vp, null, "r3-owner-inventory", /stock|inventory|item/i);
  await shoot("owner", "/owner/reports?open=inventory", vp, null, "r3-owner-reports-inventory", /report/i);
}
for (const vp of ["ipad", "a35"]) await shoot("tablet", "/tablet", vp, null, "r3-tablet-floor", null);
await shoot("admin", "/aevinite/restaurants", "desktop", null, "r3-admin-restaurants", /restaurant/i);
// round 3: a BUSY table. Item 17 changed which columns the live floor reads, and a floor of free tables
// reads none of them. So ONE real order goes onto a free French House table (the restaurant that is
// written to), is photographed on the manager floor and the tablet, and is then cancelled with a
// reason and its table closed — in a finally, so it is cleaned up whatever happens.
{
  const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
  refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "sweep #10 T30 round 3 busy-floor shots");
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const sql = async (q) => { if (!/^\s*(select|with)\b/i.test(q)) throw new Error("read-only"); const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }); return r.json(); };
  const FH = "00000000-0000-0000-0000-000000000001", TABLE = "28", TEST_ALG = "t30 round-3 check (remove me)";
  const busyNow = await sql(`select count(*) n from sessions where restaurant_id='${FH}' and status='open' and table_number='${TABLE}'`);
  const mctx = await browser.newContext(VP.desktop); await loginAs(mctx, "manager", BASE);
  const api = async (method, path, body) => { const r = await mctx.request.fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, timeout: 60000 }); let j = null; try { j = await r.json(); } catch {} return { status: r.status(), j }; };
  let placed = null;
  try {
    if (Number(busyNow[0].n) === 0) {
      placed = await api("POST", "/api/editor/order", { table: TABLE, items: [{ id: "mint-melon-juice", qty: 2 }], allergies: [TEST_ALG] });
      results.push({ name: "r3 busy table: the manager's order is accepted (200)", ok: placed.status === 200, note: `status ${placed.status}`, file: "" });
      for (const vp of ["desktop", "a35"]) await shoot("manager", "/manager", vp, null, "r3-manager-floor-busy", new RegExp(`\\b${TABLE}\\b[\\s\\S]*₹|₹[\\s\\S]*\\b${TABLE}\\b`));
      await shoot("tablet", "/tablet", "ipad", null, "r3-tablet-floor-busy", /₹/);
    } else results.push({ name: `r3 busy table: table ${TABLE} was free to use`, ok: false, note: "it already had an open session", file: "" });
  } finally {
    const sess = (await sql(`select id from sessions where restaurant_id='${FH}' and status='open' and table_number='${TABLE}' order by created_at desc limit 1`))[0];
    if (placed && sess) {
      for (const o of await sql(`select id from orders where session_id='${sess.id}' and status <> 'cancelled'`)) await api("PATCH", `/api/editor/orders/${o.id}`, { status: "cancelled", reason_note: "T30 round 3: a test order for the busy-floor screenshots" });
      const closed = await api("POST", `/api/editor/sessions/${sess.id}/close`, { reason_note: "T30 round 3: a test order for the busy-floor screenshots" });
      const after = await sql(`select status from sessions where id='${sess.id}'`);
      results.push({ name: "r3 busy table: cleaned up — the test order cancelled with a reason, the table closed again", ok: after[0]?.status !== "open", note: `close ${closed.status}, session ${after[0]?.status}`, file: "" });
    }
    await mctx.close();
  }
}
await browser.close();
for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name} → ${r.note} · ${r.file}`);
process.stdout.write("", () => process.exit(results.some((r) => !r.ok) ? 1 : 0));
