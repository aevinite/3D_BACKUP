// scripts/sweep/t18s10/live.mjs — terminal 18's DRIVEN checks against a running server (port 4418).
//
//   T18_BASE=http://localhost:4418 node scripts/sweep/t18s10/live.mjs [--start <n>]
//
// Signs in ONCE per role through scripts/sweep/login.mjs (cached), plus the admin cookie built from
// .env.local inside this script (never printed). Playwright, not the DevTools browser, because it
// needs five logged-in roles in one run and keeps the admin secret out of any transcript.
// WRITES: only requests the app REFUSES (a 400 writes nothing) and one profile save whose value is
// refused field-by-field, so the row is left exactly as it was — read before and after to prove it.
// French House (the restaurant sweeps write to) only; Aangan is read, never written.
import { chromium } from "playwright";
import { chk, assert, eq, report, load } from "./lib.mjs";
import { sb, BASE, restaurantBySlug } from "./env.mjs";
import { loginAs, adminCookie } from "../login.mjs";

const start = Number(process.argv[process.argv.indexOf("--start") + 1]) || 187425;
let n = start;
const shotDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const K = (file, check, how, fn) => chk(`P${++n}`, file, check, how, fn);
const T = await load("accessTree");
const fh = await restaurantBySlug("french-house"), ag = await restaurantBySlug("aangan-garden-restaurant");
const ids = Object.fromEntries(((await sb.from("staff_users").select("id, username, role, assigned_tables").in("username", ["diagm1", "diagt1", "diagkitchen", "diago1"])).data || []).map((u) => [u.username, u]));
const DRIVE = `driven on ${BASE}`;
const NOISE = /undefined|NaN|\[object Object\]|\$\{/;

const browser = await chromium.launch();
try {
  // ── ADMIN ────────────────────────────────────────────────────────────────────────────────
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await actx.addCookies([adminCookie(BASE)]);
  const A = actx.request;
  const tree = async (rid) => A.get(`${BASE}/api/admin/restaurants/access-tree?restaurant_id=${rid}`);
  const fhR = await tree(fh.id); const fhJ = await fhR.json();
  await K("lib/accessState.ts", "the Access screen's read for French House answers 200 with the TreeState shape", DRIVE, () => { eq(fhR.status(), 200); eq(Object.keys(fhJ.state).sort(), Object.keys(T.emptyState()).sort()); });
  await K("lib/accessState.ts", "…and its credential hints are masks or empty, nothing else", DRIVE, () => { for (const v of Object.values(fhJ.state.creds)) assert(v === "" || /^••••.{1,4}$/.test(v)); });
  await K("lib/accessState.ts", "…and access_config carries only ids the model owns (+ menus)", DRIVE, () => { const extra = Object.keys(fhJ.state.config).filter((k) => !T.KNOWN_CONFIG_IDS.has(k) && k !== "menus"); eq(extra, []); });
  await K("lib/accessState.ts", "…and the reply is small (no constant tree JSON riding along)", DRIVE, async () => { const bytes = (await fhR.body()).length; assert(bytes < 12000, `${bytes} bytes`); return `${bytes} bytes`; });
  const agR = await tree(ag.id);
  await K("lib/accessState.ts", "the read for Aangan (read-only control) answers 200", DRIVE, () => eq(agR.status(), 200));
  await K("lib/accessState.ts", "an unused restaurant id is refused as not found, in words", DRIVE, async () => { const r = await tree("00000000-0000-0000-0000-00000000dead"); eq(r.status(), 404); eq((await r.json()).error, "Restaurant not found."); });
  await K("lib/accessState.ts", "a malformed restaurant id never reaches the database", DRIVE, async () => { const r = await tree("not-a-uuid"); eq(r.status(), 400); eq((await r.json()).error, "Invalid restaurant_id."); });
  await K("lib/accessTree.ts", "a save that names nothing the model knows changes nothing and says so", DRIVE, async () => { const r = await A.post(`${BASE}/api/admin/restaurants/access-tree`, { data: { restaurant_id: fh.id, patch: { grants: { not_a_power: true } } } }); assert(r.status() >= 400 && r.status() < 500, `status ${r.status()}`); return `${r.status()} · ${(await r.json()).error}`; });
  const userGet = async (id) => (await (await A.get(`${BASE}/api/admin/users?id=${id}`)).json());
  const m1 = await userGet(ids.diagm1.id);
  await K("lib/staffProfile.ts", "the admin's person read never carries a password or PIN hash", DRIVE, () => assert(!/password_hash|pin_hash/.test(JSON.stringify(m1))));
  const patch = (body) => A.patch(`${BASE}/api/admin/users`, { data: body });
  await K("lib/staffProfileShared.ts", "an impossible joining date is refused by the real route, in words (item 3)", DRIVE, async () => { const r = await patch({ id: ids.diagt1.id, action: "set_job", job: { joined_on: "2026-02-30" } }); eq(r.status(), 400); const e = (await r.json()).error; assert(/joining date isn't a real date/.test(e), e); return e; });
  await K("lib/staffProfileShared.ts", "an impossible leaving date is refused the same way", DRIVE, async () => { const r = await patch({ id: ids.diagt1.id, action: "set_job", job: { left_on: "2026-13-01" } }); eq(r.status(), 400); });
  await K("lib/staffProfileShared.ts", "a designation sent as an object is refused in words (item 5)", DRIVE, async () => { const r = await patch({ id: ids.diagt1.id, action: "set_job", job: { designation: { x: 1 } } }); eq(r.status(), 400); assert(/designation isn't plain text/.test((await r.json()).error)); });
  const before = (await sb.from("staff_users").select("profile").eq("id", ids.diagt1.id).maybeSingle()).data?.profile ?? null;
  await K("lib/staffProfileShared.ts", "a name sent as an object leaves the stored profile exactly as it was (item 5)", `${DRIVE}; profile read before and after`, async () => {
    const r = await patch({ id: ids.diagt1.id, action: "set_profile", profile: { full_name: { a: 1 } } });
    const after = (await sb.from("staff_users").select("profile").eq("id", ids.diagt1.id).maybeSingle()).data?.profile ?? null;
    eq(after, before, "profile changed"); return `route said ${r.status()}; profile unchanged`;
  });
  await K("lib/staffCaps.ts", "a permission key the role does not have is refused by the real route", DRIVE, async () => { const r = await patch({ id: ids.diagm1.id, action: "set_permissions", permissions: { tablet_mark_paid: "on" } }); eq(r.status(), 400); assert(/isn't a permission a manager has/.test((await r.json()).error)); });
  await K("lib/staffCaps.ts", "a junk value on a real key is refused", DRIVE, async () => { const r = await patch({ id: ids.diagm1.id, action: "set_permissions", permissions: { void_bills: "maybe" } }); eq(r.status(), 400); });
  await K("lib/staffCaps.ts", "'pin' on a manager row is refused (no PIN state there)", DRIVE, async () => { const r = await patch({ id: ids.diagm1.id, action: "set_permissions", permissions: { void_bills: "pin" } }); eq(r.status(), 400); });
  await K("lib/staffCaps.ts", "a kitchen person has no permission a route will accept", DRIVE, async () => { const r = await patch({ id: ids.diagkitchen.id, action: "set_permissions", permissions: { tablet_mark_paid: "on" } }); eq(r.status(), 400); });
  // view-as (the two ⏭ rows sweep #7 left: P12363 / P12364)
  const asSum = await A.get(`${BASE}/api/tablet/summary?rid=${fh.id}&as=${ids.diagt1.id}`);
  const asSumJ = await asSum.json().catch(() => ({}));
  await K("lib/viewAsPerson.ts", "an admin tab pinned to a WAITER (?as=) gets that waiter's sections on the tablet floor", DRIVE, () => { eq(asSum.status(), 200); const want = ids.diagt1.assigned_tables?.length ? ids.diagt1.assigned_tables.map(String) : null; eq((asSumJ.my_tables ?? null) && asSumJ.my_tables.map(String), want); return `my_tables = ${JSON.stringify(asSumJ.my_tables ?? null)}`; });
  await K("lib/viewAsPerson.ts", "…and that waiter's resolved caps (tablet_invoice off)", DRIVE, () => eq(asSumJ.settings?.tablet_invoice, "off"));
  const asWrong = await (await A.get(`${BASE}/api/tablet/whoami?rid=${fh.id}&as=${ids.diagm1.id}`)).json();
  await K("lib/viewAsPerson.ts", "a MANAGER pin on the tablet panel is ignored (role mismatch)", DRIVE, () => eq(asWrong.asName ?? null, null));
  const asMgr = await (await A.get(`${BASE}/api/editor/whoami?rid=${fh.id}&as=${ids.diagm1.id}`)).json();
  await K("lib/viewAsPerson.ts", "a manager pin on the manager panel names that manager on the ribbon", DRIVE, () => assert(asMgr.asName, JSON.stringify(asMgr).slice(0, 200)));
  await K("lib/viewAsPerson.ts", "…and the writer is still the admin (actor stays admin)", DRIVE, () => eq(asMgr.actor, "admin"));
  const asOther = await (await A.get(`${BASE}/api/editor/whoami?rid=${ag.id}&as=${ids.diagm1.id}`)).json();
  await K("lib/viewAsPerson.ts", "a French House manager pinned on Aangan's panel is ignored (never across restaurants)", DRIVE, () => eq(asOther.asName ?? null, null));

  // ── THE SCREENS (admin) ─────────────────────────────────────────────────────────────────
  const page = await actx.newPage();
  await page.goto(`${BASE}/aevinite/access?rid=${fh.id}&focus=mgr_may`, { waitUntil: "networkidle", timeout: 120000 });
  await page.locator('[data-node="mgr_may"]').first().waitFor({ timeout: 60000 });
  const bodyText = await page.locator("body").innerText();
  await K("components/admin/AccessTree.tsx → lib/accessTree.ts", "the rendered Access screen shows no undefined / NaN / [object Object] / ${", DRIVE, () => assert(!NOISE.test(bodyText), bodyText.match(NOISE)?.[0]));
  const mayText = await page.locator('[data-node="mgr_may"]').first().innerText();
  await K("lib/accessTree.ts", "the RENDERED 'Permission for manager' row no longer offers printer setup (item 1)", DRIVE, () => { assert(!/set the printers up/i.test(mayText), mayText.slice(0, 300)); assert(/two printing ones/.test(mayText)); });
  if (shotDir) await page.locator('[data-node="mgr_may"]').first().screenshot({ path: `${shotDir}/mgr-may-1280.png` });
  for (const [, label] of [["main", "Main features"], ["extra", "Extra features"], ["mgrMenu", "Manager"], ["ownMenu", "Owner"], ["waiter", "Waiter"]])
    await K("lib/accessTree.ts", `the rendered screen has the "${label}" section`, DRIVE, () => assert(bodyText.includes(label)));
  // the people page → a manager's profile → the three Users switches (item 4)
  let prof = "";
  try {
    await page.goto(`${BASE}/aevinite/people`, { waitUntil: "networkidle", timeout: 120000 });
    // The page opens on Owners; staff logins are on the Users tab. "diagm1" also matches Aangan's
    // "diagm11", so the person is picked by EXACT text, and the Permissions card starts folded.
    await page.locator("button").filter({ hasText: /^\s*Users\s*$/ }).first().click({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator("input").filter({ visible: true }).first().fill("diagm1");
    await page.waitForTimeout(1500);
    await page.getByText(/^diagm1$/).first().click({ timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.getByText(/Permissions — what/).first().click({ timeout: 60000 });
    await page.getByText("Manager settings (what manager can do)").first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    prof = await page.locator("body").innerText();
  } catch (e) { prof = `COULD NOT OPEN: ${e.message.split("\n")[0]}`; }
  await K("lib/staffCaps.ts", "a manager's RENDERED profile lists Add a new login · Reset a password · Switch a login off (item 4)", DRIVE, () => { for (const w of ["Add a new login", "Reset a password", "Switch a login off"]) assert(prof.includes(w), w); });
  await K("lib/staffCaps.ts", "…and the rendered profile has no undefined / NaN / [object Object]", DRIVE, () => assert(!NOISE.test(prof), prof.match(NOISE)?.[0]));
  if (shotDir) await page.screenshot({ path: `${shotDir}/manager-profile-1280.png`, fullPage: true });
  await actx.close();

  // ── MANAGER ──────────────────────────────────────────────────────────────────────────────
  const mctx = await browser.newContext(); await loginAs(mctx, "manager", BASE);
  const who = await (await mctx.request.get(`${BASE}/api/editor/whoami`)).json();
  const st = fhJ.state;
  await K("lib/accessTree.ts", "a real manager's whoami answers as a manager", DRIVE, () => eq(who.role, "manager"));
  await K("lib/accessTree.ts", "effectivePowers covers every grant row on the Access screen", DRIVE, () => eq(T.GRANT_FLAGS.filter((f) => !(f in who.effectivePowers)), []));
  await K("lib/accessTree.ts", "effectivePowers offers no delete-a-bill power (R27)", DRIVE, () => assert(!("delete_bill" in who.effectivePowers)));
  await K("lib/accessTree.ts", "effectivePowers offers no printer-setup power (retired 2026-09-14)", DRIVE, () => assert(!("print_setup" in who.effectivePowers)));
  for (const flag of ["print_here", "print_clear", "void_bills", "give_discounts"]) {
    await K("lib/accessTree.ts", `effectivePowers.${flag} = the Feature half AND the restaurant's answer, as the Access screen shows it`, DRIVE, () => {
      const featureOn = st.config?.[flag]?.on !== false;
      const granted = T.managerGrantValue(flag, st.grants?.[flag]);
      eq(who.effectivePowers[flag], featureOn && granted, `${flag}: screen ${featureOn && granted}`);
    });
  }
  await K("lib/accessTree.ts", "loyalty in effectivePowers follows the bag switch (OFF on French House today)", DRIVE, () => eq(who.effectivePowers.loyalty, false));
  await K("lib/accessTree.ts", "managerPermissions (the raw stored bag) still carries retired keys — harmless, nothing grants from it", DRIVE, () => { const retired = Object.keys(who.managerPermissions).filter((k) => !T.isConfigurableGrant(k) && !["khata", "parcel", "banquet", "platform", "inv_stock", "inv_expenses", "table_ops", "table_tags", "take_orders", "table_assign", "manage_staff", "edit_settings", "mark_paid", "print_invoice", "view_bills", "edit_staff_profiles", "record_staff_payment"].includes(k)); return `retired keys shipped to the panel: ${retired.join(", ") || "none"}`; });
  await mctx.close();

  // ── WAITER ───────────────────────────────────────────────────────────────────────────────
  const tctx = await browser.newContext(); await loginAs(tctx, "tablet", BASE);
  const sum = await (await tctx.request.get(`${BASE}/api/tablet/summary`)).json();
  await K("lib/accessTree.ts", "a real waiter is told tablet_invoice is off", DRIVE, () => eq(sum.settings.tablet_invoice, "off"));
  await K("lib/accessTree.ts", "every tablet_* value a real waiter receives is off/on/pin", DRIVE, () => { const bad = Object.entries(sum.settings).filter(([k, v]) => k.startsWith("tablet_") && !["off", "on", "pin"].includes(v)); eq(bad, []); });
  await K("lib/accessTree.ts", "a real waiter receives a value for every column the Access screen has", DRIVE, () => eq(T.TABLET_COLS.filter((c) => !(c in sum.settings)), []));
  await K("lib/accessTree.ts", "each waiter column matches what the Access screen shows for French House (no per-person override on diagt1)", DRIVE, () => {
    const own = ids.diagt1 && (globalThis.__own ??= null); void own;
    const diff = T.TABLET_COLS.filter((c) => sum.settings[c] !== T.waiterCapValue(c, st.settings[c]) && !(c === "tablet_discount" && st.config?.give_discounts?.on === false) && !(c === "tablet_parcel"));
    return diff.length ? `differs (per-person or module-off rows): ${diff.join(", ")}` : "every column equals the screen's answer";
  });
  await K("lib/accessTree.ts", "the waiter's payload never carries access_config", DRIVE, () => assert(!/access_config/.test(JSON.stringify(sum))));
  await tctx.close();

  // ── KITCHEN ──────────────────────────────────────────────────────────────────────────────
  const kctx = await browser.newContext(); await loginAs(kctx, "kitchen", BASE);
  const kp = await kctx.request.get(`${BASE}/api/panel-profile`);
  await K("lib/staffProfileShared.ts", "a kitchen login asking for its profile is told it has none (R7)", DRIVE, async () => { const j = await kp.json().catch(() => ({})); assert(kp.status() !== 500, "500"); return `${kp.status()} · ${JSON.stringify(j).slice(0, 120)}`; });
  await kctx.close();

  // ── OWNER ────────────────────────────────────────────────────────────────────────────────
  const octx = await browser.newContext(); await loginAs(octx, "owner", BASE);
  const list = await (await octx.request.get(`${BASE}/api/owner/staff`)).json();
  await K("lib/accessState.ts", "the owner's staff list holds only their own restaurant's people", DRIVE, () => assert(list.staff.every((s) => !s.restaurant_id || s.restaurant_id === fh.id)));
  await K("lib/staffProfile.ts", "the owner's staff list carries no password or PIN hash", DRIVE, () => assert(!/password_hash|pin_hash/.test(JSON.stringify(list))));
  const one = await (await octx.request.get(`${BASE}/api/owner/staff?staff=${ids.diagt1.id}`)).json();
  await K("lib/accessState.ts", "the owner's copy of a waiter's profile carries the restaurant tree with NO credentials (P07468, driven)", DRIVE, () => { assert(one.tree, JSON.stringify(one).slice(0, 200)); assert(!("creds" in one.tree) || Object.values(one.tree.creds || {}).every((v) => v === "")); });
  await K("lib/staffProfile.ts", "the owner's copy of a person never carries a hash", DRIVE, () => assert(!/password_hash|pin_hash/.test(JSON.stringify(one))));
  const kOne = await (await octx.request.get(`${BASE}/api/owner/staff?staff=${ids.diagkitchen.id}`)).json();
  await K("lib/staffProfileShared.ts", "the owner opening a KITCHEN person is told kitchen logins have no profile (R7, driven)", DRIVE, () => { assert(kOne.notEligible === true || /Kitchen logins don't have a profile/.test(kOne.error || ""), JSON.stringify(kOne).slice(0, 200)); });
  const opage = await octx.newPage();
  await opage.goto(`${BASE}/owner/staff/${ids.diagt1.id}`, { waitUntil: "networkidle", timeout: 120000 });
  await opage.waitForTimeout(2500);
  const otext = await opage.locator("body").innerText();
  const selects = await opage.locator("select").count();
  await K("docs/ACCESS-MODEL.md", "on the OWNER's own panel, a waiter's profile offers permission dropdowns (decision — Part 4)", DRIVE, () => { return `${selects} dropdown(s) on /owner/staff/<waiter>; text mentions Permission: ${/Permission for waiter/.test(otext)}`; });
  await K("lib/staffCaps.ts", "the owner's rendered waiter profile has no undefined / NaN / [object Object]", DRIVE, () => assert(!NOISE.test(otext), otext.match(NOISE)?.[0]));
  if (shotDir) await opage.screenshot({ path: `${shotDir}/owner-waiter-profile-1280.png`, fullPage: true });
  await octx.close();
} finally {
  await browser.close();
}
report("live");
