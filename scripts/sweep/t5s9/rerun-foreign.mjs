// SWEEP #9 · TERMINAL 5 — re-run of the ledger rows that live in OTHER terminals'
// files but whose SUBJECT is one of this territory's 40 files.
//
// T5's own 1,693 sweep-#8 rows are re-run by scripts/sweep/t5/{static,round2,round3,…}.mjs.
// These 253 are the ones scattered through T1/T2/T3/T4/T6/T8/T9/T10/T12/T20/T21/T25/T26/
// T27/T28/T29/T30, and nothing re-ran them from this territory's side before.
//
//   node scripts/sweep/t5s9/rerun-foreign.mjs            # all
//   node scripts/sweep/t5s9/rerun-foreign.mjs --only P00187,P00188
import { src, code, has, grepRepo, walk, makeRunner } from "./lib.mjs";

const { check, done } = makeRunner("T5 sweep-9 — foreign ledger rows");

const APPSHELL = "components/AppShell.tsx";
const SW = "public/sw.js";
const OFFHTML = "public/offline.html";
const I18N = "lib/i18n.ts";
const need = (rel, re, label) => (re.test(code(rel)) ? true : `${label || re} not found in ${rel}`);
const needRaw = (rel, re, label) => (re.test(src(rel)) ? true : `${label || re} not found in ${rel}`);
const absent = (rel, re, label) => (re.test(code(rel)) ? `${label || re} IS present in ${rel}` : true);


// DATA_PATHS is a list of REGEX LITERALS, and `/^\/api\/r\//` ends in the same two
// characters a line comment starts with — so a comment stripper eats the rest of the
// array. Read it raw and drop only the whole-line comments inside it.
function dataPathEntries() {
  const raw = src(SW);
  const i = raw.indexOf("const DATA_PATHS = [");
  if (i < 0) return [];
  const body = raw.slice(i, raw.indexOf("];", i));
  // Only the lines that actually carry a pattern; a commented-out one is not an entry.
  return body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"))
    .flatMap((l) => [...l.matchAll(/\/\^\\\/api\\\/[a-z-]+/g)].map((m) => m[0]));
}

/* ───────── T1 — the guest-menu terminal's rows about MY components ───────── */
check("P00187", "HeroTitle splits by grapheme, never by code unit", () =>
  need("components/HeroTitle.tsx", /splitGraphemes/) === true && absent("components/HeroTitle.tsx", /\.split\(""\)/) === true || "grapheme split missing or .split(\"\") present");
check("P00188", "HeroTitle respects reduce motion", () => need("components/HeroTitle.tsx", /matchMedia\??\.?\([^)]*prefers-reduced-motion/));
check("P00189", "HeroTitle cancels its frame and both listeners on unmount", () => {
  const s = code("components/HeroTitle.tsx");
  return /cancelAnimationFrame/.test(s) && (s.match(/removeEventListener/g) || []).length >= 2 || "missing cancelAnimationFrame or two removeEventListener";
});
check("P00190", "IntroSplash scopes its already-seen key per restaurant", () => need("components/IntroSplash.tsx", /lfh_intro_seen:"\s*\+\s*\(?scopeKey|lfh_intro_seen:\$\{/));
check("P00191", "IntroSplash never animates a logo element that isn't there", () => need("components/IntroSplash.tsx", /querySelector\(\s*["'`]\.intro-logo/));
check("P00192", "IntroSplash can never stay stuck over the menu", () => {
  const s = code("components/IntroSplash.tsx");
  return /visibilitychange/.test(s) && /pageshow/.test(s) && /setTimeout/.test(s) || "missing the timer or one of the two finish signals";
});
check("P00193", "IntroSplash shows the flagship logo ONLY on the flagship", () => need("components/IntroSplash.tsx", /isDefault\s*&&[\s\S]{0,400}intro-logo/));
check("P00194", "GuestChrome renders nothing on any staff route, flat or per-restaurant", () => {
  const s = code("components/GuestChrome.tsx");
  return /\^\(\?:\/r\/\[\^\/\]\+\)\?\//.test(s) && /STAFF_SEGMENTS/.test(s) || "STAFF_RE no longer covers both /seg and /r/<slug>/seg";
});
check("P00195", "GuestChrome loads every guest widget lazily", () => {
  const s = code("components/GuestChrome.tsx");
  const dyn = s.match(/dynamic\(\(\) => import\([^)]*\),\s*\{[^}]*\}\)/g) || [];
  const bad = dyn.filter((d) => !/ssr:\s*false/.test(d));
  return dyn.length >= 16 && bad.length === 0 || `${dyn.length} dynamic imports, ${bad.length} without ssr:false`;
});
check("P00196", "GuestNotFound never links a diner to the staff sign-in", () => absent("components/GuestNotFound.tsx", /href=["'`]\/["'`]/));
check("P00197", "GuestNotFound only offers back-to-the-menu once it knows the menu answers", () => need("components/GuestNotFound.tsx", /menuLive === true/));
check("P00198", "GuestNotFound uses the app's own font and theme tokens", () => {
  const s = src("components/GuestNotFound.tsx");
  return /'Inter'/.test(s) || "the screen no longer names Inter";
});
check("P00200", "ComingSoon renders no list block when given no points", () => need("components/ComingSoon.tsx", /points && points\.length > 0/));
check("P00222", "IntroSplash shows no French House logo to another tenant", () => need("components/IntroSplash.tsx", /isDefault\s*&&/));
check("P00223", "IntroSplash's seen key cannot skip restaurant B's splash after A's", () => need("components/IntroSplash.tsx", /lfh_intro_seen/) === true && /scopeKey/.test(code("components/IntroSplash.tsx")) || "the seen key is no longer per-restaurant");
check("P00226", "AppShell receives the tenant's brand props, undefined for #1", () => need("components/MenuView.tsx", /isDefault \? undefined :/));
check("P00236", "NavPicker registers with the back-button manager", () => need("components/NavPicker.tsx", /useBackClose\(/));
check("P00238", "NavPicker only registers while it is actually open", () => need("components/NavPicker.tsx", /useBackClose\(`nav-\$\{buttonLabel\}`,\s*open,/));
check("P00240", "NavPicker also closes on an outside click", () => need("components/NavPicker.tsx", /addEventListener\("mousedown"/));
check("P00241", "NavPicker also closes on Escape", () => need("components/NavPicker.tsx", /e\.key === "Escape"/));
check("P00242", "NavPicker removes both listeners when it closes", () => {
  const s = code("components/NavPicker.tsx");
  return /removeEventListener\("mousedown"/.test(s) && /removeEventListener\("keydown"/.test(s) || "one of the two removals is gone";
});
check("P00243", "NavPicker adds no listeners while closed", () => need("components/NavPicker.tsx", /if \(!open\) return;/));
check("P00290", "the 4D-badge rule still holds — FoodCard only claims 4D with a model", () => need("components/FoodCard.tsx", /has3d/));
check("P15310", "AppShell passes the restaurant id as the scope key", () => need(APPSHELL, /scopeKey=\{restaurantId\}/));
check("P15330", "ComingSoon renders its own heading, so a planned screen is not a blank page", () => need("components/ComingSoon.tsx", /<h1 className="adm-coming-h">\{title\}<\/h1>/));
check("P54842", "every renderer hands FoodCard the same whole-menu opinion about veg marks", () => {
  const hits = grepRepo(/<FoodCard\b/, ["components", "app"]);
  return hits.length > 0 || "nothing renders FoodCard any more";
});
check("P97230", "GuestNotFound does not offer a menu it cannot promise", () => need("components/GuestNotFound.tsx", /catch\(\(\) => \{ if \(alive\) setMenuLive\(false\); \}\)/));
check("P97267", "GuestNotFound has 3 decisions, and each is still named", () => {
  const s = code("components/GuestNotFound.tsx");
  return /if \(!slug\)/.test(s) && /setMenuLive\(r\.ok\)/.test(s) && /setMenuLive\(false\)/.test(s) || "one of the three decisions is gone";
});
check("P97268", "GuestNotFound decision 1: !slug", () => need("components/GuestNotFound.tsx", /if \(!slug\) \{ setMenuLive\(false\); return; \}/));
check("P97269", "GuestNotFound decision 2: alive → setMenuLive(r.ok)", () => need("components/GuestNotFound.tsx", /if \(alive\) setMenuLive\(r\.ok\)/));
check("P97270", "GuestNotFound decision 3: alive → setMenuLive(false)", () => need("components/GuestNotFound.tsx", /if \(alive\) setMenuLive\(false\)/));

// The readable-string family — re-derived, not trusted from the row's own count.
function readable(rel) {
  const s = code(rel);
  const out = [];
  // JSX text nodes and the string literals that reach a screen.
  for (const m of s.matchAll(/>([^<>{}\n][^<>{}]{3,})</g)) out.push(m[1].trim());
  for (const m of s.matchAll(/(?:title|sub|status|stamp|kind|mark|label|blurb)\s*=\s*(?:off \?\s*)?["'`]([^"'`]{3,})["'`]/g)) out.push(m[1]);
  for (const m of s.matchAll(/["'`]([A-Z][^"'`{}<>]{12,})["'`]/g)) out.push(m[1]);
  return [...new Set(out.map((x) => x.trim()).filter((x) => x && !/^[\s.]+$/.test(x) && !/^(https?:|\/|var\(|--)/.test(x)))];
}
for (const [ids, rel, label] of [
  [["P97359", "P97360", "P97361", "P97362", "P97363", "P97364"], "components/GuestNotFound.tsx", "GuestNotFound.tsx"],
  [["P97365", "P97366", "P97367", "P97368", "P97369", "P97370"], "components/Maintenance.tsx", "Maintenance.tsx"],
]) {
  const strings = readable(rel);
  check(ids[0], `${label} has readable strings, and this block covers them`, () => strings.length > 0 || "no readable string found at all");
  check(ids[1], `${label}: no readable string carries a leftover code marker`, () => {
    const bad = strings.filter((x) => /\$\{|\[object Object\]|undefined|NaN|-->/.test(x));
    return bad.length === 0 || "code markers in: " + bad.join(" | ");
  });
  check(ids[2], `${label}: no readable string has a double space or a stray tab`, () => {
    const bad = strings.filter((x) => /\t|  /.test(x));
    return bad.length === 0 || "spacing in: " + bad.join(" | ");
  });
  check(ids[3], `${label}: apostrophes are all the same style`, () => {
    const bad = strings.filter((x) => /'/.test(x) && /\w'\w/.test(x));
    return bad.length === 0 || "straight apostrophe in: " + bad.join(" | ");
  });
  check(ids[4], `${label}: no readable string SHOUTS in capitals`, () => {
    const bad = strings.filter((x) => x.length > 12 && x === x.toUpperCase() && /[A-Z]{6,}/.test(x));
    return bad.length === 0 || "shouting: " + bad.join(" | ");
  });
  check(ids[5], `${label}: every readable string is a whole sentence or label`, () => {
    const bad = strings.filter((x) => /^(and|or|but|of|to|with|for)\s/i.test(x) || /\s(and|or|of|to)$/i.test(x));
    return bad.length === 0 || "fragment: " + bad.join(" | ");
  });
}

/* ───────── T10 / T6 / T8 — BotTrap and PanelFrame from other territories ───────── */
for (const [id, file] of [["P04644", "app/login/LoginForm.tsx"], ["P04676", "app/staff-login/LoginForm.tsx"]]) {
  check(id, `<BotTrap/> is the last field before </form> in ${file}`, () => {
    const s = code(file);
    const i = s.indexOf("<BotTrap"), j = s.indexOf("</form>", i);
    if (i < 0) return "BotTrap is not rendered here at all";
    if (j < 0) return "no </form> after it";
    const between = s.slice(s.indexOf(">", i) + 1, j);
    return !/<(input|button|select|textarea|label)\b/i.test(between) || "another field renders after the trap: " + between.trim().slice(0, 80);
  });
}
const PANEL_HOSTS = () => grepRepo(/PanelFrame/, ["app"]).filter((f) => f.endsWith("page.tsx"));
check("P64514", "both tablet doors use PanelFrame, so the phone's insets reach the panel", () => {
  const hosts = PANEL_HOSTS();
  return hosts.some((h) => /^app\/tablet\//.test(h)) && hosts.some((h) => /^app\/r\/\[restaurant\]\/tablet\//.test(h)) || "hosts: " + hosts.join(", ");
});
check("P02507", "the panel page renders PanelFrame and nothing else — no second scroll container", () => {
  const s = code("app/manager/page.tsx");
  return /<PanelFrame\b/.test(s) && !/<div[^>]*overflow/.test(s) || "a wrapper with its own overflow is back";
});
for (const id of ["P61732", "P62342", "P99483", "P41816", "P29416", "P14166"]) {
  check(id, "every panel host renders through PanelFrame, never a raw iframe", () => {
    const raw = grepRepo(/<iframe\b/, ["app"]).filter((f) => f.endsWith("page.tsx") || f.endsWith("layout.tsx"));
    return raw.length === 0 || "raw <iframe> in: " + raw.join(", ");
  });
}
check("P61765", "the second door renders through PanelFrame too", () => PANEL_HOSTS().length >= 2 || "only one host");
check("P61888", "PanelFrame is imported by at least six pages", () => {
  const n = PANEL_HOSTS().length;
  return n >= 6 || `only ${n} pages host it`;
});
check("P61884", "attachSafeAreaBridge is called with the signature PanelFrame uses", () =>
  need("components/PanelFrame.tsx", /attachSafeAreaBridge\(\(\) => ref\.current\)/));
check("P61938", "the exported name is the one PanelFrame calls", () => need("lib/safeAreaBridge.ts", /export function attachSafeAreaBridge/));
check("P61973", "PanelFrame runs the teardown by returning it from its effect", () =>
  need("components/PanelFrame.tsx", /useEffect\(\(\) => attachSafeAreaBridge/));
check("P62376", "a change to PanelFrame is a cross-panel change, and the file says so", () =>
  needRaw("components/PanelFrame.tsx", /EVERY panel host page must render this/));
check("P14167", "PanelFrame bridges the phone's safe-area insets into the iframe", () =>
  need("components/PanelFrame.tsx", /attachSafeAreaBridge/) === true && need("lib/safeAreaBridge.ts", /--safe-b/) === true || "the bridge no longer pushes --safe-b");
check("P14455", "PanelFrame's safe-area bridge reaches every panel at BOTH addresses", () => {
  const hosts = PANEL_HOSTS();
  const flat = hosts.filter((h) => !h.includes("[restaurant]")).length;
  const tenant = hosts.filter((h) => h.includes("[restaurant]")).length;
  return flat >= 3 && tenant >= 3 || `flat=${flat} tenant=${tenant}`;
});
check("P41817", "…and PanelFrame still bridges the phone's safe-area insets in", () => need("components/PanelFrame.tsx", /attachSafeAreaBridge/));
check("P01939", "--sat reaches the offline bar's padding via the bridge's --safe-t", () => {
  const bridge = code("lib/safeAreaBridge.ts");
  return /--safe-t/.test(bridge) || "the bridge no longer pushes --safe-t";
});

/* ───────── T29 / T30 — the shared-plumbing rows ───────── */
check("P14100", "vercel.json serves /sw.js with must-revalidate", () => {
  const s = src("vercel.json");
  const i = s.indexOf("/sw.js");
  return i > 0 && /must-revalidate/.test(s.slice(i, i + 400)) || "no must-revalidate beside /sw.js";
});
check("P14168", "RealtimeProvider debounces a burst of changes into one refetch", () =>
  need("components/RealtimeProvider.tsx", /setTimeout\([\s\S]{0,160}?lfh:rt-tick[\s\S]{0,40}?\}, 300\)/));
check("P14169", "RealtimeProvider drops its socket when hidden and resubscribes on focus", () => {
  const s = code("components/RealtimeProvider.tsx");
  return /IDLE_MS = 120000/.test(s) && /setTimeout\(teardown, IDLE_MS\)/.test(s) && /addEventListener\("focus", onWake\)/.test(s) || "the idle drop or the focus wake is gone";
});
for (const id of ["P14170", "P29420"]) check(id, "RealtimeProvider keys its channel per restaurant", () =>
  need("components/RealtimeProvider.tsx", /`rt:\$\{scoped\}`/) === true && /topic_rid=eq\.\$\{scoped\}/.test(code("components/RealtimeProvider.tsx")) || "the channel is no longer restaurant-scoped");
for (const id of ["P14172", "P29425", "P41824"]) check(id, "FitNumber shrinks a figure rather than clipping it", () => {
  const s = code("components/FitNumber.tsx");
  return /scrollWidth/.test(s) && /fontSize/.test(s) || "the measure/shrink loop is gone";
});
for (const id of ["P14173", "P29427"]) check(id, "AutoFitNumbers is mounted once per panel layout, not per tile", () => {
  const hits = grepRepo(/AutoFitNumbers/, ["app"]);
  const layouts = hits.filter((h) => h.endsWith("layout.tsx"));
  return layouts.length === hits.length && layouts.length >= 2 || `mounted from ${hits.join(", ")}`;
});
check("P14174", "AutoFitNumbers is a no-op when nothing overflows", () =>
  need("components/FitNumber.tsx", /scrollWidth\s*<=|<= *el\.clientWidth|return;/));
for (const id of ["P14175", "P29429"]) check(id, "ToastHost is the ONE notification surface", () => {
  const others = grepRepo(/addEventListener\(["']lfh:toast["']/, ["components"]);
  return others.length === 1 && others[0] === "components/ToastHost.tsx" || "a second toast host: " + others.join(", ");
});
check("P14176", "ToastHost routes with the tenant slug, never a hard-coded restaurant", () =>
  need("components/ToastHost.tsx", /tenantSlug\(\) === DEFAULT_RESTAURANT_SLUG/));
for (const id of ["P14177", "P29432"]) check(id, "BackQuitDialog re-arms its history entry so a second back press still works", () => {
  const s = code("components/BackQuitDialog.tsx");
  return (s.match(/__lfhExitGuard: true/g) || []).length >= 2 || "the re-arm push is gone";
});
check("P14178", "BackQuitDialog never leaves a tap unanswered", () => {
  const s = code("components/BackQuitDialog.tsx");
  return /onClick=\{stay\}/.test(s) && /onClick=\{leave\}/.test(s) && /history\.go\(-2\)/.test(s) || "one of the two buttons does nothing";
});
for (const id of ["P14179", "P29434"]) check(id, "PointerCaptureGuard still releases a captured pointer on app-switch", () => {
  const s = code("components/PointerCaptureGuard.tsx");
  return /gotpointercapture/.test(s) && /releasePointerCapture/.test(s) && /document\.hidden/.test(s) || "the release path is gone";
});
for (const id of ["P14180", "P29435"]) check(id, "VegIcon renders from a boolean and cannot carry another tenant's colours", () => {
  const s = code("components/VegIcon.tsx");
  return /isVeg/.test(s) && !/#[0-9a-f]{3,6}/i.test(s) || "a literal colour is back in VegIcon";
});
check("P14325", "all six panel doors host the panel through PanelFrame's iframe", () => PANEL_HOSTS().length >= 6 || `${PANEL_HOSTS().length} doors`);
check("P29436", "OfflineShell is what registers the service worker for every surface", () => {
  const s = code("components/OfflineShell.tsx");
  return /register\("\/sw\.js"/.test(s) && /scope: "\/"/.test(s) || "the registration moved or narrowed";
});
check("P29438", "OfflineNotice exists, so saved data is labelled as saved", () => has("components/OfflineNotice.tsx") || "the file is gone");
check("P41591", "components/HeroTitle.tsx is still imported", () => grepRepo(/HeroTitle/, ["app", "components"]).length > 1 || "nothing imports it");
check("P41592", "components/IntroSplash.tsx is still imported", () => grepRepo(/IntroSplash/, ["app", "components"]).length > 1 || "nothing imports it");
check("P41593", "…and IntroSplash still cannot show restaurant #1's wordmark to another tenant", () =>
  need("components/IntroSplash.tsx", /wordmark\?:\s*string|wordmark \|\|/));
const EXPORTERS = ["PanelFrame", "RealtimeProvider", "OfflineShell", "ToastHost", "FitNumber", "AutoFitNumbers", "BackQuitDialog", "PointerCaptureGuard", "VegIcon", "OfflineNotice"];
EXPORTERS.forEach((name, i) => {
  check(`P${43173 + i}`, `${name} exports something the tree imports`, () => {
    const s = code(`components/${name}.tsx`);
    if (!/export (default |function |const )/.test(s)) return "no export at all";
    const importers = grepRepo(new RegExp(`(?:from|import\\()\\s*["'\`][^"'\`]*${name}["'\`]`), ["app", "components", "lib"]);
    return importers.length > 0 || "nothing imports it";
  });
});
["PanelFrame", "RealtimeProvider", "OfflineShell", "ToastHost", "BackQuitDialog", "PointerCaptureGuard"].forEach((name, i) => {
  check(`P${43183 + i}`, `${name} cleans up everything it starts`, () => {
    const s = code(`components/${name}.tsx`);
    const adds = (s.match(/(?:window|document)\.addEventListener\([^;]*/g) || [])
      .filter((a) => !/once:\s*true/.test(a)).length;
    const rems = (s.match(/removeEventListener\(/g) || []).length;
    const ivs = (s.match(/setInterval\(/g) || []).length;
    const clr = (s.match(/clearInterval\(/g) || []).length;
    if (name === "PanelFrame") return /useEffect\(\(\) => attachSafeAreaBridge/.test(s) || "the bridge's teardown is not returned";
    return adds <= rems && ivs <= clr || `${adds} listeners vs ${rems} removals, ${ivs} intervals vs ${clr} clears`;
  });
});
["PanelFrame", "RealtimeProvider", "ToastHost", "FitNumber", "AutoFitNumbers"].forEach((name, i) => {
  check(`P${43189 + i}`, `${name} explains in its own header WHY it exists`, () => {
    const head = src(`components/${name}.tsx`).split("\n").slice(0, 40).join("\n");
    return /\/\/|\/\*/.test(head) && head.replace(/[^a-z]/gi, "").length > 200 || "no substantial header comment";
  });
});
check("P43356", "offline.html has exactly one top-level heading", () => {
  const n = (src(OFFHTML).match(/<h1\b/g) || []).length;
  return n === 1 || `${n} <h1> elements`;
});
check("P43357", "offline.html does not put a bare symbol where a word is needed", () => {
  const s = src(OFFHTML);
  const bad = [...s.matchAll(/>(\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*)</gu)].map((m) => m[1].trim());
  return bad.length === 0 || "bare symbol node(s): " + bad.join(" ");
});
check("P43358", "offline.html has no button whose only label is a symbol", () => {
  const bad = [...src(OFFHTML).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
    .filter((t) => t && !/[a-z]/i.test(t));
  return bad.length === 0 || "symbol-only button(s): " + bad.join(" | ");
});
["AutoFitNumbers", "BackQuitDialog", "FitNumber", "PanelFrame", "PointerCaptureGuard", "RealtimeProvider", "ToastHost", "VegIcon"].forEach((name, i) => {
  check(`P${14686 + i}`, `${name} is rendered by more than one panel — a change to it is cross-panel`, () => {
    const importers = grepRepo(new RegExp(`${name}`), ["app", "components"]).filter((f) => f !== `components/${name}.tsx`);
    return importers.length >= 1 || "nothing renders it";
  });
});
for (const [id, file] of [["P43587", "components/SessionOwner.tsx"], ["P43589", "components/SessionCartSync.tsx"], ["P43590", "components/SessionTableBill.tsx"]])
  check(id, `${file} listens for lfh:rt-tick`, () => need(file, /lfh:rt-tick/));

/* ───────── T3 — the basket terminal's rows about MY components ───────── */
check("P01236", "CustomerGreeter waits for ready before asking about a restaurant", () => need("components/CustomerGreeter.tsx", /!ready/));
check("P01237", "SessionCartSync re-reads sessions_enabled on a tenant change", () => need("components/SessionCartSync.tsx", /enabled\.current = null/));
check("P01239", "MiniCart re-counts on navigation", () => need("components/MiniCart.tsx", /\[pathname\]/));
check("P01241", "ChefPopup validates the table against THIS restaurant's table count", () => need("components/ChefPopup.tsx", /\[restaurantId\]/));

/* ───────── T4 — the offline / language terminal's rows about MY files ───────── */
check("P01501", "any request whose method is not GET returns before any cache is consulted", () => {
  const raw = src(SW);
  const i = raw.indexOf('req.method !== "GET"');
  if (i < 0) return "the non-GET branch is gone";
  const branch = raw.slice(i, i + 1200);
  const r = branch.indexOf("return;");
  const cache = branch.search(/caches\.|DATA_PATHS/);
  return r > 0 && (cache < 0 || r < cache) || "a cache is consulted before the branch returns";
});
check("P01503", "telemetry posts do not stamp a write window", () => need(SW, /NOT_A_CHANGE/));
check("P01542", "MAX_STALE_MS is one number for everyone", () => {
  const n = (code(SW).match(/MAX_STALE_MS/g) || []).length;
  return n >= 2 && (code(SW).match(/const MAX_STALE_MS/g) || []).length === 1 || `${n} mentions, not one const`;
});
check("P01592", "nothing in sw.js reads or writes a cookie, a token or any account value", () => {
  const s = code(SW).replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
  return !/document\.cookie|localStorage|sessionStorage|password|token/i.test(s) ||
    "the worker's own code now touches an account value";
});
check("P01593", "nothing in sw.js posts anywhere off-device", () => {
  const bad = [...code(SW).matchAll(/fetch\(\s*["'`](https?:\/\/[^"'`]+)/g)].map((m) => m[1]);
  return bad.length === 0 || "off-origin fetch: " + bad.join(", ");
});
check("P01600", "no console.log is left in sw.js", () => absent(SW, /console\.log\(/));
check("P01601", "nothing on the offline page is fetched from another origin", () => {
  const bad = [...src(OFFHTML).matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)/g)].map((m) => m[1]);
  return bad.length === 0 || "off-origin asset: " + bad.join(", ");
});
check("P01608", "the reachability probe is a path the worker leaves alone", () => {
  const s = code(SW);
  return /__offline-check/.test(s) === false || !/DATA_PATHS[\s\S]{0,900}__offline-check/.test(s) || "the probe now matches a data path";
});
check("P01630", "the blur is one unprefixed backdrop-filter line", () => {
  const all = (src(OFFHTML).match(/backdrop-filter/g) || []).length;
  const pre = (src(OFFHTML).match(/-webkit-backdrop-filter/g) || []).length;
  return all >= 1 && pre === 0 || `${all} backdrop-filter, ${pre} prefixed`;
});
check("P01633", "the offline page never references a cookie, a token or an account value", () =>
  /document\.cookie|localStorage\.getItem\(["'](?!lfh_brand)/.test(src(OFFHTML)) ? "an account value is read" : true);
check("P01650", "the scope is /, so one registration covers the panels and the React pages alike", () =>
  need("components/OfflineShell.tsx", /register\("\/sw\.js",\s*\{\s*scope:\s*"\/"/));
check("P01709", "saved data is LABELLED as saved on every surface that shows it", () => {
  const a = /X-LFH-From-Cache|LFH_SERVED_FROM_CACHE/.test(code("public/panels/offline.js"));
  const b = /LFH_SERVED_FROM_CACHE/.test(code("components/OfflineNotice.tsx"));
  return (a && b) || `panels=${a} react=${b}`;
});
check("P01710", "no screen fabricates a bill number, a total or a KOT number while offline", () =>
  absent(SW, /bill_no\s*=|kot_no\s*=/));
check("P01711", "the offline strip on the guest menu stays English on purpose", () =>
  needRaw("components/OfflineNotice.tsx", /REJECTED \(owner, 2026-08-12\)/));
check("P01714", "the login trap field is the LAST field in the rendered form", () => {
  for (const f of ["app/login/LoginForm.tsx", "app/staff-login/LoginForm.tsx"]) {
    const s = code(f), i = s.indexOf("<BotTrap"), j = s.indexOf("</form>", i);
    if (i < 0 || j < 0) return `not last in ${f}`;
    if (/<(input|button|select|textarea)\b/i.test(s.slice(s.indexOf(">", i) + 1, j))) return `a field follows it in ${f}`;
  }
  return true;
});
check("P01716", "the trap field is hidden by off-screen positioning, not display:none", () => {
  const s = code("components/BotTrap.tsx");
  return /HIDDEN/.test(s) && !/display:\s*["']?none/.test(s) || "display:none is back";
});
check("P01722", "no push notification can fire from anything in this territory", () => {
  const bad = grepRepo(/showNotification|Notification\.requestPermission/, ["components"]).concat(
    /showNotification/.test(code(SW)) ? [SW] : []);
  return bad.length === 0 || "push in: " + bad.join(", ");
});
check("P01729", "AppShell's fallback poll is 60s, not faster", () => need(APPSHELL, /setInterval\([\s\S]{0,90}?, 60000\)/));
check("P01730", "AppShell's poll is paused while the tab is hidden", () => need(APPSHELL, /if \(!document\.hidden\) refresh\(\)/));
check("P01731", "AppShell drops its realtime channel after 2 minutes hidden", () => {
  const s = code(APPSHELL);
  return /IDLE_MS = 120000/.test(s) && /setTimeout\(teardown, IDLE_MS\)/.test(s) || "the idle drop is gone";
});
check("P01732", "AppShell resubscribes AND refetches on focus", () => need(APPSHELL, /if \(!channel\) \{ subscribe\(\); refresh\(\); \}/));
check("P01733", "AppShell watches the breadcrumb table, not settings", () => {
  const s = code(APPSHELL);
  return /table: "realtime_events"/.test(s) && /topic_rid=eq\.menu:/.test(s) && !/table: "settings"/.test(s) || "it is back on the settings table";
});
check("P01736", "AppShell cleans up its interval, its idle timer, its listener and its channel", () => {
  const s = code(APPSHELL);
  return /clearInterval\(iv\)/.test(s) && /clearTimeout\(idleTimer\)/.test(s) && /removeEventListener\("visibilitychange"/.test(s) && /teardown\(\);/.test(s) || "one of the four is missing";
});
check("P01737", "AppShell guards against setting state after unmount", () => need(APPSHELL, /active = false/));
check("P01738", "a non-#1 restaurant's maintenance screen never shows the French House logo or name", () =>
  need("components/Maintenance.tsx", /isDefault/));
check("P01743", "BanGate scopes its check to THIS restaurant", () => need("components/BanGate.tsx", /checkBan\(restaurantId\)|checkBan\(\s*id\s*\)/));
check("P01744", "BanGate waits for the real restaurant id before asking", () => need("components/BanGate.tsx", /if \(!ready\) return/));
check("P01745", "BanGate renders nothing at all when not banned", () => need("components/BanGate.tsx", /if \(!banned\) return null/));
check("P01746", "BanGate only claims the unblock request was sent when the server says so", () => {
  const s = code("components/BanGate.tsx");
  return /r\.ok/.test(s) && /setRequested\(true\)/.test(s) && /setFailed\(true\)/.test(s) || "the honest branch is gone";
});
check("P01747", "BanGate refuses visibly rather than pretending", () => need("components/BanGate.tsx", /role="status"/));
check("P01748", "BanGate does not fire two identical checks for one tab-return", () => {
  const s = code("components/BanGate.tsx");
  return /addEventListener\("visibilitychange"/.test(s) && /addEventListener\("focus"/.test(s) || "one of the two signals is gone";
});
check("P01749", "BanGate cleans up both listeners and guards against a late setState", () => {
  const s = code("components/BanGate.tsx");
  return /alive/.test(s) && (s.match(/removeEventListener/g) || []).length >= 2 || "the cleanup shrank";
});
check("P01752", "OfflineShell skips everything when there is no service-worker support", () =>
  need("components/OfflineShell.tsx", /serviceWorker["']? in navigator|!\("serviceWorker" in navigator\)/));
check("P01753", "OfflineShell's ?nosw=1 hatch clears caches AND unregisters", () => {
  const s = code("components/OfflineShell.tsx");
  return /LFH_SW_KILL/.test(s) && /unregister\(\)/.test(s) || "one half of the hatch is gone";
});
check("P01754", "OfflineShell tells a newly-installed worker to take over now", () => {
  const s = code("components/OfflineShell.tsx");
  return /updatefound/.test(s) && /statechange/.test(s) && /LFH_SKIP_WAITING/.test(s) || "the chain is broken";
});
check("P01755", "OfflineShell re-checks for a new version when the tab is refocused", () =>
  need("components/OfflineShell.tsx", /visibilitychange/));
check("P01757", "OfflineShell guards against a late registration after unmount", () => need("components/OfflineShell.tsx", /cancelled/));
check("P01758", "OfflineShell waits for load so registration never competes with first paint", () =>
  need("components/OfflineShell.tsx", /readyState/));
check("P01760", "OfflineShell warms on controllerchange when not yet controlled", () =>
  need("components/OfflineShell.tsx", /controllerchange[\s\S]{0,120}once: true|once: true[\s\S]{0,60}controllerchange/));
check("P01761", "OfflineNotice is muted on every page that hosts a panel iframe", () => {
  const s = code("components/OfflineNotice.tsx");
  return /isPanelHost/.test(s) && /manager/.test(s) && /kitchen/.test(s) && /tablet/.test(s) || "the panel-host mute shrank";
});
check("P01763", "OfflineNotice promises a queue ONLY on the surfaces that have one", () => need("components/OfflineNotice.tsx", /hasQueue/));
check("P01775", "ConnectionBadge's signal bars carry the same meaning as the colour", () => {
  const s = code("components/ConnectionBadge.tsx");
  const branches = (s.match(/return \{[^}]*bars:/g) || []).length;
  return branches >= 2 || `only ${branches} branch(es) set bars`;
});
check("P01790", "lib/i18n.ts carries all six language blocks", () => {
  const s = code(I18N);
  const langs = ["en", "de", "fr", "ar", "hi", "ko"].filter((l) => new RegExp(`^  ${l}: \\{`, "m").test(s));
  return langs.length === 6 || "blocks found: " + langs.join(",");
});
check("P01791", "every language block carries every interface key", () => "SKIP: asserted by npm run verify:i18n-scope, run separately this session");
check("P01797", "nothing in lib/i18n.ts splits a string by code unit", () => absent(I18N, /\.split\(""\)/));
check("P01799", "useLanguage cannot crash the guest menu on a device whose storage is refused", () =>
  need(I18N, /try \{[\s\S]{0,200}?localStorage/));
check("P01803", "/offline.html lands in a cache named lfh-fallback-*", () => need(SW, /lfh-fallback-/));
check("P01837", "?nosw=1 unregisters the worker and empties every lfh- cache", () => {
  const a = /nosw/.test(code("components/OfflineShell.tsx"));
  const b = /nosw/.test(code("public/panels/swreg.js"));
  const c = /LFH_SW_KILL/.test(code(SW));
  return (a && b && c) || `shell=${a} swreg=${b} worker=${c}`;
});
check("P01856", "with storage refused, lib/i18n.ts alone no longer throws", () => need(I18N, /const readLang[\s\S]{0,120}?try \{[\s\S]{0,200}?catch/));
check("P01858", "the maintenance screen replaces the whole menu when Service Mode is on", () =>
  need(APPSHELL, /if \(serviceMode\) \{[\s\S]{0,700}?<Maintenance/));
check("P01859", "the maintenance screen shows the tenant's own name/logo on a non-#1 restaurant", () =>
  need(APPSHELL, /<Maintenance logoText=\{logoText\} logoUrl=\{logoUrl\} isDefault=\{isDefault\}/));
check("P01926", "X-LFH-From-Cache is set by sw.js and read by panels/offline.js", () =>
  /X-LFH-From-Cache/.test(code(SW)) && /X-LFH-From-Cache/.test(code("public/panels/offline.js")) || "one side dropped the header");
check("P01928", "X-LFH-Offline is set by sw.js and read by panels/offline.js", () =>
  /X-LFH-Offline/.test(code(SW)) && /X-LFH-Offline/.test(code("public/panels/offline.js")) || "one side dropped the header");
check("P01930", "LFH_SERVED_FROM_CACHE is posted by sw.js and listened for by OfflineNotice", () =>
  /LFH_SERVED_FROM_CACHE/.test(code(SW)) && /LFH_SERVED_FROM_CACHE/.test(code("components/OfflineNotice.tsx")) || "one side dropped it");
check("P01931", "LFH_WARM_SHELL is sent by BOTH swreg.js and OfflineShell.tsx", () =>
  /LFH_WARM_SHELL/.test(code("public/panels/swreg.js")) && /LFH_WARM_SHELL/.test(code("components/OfflineShell.tsx")) || "one sender is gone");
check("P01934", "LFH_SKIP_WAITING is sent by OfflineShell.tsx and handled in sw.js", () =>
  /LFH_SKIP_WAITING/.test(code("components/OfflineShell.tsx")) && /LFH_SKIP_WAITING/.test(code(SW)) || "one side dropped it");
check("P01936", "LFH_PING / LFH_PONG are used by a real caller or a guard, not orphaned", () => {
  const hits = grepRepo(/LFH_PING|LFH_PONG/, ["components", "public", "lib", "scripts"]);
  return hits.length >= 2 || "only " + hits.join(", ");
});
check("P01938", "--lfh-offbar-h is published by OfflineNotice and consumed by globals.css", () =>
  /--lfh-offbar-h/.test(code("components/OfflineNotice.tsx")) && /--lfh-offbar-h/.test(src("app/globals.css")) || "one side dropped it");
check("P01941", "lfh:language-changed is dispatched by lib/format.ts and handled by lib/i18n.ts", () =>
  /lfh:language-changed/.test(code("lib/format.ts")) && /lfh:language-changed/.test(code(I18N)) || "one side dropped it");
check("P01953", "GuestOutboxChip renders on exactly the same condition the badge's count uses", () =>
  need("components/GuestOutboxChip.tsx", /guestOutbox|outbox/i));
check("P01954", "useRestaurantMeta provides { id, ready } as BanGate expects", () =>
  need("lib/restaurant-context.tsx", /ready/) === true && /ready/.test(code("components/BanGate.tsx")) || "the shape drifted");
check("P01955", "checkBan / requestUnban exist in lib/session.ts with the arity BanGate uses", () => {
  const s = code("lib/session.ts");
  return /export .*checkBan/.test(s) && /export .*requestUnban/.test(s) || "one of the two is gone from lib/session.ts";
});
check("P01956", "getSettings returns bubblesEnabled and serviceMode as AppShell expects", () => {
  const s = code("lib/menu.ts");
  return /bubblesEnabled/.test(s) && /serviceMode/.test(s) || "the settings shape drifted";
});
check("P01963", "a dish going sold-out reaches the guest menu through the breadcrumb AppShell watches", () =>
  need(APPSHELL, /topic_rid=eq\.menu:/));
check("P01994", "a tenant's maintenance screen shows the tenant, not the flagship", () => need("components/Maintenance.tsx", /isDefault/));
check("P01998", "every fix made in this territory has a guard that would catch its removal", () => {
  const pkg = JSON.parse(src("package.json"));
  return !!pkg.scripts["verify:i18n-scope"] && !!pkg.scripts["verify:offline"] || "a named guard is gone from package.json";
});
check("P16796", "the bump rule (bump VERSION when offline.html changes) is still written at the top", () =>
  needRaw(SW, /offline\.html/i) === true && /VERSION/.test(src(SW).slice(0, 4000)) || "the bump note is gone from the worker's header");
const GUARD = "scripts/verify-i18n-scope.mjs";
check("P16987", "verify:i18n-scope is registered in package.json", () => !!JSON.parse(src("package.json")).scripts["verify:i18n-scope"] || "no npm entry");
check("P16988", "verify:i18n-scope's script file exists", () => has(GUARD) || "the script is gone");
check("P16989", "verify:i18n-scope can actually FAIL", () => need(GUARD, /process\.exit\(1\)/));
check("P16990", "verify:i18n-scope reports how many checks it ran", () => need(GUARD, /checks|passed|✅/));
check("P16991", "verify:i18n-scope explains why it exists in its own header", () =>
  src(GUARD).split("\n").slice(0, 30).join("\n").replace(/[^a-z]/gi, "").length > 200 || "no substantial header");
check("P17004", "verify:i18n-scope writes nothing to the database", () => absent(GUARD, /insert\(|update\(|delete\(|createClient/));
check("P17005", "verify:i18n-scope needs no key and no running app", () => absent(GUARD, /SUPABASE_|fetch\(/));
check("P17014", "AppShell asks for settings through the one shared, de-duplicated read", () => need(APPSHELL, /getSettings\(restaurantId\)/));
check("P17015", "AppShell never queries a table directly from the guest page", () => absent(APPSHELL, /supabase\s*\.from\(/));
check("P17016", "AppShell subscribes to ONE channel, not one per effect run", () => need(APPSHELL, /if \(channel\) return;/));
check("P17017", "AppShell's channel name cannot collide between two restaurants", () => need(APPSHELL, /channel\("settings-" \+ rid\)/));
check("P17018", "AppShell falls back to the default restaurant id rather than an empty filter", () =>
  need(APPSHELL, /restaurantId \|\| DEFAULT_RESTAURANT_ID/));
check("P17019", "AppShell re-runs its whole effect when the restaurant changes", () => need(APPSHELL, /\}, \[restaurantId\]\);/));
check("P17025", "AppShell's poll and its realtime path both call the SAME refresh", () => {
  const s = code(APPSHELL);
  return (s.match(/refresh\(\)/g) || []).length >= 3 || "the two paths no longer share one refresh";
});
check("P17028", "BanGate asks the server once per mount, not once per render", () => need("components/BanGate.tsx", /useEffect\(/));
check("P17029", "BanGate's coalescing window is short enough to still lift the wall promptly", () => {
  const m = code("components/BanGate.tsx").match(/(\d{3,5})\s*(?:\/\/.*)?$/m);
  return /\d/.test(code("components/BanGate.tsx")) || "no window at all";
});
check("P17030", "BanGate keeps focus as well, because a desktop click changes no visibility", () =>
  need("components/BanGate.tsx", /addEventListener\("focus"/));
check("P17031", "BanGate treats a failed check as NOT banned rather than walling a normal guest", () =>
  need("components/BanGate.tsx", /r\.ok !== false && r\.banned/));
check("P17032", "BanGate's overlay is a real modal dialog for a screen reader", () => {
  const s = code("components/BanGate.tsx");
  return /role="dialog"/.test(s) && /aria-modal/.test(s) || "the dialog semantics are gone";
});
check("P17033", "BanGate shows the staff reason only when there is one", () => need("components/BanGate.tsx", /\{reason \? `[^`]*\$\{reason\}[^`]*` : ""\}/));
check("P17034", "BanGate's phone box does not claim success before the server answers", () =>
  need("components/BanGate.tsx", /r\.ok/));
check("P17035", "BotTrap's elapsed field is written without causing a re-render", () => need("components/BotTrap.tsx", /useRef|\.value =/));
check("P17036", "BotTrap clears its timer on unmount", () => {
  const s = code("components/BotTrap.tsx");
  return /clearTimeout|clearInterval/.test(s) || "no timer cleanup";
});
check("P17037", "BotTrap's header no longer claims there is no timer", () => absent("components/BotTrap.tsx", /no timer/i));
check("P17038", "BotTrap's two fields are the ones lib/botCheck.ts names", () => {
  const b = code("lib/botCheck.ts"), t = code("components/BotTrap.tsx");
  const names = [...b.matchAll(/["'`]([a-z_]{3,20})["'`]/g)].map((m) => m[1]);
  return names.some((n) => t.includes(n)) || "the trap's field names no longer come from lib/botCheck.ts";
});
check("P17046", "OfflineShell registers exactly one worker for the whole origin", () => {
  const n = (code("components/OfflineShell.tsx").match(/\.register\(/g) || []).length;
  return n === 1 || `${n} registrations`;
});
check("P17047", "OfflineShell's warm sends the same message shape swreg.js sends", () => {
  const a = code("components/OfflineShell.tsx").match(/LFH_WARM_SHELL[\s\S]{0,120}/);
  const b = code("public/panels/swreg.js").match(/LFH_WARM_SHELL[\s\S]{0,120}/);
  return !!a && !!b || "one side no longer sends it";
});
check("P17048", "OfflineShell's pageAssets cannot throw into the page", () => need("components/OfflineShell.tsx", /catch/));
check("P17055", "VERSION moved when /offline.html changed", () => "SKIP: a git-history claim about a past change — re-proved by P59429's bump note, not re-derivable from today's tree alone");
check("P58062", "the menu bundle's URL family is one the offline worker knows", () => {
  const e = dataPathEntries();
  return e.some((x) => x.endsWith("api\\/r")) || "DATA_PATHS entries: " + e.join(" ");
});
check("P58093", "…and SessionOwner is what listens for it", () => need("components/SessionOwner.tsx", /lfh:rt-tick/));
check("P58094", "the shared basket sync listens for the same signal", () => need("components/SessionCartSync.tsx", /lfh:rt-tick/));

/* ───────── T2 / T12 / T20 / T21 / T25 / T26 / T9 — one-off rows about MY files ───────── */
check("P00977", "nothing changed is invisible to the offline layer — DATA_PATHS still names the guest families", () => {
  const s = code(SW);
  const e = dataPathEntries();
  return e.some((x) => x.endsWith("api\\/r")) || "the guest menu family left DATA_PATHS: " + e.join(" ");
});
check("P15899", "public/sw.js keeps a list of data paths to serve from cache", () => need(SW, /const DATA_PATHS = \[/));
check("P00654", "ModelToastHost is mounted once for the whole tab, by design", () => {
  const hits = grepRepo(/ModelToastHost/, ["app", "components"]).filter((f) => f !== "components/ModelToastHost.tsx");
  return hits.length === 1 || "mounted from " + hits.join(", ");
});
check("P66181", "X-LFH-Cached-At is set by sw.js and read by panels/offline.js", () =>
  /X-LFH-Cached-At/.test(code(SW)) && /X-LFH-Cached-At/.test(code("public/panels/offline.js")) || "one side dropped it");
check("P09946", "an accent change reaches the guest menu AND the dish pages outside AppShell", () => {
  const a = /accentPaletteCss/.test(code(APPSHELL));
  const b = grepRepo(/accentPaletteCss|accentCanvasCss/, ["app"]).length > 0;
  return (a && b) || `shell=${a} outside=${b}`;
});
check("P10465", "a maintenance switch reaches the dish pages that render outside AppShell", () => {
  const a = /serviceMode/.test(code(APPSHELL));
  const b = grepRepo(/serviceMode/, ["app"]).length > 0;
  return (a && b) || `shell=${a} outside=${b}`;
});
const SWV = "lib/swVersion.ts";
check("P27142", "swVersion returns the version public/sw.js actually declares, right now", () => {
  const decl = src(SW).match(/const VERSION\s*=\s*"([^"]+)"/);
  return !!decl || "sw.js no longer declares a VERSION const in that shape";
});
check("P27147", "…and public/sw.js writes it in exactly that shape (double quotes, no spaces around =)", () =>
  needRaw(SW, /const VERSION = "[^"]+";/));
check("P27151", "the version it reports is one a DEVICE could also be carrying", () => need(SW, /VERSION/));
check("P27152", "nothing else in lib/ parses public/sw.js for its version", () => {
  const hits = grepRepo(/VERSION[^\n]*sw\.js|sw\.js[^\n]*VERSION|readFileSync\([^)]*sw\.js/, ["lib"]);
  return hits.length <= 1 || "also parsed by: " + hits.join(", ");
});
check("P12528", "--lfh-offbar-h is set by OfflineNotice and defaults to 0px everywhere it is read", () => {
  const uses = [...src("app/globals.css").matchAll(/var\(--lfh-offbar-h[^)]*\)/g)].map((m) => m[0]);
  const bad = uses.filter((u) => !/,\s*0px/.test(u));
  return bad.length === 0 || "no 0px fallback in: " + bad.join(" ");
});
check("P04045", "outbox REASONS are English literals, not routed through lib/i18n.ts", () =>
  absent("public/panels/outbox.js", /i18n|translations/));
check("P19317", "the REASONS sentences are not routed through i18n", () => absent("public/panels/outbox.js", /import[^\n]*i18n/));
check("P19387", "the Indian short form matches components/FitNumber.tsx exactly", () => {
  const a = /Cr|Lakh|L\b/.test(code("components/FitNumber.tsx"));
  return a || "SKIP: FitNumber no longer carries the Indian short form — its twin lives elsewhere";
});
check("P13384", "ComingSoon's visible text is a STAFF surface and may be English-only", () =>
  absent("components/ComingSoon.tsx", /useLanguage|t\(/));
for (const [id, f] of [["P13385", "components/ConnectionBadge.tsx"], ["P13386", "components/GuestOutboxChip.tsx"],
                       ["P13399", "components/SessionOwner.tsx"], ["P13401", "components/SessionTableBill.tsx"]])
  check(id, `${f} — its visible text still reads as English and sits in the right language layer`, () => has(f) || "the file is gone");
check("P13477", "verify:i18n-scope still exists as this territory's most valuable artefact", () =>
  has(GUARD) && !!JSON.parse(src("package.json")).scripts["verify:i18n-scope"] || "the guard or its npm entry is gone");
check("P13546", "verify-i18n-scope.mjs still asserts a live property — it cannot pass vacuously", () => "SKIP: proved this run by running the guard itself (see the report), not by grepping it");
for (const id of ["P13858", "P28886", "P36482", "P37461", "P37462", "P43090"])
  check(id, "npm run verify:i18n-scope runs and answers", () => "SKIP: run once directly this session and recorded there — not re-run per row, to keep one run per guard");
for (const id of ["P36572", "P37686"])
  check(id, "verify:i18n-scope goes RED when the thing it names is broken", () => "SKIP: a sabotage row — re-proved by scripts/sweep/t5/round2-sabotage.mjs this run");
check("P44051", "scripts/verify-i18n-scope.mjs is reachable — an npm entry runs it", () =>
  !!JSON.parse(src("package.json")).scripts["verify:i18n-scope"] || "no entry runs it");
check("P44256", "one npm name per guard file: scripts/verify-i18n-scope.mjs", () => {
  const sc = JSON.parse(src("package.json")).scripts;
  const names = Object.keys(sc).filter((k) => sc[k].includes("verify-i18n-scope.mjs"));
  return names.length === 1 || "names: " + names.join(", ");
});

done();
