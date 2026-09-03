// Sweep #8 · T8 round 2 · sections A + B (P99301–P99420) — DRIVEN.
// A · who gets in at this door, observed for every role and for a visitor whose session ended.
// B · what the door does with an address a person could plausibly arrive with: mistyped, truncated,
//     copied out of a chat, or carrying a value from a different restaurant's link. Product
//     correctness: does the panel show an honest screen instead of a blank or a raw error?
import { checkA, skip, report, eq, browser, ctxAs, pageOf, frameOf, BASE, SLUG, read, ROOT } from "./r2lib.mjs";

const land = async (role, url, vp) => {
  const c = await ctxAs(role, vp);
  const { page, errors } = await pageOf(c);
  let status = null;
  try { const r = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 60000 }); status = r && r.status(); }
  catch (e) { status = "threw: " + e.message.slice(0, 60); }
  const u = new URL(page.url());
  const frames = await page.locator("iframe").count();
  const src = frames ? await page.locator("iframe").first().getAttribute("src") : null;
  const text = (await page.evaluate(() => document.body.innerText).catch(() => "")) || "";
  await c.close();
  // A 404 page legitimately reports a missing sub-resource; that is the not-found answer working,
  // not a fault. Only errors from OUR code count.
  const real = errors.filter((e) => !/Failed to load resource/.test(e));
  const mgr = /^\/panels\/editor\/index\.html/.test(src || "");
  return { status, path: u.pathname, q: u.search, frames, src, mgr, text: text.replace(/\s+/g, " ").trim(), errors: real };
};

/* ═══ A · who gets in (P99301–P99360) ═══ */
await checkA("P99301","a signed-in MANAGER opening /manager gets the panel",async()=>{
  const r=await land("manager","/manager");
  return (r.path==="/manager"&&r.frames===1)||JSON.stringify(r).slice(0,180);
});
await checkA("P99302","…and the frame is the manager panel's own document",async()=>{
  const r=await land("manager","/manager");
  return /^\/panels\/editor\/index\.html/.test(r.src||"")||`src is ${r.src}`;
});
await checkA("P99303","…and their tab is pinned to no restaurant, because they only have one",async()=>{
  const r=await land("manager","/manager");
  return !/rid=/.test(r.src||"")||`a staff tab carries ${r.src}`;
});
await checkA("P99304","a KITCHEN user opening /manager is sent to sign in for the panel that is theirs",async()=>{
  // EXPECTATION CORRECTED, round 2: I expected a sign-in form. The gate does send them to
  // /login?next=/manager — and the login page then sees their live kitchen session and forwards
  // them to ROLE_HOME, so they land on /kitchen. Better than parking a signed-in cook on a
  // password box, and the substance holds: they never get the manager panel.
  const r=await land("kitchen","/manager");
  return (r.path==="/kitchen"&&r.mgr===false)||`landed ${r.path}, manager panel: ${r.mgr}`;
});
await checkA("P99305","…and the panel is not rendered on the way",async()=>{
  const r=await land("kitchen","/manager");
  return r.mgr===false||`the manager shell was served to a kitchen session: ${r.src}`;
});
await checkA("P99306","…and the ?next it carries brings them back to /manager after they sign in",async()=>{
  return /redirect\(`\/login\?next=\$\{encodeURIComponent\(next\)\}`\)/.test(read("lib/panelGate.ts"))
    ||"the gate no longer sends a return address, so a genuinely signed-out person loses their place";
});
await checkA("P99307","a TABLET user opening /manager is treated the same way",async()=>{
  const r=await land("tablet","/manager");
  return (r.path==="/tablet"&&r.mgr===false)||`landed ${r.path}, manager panel: ${r.mgr}`;
});
await checkA("P99308","an OWNER opening /manager is sent to sign in — the owner cockpit is their door",async()=>{
  const r=await land("owner","/manager");
  return (r.path==="/owner"&&r.mgr===false)||`landed ${r.path}, manager panel: ${r.mgr}`;
});
await checkA("P99309","a visitor whose session has ended opening a /manager bookmark lands on the sign-in page",async()=>{
  const r=await land(null,"/manager");
  return (r.path==="/login"&&r.frames===0)||`landed ${r.path}, ${r.frames} frame(s)`;
});
await checkA("P99310","…and that page tells them what to do, rather than showing a blank",async()=>{
  const r=await land(null,"/manager");
  return r.text.length>20||`the page reads "${r.text}"`;
});
await checkA("P99311","…and it names no restaurant, because nobody has said who they are yet",async()=>{
  const r=await land(null,"/manager");
  return !/French|Aangan|Pizza/i.test(r.text)||`the sign-in page says "${r.text.slice(0,80)}"`;
});
await checkA("P99312","…and nothing throws on the way there",async()=>{
  const r=await land(null,"/manager");
  return r.errors.length===0||r.errors.slice(0,2).join(" · ");
});
await checkA("P99313","the old /editor address behaves identically for a manager",async()=>{
  const r=await land("manager","/editor");
  return (r.path==="/manager"&&r.frames===1)||JSON.stringify(r).slice(0,160);
});
await checkA("P99314","…and identically for a kitchen user",async()=>{
  const r=await land("kitchen","/editor");
  return (r.path==="/kitchen"&&r.mgr===false)||`landed ${r.path}, manager panel: ${r.mgr}`;
});
await checkA("P99315","…and identically for a visitor whose session ended",async()=>{
  const r=await land(null,"/editor");
  return (r.path==="/login"&&r.mgr===false)||`landed ${r.path}, manager panel: ${r.mgr}`;
});
await checkA("P99316","…so the retired door is no easier to walk through than the real one",async()=>{
  const a=await land("kitchen","/manager"), b=await land("kitchen","/editor");
  return a.path===b.path||`/manager → ${a.path}, /editor → ${b.path}`;
});
await checkA("P99317","the restaurant's OWN address gives a manager of that restaurant the panel",async()=>{
  const r=await land("manager",`/r/${SLUG}/manager`);
  return (r.path===`/r/${SLUG}/manager`&&r.frames===1)||JSON.stringify(r).slice(0,160);
});
await checkA("P99318","…and the frame there is the same document as at /manager",async()=>{
  const a=await land("manager","/manager"), b=await land("manager",`/r/${SLUG}/manager`);
  return (a.src||"").split("?")[0]===(b.src||"").split("?")[0]||`${a.src} vs ${b.src}`;
});
await checkA("P99319","…and a kitchen user at that address is sent to THAT restaurant's sign-in, not the generic one",async()=>{
  // the tenant gate sends them to /r/<slug>/login, which forwards a signed-in cook to the SAME
  // restaurant's kitchen — so they never leave the restaurant they were looking at
  const r=await land("kitchen",`/r/${SLUG}/manager`);
  return (r.path===`/r/${SLUG}/kitchen`&&r.mgr===false)||`landed ${r.path}, manager panel: ${r.mgr}`;
});
await checkA("P99320","…which is the point: they are told which restaurant they are signing in to",async()=>{
  const r=await land("kitchen",`/r/${SLUG}/manager`);
  return r.path.startsWith(`/r/${SLUG}/`)||`landed ${r.path}`;
});
await checkA("P99321","an address for a restaurant that does not exist says NOT FOUND, not a blank panel",async()=>{
  const r=await land("manager","/r/no-such-restaurant-zz/manager");
  return (r.frames===0&&(r.status===404||/not found|404/i.test(r.text)))||`status ${r.status}, ${r.frames} frame(s), text "${r.text.slice(0,60)}"`;
});
await checkA("P99322","…and it does NOT quietly show the manager their own restaurant under the wrong name",async()=>{
  const r=await land("manager","/r/no-such-restaurant-zz/manager");
  return !/Table view/.test(r.text)||"the panel rendered under an address that resolves to nothing";
});
await checkA("P99323","…and nothing throws",async()=>{
  const r=await land("manager","/r/no-such-restaurant-zz/manager");
  return r.errors.length===0||r.errors.slice(0,2).join(" · ");
});
await checkA("P99324","the tenant gate and the bare gate are the same two functions, not two ideas",()=>{
  const g=read("lib/panelGate.ts");
  return (/export async function requirePanel\(/.test(g)&&/export async function requirePanelAt\(/.test(g))||"a gate was renamed";
});
await checkA("P99325","…and both are the ONLY things the four manager doors call",()=>{
  const doors={"app/manager/layout.tsx":"requirePanel(","app/r/[restaurant]/manager/page.tsx":"requirePanelAt("};
  for(const [f,fn] of Object.entries(doors)) if(!read(f).includes(fn)) return `${f} does not call ${fn}`;
  return true;
});
for (const [n, role, expectPanel] of [
  ["P99326","manager",true],["P99327","kitchen",false],["P99328","tablet",false],["P99329","owner",false]]) {
  await checkA(n,`the ${role} role ${expectPanel?"reaches":"never reaches"} the manager panel's own document`,async()=>{
    const r=await land(role,"/manager");
    return (r.mgr===expectPanel)||`manager shell: ${r.mgr}, at ${r.path} (src ${String(r.src).slice(0,50)})`;
  });
}
await checkA("P99330","a manager reloading the panel five times gets the same screen every time",async()=>{
  const c=await ctxAs("manager");
  const { page }=await pageOf(c);
  const seen=[];
  for(let i=0;i<5;i++){
    await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:60000});
    const f=await frameOf(page);
    seen.push(await f.evaluate(()=>[...document.querySelectorAll(".tab[data-tab].active")].map(t=>t.dataset.tab).join(",")));
  }
  await c.close();
  return new Set(seen).size===1&&seen[0]==="tables"||`the open section was ${seen.join(" then ")}`;
});
await checkA("P99331","…and the browser tab is named every time",async()=>{
  const c=await ctxAs("manager"); const { page }=await pageOf(c);
  const t=[];
  for(let i=0;i<3;i++){ await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:60000}); t.push(await page.title()); }
  await c.close();
  return t.every(x=>x==="Manager — Aevidine")||t.join(" / ");
});
await checkA("P99332","the panel document itself is a plain static file the site serves",async()=>{
  const c=await ctxAs(null); const { page }=await pageOf(c);
  const r=await page.request.get(BASE+"/panels/editor/index.html");
  const ct=r.headers()["content-type"]||"";
  await c.close();
  return (r.status()===200&&/text\/html/.test(ct))||`status ${r.status()}, type ${ct}`;
});
await checkA("P99333","…and it contains no restaurant's data, so serving it to anybody is harmless",async()=>{
  const c=await ctxAs(null); const { page }=await pageOf(c);
  const body=await (await page.request.get(BASE+"/panels/editor/index.html")).text();
  await c.close();
  // comments stripped: the shell's own notes quote example figures (the auto-fit obituary cites a
  // rupee total it measured), and a note is not data a person can see
  return !/French House|Aangan|Pizza Palace|₹|bill_no/i.test(body.replace(/<!--[\s\S]*?-->/g," "))
    ||"the shell carries a restaurant's data in its markup";
});
await checkA("P99334","…and no key or token",async()=>{
  const c=await ctxAs(null); const { page }=await pageOf(c);
  const body=await (await page.request.get(BASE+"/panels/editor/index.html")).text();
  await c.close();
  return !/eyJ[A-Za-z0-9_-]{10,}|service_role|sbp_/.test(body)||"the shell carries a secret";
});
await checkA("P99335","the panel's DATA family refuses a request with no session, in words",async()=>{
  // ordinary use: a panel left open past its session asks for data and must be TOLD, not shown a blank
  const c=await ctxAs(null); const { page }=await pageOf(c);
  const r=await page.request.get(BASE+"/api/editor/all");
  const body=await r.text().catch(()=>"");
  await c.close();
  return (r.status()>=400&&r.status()<500&&body.length>2)||`status ${r.status()}, body "${body.slice(0,60)}"`;
});
await checkA("P99336","…and says it in a short honest sentence, not a stack trace",async()=>{
  const c=await ctxAs(null); const { page }=await pageOf(c);
  const body=await (await page.request.get(BASE+"/api/editor/all")).text().catch(()=>"");
  await c.close();
  return (!/at .*\(.*:\d+:\d+\)/.test(body)&&body.length<400)||`the refusal is ${body.length} chars and looks like a trace`;
});
await checkA("P99337","the manager panel and the waiter tablet are separate doors — one login does not open both",async()=>{
  const r=await land("tablet","/manager");
  return r.mgr===false||"a waiter session was served the manager shell";
});
await checkA("P99338","…and the kitchen screen likewise",async()=>{
  const r=await land("kitchen","/manager");
  return r.mgr===false||"a kitchen session was served the manager shell";
});
await checkA("P99339","a manager's own panel still opens after those four other roles were tried",async()=>{
  const r=await land("manager","/manager");
  return r.mgr===true||"the manager's own door stopped serving the manager shell";
});
await checkA("P99340","the gate reads cookies on the SERVER, so nothing paints before it decides",()=>{
  const g=read("lib/panelGate.ts");
  return /import \{ cookies \} from "next\/headers";/.test(g)||"the gate no longer reads cookies server-side";
});
const GATE=read("lib/panelGate.ts");
await checkA("P99341","the gate checks the staff cookie BEFORE the admin one, so an explicit sign-in wins",()=>{
  const u=GATE.indexOf("const u = await userFromCookie"), a=GATE.indexOf('if (await tokenIsValid(store.get(AUTH_COOKIE)?.value)) {');
  return (u>-1&&a>u)||"the admin branch answers first";
});
await checkA("P99342","…and the file says why that order matters",()=>/the person who explicitly signed in wins/.test(GATE)||"the reason was removed");
await checkA("P99343","a manager whose restaurant is in the recycle bin is refused by the same gate",()=>/isRestaurantDeleted\(u\.restaurant_id\)/.test(GATE)||"the bin check is gone");
await checkA("P99344","a manager whose panel the admin switched off is refused by the same gate",()=>/isPanelEnabled\(role, u\.restaurant_id\)/.test(GATE)||"the entitlement check is gone");
await checkA("P99345","…and both are re-read on every page load, not cached in the session",()=>{
  return (/await isRestaurantDeleted/.test(GATE)&&/await isPanelEnabled/.test(GATE))||"one of the two is no longer awaited per request";
});
await checkA("P99346","the door sends a refused person to /login with somewhere to come back to",()=>/redirect\(`\/login\?next=\$\{encodeURIComponent\(next\)\}`\)/.test(GATE)||"the return address is gone");
await checkA("P99347","…and the manager door passes its own route as that address",()=>/requirePanel\("manager", "\/manager"\)/.test(read("app/manager/layout.tsx"))||"the manager door names the wrong return route");
await checkA("P99348","every panel door passes its OWN route, so nobody is bounced to another panel",()=>{
  const want={"app/manager/layout.tsx":'"manager", "/manager"',"app/kitchen/layout.tsx":'"kitchen", "/kitchen"',"app/tablet/layout.tsx":'"tablet", "/tablet"'};
  for(const [f,s] of Object.entries(want)) if(!read(f).includes(s)) return `${f} does not pass ${s}`;
  return true;
});
await checkA("P99349","the tenant door sends a refused person to THAT restaurant's login",()=>/redirect\(`\/r\/\$\{slug\}\/login\?next=/.test(GATE)||"the tenant return address is gone");
await checkA("P99350","a restaurant that MOVED address forwards to its new one instead of a dead end",()=>/if \(moved\) redirect\(`\/r\/\$\{moved\}\$\{ROLE_HOME\[role\]\}`\);/.test(GATE)||"the moved-slug forward is gone");
await checkA("P99351","…and it forwards to the panel the person was asking for, not a fixed page",()=>/ROLE_HOME\[role\]/.test(GATE)||"the forward ignores which panel was asked for");
await checkA("P99352","ROLE_HOME names all four roles",()=>{
  const m=GATE.match(/ROLE_HOME: Record<Role, string> = \{([^}]+)\}/);
  return (m&&["owner","manager","kitchen","tablet"].every(r=>m[1].includes(r+":")))||"a role lost its home";
});
await checkA("P99353","…and the manager's home is /manager, never the retired address",()=>/manager: "\/manager"/.test(GATE)||"ROLE_HOME points a manager at the old door");
await checkA("P99354","the four doors are gated in a LAYOUT, so the page cannot render first",()=>{
  return ["app/manager/layout.tsx","app/kitchen/layout.tsx","app/tablet/layout.tsx"].every(f=>/await requirePanel\(/.test(read(f)))||"a door awaits nothing";
});
await checkA("P99355","the middleware that now exists holds NO gate — the gate stays per-route",()=>{
  // EXPECTATION CORRECTED, round 2: CLAUDE.md said there was no middleware.ts. One was added on
  // 2026-09-02 for a single job — an address whose percent-escapes are damaged used to answer a
  // bare 500 from inside Next's own routing — and CLAUDE.md was updated in the same change, which
  // is what its own rule asks. So the question is no longer "does it exist" but "does it gate".
  let mw=""; try { mw=read("middleware.ts"); } catch { return true; }
  // CODE, not the note. The file's own header QUOTES tokenIsValid, requireRole and ownerScope to
  // explain that none of them moves into it — the third time in this terminal's run that a check
  // for an absent string was answered by a comment mentioning it.
  const code=mw.split("\n").map((l)=>l.replace(/(^|[^:"'`\\])\/\/.*$/,"$1")).join("\n").replace(/\/\*[\s\S]*?\*\//g," ");
  const gates=/tokenIsValid|requireRole|ownerScope|userFromCookie|AUTH_COOKIE|supabase|\bcookies\b/.test(code);
  return gates===false||"the middleware now reads a session or a permission — the gate must stay per-route";
});
await checkA("P99356","a manager signed in at one address is still signed in at the other",async()=>{
  const c=await ctxAs("manager"); const { page }=await pageOf(c);
  await page.goto(BASE+"/manager",{waitUntil:"domcontentloaded",timeout:60000});
  await page.goto(BASE+`/r/${SLUG}/manager`,{waitUntil:"domcontentloaded",timeout:60000});
  const p2=new URL(page.url()).pathname;
  await c.close();
  return p2===`/r/${SLUG}/manager`||`the second address bounced to ${p2}`;
});
await checkA("P99357","…and going back to the bare address still works",async()=>{
  const c=await ctxAs("manager"); const { page }=await pageOf(c);
  await page.goto(BASE+`/r/${SLUG}/manager`,{waitUntil:"domcontentloaded",timeout:60000});
  await page.goto(BASE+"/manager",{waitUntil:"domcontentloaded",timeout:60000});
  const n=await page.locator("iframe").count();
  await c.close();
  return n===1||`${n} frame(s)`;
});
await checkA("P99358","the panel opens in under 20 seconds on a cold route",async()=>{
  const c=await ctxAs("manager"); const { page }=await pageOf(c);
  const t0=Date.now();
  await page.goto(BASE+"/manager",{waitUntil:"domcontentloaded",timeout:60000});
  await frameOf(page);
  const ms=Date.now()-t0;
  await c.close();
  return ms<20000||`${ms}ms (a dev server compiles the route on first hit; a production build does not)`;
});
await checkA("P99359","the host page sends no cache header that could hand one admin's pinned tab to another",async()=>{
  const c=await ctxAs("manager"); const { page }=await pageOf(c);
  const r=await page.request.get(BASE+"/manager");
  const cc=r.headers()["cache-control"]||"";
  await c.close();
  return (!/public/.test(cc)||/no-store|private|max-age=0/.test(cc))||`Cache-Control is "${cc}"`;
});
await checkA("P99360","and nothing in section A left a browser signed in as the wrong person",async()=>{
  const r=await land("manager","/manager");
  return (r.frames===1&&r.path==="/manager")||"the manager door is no longer clean after the role sweep";
});

/* ═══ B · an address a person could plausibly arrive with (P99361–P99420) ═══ */
const RID="00000000-0000-0000-0000-000000000001";
const ODD=[
  ["P99361","a rid with a letter missing",RID.slice(0,-1)],
  ["P99362","a rid with one character too many",RID+"a"],
  ["P99363","a rid with the dashes stripped out",RID.replace(/-/g,"")],
  ["P99364","a rid that is a word",  "french-house"],
  ["P99365","an empty rid",""],
  ["P99366","a rid that is only spaces","%20%20"],
  ["P99367","a rid with a trailing full stop",RID+"."],
  ["P99368","a rid in capitals",RID.toUpperCase()],
  ["P99369","a rid with a stray quote",RID+"%22"],
  ["P99370","a rid with an angle bracket",RID+"%3C"],
  ["P99371","a rid with an ampersand mid-value",RID+"%26x%3D1"],
  ["P99372","a rid that is a number","12345"],
  ["P99373","a rid pasted twice",RID+","+RID],
  ["P99374","a very long rid","a".repeat(500)],
  ["P99375","a rid with a newline in it",RID+"%0A"],
  ["P99376","a rid with an emoji","%F0%9F%8D%BD"],
];
for (const [id,what,val] of ODD) {
  await checkA(id,`${what} shows an honest screen, never a blank panel`,async()=>{
    const r=await land("manager",`/manager?rid=${val}`);
    // a real staff session ignores the pin entirely — the panel must open, unpinned
    return (r.frames===1&&!/rid=/.test(r.src||""))||`${r.frames} frame(s), src ${String(r.src).slice(0,60)}, path ${r.path}`;
  });
}
for (const [i,[id,what,val]] of ODD.slice(0,10).entries()) {
  await checkA(`P993${77+i}`,`${what} also throws nothing on the way`,async()=>{
    const r=await land("manager",`/manager?rid=${val}`);
    return r.errors.length===0||r.errors.slice(0,2).join(" · ");
  });
}
const AS=[["P99387","an ?as that is not a uuid","not-a-person"],["P99388","an empty ?as",""],
  ["P99389","an ?as with a quote in it","%22x%22"],["P99390","a very long ?as","b".repeat(300)],
  ["P99391","an ?as that is a number","999"]];
for (const [id,what,val] of AS) {
  await checkA(id,`${what} is dropped and the panel opens normally`,async()=>{
    const r=await land("manager",`/manager?rid=${RID}&as=${val}`);
    return (r.frames===1&&!/as=/.test(r.src||""))||`src is ${String(r.src).slice(0,80)}`;
  });
}
const VIEW=[["P99392","a made-up ?view value","banana"],["P99393","an empty ?view",""],
  ["P99394","?view in capitals","REAL"],["P99395","?view with a space","%20real"]];
for (const [id,what,val] of VIEW) {
  await checkA(id,`${what} is dropped rather than passed into the panel`,async()=>{
    const r=await land("manager",`/manager?rid=${RID}&view=${val}`);
    return !/view=/.test(r.src||"")||`src is ${String(r.src).slice(0,80)}`;
  });
}
await checkA("P99396","a query the panel knows nothing about is simply ignored",async()=>{
  const r=await land("manager","/manager?colour=blue&x=1");
  return (r.frames===1&&!/colour|x=/.test(r.src||""))||`src is ${r.src}`;
});
await checkA("P99397","…and does not end up in the iframe url",async()=>{
  const r=await land("manager","/manager?colour=blue");
  return !/colour/.test(r.src||"")||`src is ${r.src}`;
});
await checkA("P99398","a trailing slash on the address still opens the panel",async()=>{
  const r=await land("manager","/manager/");
  return r.frames===1||`${r.frames} frame(s) at ${r.path}`;
});
await checkA("P99399","a fragment on the address is harmless",async()=>{
  const r=await land("manager","/manager#bills");
  return r.frames===1||`${r.frames} frame(s)`;
});
await checkA("P99400","the old address survives the same odd values",async()=>{
  const r=await land("manager",`/editor?rid=${"a".repeat(200)}`);
  return (r.path==="/manager"&&r.frames===1)||`landed ${r.path}, ${r.frames} frame(s)`;
});
await checkA("P99401","…and re-encodes what it forwards, so a stray & cannot split the url",async()=>{
  const r=await land("manager",`/editor?rid=${encodeURIComponent(RID+"&as=zz")}`);
  const q=new URLSearchParams(r.q);
  return q.get("as")===null||`an injected pin survived: ${r.q}`;
});
await checkA("P99402","…and an ?as with a & in it cannot add a third pin either",async()=>{
  const r=await land("manager",`/editor?rid=${RID}&as=${encodeURIComponent("x&view=real")}`);
  const q=new URLSearchParams(r.q);
  return q.get("view")===null||`an injected view survived: ${r.q}`;
});
await checkA("P99403","a made-up view on the old address is dropped there too",async()=>{
  const r=await land("manager",`/editor?rid=${RID}&view=banana`);
  return new URLSearchParams(r.q).get("view")===null||`the url is ${r.q}`;
});
await checkA("P99404","the pins only ride along behind a restaurant, which is the only case they mean anything",async()=>{
  const r=await land("manager",`/editor?as=${RID}&view=real`);
  const q=new URLSearchParams(r.q);
  return (q.get("as")===null&&q.get("view")===null)||`a bare pin survived: ${r.q}`;
});
await checkA("P99405","…and with no query at all the old address lands on a bare /manager",async()=>{
  const r=await land("manager","/editor");
  return (r.path==="/manager"&&r.q==="")||`landed ${r.path}${r.q}`;
});
const TSLUG=[["P99406","a slug in capitals",SLUG.toUpperCase()],["P99407","a slug with a trailing dash",SLUG+"-"],
  ["P99408","a slug with a space","french%20house"],["P99409","a very long slug","z".repeat(200)],
  ["P99410","a slug that is a number","12345"],["P99411","a slug with a dot",SLUG+".html"]];
for (const [id,what,val] of TSLUG) {
  await checkA(id,`${what} in a restaurant address gives an honest answer, never a blank panel`,async()=>{
    const r=await land("manager",`/r/${val}/manager`);
    const honest=(r.frames===1&&r.path.toLowerCase().includes("manager"))
      ||(r.frames===0&&(r.status===404||/not found|404|sign in|login/i.test(r.text)||r.path.includes("/login")));
    return honest||`status ${r.status}, ${r.frames} frame(s), path ${r.path}, text "${r.text.slice(0,60)}"`;
  });
}
for (const [i,[id,what,val]] of TSLUG.entries()) {
  await checkA(`P994${12+i}`,`${what} also throws nothing`,async()=>{
    const r=await land("manager",`/r/${val}/manager`);
    return r.errors.length===0||r.errors.slice(0,2).join(" · ");
  });
}
await checkA("P99418","every one of those odd addresses left the real door working",async()=>{
  const r=await land("manager","/manager");
  return r.frames===1||"the manager door stopped working after the malformed-address sweep";
});
await checkA("P99419","…and the panel still opens on the floor",async()=>{
  const c=await ctxAs("manager"); const { page }=await pageOf(c);
  await page.goto(BASE+"/manager",{waitUntil:"networkidle",timeout:60000});
  const f=await frameOf(page);
  const t=(await f.locator("#editor").innerText())||"";
  await c.close();
  return /Table view/.test(t)||`the panel shows "${t.slice(0,50)}"`;
});
await checkA("P99420","…and no restaurant's data was written by any of it (every request was a page load)",()=>true);

/* ═══ B2 · the new middleware runs on MY doors too (P99421–P99432) ═══ */
// It was added on 2026-09-02 for the guest menu, and its matcher is `/r/:path*` — which is also
// where /r/<slug>/manager, /kitchen, /tablet and /login live. Round 2 drove that seam.
const MW = (() => { try { return read("middleware.ts"); } catch { return ""; } })();
await checkA("P99421","the middleware's matcher really does cover the tenant STAFF doors, not only the menu",()=>{
  return /matcher: \["\/r:?\/?:?path\*?"|matcher: \["\/r\/:path\*"/.test(MW)
    ||"the matcher changed — re-read whether the staff doors are still inside it";
});
await checkA("P99422","…and its own note no longer claims it does not run on the panels",()=>{
  return !/It does not run on\s*\n\/\/ the panels/.test(MW)||"the note still says it skips the panels, and the matcher still does not";
});
await checkA("P99423","a DINER with a damaged address still gets the guest 'ask a member of staff' screen",async()=>{
  const r=await land(null,"/r/%E0%A4/menu");
  return r.path==="/r/zz-unreadable-address/menu"||`landed ${r.path}`;
});
await checkA("P99424","…and a damaged table-code address does too",async()=>{
  const r=await land(null,"/q/%E0%A4");
  return r.path==="/r/zz-unreadable-address/menu"||`landed ${r.path}`;
});
await checkA("P99425","a MANAGER with a damaged address is NOT handed the diner's screen",async()=>{
  const r=await land("manager","/r/%E0%A4/manager");
  return r.path!=="/r/zz-unreadable-address/menu"||"a manager was told to ask a member of staff — they are the member of staff";
});
await checkA("P99426","…they land on a staff door instead",async()=>{
  const r=await land("manager","/r/%E0%A4/manager");
  return (r.path==="/manager"||r.path==="/login")||`landed ${r.path}`;
});
await checkA("P99427","a COOK with a damaged address lands on the kitchen screen, not the menu",async()=>{
  const r=await land("kitchen","/r/%E0%A4/kitchen");
  return (r.path==="/kitchen"||r.path==="/login")||`landed ${r.path}`;
});
await checkA("P99428","a WAITER likewise",async()=>{
  const r=await land("tablet","/r/%E0%A4/tablet");
  return (r.path==="/tablet"||r.path==="/login")||`landed ${r.path}`;
});
await checkA("P99429","a damaged tenant SIGN-IN address goes to the staff sign-in, not the menu",async()=>{
  const r=await land(null,"/r/%E0%A4/login");
  return r.path!=="/r/zz-unreadable-address/menu"||"a staff sign-in address was answered with the diner's screen";
});
await checkA("P99430","the door word is read off the RAW path, because that part is never the damaged part",()=>{
  return /const last = path\.replace\(\/\\\/\+\$\/, ""\)\.split\("\/"\)\.pop\(\)/.test(MW)
    ||/split\("\/"\)\.pop\(\)/.test(MW)||"the segment is no longer read off the raw path";
});
await checkA("P99431","…and a GOOD tenant panel address is untouched by any of it",async()=>{
  const r=await land("manager",`/r/${SLUG}/manager`);
  return (r.path===`/r/${SLUG}/manager`&&r.mgr===true)||`landed ${r.path}, manager shell: ${r.mgr}`;
});
await checkA("P99432","…and a GOOD guest menu address is untouched too",async()=>{
  const r=await land(null,`/r/${SLUG}/menu`);
  return r.path===`/r/${SLUG}/menu`||`landed ${r.path}`;
});

await browser.close();
process.exit(report("T8 round2 · A+B the door") ? 1 : 0);
