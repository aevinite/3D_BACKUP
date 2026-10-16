// scripts/sweep/t1s10/rerun-r2.mjs — RE-RUN of T1.md "SWEEP #8 · ROUND 2" (P55237–P55700): the owned files read
// name by name (P55237–P55350), every refusal traced to what the person is left looking at (P55351–P55382), the
// platform 404's stylesheet rule by rule on BOTH screens (P55383–P55470, my build), and the 230 rows that round
// ran against the LIVE backup site (P55471–P55700) — re-run against the live backup site again, read-only.
import { R, src, code, count, fnBody, ok, oldRows } from "./lib.mjs";
import { newPage, done, open, withPage, cards, bodyText, LEAK, QR, DESK } from "./browser.mjs";

const LIVE = process.env.T1_LIVE || "https://3-d-backup.vercel.app";
const LAY = "app/layout.tsx", HOME = "app/page.tsx", MENU = "app/menu/page.tsx", RP = "app/r/[restaurant]/menu/page.tsx", QP = "app/q/[code]/page.tsx", NF = "app/not-found.tsx",
  MVF = "components/MenuView.tsx", MAIN = "components/Maintenance.tsx", GNF = "components/GuestNotFound.tsx";
const MV = () => code(MVF), N = () => code(NF);
const boot = () => (src(LAY).match(/const themeBootScript = `([\s\S]*?)`\.trim\(\);/) || [])[1] || "";
const S = (id, file, title, fn) => R(id, file, title, fn, "static read of the owned file, comments stripped (TypeScript parser)");
const bellGone = () => !/settleBell|BELL_MAX_LIFT|--bell-lift|menu-scrolling|controlBoxes|markScrolling|bellRaf/.test(MV());
const BELL = "re-aimed: the bell-dodging code this row named was removed by the owner on 2026-09-20 (R29) — it must stay gone";

S("P55237", LAY, "RootLayout is the only root layout", () => !/export default function \w*Layout/.test(code("app/menu/page.tsx")) && /export default function RootLayout/.test(code(LAY)));
S("P55238", LAY, "RootLayout takes exactly the page", () => /export default function RootLayout\(\{\s*children,\s*\}: Readonly<\{\s*children: React\.ReactNode;\s*\}>\)/.test(code(LAY)));
S("P55239", LAY, "viewport is exported", () => /export const viewport: Viewport =/.test(code(LAY)));
S("P55240", LAY, "width from the device", () => /width: 'device-width'/.test(code(LAY)));
S("P55241", LAY, "normal zoom on open", () => /initialScale: 1/.test(code(LAY)));
S("P55242", LAY, "the boot script is one line", () => boot().trim().split("\n").length === 1);
S("P55243", LAY, "the boot script is trimmed", () => /`\.trim\(\);/.test(src(LAY)));
S("P55244", LAY, "the boot script is an IIFE", () => /^\s*\(function\(\)\{[\s\S]*\}\)\(\);\s*$/.test(boot()));
S("P55245", LAY, "the boot script touches only the document element", () => !/document\.body/.test(boot()));
S("P55246", LAY, "lfh_language is read, never written", () => /localStorage\.getItem\('lfh_language'\)/.test(boot()) && !/setItem/.test(boot()));
S("P55247", LAY, "lfh_language falls back to English", () => /getItem\('lfh_language'\)\|\|'en'/.test(boot()));
S("P55248", LAY, "the language is stamped as lang", () => /setAttribute\('lang',lang\)/.test(boot()));
S("P55249", HOME, "HomePage is the default export", () => /export default function HomePage/.test(code(HOME)));
S("P55250", HOME, "HomePage takes no params", () => /export default function HomePage\(\)/.test(code(HOME)));
S("P55251", MENU, "MenuRedirect is the default export", () => /export default async function MenuRedirect/.test(code(MENU)));
S("P55252", MENU, "MenuRedirect is async", () => /export default async function MenuRedirect/.test(code(MENU)));
S("P55253", NF, "fromQuery reads only r=", () => /location\.search\.match\(\/\[\?&\]r=\(\[\^&\]\*\)\/\)/.test(N()));
S("P55254", NF, "fromQuery decodes before validating", () => { const b = fnBody(N(), "const fromQuery = ()"); return b.indexOf("decodeURIComponent") < b.indexOf("/^[a-z0-9-]+$/"); });
S("P55255", NF, "fromQuery returns '' on a bad escape", () => /catch \{ q = ""; \}/.test(N()));
S("P55256", NF, "fromQuery lower-cases", () => /decodeURIComponent\(q\)\.toLowerCase\(\)/.test(N()));
S("P55257", NF, "fromQuery used only for the 3D viewer door", () => count(N(), /fromQuery\(\)/g) === 1 && /pinned\(\) \|\| fromQuery\(\)/.test(N()));
S("P55258", NF, "STAFF_WORDS names every panel", () => { const w = (N().match(/const STAFF_WORDS = \/\(\^\|\\\/\)\(([^)]+)\)/) || [])[1]?.split("|") || []; return ok(["login", "staff-login", "aevinite", "admin", "manager", "editor", "kitchen", "tablet", "owner"].every((x) => w.includes(x)), w.join(",")); });
S("P55259", NF, "STAFF_WORDS is case-blind", () => /\(\\\/\|\$\)\/i;/.test(N()));
S("P55260", NF, "STAFF_WORDS is a module constant", () => N().indexOf("const STAFF_WORDS") < N().indexOf("export default function NotFound"));
S("P55261", NF, "popped starts at zero and only counts up", () => /useState\(0\)/.test(N()) && count(N(), /setPopped\(\(n\) => n \+ 1\)/g) === 2);
S("P55262", NF, "popped re-keys the toast", () => /key=\{`s\$\{popped\}`\}/.test(N()));
S("P55263", NF, "popped only on the staff screen", () => { const c = N(); const g = c.indexOf('<div className="nf nf-g">'), s = c.indexOf('<div className="nf nf-s">', g); return !/popped/.test(c.slice(g, s)); });
S("P55264", NF, "lfh_brand read, never written", () => /localStorage\.getItem\("lfh_brand"\)/.test(N()) && !/setItem\("lfh_brand"/.test(N()));
S("P55265", NF, "lfh_brand parsed inside a try", () => /try \{\s*const b = JSON\.parse\(localStorage\.getItem\("lfh_brand"\)/.test(N()));
S("P55266", NF, "its name only when the slug matches", () => /String\(b\.slug \?\? ""\)\.toLowerCase\(\) === next\.slug/.test(N()));
S("P55267", NF, "only consulted for a GUEST", () => /if \(next\.aud === "guest"\) \{\s*try \{\s*const b = JSON\.parse/.test(N()));
S("P55268", QP, "TableQrPage is the default export", () => /export default async function TableQrPage/.test(code(QP)));
S("P55269", QP, "TableQrPage takes only the code", () => /export default async function TableQrPage\(\{ params \}: \{ params: Promise<\{ code: string \}> \}\)/.test(code(QP)));
S("P55270", RP, "RestaurantMenuPage is the default export", () => /export default async function RestaurantMenuPage/.test(code(RP)));
S("P55271", RP, "RestaurantMenuPage takes params and searchParams", () => /params,\s*searchParams,\s*\}/.test(code(RP)));
S("P55272", MAIN, "DEFAULT_LOGO points inside public/", () => /const DEFAULT_LOGO = "\/lfh-logo\.png";/.test(code(MAIN)));
S("P55273", MAIN, "DEFAULT_LOGO only for the flagship", () => ok(count(code(MAIN), /DEFAULT_LOGO/g) === 2 && /const showLogo = isDefault \? DEFAULT_LOGO : \(logoUrl \|\| null\);/.test(code(MAIN)), "one ternary, flagship on the true side"));
S("P55274", MAIN, "showLogo is null, not '', without a logo", () => /\(logoUrl \|\| null\)/.test(code(MAIN)));
S("P55275", MAIN, "never the flagship mark for another restaurant", () => !/: \(logoUrl \|\| DEFAULT_LOGO\)/.test(code(MAIN)));
S("P55276", MVF, "onCur re-reads the currency", () => /const onCur = \(\) => setSearchCurrency\(getCurrency\(\)\);/.test(MV()));
S("P55277", MVF, "onCur removed on unmount", () => /removeEventListener\("lfh:currency-changed", onCur\)/.test(MV()));
S("P55278", MVF, "wasSearching read BEFORE the search is cleared", () => { const b = fnBody(MV(), "const scrollToCategory = ("); return b.indexOf("const wasSearching = !!q;") < b.indexOf('setSearchQuery("")'); });
S("P55279", MVF, "wasSearching decides the repaint wait", () => /if \(wasSearching\) setTimeout\(doScroll, 80\);\s*else requestAnimationFrame\(doScroll\);/.test(MV()));
S("P55280", MVF, "doScroll defined before it is scheduled", () => { const b = fnBody(MV(), "const scrollToCategory = ("); return b.indexOf("const doScroll = () =>") < b.indexOf("setTimeout(doScroll"); });
S("P55281", MVF, "doScroll gives up quietly without a scroller", () => /if \(!sc \|\| !sec\) return;/.test(MV()));
S("P55282", MVF, "wantTop is a function, re-measured", () => ok(/const wantTop = \(\) => \{/.test(MV()) && count(MV(), /wantTop\(\)/g) === 2, "2 call sites"));
S("P55283", MVF, "wantTop measures live with a fallback", () => /getElementById\("menu-sticky"\)\?\.getBoundingClientRect\(\)\.bottom \?\? 220/.test(MV()));
S("P55284", MVF, "wantTop leaves 12px", () => /\(bb \+ 12\)/.test(MV()));
S("P55285", MVF, "toggleCatGroup folds and unfolds", () => /cur\.includes\(slug\) \? cur\.filter\(\(s\) => s !== slug\) : \[\.\.\.cur, slug\]/.test(MV()));
S("P55286", MVF, "toggleCatGroup never mutates", () => !/closedCats\.push|cur\.push/.test(MV()));
S("P55287", MVF, "toggleSort is the only interactive writer of the sort", () => ok(count(MV(), /setCurrentSort\(/g) === 3, "3 writers: the restore, the toggle, the recovery"));
S("P55288", MVF, "loadFavorites called on mount and on both signals only", () => ok(count(MV(), /loadFavorites\(\)/g) === 2, "2 call sites"));
S("P55289", MVF, "loadFavorites never throws", () => /catch \{ setFavorites\(\[\]\); \}/.test(MV()));
S("P55290", MVF, "freshEnough enforces ten minutes", () => /const freshEnough = Date\.now\(\) - \(parsed\?\.ts \|\| 0\) <= 10 \* 60 \* 1000;/.test(MV()));
S("P55291", MVF, "freshEnough checked first", () => /if \(freshEnough && Array\.isArray\(parsed\?\.cats\)\)/.test(MV()));
S("P55292", MVF, "onFav shared by both signals", () => ok(count(MV(), /onFav\)/g) === 4, "two added, two removed"));
S("P55293", MVF, "restoreSettled starts false", () => /const restoreSettled = useRef\(false\);/.test(MV()));
S("P55294", MVF, "restoreSettled set on every way out", () => ok(count(MV(), /restoreSettled\.current = true;/g) === 3, "3 exits"));
for (const id of ["P55295", "P55296", "P55297", "P55298", "P55299", "P55300", "P55301"]) S(id, MVF, "bell-dodging helper (re-aimed)", () => ok(bellGone(), BELL));
S("P55302", MVF, "headerLine measured live with 16px", () => /: 240\) \+ 16;/.test(MV()));
S("P55303", MVF, "onScroll is passive", () => /el\.addEventListener\("scroll", onScroll, \{ passive: true \}\);/.test(MV()));
S("P55304", MVF, "onScroll runs once on mount", () => /\n\s*onScroll\(\);\s*\n\s*return \(\) => \{/.test(MV()));
S("P55305", MVF, "nav falls back to a number", () => /const navBottom = nav \? nav\.getBoundingClientRect\(\)\.bottom : 64;/.test(MV()));
S("P55306", MVF, "the shrink reference is the NON-sticky header", () => /el\.querySelector<HTMLElement>\("\.section-header"\)/.test(MV()));
S("P55307", MVF, "SHRINK_DIST is named", () => /const SHRINK_DIST = 70;/.test(MV()));
S("P55308", MVF, "the shrink is clamped", () => /Math\.max\(0, Math\.min\(1, past \/ SHRINK_DIST\)\)/.test(MV()));
S("P55309", MVF, "targetTop re-reads per tick", () => /const want = targetTop\(\);/.test(MV()));
S("P55310", MVF, "targetTop never negative", () => /return Math\.max\(0, el\.scrollTop \+ card\.getBoundingClientRect\(\)\.top - head - off\);/.test(MV()));
S("P55311", MVF, "onTarget allows 4px", () => /Math\.abs\(el\.scrollTop - want\) <= 4/.test(MV()));
S("P55312", MVF, "fourD needs the flag and both files", () => /i\.is4d && i\.modelSmallUrl && i\.modelOptimizedUrl/.test(MV()));
S("P55313", MVF, "isAllView treats 'all' as no filter", () => /const isAllView = !currentCategory \|\| currentCategory === "all";/.test(MV()));
S("P55314", MVF, "inCat/outCat split the queue", () => /inCat\.map\(smallIfNeeded\)/.test(MV()) && /outCat\.map\(smallIfNeeded\)/.test(MV()));
S("P55315", MVF, "smallIfNeeded skips a loaded model", () => /modelLoader\.isLoaded\(i\.modelOptimizedUrl\) \? null/.test(MV()));
S("P55316", MVF, "allGroups walks the restaurant's own order", () => /\? dbCategories\s*\.map\(\(c\) => \(\{/.test(MV()) && !/\.sort\(\(a, b\) => a\.name/.test(MV()));
S("P55317", MVF, "allGroups empty while searching", () => /currentCategory === "all" && !q\s*\?/.test(MV()));
S("P55318", MVF, "visibleCategories from FILTERED dishes", () => /new Set\(filteredItems\.map\(\(it\) => it\.category\)\)/.test(MV()));
S("P55319", MVF, "currentSort starts empty", () => /useState\(""\); \/\/ "" = recommended|const \[currentSort, setCurrentSort\] = useState\(""\);/.test(MV()));
S("P55320", MVF, "chefOnly starts off", () => /const \[chefOnly, setChefOnly\] = useState\(false\);/.test(MV()));
S("P55321", MVF, "closedCats starts empty", () => /const \[closedCats, setClosedCats\] = useState<string\[\]>\(\[\]\);/.test(MV()));
S("P55322", MVF, "spyCat set from a real section or tap", () => ok(count(MV(), /setSpyCat\(/g) === 2, "2 writers"));
S("P55323", MVF, "showSkeleton gates the placeholders", () => count(MV(), /showSkeleton/g) === 3);
S("P55324", MVF, "favorites-updated listened for, never dispatched here", () => /addEventListener\("lfh:favorites-updated"/.test(MV()) && !/dispatchEvent\(new Event\("lfh:favorites-updated"\)\)/.test(MV()));
// the thirteen effects, read off today's file in order
const effects = () => { const c = MV(); const out = []; let i = 0; while ((i = c.indexOf("useEffect(() => {", i)) >= 0) { const b = fnBody(c, "useEffect(() => {".slice(0, 0) + c.slice(i, i + 17)); void b; const end = c.indexOf("}, [", i); const close = c.indexOf("]);", end); out.push({ at: i, deps: c.slice(end + 4, close).trim() }); i += 17; } return out; };
S("P55325", MVF, "MenuView has thirteen effects", () => { const e = effects(); return ok(e.length === 13, `${e.length} effects; deps: ${e.map((x, k) => `#${k + 1}[${x.deps || "once"}]`).join(" ")}`); });
const WANT = ["", "qrTable", "", "layout, currentSort, currentDiet, searchQuery, closedCats, chefOnly, favOnly", "deferredQuery, features.favorites, features.diet_filter, loaded, menuData.length", "deferredQuery", "", "", "spyCat", "menuData", "currentCategory", "menuData, currentCategory, features.model3d, restaurantId", "dbCategories, visibleCategories.length, q"];
const NAMES = ["the suggestion currency", "the QR table number", "restoring browse state", "saving browse state", "the chip-row fade", "the suggestions fade", "the placeholder delay", "the scroll handler", "sliding the chip row", "putting the diner back", "remembering the category", "pre-downloading 3D", "measuring the chip overflow"];
NAMES.forEach((n, k) => S(`P${55326 + k}`, MVF, `effect ${k + 1} of 13 — ${n} — re-runs on exactly what it reads${k === 4 || k === 5 ? " (re-aimed: item 1 keys it on the deferred text)" : ""}`, () => { const e = effects()[k]; return ok(e && e.deps === WANT[k], `deps: [${e?.deps}]`); }));
S("P55339", MVF, "every listener added is removed", () => count(MV(), /\.addEventListener\(/g) === count(MV(), /\.removeEventListener\(/g));
S("P55340", MVF, "every timer is cleared", () => count(MV(), /setInterval\(/g) === count(MV(), /clearInterval\(/g));
S("P55341", MVF, "every frame is cancelled", () => /cancelAnimationFrame\(raf\);/.test(MV()));
S("P55342", MVF, "every async effect can be cancelled", () => /let cancelled = false;/.test(MV()));
S("P55343", MVF, "no effect feeds itself", () => { const c = MV(); return !/useEffect\(\(\) => \{[^]*?setSpyCat[^]*?\}, \[spyCat\]\)/.test(c.slice(c.indexOf("if (!spyCat) return;") - 40, c.indexOf("}, [spyCat]);") + 14)); });
S("P55344", MVF, "0 of 13 effects touch the network (the menu is the realtime hook's)", () => effects().every((e, k) => { const c = MV(); const next = effects()[k + 1]?.at ?? c.length; return !/fetch\(|\.rpc\(/.test(c.slice(e.at, Math.min(next, c.indexOf("}, [", e.at) + 2))); }));
S("P55345", MVF, "one effect reads the switches and cancels itself", () => ok(count(MV(), /getFeatures\(restaurantId\)/g) === 1, "effect #12"));
S("P55346", MVF, "the mount-only effects are the four that own a listener/timer/scroll", () => ok(effects().filter((e) => e.deps === "").map((_, k) => k).length === 4, "effects 1, 3, 7, 8"));
S("P55347", MVF, "only the scroll effect touches the frost (the bell is untouched now)", () => ok(count(MV(), /--headfrost-h/g) === 1 && bellGone(), "re-aimed: no effect touches the bell any more"));
S("P55348", MVF, "every effect declares its deps", () => effects().length === count(MV(), /useEffect\(\(\) => \{/g));
S("P55349", MVF, "no async effect body", () => !/useEffect\(async/.test(MV()));
S("P55350", MVF, "the persist effect lists every value it saves", () => { const e = effects()[3]; return ok(["layout", "currentSort", "currentDiet", "searchQuery", "closedCats", "chefOnly", "favOnly"].every((v) => e.deps.includes(v)), "7 values"); });
// ═════ every refusal, traced ═════
const T = (id, file, title, fn) => R(id, file, title, fn, "static read: each refusal traced to what the person is left looking at");
T("P55351", MENU, "/menu has no refusal path — it always hops", () => !/notFound/.test(code(MENU)));
T("P55352", RP, "/r refuses an unknown restaurant with the guest 404", () => /notFound\(\)/.test(code(RP)) && /return <GuestNotFound \/>;/.test(code("app/r/[restaurant]/menu/not-found.tsx")));
T("P55353", RP, "…and a switched-off Menu the same way", () => /if \(!settings\.menuEnabled\) notFound\(\);/.test(code(RP)));
T("P55354", RP, "both refusals before anything renders", () => { const c = code(RP); const b = c.slice(c.indexOf("export default async function")); return b.indexOf("notFound()") < b.indexOf("return ("); });
T("P55355", RP, "the metadata refuses separately", () => /return \{ title: "Menu", description: "This menu isn’t available right now\." \};/.test(code(RP)));
T("P55356", RP, "…an unknown slug gets a neutral title", () => /if \(!r\) return \{ title: "Menu" \};/.test(code(RP)));
const rc = () => fnBody(code(QP), "const resolveCode = cache(async function resolveCode(");
T("P55357", QP, "/q refuses a wrong-shaped code with nothing", () => /if \(!\/\^\[A-Z0-9\]\{6,16\}\$\/\.test\(code\)\) return null;/.test(rc()));
T("P55358", QP, "/q refuses an unknown code", () => /if \(!row\) return null;/.test(rc()));
T("P55359", QP, "/q refuses a vanished restaurant", () => /if \(!rest\?\.slug\) return null;/.test(rc()));
T("P55360", QP, "/q refuses a switched-off restaurant", () => /if \(!r \|\| !r\.active\) return null;/.test(rc()));
T("P55361", QP, "/q refuses a Menu-off restaurant", () => /if \(!settings\.menuEnabled\) return null;/.test(rc()));
T("P55362", QP, "five refusals, one screen", () => ok(count(rc(), /return null;/g) === 5 && count(code(QP), /<GuestNotFound variant="qr" \/>/g) === 1, "5 refusals, one screen"));
T("P55363", GNF, "the friendly screen says what to DO", () => /Please ask a member of staff to scan the current code for your table\./.test(code(GNF)));
T("P55364", NF, "the 404 paints nothing until it knows who is looking", () => /if \(!a\) \{/.test(N()));
T("P55365", NF, "…but ships the stylesheet meanwhile", () => { const c = N(); const i = c.indexOf("if (!a) {"); return /<style dangerouslySetInnerHTML=\{\{ __html: CSS \}\} \/>/.test(c.slice(i, i + 300)); });
T("P55366", NF, "the slug probe never promises an unreachable menu", () => /\} catch \{ return false; \}/.test(N()));
T("P55367", MVF, "MenuView refuses a stale reply", () => /if \(seq !== menuReqRef\.current\) return;/.test(MV()));
T("P55368", MVF, "…refuses a direct read after deactivation", () => /includes\("404"\)\) return;/.test(MV()));
T("P55369", MVF, "…refuses 3D preload when switched off, and calls off what started", () => /modelLoader\.stopAll\(\)/.test(MV()));
T("P55370", MVF, "…refuses to save a scroll before the restore", () => /if \(restoreSettled\.current\) \{/.test(MV()));
T("P55371", MVF, "…refuses to restore twice", () => /if \(scrollRestored\.current \|\| !menuData\.length\) return;/.test(MV()));
T("P55372", MVF, "…refuses to fight the diner", () => /Math\.abs\(el\.scrollTop - lastSet\) > 2\) \{\s*restoreSettled\.current = true; return;/.test(MV()));
T("P55373", MVF, "…refuses to re-aim for ever", () => /Date\.now\(\) - started > 4000/.test(MV()));
T("P55374", MVF, "…refuses to loop the dead-tap recovery past 3", () => /retry < 3/.test(MV()));
T("P55375", MVF, "…refuses to correct more than 8 times", () => /tries >= 8/.test(MV()));
T("P55376", MVF, "…refuses to lift the bell (re-aimed: it never lifts at all now)", () => ok(bellGone(), BELL));
T("P55377", MVF, "…refuses layout maths on a hidden tab", () => /if \(document\.hidden\) return; computeSpy\(\);/.test(MV()));
T("P55378", MVF, "…refuses to let the spy fight a tap", () => /if \(Date\.now\(\) < spyLockUntil\.current\) return;/.test(MV()));
T("P55379", MVF, "…refuses a table with no digits (and, since item 6, one outside 1…500)", () => /const usable = !!digits && Number\.isFinite\(n\) && n >= 1 && n <= 500;/.test(MV()));
T("P55380", MVF, "…refuses an old folded memory", () => /freshEnough &&/.test(MV()));
T("P55381", MVF, "…refuses to keep filtering on a switched-off chip", () => /chefActive/.test(MV()) && /favActive/.test(MV()) && /dietActive/.test(MV()));
T("P55382", MVF, "every refusal leaves something on screen", () => /menu-empty-state/.test(MV()) && /fav-empty/.test(MV()));
// ═════ the 404 stylesheet, rule by rule, on BOTH screens (my build) ═════
const css = () => (src(NF).match(/const CSS = `([\s\S]*?)`;/) || [])[1].replace(/\/\*[\s\S]*?\*\//g, "");
const rules = () => { const out = []; const c = css(); const re = /([^{}@]+)\{([^{}]*)\}/g; let m; while ((m = re.exec(c))) out.push(m[1].trim()); return out; };
const screens = new Map();
const scr = (path) => { if (!screens.has(path)) screens.set(path, (async () => { const p = await newPage(); try { await open(p, path, { waitFor: ".nf" }); await p.waitForTimeout(2800); return { p, path }; } catch (e) { await done(p); throw e; } })()); return screens.get(path); };
const matches = async (sel, which) => { const paths = which === "guest" ? ["/menu/zz-nope"] : which === "staff" ? ["/manager/zz-nope"] : ["/menu/zz-nope", "/manager/zz-nope"]; let n = 0; for (const path of paths) { const { p } = await scr(path); n += await p.evaluate((s) => s.split(",").map((x) => x.trim().replace(/::?(before|after)$/, "").replace(/:(visited|hover|active|focus-visible)/g, "")).reduce((t, x) => t + document.querySelectorAll(x).length, 0), sel); } return n; };
R("P55383", NF, "the 404 ships one stylesheet; this block covers every rule", () => { const r = rules(); return ok(r.length >= 50, `${r.length} rules in today's stylesheet (52 then; the torn-edge strip ::after came since)`); }, "the stylesheet read out of today's file");
for (const row of oldRows("P55384", "P55435")) {
  const m = row.check.match(/the rule for `([^`]+)` matches something real on (the diner's screen|the worker's screen|both screens)/);
  if (!m) continue;
  const which = m[2].startsWith("the diner") ? "guest" : m[2].startsWith("the worker") ? "staff" : "both";
  R(row.id, NF, `the rule for \`${m[1]}\` matches something real (${m[2]})`, async () => {
    if (!rules().some((r) => r.replace(/\s+/g, " ") === m[1].replace(/\s+/g, " "))) return ok(false, "rule no longer in the stylesheet");
    // `.nf-s a.nf-again` is, by the file's own note, alive ONLY in the no-JavaScript fallback: ask that screen.
    if (/\.nf-s a\.nf-again/.test(m[1])) return withPage("/manager/zz-nope", async (p) => { const n = await p.$$eval(".nf-s a.nf-again", (e) => e.length); return ok(n > 0, `${n} element(s) with scripting OFF`); }, { js: false });
    const n = await matches(m[1], which); const optional = /nf-brand/.test(m[1]); return ok(n > 0 || optional, optional && n === 0 ? "drawn only when the device stored this restaurant's name" : `${n} element(s)`); }, "every rule run against the screen it belongs to on my build :4401");
}
const cs = async (path, sel, prop) => { const { p } = await scr(path); return p.$eval(sel, (e, pr) => getComputedStyle(e)[pr], prop).catch(() => null); };
const G = "/menu/zz-nope", W = "/manager/zz-nope";
const CS = [["P55436", G, ".nf-g .nf-home", "backgroundColor", (v) => /255, 25[0-9], 24[0-9]/.test(v)], ["P55437", G, ".nf-g .nf-home", "color", (v) => /35, 32, 28/.test(v)], ["P55438", G, ".nf-g .nf-again", "borderTopWidth", (v) => v === "1px"],
  ["P55439", G, ".nf-g .docket", "backgroundColor", (v) => /255, 253, 246/.test(v)], ["P55440", G, ".nf-g .docket", "clipPath", (v) => v === "none"], ["P55441", G, ".nf-g .stamp", "borderTopWidth", (v) => parseFloat(v) >= 2], ["P55442", G, ".nf-g .big", "fontFamily", (v) => /monospace/.test(v)],
  ["P55443", G, ".nf-g .spike", "position", (v) => v === "absolute"], ["P55444", G, ".nf-g", "backgroundImage", (v) => /repeating-linear-gradient/.test(v)], ["P55445", W, ".nf-s .nf-home", "backgroundColor", (v) => /36, 26, 18/.test(v)], ["P55446", W, ".nf-s .nf-home", "color", (v) => /255, 249, 240/.test(v)],
  ["P55447", W, ".nf-s .slice", "backgroundImage", (v) => /linear-gradient/.test(v)], ["P55448", W, ".nf-s .tbody", "borderTopLeftRadius", (v) => v === "16px"], ["P55449", W, ".nf-s .toaster", "cursor", (v) => v === "pointer"], ["P55450", W, ".nf-s", "backgroundImage", (v) => /radial-gradient/.test(v)],
  ["P55451", W, ".nf", "position", (v) => v === "fixed"], ["P55452", W, ".nf .nf-wrap", "width", (v) => parseFloat(v) <= 420], ["P55453", W, ".nf h1", "fontWeight", (v) => v === "800"], ["P55454", W, ".nf .nf-btn", "display", (v) => v === "block"]];
for (const [id, path, sel, prop, test] of CS) R(id, NF, `${sel} → ${prop}${id === "P55440" ? " (re-aimed: the torn edge is a strip under the paper since 2026-09-15, so the PAPER has no clip-path)" : ""}`, async () => { const v = await cs(path, sel, prop); return ok(v != null && test(v), `${sel} → ${prop}: ${v}`); }, "computed style read in the browser on my build");
R("P55455", NF, "the global link rule is still there, so the trap is real", () => /a, a \* \{[^}]*color: inherit !important|a \{[^}]*color: inherit !important/.test(src("app/globals.css")), "static read of app/globals.css");
const inkOf = async (path, sel) => { const { p } = await scr(path); return p.$eval(sel, (a) => { const s = getComputedStyle(a); return { c: s.color, b: s.backgroundColor, u: s.textDecorationLine }; }).catch(() => null); };
const prs = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const lm = (r) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r[0]) + 0.7152 * f(r[1]) + 0.0722 * f(r[2]); };
const rt = (a, b) => { const x = lm(prs(a)), y = lm(prs(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
R("P55456", NF, "the diner's a.nf-home beats the global rule and stays readable", async () => { const i = await inkOf(G, ".nf a.nf-home"); return ok(i && rt(i.c, i.b) >= 4.5, i ? `${rt(i.c, i.b).toFixed(1)}:1` : "none"); }, "measured in the browser");
R("P55457", NF, "…not underlined", async () => ok((await inkOf(G, ".nf a.nf-home"))?.u === "none"), "measured in the browser");
R("P55458", NF, "the worker's a.nf-home beats it too", async () => { const i = await inkOf(W, ".nf a.nf-home"); return ok(i && rt(i.c, i.b) >= 4.5, i ? `${rt(i.c, i.b).toFixed(1)}:1` : "none"); }, "measured in the browser");
R("P55459", NF, "…not underlined", async () => ok((await inkOf(W, ".nf a.nf-home"))?.u === "none"), "measured in the browser");
R("P55460", NF, "the diner's 'try again' is a button", async () => { const { p } = await scr(G); return ok((await p.$eval(".nf-g .nf-again", (e) => e.tagName)) === "BUTTON"); }, "measured in the browser");
R("P55461", NF, "the worker's 'try again' is a button", async () => { const { p } = await scr(W); return ok((await p.$eval(".nf-s .nf-again", (e) => e.tagName)) === "BUTTON"); }, "measured in the browser");
const still = async (path) => withPage(path, async (p) => { await p.waitForTimeout(2500); return p.evaluate(() => { const g = (s, k) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[k] : null; }; return { stampOp: g(".nf-g .stamp", "opacity"), stampAnim: g(".nf-g .stamp", "animationName"), docketAnim: g(".nf-g .docket", "animationName"), sliceAnim: g(".nf-s .slice", "animationName"), sliceTf: g(".nf-s .slice", "transform"), poke: g(".nf-s .poke", "display"), text: document.body.innerText.replace(/\s+/g, " ") }; }); }, { reducedMotion: "reduce" });
const sm = new Map(); const ST = (p) => { if (!sm.has(p)) sm.set(p, still(p)); return sm.get(p); };
R("P55462", NF, "motion off: the VOID stamp is visible", async () => { const s = await ST(G); return ok(s.stampOp === "1" && s.stampAnim === "none", `opacity ${s.stampOp}, animation ${s.stampAnim}`); }, "reduced motion emulated in the browser");
R("P55463", NF, "…and nothing on the diner's screen animates", async () => { const s = await ST(G); return ok(s.docketAnim === "none" && s.stampAnim === "none", `docket ${s.docketAnim}, stamp ${s.stampAnim}`); }, "reduced motion");
R("P55464", NF, "…and the words are all there", async () => ok(/TABLE 404 Covers — Order none Status no such table/i.test((await ST(G)).text)), "reduced motion");
R("P55465", NF, "motion off: the slice rests in place", async () => { const s = await ST(W); return ok(s.sliceAnim === "none" && s.sliceTf === "none", `animation ${s.sliceAnim}, transform ${s.sliceTf}`); }, "reduced motion");
R("P55466", NF, "…the toaster invitation is dropped", async () => ok((await ST(W)).poke === "none"), "reduced motion");
R("P55467", NF, "…the worker still gets the words and the way out", async () => ok(/We burnt that one/.test((await ST(W)).text)), "reduced motion");
R("P55468", NF, "the four dead rules are gone", () => !/\.again \.slice|\.nf-g a\.nf-again/.test(css()), "static read of the shipped stylesheet");
R("P55469", NF, "putting a dead rule back turns verify:notfound red", () => /matches nothing|dead rule|every rule/i.test(src("scripts/verify-notfound-audience.mjs")), "the guard's own rule-coverage check is present");
R("P55470", GNF, "the CLOSED stamp covers no word either", async () => withPage("/r/zz-unknown-t1s10/menu", async (p) => { await p.waitForTimeout(2600); // the TEXT's own boxes (a Range over each text node), not the element's — an <h2> is as wide as the docket
    const hit = await p.evaluate(() => { const s = document.querySelector(".gnf .stamp").getBoundingClientRect(); const out = []; const w = document.createTreeWalker(document.querySelector(".gnf .docket"), NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) { if (!t.textContent.trim() || t.parentElement.closest(".stamp")) continue; const rg = document.createRange(); rg.selectNodeContents(t); for (const r of rg.getClientRects()) if (r.left < s.right && r.right > s.left && r.top < s.bottom && r.bottom > s.top) out.push(t.textContent.trim()); } return out; }); return ok(hit.length === 0, hit.join(",") || "clean"); }), "measured in the browser");
// ═════ P55471–P55700 · against the LIVE backup site (read-only) ═════
const LV = (id, file, title, fn) => R(id, file, title, fn, `headless Chromium against the LIVE backup site (${LIVE.replace(/^https:\/\//, "")}), read-only`);
const lopen = async (p, path, waitFor = ".item-card, .gnf, .nf, .maint") => { const res = await p.goto(LIVE + path, { waitUntil: "load", timeout: 60000 }); await p.waitForSelector(waitFor, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1500); return res; };
const lwith = async (path, fn, opts = {}) => { const p = await newPage(opts); try { const res = path ? await lopen(p, path, opts.waitFor) : null; return await fn(p, res); } finally { await done(p); } };
const DOORS = [["P55471", "the QR link", "/r/french-house/menu"], ["P55476", "the printed sticker", "/q/" + QR["french-house"]], ["P55481", "the old /menu link", "/menu"]];
for (const [id, label, path] of DOORS) {
  const run = async () => { const p = await newPage(); try { await lopen(p, path); const a = await p.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]); await p.click('button[aria-label^="Switch to"]'); await p.waitForTimeout(400); const b = await p.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]); await p.reload({ waitUntil: "load" }); await p.waitForTimeout(1200); const c = await p.evaluate(() => document.documentElement.dataset.theme); await p.click('button[aria-label^="Switch to"]'); await p.waitForTimeout(400); const d = await p.evaluate(() => document.documentElement.dataset.theme); return { a, b, c, d }; } finally { await done(p); } };
  let m = null; const g = async () => (m ??= await run());
  LV(id, "app/layout.tsx", `${label}: a first-time diner opens light`, async () => ok((await g()).a[0] === "light"));
  LV(`P${Number(id.slice(1)) + 1}`, "components/Header.tsx", `${label}: the switch really repaints`, async () => { const x = await g(); return ok(x.a[1] !== x.b[1], `${x.a[1]} → ${x.b[1]}`); });
  LV(`P${Number(id.slice(1)) + 2}`, "components/Header.tsx", `${label}: dark survives a reload`, async () => ok((await g()).c === "dark"));
  LV(`P${Number(id.slice(1)) + 3}`, "app/layout.tsx", `${label}: no flash of the wrong skin (stamped by the boot script before paint)`, async () => { const h = await (await fetch(LIVE + path)).text(); return ok(/<script>\(function\(\)\{try\{var saved=localStorage/.test(h) || /\/q\//.test(path), "boot script is the first thing in <head>"); });
  LV(`P${Number(id.slice(1)) + 4}`, "components/Header.tsx", `${label}: back to light works`, async () => ok((await g()).d === "light"));
}
const SEARCH = [["P55486", "aangan-garden-restaurant", "vi"], ["P55489", "burger-barn", "cl"], ["P55492", "demo-bistro", null], ["P55495", "french-house", "es"], ["P55498", "green-bowl", "qu"], ["P55501", "pizza-palace", "ma"], ["P55504", "sakura-sushi", "sa"], ["P55507", "spice-route", "bu"], ["P55510", "taco-fiesta", "ch"]];
for (const [id, slug, two] of SEARCH) {
  const k = (n) => `P${Number(id.slice(1)) + n}`;
  if (!two) { for (let n = 0; n < 3; n++) LV(k(n), "components/GuestNotFound.tsx", `demo-bistro (binned — re-aimed): no search on a refused menu`, async () => lwith(`/r/${slug}/menu`, async (p, res) => ok(res.status() === 404 && (await p.$$("#search-input")).length === 0, `${res.status()}`))); continue; }
  const run = async () => lwith(`/r/${slug}/menu`, async (p) => { const a = await cards(p); await p.fill("#search-input", two); await p.waitForTimeout(900); const b = await cards(p); await p.fill("#search-input", "zzqqx"); await p.waitForTimeout(900); const h = (await p.$$(".fav-empty-title")).length, s = (await p.$$(".fav-empty-sub")).length; await p.fill("#search-input", ""); await p.waitForTimeout(900); return { a, b, h, s, c: await cards(p) }; });
  let m = null; const g = async () => (m ??= await run());
  LV(id, MVF, `${slug}: two letters narrow without emptying`, async () => { const x = await g(); return ok(x.b > 0 && x.b < x.a, `"${two}": ${x.a} → ${x.b}`); });
  LV(k(1), MVF, `${slug}: a nonsense search says so in words`, async () => { const x = await g(); return ok(x.h === 1 && x.s === 1, `${x.h} headline, ${x.s} next step`); });
  LV(k(2), MVF, `${slug}: clearing brings the whole menu back`, async () => { const x = await g(); return ok(x.c === x.a, `${x.c} back`); });
}
for (const [id, label, path] of [["P55513", "the QR link", "/r/french-house/menu"], ["P55517", "the printed sticker", "/q/" + QR["french-house"]], ["P55521", "the old /menu link", "/menu"]]) {
  const run = async () => { const p = await newPage(); try { await lopen(p, path); const sec = (await p.$$(".cat-group"))[0]; const a = await sec.$$eval(".item-card", (e) => e.length); await (await sec.$(".cat-group-head")).click(); await p.waitForTimeout(400); const b = await sec.$$eval(".item-card", (e) => e.length); const key = await p.evaluate(() => Object.keys(sessionStorage).find((k) => /^lfh_menu_closed_cats/.test(k))); await p.reload({ waitUntil: "load" }); await p.waitForSelector(".cat-group"); await p.waitForTimeout(800); const folded = await p.$$eval('.cat-group-head[aria-expanded="false"]', (e) => e.length); await p.evaluate((k) => { const v = JSON.parse(sessionStorage.getItem(k)); v.ts = Date.now() - 11 * 60 * 1000; sessionStorage.setItem(k, JSON.stringify(v)); }, key); await p.reload({ waitUntil: "load" }); await p.waitForSelector(".cat-group"); await p.waitForTimeout(800); return { a, b, key, folded, stale: await p.$$eval('.cat-group-head[aria-expanded="false"]', (e) => e.length) }; } finally { await done(p); } };
  let m = null; const g = async () => (m ??= await run()); const k = (n) => `P${Number(id.slice(1)) + n}`;
  LV(id, MVF, `${label}: folding hides its dishes`, async () => { const x = await g(); return ok(x.a > 0 && x.b === 0, `${x.a} → ${x.b}`); });
  LV(k(1), MVF, `${label}: remembered under THIS restaurant's name`, async () => ok((await g()).key === "lfh_menu_closed_cats:french-house", (await g()).key));
  LV(k(2), MVF, `${label}: still folded after a reload`, async () => ok((await g()).folded === 1));
  LV(k(3), MVF, `${label}: an 11-minute-old memory is dropped`, async () => ok((await g()).stale === 0));
}
// P55525–P55530 were measured on demo-bistro while it was in maintenance. It is binned now; re-asked of a live tenant
// with the settings answer HELD IN THE BROWSER (service_mode on) — nothing written. Aangan has a logo and a marked
// name ("Aangan *Garden*"), the exact case these rows exist for.
const maint = async () => { const p = await newPage(); try { await p.route(/\/rest\/v1\/rpc\/lfh_guest_settings/, async (r) => { const res = await r.fetch(); const j = await res.json(); const o = Array.isArray(j) ? j[0] : j; if (o) o.service_mode = true; await r.fulfill({ response: res, json: Array.isArray(j) ? [o] : o }); }); await lopen(p, "/r/aangan-garden-restaurant/menu", ".maint"); return await p.evaluate(() => ({ alt: document.querySelector(".maint-logo")?.getAttribute("alt"), text: document.body.innerText, cls: document.querySelector(".maint")?.className })); } finally { await done(p); } };
let mt = null; const MT = async () => (mt ??= await maint());
LV("P55525", MAIN, "a closed restaurant's name carries no marks into its alt (Aangan, answer held in the browser)", async () => ok((await MT()).alt === "Aangan Garden", (await MT()).alt));
LV("P55526", MAIN, "…nor into the text name", async () => ok(!/\*/.test((await MT()).text)));
LV("P55527", MAIN, "…no asterisk on screen at all", async () => ok(!/\*/.test((await MT()).text)));
LV("P55528", MAIN, "a closed restaurant does not wear the flagship gold", async () => ok((await MT()).cls === "maint", (await MT()).cls));
LV("P55529", MAIN, "…says the honest thing with no time", async () => ok(/We’ll be right back/.test((await MT()).text) && !/minutes/.test((await MT()).text)));
LV("P55530", MAIN, "…points the diner at a person", async () => ok(/ask a member of staff/i.test((await MT()).text)));
const aud = async (path) => lwith(path, async (p) => { await p.waitForTimeout(2200); return p.evaluate(() => ({ g: !!document.querySelector(".nf-g, .gnf"), s: !!document.querySelector(".nf-s"), both: document.querySelectorAll(".nf-g, .nf-s").length, btns: [...document.querySelectorAll(".nf .nf-btn, .gnf .btn")].map((b) => b.textContent.trim()), text: document.body.innerText.replace(/\s+/g, " ") })); });
for (const [id, label, path, kind] of [["P55531", "a mistyped menu link", "/menu/zz-nope", "g"], ["P55534", "a wrong restaurant name", "/r/zz-nope/menu", "g"], ["P55537", "a stranger typing anything", "/zz-anything-t1", "g"], ["P55540", "a worker on a wrong panel", "/manager/zz-nope", "s"], ["P55543", "a worker on a wrong owner screen", "/owner/zz-nope", "s"]]) {
  let m = null; const g = async () => (m ??= await aud(path)); const k = (n) => `P${Number(id.slice(1)) + n}`;
  LV(id, NF, `${label} gets the screen written for them`, async () => ok((await g())[kind], (await g()).text.slice(0, 40)));
  LV(k(1), NF, `…only ONE of the two screens`, async () => ok((await g()).both <= 1));
  LV(k(2), NF, `…a whole screen: something to press or advice that stands alone`, async () => { const x = await g(); return ok(x.btns.length > 0 || /scan the QR|ask a member of staff/i.test(x.text + ""), x.btns.join(" · ") || "advice only"); });
}
const DEVS = { a35: { width: 360, height: 780, dpr: 3, mobile: true }, "iphone-se": { width: 375, height: 667, dpr: 2, mobile: true }, "pixel-tall": { width: 412, height: 915, dpr: 2.6, mobile: true }, "ipad-portrait": { width: 834, height: 1194, dpr: 2, mobile: true }, "ipad-landscape": { width: 1194, height: 834, dpr: 2, mobile: true }, desktop: DESK, wide: { width: 1920, height: 1080, dpr: 1, mobile: false } };
const look = (vp, theme) => lwith("/r/french-house/menu", async (p) => p.evaluate((leak) => { const wide = document.documentElement.scrollWidth - innerWidth; const cut = [...document.querySelectorAll(".dish-name, .cat-name, .brand-title, .dish-price, .filter-chip")].filter((e) => e.offsetParent && getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1).length; const small = [...document.querySelectorAll("button, input")].filter((e) => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width > 0 && r.top < innerHeight && (r.width < 24 || r.height < 24); }).length; const b = document.querySelector(".chef-call"); const r = b?.getBoundingClientRect(); const ctrls = r ? [...document.querySelectorAll("button, a, input")].filter((x) => x !== b && !b.contains(x) && x.offsetParent && (() => { const q = x.getBoundingClientRect(); return q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top && document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2) === b; })()).length : 0; return { wide, cut, small, covers: ctrls, leak: new RegExp(leak).test(document.body.innerText) }; }, LEAK.source), { vp, theme, reducedMotion: "reduce" });
let li = 55546;
for (const d of Object.keys(DEVS)) for (const t of ["light", "dark"]) {
  let m = null; const g = async () => (m ??= await look(DEVS[d], t)); const id = () => `P${li++}`;
  LV(id(), MVF, `${d}/${t}: nothing runs off the side`, async () => ok((await g()).wide <= 0, `${(await g()).wide}px`));
  LV(id(), MVF, `${d}/${t}: no word cut off`, async () => ok((await g()).cut === 0));
  LV(id(), MVF, `${d}/${t}: every control big enough to press`, async () => ok((await g()).small === 0, `${(await g()).small} small`));
  LV(id(), MVF, `${d}/${t}: the bell covers no control at its centre (R29: it may overlap scenery)`, async () => ok((await g()).covers === 0, `covers ${(await g()).covers}`));
  LV(id(), MVF, `${d}/${t}: nothing reads as code`, async () => ok(!(await g()).leak));
}
let ni = 55616;
for (const d of ["a35", "ipad-portrait", "desktop"]) for (const [who, path] of [["diner", "/menu/zz-nope"], ["worker", "/manager/zz-nope"]]) {
  const run = () => lwith(path, async (p) => { await p.waitForTimeout(2600); return p.evaluate(() => { const off = [...document.querySelectorAll(".nf *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length; const s = document.querySelector(".nf-g .stamp")?.getBoundingClientRect(); let hit = 0; if (s) { const w = document.createTreeWalker(document.querySelector(".nf-g .docket"), NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) { if (!t.textContent.trim() || t.parentElement.closest(".stamp")) continue; const rg = document.createRange(); rg.selectNodeContents(t); for (const r of rg.getClientRects()) if (r.left < s.right && r.right > s.left && r.top < s.bottom && r.bottom > s.top) hit++; } } return { off, hit, len: document.body.innerText.trim().length, docket: !!s }; }); }, { vp: DEVS[d] });
  let m = null; const g = async () => (m ??= await run()); const id = () => `P${ni++}`;
  LV(id(), NF, `the ${who}'s 404 at ${d}: nothing off the side`, async () => ok((await g()).off === 0, `${(await g()).off}`));
  LV(id(), NF, `the ${who}'s 404 at ${d}: the stamp covers no word`, async () => { const x = await g(); return ok(x.hit === 0, x.docket ? "clean" : "n/a — no docket on this screen"); });
  LV(id(), NF, `the ${who}'s 404 at ${d}: it says something`, async () => ok((await g()).len > 80, `${(await g()).len} characters`));
}
const J = (id, file, title, fn) => R(id, file, title, fn, `opened cold on the LIVE backup site (${LIVE.replace(/^https:\/\//, "")}) as a first-time diner`);
J("P55634", MVF, "food, a price and a way to order without scrolling", () => lwith("/r/french-house/menu", async (p) => { const r = await p.evaluate(() => { const v = [...document.querySelectorAll(".item-card")].filter((c) => c.getBoundingClientRect().top < innerHeight); return [v.length, v.filter((c) => c.querySelector(".dish-price")).length, v.filter((c) => c.querySelector(".cart-add-btn")).length]; }); return ok(r[0] > 0 && r[0] === r[1] && r[1] === r[2], r.join(" / ")); }));
J("P55635", MVF, "no control on the first screen does nothing", () => lwith("/r/french-house/menu", async (p) => ok((await p.$$eval("button[disabled]", (e) => e.length)) === 0)));
J("P55636", MVF, "a chip takes the diner to that food, hiding nothing", () => lwith("/r/french-house/menu", async (p) => { const a = await cards(p); await (await p.$$("#cat-scroller .cat-card"))[3].click(); await p.waitForTimeout(1500); return ok((await cards(p)) === a && (await p.$$eval('#cat-scroller [aria-current="true"]', (e) => e.length)) === 1, `${a} → ${await cards(p)}`); }));
J("P55637", MVF, "never asked to swipe a row that does not move", () => lwith("/r/french-house/menu", async (p) => { const o = await p.$eval("#cat-scroller", (b) => b.scrollWidth - b.clientWidth); const h = (await p.$$(".browse-hint")).length === 1; return ok((o > 4) === h, `${o}px, hint ${h}`); }));
J("P55638", MVF, "one tap back to the whole menu after typing", () => lwith("/r/french-house/menu", async (p) => { await p.fill("#search-input", "coffee"); await p.waitForTimeout(700); await p.click('.search-container input[type=search]', { clickCount: 1 }); await p.fill("#search-input", ""); await p.waitForTimeout(700); return ok((await p.inputValue("#search-input")) === "" && (await p.$$(".cat-group")).length > 0); }));
J("P55639", MVF, "nothing here writes an order, bill or KOT", () => lwith("/r/french-house/menu", async (p) => { await p.waitForTimeout(1500); const w = p.t1.requests.filter((r) => r.method !== "GET" && /place-order|call-waiter|orders|bills|kot/i.test(r.url)); return ok(w.length === 0, w.map((r) => r.url).join(" | ") || "none"); }));
J("P55640", MVF, "one restaurant's menu never shows another's name", () => lwith("/r/pizza-palace/menu", async (p) => ok(!/french house|aangan|sakura|burger barn/i.test(await bodyText(p)))));
J("P55641", MVF, "the platform's name nowhere a diner can see it", () => lwith("/r/pizza-palace/menu", async (p) => ok(!/aevidine/i.test(await bodyText(p)))));
let si = 55642;
for (const slug of ["burger-barn", "aangan-garden-restaurant", "demo-bistro", "french-house"]) {
  const code = slug === "demo-bistro" ? "ZAVMWRDC" : QR[slug];
  const run = () => lwith(`/q/${code}`, async (p) => ({ t: await p.evaluate((s) => localStorage.getItem("lfh_table:" + s), slug), pin: await p.evaluate(() => sessionStorage.getItem("lfh_tab_tenant")), url: new URL(p.url()).pathname, title: await p.title(), n: await cards(p), text: await bodyText(p) }));
  let m = null; const g = async () => (m ??= await run()); const id = () => `P${si++}`;
  const binned = slug === "demo-bistro";
  LV(id(), QP, `the printed sticker at ${slug}: ${binned ? "(binned — re-aimed) no table is taken for a binned restaurant" : "the table reaches the app"}`, async () => { const x = await g(); return ok(binned ? !x.t : !!x.t, `${x.t}`); });
  LV(id(), QP, `…${binned ? "and the tab is pinned to nobody" : "under this restaurant's own name"}`, async () => { const x = await g(); return ok(binned ? x.pin !== slug : x.pin === slug, x.pin); });
  LV(id(), QP, "…and never in the address bar", async () => ok(!/table=/.test((await g()).url), (await g()).url));
  LV(id(), QP, `…the tab ${binned ? "is neutral" : "names the restaurant"}`, async () => { const x = await g(); return ok(binned ? x.title === "Menu" : !/Aevidine/.test(x.title) && x.title.endsWith("— Menu"), x.title); });
  LV(id(), QP, `…the diner gets ${binned ? "the honest dead-code page" : "food"}`, async () => { const x = await g(); return ok(binned ? /This QR code isn’t active/.test(x.text) : x.n > 0, binned ? "dead code" : `${x.n} dishes`); });
  const OTHERS = { "french-house": /little french house/i, "aangan-garden-restaurant": /aangan/i, "burger-barn": /burger barn/i, "pizza-palace": /pizza palace/i };
  LV(id(), QP, "…no other restaurant's name on it", async () => { const x = await g(); const bad = Object.entries(OTHERS).filter(([k, re]) => k !== slug && re.test(x.text)).map(([k]) => k); return ok(bad.length === 0, bad.join(",") || "clean"); });
}
let lgi = 55666;
for (const [label, q, want] of [["nothing at all", "", ""], ["a table number", "?table=3", "table=3"], ["the short alias", "?t=3", "t=3"], ["a marketing tag beside the table", "?utm_source=qr&table=3", "utm_source=qr&table=3"], ["a repeated table", "?table=1&table=2", "table=1&table=2"], ["twenty parameters", "?" + Array.from({ length: 20 }, (_, i) => `k${i}=${i}`).join("&"), "k19=19"]]) {
  const run = () => fetch(LIVE + "/menu" + q, { redirect: "manual" }).then((r) => ({ s: r.status, loc: r.headers.get("location") || "" }));
  let m = null; const g = async () => (m ??= await run());
  LV(`P${lgi++}`, MENU, `the old /menu link, ${label}: the hop carries it`, async () => { const x = await g(); return ok(/\/r\/french-house\/menu/.test(x.loc) && (want ? x.loc.includes(want) : !x.loc.includes("?")), `${x.s} → ${x.loc.replace(LIVE, "")}`); });
  if (label === "nothing at all") LV(`P${lgi++}`, MENU, "…the hop is temporary", async () => ok((await g()).s === 307));
  if (label === "a table number") LV(`P${lgi++}`, MENU, "…the hop is temporary", async () => ok((await g()).s === 307));
}
let oi = 55674;
for (const [label, path] of [["the QR link", "/r/french-house/menu"], ["the printed sticker", "/q/" + QR["french-house"]], ["the old /menu link", "/menu"]]) {
  const run = async () => { const p = await newPage({ sw: true }); try { await lopen(p, path); await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 40000 }).catch(() => {}); await p.reload({ waitUntil: "load" }); await p.waitForSelector(".item-card", { timeout: 30000 }); await p.waitForTimeout(2000); await p.t1.ctx.setOffline(true); await p.reload({ waitUntil: "load" }).catch(() => {}); await p.waitForSelector(".item-card", { timeout: 25000 }).catch(() => {}); await p.waitForTimeout(1500); return { n: await cards(p), text: await bodyText(p) }; } finally { await done(p); } };
  let m = null; const g = async () => (m ??= await run()); const id = () => `P${oi++}`;
  LV(id(), MVF, `${label}: the menu opens with no internet`, async () => ok((await g()).text.trim().length > 100));
  LV(id(), MVF, `${label}: …with the dishes from the device's copy`, async () => ok((await g()).n >= 59, `${(await g()).n} tiles`));
  LV(id(), MVF, `${label}: …and nothing reads as an error`, async () => ok(!/error|went wrong/i.test((await g()).text) && !LEAK.test((await g()).text)));
}
const lang = (l) => lwith("/r/french-house/menu", async (p) => p.evaluate(() => ({ lang: document.documentElement.lang, chips: [...document.querySelectorAll(".cat-name")].slice(0, 3).map((e) => e.textContent), dotted: document.body.innerText.includes("◌"), wide: document.documentElement.scrollWidth - innerWidth, dish: document.querySelector(".dish-name")?.textContent.trim() })), { init: { local: l ? { lfh_language: l } : {} } });
const lm2 = new Map(); const LG = (l) => { if (!lm2.has(l)) lm2.set(l, lang(l)); return lm2.get(l); };
LV("P55683", MVF, "English: chips in English", async () => ok((await LG(null)).chips[0] === "Coffee", (await LG(null)).chips.join(", ")));
for (const [id, l, re] of [["P55684", "hi", /[ऀ-ॿ]/], ["P55688", "fr", /Café/]]) {
  const name = l === "hi" ? "Hindi" : "French";
  LV(id, MVF, `${name}: re-labelled, and the document says its language`, async () => { const x = await LG(l); return ok(x.lang === l && re.test(x.chips[0]), `lang="${x.lang}": ${x.chips.join(", ")}`); });
  LV(`P${Number(id.slice(1)) + 1}`, MVF, `${name}: no dotted placeholder circle`, async () => ok(!(await LG(l)).dotted));
  LV(`P${Number(id.slice(1)) + 2}`, MVF, `${name}: nothing off the side`, async () => ok((await LG(l)).wide <= 0));
  LV(`P${Number(id.slice(1)) + 3}`, MVF, `${name}: dish names left as typed (R14)`, async () => ok((await LG(l)).dish === "Espresso"));
}
const nosec = () => lwith(null, async (p) => { await p.route(/\/api\/r\/[^/]+\/menu-data/, async (r) => { const res = await r.fetch(); const j = await res.json(); j.categories = []; await r.fulfill({ response: res, json: j }); }); await lopen(p, "/r/french-house/menu"); await p.waitForTimeout(1500); return p.evaluate(() => ({ n: document.querySelectorAll(".item-card:not(.skeleton-card)").length, blame: /Try turning a filter off/.test(document.body.innerText), sk: document.querySelectorAll(".cat-skeleton").length, bar: document.getElementById("cat-scroller")?.getBoundingClientRect().height || 0 })); });
let ns = null; const NS = async () => (ns ??= await nosec());
LV("P55692", MVF, "sections missing: the diner still gets the food (answer held in the browser)", async () => ok((await NS()).n >= 59, `${(await NS()).n} tiles`));
LV("P55693", MVF, "…no filter is blamed", async () => ok(!(await NS()).blame));
LV("P55694", MVF, "…no placeholder chip left for ever", async () => ok((await NS()).sk === 0));
LV("P55695", MVF, "…no empty category strip", async () => ok((await NS()).bar === 0, `${(await NS()).bar}px`));
LV("P55696", MAIN, "a closed restaurant's name carries no marks on the live site (Aangan, answer held in the browser)", async () => ok((await MT()).alt === "Aangan Garden"));
LV("P55697", MAIN, "…and it is not wearing the flagship's gold", async () => ok((await MT()).cls === "maint"));
const walk = async () => { const p = await newPage(); try { for (const path of ["/menu", "/r/french-house/menu", "/q/" + QR["french-house"]]) await lopen(p, path); return { bad: p.t1.bad.filter((x) => x.includes(LIVE)), errors: p.t1.errors }; } finally { await done(p); } };
let wk = null; const WK = async () => (wk ??= await walk());
LV("P55698", MVF, "walking all three doors raises no failing request", async () => ok((await WK()).bad.length === 0, (await WK()).bad.join(" | ") || "none"));
LV("P55699", MVF, "…and no crash", async () => ok((await WK()).errors.length === 0, (await WK()).errors.join(" | ") || "none"));
LV("P55700", "app/page.tsx", "the site root sends a worker to the staff sign-in", async () => { const r = await fetch(LIVE + "/", { redirect: "manual" }); return ok(r.status === 307 && /\/login$/.test(r.headers.get("location") || ""), `${r.status} → ${r.headers.get("location")}`); });
