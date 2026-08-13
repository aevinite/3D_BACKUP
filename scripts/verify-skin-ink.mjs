// Guard: the connection pill's ink must stay readable in EVERY skin combination a real person can
// hold. The guest menu's theme (lfh_theme) and a console's skin (aevidine_skin) are independent
// keys, so dark-guest + light-console is an ordinary state — and it read 1.99:1 live on 2026-08-06
// because `html[data-theme="dark"]` outranks a `[data-skin="light"]` rule on specificity.
//   node scripts/verify-skin-ink.mjs [--base <url>]
// The exact combination that broke it: guest key dark + console skin light.
import { chromium } from "playwright";
import { loginAs, adminCookie } from "./sweep/login.mjs";
import { requireAppUp } from "./sweep/appUp.mjs";
const argv=process.argv.slice(2);
// Nothing answering used to end this as an uncaught ReferenceError under node:internal/…, which
// reads as "the guard is broken" rather than "start the dev server". One shared preflight, one
// sentence, exit 2 = could not run (never confused with "ran and found a fault"). T10, 2026-08-12.
const B = await requireAppUp(process.argv, "the skin-ink contrast check");
let bad=0;
const lum=(r,g,b)=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
const P=s=>{const m=String(s).match(/-?[\d.]+/g);const k=/^color\(\s*srgb/i.test(String(s))?255:1;return [+m[0]*k,+m[1]*k,+m[2]*k]};
const R=(a,b)=>((Math.max(lum(...a),lum(...b))+.05)/(Math.min(lum(...a),lum(...b))+.05)).toFixed(2);
const br=await chromium.launch();
for (const [role,url] of [["admin","/aevinite"],["admin","/aevinite/health"],["admin","/aevinite/recycle"],["owner","/owner"],["owner","/owner/reports"]]) {
  // `js:false` reproduces the FIRST PAINT: server HTML + <head> CSS only, no hydration. The ink
  // used to live in styled-jsx, which injects on hydration, so this is the frame that measured
  // 2.82:1 on the dark console while the settled state read a healthy 6.21:1.
  for (const [cons,guest,js] of [["light","dark",true],["light","light",true],["dark","dark",true],["dark","dark",false],["light","light",false]]) {
    const c=await br.newContext({viewport:{width:1280,height:900},serviceWorkers:"block",javaScriptEnabled:js});
    if(role==="admin") await c.addCookies([adminCookie(B)]); else await loginAs(c,role,B);
    await c.addCookies([{name:"aevidine_skin",value:cons,url:B}]);
    const p=await c.newPage();
    await p.addInitScript(`try{localStorage.setItem("aevidine_skin","${cons}");localStorage.setItem("lfh_theme","${guest}")}catch(e){}`);
    await p.goto(B+url,{waitUntil:"domcontentloaded",timeout:60000}); await p.waitForTimeout(js?(role==="admin"?7500:9500):1500);
    const r=await p.evaluate(()=>{const t=document.querySelector(".lfh-conn-txt")||document.querySelector(".lfh-conn-ms");
      if(!t)return null;let cur=t,bg="rgb(255,255,255)";
      while(cur){const b=getComputedStyle(cur).backgroundColor;const m=String(b).match(/[\d.]+/g);if(m&&(m.length<4||+m[3]>0.85)){bg=b;break;}cur=cur.parentElement;}
      return {txt:t.textContent.trim().slice(0,12),color:getComputedStyle(t).color,bg,skin:document.querySelector("[data-skin]")?.getAttribute("data-skin"),theme:document.documentElement.getAttribute("data-theme")};});
    // the popover is interaction-only, so no screenshot sweep ever sees it. Click, let React
    // render, THEN read — reading in the same tick as the click returns null.
    let popSame = null;
    if (js && r) {
      const pillInk = await p.evaluate(()=>{const e=document.querySelector(".lfh-conn-txt")||document.querySelector(".lfh-conn-ms");return e?getComputedStyle(e).color:null;});
      // the clickable element is the pill's own <button> ancestor — `button.lfh-conn` alone misses
      // it on the surfaces where the badge is nested differently
      await p.evaluate(()=>{const t=document.querySelector(".lfh-conn-txt")||document.querySelector(".lfh-conn-ms");
        const b=(t&&t.closest("button"))||document.querySelector("button.lfh-conn")||document.querySelector("[aria-expanded]");
        if(b)b.click();});
      await p.waitForTimeout(1200);
      const figInk = await p.evaluate(()=>{const f=document.querySelector(".lfh-conn-pop-fig");return f?getComputedStyle(f).color:null;});
      popSame = {pillInk, figInk, same: !!figInk && figInk===pillInk};
    }
    const cr=r?R(P(r.color),P(r.bg)):"n/a";
    const ok = r && +cr>=3 && (!popSame || popSame.same);
    if (popSame && !popSame.same) console.log(popSame.figInk
      ? `   popover ink ${popSame.figInk} does not follow the surface (pill is ${popSame.pillInk})`
      : `   no .lfh-conn-pop-fig — the popover figure is not surface-aware (pill is ${popSame.pillInk})`);
    console.log(`${ok?"✓":"✗"} ${url.padEnd(20)} console=${cons} guest=${guest} ${js?"hydrated":"FIRSTPAINT"} → skin=${r?.skin} "${r?.txt}" ${cr}:1`);
    if(!ok) bad++;
    await c.close();
  }
}
await br.close();
console.log(bad?`\n${bad} skin combination(s) below 3:1 — the nearest surface is not winning.`:"\nOK — the pill is readable in every skin combination.");
process.exit(bad?1:0);
