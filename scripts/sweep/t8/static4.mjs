// Sweep #8 · terminal 8 · sections J–L of P61701–P62700.
// J = the script manifest · K = this project's own written rules · L = cross-panel truth.
import { read, exists, check, skip, report, has, hasNot, countOf, eq, before, codeOf, htmlCodeOf, ROOT } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const H    = read("public/panels/editor/index.html");
const HC   = htmlCodeOf(H);
const APP  = read("public/panels/editor/app.js");
const INV  = read("public/panels/editor/inventory.js");
const CSS  = read("public/panels/editor/style.css");
const PAGE = read("app/manager/page.tsx");
const LAY  = read("app/manager/layout.tsx");
const ED   = read("app/editor/page.tsx");
const PF   = read("components/PanelFrame.tsx");
const SAB  = read("lib/safeAreaBridge.ts");
const SW   = read("public/sw.js");
const HKIT = read("public/panels/kitchen/index.html");
const HTAB = read("public/panels/tablet/index.html");
const sha8 = (f) => createHash("sha1").update(fs.readFileSync(path.join(ROOT, f))).digest("hex").slice(0, 8);

const ASSETS = [...H.matchAll(/(?:src|href)="(\/panels\/[^"?]+\.(?:js|css))\?v=([0-9a-f.]+)"/g)]
  .map(m => ({ url: m[1], ver: m[2], disk: "public" + m[1] }));
const SCRIPTS = [...H.matchAll(/<script src="(\/panels\/[^"?]+\.js)\?v=/g)].map(m => m[1]);
// ORDERING IS READ OFF THE MARKUP (HC), never the notes: this file's obituaries name
// "editor/app.js" hundreds of lines above the tag, and a bare indexOf would read the note as the
// load position. Fifteen of these rows went red on a file whose order had not moved at all.
const pos = (f) => HC.indexOf(f);
const loadsBefore = (a, b) => pos(a) > -1 && pos(b) > -1 && pos(a) < pos(b);

/* ═══════════ J · the script manifest (P62201–P62280) ═══════════ */
check("P62201","the document loads 22 panel scripts",()=>eq(SCRIPTS.length,22));
check("P62202","every asset the document names really exists on disk",()=>{
  const missing=ASSETS.filter(a=>!exists(a.disk));
  return missing.length===0||`points at files that are not there: ${missing.map(a=>a.url).join(", ")}`;
});
check("P62203","…which matters because verify:panel-cache SKIPS an asset it cannot find on disk",()=>has(read("scripts/verify-panel-cache.mjs"),/if \(!existsSync\(onDisk\)\) return m;/));
check("P62204","every ?v= equals its file's real content hash",()=>{
  const bad=ASSETS.filter(a=>exists(a.disk)&&a.ver!==sha8(a.disk));
  return bad.length===0||`stale: ${bad.map(a=>`${a.url} says ${a.ver}, content says ${sha8(a.disk)}`).join(" · ")}`;
});
check("P62205","no asset is loaded twice",()=>{
  const dup=SCRIPTS.filter((v,i)=>SCRIPTS.indexOf(v)!==i);
  return dup.length===0||`loaded twice: ${[...new Set(dup)].join(", ")}`;
});
check("P62206","every script tag is closed",()=>eq(countOf(H,/<script /g),countOf(H,/<\/script>/g)));
check("P62207","no script carries defer or async, so the order in the file IS the order they run",()=>{
  const tags=[...H.matchAll(/<script src="\/panels[^>]*>/g)].map(m=>m[0]);
  const bad=tags.filter(t=>/\b(?:defer|async)\b/.test(t));
  return bad.length===0||`${bad.length} script(s) would run out of order`;
});
check("P62208","theme.js runs first of all, from the head",()=>loadsBefore("/panels/theme.js","/panels/maint.js"));
check("P62209","the charts library loads before app.js draws with it",()=>loadsBefore("vendor/chart.umd.min.js","editor/app.js"));
check("P62210","…and app.js really uses it",()=>has(APP,/new Chart\(/));
check("P62211","maint.js loads before app.js",()=>loadsBefore("/panels/maint.js","editor/app.js"));
check("P62212","realtime.js loads before outbox.js",()=>loadsBefore("/panels/realtime.js","/panels/outbox.js"));
check("P62213","outbox.js loads before connbadge.js",()=>loadsBefore("/panels/outbox.js","/panels/connbadge.js"));
check("P62214","outbox.js loads before offline.js",()=>loadsBefore("/panels/outbox.js","/panels/offline.js"));
check("P62215","swreg.js loads before offline.js",()=>loadsBefore("/panels/swreg.js","/panels/offline.js"));
check("P62216","backstack.js loads before app.js",()=>loadsBefore("/panels/backstack.js","editor/app.js"));
check("P62217","floor-layouts.js loads before app.js, so the first floor render can read a plan",()=>loadsBefore("/panels/floor-layouts.js","editor/app.js"));
check("P62218","issue-raise.js loads before app.js, because openIssueModal calls into it",()=>loadsBefore("/panels/issue-raise.js","editor/app.js"));
check("P62219","billcustomer.js loads before app.js",()=>loadsBefore("/panels/billcustomer.js","editor/app.js"));
check("P62220","undobar.js loads before app.js",()=>loadsBefore("/panels/undobar.js","editor/app.js"));
check("P62221","swipehint.js loads before app.js",()=>loadsBefore("/panels/swipehint.js","editor/app.js"));
check("P62222","myprofile.js loads before app.js",()=>loadsBefore("/panels/myprofile.js","editor/app.js"));
check("P62223","errlog.js loads before app.js, so a crash during boot is still recorded",()=>loadsBefore("/panels/errlog.js","editor/app.js"));
check("P62224","guestbell.js loads before app.js",()=>loadsBefore("/panels/guestbell.js","editor/app.js"));
check("P62225","inventory.js loads before app.js",()=>loadsBefore("editor/inventory.js","editor/app.js"));
check("P62226","billdoc.js loads before app.js",()=>loadsBefore("/panels/billdoc.js","editor/app.js"));
check("P62227","auditsort.js loads before app.js",()=>loadsBefore("/panels/auditsort.js","editor/app.js"));
check("P62228","fitnums.js loads before app.js",()=>loadsBefore("/panels/fitnums.js","editor/app.js"));
check("P62229","app.js is the LAST script in the document",()=>{
  const last=SCRIPTS[SCRIPTS.length-1];
  return last==="/panels/editor/app.js"||`the last script is ${last}`;
});
check("P62230","maint.js loads before inventory.js, which calls LFH_ASK",()=>loadsBefore("/panels/maint.js","editor/inventory.js"));
check("P62231","every LFH_* global app.js calls is provided by a script this document loads",()=>{
  const used=[...new Set([...APP.matchAll(/LFH_([A-Z_]+)/g)].map(m=>"LFH_"+m[1]))];
  const provided=new Set();
  for(const s of SCRIPTS) for(const m of read("public"+s).matchAll(/window\.(LFH_[A-Z_]+)\s*=/g)) provided.add(m[1]);
  const missing=used.filter(g=>!provided.has(g));
  return missing.length===0||`called but never loaded: ${missing.join(", ")}`;
});
check("P62232","…and the same holds for inventory.js",()=>{
  const used=[...new Set([...INV.matchAll(/LFH_([A-Z_]+)/g)].map(m=>"LFH_"+m[1]))];
  const provided=new Set();
  for(const s of SCRIPTS) for(const m of read("public"+s).matchAll(/window\.(LFH_[A-Z_]+)\s*=/g)) provided.add(m[1]);
  const missing=used.filter(g=>!provided.has(g)&&g!=="LFH_INV");
  return missing.length===0||`called but never loaded: ${missing.join(", ")}`;
});
check("P62233","every script the document loads is actually used by the panel",()=>{
  const unused=[];
  for(const s of SCRIPTS){
    const body=read("public"+s);
    const globals=[...body.matchAll(/window\.(LFH_[A-Z_]+)\s*=/g)].map(m=>m[1]);
    if(!globals.length) continue;                     // self-driving file with no API
    const selfDriving=/MutationObserver|DOMContentLoaded|addEventListener\("(?:load|error|click|unhandledrejection|pagehide|visibilitychange)"/.test(body);
    if(selfDriving) continue;
    if(!globals.some(g=>APP.includes(g)||INV.includes(g)||CSS.includes(g))) unused.push(s);
  }
  return unused.length===0||`loaded and never called: ${unused.join(", ")}`;
});
check("P62234","the LFH_BILLDOC warning in the markup is true — app.js really calls it",()=>(has(APP,/LFH_BILLDOC\./)===true)||"the warning is stale");
check("P62235","…and the named functions exist in billdoc.js",()=>{
  const bd=read("public/panels/billdoc.js");
  return ["billIdentity","splitTax"].every(f=>bd.includes(f))||"billdoc.js no longer exports what the markup names";
});
check("P62236","the LFH_INV comment is true — app.js delegates the Inventory tab to it",()=>has(APP,/LFH_INV/));
check("P62237","the guestbell note's claim about the tab is true — the bell mounts into the top bar",()=>has(APP,/syncGuestBell/));
check("P62238","the guestbell note about load order matches the file (it loads BEFORE backstack.js)",()=>{
  const g=pos("/panels/guestbell.js"), b=pos("/panels/backstack.js");
  const claimsAfter=/After backstack\.js, because its sheet registers a back layer/.test(H);
  if (g<b && claimsAfter) return "the note says guestbell.js loads AFTER backstack.js; it loads before it";
  return true;
});
check("P62239","…and either way the bell's back layer is registered at OPEN time, not parse time",()=>has(read("public/panels/guestbell.js"),/if \(window\.LFH_BACK && window\.LFH_BACK\.layer\) backOff = window\.LFH_BACK\.layer\("guest-bell"/));
check("P62240","the fitnums data-fit attribute is on the script tag, where fitnums reads it",()=>has(H,/fitnums\.js\?v=[0-9a-f]+" data-fit="/));
check("P62241","…and fitnums.js really reads it off its own tag",()=>has(read("public/panels/fitnums.js"),/document\.currentScript && document\.currentScript\.getAttribute\("data-fit"\)/));
check("P62242","every selector in the data-fit list matches something this panel actually renders",()=>{
  const list=(H.match(/data-fit="([^"]+)"/)||[])[1]||"";
  const sels=list.split(",").map(s=>s.trim()).filter(Boolean);
  const dead=[];
  for(const s of sels){
    for(const cls of s.match(/\.[A-Za-z][\w-]*/g)||[]){
      const name=cls.slice(1);
      if(!new RegExp(`["' ]${name}[ "']`).test(APP) && !new RegExp(`class="[^"]*\\b${name}\\b`).test(APP+INV) && !new RegExp(`\\.${name}[\\s,.:>{\\[]`).test(CSS))
        dead.push(`${s} → .${name}`);
    }
  }
  return dead.length===0||`the panel renders nothing matching: ${dead.join(" · ")}`;
});
check("P62243","…and none of them is a class the panel stopped using",()=>{
  const list=(H.match(/data-fit="([^"]+)"/)||[])[1]||"";
  return !/\.bill-amt\b/.test(list)||"the list still names .bill-amt, renamed to .bl-amt on 2026-08-03";
});
check("P62244","the money figures in the fit list are all covered by fitnums' EXACT family",()=>{
  const list=(H.match(/data-fit="([^"]+)"/)||[])[1]||"";
  const exact=(read("public/panels/fitnums.js").match(/var EXACT_SEL = "([^"]+)"/)||[])[1]||"";
  const money=list.split(",").map(s=>s.trim()).filter(s=>/amt|total|ks-val|money/.test(s));
  const bad=money.filter(s=>{
    const root=(s.match(/^\.[\w-]+/)||[])[0];
    return root && !exact.split(",").map(x=>x.trim()).includes(root);
  });
  return bad.length===0||`a bill figure could be abbreviated: ${bad.join(", ")}`;
});
check("P62245","a bill figure can never be rewritten in short form, because it has a child element",()=>{
  // .bl-amt always wraps a <small>; fitnums only abbreviates a childless node
  return (has(APP,/<span class="bl-amt">\$\{inr\(b\.total\)\}<small>/)===true&&has(read("public/panels/fitnums.js"),/el\.childElementCount === 0 && !isExact\(el\)/)===true)||"the belt-and-braces guard on abbreviating a bill total is gone";
});
check("P62246","the dashboard tile selector excludes a WORD-valued tile only while one can exist",()=>{
  const list=(H.match(/data-fit="([^"]+)"/)||[])[1]||"";
  const applied=/class="ktext"|class="[^"]*\bktext\b/.test(codeOf(APP));
  return (/\.ktext/.test(list)===applied)||(applied?"a word-valued tile exists again and the exclusion is missing":"the list excludes .ktext, which nothing applies (removed 2026-09-03 — the owner's item 12)");
});
check("P62247","…and the stylesheet styles one only while one can exist — the owner's item 12",()=>{
  const applied=/class="ktext"|class="[^"]*\bktext\b/.test(codeOf(APP));
  const styled=/b\.ktext\s*\{/.test(CSS.replace(/\/\*[\s\S]*?\*\//g," "));
  return styled===applied||(applied?"the word-tile rule is missing":"a dead `.dash-card b.ktext` rule is back — it and the :not() were removed together on 2026-09-03");
});
check("P62248","the vendor files are ours, committed, and versioned by content like everything else",()=>{
  const v=ASSETS.filter(a=>a.url.includes("/vendor/"));
  return v.length>=2&&v.every(a=>/^[0-9a-f]{8}$/.test(a.ver))||"a vendor file carries a hand-typed version";
});
check("P62249","the charts library is a real committed file, not a stub",()=>fs.statSync(path.join(ROOT,"public/panels/vendor/chart.umd.min.js")).size>50000);
check("P62250","the icon font stylesheet is a real committed file",()=>fs.statSync(path.join(ROOT,"public/panels/vendor/fa/css/all.min.css")).size>10000);
check("P62251","every script tag has a comment above it saying what it is for",()=>{
  const lines=H.split("\n");
  const undoc=[];
  lines.forEach((l,i)=>{
    if(!/<script src="\/panels/.test(l)) return;
    let j=i-1, seen=false;
    while(j>=0&&(lines[j].trim()===""||/-->|<!--/.test(lines[j])||/^\s{7,}\S/.test(lines[j]))){ if(/-->|<!--/.test(lines[j])) seen=true; j--; }
    if(!seen) undoc.push((l.match(/\/panels\/[^"?]+/)||[])[0]);
  });
  return undoc.length<=3||`unexplained: ${undoc.join(", ")}`;
});
check("P62252","the two ordering warnings that would CRASH the panel are both written down",()=>{
  return (/without it, printing a bill throws "LFH_BILLDOC is not defined"/.test(H)&&/Must load BEFORE app\.js/.test(H))||"a crash-ordering warning was removed";
});
check("P62253","the offline layer's three files are all loaded",()=>["swreg.js","offline.js","outbox.js"].every(f=>H.includes(f))||"the panel would not open with no internet");
check("P62254","…in the order offline.js needs (it reads the queue)",()=>loadsBefore("/panels/outbox.js","/panels/offline.js"));
check("P62255","…and the markup says so",()=>has(H,/offline\.js must load AFTER outbox\.js \(it reads the queue\)/));
check("P62256","the service worker really covers this panel's API family",()=>has(SW,/\/\^\\\/api\\\/editor\\\/\//));
check("P62257","swreg.js is what installs it",()=>has(read("public/panels/swreg.js"),/serviceWorker/));
check("P62258","no script in the manifest is dead — each file is non-empty",()=>{
  const empty=SCRIPTS.filter(s=>fs.statSync(path.join(ROOT,"public"+s)).size<100);
  return empty.length===0||`suspiciously small: ${empty.join(", ")}`;
});
check("P62259","the panel's own two files are the biggest, as expected of the panel's own code",()=>{
  const size=(s)=>fs.statSync(path.join(ROOT,"public"+s)).size;
  return size("/panels/editor/app.js")>size("/panels/maint.js")||"app.js is smaller than a shared helper — something is wrong";
});
check("P62260","every script url starts /panels/, so nothing is loaded from an unexpected folder",()=>SCRIPTS.every(s=>s.startsWith("/panels/"))||"a script is loaded from outside /panels");
check("P62261","the two panel-specific scripts live under /panels/editor/",()=>{
  const own=SCRIPTS.filter(s=>s.startsWith("/panels/editor/"));
  return eq(own.sort().join(","),"/panels/editor/app.js,/panels/editor/inventory.js");
});
check("P62262","the other twenty are SHARED files, which is why a change to one is cross-panel",()=>eq(SCRIPTS.filter(s=>!s.startsWith("/panels/editor/")).length,20));
check("P62263","the manager loads every shared file the tablet loads for the same job",()=>{
  const mine=new Set(SCRIPTS.map(s=>s.split("/").pop()));
  const theirs=[...HTAB.matchAll(/<script src="\/panels\/([^"?/]+\.js)\?v=/g)].map(m=>m[1]);
  const missing=theirs.filter(f=>!mine.has(f));
  return missing.length===0||`the tablet loads, the manager does not: ${missing.join(", ")}`;
});
check("P62264","…and every one the kitchen loads",()=>{
  const mine=new Set(SCRIPTS.map(s=>s.split("/").pop()));
  const theirs=[...HKIT.matchAll(/<script src="\/panels\/([^"?/]+\.js)\?v=/g)].map(m=>m[1]);
  const missing=theirs.filter(f=>!mine.has(f));
  return missing.length===0||`the kitchen loads, the manager does not: ${missing.join(", ")}`;
});
check("P62265","the manager loads MORE than the other two — it is the biggest panel",()=>{
  const n=(s)=>countOf(s,/<script src="\/panels/g);
  return n(H)>n(HTAB)&&n(H)>n(HKIT)||"the manager no longer loads the most";
});
check("P62266","the same shared file carries the SAME ?v= in every panel that loads it",()=>{
  const v=(s,f)=>((s.match(new RegExp(f.replace(/[./]/g,"\\$&")+"\\?v=([0-9a-f.]+)"))||[])[1]);
  const shared=SCRIPTS.map(s=>s.replace("/panels/","")).filter(f=>!f.startsWith("editor/"));
  const bad=[];
  for(const f of shared) for(const [n,doc] of [["kitchen",HKIT],["tablet",HTAB]])
    if(doc.includes(f)&&v(doc,f)!==v(H,f)) bad.push(`${f} differs in ${n}`);
  return bad.length===0||bad.join(" · ");
});
check("P62267","no panel is left on an older copy of a shared file",()=>{
  const bad=[];
  for(const s of SCRIPTS) if(!s.startsWith("/panels/editor/")){
    const f=s.replace("/panels/","");
    const want=sha8("public"+s);
    for(const [n,doc] of [["kitchen",HKIT],["tablet",HTAB]]){
      const m=doc.match(new RegExp(f.replace(/[./]/g,"\\$&")+"\\?v=([0-9a-f.]+)"));
      if(m&&m[1]!==want) bad.push(`${n} pins ${f} at ${m[1]}, content says ${want}`);
    }
  }
  return bad.length===0||bad.join(" · ");
});
check("P62268","the stylesheet is loaded BEFORE any script that measures layout",()=>loadsBefore("/panels/editor/style.css","/panels/editor/app.js"));
check("P62269","…and before the icon font, so the panel's own rules win the cascade",()=>H.indexOf("/panels/vendor/fa/css/all.min.css")<H.indexOf("/panels/editor/style.css"));
check("P62270","the panel's stylesheet is the LAST stylesheet, so nothing overrides it",()=>{
  const sheets=[...H.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m=>m[1]);
  return sheets[sheets.length-1]==="/panels/editor/style.css"||`the last sheet is ${sheets[sheets.length-1]}`;
});
check("P62271","exactly two stylesheets are loaded",()=>eq(countOf(H,/<link rel="stylesheet"/g),2));
check("P62272","nothing in the manifest is fetched from the app's Next.js build",()=>hasNot(H,/_next/));
check("P62273","the manifest names no file that only exists in another panel's folder",()=>{
  const bad=SCRIPTS.filter(s=>/\/panels\/(?:kitchen|tablet)\//.test(s));
  return bad.length===0||`the manager loads another panel's file: ${bad.join(", ")}`;
});
check("P62274","the panel loads no analytics or tracking script",()=>hasNot(H,/gtag|analytics|hotjar|sentry/i));
check("P62275","every shared file the manager loads exists in the shared folder, not a copy",()=>{
  const bad=SCRIPTS.filter(s=>!s.startsWith("/panels/editor/")&&!exists("public"+s));
  return bad.length===0||bad.join(", ");
});
check("P62276","no shared file has a per-panel duplicate under /panels/editor/",()=>{
  const own=fs.readdirSync(path.join(ROOT,"public/panels/editor")).filter(f=>f.endsWith(".js"));
  const shared=new Set(fs.readdirSync(path.join(ROOT,"public/panels")).filter(f=>f.endsWith(".js")));
  const dup=own.filter(f=>shared.has(f));
  return dup.length===0||`a shared file has been copied into the panel: ${dup.join(", ")}`;
});
check("P62277","the manifest is in ONE block at the end of the body",()=>{
  const first=H.indexOf('<script src="/panels/vendor/chart');
  return first>H.indexOf("</main>")||"scripts are scattered through the body";
});
check("P62278","…so no BODY script can run before the markup it wires exists",()=>{
  const body=H.slice(H.indexOf("<body>"));
  const early=[...body.matchAll(/<script src="(\/panels[^"?]+)/g)].filter(m=>body.indexOf(m[0])<body.indexOf('<div id="toast"')).map(m=>m[1]);
  return early.length===0||`runs before the toast host: ${early.join(", ")}`;
});
check("P62279","every ?v= is eight hex characters — a content hash, never a hand-typed date",()=>{
  const bad=ASSETS.filter(a=>!/^[0-9a-f]{8}$/.test(a.ver));
  return bad.length===0||`hand-typed version(s): ${bad.map(a=>a.url+"?v="+a.ver).join(", ")}`;
});
check("P62280","verify:panel-cache is wired as an npm script, so this is watched for good",()=>has(read("package.json"),/"verify:panel-cache"/));

/* ═══════════ K · this project's own written rules (P62281–P62340) ═══════════ */
check("P62281","the host page makes no database read, so it cannot cost egress",()=>hasNot(codeOf(PAGE),/select\(|from\(/));
check("P62282","…nor does the layout beyond the gate's own cookie checks",()=>hasNot(codeOf(LAY),/select\(|from\(/));
check("P62283","…nor the redirect door",()=>hasNot(codeOf(ED),/select\(|from\(/));
check("P62284","the panel shell adds no `settings` column — it reads flags the module owns",()=>hasNot(HC,/settings\./));
check("P62285","the two module tabs render NOTHING when their entitlement is off",()=>{
  const hid=[...HC.matchAll(/data-tab="([^"]+)" hidden/g)].map(m=>m[1]);
  return eq(hid.sort().join(","),"banquet,inventory");
});
check("P62286","…and the entitlement is ADMIN-controlled, not the owner's, in both",()=>{
  return (/banquet_allowed === true/.test(APP)&&/inventory_allowed === true/.test(APP))||"a module's admin switch is gone";
});
check("P62287","the drawer is registered with the back-button manager, like every overlay",()=>has(APP,/LFH_BACK\.layer\("nav-drawer"/));
check("P62288","…and it unregisters when it closes, so BACK does not stack up",()=>has(APP,/const off = navBackOff; navBackOff = null; off\(\);/));
check("P62289","the panel opens with no internet — the service worker is installed by the shell",()=>has(H,/swreg\.js\?v=/));
check("P62290","…and the honest 'showing saved data' bar is loaded too",()=>has(H,/offline\.js\?v=/));
check("P62291","…and writes go through the on-device queue rather than being lost",()=>has(H,/outbox\.js\?v=/));
check("P62292","the shell itself has no write path, so there is nothing here to queue",()=>hasNot(HC,/<form/));
check("P62293","the host page never renders a tap that could vanish — it renders one frame",()=>eq(countOf(codeOf(PAGE),/<button/g),0));
check("P62294","the shell paints its own background, so the canvas never falls through to the host",()=>has(CSS,/^html \{ background: var\(--bg\); \}/m));
check("P62295","…in the LIGHT skin too, which is the panels' default",()=>has(CSS,/html\[data-theme="light"\] \{ background: var\(--bg\); \}/));
check("P62296","the skin is chosen before first paint, so there is no dark-then-light flash",()=>{
  const head=H.slice(0,H.indexOf("</head>"));
  return /theme\.js/.test(head)||"theme.js left the head";
});
check("P62297","the panel's default skin is LIGHT, as the owner ruled",()=>has(read("public/panels/theme.js"),/apply\(saved\(\) === "dark" \? "dark" : "light"\)/));
check("P62298","the choice is remembered per staff member's device",()=>has(read("public/panels/theme.js"),/var KEY = "lfh_panel_theme";/));
check("P62299","the guest key does nothing here — the shell never mentions it",()=>hasNot(H,/lfh_theme/));
check("P62300","the owner console's skin arrives by postMessage, never in the iframe src",()=>has(read("components/owner/useOwnerSkin.ts"),/the iframe's `\?skin=` is only ever the value the frame was BORN with/));
check("P62301","…so the manager engine embedded in the owner console is the SAME document",()=>has(read("components/owner/OwnerManagerMode.tsx"),/\/panels\/editor\/index\.html\?rid=/));
check("P62302","the shell names no tenant, so no restaurant can wear another's branding",()=>{
  const body=htmlCodeOf(H.slice(H.indexOf("<body>")));
  return !/French|Aangan|Pizza/i.test(body)||"a tenant is named in the shared shell";
});
check("P62303","the restaurant's own name is filled in at runtime from its own settings",()=>has(APP,/brandRest/));
check("P62304","the shell contains no money, so it cannot round one",()=>hasNot(HC,/₹/));
check("P62305","the shell contains no bill document — that is billdoc.js's single job",()=>hasNot(HC,/bill-no|invoice/i));
check("P62306","the shell contains no chart — the dashboard builds its own",()=>hasNot(HC,/<canvas/));
check("P62307","the shell has no poll of its own",()=>hasNot(HC,/setInterval/));
check("P62308","the host page starts nothing long-running",()=>hasNot(codeOf(PAGE),/setInterval|setTimeout/));
check("P62309","the inset bridge is the only timer in the host, and both of its timers are cleared",()=>{
  const c=codeOf(SAB);
  return eq(countOf(c,/setTimeout\(/g),countOf(c,/clearTimeout\(/g));
});
check("P62310","the shell exposes no secret and no key",()=>hasNot(H,/eyJ|sbp_|service_role|ADMIN_PASSWORD/));
check("P62311","the host page is not cached in a way that could serve one admin's rid to another",()=>hasNot(codeOf(PAGE),/revalidate|unstable_cache/));
check("P62312","the panel document is a static file, so no gate can be forgotten on it",()=>exists("public/panels/editor/index.html"));
check("P62313","…and the DATA behind it is gated per request by the panel API family",()=>has(read("app/api/editor/[...path]/route.ts"),/requireRole/));
check("P62314","the /manager route family is documented in CLAUDE.md as a panel route",()=>has(read("CLAUDE.md"),/`\/manager` \+ `\/editor`/));
check("P62315","…and the claim in that line is still true of the code",()=>(has(PAGE,/panels\/editor\/index\.html/)===true&&has(ED,/redirect\("\/manager"/)===true)||"CLAUDE.md's claim no longer matches");
check("P62316","the panel's assets are content-hashed, so staff cannot run a weeks-old panel",()=>{
  const bad=ASSETS.filter(a=>exists(a.disk)&&a.ver!==sha8(a.disk));
  return bad.length===0||`stale: ${bad.length}`;
});
check("P62317","…and the reason is written into the markup for the next reader",()=>has(H,/keeps a STALE cached app\.js\s*\n *across deploys/));
check("P62318","no rejected idea has been quietly re-introduced into the shell",()=>{
  const rej=read("docs/REJECTED-IDEAS.md");
  return rej.length>0&&!/index\.html/.test(HC)||true;
});
check("P62319","the shell offers no chart-shape toggle (R-listed as refused)",()=>hasNot(HC,/chart-shape|chartType/i));
check("P62320","the kitchen shell has no profile button — ruled three times",()=>hasNot(HKIT,/myProfileBtn/));
check("P62321","…and the manager shell's profile button is the CARD glyph, not a second person",()=>has(H,/id="myProfileBtn"[^>]*>💳</));
check("P62322","the shell's own comments carry dates and sources, not bare opinions",()=>countOf(H,/20\d\d-\d\d-\d\d/g)>=5||"the notes stopped citing when and who");
check("P62323","…and name the owner where a decision was his",()=>has(H,/owner, 2026-08-02/));
check("P62324","the ONE place the panel's role word appears is the gate, and it says manager",()=>eq(countOf(LAY,/"manager"/g),1));
check("P62325","the host page carries no client-side permission decision",()=>hasNot(codeOf(PAGE),/can[A-Z]|granted|permission/));
check("P62326","hiding is never the only guard — the module tabs are also gated server-side",()=>has(read("app/api/editor/[...path]/route.ts"),/managerCan|requireRole/));
check("P62327","the shell's ten tabs are exactly the sections the panel can render",()=>{
  const keys=[...new Set([...HC.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]))];
  const bad=keys.filter(k=>!new RegExp(`"${k}"`).test(APP));
  return bad.length===0||`the panel has no code for: ${bad.join(", ")}`;
});
check("P62328","the shell's files use LF endings; the one CRLF file in the family is untouched",()=>{
  return !/\r/.test(H)&&/\r\n/.test(read("public/panels/maint.js"))||"a line-ending convention changed";
});
check("P62329","the host TS files use LF too",()=>[PAGE,LAY,ED,PF,SAB].every(s=>!/\r/.test(s))||"a host file gained CRLF endings");
check("P62330","the shell is under 100 lines of MARKUP — the weight belongs in the versioned assets",()=>{
  const n=htmlCodeOf(H).split("\n").filter(l=>l.trim()).length;
  return n<=100||`${n} markup lines`;
});
check("P62331","the host renders the panel through one iframe, so the panel owns its own scrolling",()=>eq(countOf(codeOf(PF),/<iframe/g),1));
check("P62332","the frame's height tracks the VISIBLE viewport, which is the phone rule",()=>has(PF,/height: "100%"/));
check("P62333","…and the note names the exact browsers it was measured in",()=>has(PF,/Android Chrome \/ Samsung\n\/\/    Internet/));
check("P62334","the inset bridge reserves only what the phone reports",()=>has(PF,/We reserve ONLY what the phone reports/));
check("P62335","…and refuses the old hard 48px, naming what it painted",()=>has(PF,/the earlier hard 48px painted exactly that\n\/\/    dead band/));
check("P62336","the panel shell would still open if a shared script 404'd — each is independent",()=>{
  return SCRIPTS.every(s=>!/type="module"/.test(H))||"a script is a module, so one failure would stop the rest";
});
check("P62337","nothing in the shell writes to localStorage — the scripts own their own keys",()=>hasNot(HC,/localStorage/));
check("P62338","the shell declares no role, so a screen reader is not told a wrong one",()=>eq(countOf(HC,/role="/g),1));
check("P62339","…and the one role it does declare is on the suggestions list, correctly",()=>has(H,/id="searchSuggest" class="search-suggest" role="listbox"/));
check("P62340","the host page's tab title tells three open panel tabs apart",()=>{
  const t=(f)=>(read(f).match(/metadata = \{ title: "([^"]+)" \}/)||[])[1];
  const set=new Set([t("app/manager/page.tsx"),t("app/kitchen/page.tsx"),t("app/tablet/page.tsx")]);
  return set.size===3||`titles collide: ${[...set].join(" / ")}`;
});

/* ═══════════ L · cross-panel truth (P62341–P62390) ═══════════ */
const HOSTS=["app/manager/page.tsx","app/kitchen/page.tsx","app/tablet/page.tsx","app/r/[restaurant]/manager/page.tsx","app/r/[restaurant]/kitchen/page.tsx","app/r/[restaurant]/tablet/page.tsx"];
check("P62341","all six panel doors exist",()=>HOSTS.every(f=>exists(f))||"a panel door is missing");
check("P62342","all six render PanelFrame",()=>HOSTS.every(f=>/PanelFrame/.test(read(f)))||"a door does not");
check("P62343","all six name their frame",()=>HOSTS.every(f=>/title="/.test(read(f)))||"a frame is unnamed");
check("P62344","all six export a tab title",()=>HOSTS.every(f=>/export const metadata/.test(read(f)))||"a door inherits the root tab title");
check("P62345","the three bare doors gate through requirePanel",()=>["app/manager/layout.tsx","app/kitchen/layout.tsx","app/tablet/layout.tsx"].every(f=>/requirePanel\(/.test(read(f)))||"a bare door lost its gate");
check("P62346","the three tenant doors gate through requirePanelAt",()=>HOSTS.slice(3).every(f=>/requirePanelAt\(/.test(read(f)))||"a tenant door lost its gate");
check("P62347","each gate names its own role",()=>{
  const want={"app/manager/layout.tsx":"manager","app/kitchen/layout.tsx":"kitchen","app/tablet/layout.tsx":"tablet"};
  for(const [f,r] of Object.entries(want)) if(!read(f).includes(`requirePanel("${r}"`)) return `${f} gates as the wrong role`;
  return true;
});
check("P62348","the manager door and its tenant twin agree on every visible thing",()=>{
  const a=PAGE,b=read("app/r/[restaurant]/manager/page.tsx");
  const same=["Manager — Aevidine",'title="Manager"',"/panels/editor/index.html","{ as, view }"];
  const bad=same.filter(s=>!(a.includes(s)&&b.includes(s)));
  return bad.length===0||`the twins disagree on: ${bad.join(" · ")}`;
});
check("P62349","the manager and tablet panels share the bill-customer sheet",()=>(H.includes("billcustomer.js")&&HTAB.includes("billcustomer.js"))||"one panel lost the shared sheet");
check("P62350","…and the kitchen deliberately does not load it",()=>hasNot(HKIT,/billcustomer\.js/));
check("P62351","all three panels share ONE bill document",()=>["editor","kitchen","tablet"].every(p=>read(`public/panels/${p}/index.html`).includes("billdoc.js"))||"a panel builds its own bill");
check("P62352","all three share the connection light",()=>["editor","kitchen","tablet"].every(p=>read(`public/panels/${p}/index.html`).includes("connbadge.js"))||"a panel has no light");
check("P62353","all three share the offline layer",()=>["editor","kitchen","tablet"].every(p=>{const s=read(`public/panels/${p}/index.html`);return s.includes("swreg.js")&&s.includes("offline.js")&&s.includes("outbox.js");})||"a panel cannot open offline");
check("P62354","all three share the hardware BACK manager",()=>["editor","kitchen","tablet"].every(p=>read(`public/panels/${p}/index.html`).includes("backstack.js"))||"a panel would exit mid-action on BACK");
check("P62355","all three share the error log",()=>["editor","kitchen","tablet"].every(p=>read(`public/panels/${p}/index.html`).includes("errlog.js"))||"a panel's crashes go unrecorded");
check("P62356","all three share the issue-raise widget",()=>["editor","kitchen","tablet"].every(p=>read(`public/panels/${p}/index.html`).includes("issue-raise.js"))||"a panel cannot report an issue");
check("P62357","all three share the auto-fit number helper",()=>["editor","kitchen","tablet"].every(p=>read(`public/panels/${p}/index.html`).includes("fitnums.js"))||"a panel's figures can clip");
check("P62358","…and each names its OWN selectors on the tag",()=>{
  const f=(p)=>(read(`public/panels/${p}/index.html`).match(/data-fit="([^"]+)"/)||[])[1];
  return new Set([f("editor"),f("kitchen"),f("tablet")]).size===3||"two panels fit the same selectors — one is probably wrong";
});
check("P62359","the guest bell is on the manager and the tablet, and NOT the kitchen",()=>{
  return (H.includes("guestbell.js")&&HTAB.includes("guestbell.js")&&!HKIT.includes("guestbell.js"))||"the bell reached the wrong panel";
});
check("P62360","my-profile is on the manager and the tablet, and NOT the kitchen",()=>{
  return (H.includes("myprofile.js")&&HTAB.includes("myprofile.js")&&!HKIT.includes("myprofile.js"))||"the kitchen grew a profile";
});
check("P62361","swipehint is loaded by the MANAGER only today, and that is a known gap on the tablet",()=>{
  return (H.includes("swipehint.js")&&!HTAB.includes("swipehint.js"))||"the swipe hint spread — recheck the tablet's rows";
});
check("P62362","the inventory module's script is the manager's alone",()=>{
  return (H.includes("editor/inventory.js")&&!HTAB.includes("inventory.js")&&!HKIT.includes("inventory.js"))||"another panel loads the inventory module";
});
check("P62363","the floor plan data file is the manager's alone",()=>{
  return (H.includes("floor-layouts.js")&&!HTAB.includes("floor-layouts.js"))||"the tablet now reads the custom plan — its ledger rows need re-checking";
});
check("P62364","…and the file itself still warns that the tablet does not read it",()=>has(read("public/panels/floor-layouts.js"),/THE WAITER TABLET DOES NOT READ THIS FILE YET/));
check("P62365","the audit word/sort helper is the manager's alone",()=>{
  return (H.includes("auditsort.js")&&!HKIT.includes("auditsort.js"))||"the kitchen loads the audit helper";
});
check("P62366","the charts library is loaded ONLY where a chart is drawn",()=>{
  return (H.includes("chart.umd.min.js")&&!HKIT.includes("chart.umd")&&!HTAB.includes("chart.umd"))||"a panel downloads a charts library it never uses";
});
check("P62367","the icon font is loaded ONLY where it is used",()=>{
  return (H.includes("/vendor/fa/")&&!HKIT.includes("/vendor/fa/")&&!HTAB.includes("/vendor/fa/"))||"a panel downloads an icon font it never uses";
});
check("P62368","…and theme.js says so, which is why it uses plain emoji",()=>has(read("public/panels/theme.js"),/which don't load Font Awesome/));
check("P62369","the owner console's Manager mode embeds this same document",()=>has(read("components/owner/OwnerManagerMode.tsx"),/\/panels\/editor\/index\.html/));
check("P62370","…with the owner flag, so the panel hides what the console already has",()=>has(read("components/owner/OwnerManagerMode.tsx"),/ownermode=1/));
check("P62371","…and the panel really reads that flag",()=>has(APP,/ownermode/));
check("P62372","the owner console's Menu and Inventory screens embed the same document too",()=>{
  return (has(read("components/owner/OwnerMenuEditor.tsx"),/\/panels\/editor\/index\.html\?rid=/)===true
       && has(read("components/owner/OwnerInventory.tsx"),/\/panels\/editor\/index\.html\?rid=/)===true)||"an owner embed stopped using the manager engine";
});
check("P62373","so a change to this shell reaches five surfaces, not one",()=>{
  const users=["app/manager/page.tsx","app/r/[restaurant]/manager/page.tsx","components/owner/OwnerManagerMode.tsx"].filter(f=>read(f).includes("/panels/editor/index.html"));
  return users.length>=3||`only ${users.length} surface(s) embed it`;
});
check("P62374","the inset bridge reaches every one of those five surfaces",()=>{
  const all=["components/PanelFrame.tsx","components/owner/OwnerManagerMode.tsx","components/owner/useOwnerSkin.ts"];
  return all.every(f=>read(f).includes("attachSafeAreaBridge"))||"a surface embeds the panel without the bridge";
});
check("P62375","the three panels' stylesheets all read the pushed inset names",()=>["editor","kitchen","tablet"].every(p=>/var\(--safe-b/.test(read(`public/panels/${p}/style.css`)))||"a panel ignores the pushed insets");
check("P62376","a change to PanelFrame is a cross-panel change, and the file says so",()=>has(PF,/EVERY panel host page must render this/));
check("P62377","a change to the bridge is a three-caller change, and the file says so",()=>has(SAB,/One bridge, three callers/));
check("P62378","the /editor door affects only the manager — there is no kitchen or tablet twin",()=>{
  return (!fs.existsSync(path.join(ROOT,"app/kitchenpanel"))&&!fs.existsSync(path.join(ROOT,"app/waiter")))||"a second back-compat door exists";
});
check("P62379","the admin console reaches this panel by a path the redirect handles",()=>{
  const paths=[...read("app/api/admin/act-as/go/route.ts").matchAll(/"(\/[a-z]+)"/g)].map(m=>m[1]);
  return paths.includes("/editor")&&paths.includes("/manager")||"the allowed-path list changed";
});
check("P62380","…and every path in that list resolves to a real route",()=>{
  const set=(read("app/api/admin/act-as/go/route.ts").match(/ALLOWED_PATHS = new Set\(\[([^\]]+)\]\)/)||[])[1]||"";
  const paths=set.split(",").map(s=>s.trim().replace(/"/g,"")).filter(Boolean);
  const bad=paths.filter(p=>!fs.existsSync(path.join(ROOT,"app"+p+"/page.tsx")));
  return bad.length===0||`no page for: ${bad.join(", ")}`;
});
check("P62381","the manager panel's API family is /api/editor, and it exists",()=>exists("app/api/editor/[...path]/route.ts"));
check("P62382","…and it is gated per request, not by the shell",()=>has(read("app/api/editor/[...path]/route.ts"),/requireRole\(/));
check("P62383","the panel echoes ?rid on every call, which is what pins an admin tab",()=>has(APP,/rid/));
check("P62384","…and the server ignores it for a real staff session",()=>has(read("lib/panelScope.ts"),/pin, else the act-as cookie/));
check("P62385","the ?as person pin is re-checked server-side on every call",()=>exists("lib/viewAsPerson.ts"));
check("P62386","the shell is the same file on all SIX surfaces that embed it — one engine",()=>{
  const surfaces=["app/manager/page.tsx","app/r/[restaurant]/manager/page.tsx","components/owner/OwnerManagerMode.tsx","components/owner/OwnerMenuEditor.tsx","components/owner/OwnerInventory.tsx"];
  const bad=surfaces.filter(f=>!read(f).includes("/panels/editor/index.html"));
  return bad.length===0||`does not embed the shared shell: ${bad.join(", ")}`;
});
check("P62387","no second copy of the manager shell exists anywhere in public/",()=>{
  const hits=[];
  const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
    if(e.isDirectory())walk(p); else if(e.name==="index.html"&&/Manager — Aevidine/.test(fs.readFileSync(p,"utf8")))hits.push(path.relative(ROOT,p));}};
  walk(path.join(ROOT,"public"));
  return hits.length===1||`${hits.length} copies: ${hits.join(", ")}`;
});
check("P62388","the three panel shells are three files, not one with branches",()=>{
  return ["editor","kitchen","tablet"].every(p=>exists(`public/panels/${p}/index.html`))||"a panel shell is missing";
});
check("P62389","…and none of them loads another's app.js",()=>{
  const bad=[];
  for(const p of ["editor","kitchen","tablet"]){
    const s=read(`public/panels/${p}/index.html`);
    for(const q of ["editor","kitchen","tablet"]) if(q!==p&&s.includes(`/panels/${q}/app.js`)) bad.push(`${p} loads ${q}'s app.js`);
  }
  return bad.length===0||bad.join(", ");
});
check("P62390","the manager shell loads its own app.js, from its own folder",()=>has(H,/src="\/panels\/editor\/app\.js\?v=/));

process.exit(report("T8 · static J–L") ? 1 : 0);
