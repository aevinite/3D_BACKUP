// scripts/shot-access-help.mjs — regenerate the Access-panel (i) HELP IMAGES.
//
// Each image is a real screenshot of the panel where a feature lives, with the exact
// control ringed in gold and the panel PATH stamped across the top. Written to
// public/admin-help/<perm.id>.png and wired per-feature in app/aevinite/access/page.tsx
// (SHOT_IDS). The access page prefers <perm.id>.png, falling back to the per-area image.
//
// OWNER RULE (2026-07-24): these images track the live UI. Whenever a panel's UI changes,
// RE-RUN THIS so the affected image refreshes — never leave a stale screenshot.
//
// Usage (dev server running; default :4000, override with SHOT_BASE):
//   SHOT_BASE=http://localhost:4020 node scripts/shot-access-help.mjs
//   node scripts/shot-access-help.mjs guest        # only the guest batch
//   node scripts/shot-access-help.mjs staff        # only the staff batch
//
// Logins: guest needs none; staff use the per-restaurant diag users (french-house).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public", "admin-help");
const BASE = process.env.SHOT_BASE || "http://localhost:4000";
const only = process.argv[2]; // "guest" | "staff" | undefined (both)
fs.mkdirSync(PUB, { recursive: true });
const RID = "00000000-0000-0000-0000-000000000001";
const M = "/r/french-house/menu?table=5";
const LOGIN = { manager: ["diagm1", "diag-mgr-2026", "/manager"], owner: ["diago1", "diag-o1-2026", "/owner"], kitchen: ["diagkitchen", "diag-kitchen-2026", "/kitchen"], tablet: ["diagt1", "diag-t1-2026", "/tablet"] };

const DRAW = `()=>{
  const ring=(el,o)=>{const r=el.getBoundingClientRect();const d=document.createElement('div');d.className='shot-inj';Object.assign(d.style,{position:'fixed',left:(r.left-o.pad)+'px',top:(r.top-o.pad)+'px',width:(r.width+o.pad*2)+'px',height:(r.height+o.pad*2)+'px',borderRadius:o.radius,border:o.border,boxShadow:o.shadow||'none',background:o.bg||'transparent',zIndex:o.z,pointerEvents:'none'});document.body.appendChild(d);};
  const card=document.querySelector('[data-shotcard]'), tgt=document.querySelector('[data-shottgt]');
  if(card) ring(card,{pad:6,radius:'14px',border:'3px solid #e6b800',shadow:'0 0 0 9999px rgba(0,0,0,.34)',z:99998});
  if(tgt&&tgt!==card) ring(tgt,{pad:4,radius:'8px',border:'2.5px solid #e6b800',bg:'rgba(230,184,0,.20)',z:99999});
}`;
const CLEAN = `()=>{document.querySelectorAll('.shot-inj').forEach(e=>e.remove());document.querySelectorAll('[data-shotcard],[data-shottgt]').forEach(e=>{e.removeAttribute('data-shotcard');e.removeAttribute('data-shottgt');});}`;
const asExpr = (body) => "return (()=>{" + body + "})()";
const tagPick = (body) => `()=>{const f=()=>{${body}};const r=f()||[];if(r[0])r[0].setAttribute('data-shotcard','1');if(r[1])r[1].setAttribute('data-shottgt','1');return {card:!!r[0],target:!!r[1]};}`;

let browser, compose;
async function comp(label, w, h, raw, out) {
  const b64 = fs.readFileSync(raw).toString("base64");
  await compose.setViewportSize({ width: w, height: h + 48 });
  await compose.setContent(`<style>*{margin:0;box-sizing:border-box}html,body{background:#111}.b{height:48px;color:#fff;font:700 15px/48px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding-left:16px;border-bottom:2px solid #e6b800;white-space:nowrap;overflow:hidden}img{display:block;width:${w}px;height:${h}px}</style><div class=b>${label}</div><img src="data:image/png;base64,${b64}">`, { waitUntil: "load" });
  await compose.evaluate(() => { const i = document.querySelector("img"); return i && i.decode ? i.decode().catch(() => {}) : null; });
  await compose.waitForTimeout(120);
  await compose.screenshot({ path: out });
}

// ── GUEST batch (no login) ───────────────────────────────────────────────────
const guestJobs = [
  { id: "ratings", url: M, wait: ".dish-meta", label: "Guest menu  ›  dish card  ›  Star rating (★ average)", pick: `const m=[...document.querySelectorAll('.dish-meta')].find(e=>e.textContent.includes('★'));return [m&&m.closest('.item-card'),m];` },
  { id: "reviews", url: "/r/french-house/item/cappuccino?cat=coffee", wait: ".rating-row", vp: [780, 900], label: "Guest menu  ›  dish page  ›  Ratings & written reviews", pick: `const r=document.querySelector('.rating-row');return [r,r];` },
  { id: "model3d", url: M, wait: ".item-card", label: "Guest menu  ›  dish card  ›  3D dish viewer (4D badge)", pick: `const c=document.querySelector('.item-card.is-4d');const b=c&&c.querySelector('.badge-4d');return [c,b||c];` },
  { id: "favorites", url: M, wait: ".filter-chip", label: "Guest menu  ›  filter chips  ›  Favourites (♥ saved dishes)", pick: `const c=[...document.querySelectorAll('.filter-chip')].find(x=>/Favorite/i.test(x.textContent));return [c,c];` },
  { id: "waiter_calls", url: M, wait: ".chef-call", label: "Guest menu  ›  Call-waiter bell", pick: `const c=document.querySelector('.chef-call');return [c,c];` },
  { id: "diet_filter", url: M, wait: ".filter-chip", label: "Guest menu  ›  filter chips  ›  Veg / Non-Veg", pick: `const chips=[...document.querySelectorAll('.filter-chip')];const veg=chips.find(c=>/Veg/.test(c.textContent)&&!/Non/.test(c.textContent));const non=chips.find(c=>/Non-Veg/.test(c.textContent));return [veg&&veg.parentElement,non||veg];` },
  { id: "languages", url: M, wait: ".nav-btn", label: "Guest menu  ›  header  ›  Language picker", pick: `const b=[...document.querySelectorAll('.nav-btn')].find(x=>/Language/.test(x.getAttribute('aria-label')||''));return [b,b];` },
  { id: "currency", url: M, wait: ".nav-btn", label: "Guest menu  ›  header  ›  Currency picker", pick: `const b=[...document.querySelectorAll('.nav-btn')].find(x=>/Currency/.test(x.getAttribute('aria-label')||''));return [b,b];` },
  { id: "allergies", url: M, wait: ".filter-chip", label: "Guest menu  ›  allergy badge / filter", pick: `let el=[...document.querySelectorAll('.filter-chip')].find(c=>/allerg/i.test(c.textContent));if(!el)el=document.querySelector('.diet-badge');return [el&&(el.closest('.item-card')||el),el];` },
  // ── added 2026-08-01: a feature that appears in more than one place needs a picture of EACH.
  // The owner opened "Show reviews" and saw only the dish page ("it also includes the review on
  // the menu page, not only the item detail page"); opened "3D dish viewer" and saw only the
  // working state ("we need 3D preview not available AND view in 3D"); opened "Favourites" and
  // asked for both places a dish can be saved from.
  { id: "reviews-menu", url: M, wait: ".item-card", vp: [900, 700],
    label: "Guest menu  ›  the LIST  ›  a dish's rating & review count",
    pick: `const cards=[...document.querySelectorAll('.item-card')].filter(c=>/★/.test(c.textContent));const c=cards[0];const m=c&&c.querySelector('.dish-meta');return [c&&c.parentElement,c||m];` },
  { id: "model3d-off", url: "/r/french-house/item/espresso?cat=coffee", wait: ".btn", vp: [780, 900],
    label: "Guest menu  ›  dish page  ›  “3D preview not available” (no model on this dish)",
    pick: `const b=[...document.querySelectorAll('.btn')].find(x=>/3D/i.test(x.textContent));return [b&&b.parentElement,b];` },
  { id: "favorites-heart", url: "/r/french-house/item/cappuccino?cat=coffee", wait: ".btn", vp: [780, 900],
    label: "Guest menu  ›  dish page  ›  the ♥ that saves a dish to Favourites",
    pick: `const h=document.getElementById('detail-fav');return [h&&h.parentElement,h];` },
];
async function runGuest() {
  for (const j of guestJobs) {
    const [w, h] = j.vp || [900, 660];
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + j.url, { waitUntil: "networkidle", timeout: 40000 });
      if (j.wait) await page.waitForSelector(j.wait, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
      const found = await page.evaluate(new Function(asExpr("return (" + tagPick(j.pick) + ")()")));
      await page.evaluate(() => document.querySelector("[data-shotcard]")?.scrollIntoView({ block: "center", inline: "center" }));
      await page.waitForTimeout(500);
      await page.evaluate(new Function(asExpr("return (" + DRAW + ")()")));
      await page.waitForTimeout(200);
      const raw = path.join(PUB, `_raw-${j.id}.png`);
      await page.screenshot({ path: raw });
      await comp(j.label, w, h, raw, path.join(PUB, `${j.id}.png`));
      fs.unlinkSync(raw);
      console.log(`✓ guest ${j.id}  card=${found.card} target=${found.target}`);
    } catch (e) { console.log(`✗ guest ${j.id}: ${e.message}`); }
    await ctx.close();
  }
}

// ── STAFF batch (diag logins) ────────────────────────────────────────────────
const clickTab = (t) => `const b=[...document.querySelectorAll('.tab')].find(e=>e.textContent.includes(${JSON.stringify(t)}));b&&b.click();`;
const clickSub = (t) => `const s2=[...document.querySelectorAll('.subtab')].find(e=>e.textContent.trim()===${JSON.stringify(t)});s2&&s2.click();`;
const tabEl = (t) => `const b=[...document.querySelectorAll('.tab')].find(e=>e.textContent.includes(${JSON.stringify(t)}));return [b,b];`;
const navlink = (t) => `const a=[...document.querySelectorAll('.owx-navlink')].find(e=>e.textContent.trim().replace(/Soon$/,'')===${JSON.stringify(t)})||[...document.querySelectorAll('.owx-navlink')].find(e=>e.textContent.includes(${JSON.stringify(t)}));return [a,a];`;
const billCard = `let e=[...document.querySelectorAll('.ord-btn')][0];while(e&&e.offsetHeight<220)e=e.parentElement;return [e,null];`;
// Void / close-unpaid have NO dedicated button yet (owner 2026-07-24: "we'll make the
// button; till then use the Unpaid / regenerate-invoice image"). Ring the bill card +
// tight-highlight its "Unpaid" pill (falling back to the invoice chip).
const billCardUnpaid = `let e=[...document.querySelectorAll('.ord-btn')][0];while(e&&e.offsetHeight<220)e=e.parentElement;const t=(e&&(e.querySelector('.pay-pill.pending')||e.querySelector('.pay-pill')||e.querySelector('.inv-chip')))||null;return [e,t];`;

const editorJobs = [
  { id: "edit_menu", nav: clickTab("Editor") + clickSub("Dishes"), pick: `const b=document.getElementById('newBtn');return [b,b];`, label: "Manager panel  ›  Menu (Editor)  ›  “+ New” dish" },
  { id: "mark_paid", nav: clickTab("Bills"), pick: `const b=[...document.querySelectorAll('.ord-btn.pay')][0];return [b,b];`, label: "Manager panel  ›  Bills  ›  “Mark paid” (settle a bill)" },
  { id: "print_invoice", nav: clickTab("Bills"), pick: `const b=[...document.querySelectorAll('.ord-btn.invoice')][0];return [b,b];`, label: "Manager panel  ›  Bills  ›  “Generate invoice”" },
  { id: "give_discounts", nav: clickTab("Bills"), pick: billCard, label: "Manager panel  ›  Bills  ›  a bill — Discount comes off this bill total" },
  { id: "void_bills", nav: clickTab("Bills"), pick: billCardUnpaid, label: "Manager panel  ›  Bills  ›  ‘Unpaid’ bill — void / regenerate invoice / close (buttons coming)" },
  { id: "khata", nav: clickTab("Bills"), pick: billCard, label: "Manager panel  ›  Bills  ›  a bill — Khata / pay-later (module button coming)" },
  { id: "take_orders", nav: clickTab("Tables"), pick: `const t=[...document.querySelectorAll('.ftile')].find(e=>/New ord|Open|Accept/i.test(e.textContent))||document.querySelector('.ftile');return [t,t];`, label: "Manager panel  ›  Tables  ›  Take / accept a new order" },
  { id: "table_ops", nav: clickTab("Tables"), pick: `const t=[...document.querySelectorAll('.ftile')].find(e=>/Prepar|min|₹/i.test(e.textContent))||document.querySelector('.ftile');return [t,t];`, label: "Manager panel  ›  Tables  ›  KOT ▾ menu (move / merge / split / reprint)" },
  { id: "table_tags", nav: clickTab("Tables"), pick: `const t=document.querySelector('.ftile');return [t,t];`, label: "Manager panel  ›  Tables  ›  Mark VIP / Family / Guest" },
  { id: "banquet", nav: clickTab("Banquet"), pick: tabEl("Banquet"), label: "Manager panel  ›  Banquet  ›  Per-plate event billing" },
  { id: "view_dashboard", nav: clickTab("Dashboard"), pick: tabEl("Dashboard"), label: "Manager panel  ›  Dashboard & reports" },
  { id: "view_ratings", nav: clickTab("Ratings"), pick: tabEl("Ratings"), label: "Manager panel  ›  Ratings & guest feedback" },
  { id: "view_logs", nav: clickTab("Log"), pick: tabEl("Log"), label: "Manager panel  ›  Log  ›  Activity log" },
  { id: "edit_settings", nav: clickTab("Settings"), pick: tabEl("Settings"), label: "Manager panel  ›  Settings  ›  Restaurant configuration" },
];
const ownerJobs = [
  { id: "manage_staff", pick: navlink("Staff & powers"), label: "Owner panel  ›  Staff & powers  ›  Manage staff" },
  { id: "handle_issues", pick: navlink("Feedback & issues"), label: "Owner panel  ›  Feedback & issues (tickets)" },
  { id: "view_customers", pick: navlink("Customers"), label: "Owner panel  ›  Customers list" },
  // ── ONE PICTURE PER ROW OF ACCESS → OWNER (owner, 2026-08-18: "you can do the 16th one too") ──
  // Five of the nine owner rows showed "There wasn't a good picture for this one" although the app
  // HAD a capture of that screen — but of the MANAGER panel, not the owner's. His standing rule is
  // that a picture must be of the thing you are reading about ("if there's no good photo which
  // represents it, don't add any"), so borrowing the manager's would have been the wrong fix.
  // These are the owner's own pages, named for the ROW they belong to, so components/admin/
  // AccessTree.tsx can map them by node id and nothing has to be guessed.
  { id: "own_reports", pick: navlink("Reports"), label: "Owner panel  ›  Reports  (sales, tax, payments, dishes, staff, day book)" },
  { id: "own_customers", pick: navlink("Customers"), label: "Owner panel  ›  Customers  (guests who gave a name or a number)" },
  { id: "own_issues", pick: navlink("Feedback & complaints"), label: "Owner panel  ›  Feedback & complaints" },
  { id: "own_settings", pick: navlink("Settings"), label: "Owner panel  ›  Settings  (their panel, their password, what the restaurant has)" },
  { id: "own_audit", pick: navlink("Audit & logs"), label: "Owner panel  ›  Audit & logs  (what was removed, and the activity log)" },
  { id: "own_access", pick: navlink("Team"), label: "Owner panel  ›  Team  (create staff logins, set what each person may do)" },
  { id: "own_menu", pick: navlink("Menu"), label: "Owner panel  ›  Menu  (the dishes and categories editor)" },
  { id: "own_manager_mode", pick: navlink("Manager mode"), label: "Owner panel  ›  Manager mode  (work the floor as a manager would)" },
];
const panelJobs = {
  manager: [{ id: "panel_manager", pick: `return [null,null];`, label: "Staff apps  ›  Manager panel (the control room)" }],
  kitchen: [{ id: "panel_kitchen", pick: `return [null,null];`, label: "Staff apps  ›  Kitchen display (New → Cooking → Ready)" }, { id: "auto_print_kot", pick: `const s=document.querySelector('.reprint')||document.querySelector('button');return [s,s];`, label: "Kitchen display  ›  ticket 🖨 — Auto-print kitchen tickets (admin hardware setting)" }],
  tablet: [{ id: "panel_tablet", pick: `return [null,null];`, label: "Staff apps  ›  Waiter tablet (floor + take order)" }],
  owner: [{ id: "panel_owner", pick: `return [null,null];`, label: "Staff apps  ›  Owner panel (dashboard, staff, reports)" }],
};
async function runRole(role, jobs, useEditorFrame) {
  const [u, p, route] = LOGIN[role];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1.5 });
  await ctx.request.post(`${BASE}/api/panel-login`, { headers: { "content-type": "application/json" }, data: { username: u, password: p } });
  const page = await ctx.newPage();
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 40000 });
  await page.waitForTimeout(3500);
  const frameOf = () => (useEditorFrame ? page.frames().find((f) => f.url().includes("/panels/")) : null) || page.mainFrame();
  for (const j of jobs) {
    try {
      let fr = frameOf();
      await fr.evaluate(new Function(asExpr("return (" + CLEAN + ")()")));
      if (j.nav) { await fr.evaluate(new Function("return (()=>{" + j.nav + "})()")); await page.waitForTimeout(1400); }
      fr = frameOf();
      const found = await fr.evaluate(new Function(asExpr("return (" + tagPick(j.pick) + ")()")));
      fr = frameOf();
      await fr.evaluate(() => document.querySelector("[data-shotcard]")?.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
      await fr.evaluate(new Function(asExpr("return (" + DRAW + ")()")));
      await page.waitForTimeout(200);
      const raw = path.join(PUB, `_raw-${j.id}.png`);
      await page.screenshot({ path: raw });
      await comp(j.label, 1280, 820, raw, path.join(PUB, `${j.id}.png`));
      fs.unlinkSync(raw);
      console.log(`✓ ${role} ${j.id}  card=${found.card} target=${found.target}`);
    } catch (e) { console.log(`✗ ${role} ${j.id}: ${e.message}`); }
  }
  await ctx.close();
}

// ── run ──────────────────────────────────────────────────────────────────────
browser = await chromium.launch({ headless: true });
compose = await (await browser.newContext({ deviceScaleFactor: 2 })).newPage();
try {
  if (only !== "staff") await runGuest();
  if (only !== "guest") {
    await runRole("manager", editorJobs, true);
    await runRole("owner", ownerJobs, false);
    await runRole("manager", panelJobs.manager, true);
    await runRole("kitchen", panelJobs.kitchen, true);
    await runRole("tablet", panelJobs.tablet, false);
    await runRole("owner", panelJobs.owner, false);
  }
} finally { await browser.close(); }
console.log("access-help images regenerated →", PUB);
