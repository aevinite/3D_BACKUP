// Sweep #8 · T8 · the THIRTEEN rows round 2 could not run, run properly.
//
// Round 2 skipped 13 rows for one honest reason: the Banquet and Inventory modules are ADMIN
// ENTITLEMENTS and both are OFF for this restaurant, and "Rating review" is a manager permission
// this diag manager does not hold. So the tabs were correctly not on screen, and the owner
// console does not list Inventory at all. The owner asked for them anyway ("do whats left"), so
// this script switches the three things on, drives the rows, and puts every one back.
//
// THE RESTORE IS THE POINT. It runs in a `finally` AND on SIGINT/SIGTERM, it restores the exact
// values read before anything was written, and it VERIFIES they are back before the run reports.
// This sweep's own scar is a guard that switched a category off across seven restaurants and then
// died two steps later.
//
//   node scripts/sweep/t8/round2d.mjs [--base http://localhost:4308]
import { checkA, report, eq, browser, ctxAs, pageOf, frameOf, BASE, SLUG, read, ONSCREEN } from "./r2lib.mjs";
import { adminHeaders } from "../login.mjs";

const RID = "00000000-0000-0000-0000-000000000001";        // My Little French House
const H = { ...adminHeaders(BASE), "Content-Type": "application/json" };
const tree = async () => (await (await fetch(`${BASE}/api/admin/restaurants/access-tree?restaurant_id=${RID}`, { headers: H })).json()).state;
const patch = async (p) => fetch(`${BASE}/api/admin/restaurants/access-tree`, { method: "POST", headers: H, body: JSON.stringify({ restaurant_id: RID, patch: p }) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── READ THE WAY BACK BEFORE WRITING ANYTHING ───────────────────────────────────────────────
const before = await tree();
if (!before || !before.settings || !before.grants) {
  console.error("refusing to change a setting: could not read the restore snapshot");
  process.exit(2);
}
const WAS = {
  settings: {
    banquet_allowed: before.settings.banquet_allowed,
    inventory_allowed: before.settings.inventory_allowed,
  },
  grants: { view_ratings: before.grants.view_ratings },
};
console.log("restore point:", JSON.stringify(WAS));

let restored = false;
async function restore(why) {
  if (restored) return;
  restored = true;
  try {
    await patch(WAS);
    const after = await tree();
    const ok = after.settings.banquet_allowed === WAS.settings.banquet_allowed
      && after.settings.inventory_allowed === WAS.settings.inventory_allowed
      && after.grants.view_ratings === WAS.grants.view_ratings;
    console.log(`restore (${why}): ${ok ? "✅ back to exactly what it was" : "❌ MISMATCH — " + JSON.stringify({
      want: WAS, got: { settings: { banquet_allowed: after.settings.banquet_allowed, inventory_allowed: after.settings.inventory_allowed }, grants: { view_ratings: after.grants.view_ratings } } })}`);
  } catch (e) { console.log(`restore (${why}): ❌ THREW — ${e.message}`); }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await restore(sig); process.exit(130); });

let code = 1;
try {
  // ── switch the three things ON ─────────────────────────────────────────────────────────────
  await patch({ settings: { banquet_allowed: true, inventory_allowed: true }, grants: { view_ratings: true } });
  // The server caches settings (~8s) and an owner's restaurant list (30s), so a read taken too
  // soon reports the OLD entitlements — which is how a switch that worked gets filed as a bug.
  // Poll instead of sleeping blind.
  let on = null;
  for (let i = 0; i < 30; i++) {
    on = await tree();
    if (on.settings.banquet_allowed === true && on.settings.inventory_allowed === true && on.grants.view_ratings === true) break;
    await wait(1500);
  }
  await checkA("P99921","with the module switched on, the admin's own screen agrees it is on",()=>
    (on.settings.banquet_allowed===true&&on.settings.inventory_allowed===true&&on.grants.view_ratings===true)
    ||`the switches read ${JSON.stringify({b:on.settings.banquet_allowed,i:on.settings.inventory_allowed,r:on.grants.view_ratings})}`);
  await wait(33000);                                   // clear the panel-access cache (30s TTL)

  /* ── the three tabs, now that they are entitled (P99567/68, P99576/77, P99579/80) ── */
  {
    const c = await ctxAs("manager", { width: 1280, height: 800, dpr: 1 });
    const { page, errors } = await pageOf(c);
    await page.goto(BASE + "/manager", { waitUntil: "networkidle", timeout: 90000 });
    const f = await frameOf(page);
    await page.waitForTimeout(3500);
    for (const [key, label, idA, idB] of [
      ["ratings","Rating review","P99567","P99568"],
      ["banquet","Banquet","P99576","P99577"],
      ["inventory","Inventory","P99579","P99580"]]) {
      const shown = await f.evaluate(({ k, src }) => eval(src)(document.querySelector(`.tab[data-tab="${k}"]`)), { k: key, src: ONSCREEN });
      if (!shown) {
        await checkA(idA,`…and opening ${label} shows something honest`,()=>`the tab is STILL not on screen with the entitlement on — read whoami's effectivePowers for this restaurant`);
        await checkA(idB,`…and it renders no leaked code text`,()=>"not on screen, so nothing to read");
        continue;
      }
      await f.evaluate((k)=>document.querySelector(`.tab[data-tab="${k}"]`).click(), key);
      await page.waitForTimeout(3500);
      const txt = ((await f.evaluate(()=>document.getElementById("editor")?.innerText||"").catch(()=>""))||"").replace(/\s+/g," ").trim();
      await checkA(idA,`…and opening ${label} shows something honest`,()=>txt.length>0||"the pane is empty");
      await checkA(idB,`…and it renders no leaked code text`,()=>
        !/\$\{|\[object Object\]|NaN|undefined/.test(txt)||`it shows "${txt.slice(0,80)}"`);
    }
    // the shell must survive three tabs it had never rendered before
    await checkA("P99922","the shell survived rendering three tabs it had never shown before",async()=>{
      const ok=await f.evaluate(()=>!!document.querySelector(".topbar")&&document.querySelectorAll(".tab[data-tab]").length===10&&!!document.getElementById("editor"));
      return ok||"a piece of the shell was destroyed";
    });
    await checkA("P99923","…and all ten tabs are on screen now, which is the first time that has been true",async()=>{
      const off=await f.evaluate((src)=>{const on=eval(src);
        return [...document.querySelectorAll(".tab[data-tab]")].filter(t=>!on(t)).map(t=>t.dataset.tab);},ONSCREEN);
      return off.length===0||`still hidden: ${off.join(", ")}`;
    });
    await checkA("P99924","…and the nav still fits them, or scrolls rather than overflowing silently",async()=>{
      const over=await f.evaluate(()=>{const nv=document.getElementById("mainTabs");return nv.scrollWidth-nv.clientWidth;});
      const oy=await f.evaluate(()=>getComputedStyle(document.getElementById("mainTabs")).overflowX);
      return (over<=1||/auto|scroll/.test(oy))||`${over}px of overflow with overflow-x: ${oy}`;
    });
    await checkA("P99925","…and nothing threw while rendering them",()=>{
      const real=errors.filter(e=>!/Failed to load resource/.test(e));
      return real.length===0||real.slice(0,3).join(" · ");
    });
    await c.close();
  }
  /* ── the same three tabs at 360px, since two of them had never been drawn on a phone ── */
  {
    const c = await ctxAs("manager", { width: 360, height: 780, dpr: 3 }, { isMobile: true, hasTouch: true });
    const { page, errors } = await pageOf(c);
    await page.goto(BASE + "/manager", { waitUntil: "networkidle", timeout: 90000 });
    const f = await frameOf(page);
    await page.waitForTimeout(3500);
    await f.evaluate(()=>document.getElementById("navBurger").click());
    await page.waitForTimeout(600);
    await checkA("P99926","on a phone, the two module tabs appear in the drawer with the rest",async()=>{
      const missing=[];
      for (const k of ["banquet","inventory","ratings"]) {
        const on=await f.evaluate(({k,src})=>eval(src)(document.querySelector(`.tab[data-tab="${k}"]`)),{k,src:ONSCREEN});
        if(!on) missing.push(k);
      }
      return missing.length===0||`not in the drawer: ${missing.join(", ")}`;
    });
    await checkA("P99927","…and none of their labels is cut off at 360px",async()=>{
      const cut=await f.evaluate(()=>{const nav=document.getElementById("mainTabs").getBoundingClientRect();
        return [...document.querySelectorAll('.tab[data-tab="banquet"] .tab-lbl, .tab[data-tab="inventory"] .tab-lbl, .tab[data-tab="ratings"] .tab-lbl')]
          .filter(l=>{const r=l.getBoundingClientRect();
            return r.width>0&&(l.scrollWidth-l.clientWidth>1||r.right>nav.right+1);}).map(l=>l.textContent.trim());});
      return cut.length===0||`cut off: ${cut.join(", ")}`;
    });
    await f.evaluate(()=>document.getElementById("navClose").click());
    await page.waitForTimeout(400);
    await c.close();
  }
  /* ── the owner console's Inventory screen, now that the module is on ── */
  {
    const c = await ctxAs("owner", { width: 1440, height: 900, dpr: 1 });
    const { page, errors } = await pageOf(c);
    let landed=null, frames=0, src=null, panelText="", theme=null, insets=null, status=null;
    try {
      const r = await page.goto(BASE + "/owner/inventory", { waitUntil: "networkidle", timeout: 90000 });
      status = r && r.status();
      landed = new URL(page.url()).pathname;
      const manage = page.locator('button:has-text("Manage")').first();
      if (await manage.count()) { await manage.click().catch(()=>{}); await page.waitForTimeout(4000); }
      frames = await page.locator(".emb-frame, iframe").count();
      if (frames) {
        src = await page.locator(".emb-frame, iframe").first().getAttribute("src");
        const fr = await (await page.locator(".emb-frame, iframe").first().elementHandle()).contentFrame();
        if (fr) {
          await fr.waitForSelector("#editor", { timeout: 30000 }).catch(()=>{});
          await page.waitForTimeout(2000);
          panelText = ((await fr.evaluate(()=>document.getElementById("editor")?.innerText||"").catch(()=>""))||"").replace(/\s+/g," ").trim();
          theme = await fr.evaluate(()=>document.documentElement.getAttribute("data-theme")).catch(()=>null);
          insets = await fr.evaluate(()=>["--safe-t","--safe-b","--safe-l","--safe-r"].map(k=>document.documentElement.style.getPropertyValue(k)).join(",")).catch(()=>null);
        }
      }
    } catch (e) { status = "threw: " + e.message.slice(0, 60); }
    const real = errors.filter(e=>!/Failed to load resource/.test(e));
    await c.close();
    await checkA("P99466","the owner console → Inventory is reachable once the module is on",()=>
      (landed==="/owner/inventory")||`it forwarded to ${landed} (status ${status})`);
    await checkA("P99467","…and it mounts an embedded panel",()=>frames>=1||`${frames} frame(s)`);
    await checkA("P99468","…and the document it mounts is THIS shell, not a copy",()=>
      /\/panels\/editor\/index\.html/.test(src||"")||`src is ${String(src).slice(0,70)}`);
    await checkA("P99928","…carrying the inventory-only flag, so the tab IS the whole panel there",()=>
      /invonly=1/.test(src||"")||`src is ${String(src).slice(0,70)}`);
    await checkA("P99469","…and the panel inside it renders something, not a blank box",()=>
      panelText.length>0||"the panel's own area is empty");
    await checkA("P99470","…and it has a skin set before paint",()=>/^(light|dark)$/.test(theme||"")||`data-theme is ${theme}`);
    await checkA("P99471","…and the phone's insets were pushed into it, like every other surface",()=>
      /^(-?\d+(\.\d+)?px,){3}-?\d+(\.\d+)?px$/.test(insets||"")||`insets are ${insets}`);
    await checkA("P99472","…and no leaked code text is on its screen",()=>
      !/\$\{|\[object Object\]|NaN|undefined/.test(panelText)||`it shows "${panelText.slice(0,70)}"`);
    await checkA("P99929","…and nothing threw while opening it",()=>real.length===0||real.slice(0,2).join(" · "));
    await checkA("P99930","…and it does NOT open on the floor — it is the inventory screen",()=>
      !/Table view/.test(panelText)||"the Inventory embed opened on the floor");
  }
  code = report("T8 · the thirteen rows round 2 could not run");
} finally {
  await restore("end of run");
  await browser.close().catch(()=>{});
}
process.exit(code ? 1 : 0);
