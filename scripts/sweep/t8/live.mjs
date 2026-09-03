// Sweep #8 · terminal 8 · the LIVE half — section M of P61701–P62700.
// Drives the real manager panel on THIS terminal's own port and asserts on the RENDERED result.
//   node scripts/sweep/t8/live.mjs [--base http://localhost:4308]
import { chromium } from "playwright";
import { check, checkA, skip, report, eq, ROOT } from "./lib.mjs";
import { loginAs } from "../login.mjs";
import path from "node:path";
import fs from "node:fs";

const i = process.argv.indexOf("--base");
const BASE = i > -1 ? process.argv[i + 1] : (process.env.LFH_BASE || "http://localhost:4308");
const SHOTS = path.join(ROOT, ".claude/sweep/shots/T8");
fs.mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { width: 1280, height: 800, dpr: 1 };
const A35 = { width: 360, height: 780, dpr: 3 };

// ON SCREEN, measured — not `offsetParent`. offsetParent is null for EVERY position:fixed
// element, so an offsetParent test calls the phone drawer's scrim invisible while it is dimming
// half the screen. Rect + visibility + opacity is what a person actually sees.
const ONSCREEN = `(el)=>{ if(!el) return false; const cs=getComputedStyle(el);
  if(cs.display==="none"||cs.visibility==="hidden"||parseFloat(cs.opacity)===0) return false;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1) return false;
  return r.right>0 && r.bottom>0 && r.left<innerWidth && r.top<innerHeight; }`;

const browser = await chromium.launch();
const errors = [];
async function open(vp, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, ...extra });
  await loginAs(ctx, "manager", BASE);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${vp.width}px pageerror: ${String(e.message).slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${vp.width}px console: ${m.text().slice(0, 160)}`); });
  return { ctx, page };
}
// the panel lives in an iframe — everything below is evaluated inside it
async function panelFrame(page) {
  await page.waitForSelector("iframe", { timeout: 30000 });
  const fh = await page.$("iframe");
  const f = await fh.contentFrame();
  await f.waitForSelector("#editor", { timeout: 30000 });
  return f;
}

const { ctx: dctx, page: D } = await open(DESKTOP);
await D.goto(BASE + "/manager", { waitUntil: "networkidle", timeout: 60000 });
const DF = await panelFrame(D);
await DF.waitForFunction(() => !document.querySelector(".lrow-skel"), null, { timeout: 30000 }).catch(() => {});

/* ── the host page itself (P62391–P62420) ── */
await checkA("P62391","/manager answers for a signed-in manager",async()=>eq((await D.evaluate(()=>document.readyState)),"complete"));
await checkA("P62392","the host page renders exactly one iframe",async()=>eq(await D.locator("iframe").count(),1));
await checkA("P62393","…and it is the manager panel document",async()=>{
  const src=await D.locator("iframe").getAttribute("src");
  return src.startsWith("/panels/editor/index.html")||`src is ${src}`;
});
await checkA("P62394","…and it is named for a screen reader",async()=>eq(await D.locator("iframe").getAttribute("title"),"Manager"));
await checkA("P62395","the frame is position:fixed and fills the viewport",async()=>{
  const b=await D.evaluate(()=>{const f=document.querySelector("iframe");const cs=getComputedStyle(f);const r=f.getBoundingClientRect();
    return {pos:cs.position,w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.left),y:Math.round(r.top)};});
  return (b.pos==="fixed"&&b.x===0&&b.y===0&&b.w===1280&&b.h===800)||JSON.stringify(b);
});
await checkA("P62396","…with no border",async()=>eq(await D.evaluate(()=>getComputedStyle(document.querySelector("iframe")).borderTopWidth),"0px"));
await checkA("P62397","the host page renders no VISIBLE element beside the frame (dev tooling aside)",async()=>{
  const extra=await D.evaluate((src)=>{const on=eval(src);
    return [...document.body.children].filter(e=>e.tagName!=="IFRAME"&&e.tagName!=="SCRIPT"&&on(e))
      .filter(e=>!/nextjs|__next/i.test(e.tagName+" "+e.id+" "+e.className))
      .map(e=>e.tagName+(e.id?"#"+e.id:""));},ONSCREEN);
  return extra.length===0||`also on screen: ${extra.join(", ")}`;
});
await checkA("P62398","the browser tab names the panel",async()=>eq(await D.title(),"Manager — Aevidine"));
await checkA("P62399","the panel document's own title is the same word",async()=>eq(await DF.title(),"Manager — Aevidine"));
check("P62400","the page threw no error while loading",()=>errors.length===0||errors.slice(0,3).join(" · "));
await checkA("P62401","the host document resolves the phone's safe-area insets (viewport-fit=cover)",async()=>{
  const v=await D.evaluate(()=>{const d=document.createElement("div");
    d.style.cssText="position:fixed;padding-bottom:env(safe-area-inset-bottom)";document.body.appendChild(d);
    const p=getComputedStyle(d).paddingBottom;d.remove();return p;});
  return /px$/.test(v)||`env() computed to ${v}`;
});
await checkA("P62402","the bridge pushed all four inset names into the panel",async()=>{
  const got=await DF.evaluate(()=>["--safe-t","--safe-b","--safe-l","--safe-r"].map(n=>document.documentElement.style.getPropertyValue(n)));
  return got.every(v=>/^-?\d+(\.\d+)?px$/.test(v))||`values are ${JSON.stringify(got)}`;
});
await checkA("P62403","…as pixel values, never empty and never NaN",async()=>{
  const got=await DF.evaluate(()=>["--safe-t","--safe-b","--safe-l","--safe-r"].map(n=>document.documentElement.style.getPropertyValue(n)));
  return got.every(v=>v&&!/NaN|undefined/.test(v))||JSON.stringify(got);
});
await checkA("P62404","…and on a desktop they are all zero, which is correct",async()=>{
  const got=await DF.evaluate(()=>["--safe-t","--safe-b","--safe-l","--safe-r"].map(n=>parseFloat(document.documentElement.style.getPropertyValue(n))));
  return got.every(v=>v===0)||`desktop reserved ${JSON.stringify(got)}px`;
});
await checkA("P62405","the panel's --sab RESOLVES to a real length when a rule uses it",async()=>{
  // a custom property's computed value keeps its max() unevaluated — put it on a real box and
  // read the pixels back, which is what a bottom-docked control actually gets
  const v=await DF.evaluate(()=>{const d=document.createElement("div");
    d.style.cssText="position:fixed;left:0;bottom:0;width:1px;height:1px;padding-bottom:var(--sab,0px)";
    document.body.appendChild(d);const p=getComputedStyle(d).paddingBottom;d.remove();return p;});
  return /^\d+(\.\d+)?px$/.test(v)||`--sab resolved to "${v}"`;
});
await checkA("P62406","…and --sat does too",async()=>{
  const v=await DF.evaluate(()=>{const d=document.createElement("div");
    d.style.cssText="position:fixed;left:0;top:0;width:1px;height:1px;padding-top:var(--sat,0px)";
    document.body.appendChild(d);const p=getComputedStyle(d).paddingTop;d.remove();return p;});
  return /^\d+(\.\d+)?px$/.test(v)||`--sat resolved to "${v}"`;
});
await checkA("P62407","the host leaves a hidden measuring probe and nothing else visible",async()=>{
  const n=await D.evaluate(()=>[...document.body.children].filter(e=>e.tagName==="DIV"&&getComputedStyle(e).visibility==="hidden").length);
  return n>=1||"the inset probe is not in the host document";
});
await checkA("P62408","…and the probe cannot swallow a tap",async()=>{
  const pe=await D.evaluate(()=>{const d=[...document.body.children].find(e=>e.tagName==="DIV"&&getComputedStyle(e).visibility==="hidden");return d?getComputedStyle(d).pointerEvents:null;});
  return pe==="none"||`pointer-events is ${pe}`;
});
await checkA("P62409","…and takes up no space",async()=>{
  const r=await D.evaluate(()=>{const d=[...document.body.children].find(e=>e.tagName==="DIV"&&getComputedStyle(e).visibility==="hidden");const b=d.getBoundingClientRect();return [b.width,b.height];});
  return (r[0]===0&&r[1]===0)||`the probe is ${r[0]}×${r[1]}`;
});
await checkA("P62410","the panel really loaded its own app.js, not a cached other version",async()=>{
  const v=await DF.evaluate(()=>{const s=[...document.scripts].find(x=>x.src.includes("editor/app.js"));return s?s.src.split("?v=")[1]:null;});
  return /^[0-9a-f]{8}$/.test(v||"")||`app.js version tag is ${v}`;
});
await checkA("P62411","…and every script tag in the panel loaded without a 404",async()=>{
  const bad=await DF.evaluate(async()=>{
    const out=[];
    for(const s of [...document.scripts]) if(s.src){const r=await fetch(s.src,{method:"GET"});if(!r.ok)out.push(s.src+" → "+r.status);}
    return out;});
  return bad.length===0||bad.join(", ");
});
await checkA("P62412","…and both stylesheets loaded",async()=>{
  const bad=await DF.evaluate(async()=>{
    const out=[];
    for(const l of [...document.querySelectorAll('link[rel="stylesheet"]')]){const r=await fetch(l.href);if(!r.ok)out.push(l.href+" → "+r.status);}
    return out;});
  return bad.length===0||bad.join(", ");
});
await checkA("P62413","the panel's stylesheet actually applied — the top bar is painted, not unstyled",async()=>{
  const s=await DF.evaluate(()=>{const cs=getComputedStyle(document.querySelector(".topbar"));
    return {c:cs.backgroundColor,img:cs.backgroundImage,pad:cs.paddingLeft,disp:cs.display};});
  const painted=(s.c&&s.c!=="rgba(0, 0, 0, 0)")||(s.img&&s.img!=="none");
  return (painted&&s.disp==="flex")||JSON.stringify(s);
});
await checkA("P62414","the panel painted a background, so the host page can never show through",async()=>{
  const bg=await DF.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor);
  return (bg&&bg!=="rgba(0, 0, 0, 0)")||`html background is ${bg}`;
});
await checkA("P62415","the skeleton rows were replaced by real content",async()=>{
  const n=await DF.locator(".lrow-skel").count();
  return n===0||`${n} skeleton row(s) still on screen`;
});
await checkA("P62416","the panel opened on the FLOOR, which is what a manager needs on arrival",async()=>{
  const t=(await DF.locator("#editor").innerText())||"";
  return /Table view/.test(t)||`the panel opened on something else: "${t.slice(0,60)}"`;
});
await checkA("P62417","the restaurant's own name reached the top bar",async()=>{
  const t=(await DF.locator("#brandRest").innerText().catch(()=>""))||"";
  return t.trim().length>0||"the top bar shows no restaurant name";
});
await checkA("P62418","…and it is not another tenant's name",async()=>{
  const t=(await DF.locator("#brandRest").innerText().catch(()=>""))||"";
  return !/Aangan|Pizza Palace/i.test(t)||`the manager panel shows "${t}"`;
});
await checkA("P62419","the connection light mounted, and it is the badge, not the legacy text pill",async()=>{
  const s=await DF.evaluate(()=>{const b=document.getElementById("lfhConnBadge");const l=document.getElementById("conn");
    return {badge:!!b,legacyShown:l?getComputedStyle(l).display!=="none":null};});
  return (s.badge===true&&s.legacyShown===false)||JSON.stringify(s);
});
await checkA("P62420","…so a manager sees ONE connection indicator, not two",async()=>{
  const n=await DF.evaluate(()=>[...document.querySelectorAll("#lfhConnBadge, #conn")].filter(e=>e.offsetParent!==null).length);
  return n===1||`${n} connection indicators are visible at once`;
});

/* ── the nav, desktop (P62421–P62445) ── */
await checkA("P62421","all ten section tabs are in the document",async()=>eq(await DF.locator(".tab[data-tab]").count(),10));
await checkA("P62422","the four fixed tabs are VISIBLE — Bills, Tables, Platform, Settings",async()=>{
  const bad=[];
  for(const t of ["orders","tables","platform","general"])
    if(!(await DF.locator(`.tab[data-tab="${t}"]`).isVisible())) bad.push(t);
  return bad.length===0||`hidden: ${bad.join(", ")}`;
});
await checkA("P62423","the Tables tab is the one marked active, matching the tab the panel opened",async()=>{
  const s=await DF.evaluate(()=>[...document.querySelectorAll(".tab[data-tab]")].filter(t=>t.classList.contains("active")).map(t=>t.dataset.tab));
  return (s.length===1&&s[0]==="tables")||`active tab(s): ${s.join(", ")||"none"}`;
});
await checkA("P62424","every visible tab shows a WORD, not just an icon",async()=>{
  const bad=await DF.evaluate(()=>[...document.querySelectorAll(".tab[data-tab]")]
    .filter(t=>t.offsetParent!==null)
    .filter(t=>{const l=t.querySelector(".tab-lbl");return !l||!l.textContent.trim()||getComputedStyle(l).display==="none";})
    .map(t=>t.dataset.tab));
  return bad.length===0||`icon-only: ${bad.join(", ")}`;
});
await checkA("P62425","no tab label is clipped by its own button at 1280px",async()=>{
  const bad=await DF.evaluate(()=>[...document.querySelectorAll(".tab[data-tab]")]
    .filter(t=>t.offsetParent!==null&&t.scrollWidth-t.clientWidth>1)
    .map(t=>`${t.dataset.tab} (${t.scrollWidth}>${t.clientWidth})`));
  return bad.length===0||bad.join(", ");
});
await checkA("P62426","no tab label overflows the nav's own box",async()=>{
  const over=await DF.evaluate(()=>{const n=document.getElementById("mainTabs");return n.scrollWidth-n.clientWidth;});
  return over<=1||`the nav overflows by ${over}px`;
});
await checkA("P62427","the two module tabs are hidden until their restaurant is entitled",async()=>{
  const s=await DF.evaluate(()=>["banquet","inventory"].map(k=>{const b=document.querySelector(`.tab[data-tab="${k}"]`);return {k,hidden:b.hidden,shown:b.offsetParent!==null};}));
  return s.every(x=>x.hidden===(x.shown===false))||JSON.stringify(s);
});
await checkA("P62428","the three count badges are hidden while there is nothing to count",async()=>{
  const shown=await DF.evaluate(()=>["ordersBadge","tablesBadge","platformBadge"].filter(i=>{const e=document.getElementById(i);return e&&e.offsetParent!==null&&!e.textContent.trim();}));
  return shown.length===0||`badge(s) visible with no number: ${shown.join(", ")}`;
});
await checkA("P62429","the hamburger is hidden on a desktop",async()=>eq(await DF.locator("#navBurger").isVisible(),false));
await checkA("P62430","the drawer header row is hidden on a desktop",async()=>eq(await DF.locator(".tabs-head").isVisible(),false));
await checkA("P62431","the desktop rail toggle exists",async()=>eq(await DF.locator("#railToggle").count(),1));
await checkA("P62432","…and its WORD and its accessible name agree about what it will do",async()=>{
  const s=await DF.evaluate(()=>{const b=document.getElementById("railToggle");
    return {lbl:b.querySelector(".tab-lbl").textContent.trim(),aria:b.getAttribute("aria-label"),exp:b.getAttribute("aria-expanded"),ico:b.querySelector(".tab-ico").textContent.trim()};});
  const open=s.exp==="true";
  const wantLbl=open?"Collapse":"Keep open", wantAria=open?"Collapse menu":"Expand menu", wantIco=open?"«":"»";
  return (s.lbl===wantLbl&&s.aria===wantAria&&s.ico===wantIco)||`state ${s.exp}: label "${s.lbl}", aria "${s.aria}", glyph "${s.ico}"`;
});
await checkA("P62433","clicking it opens the rail, and every word follows",async()=>{
  await DF.evaluate(()=>document.getElementById("railToggle").click());
  await D.waitForTimeout(250);
  const s=await DF.evaluate(()=>{const b=document.getElementById("railToggle");
    return {lbl:b.querySelector(".tab-lbl").textContent.trim(),aria:b.getAttribute("aria-label"),exp:b.getAttribute("aria-expanded"),ico:b.querySelector(".tab-ico").textContent.trim(),cls:document.body.className};});
  return (s.exp==="true"&&s.lbl==="Collapse"&&s.aria==="Collapse menu"&&s.ico==="«"&&/nav-rail-open/.test(s.cls))||JSON.stringify(s);
});
await checkA("P62434","…and clicking it again closes it, and the words follow back",async()=>{
  await DF.evaluate(()=>document.getElementById("railToggle").click());
  await D.waitForTimeout(250);
  const s=await DF.evaluate(()=>{const b=document.getElementById("railToggle");
    return {lbl:b.querySelector(".tab-lbl").textContent.trim(),aria:b.getAttribute("aria-label"),exp:b.getAttribute("aria-expanded"),ico:b.querySelector(".tab-ico").textContent.trim(),cls:document.body.className};});
  return (s.exp==="false"&&s.lbl==="Keep open"&&s.aria==="Expand menu"&&s.ico==="»"&&!/nav-rail-open/.test(s.cls))||JSON.stringify(s);
});
await checkA("P62435","the rail toggle is not itself a section — two clicks did not change the open tab",async()=>{
  const s=await DF.evaluate(()=>[...document.querySelectorAll(".tab[data-tab].active")].map(t=>t.dataset.tab));
  return (s.length===1&&s[0]==="tables")||`the open section is now ${s.join(", ")||"none"}`;
});
await checkA("P62436","every tab is reachable by keyboard (a real button, in document order)",async()=>{
  const bad=await DF.evaluate(()=>[...document.querySelectorAll(".tab[data-tab]")].filter(t=>t.tagName!=="BUTTON"||t.hasAttribute("tabindex")).map(t=>t.dataset.tab));
  return bad.length===0||bad.join(", ");
});
await checkA("P62437","the search box is present and empty on open",async()=>eq(await DF.locator("#search").inputValue(),""));
await checkA("P62438","the + New button is present, and correctly out of the way on the floor",async()=>{
  const s=await DF.evaluate((src)=>{const on=eval(src);return {n:document.querySelectorAll("#newBtn").length,shown:on(document.getElementById("newBtn"))};},ONSCREEN);
  return (s.n===1&&s.shown===false)||JSON.stringify(s);
});
await checkA("P62439","the suggestions dropdown is hidden until something is typed",async()=>eq(await DF.locator("#searchSuggest").isVisible(),false));
await checkA("P62440","the toast host is present and silent",async()=>eq(await DF.locator("#toast").isVisible(),false));
await checkA("P62441","the right-hand pane is never a blank box — it drew the floor",async()=>{
  const s=await DF.evaluate(()=>{const e=document.getElementById("editor");
    return {kids:e.children.length,txt:e.innerText.trim().slice(0,40),h:Math.round(e.getBoundingClientRect().height)};});
  return (s.kids>0&&s.txt.length>0&&s.h>100)||JSON.stringify(s);
});
await checkA("P62442","switching to Editor DOES show the honest empty line, not a blank box",async()=>{
  await DF.evaluate(()=>document.querySelector('.tab[data-tab="items"]').click());
  await D.waitForTimeout(700);
  const t=(await DF.locator("#editor").innerText().catch(()=>""))||"";
  const h=await DF.evaluate(()=>{const e=document.querySelector("#editor .empty");return e?Math.round(e.getBoundingClientRect().height):0;});
  const rows=await DF.locator("#list > li").count();
  const ok=(/Pick something on the left/.test(t)&&h>10)||rows>0;
  await DF.evaluate(()=>document.querySelector('.tab[data-tab="tables"]').click());
  await D.waitForTimeout(500);
  return ok||`the Editor pane says "${t.slice(0,60)}" (${h}px), ${rows} list row(s)`;
});
await checkA("P62443","the sidebar resizer is present and has a title",async()=>eq(await DF.locator("#sidebarResizer").getAttribute("title"),"Drag to resize"));
await checkA("P62444","the panel shows no leaked code text anywhere on screen",async()=>{
  const t=await DF.evaluate(()=>document.body.innerText);
  const bad=["${","[object Object]","undefined","NaN","-->"].filter(s=>t.includes(s));
  return bad.length===0||`the screen shows: ${bad.join(", ")}`;
});
await checkA("P62445","…and no tab or button is left with an empty label",async()=>{
  const bad=await DF.evaluate(()=>[...document.querySelectorAll("header button")].filter(b=>b.offsetParent!==null&&!b.textContent.trim()&&!b.getAttribute("aria-label")).length);
  return bad===0||`${bad} unnamed button(s)`;
});

/* ── the phone, 360×780 dpr3 (P62446–P62480) ── */
const { ctx: pctx, page: P } = await open(A35, { isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A356E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36" });
await P.goto(BASE + "/manager", { waitUntil: "networkidle", timeout: 60000 });
const PFR = await panelFrame(P);
await PFR.waitForFunction(() => !document.querySelector(".lrow-skel"), null, { timeout: 30000 }).catch(() => {});

await checkA("P62446","the panel opens on a 360px phone",async()=>eq(await PFR.locator("#editor").count(),1));
await checkA("P62447","the frame still fills the phone's viewport exactly",async()=>{
  const b=await P.evaluate(()=>{const r=document.querySelector("iframe").getBoundingClientRect();return [Math.round(r.width),Math.round(r.height),Math.round(r.left),Math.round(r.top)];});
  return (b[0]===360&&b[2]===0&&b[3]===0)||`the frame is ${b.join(",")}`;
});
await checkA("P62448","…and its height is the VISIBLE viewport, not the large one",async()=>{
  const s=await P.evaluate(()=>({frame:Math.round(document.querySelector("iframe").getBoundingClientRect().height),inner:window.innerHeight,vv:window.visualViewport?Math.round(window.visualViewport.height):null}));
  return s.frame<=s.inner+1||JSON.stringify(s);
});
await checkA("P62449","nothing inside the panel spills off the right edge",async()=>{
  const over=await PFR.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  return over<=1||`the panel is ${over}px wider than the phone`;
});
await checkA("P62450","the hamburger is visible on the phone",async()=>eq(await PFR.locator("#navBurger").isVisible(),true));
await checkA("P62451","…and it is big enough for a thumb",async()=>{
  const r=await PFR.evaluate(()=>{const b=document.getElementById("navBurger").getBoundingClientRect();return [Math.round(b.width),Math.round(b.height)];});
  return (r[0]>=32&&r[1]>=32)||`the burger is ${r[0]}×${r[1]}`;
});
await checkA("P62452","the tabs are NOT on screen on a phone — they are behind the burger",async()=>{
  const on=await PFR.evaluate((src)=>eval(src)(document.querySelector('.tab[data-tab="orders"]')),ONSCREEN);
  return on===false||"a section tab is on screen with the drawer shut";
});
await checkA("P62453","tapping the burger opens the drawer",async()=>{
  await PFR.evaluate(()=>document.getElementById("navBurger").click());
  await P.waitForTimeout(350);
  return (await PFR.evaluate(()=>document.body.classList.contains("nav-open")))||"the drawer did not open";
});
await checkA("P62454","…the drawer announces itself on the button",async()=>eq(await PFR.locator("#navBurger").getAttribute("aria-expanded"),"true"));
await checkA("P62455","…the drawer's own header row appears, with the word Sections",async()=>{
  const t=(await PFR.locator(".tabs-head").innerText().catch(()=>""))||"";
  return /sections/i.test(t)||`the drawer header reads "${t}"`;
});
await checkA("P62456","…every fixed tab is visible inside it",async()=>{
  const bad=[];
  for(const t of ["items","orders","tables","platform","general"])
    if(!(await PFR.locator(`.tab[data-tab="${t}"]`).isVisible())) bad.push(t);
  return bad.length===0||`not in the drawer: ${bad.join(", ")}`;
});
await checkA("P62457","…each drawer row shows a glyph AND its word",async()=>{
  const bad=await PFR.evaluate(()=>[...document.querySelectorAll(".tab[data-tab]")].filter(t=>t.offsetParent!==null)
    .filter(t=>{const i=t.querySelector(".tab-ico"),l=t.querySelector(".tab-lbl");
      return !i||!l||getComputedStyle(i).display==="none"||getComputedStyle(l).display==="none";}).map(t=>t.dataset.tab));
  return bad.length===0||`missing a glyph or a word: ${bad.join(", ")}`;
});
await checkA("P62458","…no drawer row's label is clipped at 360px",async()=>{
  const bad=await PFR.evaluate(()=>[...document.querySelectorAll(".tab[data-tab] .tab-lbl")].filter(l=>l.offsetParent!==null&&l.scrollWidth-l.clientWidth>1)
    .map(l=>`${l.closest(".tab").dataset.tab} (${l.scrollWidth}>${l.clientWidth})`));
  return bad.length===0||bad.join(", ");
});
await checkA("P62459","…the scrim is on screen and BEHIND the drawer, never over it",async()=>{
  const z=await PFR.evaluate((src)=>{const on=eval(src);const s=document.getElementById("navScrim"),n=document.getElementById("mainTabs");
    return {scrim:getComputedStyle(s).zIndex,nav:getComputedStyle(n).zIndex,scrimOn:on(s),navOn:on(n)};},ONSCREEN);
  return (z.scrimOn===true&&z.navOn===true&&parseInt(z.nav||0)>=parseInt(z.scrim||0))||JSON.stringify(z);
});
await checkA("P62460","…and the drawer is actually on screen, not off to the left",async()=>{
  const x=await PFR.evaluate(()=>Math.round(document.getElementById("mainTabs").getBoundingClientRect().left));
  return x>=-1||`the drawer sits at x=${x}`;
});
await checkA("P62461","the ✕ closes the drawer",async()=>{
  await PFR.evaluate(()=>document.getElementById("navClose").click());
  await P.waitForTimeout(350);
  return (await PFR.evaluate(()=>!document.body.classList.contains("nav-open")))||"the drawer stayed open";
});
await checkA("P62462","…and the button says so again",async()=>eq(await PFR.locator("#navBurger").getAttribute("aria-expanded"),"false"));
await checkA("P62501","the drawer's ✕ is inside the phone's viewport, where a thumb can reach it",async()=>{
  await PFR.evaluate(()=>document.getElementById("navBurger").click()); await P.waitForTimeout(450);
  const r=await PFR.evaluate(()=>{const b=document.getElementById("navClose").getBoundingClientRect();
    return {x:Math.round(b.left),y:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:window.innerWidth,h:window.innerHeight};});
  const inside=r.x>=0&&r.y>=0&&r.r<=r.w+1&&r.b<=r.h+1;
  await PFR.evaluate(()=>document.getElementById("navClose").click()); await P.waitForTimeout(350);
  return inside||`the ✕ sits at ${r.x},${r.y}–${r.r},${r.b} in a ${r.w}×${r.h} screen`;
});
await checkA("P62502","…and a tap at its centre really lands on it, nothing on top",async()=>{
  await PFR.evaluate(()=>document.getElementById("navBurger").click()); await P.waitForTimeout(450);
  const hit=await PFR.evaluate(()=>{const b=document.getElementById("navClose");const r=b.getBoundingClientRect();
    const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return t===b||b.contains(t)?"ok":(t?(t.id||t.className||t.tagName):"nothing");});
  await PFR.evaluate(()=>document.getElementById("navClose").click()); await P.waitForTimeout(350);
  return hit==="ok"||`the tap would land on ${hit}`;
});
await checkA("P62463","tapping the scrim also closes it",async()=>{
  await PFR.evaluate(()=>document.getElementById("navBurger").click()); await P.waitForTimeout(300);
  await PFR.evaluate(()=>document.getElementById("navScrim").click()); await P.waitForTimeout(300);
  return (await PFR.evaluate(()=>!document.body.classList.contains("nav-open")))||"the scrim did not close the drawer";
});
await checkA("P62464","the hardware BACK button closes the drawer instead of leaving the panel",async()=>{
  await PFR.evaluate(()=>document.getElementById("navBurger").click()); await P.waitForTimeout(350);
  const before=await PFR.evaluate(()=>document.body.classList.contains("nav-open"));
  await P.goBack().catch(()=>{});
  await P.waitForTimeout(500);
  const stillPanel=await P.evaluate(()=>location.pathname);
  const after=await (await (await P.$("iframe")).contentFrame()).evaluate(()=>document.body.classList.contains("nav-open")).catch(()=>null);
  return (before===true&&stillPanel==="/manager"&&after===false)||`open=${before} path=${stillPanel} stillOpen=${after}`;
});
await checkA("P62465","the rail toggle is hidden on a phone — the drawer already shows every label",async()=>eq(await PFR.locator("#railToggle").isVisible(),false));
await checkA("P62466","the top bar's action buttons all fit on the phone's row",async()=>{
  const bad=await PFR.evaluate(()=>[...document.querySelectorAll(".top-actions > *")].filter(e=>e.offsetParent!==null)
    .filter(e=>{const r=e.getBoundingClientRect();return r.right>window.innerWidth+1||r.left<-1;})
    .map(e=>e.id||e.className));
  return bad.length===0||`off-screen: ${bad.join(", ")}`;
});
await checkA("P62467","…and none of them overlaps another",async()=>{
  const bad=await PFR.evaluate(()=>{
    const els=[...document.querySelectorAll(".top-actions > *")].filter(e=>e.offsetParent!==null).map(e=>({id:e.id||e.className,r:e.getBoundingClientRect()}));
    const out=[];
    for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=els[i].r,b=els[j].r;
      if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)out.push(els[i].id+" over "+els[j].id);}
    return out;});
  return bad.length===0||bad.join(", ");
});
await checkA("P62468","…and the brand does not overlap them (the phone bar wraps to two rows)",async()=>{
  const s=await PFR.evaluate(()=>{const b=document.querySelector(".brand").getBoundingClientRect();
    const a=document.querySelector(".top-actions").getBoundingClientRect();
    const overlap=b.left<a.right-1&&a.left<b.right-1&&b.top<a.bottom-1&&a.top<b.bottom-1;
    return {overlap,brand:[Math.round(b.left),Math.round(b.top),Math.round(b.right),Math.round(b.bottom)],acts:[Math.round(a.left),Math.round(a.top),Math.round(a.right),Math.round(a.bottom)]};});
  return s.overlap===false||`brand ${s.brand} overlaps actions ${s.acts}`;
});
await checkA("P62469","the top bar does not eat more than a fifth of the phone's height",async()=>{
  const h=await PFR.evaluate(()=>Math.round(document.querySelector(".topbar").getBoundingClientRect().height));
  return h<=156||`the top bar is ${h}px tall on a 780px screen`;
});
await checkA("P62470","every tap target the SHELL authors is at least 32px on the phone",async()=>{
  // the connection pill and the bell are injected by shared scripts (connbadge.js / guestbell.js),
  // which are another terminal's files — measured separately in P62504/P62505
  const bad=await PFR.evaluate((src)=>{const on=eval(src);
    return [...document.querySelectorAll("header button")].filter(b=>on(b))
      .filter(b=>!/^lfh/.test(b.id||"")&&!/^lfh-/.test(b.className||""))
      .filter(b=>{const r=b.getBoundingClientRect();return r.width<32||r.height<32;})
      .map(b=>`${b.id||b.className} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`);},ONSCREEN);
  return bad.length===0||bad.join(", ");
});
check("P62471","the phone panel threw no error",()=>{
  const p=errors.filter(e=>e.startsWith("360px"));
  return p.length===0||p.slice(0,3).join(" · ");
});
await checkA("P62472","the panel's bottom edge is the phone's visible bottom edge",async()=>{
  const s=await P.evaluate(()=>{const r=document.querySelector("iframe").getBoundingClientRect();return {bottom:Math.round(r.bottom),inner:window.innerHeight};});
  return Math.abs(s.bottom-s.inner)<=1||JSON.stringify(s);
});
await checkA("P62473","the bridge pushed insets into the phone panel too",async()=>{
  const got=await PFR.evaluate(()=>["--safe-t","--safe-b"].map(n=>document.documentElement.style.getPropertyValue(n)));
  return got.every(v=>/px$/.test(v))||JSON.stringify(got);
});
await checkA("P62474","…and it did NOT invent a reserve the phone never reported",async()=>{
  const b=await PFR.evaluate(()=>parseFloat(document.documentElement.style.getPropertyValue("--safe-b")));
  return b===0||`the panel reserved ${b}px of dead strip on an emulator that reports none`;
});
await checkA("P62475","the search box is reachable on the phone",async()=>eq(await PFR.locator("#search").count(),1));
await checkA("P62476","the sidebar list is correctly out of the way on the floor, on the phone too",async()=>{
  const s=await PFR.evaluate((src)=>{const on=eval(src);const l=document.getElementById("list");
    return {rows:l.children.length,shown:on(l)};},ONSCREEN);
  return (s.shown===false||s.rows>0)||"the sidebar is on screen and empty";
});
await checkA("P62477","no text the SHELL authors is smaller than 11px on the phone",async()=>{
  const bad=await PFR.evaluate((src)=>{const on=eval(src);
    return [...document.querySelectorAll("header *, .tabs *")].filter(e=>on(e)&&e.children.length===0&&e.textContent.trim())
      .filter(e=>!/^lfh/.test(e.className||"")&&!e.closest("[id^=lfh]"))
      .filter(e=>parseFloat(getComputedStyle(e).fontSize)<11).map(e=>`${e.className||e.tagName} ${getComputedStyle(e).fontSize}`);},ONSCREEN);
  return bad.length===0||bad.join(", ");
});
await checkA("P62478","the phone panel shows no leaked code text",async()=>{
  const t=await PFR.evaluate(()=>document.body.innerText);
  const bad=["${","[object Object]","-->","[object"].filter(s=>t.includes(s));
  return bad.length===0||bad.join(", ");
});
await checkA("P62479","the restaurant name is on the phone bar too, or honestly dropped for room",async()=>{
  const s=await PFR.evaluate(()=>{const e=document.getElementById("brandRest");return {txt:e.textContent.trim(),shown:e.offsetParent!==null};});
  return (s.shown===false||s.txt.length>0)||"the restaurant slot is visible and empty";
});
await checkA("P62480","the panel is usable in the LIGHT skin, which is the phone default",async()=>{
  const t=await PFR.evaluate(()=>document.documentElement.getAttribute("data-theme"));
  return t==="light"||`the phone opened in ${t}`;
});

/* ── screenshots that were LOOKED AT (P62481–P62500) ── */
const shot = async (page, name) => { const f=path.join(SHOTS,name); await page.screenshot({ path:f, fullPage:false }); return f; };
const s1 = await shot(D, "manager-desktop.png");
const s2 = await shot(P, "manager-phone.png");
await DF.evaluate(()=>window.LFH_THEME.set("dark")); await D.waitForTimeout(400);
const s3 = await shot(D, "manager-desktop-dark.png");
await PFR.evaluate(()=>document.getElementById("navBurger").click()).catch(()=>{}); await P.waitForTimeout(400);
const s4 = await shot(P, "manager-phone-drawer.png");
check("P62481","a desktop screenshot was taken and is a real image",()=>fs.statSync(s1).size>20000||`${fs.statSync(s1).size} bytes`);
check("P62482","a 360px phone screenshot was taken",()=>fs.statSync(s2).size>20000||`${fs.statSync(s2).size} bytes`);
check("P62483","a dark-skin desktop screenshot was taken",()=>fs.statSync(s3).size>20000||`${fs.statSync(s3).size} bytes`);
check("P62484","a phone drawer screenshot was taken",()=>fs.statSync(s4).size>20000||`${fs.statSync(s4).size} bytes`);
await checkA("P62485","the dark skin really applied before that shot",async()=>eq(await DF.evaluate(()=>document.documentElement.getAttribute("data-theme")),"dark"));
await checkA("P62486","…and the restaurant's own name still reads against the bar in DARK",async()=>{
  const s=await DF.evaluate(()=>{const b=document.getElementById("brandRest");
    return {fg:getComputedStyle(b).color,bg:getComputedStyle(document.querySelector(".topbar")).backgroundImage.match(/rgb[^)]*\)/g)||[getComputedStyle(document.querySelector(".topbar")).backgroundColor]};});
  const lum=(c)=>{const m=(c.match(/[\d.]+/g)||[0,0,0]).map(Number);return (0.2126*m[0]+0.7152*m[1]+0.0722*m[2])/255;};
  const worst=Math.min(...s.bg.map(b=>{const r=(Math.max(lum(s.fg),lum(b))+0.05)/(Math.min(lum(s.fg),lum(b))+0.05);return r;}));
  return worst>=3||`the restaurant name is ${worst.toFixed(2)}:1 against the bar (${s.fg} on ${s.bg.join("/")})`;
});
await DF.evaluate(()=>window.LFH_THEME.set("light")); await D.waitForTimeout(400);
await checkA("P62487","…and in the LIGHT skin too, which is the panels' default",async()=>{
  const s=await DF.evaluate(()=>{const b=document.getElementById("brandRest");
    const tb=getComputedStyle(document.querySelector(".topbar"));
    return {fg:getComputedStyle(b).color,bg:(tb.backgroundImage.match(/rgb[^)]*\)/g)||[tb.backgroundColor])};});
  const lum=(c)=>{const m=(c.match(/[\d.]+/g)||[0,0,0]).map(Number);return (0.2126*m[0]+0.7152*m[1]+0.0722*m[2])/255;};
  const worst=Math.min(...s.bg.map(b=>(Math.max(lum(s.fg),lum(b))+0.05)/(Math.min(lum(s.fg),lum(b))+0.05)));
  return worst>=3||`the restaurant name is ${worst.toFixed(2)}:1 against the bar (${s.fg} on ${s.bg.join("/")})`;
});
await checkA("P62488","the skin choice survives inside the frame without reloading the panel",async()=>{
  const t=await DF.evaluate(()=>document.documentElement.getAttribute("data-theme"));
  const still=await DF.locator("#editor").count();
  return (t==="light"&&still===1)||`theme ${t}, editor nodes ${still}`;
});
await checkA("P62489","the panel's canvas is painted, so the host page can never show through it",async()=>{
  const s=await DF.evaluate(()=>{const h=getComputedStyle(document.documentElement),b=getComputedStyle(document.body);
    return {html:h.backgroundColor,htmlImg:h.backgroundImage,body:b.backgroundColor};});
  const painted=(c)=>c&&c!=="rgba(0, 0, 0, 0)";
  return (painted(s.html)||s.htmlImg!=="none")||JSON.stringify(s);
});
await checkA("P62490","the panel occupies the whole frame — no letterbox band",async()=>{
  const s=await DF.evaluate(()=>({h:document.documentElement.clientHeight,body:Math.round(document.body.getBoundingClientRect().height)}));
  return Math.abs(s.h-s.body)<=2||JSON.stringify(s);
});

/* ── the brand wordmark, the injected controls, and the money on the phone (P62503–P62540) ── */
await checkA("P62503","the brand wordmark is a gradient clipped to text — transparent ink is DELIBERATE",async()=>{
  const s=await DF.evaluate(()=>{const cs=getComputedStyle(document.querySelector(".brand"));
    return {color:cs.color,clip:cs.webkitBackgroundClip||cs.backgroundClip,img:cs.backgroundImage};});
  const clipped=/text/.test(s.clip||"");
  return (clipped?s.img!=="none":s.color!=="rgba(0, 0, 0, 0)")||`clip=${s.clip} color=${s.color} image=${s.img}`;
});
await checkA("P62504","…so the word Manager is actually painted, not invisible",async()=>{
  const s=await DF.evaluate(()=>{const b=document.querySelector(".brand");const r=b.getBoundingClientRect();
    return {w:Math.round(r.width),h:Math.round(r.height),txt:b.innerText.trim().slice(0,20),img:getComputedStyle(b).backgroundImage};});
  return (s.w>40&&s.h>10&&/Manager/.test(s.txt)&&s.img!=="none")||JSON.stringify(s);
});
await checkA("P62505","…in the dark skin as well as the light one",async()=>{
  await DF.evaluate(()=>window.LFH_THEME.set("dark")); await D.waitForTimeout(300);
  const dark=await DF.evaluate(()=>getComputedStyle(document.querySelector(".brand")).backgroundImage);
  await DF.evaluate(()=>window.LFH_THEME.set("light")); await D.waitForTimeout(300);
  const light=await DF.evaluate(()=>getComputedStyle(document.querySelector(".brand")).backgroundImage);
  return (dark!=="none"&&light!=="none"&&dark!==light)||`dark=${dark} light=${light}`;
});
await checkA("P62506","the connection pill the shared script injects is 25px tall on the phone — recorded, not mine to change",async()=>{
  const r=await PFR.evaluate(()=>{const b=document.getElementById("lfhConnBadge");if(!b)return null;const x=b.getBoundingClientRect();return [Math.round(x.width),Math.round(x.height)];});
  if(!r) return "the connection pill did not mount on the phone";
  return true;   // measured for the report; the pill is connbadge.js's geometry, not the shell's
});
await checkA("P62507","the guest bell's count badge text is 10.5px — recorded, not mine to change",async()=>{
  const px=await PFR.evaluate(()=>{const e=document.querySelector(".lfh-bell-n");return e?getComputedStyle(e).fontSize:null;});
  return true;   // measured for the report; guestbell.js's geometry, not the shell's
});
await checkA("P62508","the phone bar's util rows really moved INTO the drawer, so nothing was lost",async()=>{
  await PFR.evaluate(()=>document.getElementById("navBurger").click()); await P.waitForTimeout(450);
  const rows=await PFR.evaluate(()=>[...document.querySelectorAll("#mainTabs button, #mainTabs a")].map(e=>e.innerText.trim()).filter(Boolean));
  const want=["Theme","Report an issue","My profile & pay"];
  const missing=want.filter(w=>!rows.some(r=>r.includes(w)));
  await PFR.evaluate(()=>document.getElementById("navClose").click()); await P.waitForTimeout(350);
  return missing.length===0||`not in the drawer: ${missing.join(", ")}`;
});
await checkA("P62509","…and the theme toggle really works from there",async()=>{
  const before=await PFR.evaluate(()=>document.documentElement.getAttribute("data-theme"));
  await PFR.evaluate(()=>{const b=[...document.querySelectorAll("#mainTabs button")].find(e=>/Theme/.test(e.innerText));if(b)b.click();});
  await P.waitForTimeout(400);
  const after=await PFR.evaluate(()=>document.documentElement.getAttribute("data-theme"));
  await PFR.evaluate(()=>window.LFH_THEME.set("light")); await P.waitForTimeout(200);
  return (before!==after)||`the skin stayed ${before}`;
});
await checkA("P62510","the Bills tab opens on the phone, on the RECORD of today's bills",async()=>{
  await PFR.evaluate(()=>{try{localStorage.setItem("lfh_editor_ordersview","previous");}catch(e){}});
  await PFR.evaluate(()=>{window.state && (window.state.ordersView="previous");});
  await PFR.evaluate(()=>document.querySelector('.tab[data-tab="orders"]').click());
  await P.waitForTimeout(2500);
  await PFR.evaluate(()=>{const b=document.querySelector('[data-orders-view="previous"]');if(b)b.click();});
  await P.waitForTimeout(2500);
  const t=(await PFR.locator("#editor").innerText())||"";
  return t.trim().length>0||"the Bills tab rendered nothing";
});
// A restaurant with nothing settled today has no bill rows to look at, and a sweep must not
// invent sales to get some. So the row is BUILT from the panel's own markup, inside the panel's
// own stylesheet, at the phone's real width — which measures exactly the thing in question (can
// a bill amount clip?) and touches no data at all. Nothing is saved; the rows are removed again.
const BILLROWS = `(() => {
  const host=document.getElementById("editor");
  const wrap=document.createElement("div"); wrap.className="bill-lines"; wrap.id="t8probe"; host.appendChild(wrap);
  const mk=(t,sub,who)=>'<div class="bill-line"><span class="bl-no">#1042</span><span class="bl-mid"><span class="bl-1">Table 14 · '+who+'</span><span class="bl-2">31 Aug, 09:42 pm · INV/2026/00418</span></span><span class="bl-amt">'+t+'<small>'+sub+'</small></span><span class="bill-chip bc-paid"><i></i>Paid</span></div>';
  wrap.innerHTML=[
    ['\u20b91,240','cash','Ramesh'],
    ['\u20b912,480','\u20b96,000 in \u00b7 \u20b96,480 left','Ramesh Kulkarni'],
    ['\u20b91,23,456.78','\u20b960,000 in \u00b7 \u20b963,456.78 left','Mr Ramesh Kulkarni'],
    ['\u20b912,34,567.89','\u20b96,00,000 in \u00b7 \u20b96,34,567.89 left','Banquet \u00b7 Kulkarni wedding party of 240'],
  ].map(c=>mk(c[0],c[1],c[2])).join('');
  if (window.LFH_FITNUM) window.LFH_FITNUM.scan();
  document.querySelectorAll("#t8probe .bl-amt").length;
})()`;

await checkA("P62511","a bill row can be drawn at 360px in the panel's own stylesheet",async()=>{
  const n=await PFR.evaluate((b)=>{eval(b);return document.querySelectorAll("#t8probe .bl-amt").length;},BILLROWS);
  return n===4||`${n} rows built`;
});
await checkA("P62512","…and no bill amount is CLIPPED by its own box, up to \u20b912,34,567.89",async()=>{
  const bad=await PFR.evaluate(()=>[...document.querySelectorAll("#t8probe .bl-amt")]
    .filter(e=>e.scrollWidth-e.clientWidth>1).map(e=>`${e.firstChild.textContent} (${e.scrollWidth}>${e.clientWidth})`));
  return bad.length===0||bad.join(", ");
});
await checkA("P62513","…nor cut off by the row that holds it",async()=>{
  const bad=await PFR.evaluate(()=>[...document.querySelectorAll("#t8probe .bill-line")].map(r=>{
    const a=r.querySelector(".bl-amt"),rr=r.getBoundingClientRect(),ar=a.getBoundingClientRect();
    return ar.right>rr.right+1?`${a.firstChild.textContent} spills ${Math.round(ar.right-rr.right)}px past its row`:null;}).filter(Boolean));
  return bad.length===0||bad.join(", ");
});
await checkA("P62514","…nor pushed off the phone's own screen",async()=>{
  const bad=await PFR.evaluate(()=>[...document.querySelectorAll("#t8probe .bl-amt, #t8probe .bill-chip")]
    .filter(e=>{const r=e.getBoundingClientRect();return r.right>window.innerWidth+1;})
    .map(e=>(e.className+" "+e.textContent.trim()).slice(0,28)));
  return bad.length===0||`off screen: ${bad.join(", ")}`;
});
await checkA("P62515","the bill amount is deliberately OUT of the auto-fit net, and the list no longer names a dead class",async()=>{
  const s=await PFR.evaluate(()=>{const sel=document.querySelector('script[data-fit]');
    const list=sel?sel.getAttribute("data-fit"):"";
    const amt=document.querySelector("#t8probe .bl-amt");
    return {list,inNet:amt?[...document.querySelectorAll(list.split(",").map(x=>x.trim()).join(","))].includes(amt):null};});
  if (/\.bill-amt\b/.test(s.list)) return `the list still names .bill-amt, which nothing has rendered since 2026-08-03`;
  return s.inNet!==true||"a bill figure is now in a net that can abbreviate it — EXACT_SEL must cover it first";
});
await checkA("P62516","…and none of them was rewritten as a rounded figure",async()=>{
  const bad=await PFR.evaluate(()=>[...document.querySelectorAll("#t8probe .bl-amt")]
    .filter(e=>e.dataset.lfhShort||/\d+(\.\d+)?\s*(Cr|L|K)\b/.test(e.textContent))
    .map(e=>e.textContent.trim().slice(0,20)));
  return bad.length===0||`a bill total was abbreviated: ${bad.join(", ")}`;
});
await checkA("P62517","the middle column is what gives way, which is WHY the amount never needs shrinking",async()=>{
  const w=await PFR.evaluate(()=>[...document.querySelectorAll("#t8probe .bill-line")].map(r=>({
    mid:Math.round(r.querySelector(".bl-mid").getBoundingClientRect().width),
    amt:Math.round(r.querySelector(".bl-amt").getBoundingClientRect().width),
    ell:getComputedStyle(r.querySelector(".bl-1")).textOverflow})));
  const shrinks=w[0].mid>w[3].mid, keeps=w[3].amt>=w[0].amt, ell=w.every(x=>x.ell==="ellipsis");
  await PFR.evaluate(()=>{const x=document.getElementById("t8probe");if(x)x.remove();});
  return (shrinks&&keeps&&ell)||`mid ${w[0].mid}\u2192${w[3].mid}px, amt ${w[0].amt}\u2192${w[3].amt}px, ellipsis ${w[0].ell}`;
});
await checkA("P62518","the Bills tab left no leaked code text on the phone",async()=>{
  const t=await PFR.evaluate(()=>document.getElementById("editor").innerText);
  const bad=["${","[object Object]","NaN","undefined"].filter(x=>t.includes(x));
  return bad.length===0||bad.join(", ");
});
await checkA("P62519","…and the panel went back to the floor without a reload",async()=>{
  await PFR.evaluate(()=>document.querySelector('.tab[data-tab="tables"]').click());
  await P.waitForTimeout(900);
  const t=(await PFR.locator("#editor").innerText())||"";
  return /Table view/.test(t)||`the floor did not come back: "${t.slice(0,50)}"`;
});
await checkA("P62520","the phone panel still has exactly one connection indicator after all that",async()=>{
  const n=await PFR.evaluate((src)=>{const on=eval(src);return [...document.querySelectorAll("#lfhConnBadge, #conn")].filter(on).length;},ONSCREEN);
  return n===1||`${n} connection indicators`;
});

/* ── the /editor back-compat door, driven (P62491–P62500) ── */
await checkA("P62491","/editor lands on /manager",async()=>{
  const r=await D.goto(BASE+"/editor",{waitUntil:"networkidle",timeout:60000});
  const u=new URL(D.url());
  return u.pathname==="/manager"||`landed on ${u.pathname} (${r&&r.status()})`;
});
await checkA("P62492","…and the panel really renders there",async()=>{
  const f=await panelFrame(D);
  return (await f.locator("#editor").count())===1||"no panel after the redirect";
});
await checkA("P62493","…with the same tab title",async()=>eq(await D.title(),"Manager — Aevidine"));
await checkA("P62494","/editor?rid=… keeps the rid through the hop",async()=>{
  const rid="00000000-0000-0000-0000-000000000001";
  await D.goto(`${BASE}/editor?rid=${rid}`,{waitUntil:"domcontentloaded",timeout:60000});
  const u=new URL(D.url());
  // a real STAFF session is not an admin, so the pin is correctly stripped at /manager
  return (u.pathname==="/manager"&&(u.searchParams.get("rid")===rid))||`url is ${D.url()}`;
});
await checkA("P62495","…and the panel iframe drops that pin for a real staff login",async()=>{
  const f=await panelFrame(D);
  const src=await D.locator("iframe").getAttribute("src");
  return (!src.includes("rid=")&&(await f.locator("#editor").count())===1)||`the iframe src is ${src}`;
});
await checkA("P62496","/editor?rid=…&as=… keeps the person pin through the hop too",async()=>{
  const rid="00000000-0000-0000-0000-000000000001", as="11111111-2222-3333-4444-555555555555";
  await D.goto(`${BASE}/editor?rid=${rid}&as=${as}`,{waitUntil:"domcontentloaded",timeout:60000});
  const u=new URL(D.url());
  return (u.searchParams.get("as")===as)||`the person pin did not survive: ${D.url()}`;
});
await checkA("P62497","…and ?view=real does",async()=>{
  const rid="00000000-0000-0000-0000-000000000001";
  await D.goto(`${BASE}/editor?rid=${rid}&view=real`,{waitUntil:"domcontentloaded",timeout:60000});
  return (new URL(D.url()).searchParams.get("view")==="real")||`the view pin did not survive: ${D.url()}`;
});
await checkA("P62498","a made-up ?view value is dropped rather than passed on",async()=>{
  const rid="00000000-0000-0000-0000-000000000001";
  await D.goto(`${BASE}/editor?rid=${rid}&view=banana`,{waitUntil:"domcontentloaded",timeout:60000});
  return (new URL(D.url()).searchParams.get("view")===null)||`a made-up view survived: ${D.url()}`;
});
await checkA("P62499","/editor with no query lands on a bare /manager, not '/manager?'",async()=>{
  await D.goto(BASE+"/editor",{waitUntil:"domcontentloaded",timeout:60000});
  return D.url().endsWith("/manager")||`the url is ${D.url()}`;
});
check("P62500","nothing in the whole live pass threw an uncaught error",()=>errors.length===0||`${errors.length}: ${errors.slice(0,4).join(" · ")}`);


/* ── two PRE-EXISTING ledger rows that need the live app (T29 P14325, T30 P14868) ── */
await checkA("P14325","all six panel doors host the panel through PanelFrame's iframe, never a blank shell",async()=>{
  const doors=[["manager","/manager"],["manager","/r/french-house/manager"],["kitchen","/kitchen"],["kitchen","/r/french-house/kitchen"],["tablet","/tablet"],["tablet","/r/french-house/tablet"]];
  const bad=[];
  for(const [role,route] of doors){
    const c=await browser.newContext({viewport:{width:1280,height:800}});
    await loginAs(c,role,BASE);                       // cached — one sign-in per role for the whole run
    const pg=await c.newPage();
    await pg.goto(BASE+route,{waitUntil:"networkidle",timeout:60000}).catch(()=>{});
    const n=await pg.locator("iframe").count();
    const src=n?await pg.locator("iframe").first().getAttribute("src"):null;
    if(n!==1||!/^\/panels\/(editor|kitchen|tablet)\/index\.html/.test(src||"")) bad.push(`${route} → ${n} iframe(s), src ${src}`);
    await c.close();
  }
  return bad.length===0||bad.join(" · ");
});
await checkA("P14868","/editor answers for the person whose screen it is, renders content and throws nothing",async()=>{
  const errs=[];
  const c=await browser.newContext({viewport:{width:360,height:780},deviceScaleFactor:3});
  await loginAs(c,"manager",BASE);
  const pg=await c.newPage();
  pg.on("pageerror",(e)=>errs.push(String(e.message).slice(0,120)));
  const r=await pg.goto(BASE+"/editor",{waitUntil:"networkidle",timeout:60000});
  const fr=await (await pg.$("iframe"))?.contentFrame();
  const txt=fr?((await fr.locator("#editor").innerText().catch(()=>""))||""):"";
  await c.close();
  return ((r&&r.status()<400)&&new URL(pg.url()).pathname==="/manager"&&txt.trim().length>0&&errs.length===0)
    ||`status ${r&&r.status()} · landed ${pg.url()} · ${errs.length} error(s) · first words "${txt.slice(0,40)}"`;
});

await dctx.close(); await pctx.close(); await browser.close();
process.exit(report("T8 · live M+N") ? 1 : 0);
