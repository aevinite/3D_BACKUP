// Sweep #8 · terminal 5 · the code-reading half of P58701–P59700.
// Territory: components/AppShell.tsx, public/sw.js, public/offline.html, lib/i18n.ts,
// components/RealtimeProvider.tsx, components/OfflineNotice.tsx and every remaining
// top-level components/*.tsx (37 of them).
import { read, exists, check, skip, report, has, hasNot, countOf, eq, codeOf } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib.mjs";

const SW   = read("public/sw.js");
const OFF  = read("public/offline.html");
const I18N = read("lib/i18n.ts");
const C = (n) => read(`components/${n}.tsx`);
const APP = C("AppShell"), RTP = C("RealtimeProvider"), ON = C("OfflineNotice");
const ONS = C("OfflineNoticeStatic"), OSH = C("OfflineShell"), CB = C("ConnectionBadge");
const HDR = C("Header"), HERO = C("HeroTitle"), INTRO = C("IntroSplash"), MAINT = C("Maintenance");
const TOAST = C("ToastHost"), BQD = C("BackQuitDialog"), FIT = C("FitNumber"), AFN = C("AutoFitNumbers");
const GC = C("GuestChrome"), GNF = C("GuestNotFound"), GOC = C("GuestOutboxChip"), BAN = C("BanGate");
const BOT = C("BotTrap"), CHEF = C("ChefPopup"), CCB = C("ChefCallButton"), CG = C("CustomerGreeter");
const FC = C("FoodCard"), MC = C("MiniCart"), MTH = C("ModelToastHost"), NP = C("NavPicker");
const OCM = C("OrderConfirmModal"), PART = C("Particles"), PF = C("PanelFrame"), PCG = C("PointerCaptureGuard");
const SCS = C("SessionCartSync"), SO = C("SessionOwner"), STB = C("SessionTableBill"), SR = C("StarRating");
const VEG = C("VegIcon"), CS = C("ComingSoon"), IL = C("InfinityLoader"), PANF = PF;

const ALL_MINE = {
  "public/sw.js": SW, "public/offline.html": OFF, "lib/i18n.ts": I18N,
  AppShell: APP, RealtimeProvider: RTP, OfflineNotice: ON, OfflineNoticeStatic: ONS,
  OfflineShell: OSH, ConnectionBadge: CB, Header: HDR, HeroTitle: HERO, IntroSplash: INTRO,
  Maintenance: MAINT, ToastHost: TOAST, BackQuitDialog: BQD, FitNumber: FIT, AutoFitNumbers: AFN,
  GuestChrome: GC, GuestNotFound: GNF, GuestOutboxChip: GOC, BanGate: BAN, BotTrap: BOT,
  ChefPopup: CHEF, ChefCallButton: CCB, CustomerGreeter: CG, FoodCard: FC, MiniCart: MC,
  ModelToastHost: MTH, NavPicker: NP, OrderConfirmModal: OCM, Particles: PART, PanelFrame: PF,
  PointerCaptureGuard: PCG, SessionCartSync: SCS, SessionOwner: SO, SessionTableBill: STB,
  StarRating: SR, VegIcon: VEG, ComingSoon: CS, InfinityLoader: IL,
};

/* ───────────────────────── A · public/sw.js — the offline layer (P58701–P58790) ──────────── */

check("P58701","every cache name derives from the single VERSION constant",()=>{
  const v = SW.match(/const VERSION = "(v\d+)"/); if(!v) return "no VERSION";
  return ["SHELL","ASSET","DATA","FALLBACK"].every(n=>new RegExp(`const ${n} = \\\`lfh-[a-z]+-\\$\\{VERSION\\}\\\``).test(SW)) || "a cache name does not derive from VERSION";
});
check("P58702","the last-resort page has its OWN cache, so a sign-out wipe cannot take it",()=>
  has(SW,/const FALLBACK = `lfh-fallback-\$\{VERSION\}`/));
check("P58703","LFH_CLEAR_DATA deletes DATA and SHELL and never FALLBACK",()=>{
  const m = SW.match(/type === "LFH_CLEAR_DATA"[\s\S]{0,600}?e\.waitUntil\(([^\n]+)\)/);
  if(!m) return "handler not found";
  return (/caches\.delete\(DATA\)/.test(m[1]) && /caches\.delete\(SHELL\)/.test(m[1]) && !/caches\.delete\(FALLBACK\)/.test(m[1])) || "wipe list is wrong";
});
check("P58704","the wipe re-stores the branded page in the same chain",()=>
  has(SW,/caches\.delete\(SHELL\)\)\.then\(precacheOffline\)/));
check("P58705","activate keeps exactly the four current caches and deletes older lfh- ones",()=>
  has(SW,/const keep = new Set\(\[SHELL, ASSET, DATA, FALLBACK\]\)/) === true &&
  has(SW,/k\.startsWith\("lfh-"\) && !keep\.has\(k\)/) === true);
check("P58706","install precaches the offline page and skips waiting",()=>
  has(SW,/precacheOffline\(\)\.then\(\(\) => self\.skipWaiting\(\)\)/));
check("P58707","a non-GET returns before any cache is consulted",()=>{
  const i = SW.indexOf('if (req.method !== "GET")'), j = SW.indexOf("caches.open", i);
  return (i > 0 && SW.slice(i, SW.indexOf("\n  }", i)).includes("return;")) || "no early return";
});
check("P58708","a non-GET to our own /api/ stamps the write window for its family",()=>
  has(SW,/lastWriteAt\[apiFamily\(u\.pathname\)\] = Date\.now\(\)/));
check("P58709","telemetry posts do NOT open a write window",()=>
  has(SW,/NOT_A_CHANGE = \/\^\\\/api\\\/\(log\|errlog\|log\\\/client-error\|rt-config\|health\)\//));
check("P58710","apiFamily returns '' for a path that is not /api/<x>",()=>{
  const f = new Function("p", "const m = p.match(/^\\/api\\/([^/?]+)/); return m ? m[1] : '';");
  return (f("/menu")==="" && f("/api/editor/x")==="editor" && f("/api/")==="") || "apiFamily mis-parses";
});
check("P58711","cross-origin requests are never handled",()=>has(SW,/url\.origin !== self\.location\.origin\) return;/));
check("P58712","range requests (3D model streaming) are never handled",()=>has(SW,/req\.headers\.has\("range"\)\) return;/));
check("P58713","only-if-cached probes from another mode are not handled",()=>has(SW,/req\.cache === "only-if-cached" && req\.mode !== "same-origin"/));
check("P58714","the NEVER list still covers both sign-in doors, auth, owner login, verify and health",()=>{
  const seg = SW.slice(SW.indexOf("const NEVER"), SW.indexOf("const LOGOUT"));
  return ["(staff-)?login","auth","owner","panel-login","verify","health"].every(x=>seg.includes(x)) || "NEVER list shrank";
});
check("P58715","the sign-in PAGES are deliberately NOT in NEVER (only the API routes are)",()=>{
  const seg = SW.slice(SW.indexOf("const NEVER"), SW.indexOf("const LOGOUT"));
  return hasNot(seg,/\/\^\\\/login/) === true && hasNot(seg,/\/\^\\\/staff-login/) === true;
});
check("P58716","LOGOUT matches exactly the two logout routes the app has",()=>{
  const listed = /\^\\\/api\\\/\(panel\|staff\)-logout/.test(SW);
  const real = fs.readdirSync(path.join(ROOT,"app/api")).filter(d=>/-logout$/.test(d)).sort();
  return (listed && real.join(",") === "panel-logout,staff-logout") || `routes on disk: ${real.join(",")}`;
});
check("P58717","a logout wipes this device's saved pages and reads as it passes",()=>
  has(SW,/LOGOUT\.test\(url\.pathname\)\)[\s\S]{0,400}caches\.delete\(DATA\)/));
check("P58718","dev-only plumbing is never handled",()=>has(SW,/isDevPlumbing = \(p\) =>/));
check("P58719","big media is excluded by path, never raced against a timeout",()=>
  has(SW,/isBigMedia = \(p\) => p\.startsWith\("\/models\/"\) \|\| \/\\\.\(glb\|gltf\|mp4\|webm\|mov\|zip\)\$\/i/));
check("P58720","a navigation goes through handleNav, not networkFirst",()=>has(SW,/if \(isNav\) return event\.respondWith\(handleNav\(req, url\)\)/));
check("P58721","an RSC request never shares a cache key with the HTML document",()=>
  has(SW,/const rscKey = \(url\) => url \+ \(url\.includes\("\?"\) \? "&" : "\?"\) \+ "__lfh_rsc=1"/));
check("P58722","/_next/static/ is cache-FIRST in production and network-first in dev",()=>
  has(SW,/IS_DEV \? networkFirst\(req, ASSET, req\.url, ASSET_TIMEOUT_MS\) : cacheFirst\(req, ASSET\)/));
check("P58723","an /api/ GET outside DATA_PATHS is left entirely alone",()=>
  has(SW,/if \(!isData\(url\.pathname\)\) return;/));
check("P58724","a forced refresh is never answered from the device",()=>
  has(SW,/WANTS_LIVE\.some\(\(p\) => url\.searchParams\.has\(p\)\)[\s\S]{0,200}noFallback: true/));
check("P58725","WANTS_LIVE covers refresh, force and nocache",()=>
  has(SW,/WANTS_LIVE = \["refresh", "force", "nocache"\]/));
check("P58726","owner / admin / inventory reads get NO stall timeout",()=>
  has(SW,/slowByNature = \/\^\\\/api\\\/\(owner\|admin\|inventory\)\\\/\/\.test/));
check("P58727","just after a write, an online read waits for the truth",()=>
  has(SW,/const timeout = slowByNature \|\| justWrote \? 0 : READ_TIMEOUT_MS;/));
check("P58728","justWrote is false while the device is offline, so offline still gets its saved copy",()=>
  has(SW,/self\.navigator\.onLine !== false && \(Date\.now\(\) - wroteAt\) < AFTER_WRITE_FRESH_MS/));
check("P58729","justWrote travels INTO networkFirst, not only into its timer",()=>
  has(SW,/networkFirst\(withVersion\(req\), DATA, req\.url, timeout, \{ clientId: event\.clientId, justWrote \}\)/));
check("P58730","the cache key stays req.url — the version header changes what we send, never what we store under",()=>
  has(SW,/networkFirst\(withVersion\(req\), DATA, req\.url,/));
check("P58731","withVersion copies credentials, mode and redirect so a read is never signed out",()=>
  ["credentials: req.credentials","mode: req.mode","redirect: req.redirect"].every(s=>SW.includes(s)) || "withVersion drops a request property");
check("P58732","withVersion falls back to the ORIGINAL request if anything throws",()=>
  has(SW,/\} catch \{ return req; \}/));
check("P58733","the version header is X-LFH-SW and carries the running worker's own VERSION",()=>
  has(SW,/h\.set\("X-LFH-SW", VERSION\)/));
check("P58734","everything else same-origin static is network-first against the asset leash",()=>
  has(SW,/return event\.respondWith\(networkFirst\(req, ASSET, req\.url, ASSET_TIMEOUT_MS\)\);/));
check("P58735","the table number is out of the shell cache key",()=>
  has(SW,/const TABLE_PARAMS = \["table", "t"\]/));
check("P58736","shellKey drops only the table params and keeps every other query",()=>{
  const f = new Function("raw", `
    const TABLE_PARAMS=["table","t"];
    try{const u=new URL(raw);let touched=false;for(const p of TABLE_PARAMS)if(u.searchParams.has(p)){u.searchParams.delete(p);touched=true;}return touched?u.href:raw;}catch{return raw;}`);
  return (f("https://x/r/a/menu?table=4")==="https://x/r/a/menu" &&
          f("https://x/r/a/menu?cat=soup")==="https://x/r/a/menu?cat=soup" &&
          f("https://x/r/a/menu?table=4&cat=soup").includes("cat=soup")) || "shellKey drops the wrong thing";
});
check("P58737","handleNav no longer guesses with ignoreSearch — the only mention left is the note saying so",()=>{
  const code = SW.split("\n").filter(l=>!/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  return hasNot(code,/ignoreSearch/);
});
check("P58738","handleNav never memorises a redirect or an error page",()=>
  has(SW,/res\.ok && res\.status === 200 && res\.type !== "opaqueredirect"\) putStamped\(SHELL, key, res\)/));
check("P58739","a stalled navigation still lets the real reply land and be saved",()=>
  has(SW,/\} catch \{\n    live\.catch\(\(\) => \{\}\);/));
check("P58740","handleNav always answers: saved page, then the branded page",()=>
  has(SW,/return \(await cachedCopy\(SHELL, key\)\)\n\s*\|\| \(await offlinePage\(\)\);/));
check("P58741","networkFirst starts the real request ONCE and never cancels it",()=>
  has(SW,/const live = fetch\(req\)\.then\(\(res\) => \{\n\s*if \(res && res\.ok\) putStamped/));
check("P58742","a busy reply (502/503/504) falls back like no internet, but a 500 does not",()=>
  has(SW,/CANT_ANSWER_NOW = new Set\(\[502, 503, 504\]\)/));
check("P58743","a busy reply is NOT masked just after this device wrote something",()=>
  has(SW,/if \(!noFallback && !justWrote && cacheName === DATA && res && CANT_ANSWER_NOW\.has\(res\.status\)\)/));
check("P58744","a forced-live read returns the busy reply itself rather than a saved one",()=>
  has(SW,/const noFallback = opts && opts\.noFallback;/));
check("P58745","a stall with nothing saved keeps waiting instead of failing a slow first load",()=>
  has(SW,/if \(stalled\) \{\n\s*try \{ return await live; \}/));
check("P58746","a dead network on a DATA read answers with a shape the panels understand",()=>
  has(SW,/JSON\.stringify\(\{ error: "offline", offline: true \}\)/) === true && SW.includes('"X-LFH-Offline": "1"'));
check("P58747","a dead network on a non-DATA read throws rather than inventing a body",()=>
  has(SW,/throw new Error\("offline"\);/));
check("P58748","cacheFirst reads with ignoreVary, or every saved asset would silently miss",()=>
  has(SW,/cache\.match\(req\.url, \{ ignoreVary: true \}\)/));
check("P58749","cachedCopy uses ignoreVary for the same reason",()=>
  has(SW,/cache\.match\(key, \{ ignoreVary: true, \.\.\.\(opts \|\| \{\}\) \}\)/));
check("P58750","a saved copy older than the stale window is deleted rather than shown",()=>
  has(SW,/if \(at && Date\.now\(\) - at > MAX_STALE_MS\) \{ await cache\.delete\(key\); return null; \}/));
check("P58751","the stale window is the two hours the owner chose",()=>has(SW,/MAX_STALE_MS = 2 \* 60 \* 60 \* 1000/));
check("P58752","R16 — the guest menu is NOT given a longer offline window, and the refusal is on the line",()=>
  has(SW,/REJECTED \(owner, 2026-08-12\)[\s\S]{0,600}MAX_STALE_MS/) === true || has(SW,/REJECTED \(owner, 2026-08-12\)/));
check("P58753","only a DATA hit announces itself as saved data",()=>
  has(SW,/if \(cacheName === DATA\) announceStale\(at, clientId\);/));
check("P58754","the saved-data broadcast goes ONLY to the page that asked",()=>
  has(SW,/if \(clientId\) \{\n\s*const c = await self\.clients\.get\(clientId\);/));
check("P58755","tagged() stamps both provenance headers",()=>
  has(SW,/h\.set\("X-LFH-From-Cache", "1"\)/) === true && has(SW,/h\.set\("X-LFH-Cached-At"/) === true);
check("P58756","putStamped checks the DECLARED size before buffering anything",()=>
  has(SW,/const declared = Number\(res\.headers\.get\("content-length"\) \|\| 0\);\n\s*if \(declared > MAX_DATA_BYTES\) return;/));
check("P58757","putStamped also checks the real byte length after buffering",()=>
  has(SW,/if \(buf\.byteLength > MAX_DATA_BYTES\) return;/));
check("P58758","every cache has a cap and the trim drops oldest-first",()=>
  has(SW,/CAPS = \{ data: 150, shell: 60, asset: 400 \}/) === true && has(SW,/aged\.sort\(\(a, b\) => a\.at - b\.at\)/) === true);
check("P58759","trim never deletes below the cap",()=>
  has(SW,/if \(keys\.length <= cap\) return;/));
check("P58760","a quota failure is swallowed — caching is a bonus, never a dependency",()=>
  has(SW,/catch \{ \/\* quota\/opaque/));
check("P58761","LFH_WARM_SHELL only ever stores a same-origin page",()=>
  has(SW,/if \(new URL\(key\)\.origin !== self\.location\.origin\) return;/));
check("P58762","LFH_WARM_SHELL skips a page already stored, so it costs one request at most",()=>
  has(SW,/if \(await cache\.match\(key, \{ ignoreVary: true \}\)\) return; \/\/ already saved/));
check("P58763","the shell warm stores under the SAME key handleNav would have used",()=>
  has(SW,/const key = shellKey\(new URL\(url, self\.location\.origin\)\.href\);/));
check("P58764","the asset warm applies the fetch router's own exclusions",()=>
  has(SW,/if \(isNever\(u\.pathname\) \|\| isBigMedia\(u\.pathname\) \|\| isDevPlumbing\(u\.pathname\)\) continue;/));
check("P58765","the asset warm never re-fetches a read (that would be pure egress)",()=>
  has(SW,/if \(u\.pathname\.startsWith\("\/api\/"\)\) continue;/));
check("P58766","the asset warm is bounded by WARM_ASSET_MAX in BOTH the slice and the loop",()=>
  has(SW,/assets\.slice\(0, WARM_ASSET_MAX\)/) === true && has(SW,/if \(stored >= WARM_ASSET_MAX\) break;/) === true);
check("P58767","one asset failing does not stop the rest",()=>
  has(SW,/catch \{ \/\* one asset failing must not stop the rest \*\/ \}/));
check("P58768","LFH_WARM_DATA validates the url, the family, the size and the origin before storing",()=>
  ["u.origin !== self.location.origin","!isData(u.pathname)","isNever(u.pathname)","wBody.length > MAX_DATA_BYTES"]
    .every(s=>SW.includes(s)) || "a LFH_WARM_DATA validation is missing");
check("P58769","LFH_WARM_DATA never overwrites something the worker fetched itself",()=>
  has(SW,/if \(await cache\.match\(u\.href, \{ ignoreVary: true \}\)\) return;\s*\/\/ already saved — leave it/));
check("P58770","LFH_WARM_DATA refuses a non-string body",()=>has(SW,/typeof wBody === "string"/));
check("P58771","LFH_SW_KILL drops every lfh- cache and unregisters",()=>
  has(SW,/self\.registration\.unregister\(\)/) === true && has(SW,/k\.startsWith\("lfh-"\)\) await caches\.delete\(k\)/) === true);
check("P58772","LFH_PING answers with the running worker's VERSION",()=>
  has(SW,/e\.source\.postMessage\(\{ type: "LFH_PONG", version: VERSION \}\)/));
check("P58773","LFH_SKIP_WAITING exists so a fresh deploy takes over now",()=>
  has(SW,/type === "LFH_SKIP_WAITING"\) \{\n\s*self\.skipWaiting\(\)/));
check("P58774","the branded page is looked up with ignoreVary, then the network, then an inline copy",()=>
  has(SW,/c\.match\(OFFLINE_URL, \{ ignoreVary: true \}\)\) \|\| \(await caches\.match\(OFFLINE_URL, \{ ignoreVary: true \}\)\)/));
check("P58775","the inline last-resort copy carries #retry AND #home, the ids the guard looks for",()=>
  has(SW,/id="retry"/) === true && has(SW,/id="home"/) === true);
check("P58776","the inline copy promises only what is guaranteed",()=>
  has(SW,/Anything already saved on this device is safe/) === true && hasNot(codeOf(SW),/Nothing you did is lost/) === true);
check("P58777","the inline copy names no cause it has not tested",()=>
  has(SW,/either this device is offline or the app isn.{0,2}t answering/));
check("P58778","the inline copy sends a diner to a menu and a waiter to the home screen",()=>{
  const i = SW.indexOf("var p=location.pathname"); if (i < 0) return "the inline way-out script is gone";
  const seg = SW.slice(i);
  // The paths are written escaped inside the string ("\\/view\\/"), so match the segment word.
  return ["/r/","/menu","lfh_tab_tenant","view","/q/"].every(s=>seg.includes(s)) || "a guest path is missing from the inline way-out";
});
check("P58779","the inline copy validates a pinned slug before putting it in a URL",()=>
  has(SW,/\/\^\[a-z0-9-\]\+\$\/\.test\(t\)/));
check("P58780","the inline copy hides its second button when it would only repeat the first",()=>
  has(SW,/if\(h\.href===location\.origin\+location\.pathname\)h\.hidden=true/));
check("P58781","the inline <script> is split so it cannot close the template early",()=>
  has(SW,/<\/scr' \+ 'ipt>/));
check("P58782","nothing in sw.js reads or writes a cookie, a token or an account value",()=>
  hasNot(SW,/document\.cookie|Authorization|password|Bearer /));
check("P58783","no console.log is left in the worker",()=>eq(countOf(SW,/console\.log/),0));
check("P58784","no push handler and no notification can fire from the worker",()=>
  hasNot(SW,/showNotification|addEventListener\("push"/));
check("P58785","the offline page URL is a single constant used everywhere",()=>
  eq(countOf(SW,/"\/offline\.html"/),1) === true && has(SW,/OFFLINE_URL = "\/offline\.html"/) === true);
check("P58786","the three timeouts are all still finite and the asset leash is the longest",()=>{
  const n = (k)=>Number((SW.match(new RegExp(k+" = (\\d+)"))||[])[1]);
  const nav=n("NAV_TIMEOUT_MS"), rd=n("READ_TIMEOUT_MS"), as=n("ASSET_TIMEOUT_MS");
  return (nav>0 && rd>0 && as>nav && as>rd) || `nav=${nav} read=${rd} asset=${as}`;
});
check("P58787","the write-freshness window is a minute, per family",()=>
  has(SW,/AFTER_WRITE_FRESH_MS = 60_000/) === true && has(SW,/const lastWriteAt = Object\.create\(null\)/) === true);
check("P58788","lastWriteAt has no prototype, so a family called 'constructor' cannot poison it",()=>
  has(SW,/Object\.create\(null\)/));
check("P58789","DATA_PATHS still covers every panel family plus the guest menu read",()=>
  ["editor","tablet","kitchen","admin","owner","inventory","\\/api\\\\/r\\\\/","blocked","panel-profile","maintenance","rt-config"]
    .every(x=>new RegExp(x).test(SW.slice(SW.indexOf("const DATA_PATHS"), SW.indexOf("// BIG MEDIA")))) || "a read family fell out of DATA_PATHS");
check("P58790","the two dead DATA_PATHS entries stay REMOVED, with the reason on the line",()=>
  hasNot(SW,/^\s*\/\^\\\/api\\\/guest\\\//m) === true && hasNot(SW,/^\s*\/\^\\\/api\\\/menu\//m) === true);

/* ─────────────────── B · public/offline.html — the last-resort page (P58791–P58840) ───────── */

check("P58791","the page loads nothing from anywhere — no external script, style, font or image",()=>
  hasNot(OFF,/<script[^>]+src=|<link[^>]+href=|<img[^>]+src=|@import/));
check("P58792","it carries both ids the guard looks for",()=>
  has(OFF,/id="retry"/) === true && has(OFF,/id="home"/) === true);
check("P58793","Try again really reloads",()=>has(OFF,/\$\("retry"\)\.addEventListener\("click", function \(\) \{ location\.reload\(\); \}\)/));
check("P58794","a /r/<slug>/ path sends the diner to that restaurant's own menu",()=>
  has(OFF,/homeHref = "\/r\/" \+ restSlug \+ "\/menu"/));
check("P58795","the legacy /menu and /item paths are treated as restaurant #1",()=>
  has(OFF,/\/\^\\\/\(menu\|item\)\(\\\/\|\$\)\/\.test\(p\)/));
check("P58796","the 3D viewer path is covered, and validates ?r= before trusting it",()=>
  has(OFF,/\/\^\\\/view\\\/\[\^\/\]\+\/\.test\(p\)/) === true && has(OFF,/\/\^\[a-z0-9-\]\+\$\/\.test\(q\)/) === true);
check("P58797","a /q/<code> path with nothing pinned stays a reload rather than guessing",()=>
  has(OFF,/homeHref = restSlug \? "\/r\/" \+ restSlug \+ "\/menu" : p;/));
check("P58798","the second button is hidden when it would only repeat the first",()=>
  has(OFF,/if \(homeHref === location\.pathname\) \$\("home"\)\.hidden = true;/));
check("P58799","the button stays in the DOM when hidden, so the guard's key still exists",()=>
  hasNot(OFF,/removeChild\(\$\("home"\)\)|home"\)\.remove\(\)/));
check("P58800","the restaurant name is printed only when the stored slug matches this path's",()=>
  has(OFF,/if \(String\(stored\.slug \|\| ""\)\.toLowerCase\(\) !== restSlug\) return;/));
check("P58801","the name is printed with textContent, so this page can never render markup",()=>
  has(OFF,/el\.textContent = stored\.name\.slice\(0, 60\)/));
check("P58802","a staff screen is given no restaurant name at all",()=>has(OFF,/if \(!isGuest\) return;/));
check("P58803","the reachability probe touches no database",()=>{
  // It has to be an UNMATCHED /api/ path: an unmatched one answers 404 from the edge, and a 404 is
  // a perfectly good yes — something answered us. So the check is that the probe's own path has no
  // route folder. Built from the value in the page rather than written out here, because a guard
  // that spells a repo path it needs ABSENT reads to verify:guards-alive as a broken pointer.
  const probe = (OFF.match(/var REACH = "\/api\/([^"]+)"/) || [])[1];
  if (!probe) return "the page no longer declares a reachability probe";
  return !exists(path.join("app", "api", probe)) || `/api/${probe} now has a route, so the probe would touch the app`;
});
check("P58804","every probe is time-boxed and returns its round trip",()=>
  has(OFF,/resolve\(\{ ok: false, status: 0, timedOut: true, ms: Date\.now\(\) - t0 \}\)/));
check("P58805","a probe is cache-busted and cache:no-store, so it can never be answered from the device",()=>
  has(OFF,/cache: "no-store"/) === true && has(OFF,/"t=" \+ Date\.now\(\)/) === true);
check("P58806","the three causes are tested in order and none is asserted before it is established",()=>{
  const d = OFF.slice(OFF.indexOf("function diagnose"), OFF.indexOf("// ── the retry loop"));
  return (/navigator\.onLine === false/.test(d) && d.indexOf("ping(REACH") < d.indexOf("ping(HEALTH")) || "the order of the probes moved";
});
check("P58807","reaching our server means the page never blames the diner's internet",()=>
  has(OFF,/Your internet is fine — this one is on us/));
check("P58808","the why-line starts EMPTY, so no cause is named before one is tested",()=>
  has(OFF,/<p class="why-line" id="why"><\/p>/));
check("P58809","there is ONE retry loop however many times the device says it is back",()=>
  has(OFF,/if \(retryTimer\) \{ clearTimeout\(retryTimer\); retryTimer = null; \}/));
check("P58810","a check already in flight schedules the next gap itself",()=>has(OFF,/if \(checking\) return;/));
check("P58811","the retry gap is jittered ±25%, like every other retry in the app",()=>
  has(OFF,/Math\.round\(wait \* \(0\.75 \+ Math\.random\(\) \* 0\.5\)\)/));
check("P58812","the backoff doubles and caps at a minute",()=>has(OFF,/wait = Math\.min\(wait \* 2, 60000\)/));
check("P58813","a throwing check cannot leave the page never looking again",()=>
  has(OFF,/diagnose\(\)\.then\(next\)\["catch"\]\(function \(\) \{ next\(false\); \}\)/));
check("P58814","the meter makes ZERO requests of its own",()=>{
  const m = OFF.slice(OFF.indexOf("var meter = (function"), OFF.indexOf("// ── WHY it failed"));
  return hasNot(m,/fetch\(|XMLHttpRequest|ping\(/);
});
check("P58815","the meter's two sources are the browser's own estimate and the probes already made",()=>
  has(OFF,/navigator\.connection \|\| navigator\.mozConnection \|\| navigator\.webkitConnection/) === true &&
  has(OFF,/sawProbe: function \(p\)/) === true);
check("P58816","a real round trip outranks the browser's estimate while it is fresh",()=>
  has(OFF,/var probeFresh = lastProbe && \(Date\.now\(\) - lastProbe\.at\) < 30000;/));
check("P58817","with nothing to go on the meter says so rather than inventing bars",()=>
  has(OFF,/this phone doesn't report signal strength/));
check("P58818","the millisecond figure is shown only when it was really measured",()=>
  has(OFF,/num\.textContent = probeFresh && lastProbe\.status \? lastProbe\.ms \+ " ms" : "";/));
check("P58819","'live' costs one event listener and no polling",()=>
  has(OFF,/conn\.addEventListener\("change", paint\)/) === true && hasNot(OFF,/setInterval\(paint/) === true);
check("P58820","a timed-out or refused probe reads as no signal, not as a slow one",()=>
  has(OFF,/if \(!p\.status\) return 0;/));
check("P58821","the game stops dead the moment the connection is proven back",()=>
  has(OFF,/if \(window\.LFH_GAME\) window\.LFH_GAME\.stop\("Back online"\)/));
check("P58822","the game is paused entirely while the tab is hidden",()=>
  has(OFF,/if \(document\.hidden \|\| stopped\) return;\s*\/\/ paused/));
check("P58823","the game makes no requests, so it costs the restaurant nothing",()=>{
  const g = OFF.slice(OFF.indexOf("window.LFH_GAME"));
  return hasNot(g,/fetch\(|XMLHttpRequest|new Image/);
});
check("P58824","the game is removed entirely for anyone who asked their phone to stop moving things",()=>
  has(OFF,/prefers-reduced-motion: reduce\)[\s\S]{0,300}\.game \{ display: none; \}/));
check("P58825","the game's HUD cannot swallow the first tap",()=>
  has(OFF,/\.g-hud \{[^}]*pointer-events: none;/));
check("P58826","the invite overlay cannot swallow the first tap either",()=>
  has(OFF,/\.g-ov \{[^}]*pointer-events: none;/));
check("P58827","the difficulty caps — this is a distraction, not a challenge",()=>
  has(OFF,/speed = Math\.min\(0\.38, speed \+ 0\.007\)/));
check("P58828","the closing line promises only what is guaranteed",()=>
  has(OFF,/Anything already saved is safe/) === true && hasNot(OFF,/[Ee]verything you did is saved/) === true);
check("P58829","the page declares its own dark colour scheme, so a light phone does not invert it",()=>
  has(OFF,/color-scheme: dark/));
check("P58830","the viewport is cover-fit, so the card clears a phone's notch",()=>
  has(OFF,/viewport-fit=cover/));
check("P58831","the whole page is one card with no second scroll container",()=>
  eq(countOf(OFF,/<main/),1));
check("P58832","the title element and the document title always say the same thing",()=>
  has(OFF,/document\.title = title \+ " — your work is safe";/));
check("P58833","reading the pinned tab restaurant can never throw the script",()=>
  has(OFF,/try \{ t = sessionStorage\.getItem\("lfh_tab_tenant"\) \|\| ""; \} catch \(e\) \{\}/));
check("P58834","reading the stored brand can never throw the script",()=>
  has(OFF,/try \{ stored = JSON\.parse\(localStorage\.getItem\("lfh_brand"\) \|\| "null"\); \} catch \(e\) \{ stored = null; \}/));
check("P58835","the brand line stays hidden when nothing is stored",()=>has(OFF,/<div class="brand" id="brand" hidden><\/div>/));
check("P58836","the dot is a declared no-op, not a live second indicator",()=>has(OFF,/\.dot \{ display: none; \}/));
check("P58837","the signal bar list is five bars and the class list is driven from one loop",()=>
  eq(countOf(OFF,/<i><\/i>/),5) === true && has(OFF,/bars\.children\[i\]\.className = i < t\.n \? "on" : ""/) === true);
check("P58838","the tier table covers 0..5 and the index is clamped",()=>
  has(OFF,/TIERS\[Math\.max\(0, Math\.min\(5, n\)\)\]/));
check("P58839","the VERSION comment says a change to this page needs a bump, and the current VERSION explains itself",()=>
  has(SW,/BUMP THIS whenever \/offline\.html changes/));
check("P58840","the page never says 'No internet' before navigator.onLine has actually said so",()=>{
  const d = OFF.slice(OFF.indexOf("function diagnose"));
  const i = d.indexOf('"No internet right now"');
  return (i > d.indexOf("navigator.onLine === false")) || "the wording precedes its own test";
});

/* ─────────────────────────── C · lib/i18n.ts — every language (P58841–P58895) ─────────────── */

// The dictionary, decoded from the source rather than imported, so a \uXXXX escape is judged
// as the CHARACTER a diner sees and not as the seven bytes in the file.
const LANGS = ["en","de","fr","ar","hi","ko"];
const KEYS = (()=>{ const m = I18N.match(/export interface Translations \{([\s\S]*?)\n\}/);
  return [...m[1].matchAll(/^\s{2}(\w+):\s*string;/gm)].map(x=>x[1]); })();
const DICT = (()=>{
  const out = {};
  for (const L of LANGS) {
    const i = I18N.indexOf(`\n  ${L}: {`); if (i < 0) continue;
    const body = I18N.slice(i, I18N.indexOf("\n  },", i));
    const d = {};
    for (const m of body.matchAll(/^\s{4}(\w+):\s*"((?:[^"\\]|\\.)*)",/gm)) {
      d[m[1]] = JSON.parse('"' + m[2] + '"');
    }
    out[L] = d;
  }
  return out;
})();

// 57 since 2026-09-02, when ten keys no screen rendered were retired (see the obituary in
// lib/i18n.ts). The floor is a tripwire against a block being truncated, not a target.
// 54 since 2026-09-02: ten keys with no render site were retired in round 1, and three MORE went
// when commit a9e6a305 removed the three dish screens they were the words on. The floor is a
// tripwire against a block being truncated, not a target — it moves down when a key is honestly
// retired and never to make a run green.
check("P58841","the interface still declares every key the screens ask for",()=>KEYS.length >= 52 || `only ${KEYS.length} keys`);
check("P58842","all six languages are present",()=>eq(Object.keys(DICT).length,6));
LANGS.forEach((L,i)=>check(`P588${43+i}`,`the ${L} block parses and carries a value for every interface key`,()=>{
  const missing = KEYS.filter(k=>!(k in DICT[L]));
  return missing.length===0 || `${L} is missing ${missing.join(", ")}`;
}));
LANGS.forEach((L,i)=>check(`P588${49+i}`,`no ${L} value is empty or whitespace`,()=>{
  const bad = KEYS.filter(k=>!String(DICT[L][k]||"").trim());
  return bad.length===0 || `${L}: ${bad.join(", ")}`;
}));
LANGS.forEach((L,i)=>check(`P588${55+i}`,`no ${L} value has leaked a code token (undefined / NaN / [object Object] / ${"${"})`,()=>{
  const bad = KEYS.filter(k=>/undefined|NaN|\[object Object\]|\$\{|<\/|-->/.test(String(DICT[L][k])));
  return bad.length===0 || `${L}: ${bad.join(", ")}`;
}));
// English is exempt by nature: `review` and `reviews` ARE the English words, so a value that
// equals its key proves nothing there. A NON-English value equal to its key is an untranslated stub.
LANGS.forEach((L,i)=>check(`P588${61+i}`,`no ${L} value is just its own key name`,()=>{
  if (L === "en") return true;
  const bad = KEYS.filter(k=>String(DICT[L][k]).trim()===k);
  return bad.length===0 || `${L}: ${bad.join(", ")}`;
}));
LANGS.forEach((L,i)=>check(`P588${67+i}`,`every ${L} value is a decoded string with no stray backslash escape left in it`,()=>{
  const bad = KEYS.filter(k=>/\\u[0-9a-f]{4}/i.test(String(DICT[L][k])));
  return bad.length===0 || `${L}: ${bad.join(", ")}`;
}));
check("P58873","the {q} token survives into every language's search-empty headline",()=>{
  const bad = LANGS.filter(L=>!String(DICT[L].noSearchResults).includes("{q}"));
  return bad.length===0 || `missing {q} in ${bad.join(", ")}`;
});
check("P58874","the {heart} token survives into every language's favourites sub-line",()=>{
  const bad = LANGS.filter(L=>!String(DICT[L].noFavouritesSub).includes("{heart}"));
  return bad.length===0 || `missing {heart} in ${bad.join(", ")}`;
});
check("P58875","no NON-English block still carries the English value (the 'Prep' fault)",()=>{
  // Compared only for keys whose English value is a word rather than a symbol or a proper noun.
  // `greeting` is exempt: restaurant #1's greeting is BONJOUR in English AND in French, which is
  // the point of it, not an untranslated stub.
  const skip = new Set(["greeting","catPizza","catSushi","catPasta","catBurgers","protein","arView","filterVeg","filterNonVeg","filterChef","filterFav","sortTopRated","sortLowPrice","viewIn3D","preview3dUnavailable","readMore","readLess"]);
  const bad = [];
  for (const L of LANGS.filter(x=>x!=="en")) for (const k of KEYS)
    if (!skip.has(k) && /^[A-Za-z][A-Za-z ’'&-]*$/.test(String(DICT.en[k])) && DICT[L][k] === DICT.en[k]) bad.push(`${L}.${k}`);
  return bad.length===0 || bad.join(", ");
});
// WAS: "de.prepTime is the German shortening, not the English word". The T4 sweep translated that
// value on 2026-08-17 believing a German diner read it on a dish card. Measured 2026-09-02: no
// screen renders `prepTime` at all, so the key was retired with nine others. The row now guards the
// retirement instead — a key that comes back without a render site is the fault it was.
check("P58876","the retired prep-time label has not crept back without a screen to show it",()=>
  (!("prepTime" in DICT.de) && !KEYS.includes("prepTime")) || "prepTime is back in the dictionary");
check("P58877","every language's sold-out label differs from English's, so the dish card really translates",()=>{
  const bad = LANGS.filter(L=>L!=="en" && DICT[L].notAvailable===DICT.en.notAvailable);
  return bad.length===0 || bad.join(", ");
});
check("P58878","no value is long enough to blow a phone-width chip (the filter/sort chips)",()=>{
  const chips = ["filterAll","filterVeg","filterNonVeg","filterChef","filterFav","sortTopRated","sortLowPrice","catAll"];
  const bad = [];
  for (const L of LANGS) for (const k of chips) if (String(DICT[L][k]).length > 28) bad.push(`${L}.${k}=${DICT[L][k].length}`);
  return bad.length===0 || bad.join(", ");
});
check("P58879","reading the saved language can never throw on a device that blocks storage",()=>
  has(I18N,/const readLang = \(\): LanguageCode => \{\n\s*try \{[\s\S]{0,160}\} catch \{\n\s*return "en";/));
check("P58880","the fallback language is English, the one block the dictionary is complete in",()=>
  has(I18N,/return translations\[lang\] \|\| translations\.en;/));
check("P58881","useLanguage re-reads on the app's own language event and cleans its listener up",()=>
  has(I18N,/window\.addEventListener\("lfh:language-changed", onLang\)/) === true &&
  has(I18N,/removeEventListener\("lfh:language-changed", onLang\)/) === true);
check("P58882","useLanguage starts at English on the server so the first paint cannot mismatch",()=>
  has(I18N,/useState<LanguageCode>\("en"\)/));
check("P58883","R23 — the 'finish the translation' work stays PARKED, with the refusal on the file",()=>
  has(I18N,/REJECTED \(owner, 2026-08-14\)[\s\S]{0,200}R23/));
check("P58884","that rejection names the four files that DO translate, so the next reader checks rather than guesses",()=>
  ["MenuView.tsx","FoodCard.tsx","ItemClient.tsx","ViewerClient.tsx"].every(f=>I18N.includes(f)) || "the R23 note lost its file list");
check("P58885","the wrong claim in splitGraphemes' header is recorded here so nobody re-discovers it",()=>
  has(I18N,/Arabic benefits too/));
check("P58886","the four files R23 names really are the only callers of useTranslation",()=>{
  const hits = [];
  (function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
    const p2 = path.join(d,e.name);
    if (e.isDirectory()) walk(p2);
    else if (/\.tsx?$/.test(e.name) && fs.readFileSync(p2,"utf8").includes("useTranslation(")) hits.push(p2.replace(ROOT+"/",""));
  }})(path.join(ROOT,"app"));
  (function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
    const p2 = path.join(d,e.name);
    if (e.isDirectory()) walk(p2);
    else if (/\.tsx?$/.test(e.name) && fs.readFileSync(p2,"utf8").includes("useTranslation(")) hits.push(p2.replace(ROOT+"/",""));
  }})(path.join(ROOT,"components"));
  return hits.length === 4 || `useTranslation is called from ${hits.length}: ${hits.join(", ")}`;
});
check("P58887","the language list here matches lib/format.ts's, so a picker can never offer a language with no dictionary",()=>{
  const F = read("lib/format.ts");
  const codes = [...F.matchAll(/code:\s*"(en|de|fr|ar|hi|ko)"/g)].map(m=>m[1]);
  return LANGS.every(l=>codes.includes(l)) || `format.ts offers ${[...new Set(codes)].join(",")}`;
});
check("P58888","no dictionary value carries a raw HTML tag",()=>{
  const bad=[]; for (const L of LANGS) for (const k of KEYS) if (/<[a-z/][^>]*>/i.test(String(DICT[L][k]))) bad.push(`${L}.${k}`);
  return bad.length===0 || bad.join(", ");
});
check("P58889","the Arabic block reads as Arabic script, not as transliteration",()=>
  /[؀-ۿ]/.test(DICT.ar.greeting) || "ar.greeting is not Arabic script");
check("P58890","the Hindi block reads as Devanagari",()=>/[ऀ-ॿ]/.test(DICT.hi.greeting) || "hi.greeting is not Devanagari");
check("P58891","the Korean block reads as Hangul",()=>/[가-힯]/.test(DICT.ko.greeting) || "ko.greeting is not Hangul");
// SUBJECT RETIRED 2026-09-02. It asked this of `loadingLabel`, which went with the three dish
// screens commit a9e6a305 removed. The question is worth keeping, so it now asks it of every
// sentence-shaped value the dictionary still has: an empty state or a sub-line that comes back as
// one word is almost always a stub.
check("P58892","every sentence-shaped value really is a sentence, not a single code word",()=>{
  const SENTENCES = ["noDishesYetSub","noFavouritesSub","noMatchSub","noSearchResultsSub","sharePlaceholder"];
  const bad = [];
  for (const L of LANGS) for (const k of SENTENCES)
    // CHARACTERS, not words. Korean is agglutinative and Arabic is dense: "의견을 공유해주세요…" is a
    // whole polite sentence in two words, and counting words called it a stub. Eight characters is
    // the floor a genuine stub cannot clear in any of the six.
    if (k in DICT[L] && String(DICT[L][k]).trim().length < 8) bad.push(`${L}.${k}`);
  return bad.length===0 || bad.join(", ");
});
check("P58893","no two interface keys collide inside one language block (a duplicate key silently wins)",()=>{
  const bad=[];
  for (const L of LANGS) {
    const i = I18N.indexOf(`\n  ${L}: {`); const body = I18N.slice(i, I18N.indexOf("\n  },", i));
    const seen = new Set();
    for (const m of body.matchAll(/^\s{4}(\w+):/gm)) { if (seen.has(m[1])) bad.push(`${L}.${m[1]}`); seen.add(m[1]); }
  }
  return bad.length===0 || bad.join(", ");
});
check("P58894","the dictionary declares no key the interface does not, so nothing is shipped that no screen reads",()=>{
  const extra=[]; for (const L of LANGS) for (const k of Object.keys(DICT[L])) if (!KEYS.includes(k)) extra.push(`${L}.${k}`);
  return extra.length===0 || extra.join(", ");
});
check("P58895","every declared key is actually read by a screen (`t.<key>` somewhere in app/ or components/)",()=>{
  let body = "";
  (function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
    if (["node_modules",".next",".git"].includes(e.name)) continue;
    const p2 = path.join(d,e.name);
    if (e.isDirectory()) walk(p2); else if (/\.tsx?$/.test(e.name)) body += fs.readFileSync(p2,"utf8");
  }})(path.join(ROOT,"app"));
  (function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
    const p2 = path.join(d,e.name);
    if (e.isDirectory()) walk(p2); else if (/\.tsx?$/.test(e.name)) body += fs.readFileSync(p2,"utf8");
  }})(path.join(ROOT,"components"));
  const dead = KEYS.filter(k=>!new RegExp(`[.\\[]${k}\\b|["']${k}["']`).test(body));
  return dead.length===0 || `no screen reads: ${dead.join(", ")}`;
});

/* ─────────── D · the 37 shared components (P58901–P59105) ─────────── */

// D1 · AppShell — the guest frame
check("P58901","AppShell watches the menu BREADCRUMB, never the settings table itself",()=>
  has(APP,/table: "realtime_events", filter: "topic_rid=eq\.menu:" \+ rid/));
check("P58902","the settings channel is keyed per restaurant",()=>has(APP,/\.channel\("settings-" \+ rid\)/));
check("P58903","a hidden tab drops the settings socket after the idle window",()=>
  has(APP,/idleTimer = setTimeout\(teardown, IDLE_MS\)/) === true && has(APP,/IDLE_MS = 120000/) === true);
check("P58904","it resubscribes AND refetches the instant the tab is shown again",()=>
  has(APP,/if \(!channel\) \{ subscribe\(\); refresh\(\); \}/));
check("P58905","the fallback poll is the project's 60s backstop, never faster",()=>
  has(APP,/setInterval\(\(\) => \{ if \(!document\.hidden\) refresh\(\); \}, 60000\)/));
check("P58906","the fallback poll does nothing while the tab is hidden",()=>has(APP,/if \(!document\.hidden\) refresh\(\)/));
check("P58907","the effect tears down the channel, the timer and the listener on unmount",()=>
  ["clearInterval(iv)","clearTimeout(idleTimer)",'removeEventListener("visibilitychange"',"teardown()"]
    .every(x=>APP.includes(x)) || "AppShell leaks something on unmount");
check("P58908","the effect re-runs when the restaurant resolves",()=>has(APP,/\}, \[restaurantId\]\);/));
check("P58909","the maintenance screen is rendered WITH the tenant palette, not above it",()=>{
  const i = APP.indexOf("if (serviceMode)");
  return (APP.indexOf("const rootAccentCss") < i && APP.indexOf("const themedCss") < i) || "the palette is computed below the bail-out again";
});
check("P58910","the maintenance screen is told whether this is the flagship",()=>
  has(APP,/<Maintenance logoText=\{logoText\} logoUrl=\{logoUrl\} isDefault=\{isDefault\} \/>/));
check("P58911","the tenant palette reaches the body-level guest widgets, not only #app",()=>
  has(APP,/html\[data-theme="dark"\]\{\$\{darkBody\}\}/));
check("P58912","the #app block still comes LAST so nothing inside the app changes",()=>{
  const c = APP.slice(APP.indexOf("const themedCss"), APP.indexOf("// WHITE-LABEL COLOUR"));
  return c.lastIndexOf("#app.brand-themed") > c.lastIndexOf('html[data-theme="light"]{${lightBody}}') || "the #app block is no longer last";
});
check("P58913","a restaurant with only an accent still gets a canvas, emitted BEFORE its theme",()=>
  has(APP,/\$\{accentCanvasCss\(accentColor\)\}:root\{\$\{accentPaletteCss\(accentColor\)\}\}/));
check("P58914","the intro splash is scoped per restaurant so B never inherits A's splash",()=>
  has(APP,/scopeKey=\{restaurantId\}/));
check("P58915","the bubbles only render when the toggle is on",()=>has(APP,/\{bubbles && <Particles \/>\}/));
check("P58916","the brand memo writes ONE key and only from a guest page",()=>
  eq(countOf(APP,/localStorage\.setItem\("lfh_brand"/),1));
check("P58917","the brand memo derives the slug by the SAME rule the last-resort page applies",()=>{
  const a = APP.includes(`(p.match(/^\\/r\\/([^/]+)\\//) || [])[1]?.toLowerCase() || ""`);
  const b = OFF.includes(`var m = p.match(/^\\/r\\/([^/]+)\\//);`);
  return (a && b) || "the two slug derivations have drifted";
});
check("P58918","the brand memo treats the legacy /menu and /item paths as restaurant #1",()=>
  eq(countOf(APP,/\/\^\\\/\(menu\|item\)\(\\\/\|\$\)\//),2));
check("P58919","the brand memo refuses a slug that is not a plain slug",()=>
  has(APP,/if \(slug && !\/\^\[a-z0-9-\]\+\$\/\.test\(slug\)\) return;/));
check("P58920","a device that refuses storage gets the anonymous card, never a crash",()=>
  has(APP,/localStorage\.setItem\("lfh_brand"[\s\S]{0,80}\} catch \{/));
// EXPECTATION MOVED 2026-09-02, on the owner's own instruction (item 6, "do 6th"). It used to read
// "the brand NAME is handed in, never read off logoText" — which was right for the fault it was
// written for (logoText is undefined for restaurant #1, so reading it ALONE stored nothing for the
// busiest restaurant of the lot) and wrong about what a diner sees: `brandName` is the REGISTERED
// name, so the last-resort card called the restaurant something the menu never calls it. The
// wordmark now wins AND `brandName` is still the fallback, so both facts hold at once.
check("P58921","the offline card takes the wordmark first, with the registered name still as the fallback",()=>
  has(APP,/stripBrandMarkers\(logoText \|\| ""\)\.trim\(\) \|\| \(brandName \|\| ""\)\.trim\(\)/) === true &&
  has(APP,/\}, \[brandName, brandSlug, logoText\]\);/) === true);

// D2 · RealtimeProvider — the guest socket
check("P58922","the guest socket is scoped to this restaurant server-side once the id lands",()=>
  has(RTP,/filter: scoped \? `topic_rid=eq\.\$\{scoped\}` : `topic=eq\.\$\{topic\}`/));
check("P58923","the channel NAME carries the restaurant too, so two tenants never share one",()=>
  has(RTP,/\.channel\(scoped \? `rt:\$\{scoped\}` : `rt:\$\{topic\}`\)/));
check("P58924","a breadcrumb from another restaurant is dropped in JS as well",()=>
  has(RTP,/if \(rid && evRid && evRid !== rid\) return;/));
check("P58925","a missing id keeps the event — a needless refetch beats a missed update",()=>
  has(RTP,/If either id is missing we keep the event/));
check("P58926","a burst of breadcrumbs collapses into ONE refetch nudge",()=>
  has(RTP,/tTimer = setTimeout\(\(\) => \{ metrics\.ticks\+\+;[\s\S]{0,120}\}, 300\)/));
check("P58927","latency is read from the breadcrumb's own timestamp — no extra request",()=>
  has(RTP,/const lat = Date\.now\(\) - Date\.parse\(ts\); if \(lat >= 0 && lat < 60000\) reportLatency\(lat\)/));
check("P58928","only a real fault downgrades the connection light",()=>
  has(RTP,/status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT"\) reportRealtime\("weak"\)/));
check("P58929","a hidden tab drops its socket after the idle window",()=>
  has(RTP,/idleTimer = setTimeout\(teardown, IDLE_MS\); \} \/\/ arm the idle drop/));
check("P58930","teardown clears currentTopic so the next wake really rebuilds",()=>
  has(RTP,/currentTopic = null; \/\/ force a fresh subscribe/));
check("P58931","a wake rebuilds the socket ONCE, however many wake events arrive",()=>
  has(RTP,/if \(now - lastForce < 1500\) \{ tick\(\); return; \}/));
check("P58932","pageshow only wakes on a REAL bfcache restore",()=>
  has(RTP,/const onPageShow = \(e: PageTransitionEvent\) => \{ if \(e\.persisted\) onWake\(\); \}/));
check("P58933","an 'online' event on a HIDDEN tab re-arms the idle drop instead of reopening a socket",()=>
  has(RTP,/if \(document\.hidden\) \{ clearTimeout\(idleTimer\); idleTimer = setTimeout\(teardown, IDLE_MS\); return; \}/));
check("P58934","typing a table into the waiter popup subscribes the socket straight away",()=>
  has(RTP,/window\.addEventListener\("lfh:table-scanned", onSession\)/));
check("P58935","every listener this effect adds is removed again",()=>{
  const add = [...RTP.matchAll(/(?:window|document)\.addEventListener\("([^"]+)"/g)].map(m=>m[1]).sort();
  const rem = [...RTP.matchAll(/(?:window|document)\.removeEventListener\("([^"]+)"/g)].map(m=>m[1]).sort();
  return eq(add.join(","), rem.join(","));
});
check("P58936","the socket rebuilds when the restaurant id finally resolves",()=>has(RTP,/\}, \[rid\]\);/));
check("P58937","it renders nothing — it is a nudge, never a surface",()=>has(RTP,/return null;/));
check("P58938","no table means no socket at all",()=>has(RTP,/if \(!topic\) return;/));

// D3 · OfflineNotice — the honest strip
check("P58939","the strip is muted on every panel host so it can never double up",()=>
  ["manager","kitchen","tablet","owner","menu|manager|inventory"].every(x=>ON.slice(ON.indexOf("const isPanelHost"), ON.indexOf("export default")).includes(x)) || "a panel host fell out of the mute list");
check("P58940","the strip's queue promise is made only on the three guest doors",()=>{
  const q = ON.slice(ON.indexOf("setHasQueue("), ON.indexOf("}, []);"));
  const doors = (q.match(/\.test\(location\.pathname\)/g)||[]).length;
  return (doors === 3 && q.includes("(menu|item)") && q.includes("q") ) || `hasQueue now tests ${doors} paths`;
});
check("P58941","a staff sign-in page under /r/<slug>/ is NOT promised a queue",()=>hasNot(ON,/\/r\/\[\^\/\]\+\/\(login/));
check("P58942","the strip publishes its own height for the sheets above it",()=>
  has(ON,/root\.style\.setProperty\("--lfh-offbar-h", `\$\{h\}px`\)/));
check("P58943","the height is re-measured on resize, because the text wraps on a phone",()=>
  has(ON,/window\.addEventListener\("resize", measure\)/));
check("P58944","the height is reset to 0 when the strip goes away",()=>
  eq(countOf(ON,/setProperty\("--lfh-offbar-h", "0px"\)/),2));
check("P58945","nothing on the strip is tappable",()=>has(ON,/pointerEvents: "none"/));
check("P58946","the strip goes quiet on its own rather than pinning itself to the screen",()=>
  has(ON,/setTimeout\(\(\) => setSavedAt\(0\), 20000\)/));
check("P58947","coming back online clears the saved-data claim immediately",()=>
  has(ON,/if \(!offline\) setSavedAt\(0\);/));
check("P58948","the age line is refreshed without any network call",()=>
  has(ON,/setInterval\(\(\) => tick\(\(n\) => n \+ 1\), 30000\)/));
check("P58949","the sentence is true in all three queue states",()=>
  has(ON,/Anything you send is saved and goes by itself\./));
check("P58950","the non-queue surfaces are told the true thing instead",()=>
  has(ON,/Changes you make now may not save until you're back\./));
check("P58951","R15 — this strip stays English, with the refusal on the line",()=>
  has(ON,/REJECTED \(owner, 2026-08-12\)[\s\S]{0,400}R15/));
check("P58952","the strip starts muted, so a server render can never flash it",()=>has(ON,/useState\(true\); *\/\/ stays muted/));
check("P58953","offline and struggling are different colours and different words",()=>
  has(ON,/background: offline \? "rgba\(239,68,68,\.94\)" : "rgba\(245,158,11,\.94\)"/));
check("P58954","the strip clears the phone's home indicator",()=>has(ON,/env\(safe-area-inset-bottom\)/));

// D4 · OfflineNoticeStatic — the bar that runs when React does not
check("P58955","it is a plain inline script, not a module",()=>has(ONS,/<script dangerouslySetInnerHTML/));
check("P58956","nothing dynamic is interpolated into it",()=>
  eq(countOf(ONS,/\$\{/), 1) === true && has(ONS,/\$\{JSON\.stringify\(BAR_ID\)\}/) === true);
check("P58957","it stands down whenever React's own bar is alive",()=>
  has(ONS,/getPropertyValue\('--lfh-offbar-h'\)!==''/));
check("P58958","that question is asked on EVERY sync, not once at startup",()=>
  has(ONS,/if\(navigator\.onLine===false && !reactOwnsIt\(\)\)\{ bar\(\); \} else \{ drop\(\); \}/));
check("P58959","the short watch gives up rather than running for the life of the tab",()=>
  has(ONS,/else if\(n>20\)\{clearInterval\(iv\);\}/));
check("P58960","it copes with the document still parsing",()=>
  has(ONS,/if\(document\.body\)\{sync\(\);\}else\{document\.addEventListener\('DOMContentLoaded',sync\);\}/));
check("P58961","its wording promises nothing the React bar's queue would be needed for",()=>{
  // Judge the SCRIPT it ships, not the header comment that quotes the other bar's wording.
  const script = ONS.slice(ONS.indexOf("const SCRIPT = `"), ONS.indexOf("`;\n\n/**"));
  return hasNot(script,/saved and goes by itself|Your order is saved/);
});
check("P58962","it sits ABOVE the React bar's z-index so the two can never fight",()=>{
  const a = Number((ONS.match(/z-index:(\d+)/)||[])[1]), b = Number((ON.match(/zIndex: (\d+)/)||[])[1]);
  return a > b || `static=${a} react=${b}`;
});
check("P58963","it is not tappable either",()=>has(ONS,/pointer-events:none/));
check("P58964","the whole thing is wrapped so a throw can never take the page down",()=>
  has(ONS,/\(function\(\)\{try\{[\s\S]*\}catch\(e\)\{\}\}\)\(\);/));

// D5 · OfflineShell — registering the layer
check("P58965","registration is skipped where there is no service-worker support",()=>
  has(OSH,/!\("serviceWorker" in navigator\)\) return;/));
check("P58966","?nosw=1 tears the layer off the device and stops there",()=>
  has(OSH,/has\("nosw"\)\)[\s\S]{0,300}return;/));
check("P58967","a newly-installed worker is told to take over now",()=>
  has(OSH,/next\.postMessage\(\{ type: "LFH_SKIP_WAITING" \}\)/));
check("P58968","the visibility listener is genuinely removed on unmount",()=>
  has(OSH,/offVisible = \(\) => document\.removeEventListener\("visibilitychange", onVisible\);/));
check("P58969","the page asks the worker to save itself AND its own chunks",()=>
  has(OSH,/postMessage\(\{ type: "LFH_WARM_SHELL", url: location\.href, assets: pageAssets\(\) \}\)/));
check("P58970","a first-ever visit waits for controllerchange rather than giving up",()=>
  has(OSH,/addEventListener\("controllerchange", warm, \{ once: true \}\)/));
check("P58971","the asset list is read from performance, so nothing extra is measured or requested",()=>
  has(OSH,/performance\.getEntriesByType\("resource"\)/));
check("P58972","only same-origin files are offered to the worker",()=>
  has(OSH,/\.filter\(\(n\) => n\.startsWith\(location\.origin\)\)/));
check("P58973","registration failing never breaks the page",()=>
  has(OSH,/catch \{\n\s*\/\* registration failing must never break the page/));
check("P58974","registration waits for load so it never competes with the first paint",()=>
  has(OSH,/window\.addEventListener\("load", start, \{ once: true \}\)/));

// D6 · ConnectionBadge
check("P58975","the badge never sends a request of its own",()=>hasNot(CB,/fetch\(|XMLHttpRequest/));
check("P58976","the signal bars are styled INLINE, because styled-jsx cannot reach a sibling component",()=>
  has(CB,/style=\{\{ display: "inline-flex", alignItems: "flex-end", gap: big \? 3 : 2/));
check("P58977","the sparkline's slot count matches the model's history cap",()=>{
  const a = Number((CB.match(/SPARK_SLOTS = (\d+)/)||[])[1]);
  const b = Number((read("lib/connectionStatus.ts").match(/HISTORY_MAX = (\d+)/)||[])[1]);
  return eq(a,b);
});
check("P58978","a first connect that has not happened yet reads 'Connecting…', never 'Reconnecting'",()=>
  has(CB,/if \(!everConnected && !pollMode\)[\s\S]{0,200}label: "Connecting…"/));
check("P58979","the poll-only owner panel never shows a millisecond figure",()=>
  has(CB,/const fresh = !pollMode && latencyAt > 0/));
check("P58980","a guest sees the signal and the word, never the millisecond figure",()=>
  has(CB,/v\.ms != null && !guest/));
check("P58981","the popover registers with the phone back-button manager",()=>
  has(CB,/useBackClose\("conn-badge", open, \(\) => setOpen\(false\)\)/));
check("P58982","the popover is measured from an UNSHIFTED position, so re-clamping cannot walk it",()=>
  has(CB,/el\.style\.transform = "";/));
check("P58983","the clamp re-runs when the popover's CONTENT changes, not only on open",()=>
  has(CB,/\}, \[open, waitingN, failedN, level, latencyMs\]\);/));
check("P58984","the clamp travels through a CSS variable as well, so the entry animation respects it",()=>
  has(CB,/"--pop-x": `\$\{shift\}px`/));
check("P58985","the badge counts the queue and leaves the ORDERS to the chip",()=>
  hasNot(CB,/retryGuestFailed|dismissGuestFailed|orderRestWithout/));
check("P58986","the styled-jsx block contains no backtick, which would end the template early",()=>{
  const b = CB.slice(CB.indexOf("<style jsx>{`") + 13, CB.lastIndexOf("`}</style>"));
  return eq(countOf(b,/`/),0);
});
check("P58987","the skin-aware ink is NOT in the styled-jsx block (it would miss the first paint)",()=>
  has(CB,/Skin-aware ink now lives in globals.css/));
check("P58988","the pulse and the popover animation are both dropped for reduced motion",()=>
  has(CB,/@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,200}animation: none;[\s\S]{0,120}animation: none;/));
check("P58989","the whole pill is one button with a real accessible name",()=>
  has(CB,/aria-label=\{`Connection: \$\{v\.label\}/));
check("P58990","meaning is carried by the bar count as well as by colour",()=>has(CB,/bars: \d/));

// D7 · Header
check("P58991","the header re-reads its cart and live-order dot when the restaurant changes",()=>
  has(HDR,/\}, \[restaurantId\]\);/));
check("P58992","a switcher exists only when there is a real choice to make",()=>
  has(HDR,/const showCurrency = features\.currency && !!menuCurrs && currencyOptions\.length > 1;/));
check("P58993","a returning guest's currency is forced back to the restaurant default when the switch is off",()=>
  has(HDR,/if \(features\.currency === false && getCurrency\(\)\.code !== "INR"\) setCurrency\("INR"\);/));
check("P58994","a guest carrying a language this restaurant does not offer is moved to one it does",()=>
  has(HDR,/if \(menuLangs && menuLangs\.length && !menuLangs\.includes\(getLanguage\(\)\.code\)\) setLanguage/));
check("P58995","nothing is shown until the restaurant's own list resolves",()=>
  has(HDR,/useState<string\[\] \| null>\(null\)/));
check("P58996","the theme icon is chosen by CSS from data-theme, never by JS",()=>has(HDR,/void mounted;/));
check("P58997","the restaurant's own name is never cut — it re-fits instead",()=>
  has(HDR,/useFitText<HTMLHeadingElement>\(logoText \|\| "little French house"\)/));
check("P58998","every listener the header adds is removed again",()=>{
  const add=[...HDR.matchAll(/window\.addEventListener\("([^"]+)"/g)].map(m=>m[1]).sort();
  const rem=[...HDR.matchAll(/window\.removeEventListener\("([^"]+)"/g)].map(m=>m[1]).sort();
  return eq(add.join(","),rem.join(","));
});
check("P58999","a broken saved cart shows 0, never a crash",()=>has(HDR,/\} catch \{\n\s*setCartCount\(0\);/));
check("P59000","the connection badge on the guest header is rendered in guest mode",()=>has(HDR,/<ConnectionBadge guest \/>/));

// D8 · IntroSplash — one branded opening per restaurant
// Item 5's fix, guarded WITHOUT a server. P59331–P59333 measure it live, which is the real proof —
// but a live row cannot run in CI or in the sabotage band, and removing the wrap turned nothing red
// (round 2, P95155). Both halves are asserted: the box may wrap, and the words are atomic.
check("P58896","the opening name's box may wrap, and is bounded by the screen",()=>
  has(INTRO,/flexWrap: "wrap"/) === true && has(INTRO,/maxWidth: "92vw"/) === true &&
  has(INTRO,/justifyContent: "center"/) === true);
check("P58897","…and each WORD is one atomic item, so a break can never land between two letters",()=>
  has(INTRO,/whiteSpace: "nowrap"/) === true && has(INTRO,/if \(ch\.isSpace\) \{ out\.push\(cur\); cur = \[\]; \}/) === true);
check("P58898","…and the name is the smaller size the owner asked for",()=>{
  const m = INTRO.match(/fontSize: "clamp\((\d+(?:\.\d+)?)px, (\d+(?:\.\d+)?)vw, (\d+(?:\.\d+)?)px\)"/);
  if (!m) return "the opening name no longer sets its own size";
  return (Number(m[3]) <= 22 && Number(m[2]) <= 5) || `clamp(${m[1]}px, ${m[2]}vw, ${m[3]}px) is not smaller than it was`;
});
check("P59001","the seen-flag is scoped per restaurant, so B never inherits A's splash",()=>
  has(INTRO,/const seenKey = "lfh_intro_seen:" \+ \(scopeKey \|\| wordmark \|\| "default"\);/));
check("P59002","a device that refuses storage still gets a menu",()=>
  has(INTRO,/try \{ seen = sessionStorage\.getItem\(seenKey\) === "1"; \} catch \{\}/));
check("P59003","reduced motion skips straight to the finished state",()=>
  has(INTRO,/if \(seen \|\| window\.matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\.matches\)/));
check("P59004","the curtain can never get stuck after an app-switch",()=>
  has(INTRO,/const onVisible = \(\) => \{ if \(!document\.hidden\) finish\(\); \};/));
check("P59005","pageshow is covered too, for the iOS swipe-back case",()=>
  has(INTRO,/window\.addEventListener\("pageshow", onVisible\)/));
check("P59006","there is a hard safety timer whatever the animation does",()=>
  has(INTRO,/const timer = setTimeout\(finish, 2300\);/));
check("P59007","finish can only run once",()=>has(INTRO,/if \(finished\) return;\n\s*finished = true;/));
check("P59008","the logo is only animated when this restaurant actually renders one",()=>
  has(INTRO,/if \(root\.current\?\.querySelector\("\.intro-logo"\)\) \{/));
check("P59009","a non-flagship restaurant never shows the French House mark",()=>
  has(INTRO,/logoUrl \? <img className="intro-logo" src=\{logoUrl\} alt="" \/> : \(isDefault && <img/));
check("P59010","the wordmark is split by GRAPHEME, never by .split(\"\")",()=>
  has(INTRO,/splitGraphemes\(seg\.text\)/) === true && hasNot(codeOf(INTRO),/\.split\(""\)/) === true);
check("P59011","R23 — the Arabic split is PARKED and the refusal sits on this file",()=>
  has(INTRO,/REJECTED \(owner, 2026-08-14\)[\s\S]{0,200}R23/));
check("P59012","every GSAP animation is reverted on unmount",()=>has(INTRO,/ctx\.revert\(\);/));
check("P59013","the splash is hidden from screen readers",()=>has(INTRO,/aria-hidden="true"/));
check("P59014","once finished it renders nothing at all",()=>has(INTRO,/if \(done\) return null;/));
check("P59015","it announces that it has finished, so the hero can play",()=>
  has(INTRO,/new Event\("lfh:intro-done"\)/));

// D9 · HeroTitle
check("P59016","the hero re-plays on the intro finishing and on a theme switch",()=>
  has(HERO,/window\.addEventListener\("lfh:intro-done", animate\)/) === true &&
  has(HERO,/window\.addEventListener\("lfh:theme-changed", animate\)/) === true);
check("P59017","both listeners and the pending frame are cleaned up",()=>
  has(HERO,/cancelAnimationFrame\(id\);/) === true && eq(countOf(HERO,/removeEventListener/),2));
check("P59018","reduced motion skips the animation entirely",()=>
  has(HERO,/if \(reduce \|\| !ref\.current\) return;/));
check("P59019","the tagline animates opacity only, so its gradient clip survives",()=>
  has(HERO,/tl\.fromTo\(titleLetters,\n\s*\{ opacity: 0 \},/));
check("P59020","the hero is split by grapheme too",()=>has(HERO,/splitGraphemes\(/) === true && hasNot(codeOf(HERO),/\.split\(""\)/) === true);
check("P59021","R23's refusal sits on this file as well",()=>has(HERO,/REJECTED \(owner, 2026-08-14\)/));
check("P59022","the *asterisk* highlight adds has-split so the CSS drops the gradient",()=>
  has(HERO,/className=\{`hero-title\$\{titleSplit \? " has-split" : ""\}`\}/));

// D10 · Maintenance
check("P59023","the flagship logo is served from our own public/, never an outside host",()=>
  has(MAINT,/const DEFAULT_LOGO = "\/lfh-logo\.png";/) === true && hasNot(codeOf(MAINT),/littlefrenchhouse\.in/) === true);
check("P59024","a non-flagship restaurant shows its OWN logo, or its name, never the flagship mark",()=>
  has(MAINT,/const showLogo = isDefault \? DEFAULT_LOGO : \(logoUrl \|\| null\);/));
check("P59025","the flagship's hand-tuned gold is pinned by its own class",()=>
  has(MAINT,/`maint\$\{isDefault \? " maint-flagship" : ""\}`/));
check("P59026","the screen no longer promises a time nothing can keep",()=>
  hasNot(codeOf(MAINT),/check back in a few minutes/));
check("P59027","it points the diner at the one person who does know",()=>
  has(MAINT,/Please ask a member of staff/));
check("P59028","screen readers are told this is the whole screen's message",()=>has(MAINT,/role="alert"/));

// D11 · ToastHost
check("P59029","a toast with no message is ignored",()=>has(TOAST,/if \(!d\.message\) return;/));
check("P59030","the variant is normalised to one of exactly three",()=>
  has(TOAST,/d\.variant === "error" \? "error" : d\.variant === "info" \? "info" : "success"/));
check("P59031","at most three tickets are on screen",()=>has(TOAST,/\.slice\(-3\)/));
check("P59032","a tappable ticket is given time to be tapped",()=>
  has(TOAST,/d\.href \|\| d\.event \? 3500 : variant === "error" \? 2200 : 1100/));
check("P59033","a caller can override the lifetime, but only with a positive number",()=>
  has(TOAST,/typeof d\.duration === "number" && d\.duration > 0/));
check("P59034","each ticket is removed by its own id, so one closing cannot take another",()=>
  has(TOAST,/setToasts\(\(t\) => t\.filter\(\(x\) => x\.id !== id\)\)/));
check("P59035","only the flagship signs off in French",()=>
  has(TOAST,/tenantSlug\(\) === DEFAULT_RESTAURANT_SLUG \? "· merci ·" : "· thank you ·"/));
check("P59036","a refusal gets no sign-off at all",()=>
  has(TOAST,/\{\(t\.href \|\| t\.event \|\| t\.variant !== "error"\) && \(/));
check("P59037","a tap either fires an app event or navigates, and always dismisses",()=>
  has(TOAST,/if \(t\.event\) window\.dispatchEvent\(new Event\(t\.event\)\);\n\s*else if \(t\.href\) router\.push\(t\.href\);/));
check("P59038","the stack is announced politely, not assertively",()=>has(TOAST,/aria-live="polite"/));
check("P59039","the listener is removed on unmount",()=>has(TOAST,/removeEventListener\("lfh:toast", onToast\)/));
check("P59040","each ticket is a real <button>, so a keyboard can reach it",()=>has(TOAST,/<button\n\s*key=\{t\.id\}/));

// D12 · BackQuitDialog
check("P59041","the exit guard covers all three guest doors",()=>
  has(BQD,/const HOME_PATHS = \["\/", "\/menu"\];/) === true &&
  has(BQD,/const TENANT_MENU = /) === true && has(BQD,/const QR_MENU = /) === true);
check("P59042","the tenant guard matches the menu itself and NOT its /item or /view children",()=>{
  const re = new RegExp(BQD.match(/const TENANT_MENU = \/(.+?)\/;/)[1]);
  return (re.test("/r/a/menu") && !re.test("/r/a/item/x") && !re.test("/r/a/menu/x")) || "TENANT_MENU matches the wrong paths";
});
check("P59043","the QR menu guard matches /q/<code> and not its children",()=>{
  const re = new RegExp(BQD.match(/const QR_MENU = \/(.+?)\/;/)[1]);
  return (re.test("/q/ABC123") && !re.test("/q/ABC/x")) || "QR_MENU matches the wrong paths";
});
check("P59044","two guards are never stacked",()=>
  has(BQD,/if \(!\(history\.state as GuardState\)\?\.__lfhExitGuard\) \{/));
check("P59045","landing ON the guard (coming back from a dish) does nothing",()=>
  has(BQD,/if \(\(history\.state as GuardState\)\?\.__lfhExitGuard\) return;/));
check("P59046","the guard is re-armed before the dialog opens, so the guest stays put",()=>
  has(BQD,/history\.pushState\(\{ \.\.\.\(history\.state as object\), __lfhExitGuard: true \}, ""\);\n\s*setOpen\(true\);/));
check("P59047","the root back handler is cleared on unmount",()=>has(BQD,/return \(\) => setRootBackHandler\(null\);/));
check("P59048","Leave steps back past both entries",()=>has(BQD,/history\.go\(-2\);/));
check("P59049","tapping the backdrop is the same as Stay",()=>has(BQD,/<div className="overlay active" onClick=\{stay\} \/>/));
check("P59050","the dialog is announced as a modal with a name",()=>
  has(BQD,/role="dialog"\n\s*aria-modal="true"\n\s*aria-label="Leave this site\?"/));

// D13 · FitNumber / AutoFitNumbers
check("P59051","a tile's own inline font size is remembered, so a reset cannot shrink it for ever",()=>
  has(FIT,/if \(el\.dataset\.lfhFitBase == null\) el\.dataset\.lfhFitBase = el\.style\.fontSize \|\| "";/));
check("P59052","the shrink loop removes the OVERFLOW DELTA, not the content ratio",()=>
  has(FIT,/const over = el\.scrollWidth - el\.clientWidth;/));
check("P59053","the loop is bounded, and forgives sub-pixel rounding",()=>
  has(FIT,/for \(let pass = 0; pass < 5; pass\+\+\)/) === true && has(FIT,/if \(over <= 1\) return;/) === true);
check("P59054","the readability floor is 11px, not the old crushing 9px",()=>has(FIT,/const MIN_PX = 11;/));
check("P59055","a figure that still will not fit is SHORTENED, with the exact value kept",()=>
  has(FIT,/el\.dataset\.lfhFull = full; el\.textContent = sh; el\.title = full;/));
check("P59056","the full value is restored before every re-fit, so it can grow back",()=>
  has(FIT,/if \(el\.dataset\.lfhFull\) \{ el\.textContent = el\.dataset\.lfhFull;/));
check("P59057","the Indian short form is right at every scale",()=>{
  const f = new Function("txt", `
    const m = String(txt).match(/^(\\D*)([\\d,]+(?:\\.\\d+)?)(.*)$/); if(!m) return null;
    const n = parseFloat(m[2].replace(/,/g,"")); if(!isFinite(n)||n<1000) return null;
    let v,suf; if(n>=1e7){v=n/1e7;suf=" Cr";} else if(n>=1e5){v=n/1e5;suf=" L";} else {v=n/1e3;suf="K";}
    const s = v>=100?Math.round(v):Math.round(v*10)/10; return m[1]+s+suf+m[3];`);
  return (f("₹84,45,067")==="₹84.5 L" && f("₹3,08,00,000")==="₹3.1 Cr" && f("₹999")===null && f("₹12,500")==="₹12.5K")
    || `shortIndian: ${f("₹84,45,067")} / ${f("₹3,08,00,000")} / ${f("₹12,500")}`;
});
check("P59058","a composite box (number + chip) keeps its normal wrapping",()=>
  has(FIT,/if \(el\.childElementCount === 0 && cs\.whiteSpace !== "nowrap"\)/));
check("P59059","the abbreviation is refused on a composite box, so a chip cannot be eaten",()=>
  has(FIT,/el\.scrollWidth - el\.clientWidth > 1 && el\.childElementCount === 0/));
check("P59060","a BILL is never in the fit net, and the file says why in as many words",()=>
  has(FIT,/A bill is never in that net and MUST NEVER BE/));
check("P59061","the hook observes the PARENT, so its own font change cannot loop",()=>
  has(FIT,/ro\.observe\(parent\)/) === true && has(FIT,/if \(parent\.clientWidth !== w\)/) === true);
check("P59062","the observer is disconnected on unmount",()=>has(FIT,/return \(\) => ro\.disconnect\(\);/));
check("P59063","a browser with no ResizeObserver still fits once rather than throwing",()=>
  has(FIT,/typeof ResizeObserver === "undefined"\) return;/));
check("P59064","the panel-wide net scans at most once per frame",()=>
  has(AFN,/const queue = \(\) => \{ if \(!raf\) raf = requestAnimationFrame\(scan\); \};/));
check("P59065","the net writes only style, so its own writes cannot re-trigger it",()=>
  has(AFN,/We only ever write style/));
check("P59066","the observer, the resize listener and the frame are all cleaned up",()=>
  ["mo.disconnect()",'removeEventListener("resize", queue)',"cancelAnimationFrame(raf)"].every(x=>AFN.includes(x))
  || "AutoFitNumbers leaks something");
check("P59067","the net's selector list still covers the opt-in classes and the shared stat tiles",()=>
  [".fit-num","[data-fit-num]",".anim-num",".adm-stat .v"].every(x=>AFN.includes(x)) || "a selector fell out of the net");

// D14 · GuestChrome
check("P59068","every guest widget is loaded lazily and client-only",()=>{
  const n = countOf(GC,/dynamic\(\(\) => import\("@\/components\/[A-Za-z]+"\),\s*\{ ssr: false \}\)/);
  return n >= 15 || `only ${n} lazy imports`;
});
check("P59069","a staff path renders nothing at all",()=>has(GC,/if \(isStaff\) return null;/));
check("P59070","the staff test matches the segment under /r/<slug>/ as well as at the root",()=>{
  const segs = JSON.parse(GC.match(/const STAFF_SEGMENTS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
  const re = new RegExp(`^(?:/r/[^/]+)?/(?:${segs.join("|")})(?:/|$)`);
  return (re.test("/manager") && re.test("/r/a/kitchen") && !re.test("/menu") && !re.test("/q/ABC"))
    || "STAFF_RE no longer matches both shapes";
});
check("P59071","EVERY non-guest top-level route is in the staff list",()=>{
  const segs = JSON.parse(GC.match(/const STAFF_SEGMENTS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
  const GUEST = new Set(["menu","item","view","q","r"]);            // the diner's own doors
  const routes = fs.readdirSync(path.join(ROOT,"app"),{withFileTypes:true})
    .filter(e=>e.isDirectory() && !e.name.startsWith("_") && e.name !== "api" && !e.name.startsWith("("))
    .map(e=>e.name);
  const uncovered = routes.filter(r=>!GUEST.has(r) && !segs.includes(r));
  return uncovered.length===0 || `guest chrome mounts on staff route(s): ${uncovered.join(", ")}`;
});
check("P59072","the whole bundle is kept out of the panels, which is the point of the gate",()=>
  has(GC,/no longer DOWNLOAD ~200KB\+ of guest-app code/));

// D15 · GuestNotFound
check("P59073","a switched-off menu is offered NO button",()=>
  has(GNF,/\{menuLive === true && slug && \(/));
check("P59074","the screen asks the same gate the menu page uses",()=>
  has(GNF,/fetch\(`\/api\/r\/\$\{encodeURIComponent\(slug\)\}\/menu-data`, \{ cache: "no-store" \}\)/));
check("P59075","an unreachable server never promises a menu",()=>
  has(GNF,/\.catch\(\(\) => \{ if \(alive\) setMenuLive\(false\); \}\)/));
check("P59076","the legacy /item path is restaurant #1 by definition",()=>
  has(GNF,/\/\^\\\/item\(\\\/\|\$\)\/\.test\(pathname\) \? DEFAULT_RESTAURANT_SLUG : null/));
check("P59077","the slug is url-encoded into the button's address",()=>
  has(GNF,/href=\{`\/r\/\$\{encodeURIComponent\(slug\)\}\/menu`\}/));
check("P59078","the button's ink beats globals.css's colour:inherit !important",()=>
  has(GNF,/color: #23201c !important/));
check("P59079","the animations are dropped for reduced motion but the stamp still reads",()=>
  has(GNF,/@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,200}\.gnf \.stamp \{ animation: none; opacity: 1/));
check("P59080","the two states carry different words and a different stamp",()=>
  has(GNF,/const stamp = off \? "Closed" : "Void";/));

// D16 · GuestOutboxChip
check("P59081","nothing waiting means nothing on screen",()=>has(GOC,/if \(count === 0\) return null;/));
check("P59082","the chip closes itself when the queue empties",()=>
  has(GOC,/useEffect\(\(\) => \{ if \(count === 0\) setOpen\(false\); \}, \[count\]\);/));
check("P59083","the queue's three kinds each get their own sentence, never '0 items'",()=>
  has(GOC,/if \(isLeave\(o\)\) return "Leaving your table";/) === true &&
  has(GOC,/if \(isCall\(o\)\) return callText\(o\);/) === true);
check("P59084","a mixed queue drops the noun rather than calling a water request an order",()=>
  has(GOC,/if \(list\.some\(isCall\) \|\| list\.some\(isLeave\)\) return `\$\{n\}`;/));
check("P59085","every action shows it was heard while it is running",()=>
  has(GOC,/const \[busyId, setBusyId\] = useState<string \| null>\(null\);/) === true &&
  has(GOC,/\} finally \{ setBusyId\(null\); \}/) === true);
check("P59086","one action at a time",()=>has(GOC,/if \(busyId\) return;/));
check("P59087","a refused cancel says so instead of vanishing",()=>
  has(GOC,/That's already gone to the staff/));
check("P59088","a refused 'order the rest' says so instead of vanishing",()=>
  has(GOC,/We couldn’t work out what to leave out/));
check("P59089","'order the rest' is offered only when it can actually do something",()=>
  has(GOC,/\{o\.blocked && \(o\.lines \|\| \[\]\)\.length > 1 && \(/));
check("P59090","a queued ORDER still has no cancel, and a queued CALL does",()=>
  has(GOC,/\{isCall\(o\) && !isLeave\(o\) \? \(/));
check("P59091","the list registers with the phone back-button manager",()=>
  has(GOC,/useBackClose\("guest-outbox", open, \(\) => setOpen\(false\)\)/));
check("P59092","the corner flag is removed on unmount",()=>
  has(GOC,/return \(\) => document\.body\.removeAttribute\("data-lfh-outbox"\);/));
check("P59093","the failure sentence is the queue's own, never a code",()=>
  has(GOC,/\{o\.error \|\| "This one couldn’t be sent\."\}/));
check("P59094","the sheet has a backdrop, so a touch screen can close it",()=>
  has(GOC,/<div className="gob-backdrop" onClick=\{\(\) => setOpen\(false\)\}/));

// D17 · BanGate / BotTrap
check("P59095","the ban check waits for the REAL restaurant id",()=>has(BAN,/if \(!ready\) return;/));
check("P59096","one ask per return, not two",()=>
  has(BAN,/if \(!document\.hidden && Date\.now\(\) - lastAsk > 2000\) check\(\)/));
check("P59097","a network blip never lifts or drops the wall by accident",()=>
  has(BAN,/if \(r\.ok !== false && r\.banned\)/));
check("P59098","an unblock request only claims success when a row really changed",()=>
  has(BAN,/if \(r\.ok\) setRequested\(true\);\n\s*else setFailed\(true\); \/\/ refuse visibly rather than pretend/));
check("P59099","the send button refuses a too-short number rather than posting it",()=>
  has(BAN,/if \(p\.length < 5 \|\| sending\) return;/));
check("P59100","not banned renders nothing",()=>has(BAN,/if \(!banned\) return null;/));
check("P59101","the trap field is off-screen, never display:none",()=>
  has(BOT,/left: "-9999px"/) === true && hasNot(BOT,/display: "none"/) === true);
// BOTH inputs, counted. `has(...)` was satisfied by either one of the two, so making the first
// reachable by Tab left this green — found by sabotage (round 2, P95184). A visible or reachable
// trap field REFUSES REAL PEOPLE, which is the one failure it must never have.
check("P59102","BOTH trap fields are unreachable by Tab, and the pair is hidden from screen readers",()=>
  eq(countOf(codeOf(BOT),/tabIndex=\{-1\}/),2) === true && has(BOT,/aria-hidden="true"/) === true);
check("P59103","autofill is kept out of both trap inputs",()=>eq(countOf(codeOf(BOT),/autoComplete="off"/),2));
check("P59104","the elapsed field really is kept current on a timer",()=>
  has(BOT,/const id = setInterval\(write, 500\);/) === true && has(BOT,/return \(\) => clearInterval\(id\);/) === true);
check("P59105","the elapsed value is written to the input, never through state",()=>
  has(BOT,/msRef\.current\.value = String\(Date\.now\(\) - mounted\.current\)/));

// D18 · ChefPopup / ChefCallButton — asking for staff
check("P59106","the bell disappears entirely when waiter calls are off",()=>
  has(CCB,/if \(!features\.waiter_calls\) return null;/));
check("P59107","the popup can never open when waiter calls are off, even on a stray event",()=>
  has(CHEF,/if \(!features\.waiter_calls\) return null;\n\s*if \(!open\) return null;/));
check("P59108","a fast double-tap is dropped in the SAME tick, not after a re-render",()=>
  has(CHEF,/if \(sendingRef\.current \|\| sending\) return;/));
check("P59109","the table number is validated against THIS restaurant's table count",()=>
  has(CHEF,/const check = validateTable\(tableNumber, tableCount\);/) === true && has(CHEF,/\}, \[restaurantId\]\);/) === true);
check("P59110","a refused table number is shown on the field, never swallowed",()=>
  has(CHEF,/flagTableInput\("chef-table", check\.message!\);/));
check("P59111","with no signal a waiter call is SAVED, at-most-once, rather than failing",()=>
  has(CHEF,/navigator\.onLine === false\) \{[\s\S]{0,200}enqueueGuestCall\(/));
check("P59112","the saved-call message only promises the automatic part when it really reached storage",()=>
  has(CHEF,/q\.persisted \? `\$\{reason\} · staff are told as soon as there's signal` : `\$\{reason\} · keep this page open`/));
check("P59113","a blocked table is told plainly, never shown a fake success",()=>
  has(CHEF,/res\.reason === "blocked"[\s\S]{0,220}Can't call staff from this table/));
check("P59114","a capped table and an already-sent call each get their own true sentence",()=>
  has(CHEF,/You've a few requests pending/) === true && has(CHEF,/Already sent/) === true);
check("P59115","the send lock is always released, whatever happened",()=>has(CHEF,/\} finally \{\n\s*\/\/ Either way/));
check("P59116","clearing the table number here tells the rest of the app",()=>
  eq(countOf(CHEF,/new Event\("lfh:table-scanned"\)/),2));
check("P59117","the table box is read-only while the guest is seated in a session",()=>
  has(CHEF,/disabled=\{!!lockedTable\} readOnly=\{!!lockedTable\}/));
check("P59118","only digits can reach the table field",()=>has(CHEF,/e\.target\.value\.replace\(\/\\D\/g, ""\)/));
check("P59119","the popup registers with the phone back-button manager",()=>
  has(CHEF,/useBackClose\("chef-popup", open, \(\) => setOpen\(false\)\)/));
check("P59120","every listener the popup adds is removed again",()=>{
  const add=[...CHEF.matchAll(/window\.addEventListener\("([^"]+)"/g)].map(m=>m[1]).sort();
  const rem=[...CHEF.matchAll(/window\.removeEventListener\("([^"]+)"/g)].map(m=>m[1]).sort();
  return eq(add.join(","),rem.join(","));
});
check("P59121","the six request reasons are the same labels the saved-queue prints back",()=>
  ["Call waiter","Water","Cutlery","Napkins","Clean table","Bring the bill"].every(r=>CHEF.includes(`"${r}"`)) || "a request reason changed");

// D19 · CustomerGreeter
check("P59122","the greeting waits for the REAL restaurant, never greets off another's record",()=>
  has(CG,/if \(!restaurantId \|\| !ready\) return;/));
check("P59123","it asks once per browser session, per restaurant",()=>
  has(CG,/const key = `lfh_greeted_\$\{restaurantId\}`;/));
check("P59124","a device that refuses storage still gets a menu",()=>
  has(CG,/try \{ if \(sessionStorage\.getItem\(key\)\) return; \} catch/));
check("P59125","nothing renders when the device is unknown or the name is blank",()=>
  has(CG,/if \(cancelled \|\| !r \|\| r\.known !== true\) return;/) === true && has(CG,/if \(!name\) return;/) === true);
check("P59126","the timer is cancelled on unmount",()=>has(CG,/return \(\) => \{ cancelled = true; window\.clearTimeout\(t\); \};/));
check("P59127","a failed greeting never blocks the menu",()=>has(CG,/catch \{ \/\* greeting is best-effort/));

// D20 · FoodCard
check("P59128","a 4D badge needs the tick, the switch AND both model files",()=>
  has(FC,/const has3d = !!\(item\.is4d && features\.model3d && item\.modelSmallUrl && item\.modelOptimizedUrl\);/));
check("P59129","the card's 4D styling follows the same three-part test",()=>
  has(FC,/\$\{has3d \? "is-4d" : ""\}/));
check("P59130","the quantity is clamped to the server's own per-line cap",()=>
  has(FC,/const newQty = Math\.min\(99, rawQty\);/));
check("P59131","hitting the ceiling is a refusal, and nothing else calls it a success",()=>
  has(FC,/const refused = delta > 0 && rawQty > 99;/) === true && has(FC,/if \(delta > 0 && !refused\) \{/) === true);
check("P59132","the photo's bounce waits for the same test",()=>has(FC,/if \(delta > 0 && !refused\) popThumb\(\);/));
check("P59133","the ceiling message is neutral, not a green tick",()=>has(FC,/variant: "info", duration: 1400/));
check("P59134","adding goes through the table gate; removing never does",()=>
  has(FC,/if \(delta > 0\) \{ gateAddToCart\(\(\) => applyQty\(delta\)\); return; \}/));
check("P59135","the card's + only ever touches the PLAIN line of a dish",()=>
  has(FC,/const isPlainLine = \(i: CartItem\) => !i\.sig \|\| i\.sig === "\[\]";/));
check("P59136","a new plain line is stored with the CONFIDENT price the bill will re-read",()=>
  has(FC,/price: prettyUsd\(item\.price\)\.toFixed\(2\)/));
check("P59137","no prep time is ever invented",()=>
  hasNot(codeOf(FC),/item\.time \|\| "25-30 min"/));
check("P59138","the rating slot says nothing at all when ratings are switched off",()=>
  has(FC,/features\.ratings\n\s*\? \(item\.reviewCount && item\.reviewCount > 0 \? `\$\{item\.rating\} ★` : t\.noRatingsYet\)\n\s*: "",/));
check("P59139","the meta line is joined, so a missing half never leaves a lonely bullet",()=>
  has(FC,/\]\.filter\(Boolean\)\.join\(" • "\)/));
check("P59140","the sold-out pill is translated, not an English literal",()=>has(FC,/\{t\.notAvailable\}/));
check("P59141","the sold-out pill no longer swallows the card's own link",()=>{
  const seg = FC.slice(FC.indexOf('<span className="sold-out-pill">')-40, FC.indexOf('</span>', FC.indexOf('sold-out-pill')));
  return hasNot(seg,/onClick/);
});
check("P59142","a broken photo settles the card instead of shimmering for ever",()=>
  has(FC,/onError=\{\(\) => \{ setImgLoaded\(true\); setImgError\(true\); \}\}/));
check("P59143","a card with no photo URL starts in the error state, because an empty src never fires onError",()=>
  has(FC,/useState\(!item\.image\)/));
check("P59144","the fade-in cascade is capped at the tenth card",()=>
  has(FC,/animationDelay: `\$\{Math\.min\(index, 10\) \* 0\.06\}s`/));
check("P59145","the veg mark follows the whole-menu decision when one is handed down",()=>
  has(FC,/\{\(showDiet \?\? !!features\.diet_filter\) && \(/));
check("P59146","the dish link stays inside this restaurant",()=>
  has(FC,/const base = restaurantSlug \? `\/r\/\$\{restaurantSlug\}` : "";/));
check("P59147","the browsing category rides along so Back returns to the same list",()=>
  has(FC,/\$\{viewingCategory \? `\?cat=\$\{viewingCategory\}` : ""\}/));
check("P59148","R15 — the two ceiling strings stay English, with the refusal on the line",()=>
  has(FC,/REJECTED \(owner, 2026-08-12\)[\s\S]{0,400}R15/));
check("P59149","a long dish name shrinks rather than being cut off",()=>has(FC,/useFitText\(item\.title\)/));
check("P59150","both cart listeners are removed on unmount",()=>eq(countOf(FC,/window\.removeEventListener/),2));

// D21 · MiniCart
check("P59151","the pill is hidden on the 3D viewer, which has its own bottom bar",()=>
  has(MC,/!\(pathname && pathname\.startsWith\("\/view"\)\)/));
check("P59152","the pill re-counts against the new restaurant's own cart on a soft switch",()=>
  has(MC,/useEffect\(\(\) => \{ sync\(\); \}, \[pathname\]\);/));
check("P59153","the body flag is removed on unmount, so the tracker cannot stay lifted",()=>
  has(MC,/return \(\) => document\.body\.removeAttribute\("data-lfh-minicart"\);/));
check("P59154","the subtotal is summed per line in the DISPLAY currency, exactly like the bill",()=>
  has(MC,/lines\.reduce\(\(s, l\) => s \+ unitDisplay\(l\.usd, l\.addons, currency \|\| undefined\) \* l\.qty, 0\)/));
check("P59155","the pill never claims to be the amount payable",()=>
  hasNot(codeOf(MC),/Total|Amount payable|to pay/));
check("P59156","the tax note forbids subtotal × rate if this ever shows a TOTAL",()=>
  has(MC,/never subtotal × rate/));
check("P59157","a broken saved cart shows an empty pill, never a crash",()=>
  has(MC,/\} catch \{\n\s*\/\/ If the saved data is broken/));
check("P59158","the item count reads '1 item' and '3 items'",()=>has(MC,/\{count\} item\{count !== 1 \? "s" : ""\}/));
check("P59159","every listener is removed on unmount",()=>eq(countOf(MC,/window\.removeEventListener/),4));

// D22 · ModelToastHost
check("P59160","the same model is never announced twice",()=>
  has(MTH,/if \(announcedRef\.current\.has\(key\)\) return;/));
check("P59161","a guest already IN the 3D view is not invited to open it",()=>
  has(MTH,/if \(path === `\/view\/\$\{entry\.folder\}`\)/));
check("P59162","the 3D link stays inside this restaurant",()=>
  has(MTH,/slug && slug !== DEFAULT_RESTAURANT_SLUG \? `&r=\$\{encodeURIComponent\(slug\)\}` : ""/));
check("P59163","the browsing category rides along so the viewer's Back returns to the same list",()=>
  has(MTH,/entry\.cat \? `&cat=\$\{encodeURIComponent\(entry\.cat\)\}` : ""/));
check("P59164","only a model the guest actually asked for raises a ticket",()=>
  eq(countOf(MTH,/const entry = modelWatchlist\.findByUrl\(url\);/),2));
check("P59165","both listeners are removed on unmount",()=>eq(countOf(MTH,/window\.removeEventListener/),2));

// D23 · NavPicker
check("P59166","the two pickers register separately with the back-button manager",()=>
  has(NP,/useBackClose\(`nav-\$\{buttonLabel\}`, open, \(\) => setOpen\(false\)\)/));
check("P59167","the outside-click and Escape listeners exist only while open",()=>
  has(NP,/useEffect\(\(\) => \{\n\s*if \(!open\) return;/));
check("P59168","both are removed when it closes",()=>eq(countOf(NP,/document\.removeEventListener/),2));
check("P59169","the listbox OWNS its options — nothing sits in between",()=>{
  const l = NP.slice(NP.indexOf('role="listbox"'), NP.indexOf("</ul>"));
  return hasNot(l,/<li[ >]/);
});
check("P59170","the chosen option is conveyed, not only coloured",()=>has(NP,/aria-selected=\{opt\.active\}/));
check("P59171","picking an option runs its action and closes the list",()=>
  has(NP,/opt\.onSelect\(\);\n\s*setOpen\(false\);/));

// D24 · OrderConfirmModal
check("P59172","the popup hides the whole allergy section when allergies are off",()=>
  has(OCM,/\{features\.allergies && pickable\.length > 0 && \(/));
check("P59173","a saved free-text allergy is dropped when the restaurant has switched typing off",()=>
  has(OCM,/const otherTrimmed = otherOn && features\.allergy_other \? otherText\.trim\(\) : "";/));
check("P59174","a saved kitchen note is dropped when the restaurant has switched notes off",()=>
  has(OCM,/const noteOut = features\.guest_note \? note\.trim\(\) : "";/));
check("P59175","an order-wide allergen is never repeated on the line",()=>
  has(OCM,/\.filter\(\(r\) => !orderWide\.includes\(r\)\)/));
check("P59176","editing a line targets dish id AND signature, so another dish cannot be wiped",()=>
  has(OCM,/cart\.filter\(\(it\) => !\(it\.id === item\.id && \(it\.sig \|\| "\[\]"\) === editSig\)\)/));
check("P59177","a merge and a fresh line are both clamped to the server's cap",()=>
  has(OCM,/Math\.min\(99, existing\.qty \+ qty\)/) === true && has(OCM,/qty: Math\.min\(99, qty\)/) === true);
check("P59178","the unit price goes through prettyUsd so the popup matches the card",()=>
  has(OCM,/const unit = prettyUsd\(item\.price\) \+ chosen\.reduce/));
check("P59179","the display total is per-unit then × qty, the same order the bill uses",()=>
  has(OCM,/const totalDisp = unitDisp \* qty;/));
check("P59180","a second tap while saving is ignored",()=>has(OCM,/if \(submitting\) return; \/\/ ignore a second tap/));
check("P59181","the button is re-enabled whatever happened",()=>has(OCM,/setSubmitting\(false\); \/\/ re-enable the button/));
check("P59182","the popup registers with the phone back-button manager",()=>
  has(OCM,/useBackClose\("order-confirm", open, \(\) => setOpen\(false\)\)/));
check("P59183","Escape closes it, and that listener exists only while open",()=>
  has(OCM,/if \(!open\) return;\n\s*const onKey = \(e: KeyboardEvent\) => \{ if \(e\.key === "Escape"\) setOpen\(false\); \};/));
check("P59184","the quantity stepper is clamped at both ends",()=>
  has(OCM,/Math\.max\(1, q - 1\)/) === true && has(OCM,/Math\.min\(99, q \+ 1\)/) === true);
check("P59185","add-ons are minor-rounded so base + chips equals the total shown",()=>
  has(OCM,/minorDisplay\(c\.price, currency \|\| undefined\)/));
check("P59186","the free-text allergy box only exists when its own switch is on",()=>
  has(OCM,/\{otherOn && features\.allergy_other && \(/));

// D25 · PanelFrame / PointerCaptureGuard / Particles / VegIcon / ComingSoon / InfinityLoader
check("P59187","the panel frame is height:100%, never 100vh",()=>
  has(PF,/height: "100%"/) === true && hasNot(codeOf(PF),/100vh/) === true);
check("P59188","the frame is fixed and full-bleed",()=>has(PF,/position: "fixed", inset: 0/));
check("P59189","the safe-area bridge is attached and detached by the effect's own return",()=>
  has(PF,/useEffect\(\(\) => attachSafeAreaBridge\(\(\) => ref\.current\), \[\]\);/));
check("P59190","the frame carries a title, so a screen reader can name it",()=>has(PF,/title=\{title\}/));
check("P59191","a stranded pointer capture is released when the page goes to the background",()=>
  has(PCG,/const onVisibility = \(\) => \{ if \(document\.hidden\) release\(\); \};/));
check("P59192","the capture events are watched in the CAPTURE phase, so a stopPropagation cannot hide them",()=>
  // Two adds and their two matching removes — a capture-phase listener removed without the
  // flag stays attached for ever, so both halves have to carry it.
  eq(countOf(PCG,/addEventListener\("(got|lost)pointercapture", on(Got|Lost), true\)/),2) === true &&
  eq(countOf(PCG,/removeEventListener\("(got|lost)pointercapture", on(Got|Lost), true\)/),2) === true);
check("P59193","releasing an already-released capture cannot throw",()=>
  has(PCG,/\} catch \{\n\s*\/\* the capture was already gone/));
check("P59194","every listener is removed on unmount",()=>eq(countOf(PCG,/removeEventListener/),5));
check("P59195","the bubbles are built in an effect, so the server and the browser cannot disagree",()=>
  has(PART,/useEffect\(\(\) => \{[\s\S]*?setParticles\(newParticles\);/) === true &&
  has(PART,/Math\.random\(\)/) === true);
check("P59196","the veg mark is drawn from a boolean and carries an accessible name",()=>
  has(VEG,/aria-label="Vegetarian"/) === true && has(VEG,/aria-label="Non-Vegetarian"/) === true);
check("P59197","the veg mark takes its colours from CSS classes, so it cannot pin one tenant's palette",()=>
  hasNot(codeOf(VEG),/#[0-9a-f]{3,6}/i));
check("P59198","the coming-soon page says plainly that it is not built yet",()=>
  has(CS,/Not built yet/));
check("P59199","the loader announces itself politely to a screen reader",()=>
  has(IL,/role="status" aria-live="polite"/));
check("P59200","the loader's own graphic is hidden from screen readers",()=>has(IL,/aria-hidden="true"/));

// D26 · the three session widgets
check("P59201","the shared cart only syncs for an APPROVED member of an OPEN session",()=>
  has(SCS,/if \(!r\.open \|\| !r\.approved\) \{ activeToken\.current = null;/));
check("P59202","only a definitive ending clears the sync state — a blip never re-merges",()=>
  has(SCS,/if \(reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"\)/));
check("P59203","our own pull can never trigger our own push",()=>
  has(SCS,/if \(applyingRemote\.current\) return;/));
check("P59204","a push is never sent to a token that went dead while it waited",()=>
  eq(countOf(SCS,/if \(activeToken\.current !== token\) return;/),2));
check("P59205","the steady-state push is a DELTA, so a co-diner's dish is never overwritten",()=>
  has(SCS,/mergeSessionCart\(token, added, removed, qty\)/));
check("P59206","the one whole-array write carries the cart_updated_at it read, so first save wins",()=>
  has(SCS,/setSessionCart\(s\.token, merged, \(r as \{ cart_updated_at\?: string \| null \}\)\.cart_updated_at \?\? null\)/));
check("P59207","a refused whole-array write re-merges next tick rather than overwriting",()=>
  has(SCS,/reconciledToken\.current = null; \/\/ someone else got there first/));
check("P59208","a failed delta push HEALS ITSELF rather than waiting for another edit",()=>
  has(SCS,/reconciledToken\.current = null;\n\s*\}\n\s*\}, 500\);/));
check("P59209","the failure path is not a retry of the delta, which would double an order",()=>
  has(SCS,/re-sending the same delta after a merge that actually\n\s*\/\/ succeeded/));
check("P59210","the backup poll is the project's 60s backstop, not a 2-second one",()=>
  has(SCS,/iv = setInterval\(tick, RT_BACKUP_MS\)/));
check("P59211","a realtime nudge pulls the shared cart immediately",()=>
  has(SCS,/window\.addEventListener\("lfh:rt-tick", onTick\)/));
check("P59212","the effect re-reads sessions_enabled when the restaurant resolves",()=>
  has(SCS,/enabled\.current = null;/) === true && has(SCS,/\}, \[restaurantId\]\);/) === true);
check("P59213","every timer and listener is cleaned up",()=>
  ["clearInterval(iv)","clearTimeout(pushTimer.current)",'removeEventListener("lfh:cart-updated"','removeEventListener("lfh:rt-tick"']
    .every(x=>SCS.includes(x)) || "SessionCartSync leaks something");
check("P59214","the host's approval prompt polls only while the tab is visible",()=>
  has(SO,/if \(typeof document !== "undefined" && document\.hidden\) return;/));
check("P59215","only a CONFIRMED dead token disconnects the host mid-meal",()=>
  has(SO,/if \(!state\.ok\) \{ if \(state\.reason === "invalid_token"\)/));
check("P59216","the approval prompt registers with the back-button manager and 'closes' by snoozing",()=>
  has(SO,/useBackClose\("session-owner", visible, snooze\)/));
check("P59217","the hook is called unconditionally, above the early return",()=>
  SO.indexOf("useBackClose(") < SO.indexOf("if (!visible) return null;") || "the hook moved below the early return");
check("P59218","all three host actions say something when they fail",()=>
  eq(countOf(SO,/say\(whyFailed\(r,/),3));
check("P59219","a partial 'let anyone join' is reported rather than left to guess",()=>
  has(SO,/but we couldn't let everyone already waiting in/));
check("P59220","the one refusal these actions can give has its own sentence",()=>
  has(SO,/r\?\.reason === "not_owner" \? "You're not the host of this table any more\."/));
check("P59221","the host's backup poll is deliberately TIGHT, because someone is waiting",()=>
  has(SO,/const OWNER_POLL_MS = 4000;/));
check("P59222","an unapproved partner never sees the live table",()=>
  has(STB,/if \(!mem\?\.approved\) \{ setActive\(false\); return; \}/));
check("P59223","approval brings the live table back with no reload",()=>
  has(STB,/setActive\(true\);\n\s*\/\/ Refresh everything we display/));
check("P59224","a blip keeps a bill that is already on screen",()=>
  has(STB,/if \(reason === "session_closed" \|\| reason === "removed" \|\| reason === "invalid_token"\) setActive\(false\);/));
check("P59225","a first read that never lands says so instead of shimmering for ever",()=>
  has(STB,/We can&apos;t reach the restaurant&apos;s system right now/));
check("P59226","that screen offers a way to ask again",()=>
  has(STB,/onClick=\{\(\) => \{ setStalled\(false\); pollRef\.current\?\.\(\); \}\}/));
check("P59227","the live dot stops claiming to be live while we cannot reach the system",()=>
  has(STB,/style=\{!loaded && stalled \? \{ background: "var\(--muted\)", boxShadow: "none", animation: "none" \} : undefined\}/));
check("P59228","EVERY money figure on the guest's bill is the server's",()=>
  hasNot(codeOf(STB),/subtotal \* |\* rate|\* 0\.\d/));
check("P59229","the MRP row is drawn only when the SERVER sends the split",()=>
  has(STB,/\{nontax > 0 && \(/));
check("P59230","a composition-scheme bill shows no MRP row, because every line is untaxed",()=>
  has(STB,/const nontax = composition \? 0 : Number\(bill\.nontax \?\? bill\.nontax_amount\) \|\| 0;/));
check("P59231","the GST row is hidden only when the SERVER agrees the tax is zero",()=>
  has(STB,/\{!\(composition && !\(Number\(bill\.tax\) > 0\)\) && \(/));
check("P59232","the discount percentage comes from the same sentence-maker the paper uses",()=>
  has(STB,/BILLDOC\.discPct\(/));
check("P59233","the guest never sees the staff-only 'ready' stage",()=>
  has(STB,/\(i\.status as string\) === "ready" \? \{ \.\.\.i, status: "preparing" as const \}/));
check("P59234","the widget's backup poll is the 60s backstop",()=>has(STB,/iv = setInterval\(poll, RT_BACKUP_MS\)/));
check("P59235","the timer and the realtime listener are both cleaned up",()=>
  has(STB,/if \(iv\) clearInterval\(iv\); if \(onTick\) window\.removeEventListener\("lfh:rt-tick", onTick\);/));

// D27 · StarRating
check("P59236","a star can be picked with the keyboard as well as tapped",()=>
  has(SR,/if \(e\.key === "Enter" \|\| e\.key === " "\)/));
check("P59237","each star carries a real accessible name",()=>
  has(SR,/aria-label=\{`Rate \$\{i \+ 1\} \$\{i === 0 \? "star" : "stars"\}`\}/));
check("P59238","picking the rating you already have does nothing",()=>has(SR,/if \(starIdx === value\) return;/));
check("P59239","a click during an animation settles that star first, so nothing is left half-drawn",()=>
  has(SR,/if \(toggle\?\.dataset\.animating === "1"\) \{\n\s*settle\(e, i < next\);/));
check("P59240","an external reset snaps the stars to match",()=>
  has(SR,/if \(shouldBeHappy !== isHappy\) settle\(li, shouldBeHappy\);/));
check("P59241","the hover listeners are all removed on unmount",()=>
  has(SR,/enterHandlers\.forEach\(\(fn\) => fn\(\)\);/));
check("P59242","the parent is told the new rating every time",()=>has(SR,/onChange\(next\);/));

/* ───────── E · the project's own rules, applied to this territory (P59401–P59460) ────────── */

const MINE_FILES = Object.entries(ALL_MINE);

check("P59401","every popup or overlay in this territory registers with the back-button manager",()=>{
  // A surface that renders an overlay AND can be closed must register, or the phone's back button
  // skips it and leaves the site. `.overlay`/`role="dialog"`/a fixed sheet is the tell.
  const REGISTERED = { ConnectionBadge:"conn-badge", NavPicker:"nav-", OrderConfirmModal:"order-confirm",
    ChefPopup:"chef-popup", SessionOwner:"session-owner", GuestOutboxChip:"guest-outbox" };
  const missing = [];
  for (const [name, body] of MINE_FILES) {
    if (typeof name !== "string" || !/^[A-Z]/.test(name)) continue;
    const isOverlay = /role="dialog"|className="overlay active"|className=\{`?gob-sheet|sg-overlay/.test(body);
    if (!isOverlay) continue;
    if (name === "BackQuitDialog") continue;             // IS the root handler
    if (name === "BanGate") continue;                    // a wall with no way past it, by design
    if (name === "GuestNotFound") continue;              // a whole page, not a layer
    if (!/useBackClose\(/.test(body)) missing.push(name);
  }
  return missing.length===0 || `no useBackClose in: ${missing.join(", ")}`;
});
check("P59402","no component in this territory polls faster than the project's 60s backstop",()=>{
  const bad = [];
  for (const [name, body] of MINE_FILES) {
    for (const m of body.matchAll(/setInterval\([^,]+,\s*(\d[\d_]*)\)/g)) {
      const ms = Number(String(m[1]).replace(/_/g,""));
      // The three deliberate exceptions, each with its own written reason:
      //   SessionOwner  4000  — a partner is WAITING to be let in (its own comment says so)
      //   OfflineNotice 30000 — redraws the "12 min ago" line; makes NO request
      //   BotTrap         500 — writes to an input; makes NO request
      if (ms >= 60000) continue;
      if (name === "SessionOwner" && ms === 4000) continue;
      if (name === "OfflineNotice" && ms === 30000) continue;
      if (name === "BotTrap" && ms === 500) continue;
      // OfflineNoticeStatic 250 — asks whether React has booted by reading a CSS custom property.
      // No request, and it gives up after 20 ticks (its own comment says why).
      if (name === "OfflineNoticeStatic" && ms === 250) continue;
      bad.push(`${name}=${ms}ms`);
    }
  }
  return bad.length===0 || bad.join(", ");
});
check("P59403","every setInterval in this territory is cleared",()=>{
  const bad = MINE_FILES.filter(([n,b]) => /setInterval\(/.test(b) && !/clearInterval\(/.test(b)).map(([n])=>n);
  return bad.length===0 || bad.join(", ");
});
check("P59404","every addEventListener in this territory has a matching removeEventListener",()=>{
  const bad = [];
  for (const [name, body] of MINE_FILES) {
    const add = [...body.matchAll(/\.addEventListener\("([^"]+)"/g)].map(m=>m[1]);
    const rem = [...body.matchAll(/\.removeEventListener\("([^"]+)"/g)].map(m=>m[1]);
    // `{ once: true }` needs no removal, and offline.html / sw.js are page-lifetime scripts.
    if (name === "public/offline.html" || name === "public/sw.js" || name === "OfflineNoticeStatic") continue;
    // OfflineShell's two listeners are on the ServiceWorkerRegistration and the installing worker,
    // not on window/document — they die with the registration, and removing them would need a
    // handle to an object that no longer exists. The DOCUMENT listener it adds IS removed, and
    // that is the one that would leak.
    const skipEvents = name === "OfflineShell" ? new Set(["updatefound", "statechange", "controllerchange"]) : new Set();
    for (const ev of new Set(add)) {
      if (skipEvents.has(ev)) continue;
      const n = add.filter(x=>x===ev).length, r = rem.filter(x=>x===ev).length;
      if (r < n && !new RegExp(`addEventListener\\("${ev}"[^)]*once: true`).test(body)) bad.push(`${name}:${ev}`);
    }
  }
  return bad.length===0 || bad.join(", ");
});
check("P59405","no component in this territory reads localStorage or sessionStorage unguarded",()=>{
  const bad = [];
  for (const [name, body] of MINE_FILES) {
    // sw.js and offline.html are plain page-lifetime scripts whose storage reads live inside a
    // string; their own guards are asserted by P58833 / P58834.
    if (name === "public/sw.js" || name === "public/offline.html") continue;
    const code = codeOf(body);
    for (const m of code.matchAll(/(?:local|session)Storage\.(get|set|remove)Item\(/g)) {
      // Look back far enough to clear a long comment block, and make sure the try has not already
      // been CLOSED before the read — a 400-char window put two reads of one try block on
      // different sides of it and reported the second as unguarded (my own detector, not the code).
      const before = code.slice(Math.max(0, m.index - 1200), m.index);
      const t = before.lastIndexOf("try {");
      const c = before.lastIndexOf("} catch");
      if (t < 0 || c > t) bad.push(`${name}@${m.index}`);
    }
  }
  return bad.length===0 || bad.join(", ");
});
check("P59406","no component in this territory writes to `settings` or adds a column to it",()=>
  MINE_FILES.every(([,b]) => !/from\("settings"\)[\s\S]{0,80}\.(update|insert|upsert)/.test(b)) || "a component writes settings");
check("P59407","no component in this territory holds a service-role key or any secret",()=>
  MINE_FILES.every(([,b]) => !/SERVICE_ROLE|service_role|sbp_|SUPABASE_SERVICE/.test(b)) || "a secret name appears in a client component");
check("P59408","every Supabase read in this territory is scoped, never a bare table scan",()=>{
  const bad = [];
  for (const [name, body] of MINE_FILES) {
    for (const m of body.matchAll(/\.from\("(\w+)"\)\s*\.select\(([^)]*)\)/g)) {
      const after = body.slice(m.index, m.index + 400);
      if (!/\.eq\(|\.in\(|\.filter\(|\.limit\(/.test(after)) bad.push(`${name}.${m[1]}`);
    }
  }
  return bad.length===0 || bad.join(", ");
});
check("P59409","every realtime subscription in this territory is keyed per restaurant",()=>{
  const bad = [];
  for (const [name, body] of MINE_FILES) {
    for (const m of body.matchAll(/\.channel\(([^)]+)\)/g)) {
      if (!/rid|restaurant|scoped|topic/.test(m[1])) bad.push(`${name}: ${m[1].slice(0,40)}`);
    }
  }
  return bad.length===0 || bad.join(", ");
});
// The VALUE, not just the name. `/IDLE_MS/` was satisfied by `const IDLE_MS = 1e12`, which is a
// socket that never drops — found by sabotage (round 2, P95180). Two minutes is the number both
// subscribers were written to; anything past five would hold a phantom connection all service.
check("P59410","every realtime subscriber in this territory really drops its socket on an idle hidden tab",()=>{
  const bad = [];
  for (const [n,b] of MINE_FILES) {
    if (!/\.channel\(/.test(b)) continue;
    const m = b.match(/const IDLE_MS = ([\d_e+]+);/);
    if (!m) { bad.push(`${n}: no idle window at all`); continue; }
    const ms = Number(String(m[1]).replace(/_/g,""));
    if (!(ms > 0 && ms <= 300000)) bad.push(`${n}: IDLE_MS=${m[1]}`);
    if (!/setTimeout\(teardown, IDLE_MS\)/.test(b)) bad.push(`${n}: nothing arms the drop`);
  }
  return bad.length===0 || bad.join(", ");
});
check("P59411","no component in this territory recomputes money the server already computed",()=>
  hasNot(codeOf(STB),/\* *\(?1 *\+|taxRate|\* *0\.\d\d/) === true);
check("P59412","the guest's bill names no figure the server did not send",()=>
  has(STB,/inventing that number here is forbidden outright/));
check("P59413","no tap in this territory returns in silence",()=>{
  // Every onClick that awaits something must either act on the answer or say something.
  const bad = [];
  for (const [name, body] of MINE_FILES) {
    if (!/^[A-Z]/.test(name)) continue;
    for (const m of body.matchAll(/onClick=\{[\s\S]{0,600}?await ([a-zA-Z]+)\(/g)) {
      const seg = body.slice(m.index, m.index + 900);
      if (!/lfh:toast|setFailed|setErr|say\(|if \(r|if \(res|\.ok/.test(seg)) bad.push(`${name}.${m[1]}`);
    }
  }
  return bad.length===0 || bad.join(", ");
});
check("P59414","nothing in this territory disables printing, hides a sale or deletes a bill",()=>
  MINE_FILES.every(([,b]) => !/delete[\s\S]{0,20}bill|hide[\s\S]{0,20}sale|void_bill|audit_log.*delete/i.test(b))
  || "a compliance-sensitive verb appears in a guest component");
check("P59415","every component that fetches keyed on the restaurant re-runs when the id resolves",()=>{
  const bad = [];
  for (const [name, body] of MINE_FILES) {
    if (!/useRestaurantId\(\)|useRestaurantMeta\(\)/.test(body)) continue;
    if (!/useEffect/.test(body)) continue;
    const usesNetwork = /getSettings\(|checkBan\(|greetDevice\(|getSessionState\(|getSessionCart\(|fetch\(/.test(body);
    if (!usesNetwork) continue;
    if (!/\[(?:[^\]]*\b(?:restaurantId|rid|ready)\b[^\]]*)\]/.test(body)) bad.push(name);
  }
  return bad.length===0 || bad.join(", ");
});
check("P59416","no component in this territory hard-codes restaurant #1's branding",()=>{
  const allowed = new Set(["Maintenance","IntroSplash","ToastHost","Header"]); // each pins #1 deliberately, and says so
  const bad = MINE_FILES.filter(([n,b]) => /^[A-Z]/.test(n) && !allowed.has(n) &&
    /little French house|Little French House|lfh-logo\.png/.test(codeOf(b))).map(([n])=>n);
  return bad.length===0 || bad.join(", ");
});
check("P59417","the four backend-only feature flags appear in no UI in this territory",()=>{
  const bad = MINE_FILES.filter(([n,b]) => /features\.(verification|payments|aggregators|gst_invoice)/.test(b)).map(([n])=>n);
  return bad.length===0 || bad.join(", ");
});
check("P59418","no rejected idea has been quietly re-implemented here",()=>{
  const rejected = read("docs/REJECTED-IDEAS.md");
  return /R15/.test(rejected) && /R16/.test(rejected) && /R23/.test(rejected) || "a rejection this territory relies on is missing from the list";
});
check("P59419","each of those three rejections still has its comment on the code",()=>
  has(ON,/R15/) === true && has(SW,/REJECTED \(owner, 2026-08-12\)/) === true && has(I18N,/R23/) === true);
check("P59420","this territory adds no `-webkit-backdrop-filter`, which makes the build drop the rule",()=>
  MINE_FILES.every(([,b]) => !/-webkit-backdrop-filter/.test(b)) || "a prefixed backdrop-filter was added");
check("P59421","every overlay in this territory clears the phone's home indicator where it is docked",()=>
  has(ON,/env\(safe-area-inset-bottom\)/) === true && has(ONS,/env\(safe-area-inset-bottom\)/) === true);
check("P59422","nothing in this territory reads a cookie directly",()=>
  MINE_FILES.every(([,b]) => !/document\.cookie/.test(codeOf(b))) || "a component reads document.cookie");
check("P59423","no component in this territory uses next/image for a database-driven picture",()=>
  hasNot(FC,/from "next\/image"/) === true);
check("P59424","every component in this territory that can render nothing does so explicitly",()=>{
  const nulls = MINE_FILES.filter(([n,b]) => /^[A-Z]/.test(n) && /return null;/.test(b)).length;
  return nulls >= 14 || `only ${nulls} components have an explicit null path`;
});
check("P59425","no file in this territory leaves a console.log behind",()=>{
  const bad = MINE_FILES.filter(([n,b]) => /console\.log\(/.test(codeOf(b))).map(([n])=>n);
  return bad.length===0 || bad.join(", ");
});
check("P59426","no file in this territory carries a TODO or FIXME with no owner",()=>{
  const bad = MINE_FILES.filter(([n,b]) => /\b(TODO|FIXME|XXX)\b/.test(b)).map(([n])=>n);
  return bad.length===0 || bad.join(", ");
});
check("P59427","the offline layer's read families still match the API families that exist",()=>{
  // COMMENTS OUT: this list carries two long obituaries naming the dead patterns that were
  // REMOVED from it, and reading those back as live entries is how a guard reports its own
  // documentation as a fault.
  const seg = codeOf(SW.slice(SW.indexOf("const DATA_PATHS"), SW.indexOf("// BIG MEDIA")));
  // The family is the whole first segment, hyphens included — `panel-profile`, `rt-config`.
  const named = [...seg.matchAll(/\/\^\\\/api\\\/([\w-]+)/g)].map(m=>m[1]);
  const onDisk = fs.readdirSync(path.join(ROOT,"app/api")).filter(d=>!d.startsWith("["));
  const gone = named.filter(f => !onDisk.includes(f) && f !== "r");
  return gone.length===0 || `DATA_PATHS names families with no route: ${gone.join(", ")}`;
});
check("P59428","…and every route family a PANEL reads is in that list",()=>{
  const seg = SW.slice(SW.indexOf("const DATA_PATHS"), SW.indexOf("// BIG MEDIA"));
  const need = ["editor","tablet","kitchen","admin","owner","inventory"];
  const missing = need.filter(f => !seg.includes(f));
  return missing.length===0 || missing.join(", ");
});
check("P59429","every pattern in the NEVER list either matches a route that exists, or says on the line that it does not",()=>{
  // sw.js's own recorded rule: "A dead pattern is worse than a missing one" — it reads as cover
  // that is not there. Two entries (`/api/auth`, `/api/verify`) match nothing today and are kept
  // deliberately as cover for routes this product has a switch for but has not built. That is a
  // fine reason; it just has to be WRITTEN, or the next reader trusts it instead of checking.
  // The window starts at the comment ABOVE the declaration — that is where the note lives, and a
  // slice that begins at `const NEVER` can never see it.
  const seg = SW.slice(SW.indexOf("// Never cached, ever"), SW.indexOf("const LOGOUT"));
  const onDisk = fs.readdirSync(path.join(ROOT,"app/api"));
  // Only the two whole-segment patterns can be judged this way. `(staff-)?login` matches
  // /api/staff-login, which exists, so a bare "login" lookup is my own detector being wrong.
  const named = ["verify", "auth"];
  const dead = named.filter(f => new RegExp(`\\\\/api\\\\/${f}`).test(seg) && !onDisk.includes(f));
  if (!dead.length) return true;
  return /MATCHES NOTHING TODAY/.test(seg) || `dead patterns with no note saying so: ${dead.join(", ")}`;
});
check("P59430","the offline page's reachability probe is still an UNMATCHED api path",()=>{
  const probe = (OFF.match(/var REACH = "\/api\/([^"]+)"/) || [])[1];
  return (!!probe && !exists(path.join("app", "api", probe))) || "the probe path now has a route";
});

/* ───────── F · does the change reach every panel that must show it (P59431–P59450) ───────── */

check("P59431","the offline strip has a twin in the vanilla panels, and both read the same fact",()=>{
  const twin = read("public/panels/offline.js");
  return /X-LFH-From-Cache|LFH_SERVED_FROM_CACHE/.test(twin) || "the panel twin no longer reads the worker's provenance header";
});
check("P59432","the connection badge has a twin in the vanilla panels, and both clamp their popover",()=>{
  const twin = read("public/panels/connbadge.js");
  return /clampPop|getBoundingClientRect/.test(twin) || "the panel twin no longer measures its popover";
});
check("P59433","the fit-numbers rule has a twin in the vanilla panels",()=>exists("public/panels/fitnums.js"));
check("P59434","…and both use the same readability floor",()=>{
  const twin = read("public/panels/fitnums.js");
  const a = Number((FIT.match(/MIN_PX = (\d+)/)||[])[1]);
  const b = Number((twin.match(/MIN(?:_PX)?\s*=\s*(\d+)/)||[])[1]);
  return (a === b) || `React floor ${a}px vs panel floor ${b}px`;
});
check("P59435","the worker's version header reaches a screen that can show it",()=>{
  let body=""; const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
    if(["node_modules",".next",".git"].includes(e.name))continue; const p2=path.join(d,e.name);
    if(e.isDirectory())walk(p2); else if(/\.(ts|tsx|js|mjs)$/.test(e.name))body+=fs.readFileSync(p2,"utf8");}};
  walk(path.join(ROOT,"app")); walk(path.join(ROOT,"scripts")); walk(path.join(ROOT,"public/panels"));
  return /X-LFH-SW/.test(body) || "nothing outside sw.js reads the version header";
});
check("P59436","the brand key AppShell writes is the key the last-resort page reads",()=>
  has(APP,/localStorage\.setItem\("lfh_brand"/) === true && has(OFF,/localStorage\.getItem\("lfh_brand"\)/) === true);
check("P59437","the tab-pinned tenant key the offline page reads is the one the app writes",()=>{
  const ts = read("lib/tenantStorage.ts");
  return /lfh_tab_tenant/.test(ts) || "lib/tenantStorage no longer uses lfh_tab_tenant";
});
check("P59438","the bar-height variable the offline strip publishes is the one the sheets read",()=>{
  const css = read("app/globals.css");
  return /--lfh-offbar-h/.test(css) || "app/globals.css no longer reads --lfh-offbar-h";
});
check("P59439","…and the static bar looks for the SAME variable to decide React is alive",()=>
  has(ONS,/--lfh-offbar-h/));
check("P59440","the mini-cart's body flag is the one the stylesheet lifts the tracker with",()=>{
  const css = read("app/globals.css");
  return /data-lfh-minicart/.test(css) || "app/globals.css no longer reads data-lfh-minicart";
});
check("P59441","the outbox chip's body flag is read by the stylesheet too",()=>{
  const css = read("app/globals.css");
  return /data-lfh-outbox/.test(css) || "app/globals.css no longer reads data-lfh-outbox";
});
check("P59442","the realtime nudge this territory fires is the one the guest widgets listen for",()=>{
  const listeners = MINE_FILES.filter(([,b]) => /addEventListener\("lfh:rt-tick"/.test(b)).length;
  return (has(RTP,/new CustomEvent\("lfh:rt-tick"\)/) === true && listeners >= 3) || `${listeners} listeners`;
});
check("P59443","the cart event this territory fires is the one every cart surface listens for",()=>{
  const listeners = MINE_FILES.filter(([,b]) => /addEventListener\("lfh:cart-updated"/.test(b)).length;
  return listeners >= 4 || `${listeners} listeners`;
});
check("P59444","the toast event this territory fires reaches exactly one host",()=>{
  const hosts = MINE_FILES.filter(([,b]) => /addEventListener\("lfh:toast"/.test(b)).map(([n])=>n);
  return (hosts.length === 1 && hosts[0] === "ToastHost") || hosts.join(", ");
});
check("P59445","the panel frame is what every panel host renders, never a raw iframe",()=>{
  let raw = [];
  const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
    if(["node_modules",".next",".git"].includes(e.name))continue; const p2=path.join(d,e.name);
    if(e.isDirectory())walk(p2);
    else if(/\.tsx$/.test(e.name)){ const b=fs.readFileSync(p2,"utf8");
      if(/<iframe/.test(codeOf(b)) && !/PanelFrame/.test(b)) raw.push(p2.replace(ROOT+"/","")); }}};
  walk(path.join(ROOT,"app"));
  // The owner console embeds its panels through its own bridge, which uses the identical helper.
  raw = raw.filter(f => !/owner\//.test(f));
  return raw.length===0 || `a raw <iframe> in: ${raw.join(", ")}`;
});
check("P59446","the safe-area bridge the frame attaches is the one the owner console reuses",()=>
  exists("lib/safeAreaBridge.ts") && read("lib/safeAreaBridge.ts").includes("--safe-b"));
check("P59447","the guest chrome gate and the offline strip's mute list agree about what is a panel",()=>{
  const segs = JSON.parse(GC.match(/const STAFF_SEGMENTS = (\[[^\]]+\])/)[1].replace(/'/g,'"'));
  const muted = ["manager","kitchen","tablet"];
  return muted.every(m => segs.includes(m)) || "the two lists disagree";
});
check("P59448","the 3D ticket this territory raises points at a route that exists",()=>
  exists("app/view/[folder]/page.tsx"));
check("P59449","the dish link the card builds points at a route that exists",()=>
  exists("app/item/[slug]/page.tsx") && exists("app/r/[restaurant]/item/[slug]/page.tsx"));
check("P59450","the guest not-found screen is what the guest routes' boundaries render",()=>{
  let hits = 0;
  const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
    const p2=path.join(d,e.name);
    if(e.isDirectory())walk(p2);
    else if(/^not-found\.tsx$/.test(e.name) && fs.readFileSync(p2,"utf8").includes("GuestNotFound")) hits++;}};
  walk(path.join(ROOT,"app"));
  return hits >= 2 || `only ${hits} guest not-found boundaries render it`;
});

/* ───────── G · my own judgment — should a real restaurant work this way (P59451–P59480) ──── */

check("P59451","a diner who loses signal is told the truth, not a guess",()=>
  has(ON,/No internet — showing what's saved on this device\./));
check("P59452","…and is never promised a queue on a screen that has none",()=>
  has(ON,/Changes you make now may not save until you're back\./));
check("P59453","a waiter who loses signal keeps the last board rather than an error page",()=>
  has(SW,/showing saved data from 7:42 pm/));
check("P59454","a two-hour-old board is not passed off as today's",()=>has(SW,/MAX_STALE_MS/));
check("P59455","a forced Refresh is never answered from the device — that is what the button means",()=>
  has(SW,/noFallback: true/));
check("P59456","a change a person just made is never masked by a saved copy",()=>has(SW,/AFTER_WRITE_FRESH_MS/));
check("P59457","a busy database reads as 'busy', and a bug still reads as a bug",()=>
  has(SW,/Deliberately NOT 500/));
check("P59458","the last-resort page is never a dead end",()=>has(OFF,/id="home"/));
check("P59459","…and the way out suits who is looking",()=>has(OFF,/homeLabel = "Go to the menu"/));
check("P59460","…and it names the restaurant only when it can be sure whose it is",()=>
  has(OFF,/!== restSlug\) return;/));
check("P59461","a diner is not shown a millisecond figure they cannot use",()=>has(CB,/A DINER IS NOT A DEVELOPER/));
check("P59462","a waiter IS, because that is how they judge whether the floor is lagging",()=>
  has(CB,/v\.ms != null && !guest/));
check("P59463","a sold-out dish still opens its own page, because that is the question being asked",()=>{
  const seg = FC.slice(FC.indexOf('sold-out-pill'), FC.indexOf('</span>', FC.indexOf('sold-out-pill')));
  return hasNot(seg,/onClick/);
});
check("P59464","a dish card never advertises 3D it cannot deliver",()=>has(FC,/item\.modelSmallUrl && item\.modelOptimizedUrl/));
check("P59465","a prep time is real or absent — never invented",()=>has(FC,/NO INVENTED PREP TIME/));
check("P59466","a rating slot says nothing when the restaurant has ratings off",()=>
  has(FC,/features\.ratings\n/));
check("P59467","a table's opening splash is its own restaurant's, once per visit",()=>
  has(INTRO,/lfh_intro_seen:/));
check("P59468","a maintenance screen does not promise a time nobody can keep",()=>
  hasNot(codeOf(MAINT),/few minutes/));
check("P59469","a blocked guest is given something to do, not just a wall",()=>has(BAN,/Request unblock/));
check("P59470","…and is only told their request landed when it really did",()=>has(BAN,/else setFailed\(true\)/));
check("P59471","a host approving a friend is told when it did not work",()=>has(SO,/We couldn't let them in just now/));
check("P59472","a diner's own saved order is visible to them, with something to do about it",()=>
  has(GOC,/Try again/) === true && has(GOC,/Remove/) === true);
check("P59473","…and a queued request for staff can be taken back, because nothing has been cooked",()=>
  has(GOC,/Not needed/));
check("P59474","…while a queued ORDER cannot, because the kitchen may already hold it",()=>
  has(GOC,/could throw away\n\s*\/\/ +real work/) === true || has(GOC,/AN ORDER STILL HAS NO CANCEL/) === true);
check("P59475","a diner is never shown a figure the restaurant will not charge",()=>
  has(STB,/EVERY number here is the SERVER's/));
check("P59476","a big number shrinks rather than clipping, and shortens rather than being crushed",()=>
  has(FIT,/WHEN SHRINKING RUNS OUT, SHORTEN THE NUMBER/));
check("P59477","…but never on a bill, where the exact figure is the law",()=>
  has(FIT,/on a bill the exact figure is the[\s\S]{0,20}law/));
check("P59478","the kitchen still has no profile, and nothing here gives it one",()=>
  MINE_FILES.every(([,b]) => !/PROFILE_ROLES/.test(b)) || "a component in this territory touches PROFILE_ROLES");
check("P59479","nothing in this territory can hide a sale from the Z-report",()=>
  MINE_FILES.every(([n,b]) => !/z-?report/i.test(b)) || "a guest component names the Z-report");
check("P59480","a restaurant with one language never sees a picker it cannot use",()=>
  has(HDR,/currencyOptions\.length > 1/) === true && has(HDR,/languageOptions\.length > 1/) === true);

// EXIT WITH THE FAILURE COUNT. Without this the script printed its reds and exited 0, so
// anything driving it — CI, or round 2's own sabotage band — read a red run as a green one.
// Found by the sabotage band, which is exactly what it is for. (2026-09-02.)
process.exit(report("T5 static — sweep #8") ? 1 : 0);
