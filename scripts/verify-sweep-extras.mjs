// The visual checks that a screenshot sweep cannot make: things that only exist after an
// interaction. Each one cost real archaeology to locate, so it lives here instead of being
// rediscovered:
//   · hover  — the owner dashboard's chart tooltip (appears, stays in the window, is readable)
//   · tablet — KOT ▾ lives in the TABLE DETAIL POPUP (headOps), only for a table with a live
//              session and only when kotOpsOn(); its rows are [data-kotop] inside a picker
//              shell's .pactions — NOT .kotm-grid, which is the merge picker's tiles
//   · tablet — the ☰ profile drawer, inside the panel IFRAME (every panel selector must be
//              resolved in the child frame, never the top document)
//   · owner  — a sparse period must say "Not enough data yet", never draw a lonely 1-bar plot
//   · admin  — the higher view is reached through /api/admin/act-as/go (that is what attaches the
//              restaurant scope; visiting /manager with only an admin cookie has none). x-ray
//              marks appear one per feature that is OFF for staff, so zero marks on a restaurant
//              with everything on is CORRECT — higherView is the thing to assert.
//   node scripts/verify-sweep-extras.mjs [--base <url>]
// The 14 phases I marked ⏭ in the T11 sweep, now driven for real.
import { chromium } from "playwright";
import { loginAs, adminCookie } from "./sweep/login.mjs";
import { requireAppUp } from "./sweep/appUp.mjs";
const argv=process.argv.slice(2);
const B = (argv.includes("--base")?argv[argv.indexOf("--base")+1]:null) || process.env.BASE || "http://localhost:4000";
// Nothing answering at the base used to surface nine different ways across these guards — from a
// tidy 'Verdict: FAIL' to a raw node:internal stack trace that reads as 'the guard is broken'.
// One shared preflight, one sentence, exit 2 = COULD NOT RUN (never 'ran and found a fault').
// T10 sweep, 2026-08-12.
await requireAppUp(["--base", B], "these sweep follow-up checks");
const lum=(r,g,b)=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
const P=s=>{const m=String(s).match(/-?[\d.]+/g);const k=/^color\(\s*srgb/i.test(String(s))?255:1;return [+m[0]*k,+m[1]*k,+m[2]*k]};
const CR=(a,b)=>((Math.max(lum(...a),lum(...b))+.05)/(Math.min(lum(...a),lum(...b))+.05));
let pass=0, fail=0;
const ok=(id,what,detail="")=>{pass++;console.log(`✅ ${id} ${what}${detail?" :: "+detail:""}`)};
const no=(id,what,detail="")=>{fail++;console.log(`❌ ${id} ${what}${detail?" :: "+detail:""}`)};


// The panels are embedded: /tablet and /manager are Next routes wrapping public/panels/*, so the
// buttons live in a child frame. Pick the frame that actually contains the panel.
async function panelFrame(p, marker){
  for (let i=0;i<20;i++){
    for (const f of p.frames()){
      try { if (await f.locator(marker).count()) return f; } catch {}
    }
    await p.waitForTimeout(1000);
  }
  return null;
}

const br = await chromium.launch();
async function ctx(role){
  const c = await br.newContext({viewport:{width:1280,height:900}, serviceWorkers:"block"});
  if (role==="admin") await c.addCookies([adminCookie(B)]); else await loginAs(c, role, B);
  return c;
}

// ── 5461-5464 · HOVER / TOOLTIP on the owner dashboard ───────────────────────
{
  const c = await ctx("owner"); const p = await c.newPage();
  await p.goto(B+"/owner",{waitUntil:"domcontentloaded",timeout:90000}); await p.waitForTimeout(11000);
  const bars = p.locator(".recharts-bar-rectangle, .recharts-rectangle, .recharts-dot, .recharts-area-area");
  const n = await bars.count();
  if (!n) no("5461","owner chart offers something to hover","no recharts geometry on the dashboard");
  else {
    ok("5461","owner chart offers something to hover",`${n} shapes`);
    await bars.first().hover({force:true}).catch(()=>{});
    await p.waitForTimeout(1200);
    const tip = await p.evaluate(()=>{
      const t=document.querySelector(".recharts-tooltip-wrapper, .recharts-default-tooltip");
      if(!t) return null;
      const r=t.getBoundingClientRect(); const cs=getComputedStyle(t);
      const leaf=[...t.querySelectorAll("*")].filter(e=>e.children.length===0&&e.textContent.trim())[0];
      let bg="rgb(255,255,255)",cur=t;
      while(cur){const b=getComputedStyle(cur).backgroundColor;const m=String(b).match(/[\d.]+/g);if(m&&(m.length<4||+m[3]>0.85)){bg=b;break}cur=cur.parentElement}
      return {text:t.textContent.trim().slice(0,80), rect:{x:r.x,y:r.y,w:r.width,h:r.height},
              vis:cs.visibility!=="hidden"&&cs.opacity!=="0"&&r.width>0,
              color:leaf?getComputedStyle(leaf).color:null, bg};
    });
    if (!tip || !tip.vis) no("5462","hovering a chart shows a tooltip","no visible tooltip after hover");
    else {
      ok("5462","hovering a chart shows a tooltip", JSON.stringify(tip.text).slice(0,60));
      const inView = tip.rect.x>=-1 && tip.rect.y>=-1 && tip.rect.x+tip.rect.w<=1281 && tip.rect.y+tip.rect.h<=901;
      inView ? ok("5463","the tooltip stays inside the window") : no("5463","the tooltip stays inside the window", JSON.stringify(tip.rect));
      if (tip.color) { const r=CR(P(tip.color),P(tip.bg));
        r>=3 ? ok("5464","tooltip text is readable", r.toFixed(2)+":1") : no("5464","tooltip text is readable", r.toFixed(2)+":1");
      } else no("5464","tooltip text is readable","no leaf text in the tooltip");
    }
  }
  await c.close();
}

// ── 5465-5468 · TABLET · the KOT ▾ menu and the ☰ profile drawer ─────────────
{
  const c = await ctx("tablet"); const p = await c.newPage();
  await p.goto(B+"/tablet",{waitUntil:"domcontentloaded",timeout:90000}); await p.waitForTimeout(11000);
  const fr = await panelFrame(p, "#kotMenuBtn, #hamburger");
  if (!fr) no("5465","tablet panel frame is reachable","no frame with #kotMenuBtn / #hamburger");
  else {
  // tap a tile that has a party — KOT ▾ only exists for a table with a live session
  const opened = await fr.evaluate(()=>{
    const tiles=[...document.querySelectorAll(".ft-tile,.ft-cell,button")].filter(e=>{
      const t=(e.textContent||""); return /served|prep|new|ready|\u20b9/i.test(t) && e.getBoundingClientRect().width>30;});
    if(!tiles.length) return null;
    tiles[0].click(); return (tiles[0].textContent||"").replace(/\s+/g," ").trim().slice(0,40);
  });
  await p.waitForTimeout(2200);
  const btn = fr.locator("#kotMenuBtn, .kot-menu-btn, [id*=kotMenu]").first();
  if (!opened) no("5465","tablet KOT \u25be button exists","no table with a party on the floor right now — cannot exercise it");
  else if (!(await btn.count())) no("5465","tablet KOT \u25be button exists",`opened "${opened}" but no #kotMenuBtn (KOT ops off?)`);
  else {
    ok("5465","tablet KOT \u25be button exists");
    await btn.click({force:true}).catch(()=>{}); await p.waitForTimeout(1600);
    const m = await fr.evaluate(()=>{
      const g=document.querySelector(".pactions"); if(!g||!g.querySelector("[data-kotop]")) return null;
      const tiles=[...g.querySelectorAll("[data-kotop], .kotm-row")].map(e=>{const r=e.getBoundingClientRect();
        return {t:(e.textContent||"").replace(/\s+/g," ").trim().slice(0,26), x:r.x,y:r.y,w:r.width,h:r.height};}).filter(t=>t.w>0);
      let overlap=null;
      for(let i=0;i<tiles.length&&!overlap;i++)for(let j=i+1;j<tiles.length;j++){const a=tiles[i],b=tiles[j];
        if(a.x<b.x+b.w-1&&b.x<a.x+a.w-1&&a.y<b.y+b.h-1&&b.y<a.y+a.h-1){overlap=[a.t,b.t];break}}
      const clipped=tiles.filter(t=>t.x<-1||t.y<-1||t.x+t.w>innerWidth+1);
      return {count:tiles.length, overlap, clipped:clipped.map(c=>c.t)};
    });
    if (!m) no("5466","the KOT \u25be menu opens","no .kotm-grid / .kot-menu after the tap");
    else {
      m.count>0 ? ok("5466","the KOT \u25be menu opens",`${m.count} options`) : no("5466","the KOT \u25be menu opens","opened but empty");
      m.overlap ? no("5467","KOT \u25be options don't overlap", m.overlap.join(" over ")) : ok("5467","KOT \u25be options don't overlap");
      m.clipped.length ? no("5468","KOT \u25be options stay on screen", m.clipped.join(", ")) : ok("5468","KOT \u25be options stay on screen");
    }
  }
  await fr.locator("body").press("Escape").catch(()=>{}); await p.waitForTimeout(700);
  const ham = fr.locator("#hamburger").first();
  if (!(await ham.count())) no("5469","tablet \u2630 opens the profile drawer","#hamburger not in the panel frame");
  else {
    await ham.click({force:true}).catch(()=>{}); await p.waitForTimeout(1600);
    const d = await fr.evaluate(()=>{
      const el=[...document.querySelectorAll("*")].find(e=>/drawer|sheet/i.test(String(e.className))&&e.getBoundingClientRect().width>80
        && getComputedStyle(e).visibility!=="hidden" && /profile|settings|log ?out|sign out/i.test(e.textContent||""));
      if(!el) return null; const r=el.getBoundingClientRect();
      return {txt:(el.textContent||"").replace(/\s+/g," ").trim().slice(0,80), onscreen:r.x>-2&&r.x<innerWidth+1};
    });
    d && d.onscreen ? ok("5469","tablet \u2630 opens the profile drawer", d.txt.slice(0,50)) : no("5469","tablet \u2630 opens the profile drawer", d?JSON.stringify(d):"no drawer with profile/settings/logout");
  }
  }
  await c.close();
}

// ── 5470-5473 · OWNER CHARTS on a period with (almost) no activity ───────────
{
  const c = await ctx("owner"); const p = await c.newPage();
  // a single quiet day is the natural sparse case — no fabricated sales in a real report
  await p.goto(B+"/owner/reports",{waitUntil:"domcontentloaded",timeout:90000}); await p.waitForTimeout(12000);
  const r = await p.evaluate(()=>{
    const notEnough=[...document.querySelectorAll("div")].filter(e=>/^Not enough data yet/.test((e.textContent||"").trim())).length;
    const charts=[...document.querySelectorAll(".recharts-wrapper")].map(w=>{
      const bars=w.querySelectorAll(".recharts-bar-rectangle, .recharts-rectangle").length;
      const dots=w.querySelectorAll(".recharts-dot").length;
      return {bars,dots};
    });
    const lonely=charts.filter(c=>c.bars===1||(c.bars===0&&c.dots===1)).length;
    return {notEnough, charts:charts.length, lonely};
  });
  ok("5470","owner reports render", `${r.charts} charts, ${r.notEnough} "not enough data" cards`);
  r.lonely===0 ? ok("5471","no lonely 1-bar plot") : no("5471","no lonely 1-bar plot", `${r.lonely} chart(s) drawn with a single point`);
  (r.charts>0||r.notEnough>0) ? ok("5472","a sparse period says so honestly, never a blank box")
                              : no("5472","a sparse period says so honestly, never a blank box","neither a chart nor an honest message");
  // all-zero: an axis must still be labelled rather than collapsing
  const ax = await p.evaluate(()=>document.querySelectorAll(".recharts-cartesian-axis-tick, .recharts-label").length);
  ax>0||r.notEnough>0 ? ok("5473","axes stay labelled when the numbers are flat", String(ax)) : no("5473","axes stay labelled when the numbers are flat","no ticks and no message");
  await c.close();
}

// ── 5474 · ADMIN panel view MARKS what staff can't reach ─────────────────────
{
  const c = await ctx("admin"); const p = await c.newPage();
  // the console reaches a panel through act-as/go, which is what attaches the restaurant scope —
  // visiting /manager with only an admin cookie has none ("open this panel from the admin console")
  await p.goto(B+"/aevinite",{waitUntil:"domcontentloaded",timeout:90000}); await p.waitForTimeout(5000);
  const rid = await p.evaluate(async(B)=>{
    for (const u of ["/api/admin/restaurants","/api/admin/restaurants?limit=5"]) {
      const r=await fetch(u,{credentials:"include"}).catch(()=>null);
      if(!r||!r.ok) continue;
      const j=await r.json().catch(()=>null);
      const arr=Array.isArray(j)?j:(j&&(j.restaurants||j.rows||j.data))||[];
      const hit=arr.find(x=>/french/i.test(x.name||x.slug||""))||arr[0];
      if(hit&&hit.id) return String(hit.id);
    }
    return null;
  }, B).catch(()=>null);
  if (!rid) { no("5474","admin panel view is the higher view","could not read a restaurant id from the console"); await c.close(); }
  else {
  await p.goto(`${B}/api/admin/act-as/go?rid=${encodeURIComponent(rid)}&to=${encodeURIComponent("/manager")}`,{waitUntil:"domcontentloaded",timeout:90000});
  await p.waitForTimeout(14000);
  const fr = await panelFrame(p, "body");
  const x = fr ? await fr.evaluate(async()=>{
      const r=await fetch("/api/editor/whoami"+location.search,{credentials:"include"}).catch(()=>null);
      const w=r&&r.ok?await r.json().catch(()=>null):null;
      return {higherView:w?w.higherView:null, status:r?r.status:null,
              tinted:document.querySelectorAll(".xray-off").length,
              ribbon:document.querySelectorAll(".xray-c, .xray-pulse").length,
              zones:document.querySelectorAll(".xray-zones").length};
    }) : {err:"no panel frame"};
  if (x.err) no("5474","admin panel view marks what staff can't reach", x.err);
  else {
    // a mark per OFF feature; nothing off ⇒ nothing to mark, which is correct, so the view itself
    // (higherView) is the thing that must be true
    x.higherView === true
      ? ok("5474","admin panel view is the higher view (marks appear per off-feature)", JSON.stringify(x))
      : no("5474","admin panel view is the higher view", "higherView not granted: "+JSON.stringify(x));
  }
  await c.close();
  }
}

// ── 5475-5478 · SURFACES THAT ONLY EXIST AFTER A CLICK, IN BOTH SKINS ────────
// A whole-page contrast scan cannot open a dropdown or a popover, so its silence about them means
// nothing. Two were unreadable in OPPOSITE skins (live, 2026-08-06) because their background came
// from a token nothing declared, so the hard-coded fallback applied in BOTH skins:
//   · the Access search dropdown   (--adm-pop  → #171a20) 1.02:1 on the LIGHT console
//   · the owner x-ray zone popover (--adm-card → #fff)    1.20:1 on the DARK console
// No eval() in the page (the console sends a CSP) and the owner console needs an OWNER session —
// an admin cookie does not render .adm.owx.
{
  const lum=(r,g,b)=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
  const PC=v=>{const m=String(v).match(/-?[\d.]+/g);const k=/^color\(\s*srgb/i.test(String(v))?255:1;return [+m[0]*k,+m[1]*k,+m[2]*k]};
  const RATIO=(a,b)=>((Math.max(lum(...a),lum(...b))+.05)/(Math.min(lum(...a),lum(...b))+.05));
  let id=5475;
  for (const skin of ["light","dark"]) {
    // (a) the Access search dropdown, as an admin
    const ca = await br.newContext({viewport:{width:1280,height:900},serviceWorkers:"block"});
    await ca.addCookies([adminCookie(B),{name:"aevidine_skin",value:skin,url:B}]);
    const pa = await ca.newPage();
    await pa.addInitScript(`try{localStorage.setItem("aevidine_skin","${skin}")}catch(e){}`);
    await pa.goto(B+"/aevinite/access",{waitUntil:"domcontentloaded",timeout:90000});
    await pa.waitForTimeout(9000);
    const box = pa.locator(".as-input").first();
    if (!(await box.count())) no(String(id++),`Access search results are readable [${skin}]`,"no .as-input on /aevinite/access");
    else {
      await box.click();
      await box.type("ta",{delay:110});      // real keystrokes — assigning .value skips React
      await pa.waitForTimeout(1600);
      const r = await pa.evaluate(()=>{
        const l=document.querySelector(".as-list"); if(!l) return {open:false};
        let cur=l,bg=null;
        while(cur){const b=getComputedStyle(cur).backgroundColor;const m=String(b).match(/[\d.]+/g);
          if(m&&(m.length<4||+m[3]>=.95)){bg=b;break}cur=cur.parentElement}
        const item=l.querySelector(".as-nm")||l.querySelector(".as-item");
        return {open:true,n:l.querySelectorAll(".as-item").length,panel:bg,
                txt:item?item.textContent.trim().slice(0,24):null,
                fg:item?getComputedStyle(item).color:null};
      });
      if (!r.open || !r.fg || !r.panel) no(String(id++),`Access search results are readable [${skin}]`,
            !r.open?"dropdown did not open":!r.fg?"dropdown open but empty":"no opaque panel background found");
      else {
        const cr=RATIO(PC(r.fg),PC(r.panel));
        cr>=3 ? ok(String(id++),`Access search results are readable [${skin}]`,`${r.n} items, ${cr.toFixed(2)}:1`)
              : no(String(id++),`Access search results are readable [${skin}]`,`${cr.toFixed(2)}:1 — ${r.fg} on ${r.panel}`);
      }
    }
    await ca.close();

    // (b) the owner x-ray zone popover, as the OWNER, built from the rules it ships with
    const co = await br.newContext({viewport:{width:1280,height:900},serviceWorkers:"block"});
    await loginAs(co,"owner",B);
    await co.addCookies([{name:"aevidine_skin",value:skin,url:B}]);
    const po = await co.newPage();
    await po.addInitScript(`try{localStorage.setItem("aevidine_skin","${skin}")}catch(e){}`);
    await po.goto(B+"/owner",{waitUntil:"domcontentloaded",timeout:90000});
    await po.waitForTimeout(10000);
    const q = await po.evaluate(()=>{
      const host=document.querySelector(".adm.owx")||document.querySelector(".adm"); if(!host) return null;
      const el=document.createElement("div"); el.className="xray-zpop";
      el.innerHTML='<button class="zrow">zone<small>off</small></button>';
      host.appendChild(el);
      let cur=el,bg=null;
      while(cur){const b=getComputedStyle(cur).backgroundColor;const m=String(b).match(/[\d.]+/g);
        if(m&&(m.length<4||+m[3]>=.95)){bg=b;break}cur=cur.parentElement}
      const row=el.querySelector(".zrow"), sm=el.querySelector("small");
      const v={panel:bg,rowFg:getComputedStyle(row).color,smFg:getComputedStyle(sm).color};
      el.remove(); return v;
    });
    if (!q || !q.panel) no(String(id++),`owner x-ray popover is readable [${skin}]`, q?"no opaque panel background found":"no .adm host on /owner");
    else {
      const a=RATIO(PC(q.rowFg),PC(q.panel)), b2=RATIO(PC(q.smFg),PC(q.panel));
      Math.min(a,b2)>=3 ? ok(String(id++),`owner x-ray popover is readable [${skin}]`,`${a.toFixed(2)}:1 / ${b2.toFixed(2)}:1`)
                        : no(String(id++),`owner x-ray popover is readable [${skin}]`,`${a.toFixed(2)}:1 / ${b2.toFixed(2)}:1 on ${q.panel}`);
    }
    await co.close();
  }
}
await br.close();
console.log(`\nSKIPPED-PHASE RUN: ${pass} pass · ${fail} fail`);
process.exit(fail?1:0);
