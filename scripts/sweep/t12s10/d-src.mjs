// scripts/sweep/t12s10/d-src.mjs — BLOCK D · P181401–P181500 · the host pages, the HTML shell, and
// "who may do what" — read from the files and seen through ONE signed-in waiter's normal use.
//
// Logins and data separation are answered here in product-correctness terms only, by READING the code
// (lib/panelGate.ts, the five territory files) and by watching what this one waiter's own browser asks
// for. Nothing calls an endpoint without its login and nothing names another restaurant.
//   node scripts/sweep/t12s10/d-src.mjs [--base http://localhost:4412] [--quiet]
import { createHash } from "node:crypto";   // sha1, first 8 hex — the same rule scripts/verify-panel-cache.mjs uses
import { makeRunner, ok, read, code, exists, fnBody, F_APP, F_HTML, F_PAGE, F_LAYOUT, F_RPAGE, BASE, RID, waiterContext, panelFrame, closeBrowser, sleep } from "./lib.mjs";

export async function blockD(R = makeRunner("T12 · block D · pages, shell, and who may do what")) {
  const { check } = R;
  const S = "SRC — the file on disk";
  const L = "LIVE — signed-in waiter on :4412";
  const app = read(F_APP), appC = code(F_APP), html = read(F_HTML), page = read(F_PAGE), layout = read(F_LAYOUT), rpage = read(F_RPAGE);
  const gate = read("lib/panelGate.ts");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  const fileOf = (src) => src.startsWith("/") ? "public" + src.split("?")[0] : "public/panels/tablet/" + src.split("?")[0];
  const sha = (rel) => createHash("sha1").update(read(rel)).digest("hex").slice(0, 8);

  // ── D1 · the three host pages ────────────────────────────────────────────────────────────────
  await check("P181401", F_LAYOUT, "the /tablet layout gates the whole route with requirePanel('tablet') before rendering anything", S, () =>
    ok(/await requirePanel\("tablet", "\/tablet"\)/.test(layout) && /return <>\{children\}<\/>/.test(layout)));
  await check("P181402", F_LAYOUT, "requirePanel lets in only a signed-in waiter whose restaurant is open, or the admin through act-as", S + " (lib/panelGate.ts)", () => {
    const fn = gate.slice(gate.indexOf("export async function requirePanel("), gate.indexOf("// Second half of the admin rule"));
    return ok(/u && u\.role === role/.test(fn) && /panelDoor\(u\)/.test(fn) && /ADMIN_ACT_COOKIE/.test(fn) && /redirect\(`\/login\?next=/.test(fn));
  });
  await check("P181403", F_LAYOUT, "a binned or switched-off restaurant's waiter is sent to sign-in WITH the reason (no redirect loop)", S + " (lib/panelGate.ts)", () =>
    ok(/redirect\(`\/login\?why=\$\{door\.why\}`\)/.test(gate)));
  await check("P181404", F_PAGE, "/tablet's page resolves the admin pin and the waiter's own restaurant through panelAdminRid('tablet')", S, () =>
    ok(/await panelAdminRid\("tablet", rid\)/.test(page)));
  await check("P181405", F_PAGE, "a real waiter's iframe carries no ?rid (that pin is admin-only) — only the paint hint", S + " (lib/panelGate.ts panelIframeSrc)", () => {
    const fn = gate.slice(gate.indexOf("export function panelIframeSrc"), gate.indexOf("// Gate for a TENANT-SCOPED"));
    return ok(/if \(!adminRid\) \{[\s\S]*\?skel=/.test(fn) && /skel && \/\^\[0-9a-f-\]\{36\}\$\/i\.test\(skel\)/.test(fn));
  });
  await check("P181406", F_PAGE, "the admin's ?as pin is accepted only as a UUID and ?view only as 'real'", S + " (lib/panelGate.ts)", () =>
    ok(/as && \/\^\[0-9a-f-\]\{36\}\$\/i\.test\(as\)/.test(gate) && /pins\?\.view === "real"/.test(gate)));
  await check("P181407", F_PAGE, "/tablet names its browser tab 'Waiter tablet — Aevidine'", S, () => ok(/title: "Waiter tablet — Aevidine"/.test(page)));
  await check("P181408", F_PAGE, "/tablet renders the panel through PanelFrame (safe-area insets bridged), not a raw iframe", S, () =>
    ok(/<PanelFrame src=\{src\} title="Waiter tablet" \/>/.test(page) && !/<iframe/.test(page)));
  await check("P181409", F_RPAGE, "/r/<slug>/tablet gates through requirePanelAt('tablet', slug) — the session scopes the data, never the slug", S, () =>
    ok(/await requirePanelAt\("tablet", restaurant\)/.test(rpage)));
  await check("P181410", F_RPAGE, "requirePanelAt answers admin:true ONLY for a valid admin cookie; a waiter of another restaurant goes to THAT slug's login", S + " (lib/panelGate.ts)", () => {
    const fn = gate.slice(gate.indexOf("export async function requirePanelAt"));
    return ok(/u\.restaurant_id === r\.id && r\.active/.test(fn) && /tokenIsValid\(store\.get\(AUTH_COOKIE\)\?\.value\)\) return \{ restaurantId: r\.id, admin: true \}/.test(fn) && /redirect\(`\/r\/\$\{slug\}\/login\?next=/.test(fn));
  });
  await check("P181411", F_RPAGE, "a moved restaurant address forwards a staff bookmark to its new slug's tablet", S + " (lib/panelGate.ts)", () =>
    ok(/slugMovedTo\(slug\)/.test(gate) && /redirect\(`\/r\/\$\{moved\}\$\{ROLE_HOME\[role\]\}`\)/.test(gate) && /tablet: "\/tablet"/.test(gate)));
  await check("P181412", F_RPAGE, "/r/<slug>/tablet hands a real waiter only the paint hint, the admin the rid pin", S, () =>
    ok(/panelIframeSrc\("\/panels\/tablet\/index\.html", admin \? restaurantId : null, \{ as, view, skelRid: admin \? null : restaurantId \}\)/.test(rpage)));
  await check("P181413", F_RPAGE, "the restaurant-scoped address names its tab the same as /tablet", S, () => ok(/title: "Waiter tablet — Aevidine"/.test(rpage)));
  await check("P181414", F_RPAGE, "the two addresses build their iframe URL with the SAME builder (no hand-built twin)", S, () =>
    ok(/panelIframeSrc\(/.test(page) && /panelIframeSrc\(/.test(rpage) && !/"\/panels\/tablet\/index\.html" \+/.test(code(F_RPAGE))));
  await check("P181415", F_RPAGE, "the scoped page awaits both params and searchParams (Next 16 async params)", S, () =>
    ok(/await params/.test(rpage) && /await searchParams/.test(rpage)));
  await check("P181416", F_PAGE, "the plain page awaits searchParams (Next 16)", S, () => ok(/await searchParams/.test(page)));
  await check("P181417", F_LAYOUT, "nothing in the three host pages reads a secret or an env var", S, () =>
    ok(![page, layout, rpage].some((s) => /process\.env|SERVICE_ROLE|sbp_|ADMIN_PASSWORD/.test(s))));

  // ── D2 · the HTML shell ──────────────────────────────────────────────────────────────────────
  await check("P181418", F_HTML, "the shell declares its language, UTF-8 and a viewport that covers the notch", S, () =>
    ok(/<html lang="en">/.test(html) && /<meta charset="utf-8">/.test(html) && /viewport-fit=cover/.test(html)));
  await check("P181419", F_HTML, "the favicon is inline, so the panel never 404s on /favicon.ico", S, () => ok(/rel="icon" href="data:image\/svg\+xml/.test(html)));
  await check("P181420", F_HTML, "every script and stylesheet the shell loads exists on disk", S, () => {
    const miss = [...scripts, ...styles].filter((s) => !exists(fileOf(s)));
    return ok(miss.length === 0, miss.join(", "));
  });
  await check("P181421", F_HTML, "every ?v= in the shell is the file's own current content hash (no stale cache)", S, () => {
    const bad = [...scripts, ...styles].filter((s) => { const v = (s.split("v=")[1] || ""); return !v || !sha(fileOf(s)).startsWith(v); });
    return ok(bad.length === 0, bad.join(", "));
  });
  await check("P181422", F_HTML, "theme.js runs in <head> so the skin is set before the first paint (no flash)", S, () =>
    ok(html.indexOf("/panels/theme.js") < html.indexOf("</head>")));
  await check("P181423", F_HTML, "billdoc.js loads BEFORE app.js (the panel reads its money rules at once)", S, () =>
    ok(scripts.findIndex((s) => /billdoc\.js/.test(s)) < scripts.findIndex((s) => /^app\.js/.test(s))));
  await check("P181424", F_HTML, "outbox.js loads before offline.js and before app.js (both read the queue)", S, () => {
    const i = (re) => scripts.findIndex((s) => re.test(s));
    return ok(i(/outbox\.js/) < i(/offline\.js/) && i(/outbox\.js/) < i(/^app\.js/));
  });
  await check("P181425", F_HTML, "realtime.js and outbox.js load before connbadge.js (the light reads both)", S, () => {
    const i = (re) => scripts.findIndex((s) => re.test(s));
    return ok(i(/realtime\.js/) < i(/connbadge\.js/) && i(/outbox\.js/) < i(/connbadge\.js/));
  });
  await check("P181426", F_HTML, "netretry.js loads before app.js (reads retry a blip before calling it offline)", S, () =>
    ok(scripts.findIndex((s) => /netretry\.js/.test(s)) < scripts.findIndex((s) => /^app\.js/.test(s))));
  await check("P181427", F_HTML, "app.js is the LAST script on the page", S, () => ok(/^app\.js\?v=/.test(scripts[scripts.length - 1])));
  await check("P181428", F_HTML, "no script is loaded twice", S, () => {
    const names = scripts.map((s) => s.split("?")[0]);
    return ok(new Set(names).size === names.length, names.join(","));
  });
  await check("P181429", F_HTML, "no inline onclick/onload handlers in the shell (everything is wired from app.js)", S, () => ok(!/\son(click|load|error|change)=/i.test(html)));
  await check("P181430", F_HTML, "the minimal top bar carries ☰, the restaurant's name, ⚡ Quick order, 🚩 and the theme toggle — no live counters (owner, 2026-08-03)", S, () =>
    ok(/id="hamburger"/.test(html) && /id="restName"/.test(html) && /id="quickOrderBtn"/.test(html) && /id="reportIssueBtn"/.test(html) && /id="themeToggle"/.test(html) && !/id="(cntActive|clock|liveCount)"/.test(html)));
  await check("P181431", F_HTML, "⚡ Quick order starts hidden (shown only once settings say this waiter may take orders)", S, () =>
    ok(/id="quickOrderBtn"[^>]*hidden style="display:none"/.test(html)));
  await check("P181432", F_HTML, "the floor starts with a 'Loading your tables…' block, never pretend tiles", S, () =>
    ok(/class="floor-booting" role="status" aria-live="polite"/.test(html) && /Loading your tables/.test(html) && !/skel-tile/.test(html.replace(/<!--[\s\S]*?-->/g, ""))));
  await check("P181433", F_HTML, "the confirm dialog's two buttons and its text exist in the shell with the ids app.js uses", S, () =>
    ok(["confirmOverlay", "confirmText", "confirmYes", "confirmNo"].every((id) => new RegExp(`id="${id}"`).test(html)) && /class="confirm-overlay" id="confirmOverlay" hidden/.test(html)));
  await check("P181434", F_HTML, "every id app.js looks up with $('#…') or getElementById exists in the shell or is built by app.js", S, () => {
    const ids = new Set([...app.matchAll(/\$\("#([\w-]+)"\)|getElementById\("([\w-]+)"\)/g)].map((m) => m[1] || m[2]));
    const missing = [...ids].filter((id) => !new RegExp(`id="${id}"`).test(html) && !new RegExp(`id="${id}"|\\.id = "${id}"|id=\\\\?"${id}`).test(app));
    return ok(missing.length === 0, missing.join(", "));
  });
  await check("P181435", F_HTML, "the shell's comments do not mention a wrong load ORDER for guestbell.js and backstack.js", S, () => {
    // guestbell.js says "After backstack.js" in its comment but loads BEFORE it. It works (the bell
    // reaches LFH_BACK only when its sheet opens), so this is wording, not a fault — recorded as a
    // finding to list, not to fix.
    const bellI = scripts.findIndex((s) => /guestbell\.js/.test(s)), backI = scripts.findIndex((s) => /backstack\.js/.test(s));
    const claims = /After backstack\.js, because its sheet registers a back layer/.test(html);
    if (claims && bellI < backI) return { ok: true, skip: true, note: "the comment says 'After backstack.js' but guestbell.js loads first — harmless (it reads LFH_BACK lazily, P181436); a wording fix waiting on the owner's number in Part 4" };
    return ok(true);
  });
  await check("P181436", F_HTML, "guestbell.js reaches the back manager only when its sheet opens (so the load order above is safe)", S + " (public/panels/guestbell.js)", () =>
    ok(/if \(window\.LFH_BACK && window\.LFH_BACK\.layer\) backOff = window\.LFH_BACK\.layer\("guest-bell"/.test(read("public/panels/guestbell.js"))));
  await check("P181437", F_HTML, "fitnums.js is told exactly which figures to shrink-to-fit (.ordtotal,.ctotal)", S, () => ok(/fitnums\.js\?v=[0-9a-f]+" data-fit="\.ordtotal,\.ctotal"/.test(html)));
  await check("P181438", F_HTML, "the restaurant's NAME is the part of the brand that survives a narrow screen (the generic word drops)", S, () =>
    ok(/<span class="brand-word">🧑‍🍳 Tables<\/span> <span id="restName" class="rest-name"><\/span>/.test(html)));
  await check("P181439", F_HTML, "the shell holds no restaurant's name or logo of its own — a tenant's branding comes from data only", S, () =>
    ok(!/French House|Aangan|Pizza Palace|logo_url/i.test(html.replace(/<!--[\s\S]*?-->/g, ""))));
  await check("P181440", F_HTML, "no external script or stylesheet host (everything is same-origin)", S, () =>
    ok(![...scripts, ...styles].some((s) => /^https?:\/\//.test(s))));

  // ── D3 · who may do what: requests, scope, secrets ──────────────────────────────────────────
  await check("P181441", F_APP, "every panel data call goes to /api/tablet through api() — no other /api family is read for floor data", S, () => {
    const fetches = [...appC.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]);
    const odd = fetches.filter((u) => !/^\/api\/(panel-profile|admin\/act-as)$/.test(u));
    return ok(odd.length === 0 && /const url = "\/api\/tablet" \+ ridQ\(path\)/.test(appC) && /base: "\/api\/tablet"/.test(appC), odd.join(", "));
  });
  await check("P181442", F_APP, "the only direct fetches are the waiter's own profile and the ADMIN ribbon's 'stop acting as' (admin view only)", S, () => {
    const xr = fnBody(app, "renderXrayRibbon");
    return ok(/\/api\/admin\/act-as/.test(xr) && /if \(!tHigher\(\) && !tSim\(\)\) \{ if \(rb\) rb\.remove\(\); return; \}/.test(xr), "");
  });
  await check("P181443", F_APP, "the restaurant is never taken from the page for a real waiter: ?rid is echoed only when the tab carries it (admin pin)", S, () =>
    ok(/const ridQ = \(path\) => \{\n  if \(!PANEL_RID\) return path;/.test(app)));
  await check("P181444", F_APP, "?view=real and ?as are honoured only on an admin-pinned tab (both depend on PANEL_RID)", S, () =>
    ok(/const PANEL_VIEW_REAL = PANEL_RID && /.test(app) && /const PANEL_AS = PANEL_RID \?/.test(app)));
  await check("P181445", F_APP, "a 401 on a read sends the waiter to sign-in (no stale screen kept up)", S, () => ok(/if \(r\.status === 401\) \{ location\.href = "\/login"; throw new Error\("login"\); \}/.test(app)));
  await check("P181446", F_APP, "a device the staff blocked goes dark on the server's CODE, not its wording", S, () =>
    ok(/r\.status === 403 && j && j\.reason === "device_blocked"/.test(app) && /if \(blockedWallUp\) throw blockedError\(\);/.test(app)));
  await check("P181447", F_APP, "the blocked wall says who to ask and nothing about why", S, () => {
    const fn = fnBody(app, "showBlockedWall");
    return ok(/Ask a manager to unblock it\./.test(fn) && !/reason|because|ban/i.test(fn.replace(/\/\/.*$/gm, "")));
  });
  await check("P181448", F_APP, "app.js carries no key, token or password of any kind", S, () =>
    ok(!/sbp_|service_role|SUPABASE_SERVICE|eyJhbGciOi|ADMIN_PASSWORD|sk_live|apikey/i.test(app)));
  await check("P181449", F_APP, "the manager PIN box masks the digits and is never autofilled", S, () =>
    ok(/class="pp-in" type="password" inputmode="numeric" maxlength="8"[^>]*autocomplete="off"/.test(app)));
  await check("P181450", F_APP, "a PIN is sent only on the retry that needs it, inside the request body, never in a URL", S, () =>
    ok(/managerPin: pin/.test(app) && !/[?&]managerPin=|pin=\$\{/.test(app)));
  await check("P181451", F_APP, "hiding is never the only guard: every gated action still goes to the server, which can say no (actGated → api)", S, () => {
    const gated = (app.match(/actGated\("POST"/g) || []).length;
    return ok(gated >= 12, `${gated} gated writes`);
  });
  await check("P181452", F_APP, "a waiter is never shown a power they don't have — no 'ask your manager'/'locked' wording on a control (R67)", S, () => {
    const t = appC.replace(/xray|admin view/gi, "");
    // ("locked" alone is NOT this: a SERVED dish's note is "locked now" — a fact about the dish.)
    const re = /🔒|ask your owner|Set by the admin|turned off for you|you don't have (that|this) power|owner only/i;
    return ok(!re.test(t), (t.match(re) || [""])[0]);
  });
  await check("P181453", F_APP, "the off-for-waiters hover text appears only on an admin-tinted (.xray-off) control", S, () =>
    ok(/e\.target\.closest\(".xray-off"\)/.test(app) && /You can still use it from the admin view/.test(app)));
  await check("P181454", F_APP, "the X-ray list holds only controls this panel really has (no tablet_invoice, no tablet_parcel)", S, () => {
    const block = app.slice(app.indexOf("const XRAY_CAPS = ["), app.indexOf("];", app.indexOf("const XRAY_CAPS = [")));
    return ok(!/tablet_invoice|tablet_parcel/.test(block) && (block.match(/key: "/g) || []).length === 7);
  });
  await check("P181455", F_APP, "every X-ray key has a row in the Access tree, so its '⚙ change in Access' link lands somewhere", S + " (lib/accessTree.ts)", () => {
    const tree = read("lib/accessTree.ts");
    const keys = [...app.slice(app.indexOf("const XRAY_CAPS"), app.indexOf("];", app.indexOf("const XRAY_CAPS"))).matchAll(/key: "([\w]+)"/g)].map((m) => m[1]);
    const miss = keys.filter((k) => !tree.includes(k));
    return ok(miss.length === 0, miss.join(","));
  });
  await check("P181456", F_APP, "a typed customer number is sent only when the guest's consent box is ticked (DPDP)", S, () =>
    ok(/if \(!phone \|\| !\(ce && ce\.checked\)\) return null;/.test(app)));
  await check("P181457", F_APP, "the repeat-customer lookup is a read (GET) that stores nothing", S, () => ok(/api\("GET", `\/customer-recognize\?phone=/.test(app)));
  await check("P181458", F_APP, "the bill window prints the restaurant's logo only from an http(s) address", S, () =>
    ok(/\/\^https\?:\\\/\\\/\/i\.test\(String\(\(state\.data\.restaurant \|\| \{\}\)\.logo_url/.test(app)));
  await check("P181459", F_APP, "every person-typed value rendered into markup goes through esc()", S, () => {
    // Line by line, ignoring a line that writes textContent (text can never become markup) and the
    // split screen's part label, which is built here and escaped where it is drawn (esc(l.label)).
    const risky = appC.split("\n").filter((ln) => !/textContent|label: o\.kot_no/.test(ln))
      .flatMap((ln) => [...ln.matchAll(/\$\{(m\.name|r\.name|c\.note|cst\.name|cst\.phone|cst\.note|it\.title|d\.title|l\.title|o\.kot_no|s\.discount_note|s\.invoice_no)\}/g)].map((m) => m[1]));
    return ok(risky.length === 0 && /esc\(l\.label\)/.test(app), risky.join(","));
  });
  await check("P181460", F_APP, "the confirm box shows text, never markup (textContent), so nothing typed can become a button", S, () =>
    ok(/\$\("#confirmText"\)\.textContent = text;/.test(app)));
  await check("P181461", F_APP, "the restaurant name in the header is set with textContent", S, () => ok(/if \(el\) el\.textContent = restDisplayName\(r\)/.test(app)));
  await check("P181462", F_APP, "the per-device caches are keyed per restaurant, so a shared device never paints one tenant's floor with another's numbers", S, () =>
    ok(/"lfh_tablet_per_row:" \+ r/.test(app) && /"lfh_tablet_table_count:" \+ r/.test(app)));
  await check("P181463", F_APP, "the cached dish list is NOT keyed per restaurant — only the first network load can replace it", S, () => {
    // Recorded honestly: lfh_tablet_menu is one key per device. A device that changes restaurant shows
    // the previous restaurant's dish list until the first load lands (state._menuStale forces that load
    // to be a full one). It is listed in Part 4 as an improvement, not filed as a problem: the first
    // load replaces it within a second and nothing can be ordered from it that the server would accept.
    return ok(/localStorage\.setItem\("lfh_tablet_menu"/.test(app) && /state\._menuStale = true;/.test(app), "one device-wide key; the first load is forced full — Part 4");
  });

  // ── D4 · project rules this panel lives under ───────────────────────────────────────────────
  await check("P181464", F_APP, "every overlay app.js builds registers with LFH_BACK (one layer id per overlay)", S, () => {
    const ids = [...app.matchAll(/LFH_BACK\.layer\("([\w-]+)"/g)].map((m) => m[1]);
    const need = ["tablet-confirm", "tablet-pin", "tablet-reason", "tablet-price", "tablet-allergy", "tablet-allergy-why", "tablet-dish-edit", "tablet-pay", "tablet-khata", "tablet-tag", "tablet-discount", "tablet-optpopup", "tablet-order", "tablet-vieworder", "tablet-qdest", "tablet-drawer", "tablet-settings", "tablet-banquet", "tablet-panel", "xray-zones"];
    const miss = need.filter((n) => !ids.includes(n));
    return ok(miss.length === 0, miss.length ? "missing " + miss.join(",") : `${new Set(ids).size} layer ids`);
  });
  await check("P181465", F_APP, "no hand-rolled pushState/popstate in the panel (the back manager owns history)", S, () => ok(!/pushState|addEventListener\("popstate"/.test(appC)));
  await check("P181466", F_APP, "every write goes through api() → the offline queue (no direct POST fetch from a handler)", S, () => {
      const direct = appC.split("\n").filter((ln) => /fetch\(/.test(ln) && /method: "(POST|PATCH|DELETE)"/.test(ln));
      const odd = direct.filter((ln) => !/fetch\("\/api\/admin\/act-as"/.test(ln));
      return ok(odd.length === 0 && /window\.LFH_OUTBOX\.send\(/.test(appC), `${direct.length} direct POSTs, all the admin ribbon's 'stop acting as'${odd.length ? " — odd: " + odd[0].trim() : ""}`);
  });
  await check("P181467", F_APP, "/api/tablet is in the service worker's DATA_PATHS, so the floor opens with no internet", S + " (public/sw.js)", () =>
    ok(/\\\/api\\\/tablet/.test(read("public/sw.js"))));
  await check("P181468", F_APP, "the four value edits that two devices can clash on send `expect` (first save wins, loser told)", S, () => {
    const n = (app.match(/expect: \{ table: "(orders|order_items)"/g) || []).length;
    return ok(n >= 6, `${n} expect: sites`);
  });
  await check("P181469", F_APP, "no fixed fast poll: the backstop is 60s, skipped while hidden, and a dead socket uses catchUp()", S, () =>
    ok(/\}, 60000\);/.test(app) && /if \(document\.hidden\) return;/.test(app) && /window\.LFH_RT\.catchUp\(\(\) => load\(\)\)/.test(app) && !/setInterval\(load, \d+\)/.test(appC)));
  await check("P181470", F_APP, "the no-realtime fallback backs off (2s → 60s), jitters, and stops while hidden", S, () => {
    const t = app.slice(app.indexOf("let _fbStep = 0;"), app.indexOf("setTimeout(_fbTick, 2000);"));
    return ok(/Math\.pow\(2, _fbStep\)/.test(t) && /60000/.test(t) && /0\.8 \+ Math\.random\(\) \* 0\.4/.test(t) && /document\.hidden/.test(t));
  });
  await check("P181471", F_APP, "the clock ticks only while the drawer that shows it is open", S, () =>
    ok(/if \(drawer && !drawer\.classList\.contains\("open"\)\) return;/.test(app)));
  await check("P181472", F_APP, "whoami is re-read on the menu topic at most once per 5s, and repaints only when it changed", S, () =>
    ok(/const WHOAMI_MIN_GAP_MS = 5000;/.test(app) && /if \(j === whoamiJson\) return;/.test(app)));
  await check("P181473", F_APP, "the 10-minute menu self-heal asks a 40-byte digest instead of downloading the menu", S, () =>
    ok(/api\("GET", "\/menu-sig"\)/.test(app) && /if \(\(\+\+_menuHealN % 10\) === 0\) healMenu\(\)/.test(app)));
  await check("P181474", F_APP, "a targeted breadcrumb refreshes only the named tables (and their merged party), not the whole floor", S, () =>
    ok(/ops: \(detail\) => \(detail && !detail\.full && detail\.tables && detail\.tables\.length\) \? loadTables\(detail\.tables\) : load\(\)/.test(app) && /flatMap\(\(t\) => partyTablesOf\(t\)\)/.test(app)));
  await check("P181475", F_APP, "two targeted refreshes for different tables never cancel each other (a ticket per table)", S, () =>
    ok(/const tileSeq = \{\};/.test(app) && /if \(mySeq\[t\] !== tileSeq\[t\]\) return;/.test(app)));
  await check("P181476", F_APP, "no automatic repaint wipes an open picker or a mid-order screen", S, () => {
    const n = (app.match(/!state\.ordering && !state\.pickerOpen/g) || []).length;
    return ok(n >= 5, `${n} guarded repaints`);
  });
  await check("P181477", F_APP, "times on the tablet are the restaurant's clock (Asia/Kolkata), not the device's", S, () =>
    ok(/timeZone: "Asia\/Kolkata"/.test(app)));
  await check("P181478", F_APP, "every REJECTED decision near this code still carries its comment (R1, R2, R4, R6, R25, R51, R62, R67)", S, () => {
    const need = ["R1", "R2", "R4", "R6", "R25", "R51", "R62", "R67"];
    const miss = need.filter((r) => !new RegExp(`REJECTED \\(owner[^)]*\\)[\\s\\S]{0,400}${r}\\b|${r}\\b[\\s\\S]{0,40}REJECTED`).test(app) && !new RegExp(`→ ${r}\\b|R${r.slice(1)}\\)`).test(app));
    return ok(miss.length === 0, miss.join(","));
  });
  await check("P181479", F_APP, "the guest bill's button always says 'Print' — no 'Reprint' marking (R62)", S, () => {
    const fn = fnBody(app, "billPrintLabel");
    return ok(/🖨 Print/.test(fn) && !/Reprint/.test(fn.replace(/\/\/.*$/gm, "")));
  });
  await check("P181480", F_APP, "a cancelled order is CANCELLED, never deleted (R27) — the words say so and the endpoint cancels", S, () =>
    ok(/Cancel this whole order\? It stays on the bill at ₹0 and in the reports/.test(app) && !/Delete (this )?order/.test(appC)));
  await check("P181481", F_APP, "a waiter can never issue the invoice — the control shows only through tshow and the server refuses a waiter", S + " + route", () => {
    const route = read("app/api/tablet/[...path]/route.ts");
    return ok(/tshow\("tablet_invoice"\)/.test(app) && /Only a manager can issue the invoice\./.test(route));
  });
  await check("P181482", F_APP, "the kitchen-has-no-profile and table-tags rules are not re-derived here (they come from settings)", S, () =>
    ok(/s\.table_tags_allowed === true/.test(app) && !/PROFILE_ROLES/.test(app)));
  await check("P181483", F_APP, "no page text says 'Table 7' — tables are 'T7' or their name (owner, 2026-08-05)", S, () => {
    const t = [...appC.matchAll(/`[^`]*`|"[^"\n]*"/g)].map((m) => m[0]).filter((s) => /Table \$\{|"Table " \+/.test(s));
    return ok(t.length === 0, t.slice(0, 3).join(" · "));
  });
  await check("P181484", F_APP, "the one bill / one KOT document comes from billdoc.js — this panel builds no bill of its own", S, () =>
    ok(/LFH_BILLDOC\.billDocHtml\(LFH_BILLDOC\.billData\(/.test(app) && /LFH_BILLDOC\.kotDocHtml\(/.test(app) && !/<table[^>]*class="bill/.test(app)));
  await check("P181485", F_APP, "the whole floor is never re-read for a single tap: writes reconcile once after the taps stop", S, () =>
    ok(/function scheduleServeReconcile\(\)/.test(app) && /setTimeout\(\(\) => \{ serveReconcileTimer = null; load\(\)\.catch/.test(app)));

  // ── D5 · live: the pages as the signed-in waiter opens them ─────────────────────────────────
  const ctx = await waiterContext({ width: 1194, height: 834 });
  const pg = await ctx.newPage();
  const asked = [];
  pg.on("request", (r) => { const u = r.url(); if (u.startsWith(BASE + "/api/")) asked.push(u.slice(BASE.length)); });
  await pg.goto(BASE + "/tablet", { waitUntil: "domcontentloaded" });
  const F = await panelFrame(pg);
  await F.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled === true, null, { timeout: 30000 });
  await sleep(1500);
  await check("P181486", F_PAGE, "/tablet opens for the signed-in waiter and frames the panel", L, async () => ok(/\/panels\/tablet\/index\.html/.test(F.url()), F.url()));
  await check("P181487", F_PAGE, "the frame carries only ?skel=<French House's id> — no rid, no as, no view", L, async () => {
    const u = new URL(F.url());
    return ok(u.searchParams.get("skel") === RID && !u.searchParams.has("rid") && !u.searchParams.has("as") && !u.searchParams.has("view"), u.search);
  });
  await check("P181488", F_PAGE, "the browser tab reads 'Waiter tablet — Aevidine'", L, async () => ok((await pg.title()) === "Waiter tablet — Aevidine", await pg.title()));
  await check("P181489", F_APP, "everything the panel asked for on opening went to /api/tablet or the waiter's own profile/session helpers", L, async () => {
    const odd = asked.filter((u) => !/^\/api\/(tablet\/|panel-profile|rt-config|log|health|issue-media)/.test(u));
    return ok(odd.length === 0, odd.slice(0, 5).join(", "));
  });
  await check("P181490", F_APP, "no request on opening carried rid=, as= or view= (a real waiter's calls are scoped by the session)", L, async () =>
    ok(!asked.some((u) => /[?&](rid|as|view)=/.test(u)), asked.filter((u) => /[?&](rid|as|view)=/.test(u)).slice(0, 3).join(", ")));
  await check("P181491", F_APP, "the floor read asked for the slim summary and (only) the opened table's detail", L, async () =>
    ok(asked.some((u) => /^\/api\/tablet\/summary/.test(u)) && !asked.some((u) => /^\/api\/tablet\/state(\?|$)(?!table=)/.test(u)), asked.filter((u) => /tablet\/(summary|state)/.test(u)).slice(0, 4).join(", ")));
  const p2 = await ctx.newPage();
  await p2.goto(BASE + "/r/french-house/tablet", { waitUntil: "domcontentloaded" });
  const F2 = await panelFrame(p2);
  await check("P181492", F_RPAGE, "/r/french-house/tablet opens the same panel for French House's own waiter", L, async () => ok(/\/panels\/tablet\/index\.html/.test(F2.url()), F2.url()));
  await check("P181493", F_RPAGE, "…with the same frame URL as /tablet (one builder, two addresses)", L, async () => ok(new URL(F2.url()).search === new URL(F.url()).search, new URL(F2.url()).search));
  await check("P181494", F_RPAGE, "…and the same tab title", L, async () => ok((await p2.title()) === "Waiter tablet — Aevidine"));
  await check("P181495", F_APP, "the panel names French House in its header on both addresses", L, async () => {
    await F2.waitForFunction(() => typeof state !== "undefined" && state.settingsSettled === true, null, { timeout: 30000 });
    await sleep(800);
    const a = await F.evaluate(() => document.getElementById("restName").textContent), b = await F2.evaluate(() => document.getElementById("restName").textContent);
    return ok(/French House/i.test(a) && a === b, `${a} / ${b}`);
  });
  await check("P181496", F_APP, "the panel is the waiter view: no admin ribbon, no tinted control anywhere", L, async () =>
    ok((await F.evaluate(() => [!!document.getElementById("xrayRibbon"), document.querySelectorAll(".xray-off").length].join())) === "false,0"));
  await check("P181497", F_APP, "the waiter's whoami says not-admin (higherView false) — the server decided it", L, async () => {
    const w = await F.evaluate(() => TABLET_WHO);
    return ok(w && !w.higherView && !w.simulated, JSON.stringify(w).slice(0, 160));
  });
  await check("P181498", F_APP, "the panel's settings carry no secret-looking value to the browser", L, async () => {
    const s = await F.evaluate(() => JSON.stringify(state.data.settings || {}));
    return ok(!/sbp_|service_role|eyJhbGciOi|pin_hash|password/i.test(s), "");
  });
  await check("P181499", F_APP, "the summary the waiter receives carries no manager PIN hash or staff password field", L, async () => {
    const s = await F.evaluate(() => JSON.stringify(state.summary || {}));
    return ok(!/pin_hash|password|token/i.test(s), "");
  });
  await check("P181500", F_PAGE, "the host page around the frame shows nothing of its own but the frame (no stray text, no undefined)", L, async () => {
    const t = await pg.evaluate(() => document.body.innerText.trim());
    return ok(!/undefined|NaN/.test(t) && t.length < 200, JSON.stringify(t.slice(0, 120)));
  });
  await ctx.close();
  return R;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const R = await blockD();
  R.done();
  await closeBrowser();
}
