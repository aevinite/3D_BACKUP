#!/usr/bin/env node
// verify:owner-shell — the OWNER CONSOLE's frame, its Settings screen, its Menu and Manager-mode
// embeds, and the shared report document. Written by T17 of sweep #8 (2026-09-04) so the four
// faults it fixed cannot come back, plus the standing rules that govern this territory.
//
// STATIC ONLY, on purpose: it needs no server, no database and no browser, so it can run in the
// PostToolUse hook and in CI. The DRIVEN half of the same territory lives in
// scripts/sweep/t17/report-checks.mjs (the report document as a pure builder) and in the T17
// ledger's live rows.
//
// Judge this guard by SABOTAGE, never by reading it: break the thing a section names, run it, and
// confirm the section goes red. Every section below was sabotage-tested when it was written.
import fs from "node:fs";
import path from "node:path";

let pass = 0; const fails = [];
const ok = (s) => { pass++; console.log(`  ✅ ${s}`); };
const bad = (s, detail) => { fails.push(s); console.log(`  ❌ ${s}${detail ? `\n        ${detail}` : ""}`); };
const chk = (cond, s, detail) => (cond ? ok(s) : bad(s, detail));

const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

// LINE comments first, THEN block comments — the other order lets a `/*` sitting inside a `//`
// line swallow everything down to the next `*/` and hide real code from every check above.
// (That exact mistake hid 190 lines from two shipped guards; see the project memory.)
const codeOnly = (src) => src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const F = {
  shell: "components/owner/OwnerShell.tsx",
  mmode: "components/owner/OwnerManagerMode.tsx",
  menuEd: "components/owner/OwnerMenuEditor.tsx",
  skin: "components/owner/useOwnerSkin.ts",
  recon: "components/owner/OwnerReconnecting.tsx",
  report: "components/owner/OwnerReportButton.tsx",
  doc: "components/owner/ownerReportDoc.ts",
  num: "components/owner/AnimatedNumber.tsx",
  profile: "components/owner/ownerProfileHost.ts",
  order: "components/owner/ownerRestaurantSort.ts",
  pSettings: "app/owner/settings/page.tsx",
  pMenu: "app/owner/menu/page.tsx",
  pManager: "app/owner/manager/page.tsx",
};
const SRC = {}; const CODE = {};
let missing = 0;
for (const [k, p] of Object.entries(F)) {
  const s = read(p);
  if (s === null) { console.log(`  ❌ ${p} not found — if it moved, update this guard`); fails.push(p); missing++; continue; }
  SRC[k] = s; CODE[k] = codeOnly(s);
}
// A guard that silently checks nothing is the one failure mode a guard cannot survive.
const FLOOR = 60;

console.log("\nThe owner console's frame, its Settings screen and its two embeds\n");

// ── §1 · a class no stylesheet declares must not come back ──────────────────────────────────────
{
  const hits = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(f); continue; }
    if (!/\.tsx?$/.test(e.name)) continue;
    if (/className="[^"]*\badm-page-title\b/.test(fs.readFileSync(f, "utf8"))) hits.push(f);
  } };
  for (const d of ["app", "components"]) { try { walk(d); } catch {} }
  chk(hits.length === 0, "§1 nothing uses `adm-page-title`, a class no stylesheet declares", hits.join(", "));
  chk(/className="adm-page-h">Manager mode</.test(SRC.mmode || ""),
    "§1 the Manager-mode launcher heads itself with the console's own heading class");
  const g = read("app/globals.css") || "";
  chk(/\.adm-page-h\s*\{/.test(g), "§1 …and that class is really declared in the stylesheet");
  chk(!/\.adm-page-title\s*\{/.test(g), "§1 …while `adm-page-title` still is not (do not add it — remove the usage)");
}

// ── §2 · ONE colour per restaurant, keyed by id ─────────────────────────────────────────────────
{
  chk(/portfolioColor\(r\.id\)/.test(CODE.mmode || ""), "§2 the Manager-mode launcher colours its dot by restaurant ID");
  chk(!/accentColor/.test(CODE.mmode || ""), "§2 …and never by the restaurant's brand accent");
  chk(!/accent_color/.test(CODE.pManager || ""), "§2 the Manager-mode page reads no brand-accent column it does not use");
  chk((CODE.shell || "").match(/portfolioColor\(r\.id\)/g)?.length === 2,
    "§2 both of the shell's restaurant dots (sidebar + top switcher) are keyed by ID",
    `found ${(CODE.shell || "").match(/portfolioColor\(r\.id\)/g)?.length ?? 0}, expected 2`);
  chk(!/className="sw" style=\{\{ background: "#/.test(CODE.shell || "") && !/className="sw" style=\{\{ background: "#/.test(CODE.mmode || ""),
    "§2 …and no restaurant dot anywhere here is painted a fixed colour instead");
  chk(!/accentColor/.test(CODE.shell || ""), "§2 …and the shell keeps no brand-accent field it never reads");
}

// ── §3 · ONE order for every restaurant list in the console ─────────────────────────────────────
{
  chk(/export function byName/.test(SRC.order || ""), "§3 there is one sorter for the cockpit's restaurant lists");
  chk(/localeCompare/.test(CODE.order || "") && /numeric:\s*true/.test(CODE.order || ""),
    "§3 …and it orders \"Branch 2\" before \"Branch 10\"");
  for (const [k, who] of [["shell", "the sidebar + top switcher"], ["pMenu", "the Menu picker"], ["pManager", "the Manager-mode launcher"]]) {
    chk(/byName\(/.test(CODE[k] || ""), `§3 ${who} calls it`);
  }
  chk(/byName\(ids\.map/.test(CODE.pManager || "") && /byName\(rows\.map/.test(CODE.pManager || ""),
    "§3 …and BOTH of the Manager-mode page's branches do (a real owner and the admin act-as)");
  chk(/const ids = restaurants\.map/.test(CODE.pMenu || ""),
    "§3 the Menu page's default restaurant is taken from the SORTED list, so `ids[0]` means something");
}

// ── §4 · nothing writes storage where React may call twice ──────────────────────────────────────
{
  const offenders = [];
  for (const [k, c] of Object.entries(CODE)) {
    // useState(() => { … }) — flag a storage WRITE anywhere inside such an initializer
    for (const m of c.matchAll(/useState(?:<[^>]*>)?\(\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\}\)/g)) {
      if (/(?:sessionStorage|localStorage|document\.cookie)\s*(?:\.setItem|=)/.test(m[1])) offenders.push(F[k]);
    }
  }
  chk(offenders.length === 0, "§4 no useState initializer writes to storage (React may run it twice)", offenders.join(", "));
  chk(/const retryNow = \(\) =>/.test(CODE.recon || ""), "§4 the reconnect card counts an attempt at the moment it retries");
  chk((CODE.recon || "").match(/retryNow/g)?.length >= 3, "§4 …and BOTH the timer and the Retry-now button go through it");
}

// ── §5 · the owner console's skin key is `aevidine_skin`, and only that ─────────────────────────
{
  for (const [k, p] of Object.entries(F)) {
    if (!CODE[k]) continue;
    if (/lfh_theme|lfh_panel_theme/.test(CODE[k])) bad(`§5 ${p} touches a theme key that is not the owner console's`);
  }
  ok("§5 no file in this territory touches `lfh_theme` or `lfh_panel_theme`");
  chk(/localStorage\.setItem\("aevidine_skin"/.test(CODE.shell || "") && /document\.cookie = `aevidine_skin=/.test(CODE.shell || ""),
    "§5 the header toggle writes the skin to localStorage AND to the cookie the server reads");
  chk(/localStorage\.setItem\("aevidine_skin"/.test(CODE.pSettings || "") && /document\.cookie = `aevidine_skin=/.test(CODE.pSettings || ""),
    "§5 the Settings screen's Light/Dark buttons write both, the same way");
  chk(/initialSkin \?\? "dark"/.test(CODE.shell || ""), "§5 dark stays the default when no choice has been made");
  for (const [k, who] of [["pMenu", "Menu"], ["pManager", "Manager mode"]]) {
    chk(/store\.get\("aevidine_skin"\)\?\.value === "light" \? "light" : "dark"/.test(CODE[k] || ""),
      `§5 the ${who} page reads the skin cookie with the shell's own default`);
  }
}

// ── §6 · an embedded panel is told the LIVE skin by message, never by its address ───────────────
{
  chk(/postMessage\(\{ type: "lfh-owner-skin"/.test(CODE.skin || ""), "§6 the live skin reaches an embed by message");
  chk(/const bornSkin = useRef\(liveSkin\)\.current/.test(CODE.menuEd || ""), "§6 the Menu embed's address carries only the skin it was BORN with");
  chk(/skin=\$\{bornSkin\}/.test(CODE.menuEd || ""), "§6 …and interpolates that, not the live value (which would reload the panel)");
  chk(/skin=\$\{skinRef\.current\}/.test(CODE.mmode || ""), "§6 the Manager-mode embed does the same");
  chk(/addEventListener\("load", \(\) => pushSkin/.test(CODE.mmode || "") , "§6 a frame that finishes loading after a toggle is told again");
  chk(/el\.addEventListener\("load", \(\) => pushSkinTo\(el, skinRef\.current\)\)/.test(CODE.skin || ""), "§6 …and so is the shared embed mount");
  chk(/window\.location\.origin/.test(CODE.skin || ""), "§6 the skin message is addressed to this origin, not to \"*\"");
}

// ── §7 · an embed is mounted imperatively, so it swallows no Back press ────────────────────────
{
  for (const [k, who] of [["mmode", "Manager mode"], ["menuEd", "the Menu editor"]]) {
    chk(!/<iframe/.test(CODE[k] || ""), `§7 ${who} renders no JSX <iframe> (React assigns src after insertion → a history entry)`);
  }
  chk(/document\.createElement\("iframe"\)/.test(CODE.mmode || ""), "§7 Manager mode builds its frame in code");
  chk(/el\.src = srcRef\.current;/.test(CODE.skin || ""), "§7 the shared mount sets src BEFORE insertion");
  chk(/host\.appendChild\(el\)/.test(CODE.skin || ""), "§7 …and only then puts the element in the page");
  chk(/attachSafeAreaBridge/.test(CODE.skin || "") && /attachSafeAreaBridge/.test(CODE.mmode || ""),
    "§7 both embeds pass the phone's notch/gesture insets into the panel");
}

// ── §8 · every overlay is a Back step ───────────────────────────────────────────────────────────
{
  const layers = [...(CODE.shell || "").matchAll(/useBackClose\("([^"]+)"/g)].map((m) => m[1]);
  for (const want of ["owner-xray-zones", "owner-nav", "owner-rest-switch"]) {
    chk(layers.includes(want), `§8 the shell's "${want}" overlay closes on the phone's Back button`);
  }
  chk(/useBackClose\("owner-mmode-panel"/.test(CODE.mmode || ""), "§8 Back inside the floor peels back to the launcher");
  chk(/useBackClose\("owner-report-modal"/.test(CODE.report || ""), "§8 Back closes the Generate-report dialog");
  chk(/pageHosted: true/.test(CODE.profile || ""),
    "§8 the owner's person profile registers NO layer — it is a real page with its own address (two layers = a dead first Back press)");
}

// ── §9 · the three server pages ────────────────────────────────────────────────────────────────
{
  for (const [k, who] of [["pMenu", "Menu"], ["pManager", "Manager mode"]]) {
    const c = CODE[k] || "";
    chk(/await searchParams/.test(c), `§9 the ${who} page awaits searchParams (Next 16 async params)`);
    chk(/await cookies\(\)/.test(c), `§9 the ${who} page awaits cookies()`);
    chk(!/select\("\*"\)|select\('\*'\)/.test(c), `§9 the ${who} page names its columns, never select("*")`);
    chk(!/"use client"/.test(c.slice(0, 40)), `§9 the ${who} page stays a server component`);
    chk(/\.in\("id",|\.eq\("id",/.test(c), `§9 every restaurants read on the ${who} page is scoped by id`);
    // the sign-in / act-as gate must precede the first database call
    const firstDb = c.search(/sb\.from\(|sb\.rpc\(/);
    const gate = c.search(/userFromCookie|tokenIsValid/);
    chk(gate >= 0 && gate < firstDb, `§9 the ${who} page identifies the caller before its first database call`);
  }
  chk(/entitledSubset\(await enabledOwnedRestaurantIds\(u\.id\), "manager_mode"\)/.test(CODE.pManager || ""),
    "§9 Manager mode re-checks the admin's section switch on the server, not only in the sidebar");
  chk(/mergeOwnerEntitlements\(r\.owner_entitlements\)\.menu !== false/.test(CODE.pMenu || ""),
    "§9 the Menu page re-checks the admin's Menu switch on the server too");
  chk(/let couldntRead = false/.test(CODE.pMenu || "") && /if \(couldntRead\)/.test(CODE.pMenu || ""),
    "§9 the Menu page answers a FAILED READ separately — \"I couldn't ask\" is never \"it is switched off\"");
  chk(/redirect\("\/owner"\)/.test(CODE.pMenu || "") && /redirect\("\/owner"\)/.test(CODE.pManager || ""),
    "§9 a section he has not been given sends him home instead of naming it (R36)");
}

// ── §10 · the Settings screen ───────────────────────────────────────────────────────────────────
{
  const c = CODE.pSettings || "";
  chk(/data\.sections\[k\] !== false/.test(c), "§10 the What's-enabled card lists what is ON, absent meaning ON like the server");
  chk(!/fa-xmark|fa-times|✗|✘/.test(c), "§10 …and shows no off-state at all (R36 — the owner never sees what is withheld)");
  chk(!/\bof 9\b|\d+ of \{/.test(c), "§10 …and no \"6 of 9\" count, which would disclose the same thing");
  chk(/printingOk === false/.test(c), "§10 a failed printing read says so, instead of looking like printing being off");
  chk(/if \(!showsPrinting\) return;/.test(c), "§10 the printing poll does not run when there is no printing card on screen");
  chk(/if \(!document\.hidden\) loadPrinting\(\)/.test(c) && /visibilitychange/.test(c),
    "§10 …and it stops while the tab is in the background");
  chk((c.match(/setInterval\(/g) || []).length === 1, "§10 the Settings screen has exactly ONE repeating timer");
  chk(/printing && printing\.restaurantId === p\.restaurant_id/.test(c),
    "§10 a printing row only shows the answer that is about ITS restaurant");
  chk(/print-setup\.html/.test(c), "§10 the printer setup guide is reachable from here");
  chk(/nw !== cf/.test(c) && /nw\.length < 6/.test(c), "§10 the password form checks the match and the length before asking the server");
  chk(/window\.location\.href = "\/login"/.test(c), "§10 …and a changed password lands the owner on the sign-in screen");
  // Every sidebar row that is gated by an owner SECTION key must have a chip label, or a section
  // he has been given would be missing from a card headed "what Aevidine has switched on for you".
  const navEnts = [...(CODE.shell || "").matchAll(/ent: "([a-z_]+)"/g)].map((m) => m[1]);
  // Parse the SECTION_LABEL body, not "one key per line" — the keys sit several to a line, and a
  // per-line regex found six of the nine and invented a failure. (A guard that invents a failure
  // is a guard nobody runs; see the project memory of the same name.)
  const body = (c.match(/SECTION_LABEL[^=]*=\s*\{([\s\S]*?)\n\};/) || [, ""])[1];
  const labels = [...body.matchAll(/([a-z_]+)\s*:\s*"/g)].map((m) => m[1]);
  const MODULES = ["khata_book", "inventory"];   // modules, not sections — deliberately absent
  const gap = navEnts.filter((e) => !MODULES.includes(e) && !labels.includes(e));
  chk(gap.length === 0, "§10 every gated sidebar section has a chip on the What's-enabled card", gap.join(", "));
  // `ratings` is a real section the owner really has, reached as a TAB inside Feedback &
  // complaints rather than as its own nav row — so its chip has to SAY where it lives, or the
  // owner reads "Guest ratings", goes looking in the menu, and it is not there (owner, 2026-09-01).
  chk(/ratings: "Guest ratings — in Feedback & complaints"/.test(c),
    "§10 the Guest-ratings chip says which screen it lives on, because it is not a sidebar row");
}

// ── §11 · the shell's own standing decisions ───────────────────────────────────────────────────
{
  const c = CODE.shell || "";
  chk(c.match(/"Owner overview"/g)?.length === 2,
    "§11 BOTH scope chips (the switcher's and the single-restaurant pill) still read \"Owner overview\" — R20 says do not name the page",
    `found ${c.match(/"Owner overview"/g)?.length ?? 0}, expected 2`);
  chk(/<form method="post" action="\/api\/panel-logout"/.test(SRC.shell || ""),
    "§11 signing out is a POST form, not a link a prefetch could follow");
  chk(/myRests\.length > 1/.test(c), "§11 a one-restaurant owner gets no restaurant list and no switcher");
  chk(/reportsOff/.test(c) && /hidden/.test(c),
    "§11 a restaurant whose Reports are off says \"hidden\", never a confident ₹0");
  chk(/if \(!on && \(!adminViewing \|\| simulated\)\) return null/.test(c),
    "§11 a withheld section disappears for the real owner and is only tinted for the admin");
  chk(/lfh:owner-open-restaurant/.test(c) && /lfh:owner-manager-rid/.test(c) && /lfh:owner-scope/.test(c),
    "§11 the switcher re-scopes Dashboard, Reports/Audit and Manager mode in place");
  chk(/path\.startsWith\("\/owner\/manager"\)\) \{\n\s*window\.dispatchEvent\(new CustomEvent\("lfh:owner-manager-rid"/.test(c) ||
      /lfh:owner-manager-rid[\s\S]{0,200}\}\)\;\n\s*\}\n\s*\}\}/.test(c),
    "§11 the crumb's section tap reaches Manager mode's own channel too (a tap must never vanish in silence)");
  chk((c.match(/useActiveAutoRefresh\(/g) || []).length === 1 && /60000/.test(c),
    "§11 the sidebar's figures refresh on the activity-gated 60s cadence, once");
  chk(!/setInterval\(/.test(c), "§11 …and the shell starts no bare interval of its own");
}

// ── §12 · the shared report document ───────────────────────────────────────────────────────────
{
  const d = CODE.doc || "", r = CODE.report || "";
  chk(/const esc = \(s: string\) => String\(s \?\? ""\)/.test(d), "§12 the printed sheet escapes at the sink, and tolerates a null label");
  chk(/inr = \(n: number\)/.test(d) && /v < 0 \? "−₹" : "₹"/.test(d), "§12 a negative figure reads −₹, never ₹-");
  chk((d.match(/toLocaleString\("en-IN"\)/g) || []).length >= 2 && !/en-US/.test(d), "§12 every figure is grouped the Indian way");
  chk(/locale: "en-IN"/.test(CODE.num || "") && !/en-US/.test(CODE.num || ""), "§12 …including the count-up numbers on screen");
  chk(/inr\(b\.gross - b\.discount \+ b\.taxTotal\)/.test(d),
    "§12 the money flow's \"total collected\" is COMPUTED on the page, so the printed sum adds up");
  chk(/xEsc = \(v: string \| number\)/.test(r), "§12 the Excel sheet escapes every title, header and cell");
  chk(/escCsv = /.test(r) && /\\ufeff/.test(r), "§12 the CSV is quoted and carries a byte-order mark so ₹ survives Excel");
  chk(/setNote\(POPUP_BLOCKED\)/.test(r) && /import \{ POPUP_BLOCKED \}/.test(SRC.report || ""),
    "§12 a blocked pop-up is reported into the dialog, not swallowed");
  chk(/setNote\(`Couldn't build the report/.test(r), "§12 …and so is a failed download, which has no tab to apologise in");
  chk(/e\.key === "Escape" && !busy/.test(r), "§12 Escape closes the dialog, but never while a report is compiling");
  chk(/const tab = kind === "print" \? window\.open\("", "_blank"\) : null;/.test(r),
    "§12 the print tab is opened inside the click, before any await (or the blocker eats it)");
  chk(/k: "fy"/.test(r) && /k: "12m"/.test(r) && /k: "week"/.test(r),
    "§12 the period list offers the financial year, 12 months and this week");
  chk(/max=\{today\}/.test(r), "§12 no custom date can be set in the future");
  chk(/d\.omitted\?\.length/.test(d), "§12 an incomplete statement says so on the paper itself");
}

// ── §13 · nothing here adds a column to `settings` ─────────────────────────────────────────────
{
  const offenders = Object.entries(CODE).filter(([, c]) => /from\("settings"\)[\s\S]{0,120}\.(insert|update|upsert)\(/.test(c)).map(([k]) => F[k]);
  chk(offenders.length === 0, "§13 no screen in this territory writes the settings table directly", offenders.join(", "));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (pass + fails.length < FLOOR) {
  console.log(`\n❌ REFUSING TO PASS — only ${pass + fails.length} checks ran, and this guard has at least ${FLOOR}.`);
  console.log("   A suite that quietly stops checking is worse than one that fails.");
  process.exit(1);
}
if (missing) console.log(`\n${missing} file(s) in this territory could not be read.`);
if (fails.length) { console.log("\n❌ FAIL"); process.exit(1); }
console.log("\n✅ PASS — the owner console's frame and its three screens hold their rules.");
