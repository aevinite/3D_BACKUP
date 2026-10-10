// Block G — DRIVEN on the real app (T18_BASE, default http://localhost:4418), for round 2's changes.
// One sign-in per role (scripts/sweep/login.mjs caches); the admin cookie is built from .env.local inside
// this process and never printed. French House only is written to, and every write is either refused by
// the app or put back in a finally. Aangan is read only.
import { chromium } from "playwright";
import { chk, assert, eq } from "./core.mjs";
import { sb, BASE, restaurantBySlug } from "../env.mjs";
import { adminCookie, loginAs } from "../../login.mjs";
import { restoreOnExit } from "../../restore.mjs";

// The only block that talks to the network: the real app on T18_BASE and the dev database.
globalThis.fetch = globalThis.__t18RealFetch || globalThis.fetch;
const K = (f, c, fn) => chk(f, c, `driven on ${BASE}`, fn);
const NOISE = /undefined|NaN|\[object Object\]|\$\{/;
const fh = await restaurantBySlug("french-house"), ag = await restaurantBySlug("aangan-garden-restaurant");
const who = Object.fromEntries(((await sb.from("staff_users").select("id, username, permissions").in("username", ["diagm1", "diagt1", "diago1"])).data || []).map((u) => [u.username, u]));
const browser = await chromium.launch();
const restores = [];
try {
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await actx.addCookies([adminCookie(BASE)]);
  const A = actx.request, J = { "Content-Type": "application/json" };
  const tree = async (rid) => (await (await A.get(`${BASE}/api/admin/restaurants/access-tree?restaurant_id=${rid}`)).json()).state;
  const post = (patch, headers = {}) => A.post(`${BASE}/api/admin/restaurants/access-tree`, { headers: { ...J, ...headers }, data: { restaurant_id: fh.id, patch } });
  const st = await tree(fh.id);
  // item 24
  await K("lib/accessState.ts", "the Access screen's reply no longer carries settings.platform_channels (item 24)", () => assert(!("platform_channels" in st.settings)));
  await K("lib/accessState.ts", "…and still says each channel's on/off and whether it is stored", () => { eq(st.channels, { website: true, zomato: true, swiggy: true }); eq(st.channelsStored, { website: true, zomato: true, swiggy: true }); });
  await K("lib/accessState.ts", "…and no reply field holds a stored key: every hint is '' or a mask", () => assert(Object.values(st.creds).every((v) => v === "" || /^••••(.{4})?$/.test(v))));
  await K("lib/accessState.ts", "the same holds for Aangan (read only)", async () => assert(!("platform_channels" in (await tree(ag.id)).settings)));
  // item 18
  await K("app/api/admin/restaurants/access-tree/route.ts", "a pick-one sub-option sent as `true` is refused in words, nothing written (item 18)", async () => { const r = await post({ config: { maintenance: { manager_opts: { who: true } } } }); eq(r.status(), 400); assert(/isn't one of the choices/.test((await r.json()).error)); });
  await K("app/api/admin/restaurants/access-tree/route.ts", "an unknown choice word is refused", async () => { const r = await post({ config: { view_dashboard: { manager_opts: { range: "last365" } } } }); eq(r.status(), 400); eq((await r.json()).error, `"last365" isn't one of the choices for "range".`); });
  await K("app/api/admin/restaurants/access-tree/route.ts", "an on/off sub-option sent as a string is refused", async () => { const r = await post({ config: { edit_menu: { manager_opts: { edit_price: "true" } } } }); eq(r.status(), 400); assert(/is an on\/off/.test((await r.json()).error)); });
  await K("app/api/admin/restaurants/access-tree/route.ts", "French House's 'Who may do it' reads 'owner' after the data repair (was `true`)", async () => eq((await tree(fh.id)).config.maintenance?.manager_opts?.who, "owner"));
  // item 15 — no write: the expectation is stale, so the app refuses
  await K("lib/accessTree.ts", "first save wins on a delivery channel: a stale tap is refused with 409, nothing written (item 15)", async () => { const r = await post({ channels: { zomato: false } }, { "X-LFH-Expect": JSON.stringify({ table: "settings", id: fh.id, fields: { "platform_channels.zomato.on": false }, label: "Zomato" }) }); eq(r.status(), 409); const j = await r.json(); assert(j.clash, JSON.stringify(j).slice(0, 160)); eq((await tree(fh.id)).channels.zomato, true); return j.clash.plain; });
  await K("lib/accessTree.ts", "first save wins on the Ratings master: a stale tap is refused, nothing written", async () => { const s = await tree(fh.id); const stale = s.settings.google_review_mode === "off" ? "google" : "off"; const r = await post({ features: { ratings: false }, settings: { google_review_mode: "off" } }, { "X-LFH-Expect": JSON.stringify({ table: "settings", id: fh.id, fields: { google_review_mode: stale }, label: "Ratings" }) }); eq(r.status(), 409); eq((await tree(fh.id)).settings.google_review_mode, s.settings.google_review_mode); });
  // item 9 data
  await K("lib/accessTree.ts", "Move, merge & split is ON for every restaurant except Aangan, which stays the control (item 9)", async () => { const s = await sb.from("settings").select("restaurant_id, table_ops_allowed").limit(100); const off = s.data.filter((x) => x.table_ops_allowed !== true).map((x) => x.restaurant_id); eq(off, [ag.id]); });
  // item 2 — one real tap on French House, restored
  const modsBefore = (await sb.from("settings").select("modules").eq("restaurant_id", fh.id).maybeSingle()).data?.modules ?? null;
  const putLoyalty = async () => { await sb.from("settings").update({ modules: modsBefore }).eq("restaurant_id", fh.id); };
  restores.push(putLoyalty); restoreOnExit("t18 r2 · French House settings.modules", putLoyalty);
  const page = await actx.newPage();
  await page.goto(`${BASE}/aevinite/access?rid=${fh.id}&focus=loyalty`, { waitUntil: "networkidle", timeout: 120000 });
  const sw = page.locator('[data-node="loyalty"] [role="switch"]').first(); await sw.waitFor({ timeout: 60000 });
  const was = await sw.getAttribute("aria-checked");
  await sw.click(); await page.waitForTimeout(3000);
  await K("lib/accessTree.ts", "tapping Loyalty points flips the switch on screen AND in the database, together (item 2)", async () => { const now = await sw.getAttribute("aria-checked"); const db = (await sb.from("settings").select("modules").eq("restaurant_id", fh.id).maybeSingle()).data?.modules?.loyalty; assert(now !== was, "the switch did not move"); eq(String(db?.allowed === true), now); });
  await restores.pop()();
  await K("lib/accessTree.ts", "French House's Loyalty value is back to what it was", async () => eq((await sb.from("settings").select("modules").eq("restaurant_id", fh.id).maybeSingle()).data?.modules ?? null, modsBefore));
  // item 1 on screen
  await page.goto(`${BASE}/aevinite/access?rid=${fh.id}&focus=mgr_may`, { waitUntil: "networkidle", timeout: 120000 });
  await page.locator('[data-node="mgr_may"]').first().waitFor({ timeout: 60000 });
  await K("lib/accessTree.ts", "the rendered 'Permission for manager' names two printing rows and no printer setup (item 1)", async () => { const t = await page.locator('[data-node="mgr_may"]').first().innerText(); assert(/two printing ones/.test(t) && !/set the printers up/i.test(t)); });
  await K("components/admin/AccessTree.tsx", "the rendered Access screen carries no undefined / NaN / [object Object] / ${", async () => { const t = await page.locator("body").innerText(); assert(!NOISE.test(t), t.match(NOISE)?.[0]); });
  await actx.close();
  // item 21 measured at Samsung A35 360×780, touch on
  const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }); await phone.addCookies([adminCookie(BASE)]);
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/aevinite/access?rid=${fh.id}&focus=mgr_manage`, { waitUntil: "networkidle", timeout: 120000 });
  await pp.locator('[data-node="mgr_manage"] .nm-t').first().waitFor({ timeout: 60000 });
  await K("components/admin/AccessTree.tsx", "at 360px the long title's first line sits level with its arrow (item 21, measured)", async () => { const tw = await pp.locator('[data-node="mgr_manage"] .at-tw').first().boundingBox(); const nm = await pp.locator('[data-node="mgr_manage"] .nm-t').first().boundingBox(); assert(tw && nm); assert(nm.y < tw.y + tw.height && nm.x > tw.x, `arrow ${JSON.stringify(tw)} title ${JSON.stringify(nm)}`); return `arrow y=${tw.y.toFixed(0)} h=${tw.height.toFixed(0)}, title y=${nm.y.toFixed(0)}`; });
  await K("components/admin/AccessTree.tsx", "at 360px nothing on the Access screen scrolls sideways", async () => { const w = await pp.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); assert(w[0] <= w[1] + 1, JSON.stringify(w)); });
  await phone.close();
  // item 16 — owner and manager are refused; owner's screen is read-only; admin still can
  const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await loginAs(octx, "owner", BASE);
  await K("app/api/owner/staff/route.ts", "an OWNER changing a waiter's permission is refused in words, nothing written (item 16)", async () => { const r = await octx.request.patch(`${BASE}/api/owner/staff`, { headers: J, data: { id: who.diagt1.id, action: "set_permissions", permissions: { tablet_parcel: "off" } } }); eq(r.status(), 403); assert(/set by Aevidine/.test((await r.json()).error)); const after = (await sb.from("staff_users").select("permissions").eq("id", who.diagt1.id).maybeSingle()).data.permissions; eq(after?.tablet_parcel, who.diagt1.permissions?.tablet_parcel); });
  const op = await octx.newPage();
  await op.goto(`${BASE}/owner/staff/${who.diagt1.id}`, { waitUntil: "networkidle", timeout: 120000 }); await op.waitForTimeout(2000);
  const fold = op.getByText(/Permissions — what/).first(); if (await fold.count()) { await fold.click(); await op.waitForTimeout(1200); }
  await K("components/admin/StaffProfile.tsx", "the owner's copy of a waiter's profile: permission rows shown, no dropdown, says they are set by Aevidine", async () => { const card = op.locator(".stp-perms").first(); eq(await card.locator("select").count(), 0); const t = await card.innerText(); assert(/set by Aevidine/.test(t), t.slice(0, 200)); assert(/Mark a bill paid/.test(t)); });
  await K("components/admin/StaffProfile.tsx", "…and that screen carries no undefined / NaN / [object Object]", async () => { const t = await op.locator("body").innerText(); assert(!NOISE.test(t)); });
  await octx.close();
  const mctx = await browser.newContext(); await loginAs(mctx, "manager", BASE);
  await K("app/api/owner/staff/route.ts", "a MANAGER reducing a waiter's permission is refused too (item 16)", async () => { const r = await mctx.request.patch(`${BASE}/api/owner/staff`, { headers: J, data: { id: who.diagt1.id, action: "set_permissions", permissions: { tablet_parcel: "off" } } }); eq(r.status(), 403); assert(/set by Aevidine/.test((await r.json()).error), "refused, but not by the item-16 rule"); });
  await mctx.close();
  const a2 = await browser.newContext(); await a2.addCookies([adminCookie(BASE)]);
  const before = who.diagt1.permissions || {};
  const putPerms = async () => { await sb.from("staff_users").update({ permissions: before }).eq("id", who.diagt1.id); };
  restores.push(putPerms); restoreOnExit("t18 r2 · diagt1 permissions", putPerms);
  await K("app/api/admin/users/route.ts", "the ADMIN can still change one person's permission — and put it back", async () => { const set = await a2.request.patch(`${BASE}/api/admin/users`, { headers: J, data: { id: who.diagt1.id, action: "set_permissions", permissions: { tablet_parcel: "off" } } }); eq(set.status(), 200); eq((await sb.from("staff_users").select("permissions").eq("id", who.diagt1.id).maybeSingle()).data.permissions.tablet_parcel, "off"); const back = await a2.request.patch(`${BASE}/api/admin/users`, { headers: J, data: { id: who.diagt1.id, action: "set_permissions", permissions: { tablet_parcel: before.tablet_parcel ?? "" } } }); eq(back.status(), 200); });
  await restores.pop()();
  await K("app/api/admin/users/route.ts", "diagt1's permissions are exactly as they were", async () => eq((await sb.from("staff_users").select("permissions").eq("id", who.diagt1.id).maybeSingle()).data.permissions || {}, before));
  // items 3 / 5 / 13 through the real routes (refused writes only)
  await K("lib/staffProfileShared.ts", "a payment rounding to ₹0.00 is refused by the real owner route (item 13)", async () => { const o = await browser.newContext(); await loginAs(o, "owner", BASE); const r = await o.request.post(`${BASE}/api/owner/staff`, { headers: J, data: { staff_id: who.diagt1.id, action: "record_payment", amount: 0.004 } }); const s = r.status(); const j = await r.json().catch(() => ({})); await o.close(); eq(s, 400, `status (a 404/409 would mean the amount rule was never reached): ${j.error}`); eq(j.error, "Enter an amount greater than zero."); const n = (await sb.from("staff_payments").select("id", { count: "exact", head: true }).eq("staff_id", who.diagt1.id).gt("created_at", new Date(Date.now() - 60_000).toISOString())).count; eq(n, 0, "a payment was written"); return "400 · the amount sentence · nothing written"; });
  await K("lib/staffProfileShared.ts", "an impossible joining date is refused by the real admin route (item 3)", async () => { const r = await a2.request.patch(`${BASE}/api/admin/users`, { headers: J, data: { id: who.diagt1.id, action: "set_job", job: { joined_on: "2026-04-31" } } }); eq(r.status(), 400); assert(/joining date isn't a real date/.test((await r.json()).error)); });
  await K("lib/staffProfileShared.ts", "an allowance name sent as a list is refused by the real admin route (item 5)", async () => { const r = await a2.request.patch(`${BASE}/api/admin/users`, { headers: J, data: { id: who.diagt1.id, action: "set_job", job: { pay_extras: [{ label: ["x"], amount: 1 }] } } }); eq(r.status(), 400); eq((await r.json()).error, "That allowance name isn't plain text."); });
  await a2.close();
} finally {
  for (const r of restores.reverse()) { try { await r(); } catch (e) { console.log("RESTORE FAILED", e.message); } }
  await browser.close();
}
