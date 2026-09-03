// Sweep #8 · terminal 8 · sections E–F of P61701–P62700.
// E = lib/safeAreaBridge.ts · F = public/panels/editor/index.html <head>
import { read, exists, check, skip, report, has, hasNot, countOf, eq, before, codeOf, htmlCodeOf, ROOT } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const SAB  = read("lib/safeAreaBridge.ts");
const SC   = codeOf(SAB);
const H    = read("public/panels/editor/index.html");
const HC   = htmlCodeOf(H);
const CSS  = read("public/panels/editor/style.css");
const APP  = read("public/panels/editor/app.js");
const PF   = read("components/PanelFrame.tsx");
const sha8 = (f) => createHash("sha1").update(fs.readFileSync(path.join(ROOT, f))).digest("hex").slice(0, 8);

/* ═══════════ E · lib/safeAreaBridge.ts (P61891–P61980) ═══════════ */
check("P61891","the bridge exists as its own shared file, not a copy inside a component",()=>exists("lib/safeAreaBridge.ts"));
check("P61892","it returns early when there is no document at all (an SSR import cannot throw)",()=>has(SC,/if \(typeof document === "undefined"\) return \(\) => \{\};/));
check("P61893","…and what it returns then is still a callable teardown",()=>has(SC,/return \(\) => \{\};/));
check("P61894","it measures with a hidden probe rather than guessing a number",()=>has(SC,/const probe = document\.createElement\("div"\);/));
check("P61895","the probe is position:fixed, so it sits against the real viewport edge",()=>has(SC,/position:fixed/));
check("P61896","the probe takes up no space",()=>(has(SC,/width:0/)===true&&has(SC,/height:0/)===true)||"the probe has a size");
check("P61897","…and cannot be seen",()=>has(SC,/visibility:hidden/));
check("P61898","…and cannot swallow a tap",()=>has(SC,/pointer-events:none/));
check("P61899","it reads all FOUR insets, not just the bottom",()=>["top","bottom","left","right"].every(s=>SC.includes(`env(safe-area-inset-${s})`))||"an inset is not measured");
check("P61900","the left/right pair is explained — landscape on a notched phone or tablet",()=>has(SAB,/They matter in LANDSCAPE on a notched phone or tablet/));
check("P61901","the probe is attached to the host document's body",()=>has(SC,/document\.body\.appendChild\(probe\)/));
check("P61902","the four values are read off computed style, not the inline text",()=>has(SC,/const cs = getComputedStyle\(probe\)/));
check("P61903","each parse falls back to 0 rather than NaN",()=>eq(countOf(SC,/\|\| 0;/g),4));
check("P61904","a NaN could never reach the panel as a CSS length",()=>hasNot(SC,/setProperty\("--safe-[tblr]", \(?parseFloat/));
check("P61905","it ALSO measures the visual-viewport gap, because env() under-reports",()=>has(SC,/window\.innerHeight - vv\.height/));
check("P61906","…and takes the offsetTop into account, so a pinned-zoom page is not misread",()=>has(SC,/\(vv\.offsetTop \|\| 0\)/));
check("P61907","the measured gap can never be negative",()=>has(SC,/Math\.max\(0, Math\.round\(/));
check("P61908","a missing visualViewport is survivable",()=>has(SAB,/catch \{ \/\* no visualViewport \*\/ \}/));
check("P61909","a gap bigger than 120px is treated as the KEYBOARD, not the nav bar",()=>has(SC,/if \(measured > 120\) measured = 0;/));
check("P61910","…so the keyboard opening can never pad the panel's bottom controls",()=>has(SAB,/a big gap is the on-screen keyboard, not the nav bar/));
check("P61911","the bottom value is the LARGER of the two signals",()=>has(SC,/const bottom = Math\.max\(envBottom, measured\);/));
check("P61912","only the bottom takes the measured signal — the other three come from env()",()=>{
  return (/--safe-t", envTop/.test(SC)&&/--safe-b", bottom/.test(SC)&&/--safe-l", envLeft/.test(SC)&&/--safe-r", envRight/.test(SC))||"a variable is fed the wrong value";
});
check("P61913","the frame is resolved at PUSH time, so a frame that appears later is found",()=>has(SC,/const doc = getFrame\(\)\?\.contentWindow\?\.document\?\.documentElement;/));
check("P61914","…with optional chaining at every hop, so a detached frame cannot throw",()=>eq(countOf(SC,/\?\./g)>=3,true));
check("P61915","nothing is written when the frame is not ready",()=>has(SC,/if \(doc\) \{/));
check("P61916","the four values are written as px, never as bare numbers",()=>eq(countOf(SC,/\+ "px"\)/g),4));
check("P61917","they are written on the panel's <html>, so every rule can read them",()=>has(SC,/doc\.style\.setProperty\("--safe-t"/));
check("P61918","a cross-document write that throws is swallowed, with a note saying why",()=>has(SAB,/iframe not ready yet — the load handler \/ delayed pushes will catch it/));
check("P61919","it pushes on the frame's load",()=>has(SC,/f\.addEventListener\("load", onLoad\);/));
check("P61920","it pushes on window resize",()=>has(SC,/window\.addEventListener\("resize", push\)/));
check("P61921","it pushes on orientation change",()=>has(SC,/window\.addEventListener\("orientationchange", push\)/));
check("P61922","it pushes on visualViewport resize — the URL bar sliding",()=>has(SC,/vv\?\.addEventListener\("resize", push\)/));
check("P61923","…and says why window resize is not enough",()=>has(SAB,/The URL bar showing\/hiding fires visualViewport resize \(NOT always window resize\)/));
check("P61924","there are two delayed pushes covering the load→<html>-ready gap",()=>(has(SC,/setTimeout\(push, 400\)/)===true&&has(SC,/setTimeout\(push, 1500\)/)===true)||"a delayed push is gone");
check("P61925","…and one immediate push, so a frame already loaded is not left waiting",()=>has(SC,/\n  push\(\);/));
check("P61926","the teardown removes the load listener",()=>has(SC,/bound\?\.removeEventListener\("load", onLoad\);/));
check("P61927","…the window resize listener",()=>has(SC,/window\.removeEventListener\("resize", push\)/));
check("P61928","…the orientation listener",()=>has(SC,/window\.removeEventListener\("orientationchange", push\)/));
check("P61929","…the visualViewport listener",()=>has(SC,/vv\?\.removeEventListener\("resize", push\)/));
check("P61930","…both timers",()=>has(SC,/clearTimeout\(t1\); clearTimeout\(t2\);/));
check("P61931","…and the probe itself, so the host DOM is left exactly as it was",()=>has(SC,/probe\.remove\(\);/));
check("P61932","every EVENT it listens for is also un-listened in the teardown",()=>{
  const ev=(re)=>new Set((SC.match(re)||[]).map(m=>m.replace(/.*\("/,"").replace(/".*/,"")));
  const add=[...ev(/addEventListener\("[a-z]+"/g)], rem=ev(/removeEventListener\("[a-z]+"/g);
  const missing=add.filter(e=>!rem.has(e));
  return missing.length===0||`never removed: ${missing.join(", ")}`;
});
check("P61933","every timer it starts is cleared",()=>{
  const st=countOf(SC,/setTimeout\(/g), cl=countOf(SC,/clearTimeout\(/g);
  return st===cl||`${st} started, ${cl} cleared`;
});
check("P61934","it starts no interval at all — nothing polls the phone",()=>hasNot(SC,/setInterval/));
check("P61935","it makes no network call",()=>hasNot(SC,/fetch\(|XMLHttpRequest/));
check("P61936","…and the header says so, so nobody adds one",()=>has(SAB,/no network,\s*\n\/\/ no re-render/));
check("P61937","it triggers no React re-render",()=>hasNot(SC,/useState|setState/));
check("P61938","the exported name is the one PanelFrame calls",()=>has(SC,/export function attachSafeAreaBridge\(/));
check("P61939","…and it is the file's only export",()=>eq(countOf(SC,/^export /gm),1));
check("P61940","the getter argument accepts null and undefined, so a ref is safe to pass",()=>has(SC,/HTMLIFrameElement \| null \| undefined/));
check("P61941","the return type is a teardown function",()=>has(SC,/\): \(\) => void \{/));
check("P61942","the header explains WHY the file exists at all",()=>has(SAB,/WHY THIS FILE EXISTS \(T12 phone sweep, 2026-08-13\)/));
check("P61943","…and names the three owner-console embeds that were missing it",()=>has(SAB,/Manager mode,\s*\n\/\/ Menu, Inventory → Manage/));
check("P61944","…and states the one-bridge-three-callers rule",()=>has(SAB,/One bridge, three callers, no third copy to drift/));
check("P61945","the usage example in the header matches the real signature",()=>has(SAB,/const stop = attachSafeAreaBridge\(\(\) => frameRef\.current\);/));
check("P61946","the doc-comment on the function says the pushes continue until teardown",()=>has(SAB,/keep pushing them into the iframe returned by\s*\n \* `getFrame`, until the returned cleanup runs/));
check("P61947","the panel stylesheet derives --sat from --safe-t",()=>has(CSS.replace(/\s+/g," "),/--sat: *max\( *env\(safe-area-inset-top[^)]*\) *, *var\(--safe-t/));
check("P61948","…and --sab from --safe-b",()=>has(CSS.replace(/\s+/g," "),/--sab: *max\( *env\(safe-area-inset-bottom[^)]*\) *, *var\(--safe-b/));
check("P61949","the manager stylesheet actually USES the bottom inset somewhere",()=>countOf(CSS,/var\(--sab/g)>=1||"--sab is derived and never used");
check("P61950","…and the top one",()=>countOf(CSS,/var\(--sat/g)>=1||"--sat is derived and never used");
check("P61951","the bridge's four names and the stylesheet's four reads agree",()=>["--safe-t","--safe-b","--safe-l","--safe-r"].every(n=>SC.includes(n))||"a name was renamed on one side only");
check("P61952","the left/right values reach the stylesheet too, or are honestly unused",()=>{
  const used = /var\(--safe-l/.test(CSS)||/var\(--sal/.test(CSS);
  return used || "measured but never read — recorded, not a fault: the manager panel has no landscape-notch rule yet";
});
check("P61953","the probe's inline CSS is one string, so no rule ordering can defeat it",()=>eq(countOf(SC,/probe\.style\.cssText =/g),1));
check("P61954","the probe carries no class, so a panel stylesheet cannot restyle it",()=>hasNot(SC,/probe\.className/));
check("P61955","the probe is anchored bottom-left, where the insets are readable",()=>(has(SC,/left:0/)===true&&has(SC,/bottom:0/)===true)||"the probe moved off the corner");
check("P61956","push() is defined before it is used as a listener",()=>before(SC,"const push = ","addEventListener(\"resize\", push)"));
check("P61957","onLoad simply calls push — no second code path",()=>has(SC,/const onLoad = \(\) => push\(\);/));
check("P61958","the add/remove pair share ONE visualViewport handle, read outside push()",()=>{const i=SC.indexOf('const vv = window.visualViewport;\n  vv?.addEventListener');return i>-1||"the outer handle is gone, so add and remove could target different objects";});
check("P61959","…so the remove cannot target a different object than the add",()=>has(SC,/vv\?\.removeEventListener\("resize", push\)/));
check("P61960","the element the load listener is bound to is remembered, so the remove targets it",()=>has(SC,/let bound: HTMLIFrameElement \| null = null;/));
check("P61961","a caller that attaches BEFORE its frame exists still gets its insets",()=>has(SC,/const bindLoad = \(\) => \{/));
check("P61962","…and the late binding cannot double-register the load listener",()=>has(SC,/if \(!f \|\| f === bound\) return;/));
check("P61963","…and the teardown removes it from whichever element it bound to",()=>has(SC,/bound\?\.removeEventListener\("load", onLoad\);/));
check("P61964","the file names the CSS shape a panel must use, verbatim",()=>has(SAB,/max\(env\(safe-area-inset-bottom, 0px\), var\(--safe-b, 0px\)\)/));
check("P61965","nothing in the file references a specific panel — it is generic",()=>hasNot(SC,/panels\/editor|panels\/kitchen|panels\/tablet/));
check("P61966","the values are pushed as inline style, so they beat any stylesheet default",()=>has(SC,/doc\.style\.setProperty/));
check("P61967","the panel's own stylesheet declares a 0px fallback for each name",()=>["--safe-t","--safe-b"].every(n=>new RegExp("var\\("+n+", *0px\\)").test(CSS))||"a fallback is missing, so an un-bridged panel would compute an invalid length");
check("P61968","the bridge never removes a value it set — a re-push always overwrites",()=>hasNot(SC,/removeProperty/));
check("P61969","the file has no dependency of its own",()=>eq(countOf(SC,/^import /gm),0));
check("P61970","it is plain TypeScript, usable from any client component",()=>hasNot(SAB,/^"use client"/m));
check("P61971","the three callers all pass a getter, never a raw element",()=>{
  const cs=["components/PanelFrame.tsx","components/owner/OwnerManagerMode.tsx","components/owner/useOwnerSkin.ts"];
  return cs.every(f=>/attachSafeAreaBridge\(\(\) =>/.test(read(f)))||"a caller passes something other than a getter";
});
check("P61972","every caller keeps the teardown and runs it",()=>{
  const owner=["components/owner/OwnerManagerMode.tsx","components/owner/useOwnerSkin.ts"];
  return owner.every(f=>/stopSafeArea\(\)/.test(read(f)))||"an owner embed never stops the bridge";
});
check("P61973","PanelFrame runs the teardown by returning it from its effect",()=>has(PF,/useEffect\(\(\) => attachSafeAreaBridge\(\(\) => ref\.current\), \[\]\)/));
check("P61974","the number 120 is the only magic constant, and it is explained",()=>has(SAB,/measured > 120/));
check("P61975","the two delays are explained rather than left as bare numbers",()=>has(SAB,/A couple of delayed pushes cover the gap between the iframe's `load` and its <html> being\s*\n\s*\/\/\s*ready/));
check("P61976","the bridge cannot be attached twice to the same frame by one caller",()=>eq(countOf(SC,/export function attachSafeAreaBridge/g),1));
check("P61977","a second attach would still be harmless — each keeps its own probe and teardown",()=>has(SC,/const probe = document\.createElement/));
check("P61978","the file is short enough to hold in your head",()=>SAB.split("\n").length<=140||"the bridge has grown past 140 lines");
check("P61979","its code half is smaller than its explanation half — deliberately",()=>{
  const code=codeOf(SAB).split("\n").filter(l=>l.trim()).length;
  return code<=60||`${code} code lines`;
});
check("P61980","nothing in the bridge can print to the console in normal use",()=>hasNot(SC,/console\./));

/* ═══════════ F · index.html — the document head (P61981–P62030) ═══════════ */
check("P61981","the panel document exists where the host page points",()=>exists("public/panels/editor/index.html"));
check("P61982","it declares the HTML5 doctype",()=>has(H,/^<!doctype html>/im));
check("P61983","the document declares its language",()=>has(H,/<html lang="en">/));
check("P61984","the charset is declared, and first in the head",()=>{
  const i=H.indexOf('<meta charset="utf-8" />'), j=H.indexOf("<head>");
  return (i>j&&i-j<40)||"charset is not the first thing in the head";
});
check("P61985","there is a viewport meta, so the phone does not render it at desktop width",()=>has(H,/<meta name="viewport" content="width=device-width, initial-scale=1" \/>/));
check("P61986","the viewport does NOT lock zoom — a manager can still pinch to read a figure",()=>hasNot(H,/user-scalable=no|maximum-scale=1/));
check("P61987","the browser tab names the panel",()=>has(H,/<title>Manager — Aevidine<\/title>/));
check("P61988","…and it matches the host page's metadata title exactly",()=>{
  const a=(H.match(/<title>([^<]+)<\/title>/)||[])[1];
  const b=(read("app/manager/page.tsx").match(/metadata = \{ title: "([^"]+)" \}/)||[])[1];
  return a===b||`panel says "${a}", host says "${b}"`;
});
check("P61989","there is a favicon, so the browser stops asking for /favicon.ico",()=>has(H,/<link rel="icon"/));
check("P61990","…and it is inline, so it costs no request",()=>has(H,/href="data:image\/svg\+xml,/));
check("P61991","…and it is the same plate glyph the brand uses",()=>has(H,/🍽️<\/text>/));
check("P61992","the icon markup is valid SVG with a viewBox",()=>has(H,/viewBox='0 0 100 100'/));
check("P61993","Font Awesome is loaded from our own origin",()=>has(H,/href="\/panels\/vendor\/fa\/css\/all\.min\.css/));
check("P61994","…and the reason is written down: a restaurant's wifi can block a CDN",()=>has(H,/never break\s*\n *when an external CDN is slow\/down/));
check("P61995","the panel stylesheet is a real <link>, not injected by script",()=>has(H,/<link rel="stylesheet" href="\/panels\/editor\/style\.css/));
check("P61996","…so the skeleton rows can never appear unstyled",()=>has(H,/which is a real <link>, so the\s*\n *placeholder itself can never appear unstyled/));
check("P61997","the stylesheet carries a ?v= cache-bust",()=>has(H,/style\.css\?v=[0-9a-f]{8}"/));
check("P61998","…and that hash is the file's real content hash",()=>{
  const v=(H.match(/style\.css\?v=([0-9a-f]{8})/)||[])[1];
  return v===sha8("public/panels/editor/style.css")||`tag says ${v}, content says ${sha8("public/panels/editor/style.css")}`;
});
check("P61999","the Font Awesome stylesheet's hash matches its file too",()=>{
  const v=(H.match(/all\.min\.css\?v=([0-9a-f]{8})/)||[])[1];
  return v===sha8("public/panels/vendor/fa/css/all.min.css")||`tag says ${v}`;
});
check("P62000","theme.js is loaded in the head, so the skin is set before first paint",()=>{
  const i=H.indexOf('src="/panels/theme.js'), j=H.indexOf("</head>");
  return (i>-1&&i<j)||"theme.js is not inside the head";
});
check("P62001","…and it is a BLOCKING script — no defer, no async",()=>{
  const tag=(H.match(/<script src="\/panels\/theme\.js[^>]*>/)||[])[0]||"";
  return (!/defer|async/.test(tag))||`theme.js tag is ${tag}`;
});
check("P62002","…and the head says why that ordering matters",()=>has(H,/sets data-theme before paint to avoid a flash/));
check("P62003","theme.js carries a content-hash ?v=",()=>{
  const v=(H.match(/theme\.js\?v=([0-9a-f]{8})/)||[])[1];
  return v===sha8("public/panels/theme.js")||`tag says ${v}`;
});
check("P62004","the head loads nothing else — every other script is at the end of the body",()=>{
  const head=H.slice(0,H.indexOf("</head>"));
  return eq(countOf(head,/<script/g),1);
});
check("P62005","no external origin is contacted by the document at all",()=>hasNot(H,/(?:src|href)="https?:\/\//));
check("P62006","…and no protocol-relative url either",()=>hasNot(H,/(?:src|href)="\/\//));
check("P62007","there is no inline <style> block competing with the stylesheet",()=>eq(countOf(HC,/<style/g),0));
check("P62008","there is no inline event handler anywhere in the markup",()=>eq(countOf(HC,/ on(?:click|load|error|change|input)=/g),0));
check("P62009","there is no inline <script> body — every line of behaviour is in a versioned file",()=>eq(countOf(H,/<script(?![^>]*src=)/g),0));
check("P62010","the document declares no Content-Security-Policy of its own (the app owns that)",()=>hasNot(H,/http-equiv="Content-Security-Policy"/));
check("P62011","…and no refresh meta that could reload the panel mid-service",()=>hasNot(H,/http-equiv="refresh"/));
check("P62012","the head has no preconnect/dns-prefetch to a third party",()=>hasNot(H,/rel="(?:preconnect|dns-prefetch)"/));
check("P62013","the title is the panel's own word, not the product's default",()=>hasNot(H,/<title>Aevidine — Restaurant OS<\/title>/));
check("P62014","the three panels each name themselves differently in the tab",()=>{
  const t=(f)=>(read(f).match(/<title>([^<]+)<\/title>/)||[])[1];
  const a=t("public/panels/editor/index.html"),b=t("public/panels/kitchen/index.html"),c=t("public/panels/tablet/index.html");
  return new Set([a,b,c]).size===3||`titles are ${a} / ${b} / ${c}`;
});
check("P62015","the document is served as a static file, so no request can be un-gated by mistake",()=>exists("public/panels/editor/index.html"));
check("P62016","…and the panel's DATA comes from a gated API family, not from this file",()=>hasNot(HC,/supabase|anon|apikey/i));
check("P62017","no key, token or password appears anywhere in the document",()=>hasNot(H,/eyJ[A-Za-z0-9_-]{10,}|service_role|sbp_/));
check("P62018","the favicon data-uri fetches nothing — its only http: string is the SVG namespace",()=>{
  const i=(H.match(/href="(data:image\/svg\+xml,[^"]*)"/)||[])[1]||"";
  const urls=(i.match(/https?:\/\/[^'"\s)]*/g)||[]).filter(u=>u!=="http://www.w3.org/2000/svg");
  return urls.length===0||`it references ${urls.join(", ")}`;
});
check("P62019","the head's comments explain each of the three <link>s",()=>countOf(H.slice(0,H.indexOf("</head>")),/<!--/g)>=3||"a head tag is unexplained");
check("P62020","the ?v= comment states the rule: bump it whenever the file changes",()=>has(H,/bump it whenever style\.css changes/));
check("P62021","…and names the exact gotcha it prevents",()=>has(H,/the exact \/manager stale-app\.js gotcha/));
check("P62022","the panel does not set a theme-color meta (it is inside a frame, nothing would use it)",()=>hasNot(H,/name="theme-color"/));
check("P62023","the document has exactly one <head> and one <body>",()=>(eq(countOf(H,/<head>/g),1)===true&&eq(countOf(H,/<body>/g),1)===true)||"the document structure is malformed");
check("P62024","…and they are closed",()=>(has(H,/<\/head>/)===true&&has(H,/<\/body>/)===true&&has(H,/<\/html>/)===true)||"a closing tag is missing");
check("P62025","no leaked template syntax anywhere in the markup",()=>hasNot(H,/\$\{|\{\{/));
check("P62026","no leaked comment marker inside visible text",()=>{
  const text=HC.replace(/<[^>]*>/g," ");
  return !/-->/.test(text)||"a stray --> is in the visible text";
});
check("P62027","the words 'undefined', 'NaN' and '[object Object]' appear nowhere",()=>hasNot(H,/undefined|NaN|\[object Object\]/));
check("P62028","the file uses LF line endings, like its siblings",()=>hasNot(H,/\r/));
check("P62029","the document is small — the weight is in the versioned assets",()=>H.length<20000||`index.html is ${H.length} bytes`);
check("P62030","…and it is the same shape as the other two panels' documents",()=>{
  return ["kitchen","tablet"].every(p=>{const s=read(`public/panels/${p}/index.html`);return /<!doctype html>/i.test(s)&&/theme\.js/.test(s);})||"a sibling panel document diverged";
});

process.exit(report("T8 · static E–F") ? 1 : 0);
