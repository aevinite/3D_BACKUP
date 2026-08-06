// Guard: the connection pill's ink must stay readable in EVERY skin combination a real person can
// hold. The guest menu's theme (lfh_theme) and a console's skin (aevidine_skin) are independent
// keys, so dark-guest + light-console is an ordinary state — and it read 1.99:1 live on 2026-08-06
// because `html[data-theme="dark"]` outranks a `[data-skin="light"]` rule on specificity.
//   node scripts/verify-skin-ink.mjs [--base <url>]
// The exact combination that broke it: guest key dark + console skin light.
import { chromium } from "playwright";
import { loginAs, adminCookie } from "./sweep/login.mjs";
const argv=process.argv.slice(2);
const B=(argv.includes("--base")?argv[argv.indexOf("--base")+1]:null)||process.env.BASE||"http://localhost:4000";
let bad=0;
const lum=(r,g,b)=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
const P=s=>{const m=String(s).match(/-?[\d.]+/g);const k=/^color\(\s*srgb/i.test(String(s))?255:1;return [+m[0]*k,+m[1]*k,+m[2]*k]};
const R=(a,b)=>((Math.max(lum(...a),lum(...b))+.05)/(Math.min(lum(...a),lum(...b))+.05)).toFixed(2);
const br=await chromium.launch();
for (const [role,url] of [["admin","/aevinite"],["admin","/aevinite/health"],["admin","/aevinite/recycle"],["owner","/owner"],["owner","/owner/reports"]]) {
  for (const [cons,guest] of [["light","dark"],["light","light"],["dark","dark"]]) {
    const c=await br.newContext({viewport:{width:1280,height:900},serviceWorkers:"block"});
    if(role==="admin") await c.addCookies([adminCookie(B)]); else await loginAs(c,role,B);
    await c.addCookies([{name:"aevidine_skin",value:cons,url:B}]);
    const p=await c.newPage();
    await p.addInitScript(`try{localStorage.setItem("aevidine_skin","${cons}");localStorage.setItem("lfh_theme","${guest}")}catch(e){}`);
    await p.goto(B+url,{waitUntil:"domcontentloaded",timeout:60000}); await p.waitForTimeout(role==="admin"?7500:9500);
    const r=await p.evaluate(()=>{const t=document.querySelector(".lfh-conn-txt")||document.querySelector(".lfh-conn-ms");
      if(!t)return null;let cur=t,bg="rgb(255,255,255)";
      while(cur){const b=getComputedStyle(cur).backgroundColor;const m=String(b).match(/[\d.]+/g);if(m&&(m.length<4||+m[3]>0.85)){bg=b;break;}cur=cur.parentElement;}
      return {txt:t.textContent.trim().slice(0,12),color:getComputedStyle(t).color,bg,skin:document.querySelector("[data-skin]")?.getAttribute("data-skin"),theme:document.documentElement.getAttribute("data-theme")};});
    const cr=r?R(P(r.color),P(r.bg)):"n/a";
    const ok = r && +cr>=3;
    console.log(`${ok?"✓":"✗"} ${url.padEnd(20)} console=${cons} guestKey=${guest} → skin=${r?.skin} theme=${r?.theme} "${r?.txt}" ${cr}:1`);
    if(!ok) bad++;
    await c.close();
  }
}
await br.close();
console.log(bad?`\n${bad} skin combination(s) below 3:1 — the nearest surface is not winning.`:"\nOK — the pill is readable in every skin combination.");
process.exit(bad?1:0);
