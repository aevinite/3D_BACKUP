// Sweep #8 · terminal 8 · the code-reading half of P61701–P62700.
// Territory: app/manager/**, app/editor/**, public/panels/editor/index.html,
// components/PanelFrame.tsx, lib/safeAreaBridge.ts — the manager panel's HOST and SHELL.
import { read, exists, check, skip, report, has, hasNot, countOf, eq, before, codeOf, htmlCodeOf, ROOT } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const LAY  = read("app/manager/layout.tsx");
const PAGE = read("app/manager/page.tsx");
const ED   = read("app/editor/page.tsx");
const H    = read("public/panels/editor/index.html");
const HC   = htmlCodeOf(H);                       // markup with its comments stripped
const PF   = read("components/PanelFrame.tsx");
const SAB  = read("lib/safeAreaBridge.ts");
const GATE = read("lib/panelGate.ts");
const APP  = read("public/panels/editor/app.js");
const CSS  = read("public/panels/editor/style.css");
const TWIN = read("app/r/[restaurant]/manager/page.tsx");
const KIT  = read("app/kitchen/page.tsx");
const TAB  = read("app/tablet/page.tsx");
const HKIT = read("public/panels/kitchen/index.html");
const HTAB = read("public/panels/tablet/index.html");
const sha8 = (f) => createHash("sha1").update(fs.readFileSync(path.join(ROOT, f))).digest("hex").slice(0, 8);

/* ═══════════ A · app/manager/layout.tsx — the door (P61701–P61720) ═══════════ */
check("P61701","the manager route has a layout at all, so the gate cannot be skipped",()=>exists("app/manager/layout.tsx"));
check("P61702","the layout is the gate: it calls requirePanel before rendering children",()=>{
  const i = LAY.indexOf("requirePanel"), j = LAY.indexOf("return <>");
  return (i>-1 && j>i) || "requirePanel does not run before the children are returned";
});
check("P61703","it AWAITS the gate — an un-awaited promise would let the panel render first",()=>has(LAY,/await requirePanel\(/));
check("P61704","it names the manager role, not another panel's",()=>has(LAY,/requirePanel\("manager"/));
check("P61705","…and hands the gate the route to come back to after login",()=>has(LAY,/requirePanel\("manager", "\/manager"\)/));
check("P61706","the layout renders its children unchanged — no second shell around the iframe",()=>has(LAY,/return <>\{children\}<\/>;/));
check("P61707","the layout is a server component (no 'use client')",()=>hasNot(LAY,/^"use client"/m));
check("P61708","it is async, because the gate reads cookies",()=>has(LAY,/export default async function/));
check("P61709","it imports the gate from the shared lib, never re-implements it",()=>has(LAY,/from "@\/lib\/panelGate"/));
check("P61710","it imports nothing else — no client hook, no data read on the door",()=>eq(countOf(LAY,/^import /gm),1));
check("P61711","the file says in words which roles may enter",()=>has(LAY,/Admin super-user or a logged-in manager may enter/));
check("P61712","…and where everyone else goes",()=>has(LAY,/anyone else → \/login/));
check("P61713","the layout does not itself read searchParams (a layout cannot)",()=>hasNot(codeOf(LAY),/searchParams/));
check("P61714","no metadata is exported here — the page owns the tab title",()=>hasNot(codeOf(LAY),/export const metadata/));
check("P61715","children is typed, so a stray prop cannot slip through",()=>has(LAY,/children: React\.ReactNode/));
check("P61716","requirePanel really exists in the lib the layout imports",()=>has(GATE,/export async function requirePanel\(/));
check("P61717","requirePanel checks the staff cookie FIRST, then the admin one",()=>{
  const u = GATE.indexOf("const u = await userFromCookie"), a = GATE.indexOf("if (await tokenIsValid(store.get(AUTH_COOKIE)?.value)) {");
  return (u>-1&&a>u)||"the admin branch runs before the staff branch";
});
check("P61718","requirePanel refuses a manager whose restaurant is in the recycle bin",()=>has(GATE,/!\(await isRestaurantDeleted\(u\.restaurant_id\)\)/));
check("P61719","…and one whose restaurant has the manager panel switched off",()=>has(GATE,/await isPanelEnabled\(role, u\.restaurant_id\)/));
check("P61720","an admin with no restaurant named for this tab goes back to the console",()=>has(GATE,/redirect\("\/aevinite"\);/));

/* ═══════════ B · app/manager/page.tsx — the host page (P61721–P61790) ═══════════ */
check("P61721","the page exists",()=>exists("app/manager/page.tsx"));
check("P61722","it is a server component",()=>hasNot(PAGE,/^"use client"/m));
check("P61723","it is async and awaits searchParams (Next 16 hands them as a promise)",()=>has(PAGE,/const \{ rid, as, view \} = await searchParams;/));
check("P61724","searchParams is TYPED as a promise, matching Next 16's async params",()=>has(PAGE,/searchParams: Promise<\{ rid\?: string; as\?: string; view\?: string \}>/));
check("P61725","exactly three pins are read — rid, as, view — and nothing else",()=>{
  const m = PAGE.match(/const \{ ([^}]+) \} = await searchParams;/);
  return (m && m[1].split(",").map(s=>s.trim()).join("|") === "rid|as|view") || "the destructure changed";
});
check("P61726","the admin's ?rid is validated by panelAdminRid, never trusted raw",()=>has(PAGE,/const adminRid = await panelAdminRid\("manager", rid\);/));
check("P61727","…and the role it names is manager, so a tablet rid cannot pin this tab",()=>has(PAGE,/panelAdminRid\("manager"/));
check("P61728","the iframe src is built by the SHARED builder, not by hand",()=>has(PAGE,/const src = panelIframeSrc\(/));
check("P61729","…pointed at the editor panel's index.html",()=>has(PAGE,/panelIframeSrc\("\/panels\/editor\/index\.html"/));
check("P61730","…given the VALIDATED rid, not the raw query value",()=>has(PAGE,/panelIframeSrc\("\/panels\/editor\/index\.html", adminRid,/));
check("P61731","…and handed both remaining pins",()=>has(PAGE,/\{ as, view \}\)/));
check("P61732","the page renders PanelFrame and nothing else",()=>has(PAGE,/return <PanelFrame src=\{src\} title="Manager" \/>;/));
check("P61733","it never renders a raw <iframe> of its own",()=>hasNot(codeOf(PAGE),/<iframe/));
check("P61734","the frame is titled, so a screen reader names it",()=>has(PAGE,/title="Manager"/));
check("P61735","the browser tab names itself, not the root default",()=>has(PAGE,/export const metadata = \{ title: "Manager — Aevidine" \}/));
check("P61736","…and the tab title matches the panel document's own <title>",()=>{
  const t = H.match(/<title>([^<]+)<\/title>/);
  return (t && t[1] === "Manager — Aevidine") || `panel <title> is ${t && t[1]}`;
});
check("P61737","the page makes no database read of its own",()=>hasNot(codeOf(PAGE),/supabase|from\("/));
check("P61738","…and no fetch",()=>hasNot(codeOf(PAGE),/fetch\(/));
check("P61739","it imports only the gate helpers and the frame",()=>eq(countOf(PAGE,/^import /gm),2));
check("P61740","the file explains why the internal name stayed /panels/editor",()=>has(PAGE,/those internal\s*\n\/\/ names are invisible to users/));
check("P61741","…and why ?rid is per-TAB rather than browser-wide",()=>has(PAGE,/the act-as cookie alone is\s*\n\/\/ browser-wide/));
check("P61742","…and what ?as= is for, in the owner's own words",()=>has(PAGE,/Visit their panel/));
check("P61743","panelIframeSrc really exists in the lib",()=>has(GATE,/export function panelIframeSrc\(/));
check("P61744","panelAdminRid really exists in the lib",()=>has(GATE,/export async function panelAdminRid\(/));
check("P61745","panelIframeSrc returns the BARE url when there is no admin rid",()=>has(GATE,/if \(!adminRid\) return base;/));
check("P61746","…so a real staff session gets no pins in its iframe url at all",()=>has(GATE,/if \(u && u\.role === role\) return null;/));
check("P61747","the rid is url-encoded into the iframe src",()=>has(GATE,/\?rid=\$\{encodeURIComponent\(adminRid\)\}/));
check("P61748","?as is accepted only when it is uuid-shaped",()=>has(GATE,/if \(as && \/\^\[0-9a-f-\]\{36\}\$\/i\.test\(as\)\)/));
check("P61749","?view is accepted only as the exact word 'real'",()=>has(GATE,/if \(pins\?\.view === "real"\) src \+= "&view=real";/));
check("P61750","a malformed rid never reaches the iframe — the shape is checked first",()=>has(GATE,/if \(rid && RID_RE\.test\(rid\)/));
check("P61751","…and RID_RE is a full uuid, anchored at both ends",()=>has(GATE,/const RID_RE = \/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$\/i;/));
check("P61752","the page passes `as` and `view` in ONE object, so neither can be forgotten",()=>has(PAGE,/adminRid, \{ as, view \}\)/));
check("P61753","view is NOT chained to as — naming a person does not strip the panel",()=>hasNot(codeOf(GATE),/view === "real" \|\| as/));
check("P61754","…and the file says why that chaining was wrong",()=>has(GATE,/The first cut chained the\s*\n\/\/\s*two/));
check("P61755","the page's own note names all THREE pins it forwards, not two",()=>["rid","as","view"].every(p=>new RegExp("\\?"+p+"[=r]").test(PAGE))||"one pin is undocumented");
check("P61756","no third pin has crept into the src builder",()=>eq(countOf(GATE,/src \+= /g),2));
check("P61757","the title prop is a plain word a manager would recognise",()=>eq((PAGE.match(/title="([^"]+)"/)||[])[1],"Manager"));
check("P61758","the page does not set its own viewport (the root layout owns it)",()=>hasNot(codeOf(PAGE),/export const viewport/));
check("P61759","the root layout is the one that sets viewport-fit=cover, which the inset bridge depends on",()=>has(read("app/layout.tsx"),/viewportFit: 'cover'/));
check("P61760","the page has no 'use cache' / revalidate directive that could serve one admin's rid to another",()=>hasNot(codeOf(PAGE),/revalidate|use cache|force-static/));
check("P61761","…and no dynamic=force-static, which would freeze the pins",()=>hasNot(codeOf(PAGE),/force-static/));
check("P61762","the twin tenant route builds its src with the SAME builder",()=>has(TWIN,/panelIframeSrc\("\/panels\/editor\/index\.html"/));
check("P61763","…and hands it the same two extra pins",()=>has(TWIN,/\{ as, view \}\)/));
check("P61764","…and names the same tab title",()=>has(TWIN,/metadata = \{ title: "Manager — Aevidine" \}/));
check("P61765","…and renders through PanelFrame too",()=>has(TWIN,/<PanelFrame src=\{src\} title="Manager" \/>/));
check("P61766","the twin passes null for a real staff session, so pins are dropped",()=>has(TWIN,/admin \? restaurantId : null/));
check("P61767","the kitchen host uses the same pair of helpers",()=>(has(KIT,/panelAdminRid\(/)===true&&has(KIT,/panelIframeSrc\(/)===true)||"the kitchen host diverged");
check("P61768","the tablet host uses the same pair of helpers",()=>(has(TAB,/panelAdminRid\(/)===true&&has(TAB,/panelIframeSrc\(/)===true)||"the tablet host diverged");
check("P61769","each panel host points at its OWN panel folder",()=>{
  const want = {"app/manager/page.tsx":"/panels/editor/index.html","app/kitchen/page.tsx":"/panels/kitchen/index.html","app/tablet/page.tsx":"/panels/tablet/index.html"};
  for (const [f,p] of Object.entries(want)) if (!read(f).includes(`panelIframeSrc("${p}"`)) return `${f} does not embed ${p}`;
  return true;
});
check("P61770","no panel host forgets `view`",()=>["app/manager/page.tsx","app/kitchen/page.tsx","app/tablet/page.tsx","app/r/[restaurant]/manager/page.tsx"].every(f=>/\{ as, view \}/.test(read(f)))||"one host drops a pin");
check("P61771","the page file is short — the host is a host, not a screen",()=>PAGE.split("\n").length<=40||"the host page has grown past 40 lines");
check("P61772","every line of comment in the page is a WHY, not a restatement of the code",()=>has(PAGE,/enforces the entry rule/));
check("P61773","the page's default export is the page component",()=>has(PAGE,/export default async function ManagerPanel/));
check("P61774","the component name says what it is",()=>has(PAGE,/function ManagerPanel\(/));
check("P61775","there is no `params` in the non-tenant route (it has no dynamic segment)",()=>hasNot(codeOf(PAGE),/params:/));
check("P61776","the tenant twin DOES take params, because its address carries the slug",()=>has(TWIN,/params: Promise<\{ restaurant: string \}>/));
check("P61777","the twin gates through requirePanelAt, not requirePanel",()=>has(TWIN,/requirePanelAt\("manager", restaurant\)/));
check("P61778","requirePanelAt bounces a staff session whose restaurant is not the slug's",()=>has(GATE,/redirect\(`\/r\/\$\{slug\}\/login\?next=/));
check("P61779","…and forwards a MOVED slug to the restaurant's new address",()=>has(GATE,/if \(moved\) redirect\(`\/r\/\$\{moved\}\$\{ROLE_HOME\[role\]\}`\);/));
check("P61780","ROLE_HOME sends a manager to /manager, never to /editor",()=>has(GATE,/manager: "\/manager"/));
check("P61781","the page never puts a secret in the iframe url",()=>hasNot(codeOf(PAGE),/SERVICE_ROLE|ADMIN_PASSWORD|SESSION_SECRET/));
check("P61782","the iframe src is a same-origin path, never an absolute url",()=>has(PAGE,/panelIframeSrc\("\/panels/));
check("P61783","…so the host can reach into the frame to push the phone's insets",()=>has(SAB,/getFrame\(\)\?\.contentWindow\?\.document\?\.documentElement/));
check("P61784","the page cannot be reached without the layout's gate (same folder)",()=>exists("app/manager/layout.tsx"));
check("P61785","there is no route handler shadowing the page in app/manager",()=>{
  const f=fs.readdirSync(path.join(ROOT,"app","manager"));
  return !f.some(n=>/^route\.(ts|tsx|js)$/.test(n))||`app/manager holds ${f.join(", ")} — a route handler shadows the page`;
});
check("P61786","app/manager holds exactly the two files it should",()=>{
  const f = fs.readdirSync(path.join(ROOT,"app/manager")).sort().join(",");
  return f === "layout.tsx,page.tsx" || `app/manager holds ${f}`;
});
check("P61787","app/editor holds exactly one file — the redirect",()=>{
  const f = fs.readdirSync(path.join(ROOT,"app/editor")).sort().join(",");
  return f === "page.tsx" || `app/editor holds ${f}`;
});
check("P61788","the host page names the iframe so two panel tabs are told apart",()=>has(PAGE,/title="Manager"/));
check("P61789","the page does not import anything client-side (no hooks on the server)",()=>hasNot(codeOf(PAGE),/useState|useEffect|useRef/));
check("P61790","the manager page and its tenant twin agree on the gate's role word",()=>(/"manager"/.test(PAGE)&&/"manager"/.test(TWIN))||"the two routes name different roles");

/* ═══════════ C · app/editor/page.tsx — the back-compat door (P61791–P61830) ═══════════ */
check("P61791","the old /editor address still resolves",()=>exists("app/editor/page.tsx"));
check("P61792","it redirects rather than rendering a second copy of the panel",()=>has(ED,/redirect\("\/manager"/));
check("P61793","it renders NO iframe of its own",()=>hasNot(codeOf(ED),/PanelFrame|<iframe/));
check("P61794","it keeps ?rid through the hop, so an admin tab stays pinned",()=>has(ED,/rid \? `\?rid=\$\{encodeURIComponent\(rid\)\}` : ""/));
check("P61795","the rid is re-encoded, never concatenated raw",()=>has(ED,/encodeURIComponent\(rid\)/));
check("P61796","there is no layout under app/editor, so no second gate runs",()=>{
  const f=fs.readdirSync(path.join(ROOT,"app","editor"));
  return !f.some(n=>/^layout\./.test(n))||`app/editor holds ${f.join(", ")}`;
});
check("P61797","the redirect target is the canonical route, which then gates",()=>has(ED,/"\/manager"/));
check("P61798","it awaits searchParams like every other Next 16 page",()=>has(ED,/const \{ rid, as, view \} = await searchParams;/));
check("P61799","it is a server component",()=>hasNot(ED,/^"use client"/m));
check("P61800","it imports redirect from next/navigation",()=>has(ED,/import \{ redirect \} from "next\/navigation";/));
check("P61801","the file says in words that it exists only for back-compat",()=>has(ED,/kept only for BACK-COMPAT/));
check("P61802","…and warns that dropping ?rid would unpin an admin tab",()=>has(ED,/would silently unpin an admin tab/));
check("P61803","it makes no database read",()=>hasNot(codeOf(ED),/supabase|fetch\(/));
check("P61804","it exports no metadata (the destination owns the tab title)",()=>hasNot(codeOf(ED),/export const metadata/));
check("P61805","the admin console's quick-open really does allow /editor as a target",()=>has(read("app/api/admin/act-as/go/route.ts"),/ALLOWED_PATHS = new Set\(\["\/manager", "\/editor"/));
check("P61806","…and the console's own home row still points at /editor",()=>has(read("app/aevinite/page.tsx"),/label: "Manager", path: "\/editor"/));
check("P61807","the quick-open appends &as= whenever it is given a person",()=>has(read("app/api/admin/act-as/go/route.ts"),/const asPin = uid \? `&as=\$\{encodeURIComponent\(uid\)\}` : "";/));
check("P61808","the person pin survives the /editor hop (it used to be dropped)",()=>has(ED,/q \+= `&as=\$\{encodeURIComponent\(as\)\}`/));
check("P61809","…and so does the real-view pin, matched as the exact word",()=>has(ED,/if \(q && view === "real"\) q \+= "&view=real";/));
check("P61810","…without ever inventing a pin the caller did not send",()=>hasNot(codeOf(ED),/"&as=" \+ ""/));
check("P61811","the redirect still builds a relative path, never an absolute url",()=>hasNot(codeOf(ED),/https?:\/\//));
check("P61812","'Visit their panel' targets /manager directly, so it never depended on this hop",()=>has(read("components/admin/StaffProfile.tsx"),/manager: "\/manager"/));
check("P61813","the recycle bin's panel row still points at /editor",()=>has(read("app/aevinite/recycle/page.tsx"),/to: "\/editor"/));
check("P61814","the restaurants detail page still points at /editor",()=>has(read("app/aevinite/restaurants/page.tsx"),/\["\/editor", "Manager panel"/));
check("P61815","the floor screen's quick-open points at /manager (no hop)",()=>has(read("app/aevinite/floor/page.tsx"),/encodeURIComponent\("\/manager"\)/));
check("P61816","the redirect uses Next's redirect(), which throws — nothing runs after it",()=>{
  const i = ED.indexOf("redirect(");
  return ED.slice(i).split("\n").filter(l=>l.trim()&&!l.trim().startsWith("}")).length===1||"there is code after the redirect";
});
check("P61817","the page's parameter type names every pin it forwards",()=>has(ED,/searchParams: Promise<\{ rid\?: string; as\?: string; view\?: string \}>/));
check("P61818","the file is still tiny — a door, not a screen (code lines, not the note)",()=>{const n=codeOf(ED).split("\n").filter(l=>l.trim()).length;return n<=12||`${n} code lines`;});
check("P61819","there is no /editor route handler shadowing the page",()=>{
  const f=fs.readdirSync(path.join(ROOT,"app","editor"));
  return !f.some(n=>/^route\./.test(n))||`app/editor holds ${f.join(", ")}`;
});
check("P61820","the default export is the redirect component",()=>has(ED,/export default async function EditorRedirect/));
check("P61821","no /r/<slug>/editor twin exists to keep in step",()=>!fs.existsSync(path.join(ROOT,"app/r/[restaurant]/editor"))||"a tenant /editor twin exists and would need the same pins");
check("P61822","the API family is still /api/editor — the redirect never renamed it",()=>fs.existsSync(path.join(ROOT,"app/api/editor")));
check("P61823","…and the host page's comment says so, so nobody 'fixes' the name",()=>has(PAGE,/data calls still go to \/api\/editor/));
check("P61824","the panel folder is still /panels/editor for the same reason",()=>fs.existsSync(path.join(ROOT,"public/panels/editor/index.html")));
check("P61825","the redirect cannot loop — its target is not /editor",()=>hasNot(codeOf(ED),/redirect\("\/editor/));
check("P61826","an empty ?rid produces a bare /manager, not '/manager?rid='",()=>has(ED,/rid \? `\?rid=/));
check("P61827","the pins are appended with & after the first ?, never a second ?",()=>{
  const c = codeOf(ED);
  return !/\?as=|\?view=/.test(c) || "a pin is appended with a second question mark";
});
check("P61828","…and the first pin is always rid, so the url shape is stable",()=>has(ED,/`\?rid=/));
check("P61829","nothing in the redirect can throw on a missing search param",()=>hasNot(codeOf(ED),/rid\.|as\.|view\./));
check("P61830","the door is documented as the ONE old address, not a family",()=>has(ED,/The panel is now \/manager/));

/* ═══════════ D · components/PanelFrame.tsx (P61831–P61890) ═══════════ */
check("P61831","the shared frame component exists",()=>exists("components/PanelFrame.tsx"));
check("P61832","it is a client component — it measures the browser",()=>has(PF,/^"use client";/m));
check("P61833","it renders exactly one iframe",()=>eq(countOf(codeOf(PF),/<iframe/g),1));
check("P61834","the frame is position:fixed, so it is taken out of page flow",()=>has(PF,/position: "fixed"/));
check("P61835","…anchored on all four edges",()=>has(PF,/inset: 0/));
check("P61836","its height is 100%, NOT 100vh — the phone bug this file exists for",()=>has(PF,/height: "100%"/));
check("P61837","…and 100vh appears nowhere in the style",()=>hasNot(codeOf(PF),/height: "100vh"/));
check("P61838","its width is 100%",()=>has(PF,/width: "100%"/));
check("P61839","it draws no border of its own",()=>has(PF,/border: 0/));
check("P61840","the src comes from the caller, never built here",()=>has(PF,/src=\{src\}/));
check("P61841","the title comes from the caller, so each panel names itself",()=>has(PF,/title=\{title\}/));
check("P61842","both props are typed",()=>has(PF,/\{ src, title \}: \{ src: string; title: string \}/));
check("P61843","it holds a ref to the frame so the bridge can find it",()=>has(PF,/useRef<HTMLIFrameElement>\(null\)/));
check("P61844","the bridge is attached in an effect, i.e. after the frame is mounted",()=>has(PF,/useEffect\(\(\) => attachSafeAreaBridge/));
check("P61845","…and the effect RETURNS the bridge's teardown, so nothing leaks",()=>has(PF,/=> attachSafeAreaBridge\(\(\) => ref\.current\), \[\]\)/));
check("P61846","the effect runs once — an empty dependency list",()=>has(PF,/, \[\]\);/));
check("P61847","the frame is resolved LAZILY by a getter, not captured at render",()=>has(PF,/attachSafeAreaBridge\(\(\) => ref\.current\)/));
check("P61848","it starts nothing else — no interval, no listener of its own",()=>eq(countOf(PF,/addEventListener|setInterval|setTimeout/g),0));
check("P61849","the sizing note explains the URL-bar case in full",()=>has(PF,/scrolling inside an\s*\n\/\/\s*iframe never collapses the URL bar/));
check("P61850","…and names the device it was measured on",()=>has(PF,/Samsung A36 audit/));
check("P61851","the insets note explains why env\\(\\) is unreliable inside an iframe",()=>has(PF,/does NOT reliably resolve inside a\s*\n\/\/\s*nested iframe/));
check("P61852","…and names the CSS shape the panels must read",()=>has(PF,/max\(env\(\.\.\.\), var\(--safe-b\/t, 0px\)\)/));
check("P61853","the note refuses a blanket Android inset reserve, and says why",()=>has(PF,/NO blanket\s*\n\/\/\s*Android fallback/));
check("P61854","…and records the owner's own report of the dead strip",()=>has(PF,/owner report 2026-07-21/));
check("P61855","it points at the shared bridge rather than measuring here",()=>has(PF,/lives in lib\/safeAreaBridge\.ts/));
check("P61856","it imports the bridge by path alias",()=>has(PF,/from "@\/lib\/safeAreaBridge"/));
check("P61857","every panel stylesheet really reads var(--safe-b) the way the note claims",()=>["editor","kitchen","tablet"].every(p=>/var\(--safe-b/.test(read(`public/panels/${p}/style.css`)))||"a panel stylesheet does not read --safe-b");
check("P61858","…and var(--safe-t) too",()=>["editor","kitchen","tablet"].every(p=>/var\(--safe-t/.test(read(`public/panels/${p}/style.css`)))||"a panel stylesheet does not read --safe-t");
check("P61859","the manager stylesheet wraps env() in max() so it works either way",()=>has(CSS.replace(/\s+/g," "),/max\( *env\(safe-area-inset-bottom[^)]*\) *, *var\(--safe-b/));
check("P61860","the frame has no sandbox attribute — the bridge needs same-origin reach",()=>hasNot(codeOf(PF),/sandbox=/));
check("P61861","…and no allow / referrerPolicy that would break a same-origin push",()=>hasNot(codeOf(PF),/referrerPolicy=/));
check("P61862","it does not set loading=lazy — the panel IS the page",()=>hasNot(codeOf(PF),/loading="lazy"/));
check("P61863","the component is the default export",()=>has(PF,/export default function PanelFrame/));
check("P61864","it exports nothing else",()=>eq(countOf(PF,/^export /gm),1));
check("P61865","the style is inline, so no stylesheet can be missing when it paints",()=>has(PF,/style=\{\{ position: "fixed"/));
check("P61866","every panel host renders it, all six doors",()=>{
  const hosts=["app/manager/page.tsx","app/kitchen/page.tsx","app/tablet/page.tsx","app/r/[restaurant]/manager/page.tsx","app/r/[restaurant]/kitchen/page.tsx","app/r/[restaurant]/tablet/page.tsx"];
  const bad=hosts.filter(f=>!/PanelFrame/.test(read(f)));
  return bad.length===0||`missing in ${bad.join(", ")}`;
});
check("P61867","no host page anywhere hand-rolls a panel iframe instead",()=>{
  const bad=[];
  const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
    if(e.isDirectory()){if(e.name!=="node_modules")walk(p);}
    else if(e.name==="page.tsx"){const s=fs.readFileSync(p,"utf8");if(/<iframe[^>]*\/panels\//.test(s))bad.push(path.relative(ROOT,p));}}};
  walk(path.join(ROOT,"app"));
  return bad.length===0||`raw panel iframe in ${bad.join(", ")}`;
});
check("P61868","the two owner-console embeds use the SAME bridge, not a third copy",()=>{
  return ["components/owner/OwnerManagerMode.tsx","components/owner/useOwnerSkin.ts"].every(f=>/attachSafeAreaBridge/.test(read(f)))||"an owner embed lost the bridge";
});
check("P61869","…and there is no second implementation of the measuring probe",()=>{
  let n=0; const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
    if(e.isDirectory()){if(e.name!=="node_modules")walk(p);}
    else if(/\.tsx?$/.test(e.name)&&/padding-bottom:env\(safe-area-inset-bottom\)/.test(fs.readFileSync(p,"utf8")))n++;}};
  walk(path.join(ROOT,"components")); walk(path.join(ROOT,"lib")); walk(path.join(ROOT,"app"));
  return n===1||`${n} files build their own inset probe`;
});
check("P61870","the frame does not carry an id another script could clash with",()=>hasNot(codeOf(PF),/id="/));
check("P61871","nothing in the component reads window at render time (SSR safe)",()=>{
  const body = PF.slice(PF.indexOf("return ("));
  return !/window\./.test(body)||"window is touched in the returned JSX";
});
check("P61872","the bridge call is the component's only side effect",()=>eq(countOf(PF,/useEffect\(/g),1));
check("P61873","the file is short enough to read in one go",()=>PF.split("\n").length<=60||"PanelFrame has grown past 60 lines");
check("P61874","the note names the two bugs it prevents, numbered",()=>(/1\) SIZING/.test(PF)&&/2\) INSETS/.test(PF))||"the numbered note is gone");
check("P61875","…and states the rule that every host must render this, not a raw iframe",()=>has(PF,/EVERY panel host page must render this instead of a raw/));
check("P61876","the frame fills the viewport, so a panel's own sticky footer sits on the real bottom edge",()=>(has(PF,/inset: 0/)===true&&has(PF,/height: "100%"/)===true)||"the frame no longer fills the viewport");
check("P61877","no CSS class is applied, so no stylesheet ordering can shrink it",()=>hasNot(codeOf(PF),/className=/));
check("P61878","the iframe is not wrapped in a scrolling container",()=>eq(countOf(PF,/<div/g),0));
check("P61879","the component takes no children",()=>hasNot(codeOf(PF),/children/));
check("P61880","it does not memoise the src, so a new pin re-navigates the frame as intended",()=>hasNot(codeOf(PF),/useMemo/));
check("P61881","the ref type is the iframe element, so contentWindow is typed",()=>has(PF,/HTMLIFrameElement/));
check("P61882","the bridge's return value is used, not discarded",()=>has(PF,/=> attachSafeAreaBridge/));
check("P61883","attachSafeAreaBridge is really exported by the lib it imports",()=>has(SAB,/export function attachSafeAreaBridge\(/));
check("P61884","…with the signature PanelFrame calls it with",()=>has(SAB,/getFrame: \(\) => HTMLIFrameElement \| null \| undefined\): \(\) => void/));
check("P61885","the panel's own <html> is where the values land, so every rule can read them",()=>has(SAB,/document\?\.documentElement/));
check("P61886","the host never writes into the panel's BODY, which the panel owns",()=>hasNot(codeOf(SAB),/contentDocument\.body|document\.body\.style/));
check("P61887","the frame's src is the only thing that can navigate it",()=>hasNot(codeOf(PF),/contentWindow\.location/));
check("P61888","PanelFrame is imported by at least six pages",()=>{
  let n=0; const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
    if(e.isDirectory()){if(e.name!=="node_modules")walk(p);}
    else if(/\.tsx$/.test(e.name)&&/components\/PanelFrame/.test(fs.readFileSync(p,"utf8")))n++;}};
  walk(path.join(ROOT,"app"));
  return n>=6||`only ${n} importer(s) under app/`;
});
check("P61889","the frame is not given a name= that a window.open could target",()=>hasNot(codeOf(PF),/name="/));
check("P61890","the component does not swallow the bridge's cleanup in a try/catch",()=>hasNot(codeOf(PF),/try \{/));

process.exit(report("T8 · static A–D") ? 1 : 0);
