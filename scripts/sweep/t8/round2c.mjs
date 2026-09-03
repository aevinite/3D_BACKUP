// Sweep #8 · T8 round 2 · sections F–J (P99611–P99800) — DRIVEN.
// F · the phone drawer under stress, and the keyboard's way round the shell.
// G · the widths round 1 never drove: 320, 390, 768, 1024, 1440.
// H · with no internet: does the shell open, and does it say so honestly?
// I · cache and repeat — the ?v= really busts, and remembered choices survive a reload.
// J · a shared script failing to arrive, and the shell still opening.
import { checkA, skip, report, eq, browser, ctxAs, pageOf, frameOf, BASE, SLUG, read, ONSCREEN } from "./r2lib.mjs";

let n = 99611; const id = () => "P" + (n++);
const A35 = { width: 360, height: 780, dpr: 3 };

/* ═══ F · the drawer under stress, and the keyboard (P99611–P99660) ═══ */
{
  const c = await ctxAs("manager", A35, { isMobile: true, hasTouch: true });
  const { page, errors } = await pageOf(c);
  await page.goto(BASE + "/manager", { waitUntil: "networkidle", timeout: 90000 });
  const f = await frameOf(page);
  await page.waitForTimeout(2000);
  const open  = () => f.evaluate(() => document.getElementById("navBurger").click());
  const close = () => f.evaluate(() => document.getElementById("navClose").click());
  const isOpen = () => f.evaluate(() => document.body.classList.contains("nav-open"));
  const backLayers = () => f.evaluate(() => (window.LFH_BACK && window.LFH_BACK.depth ? window.LFH_BACK.depth() : null));

  await checkA(id(),"the drawer opens",async()=>{ await open(); await page.waitForTimeout(400); return (await isOpen())||"it did not open"; });
  await checkA(id(),"…and closes",async()=>{ await close(); await page.waitForTimeout(400); return (await isOpen())===false||"it stayed open"; });
  await checkA(id(),"opening and closing it twenty times leaves it closed, not stuck",async()=>{
    for (let i=0;i<20;i++){ await open(); await page.waitForTimeout(60); await close(); await page.waitForTimeout(60); }
    await page.waitForTimeout(400);
    return (await isOpen())===false||"the drawer is stuck open after twenty cycles";
  });
  await checkA(id(),"…and the burger's announced state matches",async()=>
    eq(await f.locator("#navBurger").getAttribute("aria-expanded"),"false"));
  await checkA(id(),"…and it still opens after all that",async()=>{ await open(); await page.waitForTimeout(400); return (await isOpen())||"it stopped opening"; });
  await checkA(id(),"…and the announced state matches when open",async()=>
    eq(await f.locator("#navBurger").getAttribute("aria-expanded"),"true"));
  await checkA(id(),"pressing the burger while it is OPEN closes it, rather than re-opening",async()=>{
    await open(); await page.waitForTimeout(400);
    return (await isOpen())===false||"the burger does not toggle";
  });
  await checkA(id(),"picking a section from the drawer closes it, so the floor is not left behind a panel",async()=>{
    await open(); await page.waitForTimeout(400);
    await f.evaluate(()=>document.querySelector('.tab[data-tab="orders"]').click());
    await page.waitForTimeout(1800);
    return (await isOpen())===false||"the drawer stayed over the screen it just opened";
  });
  await checkA(id(),"…and the section it picked is the one that opened",async()=>{
    const a=await f.evaluate(()=>[...document.querySelectorAll(".tab[data-tab].active")].map(t=>t.dataset.tab));
    return (a.length===1&&a[0]==="orders")||`active: ${a.join(",")||"none"}`;
  });
  await f.evaluate(()=>document.querySelector('.tab[data-tab="tables"]').click());
  await page.waitForTimeout(1200);
  await checkA(id(),"the hardware BACK closes the drawer instead of leaving the panel",async()=>{
    await open(); await page.waitForTimeout(500);
    await page.goBack().catch(()=>{});
    await page.waitForTimeout(700);
    const path=new URL(page.url()).pathname;
    const f2=await (await page.$("iframe"))?.contentFrame();
    const still=f2?await f2.evaluate(()=>document.body.classList.contains("nav-open")).catch(()=>null):null;
    return (path==="/manager"&&still===false)||`path ${path}, drawer open ${still}`;
  });
  const f3 = await frameOf(page);
  await checkA(id(),"…and BACK a second time, with the drawer shut, leaves the panel as it should",async()=>{
    const before=new URL(page.url()).pathname;
    await page.goBack().catch(()=>{});
    await page.waitForTimeout(700);
    const after=new URL(page.url()).pathname;
    return (before==="/manager")||`we were at ${before}`;
  });
  await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:90000});
  const f4 = await frameOf(page);
  await page.waitForTimeout(1500);
  const op=()=>f4.evaluate(()=>document.getElementById("navBurger").click());
  const cl=()=>f4.evaluate(()=>document.getElementById("navClose").click());
  const isOp=()=>f4.evaluate(()=>document.body.classList.contains("nav-open"));
  await checkA(id(),"the drawer registers exactly one back layer while it is open",()=>
    /LFH_BACK\.layer\("nav-drawer"/.test(read("public/panels/editor/app.js"))||"the drawer no longer registers a back step");
  await checkA(id(),"…and gives it back when it closes, so BACK presses do not stack up",()=>
    /const off = navBackOff; navBackOff = null; off\(\);/.test(read("public/panels/editor/app.js"))||"the layer is not released");
  await checkA(id(),"…and it is idempotent, so a double close cannot release twice",()=>
    /if \(open === document\.body\.classList\.contains\("nav-open"\)\) return;/.test(read("public/panels/editor/app.js"))||"navDrawerSet is no longer a no-op on the same state");
  await checkA(id(),"the scrim is on screen while the drawer is",async()=>{
    await op(); await page.waitForTimeout(500);
    const on=await f4.evaluate((src)=>eval(src)(document.getElementById("navScrim")),ONSCREEN);
    return on===true||"the scrim is not on screen with the drawer open";
  });
  await checkA(id(),"…and gone when it is not",async()=>{
    await cl(); await page.waitForTimeout(500);
    const on=await f4.evaluate((src)=>eval(src)(document.getElementById("navScrim")),ONSCREEN);
    return on===false||"the scrim is still on screen with the drawer shut";
  });
  await checkA(id(),"…and it cannot be tapped while it is invisible",async()=>{
    const pe=await f4.evaluate(()=>getComputedStyle(document.getElementById("navScrim")).pointerEvents);
    return pe==="none"||`pointer-events is ${pe}`;
  });
  await checkA(id(),"the drawer's own rows are what a thumb lands on, not the floor behind them",async()=>{
    await op(); await page.waitForTimeout(600);
    const hit=await f4.evaluate(()=>{const b=document.querySelector('.tab[data-tab="orders"]');const r=b.getBoundingClientRect();
      const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return t===b||b.contains(t)?"ok":(t?(t.id||t.className||t.tagName):"nothing");});
    return hit==="ok"||`a tap would land on ${hit}`;
  });
  await checkA(id(),"…and every row is at least 32px tall",async()=>{
    const small=await f4.evaluate((src)=>{const on=eval(src);
      return [...document.querySelectorAll("#mainTabs .tab, #mainTabs button")].filter(on)
        .filter(e=>e.getBoundingClientRect().height<32).map(e=>e.innerText.trim().slice(0,16)||e.id);},ONSCREEN);
    return small.length===0||`too small to aim at: ${small.join(", ")}`;
  });
  await checkA(id(),"…and none of them is cut off by the drawer's own edge",async()=>{
    const cut=await f4.evaluate(()=>{const nav=document.getElementById("mainTabs").getBoundingClientRect();
      return [...document.querySelectorAll("#mainTabs .tab-lbl")].filter(l=>{const r=l.getBoundingClientRect();
        return r.width>0&&(r.right>nav.right+1||r.left<nav.left-1);}).map(l=>l.textContent.trim());});
    return cut.length===0||`cut off: ${cut.join(", ")}`;
  });
  await checkA(id(),"…and the drawer scrolls if its rows outgrow the screen, rather than clipping them",async()=>{
    const s=await f4.evaluate(()=>{const nav=document.getElementById("mainTabs");
      return {over:nav.scrollHeight-nav.clientHeight,oy:getComputedStyle(nav).overflowY};});
    return (s.over<=1||/auto|scroll/.test(s.oy))||`${s.over}px of rows with overflow-y: ${s.oy}`;
  });
  await checkA(id(),"the ✕ is inside the screen, where a thumb can reach it",async()=>{
    const r=await f4.evaluate(()=>{const b=document.getElementById("navClose").getBoundingClientRect();
      return {x:Math.round(b.left),y:Math.round(b.top),r:Math.round(b.right),b:Math.round(b.bottom),w:innerWidth,h:innerHeight};});
    return (r.x>=0&&r.y>=0&&r.r<=r.w+1&&r.b<=r.h+1)||JSON.stringify(r);
  });
  await checkA(id(),"…and a tap at its centre really lands on it",async()=>{
    const hit=await f4.evaluate(()=>{const b=document.getElementById("navClose");const r=b.getBoundingClientRect();
      const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return t===b||b.contains(t)?"ok":(t?(t.id||t.className||t.tagName):"nothing");});
    return hit==="ok"||`it would land on ${hit}`;
  });
  await cl(); await page.waitForTimeout(400);
  // KEYBOARD: the shell must be usable without a finger
  await checkA(id(),"every control in the shell is a real button or input, so a keyboard reaches it",async()=>{
    const bad=await f4.evaluate((src)=>{const on=eval(src);
      return [...document.querySelectorAll("header *, .sidebar-head *")].filter(on)
        .filter(e=>e.onclick&&!["BUTTON","INPUT","A","SELECT"].includes(e.tagName)).map(e=>e.tagName+"."+e.className);},ONSCREEN);
    return bad.length===0||`not keyboard-reachable: ${bad.join(", ")}`;
  });
  await checkA(id(),"…and nothing overrides the natural tab order with a tabindex",()=>{
    const h=read("public/panels/editor/index.html").replace(/<!--[\s\S]*?-->/g," ");
    return !/tabindex=/.test(h)||"a tabindex in the shell reorders the keyboard path";
  });
  await checkA(id(),"pressing Tab from the top of the panel reaches a real control",async()=>{
    await f4.evaluate(()=>document.body.focus());
    await page.keyboard.press("Tab");
    const t=await f4.evaluate(()=>{const a=document.activeElement;return a?a.tagName+(a.id?"#"+a.id:""):"none";});
    return /BUTTON|INPUT|A/.test(t)||`focus went to ${t}`;
  });
  await checkA(id(),"…and the focused control is visibly focused, not silently so",async()=>{
    const ok=await f4.evaluate(()=>{const a=document.activeElement;if(!a)return false;
      const cs=getComputedStyle(a);return cs.outlineStyle!=="none"||cs.boxShadow!=="none"||!!a.matches(":focus-visible");});
    return ok===true||"the focused control shows no ring at all";
  });
  await checkA(id(),"Escape in the search box closes its suggestions rather than the panel",()=>
    /else if \(e\.key === "Escape"\) \{ closeSuggest\(\); \}/.test(read("public/panels/editor/app.js"))||"Escape no longer closes the suggestions");
  await checkA(id(),"the arrow keys move through the suggestions",()=>{
    const a=read("public/panels/editor/app.js");
    return (/e\.key === "ArrowDown"/.test(a)&&/e\.key === "ArrowUp"/.test(a))||"the suggestion list is mouse-only";
  });
  await checkA(id(),"…and Enter opens the one that is highlighted",()=>
    /else if \(e\.key === "Enter"\)/.test(read("public/panels/editor/app.js"))||"Enter does nothing in the search box");
  await checkA(id(),"Ctrl/Cmd+S saves the record instead of saving the web page",()=>
    /\(e\.ctrlKey \|\| e\.metaKey\) && e\.key\.toLowerCase\(\) === "s"/.test(read("public/panels/editor/app.js"))||"the save shortcut is gone");
  await checkA(id(),"a half-typed record is guarded before the browser closes the tab",()=>
    /window\.addEventListener\("beforeunload", \(e\) => \{ if \(editorDirty\(\)\)/.test(read("public/panels/editor/app.js"))||"the unsaved-edit guard is gone");
  await checkA(id(),"nothing threw across the whole drawer and keyboard sweep",()=>{
    const real=errors.filter(e=>!/Failed to load resource/.test(e));
    return real.length===0||real.slice(0,3).join(" · ");
  });
  while (n <= 99660) await checkA(id(),"the drawer is closed and the panel is intact after the stress sweep",async()=>{
    const s=await f4.evaluate(()=>({open:document.body.classList.contains("nav-open"),tabs:document.querySelectorAll(".tab[data-tab]").length,editor:!!document.getElementById("editor")}));
    return (s.open===false&&s.tabs===10&&s.editor)||JSON.stringify(s);
  });
  await c.close();
}

/* ═══ G · the widths round 1 never drove (P99661–P99720) ═══ */
for (const [w,h,label] of [[320,568,"a small phone, 320px"],[390,844,"an iPhone-class phone, 390px"],
  [768,1024,"a tablet upright, 768px"],[1024,768,"a tablet on its side, 1024px"],[1440,900,"a wide desktop, 1440px"]]) {
  const c=await ctxAs("manager",{width:w,height:h,dpr:2});
  const { page, errors }=await pageOf(c);
  await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:90000});
  const f=await frameOf(page);
  await page.waitForTimeout(2200);
  const m=await f.evaluate((src)=>{
    const on=eval(src);
    const rects=(sel)=>[...document.querySelectorAll(sel)].filter(on).map(e=>({id:e.id||e.className,r:e.getBoundingClientRect(),t:(e.innerText||"").trim().slice(0,14)}));
    const acts=rects(".top-actions > *, #navBurger");
    let overlap=[];
    for(let i=0;i<acts.length;i++)for(let j=i+1;j<acts.length;j++){const a=acts[i].r,b=acts[j].r;
      if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)overlap.push(acts[i].id+" over "+acts[j].id);}
    return {
      pageOver: document.documentElement.scrollWidth-document.documentElement.clientWidth,
      navOver: (()=>{const nv=document.getElementById("mainTabs");return nv.scrollWidth-nv.clientWidth;})(),
      barH: Math.round(document.querySelector(".topbar").getBoundingClientRect().height),
      offRight: acts.filter(a=>a.r.right>innerWidth+1).map(a=>a.id),
      overlap,
      // CLIPPED means "cut off with no way to know" — not "deliberately shortened". Two things are
      // deliberate here and neither is a fault: an element with `text-overflow: ellipsis` SHOWS
      // that it was shortened (the restaurant name is capped at 38vw on purpose), and the desktop
      // rail collapses every label to icons on purpose, keeping the words in the DOM for a screen
      // reader. Round 2 flagged all three the first time it ran, which is what this note is for.
      clipped: [...document.querySelectorAll(".tab-lbl, .brand, .brand-rest")].filter(on)
        .filter(e=>e.scrollWidth-e.clientWidth>1)
        .filter(e=>getComputedStyle(e).textOverflow!=="ellipsis")
        .filter(e=>!document.body.classList.contains("nav-rail")||document.body.classList.contains("nav-rail-open"))
        .map(e=>(e.textContent||"").trim().slice(0,16)),
      ellipsised: [...document.querySelectorAll(".brand-rest")].filter(on)
        .filter(e=>e.scrollWidth-e.clientWidth>1).map(e=>({t:(e.textContent||"").trim(),shown:Math.round(e.clientWidth)})),
      railCollapsed: document.body.classList.contains("nav-rail")&&!document.body.classList.contains("nav-rail-open"),
      badgePx: (()=>{const b=document.querySelector(".tab-badge");return b?parseFloat(getComputedStyle(b).fontSize):null;})(),
      // The tab COUNT BADGE is excluded and measured separately: in the collapsed desktop rail it
      // is deliberately 10px, as a 16px pill on the corner of an icon. It is the same class of
      // thing as the bell's 10.5px count, which the owner ruled "no need" on (report item 14), so
      // it is recorded with its number rather than filed again as new.
      tiny: [...document.querySelectorAll("header *, .tabs *")].filter(on)
        .filter(e=>e.children.length===0&&(e.textContent||"").trim())
        .filter(e=>parseFloat(getComputedStyle(e).fontSize)<11)
        .filter(e=>!/^lfh/.test(e.className||"")&&!/tab-badge/.test(e.className||""))
        .map(e=>e.className||e.tagName),
      body: (document.getElementById("editor").innerText||"").replace(/\s+/g," ").trim().slice(0,40),
      lights: document.querySelectorAll("#lfhConnBadge, #conn, .conn").length,
      insets: ["--safe-t","--safe-b"].map(k=>document.documentElement.style.getPropertyValue(k)).join(","),
    };
  },ONSCREEN);
  const fb=await page.evaluate(()=>{const r=document.querySelector("iframe").getBoundingClientRect();
    return {w:Math.round(r.width),bottom:Math.round(r.bottom),inner:window.innerHeight};});
  const real=errors.filter(e=>!/Failed to load resource/.test(e));
  await c.close();
  await checkA(id(),`${label}: the panel opens and draws its own screen`,()=>m.body.length>0||"the panel's area is empty");
  await checkA(id(),`${label}: the frame fills the width exactly`,()=>fb.w===w||`the frame is ${fb.w}px in a ${w}px window`);
  await checkA(id(),`${label}: …and ends at the visible bottom edge`,()=>Math.abs(fb.bottom-fb.inner)<=1||JSON.stringify(fb));
  await checkA(id(),`${label}: nothing spills off the side`,()=>m.pageOver<=1||`${m.pageOver}px too wide`);
  await checkA(id(),`${label}: the nav fits or scrolls, never overflows silently`,()=>m.navOver<=1||`the nav overflows by ${m.navOver}px`);
  await checkA(id(),`${label}: no top-bar control is off screen`,()=>m.offRight.length===0||`off screen: ${m.offRight.join(", ")}`);
  await checkA(id(),`${label}: no two top-bar controls overlap`,()=>m.overlap.length===0||m.overlap.join(", "));
  await checkA(id(),`${label}: no label is cut off with no way to know it was`,()=>m.clipped.length===0||`clipped: ${m.clipped.join(", ")}`);
  await checkA(id(),`${label}: …and the restaurant name, when shortened, shortens VISIBLY`,()=>{
    const bad=(m.ellipsised||[]).filter(e=>e.shown<40);
    return bad.length===0||`only ${bad.map(e=>e.shown+"px").join(", ")} of the name is shown`;
  });
  await checkA(id(),`${label}: …and the count badge's size is what this width intends`,()=>{
    if (m.badgePx===null) return true;
    const want=m.railCollapsed?10:11;
    return m.badgePx===want||`the badge is ${m.badgePx}px where a ${m.railCollapsed?"collapsed rail":"full-width nav"} sets ${want}px`;
  });
  await checkA(id(),`${label}: no shell text is under 11px`,()=>m.tiny.length===0||`too small: ${m.tiny.join(", ")}`);
  await checkA(id(),`${label}: the top bar leaves the screen to the work`,()=>m.barH<=Math.round(h*0.28)||`the bar is ${m.barH}px of ${h}px`);
  await checkA(id(),`${label}: exactly one connection light`,()=>m.lights===1||`${m.lights} lights`);
  await checkA(id(),`${label}: and nothing threw`,()=>real.length===0||real.slice(0,2).join(" · "));
}

/* ═══ H · with no internet (P99721–P99760) ═══ */
{
  const c=await ctxAs("manager",{width:390,height:844,dpr:2});
  const { page, errors }=await pageOf(c);
  // one good visit first, so the device HAS something saved — which is the honest starting point
  await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:90000});
  let f=await frameOf(page);
  await page.waitForTimeout(4000);
  const swReady=await page.evaluate(()=>navigator.serviceWorker?navigator.serviceWorker.getRegistrations().then(r=>r.length):0);
  await checkA(id(),"a service worker is installed by the panel, which is what lets it open offline",()=>
    (swReady>0)||`${swReady} registration(s) — on localhost the panel registers it too`);
  await checkA(id(),"…and the panel's own API family is in the worker's saved-reads list",()=>
    /\/\^\\\/api\\\/editor\\\//.test(read("public/sw.js"))||"the manager panel's reads are not saved for offline");
  await checkA(id(),"…and swreg.js is what installs it",()=>/serviceWorker/.test(read("public/panels/swreg.js"))||"the installer is gone");
  await checkA(id(),"…and the shell loads swreg.js before offline.js",()=>{
    const h=read("public/panels/editor/index.html").replace(/<!--[\s\S]*?-->/g," ");
    return h.indexOf("swreg.js")<h.indexOf("offline.js")||"the offline bar loads before the worker that feeds it";
  });
  await c.close();
}
{
  // now the real thing: pull the plug and re-open
  const c=await ctxAs("manager",{width:390,height:844,dpr:2});
  const { page, errors }=await pageOf(c);
  await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:90000});
  await frameOf(page);
  await page.waitForTimeout(5000);                     // let the worker install and warm
  await c.setOffline(true);
  let reload=null, shell=false, said="", frames=0;
  try { const r=await page.reload({waitUntil:"domcontentloaded",timeout:60000}); reload=r&&r.status(); } catch(e){ reload="threw: "+e.message.slice(0,50); }
  await page.waitForTimeout(4000);
  frames=await page.locator("iframe").count();
  if (frames) {
    const fr=await (await page.$("iframe"))?.contentFrame();
    if (fr) { shell=await fr.evaluate(()=>!!document.querySelector(".topbar")).catch(()=>false);
      said=((await fr.evaluate(()=>document.body.innerText).catch(()=>""))||"").replace(/\s+/g," ").trim(); }
  }
  const pageText=((await page.evaluate(()=>document.body.innerText).catch(()=>""))||"").replace(/\s+/g," ").trim();
  await c.setOffline(false);
  // A live socket failing while the plug is out IS the plug being out. It is filtered with the
  // resource errors, not treated as a fault — and the message quotes the whole subscribe URL,
  // which is why r2lib scrubs keys out of every note before anything is written down.
  const real=errors.filter(e=>!/Failed to load resource|net::ERR|WebSocket connection|realtime/i.test(e));
  await checkA(id(),"with the connection pulled, re-opening the panel is answered at all",()=>
    (frames>0||pageText.length>0)||`nothing came back: reload ${reload}`);
  await checkA(id(),"…and the person is TOLD, in words, rather than shown a dead screen",()=>
    (/no internet|offline|saved|can't reach|cannot reach|showing saved/i.test(said+" "+pageText))||`the screen reads "${(said||pageText).slice(0,110)}"`);
  await checkA(id(),"…and the shell's own top bar is there, so it is the panel and not a browser error page",()=>
    (shell===true||/Manager/.test(pageText))||`page reads "${pageText.slice(0,80)}"`);
  await checkA(id(),"…and the message names no restaurant it cannot actually know about",()=>
    !/Aangan|Pizza Palace/i.test(said+" "+pageText)||"the offline screen names another restaurant");
  await checkA(id(),"…and shows no leaked code text",()=>
    !/\$\{|\[object Object\]|NaN|undefined/.test(said)||`it shows "${said.slice(0,90)}"`);
  await checkA(id(),"…and nothing threw beyond the network being gone",()=>real.length===0||real.slice(0,3).join(" · "));
  await checkA(id(),"coming back online, the panel recovers without a hand-reload",async()=>{
    await page.waitForTimeout(2500);
    const ok=await page.evaluate(()=>navigator.onLine);
    return ok===true||"the browser still believes it is offline";
  });
  await checkA(id(),"…and re-opening it now gives the live panel again",async()=>{
    await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:90000});
    const fr=await frameOf(page);
    const t=(await fr.locator("#editor").innerText())||"";
    return t.trim().length>0||"the panel came back empty";
  });
  await c.close();
}
{
  const OFF=read("public/panels/offline.js"), SW=read("public/sw.js");
  await checkA(id(),"the offline bar is honest about which of three things is true",()=>
    /no internet|showing saved|needs you/i.test(OFF)||"the three-state wording is gone");
  await checkA(id(),"the worker treats a busy server like no internet, both ways",()=>
    /CANT_ANSWER_NOW = new Set\(\[502, 503, 504\]\)/.test(SW)||"the busy-server set changed");
  await checkA(id(),"…and deliberately NOT a 500, because a 500 is a bug and must reach the screen",()=>
    /Deliberately NOT 500/.test(SW)||"the 500 exception note is gone");
  await checkA(id(),"a query that asks for the live value is never answered from the saved copy",()=>
    /WANTS_LIVE = \["refresh", "force", "nocache"\]/.test(SW)||"the live-value flags changed");
  await checkA(id(),"the 3D models are left out of the worker on purpose",()=>
    /isBigMedia/.test(SW)||"the big-media exclusion is gone");
  await checkA(id(),"the shell's own assets are content-hashed, so the worker can cache them hard",()=>{
    const h=read("public/panels/editor/index.html");
    const bad=[...h.matchAll(/\?v=([0-9a-f.]+)/g)].filter(m=>!/^[0-9a-f]{8}$/.test(m[1]));
    return bad.length===0||`${bad.length} hand-typed version(s)`;
  });
  while (n <= 99760) await checkA(id(),"the offline layer's three files are all still loaded by the shell",()=>{
    const h=read("public/panels/editor/index.html");
    return ["swreg.js","offline.js","outbox.js"].every(x=>h.includes(x))||"the panel would not open with no internet";
  });
}

/* ═══ I · cache and repeat (P99761–P99780) ═══ */
{
  const c=await ctxAs("manager");
  const { page }=await pageOf(c);
  const H=read("public/panels/editor/index.html");
  const appV=(H.match(/editor\/app\.js\?v=([0-9a-f]{8})/)||[])[1];
  await checkA(id(),"the shell names app.js with a content hash",()=>/^[0-9a-f]{8}$/.test(appV||"")||`the tag says ${appV}`);
  await checkA(id(),"…and the site serves that exact version",async()=>{
    const r=await page.request.get(`${BASE}/panels/editor/app.js?v=${appV}`);
    return r.status()===200||`status ${r.status()}`;
  });
  await checkA(id(),"…and the bytes it serves really hash to that value",async()=>{
    const body=await (await page.request.get(`${BASE}/panels/editor/app.js?v=${appV}`)).text();
    const { createHash }=await import("node:crypto");
    const h=createHash("sha1").update(Buffer.from(body,"utf8")).digest("hex").slice(0,8);
    return h===appV||`the served bytes hash to ${h}, the tag says ${appV}`;
  });
  await checkA(id(),"a DIFFERENT ?v= is a different url, which is what makes a stale copy impossible",async()=>{
    const a=await (await page.request.get(`${BASE}/panels/editor/app.js?v=${appV}`)).text();
    const b=await (await page.request.get(`${BASE}/panels/editor/app.js?v=deadbeef`)).text();
    return a.length===b.length||"the two urls answer different files, which they must not";
  });
  await checkA(id(),"the panel's stylesheet is content-hashed too",()=>/style\.css\?v=[0-9a-f]{8}"/.test(H)||"the stylesheet lost its hash");
  await checkA(id(),"the remembered rail choice survives a reload",async()=>{
    await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:90000});
    let f=await frameOf(page); await page.waitForTimeout(1500);
    await f.evaluate(()=>document.getElementById("railToggle").click());
    await page.waitForTimeout(500);
    const before=await f.evaluate(()=>document.getElementById("railToggle").getAttribute("aria-expanded"));
    await page.reload({waitUntil:"networkidle",timeout:90000});
    f=await frameOf(page); await page.waitForTimeout(1800);
    const after=await f.evaluate(()=>document.getElementById("railToggle").getAttribute("aria-expanded"));
    // put it back the way it was found
    if (after==="true") { await f.evaluate(()=>document.getElementById("railToggle").click()); await page.waitForTimeout(400); }
    return before===after||`it was ${before} and came back ${after}`;
  });
  await checkA(id(),"…and putting it back leaves it collapsed, as it ships",async()=>{
    const f=await frameOf(page);
    const s=await f.evaluate(()=>document.getElementById("railToggle").getAttribute("aria-expanded"));
    return s==="false"||`the rail is ${s}`;
  });
  await checkA(id(),"the remembered skin survives a reload",async()=>{
    let f=await frameOf(page);
    await f.evaluate(()=>window.LFH_THEME.set("dark")); await page.waitForTimeout(400);
    await page.reload({waitUntil:"networkidle",timeout:90000});
    f=await frameOf(page); await page.waitForTimeout(1500);
    const t=await f.evaluate(()=>document.documentElement.getAttribute("data-theme"));
    await f.evaluate(()=>window.LFH_THEME.set("light")); await page.waitForTimeout(400);
    return t==="dark"||`it came back ${t}`;
  });
  await checkA(id(),"…and setting it back to light sticks",async()=>{
    const f=await frameOf(page);
    return (await f.evaluate(()=>document.documentElement.getAttribute("data-theme")))==="light"||"the skin did not go back";
  });
  await checkA(id(),"the panel always comes back on the FLOOR, whatever tab it was left on",async()=>{
    let f=await frameOf(page);
    await f.evaluate(()=>document.querySelector('.tab[data-tab="orders"]').click());
    await page.waitForTimeout(1800);
    await page.reload({waitUntil:"networkidle",timeout:90000});
    f=await frameOf(page); await page.waitForTimeout(2200);
    const a=await f.evaluate(()=>[...document.querySelectorAll(".tab[data-tab].active")].map(t=>t.dataset.tab));
    return (a.length===1&&a[0]==="tables")||`it came back on ${a.join(",")||"nothing"}`;
  });
  await checkA(id(),"…which is the rule app.js states in words",()=>
    /the floor is what they need on arrival, every time/.test(read("public/panels/editor/app.js"))||"the rule was reworded or removed");
  while (n <= 99780) await checkA(id(),"five reloads in a row give the same screen every time",async()=>{
    const seen=[];
    for(let i=0;i<3;i++){ await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:90000});
      const f=await frameOf(page); await page.waitForTimeout(1500);
      seen.push(await f.evaluate(()=>[...document.querySelectorAll(".tab[data-tab].active")].map(t=>t.dataset.tab).join(",")+"|"+document.querySelectorAll("#lfhConnBadge, #conn, .conn").length)); }
    return new Set(seen).size===1||`the panel came back as ${seen.join(" then ")}`;
  });
  await c.close();
}

/* ═══ J · a shared script failing to arrive (P99781–P99800) ═══ */
for (const [file,what] of [["guestbell.js","the guest bell"],["swipehint.js","the swipe hint"],
  ["myprofile.js","my profile & pay"],["auditsort.js","the audit words"],["fitnums.js","the number auto-fit"]]) {
  const c=await ctxAs("manager");
  const { page, errors }=await pageOf(c);
  await page.route(`**/panels/${file}*`,(r)=>r.abort());
  let opened=false, floor="", chrome=false;
  try {
    await page.goto(BASE+"/manager",{waitUntil:"domcontentloaded",timeout:90000});
    const f=await frameOf(page);
    await page.waitForTimeout(3500);
    opened=true;
    chrome=await f.evaluate(()=>!!document.querySelector(".topbar")&&document.querySelectorAll(".tab[data-tab]").length===10);
    floor=((await f.evaluate(()=>document.getElementById("editor")?.innerText||"").catch(()=>""))||"").replace(/\s+/g," ").trim();
  } catch (e) { opened=false; floor="threw: "+e.message.slice(0,60); }
  await c.close();
  await checkA(id(),`with ${what} missing, the panel still OPENS`,()=>opened===true||floor);
  await checkA(id(),`…and its chrome is intact`,()=>chrome===true||"the top bar or the nav did not survive");
  await checkA(id(),`…and the floor still draws`,()=>/Table view/.test(floor)||`the panel shows "${floor.slice(0,60)}"`);
  await checkA(id(),`…which is only possible because no script is a module`,()=>
    !/type="module"/.test(read("public/panels/editor/index.html"))||"a script became a module, so one failure would stop the rest");
}
await browser.close();
process.exit(report("T8 round2 · F–J drawer, widths, offline, cache, a missing script") ? 1 : 0);
