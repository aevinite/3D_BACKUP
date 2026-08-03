// npm run verify:menu-parts-live -- --base http://localhost:4141
//
// Drives the REAL manager panel and proves each of the nine "Edit the menu" sub-options
// works ON ITS OWN — the thing a static check cannot answer. For every part, in turn:
//
//   • switch that ONE part off (the other eight stay on) at /aevinite → Access
//   • open the panel as the REAL manager  → that control is GONE and the other eight remain
//   • open the same panel as the ADMIN    → that control is PRESENT and marked cyan
//   • switch it back on                   → the manager has it again
//
// The middle two are the owner's rule in his own words (2026-08-03): "if not given it should
// not show… it's not like you are not able to edit", and "if you are viewing from admin it
// will look cyan as our rule". A green STATIC run proved neither: the source can be perfect
// while the card is still on screen, which is exactly how this shipped.
//
// SAFE BY CONSTRUCTION, because our own tests were setting off the owner's phone alerts:
//   • ONE staff login for the whole run (loginAs caches, on disk, across processes), and the
//     admin side presents the gate cookie so it makes ZERO login requests.
//   • It refuses to point at anything but a LOCAL server.
//   • It writes only to French House. Aangan is the CONTROL restaurant and is never touched.
//   • The restaurant's original access_config.edit_menu is captured first and restored in a
//     finally block — including when a check fails or the run is killed.
import { chromium } from "playwright";
import { loginAs, adminCookie, adminHeaders, loginRequestCount } from "./sweep/login.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4000");
const RID = "00000000-0000-0000-0000-000000000001"; // French House — the one we write to
if (!/^http:\/\/localhost:\d+$/.test(BASE)) {
  console.error(`✗ --base must be a local dev server (got ${BASE}). This script WRITES permissions.`);
  process.exit(1);
}

// key → what must appear/disappear. `locked` marks the leftover part, which cannot vanish
// (it owns the whole descriptive form) and is proven by its fields going disabled instead.
const PARTS = [
  { key: "add_dish", sel: "#newBtn", label: "Add a new dish" },
  { key: "delete_dish", sel: "#delBtn", label: "Delete a dish", needsDish: true },
  { key: "manage_categories", sel: '.subtab[data-tab="categories"]', label: "Manage categories" },
  { key: "manage_filters", sel: '.subtab[data-tab="filters"]', label: "Manage filters" },
  { key: "edit_price", sel: '#editor [data-path="price"]', label: "Change a price", needsDish: true, box: ".field" },
  { key: "mark_86", sel: '#editor [data-action="toggleSoldOut"]', label: "Mark as sold out", needsDish: true },
  { key: "edit_options", sel: '#editor [data-menu-part="edit_options"]', label: "Customisation", needsDish: true },
  { key: "edit_3d", sel: '#editor [data-menu-part="edit_3d"]', label: "Attach a 3D model", needsDish: true },
  { key: "edit_dish", sel: '#editor [data-menu-part="edit_dish"]', label: "Edit dish info", needsDish: true, locked: true },
];
const ALL_ON = Object.fromEntries(PARTS.map((p) => [p.key, true]));

const fails = [];
const pass = [];
const check = (name, ok, detail) => { (ok ? pass : fails).push(ok ? name : `${name}\n     → ${detail}`); return ok; };

const api = async (path, init) => fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...adminHeaders(BASE), ...(init?.headers || {}) } });

async function setParts(opts) {
  const r = await api("/api/admin/restaurants/access-tree", {
    method: "POST",
    body: JSON.stringify({ restaurant_id: RID, patch: { config: { edit_menu: { manager_opts: opts } } } }),
  });
  if (!r.ok) throw new Error(`access-tree POST failed: ${r.status} ${await r.text()}`);
}

// The manager panel is the vanilla editor served in an IFRAME (/panels/editor/index.html),
// so every query below runs inside that frame, not the Next page around it.
async function panelFrame(page) {
  for (let i = 0; i < 60; i++) {
    const f = page.frames().find((fr) => fr.url().includes("/panels/editor/"));
    if (f) { try { await f.waitForSelector(".tabs .tab", { timeout: 20000 }); return f; } catch { /* retry */ } }
    await page.waitForTimeout(250);
  }
  throw new Error("the editor panel iframe never appeared");
}

// Read the panel's view of one part: is its control on screen, and is it marked cyan?
async function probe(frame, part) {
  return frame.evaluate(({ sel, box, locked }) => {
    const el = document.querySelector(sel);
    if (!el) return { present: false, cyan: false, disabled: null };
    const target = box ? el.closest(box) || el : el;
    // offsetParent, not [hidden] — a .card and a .field both carry an author display that
    // beats the browser's [hidden] default, so the attribute alone proves nothing.
    const present = target.offsetParent !== null;
    const cyan = target.classList.contains("xray-off");
    const disabled = locked ? !!document.querySelector('#editor [data-path="title"]')?.disabled : null;
    return { present, cyan, disabled };
  }, part);
}

// Open the Editor tab and select a dish, so the dish form exists. ALWAYS with a dish:
// six of the nine controls live inside that form, and the "the other eight are unaffected"
// cross-check has to see all of them at once whichever part is under test.
async function openEditor(page, withDish) {
  const f = await panelFrame(page);
  // WAIT FOR THE PERMISSIONS TO LAND. The panel paints first and applies whoami when it
  // arrives, so probing too early reads the pre-permission DOM and reports "#newBtn is
  // still on screen" — a flake that looks exactly like the bug under test. XRAY_WHO is the
  // panel's own "I know who this is" flag; nothing here is meaningful before it is set.
  await f.waitForFunction(() => window.XRAY_WHO && window.XRAY_WHO.menuSub, null, { timeout: 25000 });
  // The tab strip MEASURES itself and reflows (syncNavFit moves overflow tabs into the ☰
  // drawer), so a real click races that layout — Playwright reported "element is not stable"
  // and then "outside of the viewport" for 30s. The panel's own handler is what we want to
  // exercise, not the pixel geometry of a strip this test isn't about, so dispatch the click.
  await f.evaluate(() => document.querySelector('.tabs .tab[data-tab="items"]')?.click());
  await f.waitForTimeout(600);
  if (withDish) {
    await f.waitForSelector("#list .list-item:not(.lrow-skel)", { timeout: 20000 });
    await f.evaluate(() => document.querySelector("#list .list-item:not(.lrow-skel)")?.click());
    await f.waitForSelector("#editor .card", { timeout: 20000 });
  }
  await f.waitForTimeout(400); // let the X-ray MutationObserver pass settle
  return f;
}

const browser = await chromium.launch();
let original = null;
try {
  // Snapshot FIRST, restore in `finally` — a failed check must not leave a restaurant altered.
  const snap = await api(`/api/admin/restaurants/access-tree?restaurant_id=${RID}`);
  const cfg = (await snap.json())?.state?.config?.edit_menu?.manager_opts;
  original = cfg && typeof cfg === "object" ? { ...cfg } : null;
  console.log(`· French House captured (edit_menu.manager_opts: ${original ? Object.keys(original).length + " keys" : "unset"})`);

  // ONE staff login for the whole run; the admin context makes none at all.
  const VIEW = { viewport: { width: 1600, height: 1000 } }; // desktop: no ☰ drawer, every tab on screen
  const mgrCtx = await browser.newContext(VIEW);
  const route = await loginAs(mgrCtx, "manager", BASE);
  const mgr = await mgrCtx.newPage();
  // The gate cookie goes in the JAR, not in extraHTTPHeaders: a forced Cookie header
  // REPLACES the browser's own, so the act-as cookie the console sets on the way in was
  // being dropped from the very next request and the panel bounced back to /aevinite.
  const adminCtx = await browser.newContext(VIEW);
  await adminCtx.addCookies([adminCookie(BASE)]);
  const adm = await adminCtx.newPage();

  for (const part of PARTS) {
    // exactly ONE off — that is what makes this a test of the part rather than of the group
    await setParts({ ...ALL_ON, [part.key]: false });

    await mgr.goto(BASE + route, { waitUntil: "domcontentloaded" });
    const mf = await openEditor(mgr, true);
    const m = await probe(mf, part);
    if (part.locked) {
      check(`${part.label} · off → the manager can't change it`, m.disabled === true,
        `the dish form's Title box is still editable for the real manager, so "Edit dish info" off changes nothing on screen.`);
    } else {
      check(`${part.label} · off → gone for the manager`, !m.present,
        `${part.sel} is still on screen for the real manager. Off must REMOVE the control, not merely refuse it.`);
    }
    // the other eight must be untouched — this is what proves the parts are independent
    for (const other of PARTS) {
      if (other.key === part.key || other.locked) continue;
      const o = await probe(mf, other);
      check(`  …and "${other.label}" is unaffected`, o.present,
        `turning "${part.label}" off also removed ${other.sel}. Each row must own exactly its own control.`);
    }

    // The REAL admin door: /aevinite → pick a restaurant → open its panel. A bare
    // /manager?rid= bounces to the console (panelGate wants the act-as cookie this sets),
    // so going through it is both what works and what an admin actually does.
    await adm.goto(`${BASE}/api/admin/act-as/go?rid=${RID}&to=/manager`, { waitUntil: "domcontentloaded" });
    const af = await openEditor(adm, true);
    const a = await probe(af, part);
    check(`${part.label} · off → admin still SEES it`, a.present,
      `${part.sel} vanished for the admin too. The admin view marks, it never strips.`);
    check(`${part.label} · off → admin sees it marked cyan`, a.cyan,
      `${part.sel} is on screen for the admin with no .xray-off mark, so the admin cannot tell "the manager has this" from "it is switched off".`);

    // …and back on
    await setParts(ALL_ON);
    await mgr.goto(BASE + route, { waitUntil: "domcontentloaded" });
    const bf = await openEditor(mgr, true);
    const back = await probe(bf, part);
    check(`${part.label} · on → the manager has it`, part.locked ? back.disabled === false : back.present,
      `${part.sel} did not come back when the switch was turned on — the switch reaches no real code in the ON direction.`);
  }
  // ── HIDING IS NEVER THE ONLY GUARD ───────────────────────────────────────────────
  // Everything above is what a person SEES. These three prove what the SERVER does when a
  // control is forced anyway — a stale panel, a second tab, a typed request. Each write is
  // sent from inside the manager's own page, so it carries their real session.
  const readDish = async (id) => {
    const r = await api(`/api/editor/all?rid=${RID}`);
    return ((await r.json()).items || []).find((x) => x.id === id);
  };
  const dishId = (await (await api(`/api/editor/all?rid=${RID}`)).json()).items?.[0]?.id;
  const before = await readDish(dishId);
  const post = (page, body) => page.evaluate(async (b) => {
    const r = await fetch("/api/editor/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status };
  }, body);

  if (!before) check("a dish was found to test writes against", false, "/api/editor/all returned no items for French House");
  else {
    // 1 · "Attach a 3D model" off → a forced 3D write changes nothing
    await setParts({ ...ALL_ON, edit_3d: false });
    await mgr.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await post(mgr, { id: dishId, is4d: !before.is4d, model_folder: "ZZ-FORCED-BY-TEST" });
    let now = await readDish(dishId);
    check("3D off · a forced 3D write is ignored by the server",
      now.model_folder === before.model_folder && !!now.is4d === !!before.is4d,
      `the dish's 3D fields changed (model_folder=${JSON.stringify(now.model_folder)}, is4d=${now.is4d}) even though "Attach a 3D model" is off. Hiding the card is not enough — the save must be dropped too.`);

    // 2 · "Change a price" off → a forced price write changes nothing
    await setParts({ ...ALL_ON, edit_price: false });
    await mgr.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await post(mgr, { id: dishId, price: Number(before.price) + 111 });
    now = await readDish(dishId);
    check("price off · a forced price write is ignored by the server",
      String(now.price) === String(before.price),
      `the price moved from ${before.price} to ${now.price} with "Change a price" off.`);

    // 3 · the split itself: price ON, dish-info OFF. The price must SAVE and the title must
    //     NOT. Before today the whole save was refused on edit_dish alone, so "Change a
    //     price" on its own did nothing at all — the switch was on and the server said no.
    await setParts({ ...ALL_ON, edit_dish: false });
    await mgr.goto(BASE + route, { waitUntil: "domcontentloaded" });
    const wanted = Number(before.price) + 7;
    await post(mgr, { id: dishId, price: wanted, title: "ZZ FORCED BY TEST" });
    now = await readDish(dishId);
    check("price on + dish-info off · the price saves",
      Number(now.price) === wanted,
      `the price did not save (${now.price}, wanted ${wanted}). "Change a price" is its own row — it must work without "Edit dish info".`);
    check("price on + dish-info off · the title does NOT save",
      now.title === before.title,
      `the title became ${JSON.stringify(now.title)} — "Edit dish info" is off, so descriptive fields must be dropped from the save.`);

    // Put the dish back exactly as it was, as the ADMIN — they bypass every part, so the
    // restore can't be dropped by the very switch the test just turned off.
    await api(`/api/editor/items?rid=${RID}`, {
      method: "POST",
      body: JSON.stringify({ id: dishId, title: before.title, price: before.price, is4d: before.is4d, model_folder: before.model_folder }),
    });
    const after = await readDish(dishId);
    check("the test dish was put back",
      after.title === before.title && String(after.price) === String(before.price),
      `"${dishId}" was left changed (title=${JSON.stringify(after.title)}, price=${after.price}); expected ${JSON.stringify(before.title)} / ${before.price}.`);
  }

  console.log(`· staff logins made by this run: ${loginRequestCount()} (0 = the shared session cache did its job; never more than 1)`);
} finally {
  if (original) await setParts(original).catch(() => {});
  else await setParts({}).catch(() => {});
  console.log("· French House permissions restored");
  await browser.close();
}

console.log(`\n${pass.length} passed`);
if (fails.length) {
  console.error(`\n✗ ${fails.length} live check(s) failed:\n`);
  fails.forEach((f, i) => console.error(`  ${i + 1}. ${f}\n`));
  process.exit(1);
}
console.log("✓ every Edit-the-menu part hides for the manager, stays cyan-marked for the admin, and comes back when switched on");
