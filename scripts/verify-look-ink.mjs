#!/usr/bin/env node
// Guard: THE LOOK — is every word, number and glyph on every panel readable, in BOTH skins?
//
// Two halves, and the first one needs nothing running:
//
//   PART 1 (static, always) — the traps that make a colour silently wrong:
//     · `var(--x, #hex)` where --x is declared NOWHERE that document can see, so the hex wins in
//       BOTH skins and one of them is stuck with a value tuned for the other. This is how the guest
//       bill's edges ended up painted in the light skin's tan inside the dark skin, how the manager
//       panel's log rows ended up hovering BLUE on a gold panel, and how the waiter tablet's
//       "one party" label ended up orange at 1.89:1.
//     · a per-skin token declared in one skin block but not the other (--skel-hi, --gold-ink,
//       --merge-ink, --gold-grad, --border-color, --accent-ink), so the other skin inherits from
//       somewhere it shouldn't. --accent-ink is the sharp one: the GUEST theme declares it too, so a
//       console block that leaves it out takes a brown guest value onto a blue console at 2.60:1.
//     · a hand-added `-webkit-backdrop-filter` in app/globals.css — the Tailwind-4 build then
//       DROPS the property entirely and the frosted glass silently vanishes.
//     · a literal colour left inside the first-paint skeleton gradient (it can only be right in one
//       skin, and it was a near-black bar on a white tile in the default one).
//
//   PART 2 (live, when something is answering) — mount the real class names into the real running
//   cascade and MEASURE. Reading a stylesheet cannot tell you what a rule computes to once four
//   color-mix() calls and two skin blocks have had their say; every number below was wrong at least
//   once when reasoned from the source and right when measured.
//
//   node scripts/verify-look-ink.mjs [--base http://localhost:4000] [--static]
//
// Exit 0 = clean · 1 = found a fault · 2 = could not run (nothing answering).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const STATIC_ONLY = argv.includes("--static");
let bad = 0;
const fail = (m) => { console.error("✗ " + m); bad++; };
const ok = (m) => console.log("✓ " + m);

// ────────────────────────────────────────────────────────────────────────────────────────────
// PART 1 — static
// ────────────────────────────────────────────────────────────────────────────────────────────

// Each panel is its OWN document: it loads only its own stylesheet, so a token declared in
// app/globals.css does nothing for it. That is why the scope is per file, not repo-wide.
// `extra` is everything else that can DECLARE a token for that same document: a panel's own app.js
// sets layout knobs inline (--per-row-pc, --rail-h, --qo-img…), and the app's components set
// per-restaurant ones (--cat-color, --hue, --bell-lift). Leaving those out made this guard shout
// about 22 rules that were completely correct — a guard that invents a failure protects nothing,
// and is worse than no guard, because the next person stops reading it.
const DOCS = [
  { file: "public/panels/kitchen/style.css", extra: ["public/panels/kitchen"] },
  { file: "public/panels/tablet/style.css", extra: ["public/panels/tablet"] },
  { file: "public/panels/editor/style.css", extra: ["public/panels/editor"] },
  { file: "app/globals.css", extra: ["app", "components", "lib"] },
];

// A fallback that is itself a token or a CSS-wide keyword degrades gracefully and is fine.
const SAFE_FALLBACK = /^(?:var\(|inherit|currentColor|transparent|initial|unset|none|0|0px|1|100%)/i;
// Per-element opt-in knobs: nothing declares them because the point is that a caller may.
const KNOB = /^--lfh-(?:dur|eo|ex|ey|es|origin)$/;

function topLevelFiles(dir, out = []) {
  // The scripts at the TOP of public/panels are loaded by every panel, so a token one of them sets
  // inline (undobar.js publishes --lfh-undobar-h, theme.js the skin) is declared for every panel.
  let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) if (e.isFile() && /\.(js|css|html)$/.test(e.name)) out.push(join(dir, e.name));
  return out;
}
function walk(dir, out = []) {
  let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (e.name === "node_modules" || e.name === "vendor" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css|js|jsx|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
function declarationsIn(text) {
  const d = new Set();
  for (const m of text.matchAll(/(?:^|[;{\s"'`(])(--[A-Za-z0-9_-]+)\s*(?:"\s*)?:/g)) d.add(m[1]);
  for (const m of text.matchAll(/setProperty\(\s*[`"'](--[A-Za-z0-9_-]+)/g)) d.add(m[1]);
  for (const m of text.matchAll(/["'`](--[A-Za-z0-9_-]+)["'`]\s*\]?\s*(?:as string\s*\])?\s*:/g)) d.add(m[1]);
  return d;
}

for (const { file, extra } of DOCS) {
  const src = readFileSync(file, "utf8");
  const declared = declarationsIn(src);
  const sources = extra.flatMap((r) => walk(r))
    .concat(file.startsWith("public/panels/") ? topLevelFiles("public/panels") : []);
  for (const f of sources) {
    let t; try { t = readFileSync(f, "utf8"); } catch { continue; }
    for (const d of declarationsIn(t)) declared.add(d);
  }
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const offenders = [];
  bare.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)/g)) {
      const [, tok, fb] = m;
      if (declared.has(tok) || KNOB.test(tok)) continue;
      if (fb && SAFE_FALLBACK.test(fb.trim())) continue;      // degrades to a token/keyword
      offenders.push(`${file}:${i + 1}  ${tok}${fb ? ` (falls back to ${fb.trim()})` : " (NO fallback)"}`);
    }
  });
  if (offenders.length) {
    fail(`${offenders.length} token(s) read but declared nowhere this document can see — the fallback wins in BOTH skins:`);
    offenders.forEach((o) => console.error("    " + o));
  } else ok(`${file} — every token it reads is declared where it can see it`);
}

// A token that must exist in BOTH skin blocks of the same document, or one skin inherits a value
// that was never meant for it.
const PAIRS = [
  { file: "public/panels/kitchen/style.css", dark: ":root", light: 'html[data-theme="light"]', tokens: ["--skel-hi"] },
  { file: "public/panels/tablet/style.css", dark: ":root", light: 'html[data-theme="light"]', tokens: ["--skel-hi", "--gold-ink", "--merge-ink"] },
  // --brand-grad paints the word "Manager" itself (background-clip:text), so it is INK and needs a
  // per-skin value like every other gold that carries words. Missing from the light block, the
  // panel's own name read 2.64:1 on its own bar (T26, sweep #7).
  { file: "public/panels/editor/style.css", dark: ":root", light: 'html[data-theme="light"]', tokens: ["--gold-grad", "--brand-grad"] },
  { file: "app/globals.css", dark: ":root", light: '[data-theme="light"]', tokens: ["--border-color", "--accent-ink"] },
];
function blockAt(src, selector) {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(,[^{]*)?\\{`, "g");
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = src.indexOf("\n}", start);
  return src.slice(start, end < 0 ? src.length : end);
}
for (const { file, dark, light, tokens } of PAIRS) {
  const src = readFileSync(file, "utf8");
  const dBlk = blockAt(src, dark), lBlk = blockAt(src, light);
  if (!dBlk || !lBlk) { fail(`${file} — could not find both skin blocks (${dark} / ${light}); this guard needs updating`); continue; }
  for (const t of tokens) {
    const inD = dBlk.includes(`${t}:`), inL = lBlk.includes(`${t}:`);
    if (inD && inL) ok(`${file} — ${t} is declared in both skins`);
    else fail(`${file} — ${t} is declared in ${inD ? "the DARK" : "the LIGHT"} skin only; the other skin inherits a value tuned for something else`);
  }
}

// The console blocks are the sharp case: the GUEST theme declares --accent-ink too, so a console
// that does not declare its own takes the guest's hue.
{
  const src = readFileSync("app/globals.css", "utf8");
  for (const sel of ['.adm.adx', '.adm.adx[data-skin="light"]', '.adm.owx', '.adm.owx[data-skin="light"]']) {
    const b = blockAt(src, sel);
    if (!b) { fail(`app/globals.css — console block ${sel} not found; this guard needs updating`); continue; }
    if (b.includes("--accent-ink:")) ok(`app/globals.css — ${sel} declares its own --accent-ink`);
    else fail(`app/globals.css — ${sel} does not declare --accent-ink, so it inherits the GUEST theme's (a different hue entirely: this read 2.60:1 on the admin console's active nav label)`);
  }
}

// Blur is ONE unprefixed line — hand-prefixing makes the Tailwind-4 build drop it outright.
{
  const src = readFileSync("app/globals.css", "utf8");
  const hits = src.split("\n").map((l, i) => (/-webkit-backdrop-filter/.test(l) ? i + 1 : 0)).filter(Boolean);
  if (hits.length) fail(`app/globals.css — hand-added -webkit-backdrop-filter at line(s) ${hits.join(", ")}; the build then DROPS backdrop-filter entirely and the frosted glass vanishes`);
  else ok("app/globals.css — backdrop-filter is unprefixed (the build adds the prefix itself)");
}

// EVERY full-screen overlay backdrop reads --scrim, never its own literal. Each one having its own
// value is how two overlays on the same screen came to dim the page by different amounts.
for (const file of ["public/panels/kitchen/style.css", "public/panels/tablet/style.css", "public/panels/editor/style.css"]) {
  const src = readFileSync(file, "utf8");
  if (!/--scrim\s*:/.test(src)) { fail(`${file} — no --scrim token declared; the overlay dim has gone back to per-rule literals`); continue; }
  const bad = [];
  src.split("\n").forEach((l, i) => {
    if (!/position:\s*fixed/.test(l) || !/inset:\s*0/.test(l)) return;
    const m = /background(?:-color)?:\s*(rgba?\([^)]*\))/.exec(l);
    // a deliberate WARNING tint (the floor-wide red) is not a scrim and keeps its own colour
    if (m && !/60\s*,\s*0\s*,\s*0/.test(m[1])) bad.push(`${file}:${i + 1}  ${m[1]}`);
  });
  if (bad.length) { fail(`${bad.length} full-screen overlay(s) still dim with their own literal instead of --scrim:`); bad.forEach((b) => console.error("    " + b)); }
  else ok(`${file} — every full-screen overlay dims with --scrim`);
}

// WHITE INK NEEDS A DARK ENOUGH FILL. The sign-in pages hold their primary button's colour in an
// inline style, so no stylesheet check can see it: blue-500 with white on it read 3.68:1 at 15px/700
// on /login and /staff-login, in both skins - the primary action on the page every staff member
// starts at. Assert the fill by value, because that is where it lives.
for (const file of ["app/login/LoginForm.tsx", "app/staff-login/LoginForm.tsx", "app/staff-login/BlockedView.tsx"]) {
  let src; try { src = readFileSync(file, "utf8"); } catch { fail(`${file} — not found; this guard needs updating`); continue; }
  if (/"#3b82f6"/.test(src)) fail(`${file} — the primary button is back on blue-500; white on it is 3.68:1 (needs 4.5). Blue-600 (#2563eb) reads 5.17:1.`);
  else ok(`${file} — the primary button's fill is dark enough for white ink`);
}

// The first-paint skeleton must not carry a literal colour: it can only be right in one skin.
for (const file of ["public/panels/kitchen/style.css", "public/panels/tablet/style.css"]) {
  const rule = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(".skel-line {"));
  if (!rule) { fail(`${file} — no .skel-line rule found; this guard needs updating`); continue; }
  if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(rule)) fail(`${file} — .skel-line still carries a literal colour; on the LIGHT skin (the default) that is a near-black bar across a white placeholder`);
  else ok(`${file} — the skeleton sheen comes from a token`);
}

// A SURFACE TINT MUST NOT BE USED AS INK (T26, sweep #7). --muted2 is a ~25%-alpha wash that ~15
// console rules paint a hover row with, and on the guest side it is declared in the LIGHT block
// only. Used as `color:` or `stroke:` it therefore fails twice over: on DARK the declaration is
// dropped outright (the dish page's unearned review stars computed to `stroke: none`, so a 3-of-5
// rating showed three stars and nothing beside them), and on LIGHT it resolves to the wash and
// measured 1.63:1. Backgrounds, borders and shadows may read it; ink may not.
{
  const src = readFileSync("app/globals.css", "utf8");
  const bad = [];
  src.split("\n").forEach((l, i) => {
    if (!/var\(\s*--muted2\b/.test(l)) return;
    if (!/(^|[;{\s])(color|stroke|fill|-webkit-text-fill-color)\s*:[^;]*var\(\s*--muted2\b/.test(l)) return;
    if (/var\(\s*--muted2\s*,\s*var\(/.test(l)) return;          // falls back to a real ink token
    bad.push(`app/globals.css:${i + 1}  ${l.trim().slice(0, 110)}`);
  });
  if (bad.length) {
    fail(`${bad.length} rule(s) paint INK with --muted2, a 25%-alpha surface tint that the guest DARK skin does not declare at all:`);
    bad.forEach((b) => console.error("    " + b));
  } else ok("app/globals.css — --muted2 is used as a surface tint only, never as ink");
}

// THE WAITER TABLET'S SLIDE-IN DRAWER IS PINNED TO TWO EDGES (T26, sweep #7). env() reads 0 inside
// a panel iframe, which is exactly why --sat/--sab/--sal/--sar exist. Padded a flat 16px, this
// drawer put its ✕ and the person's name 31px inside a 47px notch; the kitchen board's twin pads
// all four sides and measured clear at y=61 under the same forced inset.
{
  const src = readFileSync("public/panels/tablet/style.css", "utf8");
  const rule = src.split("\n").find((l) => l.startsWith(".tbl-drawer {"));
  if (!rule) fail("public/panels/tablet/style.css — no .tbl-drawer rule found; this guard needs updating");
  else {
    const missing = ["--sat", "--sar", "--sab"].filter((t) => !rule.includes(t));
    if (missing.length) fail(`public/panels/tablet/style.css — .tbl-drawer no longer pads for ${missing.join(", ")}; on a notched phone its close button goes back under the cutout`);
    else ok("public/panels/tablet/style.css — .tbl-drawer pads for the notch on all three edges it touches");
  }
}

// THE styled-jsx BLOCKS ARE DOCUMENTS TOO, and until sweep #7 no guard read them (T26). The trap
// is the same one this file was built for — `var(--undeclared, <literal>)`, where the literal then
// wins in BOTH skins — but it hides better here, because these blocks are scattered across 150 tsx
// files instead of sitting in one stylesheet.
//
// A NEUTRAL fallback is explicitly fine and is NOT reported: a mid-grey at low alpha
// (rgba(127,127,127,.22) on the connection pill, a 4% wash behind an owner row) reads the same way
// on a cream page and a near-black one, which is the whole point of choosing it. What must not
// appear is a fallback tuned for ONE skin — a tan, a brown, a navy — because that is the shape that
// put the light skin's tan inside the dark skin twice already.
{
  const isNeutralGrey = (v) => {
    let r, g, b;
    const fn = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
    if (fn) [r, g, b] = [+fn[1], +fn[2], +fn[3]];
    else {
      // #888 and #888888 are just as neutral as rgb(136,136,136) — read both spellings, or the
      // guard cries wolf about the very fallbacks it is meant to bless.
      const hx = /^#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(v.trim());
      if (!hx) return false;
      const h = hx[1].length === 3 ? hx[1].split("").map((c) => c + c).join("") : hx[1];
      [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    return Math.max(r, g, b) - Math.min(r, g, b) <= 6;   // r≈g≈b: no hue to be wrong about
  };
  const declared = new Set();
  const tsx = [];
  for (const dir of ["app", "components"]) walk(dir, tsx);
  const sources = tsx.filter((f) => f.endsWith(".tsx")).concat(["app/globals.css"]);
  for (const f of sources) { let t; try { t = readFileSync(f, "utf8"); } catch { continue; }
    for (const d of declarationsIn(t)) declared.add(d);
    // style={{ ["--x" as string]: v }} — the inline form the plain declaration regex does not see
    for (const m of t.matchAll(/\[\s*["'`](--[A-Za-z0-9_-]+)["'`](?:\s+as\s+\w+)?\s*\]\s*:/g)) declared.add(m[1]);
  }
  const offenders = [];
  let blocks = 0;
  for (const f of sources.filter((x) => x.endsWith(".tsx"))) {
    const src2 = readFileSync(f, "utf8");
    for (const b of src2.matchAll(/<style[^>]*jsx[^>]*>\s*\{\s*`([\s\S]*?)`\s*\}\s*<\/style>/g)) {
      blocks++;
      if (/-webkit-backdrop-filter/.test(b[1])) offenders.push(`${f} — hand-added -webkit-backdrop-filter; the build then DROPS backdrop-filter entirely`);
      for (const v of b[1].matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*,\s*([^)]*(?:\([^)]*\))?[^)]*)\)/g)) {
        const [, tok, fb] = v;
        if (declared.has(tok) || KNOB.test(tok)) continue;
        const val = fb.trim();
        if (SAFE_FALLBACK.test(val) || isNeutralGrey(val)) continue;
        if (!/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|color\()/i.test(val)) continue;
        offenders.push(`${f} — var(${tok}, ${val}) and ${tok} is declared nowhere, so that literal wins in BOTH skins`);
      }
    }
  }
  if (offenders.length) { fail(`${offenders.length} styled-jsx rule(s) pin one skin's colour into both:`); offenders.forEach((x) => console.error("    " + x)); }
  else ok(`${blocks} styled-jsx block(s) — no undeclared token falls back to a colour that only suits one skin`);
}

if (STATIC_ONLY) {
  console.log(bad ? `\n${bad} look fault(s) found (static checks only).` : "\nOK — the static look checks pass (pass a --base to also measure the running app).");
  process.exit(bad ? 1 : 0);
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// PART 2 — live: mount the real classes in the real cascade and measure
// ────────────────────────────────────────────────────────────────────────────────────────────
const { chromium } = await import("playwright");
const { loginAs, adminCookie } = await import("./sweep/login.mjs");
const { requireAppUp } = await import("./sweep/appUp.mjs");
const BASE = await requireAppUp(process.argv, "the look/ink check");

// Contrast maths, injected. Three things that were wrong the first three times and now are not:
// a background-IMAGE paints OVER the element's own background-COLOR; a background-clip:text fill
// paints no surface at all (it is clipped to the glyphs); and a sticky heading's
// `linear-gradient(page-colour 78%, transparent)` must be read at its opaque stop, not averaged.
const INK = `window.__ink = (() => {
  const lin = x => { x/=255; return x<=0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055,2.4); };
  const lum = ([r,g,b]) => .2126*lin(r)+.7152*lin(g)+.0722*lin(b);
  const P = s => { const m=String(s).match(/-?[\\d.]+/g); if(!m) return null;
    const k=/^color\\(\\s*srgb/i.test(String(s))?255:1;
    return [ +m[0]*k, +m[1]*k, +m[2]*k, m[3]===undefined?1:+m[3] ]; };
  const over = (f,b) => { const fa=f[3]===undefined?1:f[3], ba=b[3]===undefined?1:b[3];
    if(fa>=1) return [f[0],f[1],f[2],1];
    const ra=fa+ba*(1-fa); if(ra<=0) return [f[0],f[1],f[2],0];
    return [0,1,2].map(i=>(f[i]*fa+b[i]*ba*(1-fa))/ra).concat([ra]); };
  function gradTop(bi){
    if(!bi || bi==="none" || bi.indexOf("gradient")<0) return null;
    const parts=bi.split("rgb"), stops=[];
    for(let i=1;i<parts.length;i++){ const a=parts[i].indexOf("("), b=parts[i].indexOf(")");
      if(a<0||b<0) continue;
      const n=parts[i].slice(a+1,b).split(",").map(x=>parseFloat(x));
      if(n.length>=3 && !n.slice(0,3).some(Number.isNaN)) stops.push([n[0],n[1],n[2],n[3]===undefined?1:n[3]]); }
    if(!stops.length) return null;
    const A=Math.max.apply(null,stops.map(s=>s[3])), top=stops.filter(s=>s[3]>=A-0.01);
    return [0,1,2].map(q=>top.reduce((a,s)=>a+s[q],0)/top.length).concat([A]);
  }
  function ownFill(el){ const cs=getComputedStyle(el);
    if((cs.webkitBackgroundClip||cs.backgroundClip)==="text") return null;
    const c=P(cs.backgroundColor), g=gradTop(cs.backgroundImage);
    if(g && g[3]>0.02) return (c && c[3]>0.02) ? over(g,c) : g;
    return (c && c[3]>0.02) ? c : null; }
  function bgOf(el){ let cur=el, acc=null;
    while(cur){ const c=ownFill(cur); if(c){ acc=acc?over(acc,c):c; if(acc[3]>=0.995) return acc; } cur=cur.parentElement; }
    return acc || (P(getComputedStyle(document.body).backgroundColor)||[255,255,255,1]); }
  const R=(a,b)=>{const la=lum(a),lb=lum(b);return +(((Math.max(la,lb)+.05)/(Math.min(la,lb)+.05)).toFixed(2));};
  return function(html, sels, rootSel){
    // MOUNT INSIDE THE SCOPE THAT DECLARES THE TOKENS. The consoles put their whole palette on
    // .adm.adx / .adm.owx, so a probe parked on <body> inherits the GUEST theme instead and every
    // console read came back as the same brown 2.50:1 — a fault in the guard, not the product.
    const root=(rootSel && document.querySelector(rootSel)) || document.body;
    const host=document.createElement("div");
    host.id="__inkprobe"; host.style.cssText="position:fixed;left:0;top:0;z-index:-1";
    host.innerHTML=html; root.appendChild(host);
    const out={};
    for(const s of sels){ const el=host.querySelector(s);
      if(!el){ out[s]=null; continue; }
      const cs=getComputedStyle(el); const bg=bgOf(el);
      // GRADIENT-CLIPPED LETTERING has no usable color: with background-clip:text the gradient IS
      // the ink. Read every stop and report the WORST, which is the honest number for a word whose
      // far end is the palest part of it. (This is how the manager panel's own name sat at 2.64:1
      // while the guard beside it reported the restaurant name next to it as fine.)
      let fg=P(cs.webkitTextFillColor||cs.color), src="color";
      if((!fg || fg[3]===0) && (cs.webkitBackgroundClip||cs.backgroundClip)==="text"){
        const bi=cs.backgroundImage||"", stops=[];
        const re=/(?:color\(\s*srgb[^)]*\)|rgba?\([^)]*\))/gi; let m;
        while((m=re.exec(bi))){ const c=P(m[0]); if(c && c[3]>0.02) stops.push(c); }
        if(stops.length){ let worst=null,wr=Infinity;
          for(const c of stops){ const r=R(over(c,bg),bg); if(r<wr){wr=r;worst=c;} }
          fg=worst; src="gradient-text (worst stop)"; }
      }
      out[s]={ ratio: fg?R(over(fg,bg),bg):0, color:(src==="color"?cs.color:src+" "+cs.backgroundImage.slice(0,60)),
        bg:"rgb("+bg.slice(0,3).map(Math.round).join(",")+")" }; }
    host.remove(); return out;
  };
})();`;

// The probes. Every floor is the one that applies to the thing being measured: 4.5 for words and
// numbers, 3 for a glyph or a mark. Every "was" number in the notes was measured, not reasoned.
const PROBES = [
  { name: "waiter tablet", role: "tablet", url: "/tablet", frame: "/panels/tablet/",
    html: `<button class="btn primary">Save</button><button class="chip on">Coffee</button>
           <span class="dqty">2</span><span class="dadd">+</span><span class="dedit">e</span>
           <h3 class="om-sec-h">COFFEE</h3><span class="tmerge">one party T11 T12</span>
           <button class="fnav on">All <em>30</em></button>
           <div class="tile"><span class="t-line-plain"><span class="t-linenum">0/6 served</span></span><span class="tseats">4</span></div>`,
    checks: [[".btn.primary", 4.5, "the primary button's label (was white on gold: 2.81 light / 2.23 dark)"],
             [".chip.on", 4.5, "the chosen category chip (same)"],
             [".dqty", 4.5, "the quantity pill on a dish tile (same)"],
             [".dadd", 3, "the ＋ glyph on a dish tile (was 2.09 on the light skin)"],
             [".dedit", 3, "the ✎ glyph on a dish tile (was 2.76)"],
             [".om-sec-h", 4.5, "the Take-order category heading (was 3.13)"],
             [".tmerge", 4.5, "the one-party label in an open table's header (was an orange at 1.89)"],
             [".t-linenum", 4.5, "the tile's x/y-served line — the manager floor's twin reads 6.43"],
             [".tseats", 4.5, "the tile's seat count — the manager floor's twin reads 6.40"],
             [".fnav.on em", 4.5, "the count inside the chosen filter chip (was 3.89 on a 20% black wash)"]] },
  { name: "manager panel", role: "manager", url: "/manager", frame: "/panels/editor/",
    html: `<div class="ftile"><span class="ft-ico ft-ico-go">Y</span></div>
           <span class="brand" id="__brandword">Manager<span class="brand-rest">little French house</span></span>
           <div class="to-rail-h">Categories</div>
           <div class="to-crail"><button class="to-cat on">Coffee</button></div>
           <h4 class="to-sec-h">COFFEE</h4><span class="chip alg-other">+ Other</span>
           <div class="fstat warn"><div class="fstat-n">7</div></div>
           <div class="rr-made"><div class="rr-made-q">Was the food made?</div></div>
           <button class="ord-btn pay">Pay</button>
           <div class="ftile"><span class="ft-num ft-num-sm">22</span>
             <div class="ft-merge ft-merge-parent">one party T12 T13</div></div>
           <span class="tab-badge">3</span>`,
    checks: [[".ft-ico-go", 3, "the tile's accept-this-order tick (was 1.10 on the light skin — invisible)"],
             [".brand-rest", 4.5, "the restaurant's own name in the top bar (was 2.81 on the light skin)"],
             ["#__brandword", 3, "the panel's OWN name, painted as gradient lettering (was 2.64 on the light skin — the guard measured the restaurant name beside it and missed this one)"],
             [".to-rail-h", 4.5, "Take order → 'Categories' over the left box (was 2.81 light)"],
             [".to-crail .to-cat.on", 4.5, "Take order → the chosen category in that box (was 3.14 light)"],
             [".to-sec-h", 4.5, "Take order → the category heading in the dish list (was 3.71 light)"],
             [".alg-other", 4.5, "the '+ Other' allergy chip — one rule, four screens (was 2.48 light)"],
             [".fstat-n", 4.5, "the to-pay count in the floor header (was 3.71)"],
             [".rr-made-q", 4.5, "the was-the-food-made question (was pinned to one skin's red)"],
             [".ord-btn.pay", 4.5, "the Pay button's label on its gold fill"],
             [".ft-num", 4.5, "the TABLE NUMBER on a dense tile (was 3.13 on an amber table, light skin)"],
             [".ft-merge-parent", 4.5, "the one-party chip on a tile (was 4.18 light / 4.46 dark at 8px)"],
             [".tab-badge", 4.5, "the tab's waiting count, white on red (was 3.76 on the dark skin)"]] },
  // THE BILLS SCREEN — the one where money is read, and it had NINE things under the line
  // (T26 sweep #7). Every state is mounted, because the pass that fixed this family in July
  // deepened `.ord-pill.new` while the list actually renders `.ord-pill.received`, and left the
  // states it did touch short of the line.
  { name: "manager Bills", role: "manager", url: "/manager", frame: "/panels/editor/",
    html: `<div class="ord-card"><div class="ord-top">
             <span class="ord-pill received">New order</span><span class="ord-pill preparing">Cooking</span>
             <span class="ord-pill ready">Ready</span><span class="ord-pill served">Served</span>
             <span class="ord-pill cancelled">Cancelled</span><span class="ord-pill new">New</span>
             <span class="ord-pill freed-pill">Freed</span></div>
             <div class="ord-total"><span>Total</span><span>₹126</span></div></div>
             <button class="cat-chip active">All</button><span class="dish-no">#1</span>
             <div class="dash-card"><span class="kchip up">100%</span><span class="kchip dn">28%</span></div>`,
    checks: [[".ord-pill.received", 4.5, "Bills → the 'New order' tag (was 1.43 on the light skin — an amber word on a tan pill)"],
             [".ord-pill.preparing", 4.5, "Bills → the Cooking tag (was 3.28 — the July pass stopped short of the line)"],
             [".ord-pill.ready", 4.5, "Bills → the Ready tag (was 1.59)"],
             [".ord-pill.served", 4.5, "Bills → the Served tag (was 3.30)"],
             [".ord-pill.cancelled", 4.5, "Bills → the Cancelled tag (was 2.28 light / 4.08 dark)"],
             [".ord-pill.new", 4.5, "Bills → the New tag"],
             [".ord-pill.freed-pill", 4.5, "Bills → the Freed tag (was 3.43)"],
             [".ord-total span:last-child", 3, "Bills → THE BILL'S OWN TOTAL (was 2.03 on the light skin — --gold is a fill, not ink)"],
             [".cat-chip.active", 4.5, "Editor → the chosen category chip (was 2.71 on the light skin; it lays an 18% gold wash under its own label, so even --gold-ink only reached 4.31 there)"],
             [".dish-no", 4.5, "Editor → a dish's number in the list (was 2.37 — gold as ink under a 0.75 veil)"],
             [".kchip.up", 4.5, "Dashboard → an up-percentage chip (was 3.53 on the light skin; it had a DARK override and no light one)"],
             [".kchip.dn", 4.5, "Dashboard → a down-percentage chip (was 3.86, same story)"]] },
  { name: "kitchen board", role: "kitchen", url: "/kitchen", frame: "/panels/kitchen/",
    html: `<div class="col" id="col-cooking"><h2>Cooking</h2></div>`,
    checks: [["#col-cooking h2", 4.5, "the Cooking lane heading"]] },
  // THE GUEST SIDE HAD NO PROBE AT ALL until sweep #7, and three of that run's five faults were
  // here. It needs no login: the menu is the one door that opens to anybody.
  { name: "guest menu", role: null, url: "/menu?table=1", frame: null, skinKey: "lfh_theme",
    html: `<div class="cat-card"><div class="cat-icon">C</div><div class="cat-name">Beverages</div></div>
           <div class="review-card"><div class="rating-row"><span class="rating-count">(12 reviews)</span></div></div>
           <div class="detail-body"><div class="section-label">ABOUT THIS DISH</div>
             <p class="detail-desc">Our Espresso is made by hand.</p><span class="desc-toggle">Read more ↓</span></div>`,
    checks: [[".cat-name", 4.5, "an unchosen category name under its icon (was 4.13 on the light skin — the card's own tint is darker than the page)"],
             [".desc-toggle", 4.5, "a dish page's 'Read more' link (was 4.29 on the dark skin — --accent-ink-dim was a plain alias of the border colour)"],
             [".section-label", 4.5, "a dish page's 'ABOUT THIS DISH' heading (was scraping over at 4.54)"],
             // 4.4, not 4.5, and the 0.1 is DELIBERATE. Both this and the unselected filter-chip
             // label take the guest's secondary ink --muted, which on the DARK skin lands at
             // 4.47:1 on a card — 0.03 short. Sweep #6 measured the same number and parked it in
             // writing: lifting it repaints every secondary word on the guest menu, which is the
             // owner's call and not a sweep's. This floor still bites if the value really drops;
             // it just does not cry wolf about a decision that was already taken.
             [".rating-count", 4.4, "a dish's review count (was 1.63 light, and on DARK the rule was dropped outright; the guest --muted family sits at 4.47 dark by a recorded decision)"]] },
];

const br = await chromium.launch();
for (const p of PROBES) {
  for (const theme of ["light", "dark"]) {
    const c = await br.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    // p.role === null is the GUEST menu: the one door that opens to anybody, so no login at all.
    if (p.role) await loginAs(c, p.role, BASE);
    const page = await c.newPage();
    await page.addInitScript(`try{localStorage.setItem("${p.skinKey || "lfh_panel_theme"}","${theme}")}catch(e){}`);
    await page.goto(BASE + p.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(7000);
    // A panel lives in an iframe; the guest menu is the page itself.
    const fr = p.frame ? page.frames().find((f) => f.url().includes(p.frame)) : page.mainFrame();
    if (!fr) { fail(`${p.name} (${theme}) — the panel never loaded, so nothing was measured`); await c.close(); continue; }
    await fr.evaluate(INK);
    const res = await fr.evaluate(([html, sels]) => window.__ink(html, sels), [p.html, p.checks.map((x) => x[0])]);
    for (const [sel, floor, what] of p.checks) {
      const r = res[sel];
      if (!r) { fail(`${p.name} (${theme}) — ${sel} did not mount; this guard needs updating`); continue; }
      if (r.ratio >= floor) ok(`${p.name} ${theme.padEnd(5)} ${sel.padEnd(16)} ${r.ratio}:1 — ${what}`);
      else fail(`${p.name} ${theme} — ${what}: ${r.ratio}:1 (needs ${floor}), ${r.color} on ${r.bg}`);
    }
    await c.close();
  }
}

// The consoles: their own skin key, and the active nav item is the rule that regressed mid-edit.
for (const [kind, url, role] of [["admin console", "/aevinite", null], ["owner console", "/owner", "owner"]]) {
  for (const skin of ["dark", "light"]) {
    const c = await br.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    if (role) await loginAs(c, role, BASE); else await c.addCookies([adminCookie(BASE)]);
    await c.addCookies([{ name: "aevidine_skin", value: skin, url: BASE }]);
    const page = await c.newPage();
    await page.addInitScript(`try{localStorage.setItem("aevidine_skin","${skin}")}catch(e){}`);
    await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(8000);
    await page.evaluate(INK);
    const r = await page.evaluate(() => {
      const link = document.querySelector(".adx-navlink.active, .owx-navlink.active");
      if (!link) return null;
      // Mount inside the SIDEBAR, not just inside .adm: the sidebar has its own surface (--side),
      // and a probe one level out composited the 14% accent tint over the page instead, which read
      // 0.65 lower than the real thing. Measure the surface the label actually sits on.
      const side = link.closest(".adx-side, .owx-side, .adm-side");
      const root = side ? (side.classList.contains("adx-side") ? ".adx-side"
                        : side.classList.contains("owx-side") ? ".owx-side" : ".adm-side") : ".adm";
      return window.__ink(link.outerHTML, [".adx-navlink.active", ".owx-navlink.active"], root);
    });
    const hit = r && (r[".adx-navlink.active"] || r[".owx-navlink.active"]);
    if (!hit) fail(`${kind} (${skin}) — no active sidebar item found, so nothing was measured`);
    else if (hit.ratio >= 4.4) ok(`${kind} ${skin.padEnd(5)} active sidebar item ${hit.ratio}:1`);
    else fail(`${kind} ${skin} — the active sidebar item reads ${hit.ratio}:1 (needs 4.4), ${hit.color} on ${hit.bg}. If that looks like a hue from a different console, the block is missing its own --accent-ink.`);
    await c.close();
  }
}
await br.close();

console.log(bad ? `\n${bad} look fault(s) found.` : "\nOK — every probed word, number and glyph is readable in both skins.");
process.exit(bad ? 1 : 0);
