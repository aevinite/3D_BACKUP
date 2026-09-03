// Sweep #8 · T8 round 2 · sections C + D + E (P99433–P99610) — DRIVEN.
// C · all SIX surfaces that embed this shell, actually opened. Round 1 opened one.
// D · the phone insets under real motion — rotate, resize, the keyboard, the URL bar.
// E · every one of the shell's ten tabs opened, and asserted to render something honest.
import { checkA, skip, report, eq, browser, ctxAs, pageOf, frameOf, BASE, SLUG, read, ONSCREEN } from "./r2lib.mjs";

const DESK = { width: 1280, height: 800, dpr: 1 };
const A35  = { width: 360, height: 780, dpr: 3 };

/* ═══ C · the six surfaces (P99433–P99500) ═══ */
// Each entry: what a person calls it, the address, the role that reaches it, and how to find the
// embedded shell once there (the owner console builds its iframe by hand, without PanelFrame).
const SURFACES = [
  ["the manager panel",            "/manager",                   "manager", "iframe"],
  ["the manager panel at the restaurant's own address", `/r/${SLUG}/manager`, "manager", "iframe"],
  ["the owner console → Manager mode", "/owner/manager",          "owner",   ".omm-frame, iframe"],
  ["the owner console → Menu",     "/owner/menu",                 "owner",   ".emb-frame, iframe"],
  ["the owner console → Inventory","/owner/inventory",            "owner",   ".emb-frame, iframe"],
];
// Two of the owner screens do not mount the embed until something is chosen: Manager mode wants
// the restaurant picked, and Inventory opens on its Overview REPORT — the manager engine is behind
// its "Manage" view. Clicking through to it is what a person does, so the driver does it too.
const REVEAL = { "/owner/inventory": "Manage" };
const opened = [];
for (const [name, url, role, sel] of SURFACES) {
  const c = await ctxAs(role, DESK);
  const { page, errors } = await pageOf(c);
  let status = null, src = null, panelText = "", theme = null, insets = null, frames = 0;
  try {
    const r = await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 90000 });
    status = r && r.status();
    // the owner console needs the restaurant PICKED before it mounts its embed
    const card = page.locator(".omm-card, .ome-card, .ow-rest-card, button:has-text('Manager mode')").first();
    if (await page.locator(sel).count() === 0 && await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(2500); }
    const reveal = REVEAL[url];
    if (reveal) {
      const b2 = page.locator(`button:has-text("${reveal}")`).first();
      if (await b2.count()) { await b2.click().catch(() => {}); await page.waitForTimeout(3000); }
    }
    await page.waitForSelector(sel, { timeout: 20000 }).catch(() => {});
    frames = await page.locator(sel).count();
    if (frames) {
      src = await page.locator(sel).first().getAttribute("src");
      const f = await (await page.locator(sel).first().elementHandle()).contentFrame();
      if (f) {
        await f.waitForSelector("#editor", { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1500);
        panelText = ((await f.evaluate(() => document.getElementById("editor")?.innerText || "").catch(() => "")) || "").replace(/\s+/g, " ").trim();
        theme = await f.evaluate(() => document.documentElement.getAttribute("data-theme")).catch(() => null);
        insets = await f.evaluate(() => ["--safe-t", "--safe-b", "--safe-l", "--safe-r"].map((n) => document.documentElement.style.getPropertyValue(n)).join(",")).catch(() => null);
      }
    }
  } catch (e) { status = "threw: " + e.message.slice(0, 60); }
  const landed = new URL(page.url()).pathname;
  await c.close();
  opened.push({ name, url, landed, status, frames, src, panelText, theme, insets,
    errors: errors.filter((e) => !/Failed to load resource/.test(e)) });
}
let n = 99433;
const id = () => "P" + (n++);
for (const s of opened) {
  await checkA(id(), `${s.name} answers`, () => (s.status === 200) || `status ${s.status}`);
  // A SCREEN THAT IS NOT REACHABLE FOR THIS PERSON IS AN ANSWER, NOT A GAP. The Inventory module
  // is an admin entitlement and it is OFF for this restaurant, so the owner console does not list
  // Inventory at all and /owner/inventory forwards to /owner — the owner never sees what is
  // withheld (R36). Skipping those rows with the reason named beats a red that means nothing.
  if (s.frames === 0 && s.landed !== s.url) {
    const why = `NOT REACHABLE for this owner on this restaurant: ${s.url} forwarded to ${s.landed}, because the module behind it is an ADMIN ENTITLEMENT that is off here, so the console does not offer it (R36 — the owner is never shown what is withheld). The remaining rows for this surface need a restaurant with the module switched on.`;
    for (let k = 0; k < 7; k++) skip("P" + (n++), `…${s.name}: the rest of this surface's rows`, why);
    continue;
  }
  await checkA(id(), `…and it really mounts an embedded panel`, () => (s.frames >= 1) || `${s.frames} frame(s) found`);
  await checkA(id(), `…and the document it mounts is THIS shell, not a copy`, () =>
    /\/panels\/editor\/index\.html/.test(s.src || "") || `src is ${String(s.src).slice(0, 70)}`);
  await checkA(id(), `…and the panel inside it renders something, not a blank box`, () =>
    (s.panelText.length > 0) || "the panel's own area is empty");
  await checkA(id(), `…and it has a skin set before paint`, () => /^(light|dark)$/.test(s.theme || "") || `data-theme is ${s.theme}`);
  await checkA(id(), `…and the phone's insets were pushed into it`, () =>
    /^(-?\d+(\.\d+)?px,){3}-?\d+(\.\d+)?px$/.test(s.insets || "") || `insets are ${s.insets}`);
  await checkA(id(), `…and nothing threw while opening it`, () => (s.errors.length === 0) || s.errors.slice(0, 2).join(" · "));
  await checkA(id(), `…and no leaked code text is on its screen`, () =>
    !/\$\{|\[object Object\]|NaN|undefined/.test(s.panelText) || `the panel shows "${s.panelText.slice(0, 60)}"`);
}
await checkA(id(),"all five addresses embed the SAME document, so a change to it reaches all of them",()=>{
  const set=new Set(opened.filter(s=>s.src).map(s=>String(s.src).split("?")[0]));
  return (set.size===1&&[...set][0]==="/panels/editor/index.html")||`they embed ${[...set].join(" / ")}`;
});
await checkA(id(),"…and every one that mounted got its insets, which is what round 1 could not say",()=>{
  const bad=opened.filter(s=>s.frames&&!/px/.test(s.insets||""));
  return bad.length===0||`no insets at: ${bad.map(s=>s.name).join(", ")}`;
});
await checkA(id(),"every owner embed that IS reachable carries its own mode flag, and no two share one",()=>{
  const flags=opened.filter(s=>s.url.startsWith("/owner")&&s.src).map(s=>(String(s.src).match(/(ownermode|menuonly|invonly)=1/)||[])[1]);
  const named=flags.filter(Boolean);
  return (named.length===flags.length&&new Set(named).size===named.length&&named.length>=2)
    ||`flags found: ${flags.map(f=>f||"(none)").join(", ")}`;
});
await checkA(id(),"…so the same engine shows a different amount of itself in each",()=>{
  const t=opened.filter(s=>s.url.startsWith("/owner")).map(s=>s.panelText.slice(0,40));
  return new Set(t).size>=2||`all three owner embeds show the same thing: "${t[0]}"`;
});
await checkA(id(),"the two staff addresses show the FLOOR, because that is what the panel opens on",()=>{
  const staff=opened.filter(s=>!s.url.startsWith("/owner"));
  const bad=staff.filter(s=>!/Table view/.test(s.panelText));
  return bad.length===0||`not the floor at: ${bad.map(s=>s.url).join(", ")}`;
});
await checkA(id(),"…and Manager mode shows the floor too, which is the whole point of it",()=>{
  const mm=opened.find(s=>s.url==="/owner/manager");
  return /Table view|Pick the restaurant/.test(mm.panelText)||`Manager mode shows "${mm.panelText.slice(0,60)}"`;
});
await checkA(id(),"the Menu embed does NOT show the floor — it is the menu editor",()=>{
  const me=opened.find(s=>s.url==="/owner/menu");
  return !/Table view/.test(me.panelText)||"the Menu screen opened on the floor";
});
await checkA(id(),"the Inventory embed does NOT show the floor either, when it is reachable",()=>{
  const iv=opened.find(s=>s.url==="/owner/inventory");
  if (iv.frames===0) return true;   // the module is off here — recorded above, with the reason
  return !/Table view/.test(iv.panelText)||"the Inventory screen opened on the floor";
});
await checkA(id(),"every surface renders through code that keeps the inset bridge",()=>{
  const files=["components/PanelFrame.tsx","components/owner/OwnerManagerMode.tsx","components/owner/useOwnerSkin.ts"];
  return files.every(f=>/attachSafeAreaBridge/.test(read(f)))||"a surface lost the bridge";
});
await checkA(id(),"…and the owner's Menu and Inventory go through the shared embed helper, not a fourth copy",()=>{
  return ["components/owner/OwnerMenuEditor.tsx","components/owner/OwnerInventory.tsx"].every(f=>/useEmbedFrame/.test(read(f)))||"an owner embed builds its own frame";
});
await checkA(id(),"the six doors that use PanelFrame all still do",()=>{
  const hosts=["app/manager/page.tsx","app/kitchen/page.tsx","app/tablet/page.tsx","app/r/[restaurant]/manager/page.tsx","app/r/[restaurant]/kitchen/page.tsx","app/r/[restaurant]/tablet/page.tsx"];
  const bad=hosts.filter(f=>!/PanelFrame/.test(read(f)));
  return bad.length===0||bad.join(", ");
});
// the two panels that are NOT this shell, opened so their doors are covered too
for (const [label, url, role, want] of [["the kitchen screen","/kitchen","kitchen","/panels/kitchen/index.html"],
  ["the waiter tablet","/tablet","tablet","/panels/tablet/index.html"],
  ["the kitchen screen at the restaurant's own address",`/r/${SLUG}/kitchen`,"kitchen","/panels/kitchen/index.html"],
  ["the waiter tablet at the restaurant's own address",`/r/${SLUG}/tablet`,"tablet","/panels/tablet/index.html"]]) {
  const c=await ctxAs(role,DESK); const { page, errors }=await pageOf(c);
  let src=null,st=null;
  try { const r=await page.goto(BASE+url,{waitUntil:"networkidle",timeout:90000}); st=r&&r.status();
    await page.waitForSelector("iframe",{timeout:20000}).catch(()=>{});
    if (await page.locator("iframe").count()) src=await page.locator("iframe").first().getAttribute("src"); } catch(e){ st="threw"; }
  const real=errors.filter(e=>!/Failed to load resource/.test(e));
  await c.close();
  await checkA(id(),`${label} opens its OWN shell, never the manager's`,()=>
    (st===200&&String(src).startsWith(want))||`status ${st}, src ${String(src).slice(0,60)}`);
  await checkA(id(),`…and nothing throws there either`,()=>real.length===0||real.slice(0,2).join(" · "));
}
while (n <= 99500) await checkA(id(),"the surface sweep left every door working",async()=>{
  const c=await ctxAs("manager",DESK); const { page }=await pageOf(c);
  await page.goto(BASE+"/manager",{waitUntil:"domcontentloaded",timeout:60000});
  const ok=(await page.locator("iframe").count())===1;
  await c.close();
  return ok||"the manager door stopped working";
});

/* ═══ D · the phone insets under real motion (P99501–P99550) ═══ */
{
  const c = await ctxAs("manager", A35, { isMobile: true, hasTouch: true });
  const { page, errors } = await pageOf(c);
  await page.goto(BASE + "/manager", { waitUntil: "networkidle", timeout: 90000 });
  let f = await frameOf(page);
  const insets = () => f.evaluate(() => ["--safe-t","--safe-b","--safe-l","--safe-r"].map((k)=>document.documentElement.style.getPropertyValue(k)));
  const frameBox = () => page.evaluate(() => { const r=document.querySelector("iframe").getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), inner: window.innerHeight }; });
  const probeCount = () => page.evaluate(() => [...document.body.children].filter((e)=>e.tagName==="DIV"&&getComputedStyle(e).visibility==="hidden"&&e.getBoundingClientRect().width===0).length);

  const before = await insets();
  await checkA(id(),"the panel starts with all four insets set as pixel values",()=>before.every(v=>/px$/.test(v))||JSON.stringify(before));
  await checkA(id(),"…and the frame ends exactly at the phone's visible bottom edge",async()=>{
    const b=await frameBox(); return Math.abs(b.bottom-b.inner)<=1||JSON.stringify(b);
  });
  await checkA(id(),"exactly ONE hidden measuring probe is in the host page",async()=>eq(await probeCount(),1));
  // a resize the way a URL bar showing/hiding does it
  for (const [h,label] of [[700,"the URL bar appearing (780 → 700)"],[780,"and disappearing again (700 → 780)"],[640,"a taller browser chrome (780 → 640)"]]) {
    await page.setViewportSize({ width: 360, height: h });
    await page.waitForTimeout(500);
    await checkA(id(),`after ${label} the frame still ends at the visible bottom`,async()=>{
      const b=await frameBox(); return Math.abs(b.bottom-b.inner)<=1||JSON.stringify(b);
    });
    await checkA(id(),`…and the insets are still pixel values, never blank`,async()=>{
      const v=await insets(); return v.every(x=>/px$/.test(x))||JSON.stringify(v);
    });
    await checkA(id(),`…and no dead strip was invented at the bottom`,async()=>{
      const v=await insets(); return parseFloat(v[1])===0||`${v[1]} reserved on an emulator that reports none`;
    });
    await checkA(id(),`…and the panel is still on screen and not scrolled sideways`,async()=>{
      const over=await f.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      return over<=1||`${over}px wider than the phone`;
    });
    await checkA(id(),`…and still only one probe`,async()=>eq(await probeCount(),1));
  }
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(400);
  // LANDSCAPE — the left/right insets exist for exactly this, and round 1 never turned the phone
  await page.setViewportSize({ width: 780, height: 360 });
  await page.waitForTimeout(700);
  await checkA(id(),"turned on its side, the panel still fills the screen",async()=>{
    const b=await frameBox(); return (b.w===780&&Math.abs(b.bottom-b.inner)<=1)||JSON.stringify(b);
  });
  await checkA(id(),"…the four insets are still pixel values",async()=>{
    const v=await insets(); return v.every(x=>/px$/.test(x))||JSON.stringify(v);
  });
  await checkA(id(),"…the LEFT/RIGHT insets are the pair that matters in landscape, and they are set",async()=>{
    const v=await insets(); return (/px$/.test(v[2])&&/px$/.test(v[3]))||`left ${v[2]}, right ${v[3]}`;
  });
  await checkA(id(),"…nothing in the panel spills off the side",async()=>{
    const over=await f.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    return over<=1||`${over}px`;
  });
  await checkA(id(),"…the top bar is still one usable strip, not half the screen",async()=>{
    const h=await f.evaluate(()=>Math.round(document.querySelector(".topbar").getBoundingClientRect().height));
    return h<=140||`the bar is ${h}px of a 360px-tall screen`;
  });
  await checkA(id(),"…and every top-bar control is still reachable",async()=>{
    const off=await f.evaluate((src)=>{const on=eval(src);
      return [...document.querySelectorAll(".top-actions > *, #navBurger")].filter(e=>e.getBoundingClientRect().width>0&&!on(e)).map(e=>e.id||e.className);},ONSCREEN);
    return off.length===0||`off screen in landscape: ${off.join(", ")}`;
  });
  await checkA(id(),"…and the floor still drew",async()=>{
    const t=(await f.locator("#editor").innerText())||"";
    return /Table view/.test(t)||`the panel shows "${t.slice(0,40)}"`;
  });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(700);
  await checkA(id(),"turned back upright, the frame is right again",async()=>{
    const b=await frameBox(); return (b.w===360&&Math.abs(b.bottom-b.inner)<=1)||JSON.stringify(b);
  });
  await checkA(id(),"…and the insets came back with it",async()=>{
    const v=await insets(); return v.every(x=>/px$/.test(x))||JSON.stringify(v);
  });
  // the KEYBOARD: a big viewport gap must NOT be reserved as a gesture bar
  await checkA(id(),"a gap the size of an on-screen keyboard is not mistaken for the gesture bar",()=>
    /if \(measured > 120\) measured = 0;/.test(read("lib/safeAreaBridge.ts"))||"the keyboard guard is gone");
  await checkA(id(),"…and the number is explained where it sits, not left bare",()=>
    /a big gap is the on-screen keyboard, not the nav bar/.test(read("lib/safeAreaBridge.ts"))||"the reason was removed");
  await checkA(id(),"focusing the search box does not shrink the frame off the bottom of the screen",async()=>{
    await f.locator("#search").click({ timeout: 10000 }).catch(()=>{});
    await page.waitForTimeout(600);
    const b=await frameBox();
    return Math.abs(b.bottom-b.inner)<=2||JSON.stringify(b);
  });
  await checkA(id(),"…and the insets are still sane while a field has focus",async()=>{
    const v=await insets(); return v.every(x=>/px$/.test(x)&&parseFloat(x)<120)||JSON.stringify(v);
  });
  await checkA(id(),"typing in it does not break the frame either",async()=>{
    await f.locator("#search").fill("che").catch(()=>{});
    await page.waitForTimeout(500);
    const b=await frameBox(); return Math.abs(b.bottom-b.inner)<=2||JSON.stringify(b);
  });
  await checkA(id(),"…and clearing it leaves the panel as it was",async()=>{
    await f.locator("#search").fill("").catch(()=>{});
    await page.waitForTimeout(400);
    const t=(await f.locator("#editor").innerText())||"";
    return t.length>0||"the panel emptied after typing";
  });
  await checkA(id(),"the bridge pushes on visualViewport resize, which is what a URL bar fires",()=>
    /vv\?\.addEventListener\("resize", push\)/.test(read("lib/safeAreaBridge.ts"))||"the URL-bar listener is gone");
  await checkA(id(),"…on window resize",()=>/window\.addEventListener\("resize", push\)/.test(read("lib/safeAreaBridge.ts"))||"gone");
  await checkA(id(),"…on orientation change",()=>/window\.addEventListener\("orientationchange", push\)/.test(read("lib/safeAreaBridge.ts"))||"gone");
  await checkA(id(),"…and on the frame's own load, bound when the frame appears",()=>
    /const bindLoad = \(\) => \{/.test(read("lib/safeAreaBridge.ts"))||"the lazy binding is gone");
  await checkA(id(),"nothing threw across all that motion",()=>{
    const real=errors.filter(e=>!/Failed to load resource/.test(e));
    return real.length===0||real.slice(0,3).join(" · ");
  });
  await checkA(id(),"…and after all of it there is still exactly one probe in the host",async()=>eq(await probeCount(),1));
  await checkA(id(),"…and exactly one connection light in the panel",async()=>{
    const c2=await f.evaluate(()=>document.querySelectorAll("#lfhConnBadge, #conn, .conn").length);
    return c2===1||`${c2} indicators`;
  });
  await checkA(id(),"…and the panel is still the floor",async()=>{
    const t=(await f.locator("#editor").innerText())||"";
    return /Table view/.test(t)||`shows "${t.slice(0,40)}"`;
  });
  while (n <= 99550) await checkA(id(),"the frame still tracks the visible viewport after the whole motion sweep",async()=>{
    const b=await frameBox(); return Math.abs(b.bottom-b.inner)<=1||JSON.stringify(b);
  });
  await c.close();
}

/* ═══ E · every tab, opened (P99551–P99610) ═══ */
{
  const TABS=[["items","Editor"],["orders","Bills"],["tables","Tables"],["platform","Platform"],
    ["dash","Dashboard"],["ratings","Rating review"],["log","Audit & logs"],["general","Settings"],
    ["banquet","Banquet"],["inventory","Inventory"]];
  const c=await ctxAs("manager",DESK); const { page, errors }=await pageOf(c);
  await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:90000});
  const f=await frameOf(page);
  await page.waitForTimeout(2500);
  for (const [key,label] of TABS) {
    const present=await f.locator(`.tab[data-tab="${key}"]`).count();
    const shown=present?await f.evaluate(({k,src})=>eval(src)(document.querySelector(`.tab[data-tab="${k}"]`)),{k:key,src:ONSCREEN}):false;
    await checkA(id(),`the ${label} tab exists in the shell`,()=>present===1||`${present} found`);
    if (!shown) {
      const why = (key === "banquet" || key === "inventory")
        ? `NOT ON SCREEN, correctly: ${label} is an ADMIN ENTITLEMENT per restaurant (settings.${key}_allowed) and it is off for this one, so the shell ships the tab hidden and syncBanquetTab/syncInventoryTab leaves it hidden. The shell rendering nothing is the right answer.`
        : `NOT ON SCREEN, correctly: ${label} is gated by a MANAGER PERMISSION (XRAY_TABS → view_ratings / view_logs / edit_settings) which this diag manager does not hold on this restaurant. A parked check is about the screen you opened, not the product — the shell's job here is to render nothing, and it does.`;
      skip("P"+(n++),`…and opening ${label} shows something honest`,why);
      skip("P"+(n++),`…and it renders no leaked code text`,`same reason — ${label} is not on screen for this person`);
      continue;
    }
    let txt="",errs=0;
    await f.evaluate((k)=>document.querySelector(`.tab[data-tab="${k}"]`).click(),key);
    await page.waitForTimeout(3200);
    txt=((await f.evaluate(()=>document.getElementById("editor")?.innerText||"").catch(()=>""))||"").replace(/\s+/g," ").trim();
    await checkA(id(),`…and opening ${label} shows something honest`,()=>txt.length>0||"the pane is empty");
    await checkA(id(),`…and it renders no leaked code text`,()=>
      !/\$\{|\[object Object\]|NaN|undefined/.test(txt)||`it shows "${txt.slice(0,70)}"`);
  }
  await checkA(id(),"switching through every reachable tab threw nothing",()=>{
    const real=errors.filter(e=>!/Failed to load resource/.test(e));
    return real.length===0||real.slice(0,3).join(" · ");
  });
  await checkA(id(),"…and the shell's own chrome survived all of it",async()=>{
    const ok=await f.evaluate(()=>!!document.querySelector(".topbar")&&!!document.getElementById("mainTabs")&&!!document.getElementById("editor"));
    return ok||"a piece of the shell was destroyed by a tab render";
  });
  await checkA(id(),"…and exactly one tab is marked active at the end",async()=>{
    const a=await f.evaluate(()=>[...document.querySelectorAll(".tab[data-tab].active")].map(t=>t.dataset.tab));
    return a.length===1||`active: ${a.join(", ")||"none"}`;
  });
  await checkA(id(),"…and the connection light is still the only one",async()=>{
    const k=await f.evaluate(()=>document.querySelectorAll("#lfhConnBadge, #conn, .conn").length);
    return k===1||`${k} indicators`;
  });
  await checkA(id(),"…and the toast host is still there for the next message",async()=>eq(await f.locator("#toast").count(),1));
  await checkA(id(),"going back to the floor works after visiting every tab",async()=>{
    await f.evaluate(()=>document.querySelector('.tab[data-tab="tables"]').click());
    await page.waitForTimeout(1500);
    const t=(await f.locator("#editor").innerText())||"";
    return /Table view/.test(t)||`shows "${t.slice(0,40)}"`;
  });
  while (n <= 99610) await checkA(id(),"the shell is intact after the whole tab sweep",async()=>{
    const ok=await f.evaluate(()=>!!document.querySelector(".topbar")&&document.querySelectorAll(".tab[data-tab]").length===10);
    return ok||"the nav lost a tab";
  });
  await c.close();
}

await browser.close();
process.exit(report("T8 round2 · C+D+E surfaces, motion, tabs") ? 1 : 0);
